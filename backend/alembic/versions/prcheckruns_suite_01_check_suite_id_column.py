"""coord.pr_check_runs — add check_suite_id (the GitHub check suite a check run belongs to)

Revision ID: prcheckruns_suite_01
Revises: coord_claude_acct_usage_05
Create Date: 2026-11-16

Phase 3a of plan
``2026-11-16-finish-session-refuses-a-finish-whose-only-owed-pr-is-ci-pending``
(design decision D4).

The defect this serves
----------------------
A check run created through the Checks API (reviewdog's ``clippy-diff
(advisory)`` on qontinui-coord#4159) is left ``in_progress`` for ever when the
job that created it dies before completing it. Coord counts it as pending, so
the PR sits at ``ci-pending`` long after its workflow run has concluded. Coord
cannot see that the run concluded: an API-created run's ``details_url`` carries
no workflow run id, which is the only key coord's abandoned-check classifier
joins ``coord.ci_runs`` on.

Its CHECK SUITE does carry one. For the ``github-actions`` app one suite is
exactly one workflow run, so the orphan's run is the run id parsed from any
SIBLING row on the same head with the same suite id — the job that created the
orphan is always such a sibling. Coord already parses ``check_run.check_suite.id``
from both the webhook payload and the REST list (``CheckRunSuiteRef.id`` in
``pr_state.rs``) and then drops it, because there is no column to write it to.
This revision adds that column; coord's writer (plan Phase 3b) fills it with
``COALESCE(EXCLUDED.check_suite_id, existing)`` so a payload without a suite
never erases one.

``NULL`` means UNKNOWN: a row written before coord stores the value, or a
payload that carried no suite. A reader that cannot establish a suite id fails
closed (the row stays pending), never infers a suite.

Why this revision lands before any coord read
---------------------------------------------
Served policy ``production-and-cost`` ``alembic-sole-authorship``: alembic is
the sole author of ``coord.*`` DDL, and a coord read of a new column lands
AFTER its migration is APPLIED. The two deploy independently, and a missing
column on an existing table is not caught at boot.

Why the view is rebuilt in the same revision
--------------------------------------------
PostgreSQL expands ``SELECT *`` at view-creation time and stores the resolved
column list, so a column added to the base table afterwards is invisible
through ``coord.pr_check_runs_latest`` until the view is re-executed (the trap
``prcheckruns_headbranch_02_latest_view`` closed for ``head_branch`` and
``prcheckruns_base_sha_01`` re-closed for ``base_sha``). Coord's rollup reader
goes through the view, so without the rebuild the column would exist and the
reader that needs it would ``42703``.

Shape (``prcheckruns_base_sha_01``'s, plus what has changed since)
------------------------------------------------------------------
* ``ADD COLUMN IF NOT EXISTS check_suite_id BIGINT NULL`` — nullable, no
  default, no index (readers look up by ``(repo, head_sha)``, which
  ``idx_pr_check_runs_head_sha`` covers; the suite id is matched among the few
  rows of one head). ``BIGINT`` because the GitHub API types a check suite
  id as int64, and real ids already exceed 2^31: ``118211762840`` is
  check_run ``132651515896``'s ``check_suite.id`` on qontinui-coord#4159, read
  with ``gh api repos/qontinui/qontinui-coord/check-runs/132651515896`` by an
  independent reviewer on 2026-11-16 and recorded in the investigation of coord
  finding ``c58cd00f-7651-4dde-bd3d-d69fcc59f291``. Additive, no rewrite.
* ``COMMENT ON COLUMN`` carries the meaning into the catalog.
* The view is re-executed from ``_LATEST_VIEW_CONCLUSIVE_FIRST``, byte-identical
  to the constant ``prcheckruns_latest_03_conclusive_first`` defined and
  ``prcheckruns_base_sha_01`` re-executed — no newer revision redefines the
  view's SELECT. ``CREATE OR REPLACE`` is legal because the column is APPENDED.
* ``ALTER VIEW ... SET (security_invoker = true)`` straight after it. This is
  the one step the precedent lacks, because it predates ``coordrls_01``: that
  revision switched the view to ``security_invoker`` so a ``coord_tenant``
  reader is filtered by its own row-level-security policies, and
  ``CREATE OR REPLACE VIEW`` RESETS a view's options to what its own ``WITH``
  clause says. Without this line the view would silently become an owner-rights
  view again — an RLS bypass — which
  ``tests/test_coord_views_security_invoker.py`` reds. Setting it in the same
  transaction means no reader ever sees the reset state. ``CREATE OR REPLACE``
  keeps the view's oid, owner and grants.

The lock
--------
``ADD COLUMN`` takes ``AccessExclusiveLock`` on ``coord.pr_check_runs``, the
table every ``check_run`` webhook upserts into and every rollup read reaches
through the view. ``alembic/env.py`` runs a whole upgrade batch in ONE
transaction, so inside it that lock would be held until the entire deploy batch
commits. So, as ``coordrls_01`` and ``coordmem_01`` do for their view locks, the
DDL runs in an ``autocommit_block`` as a transaction of its own —
``BEGIN; SET LOCAL lock_timeout = '3s'; LOCK ...; ...; COMMIT`` — and holds the
locks only for these statements. Entering the block commits the batch so far.
The revision is idempotent (``IF NOT EXISTS``, a re-applied comment, a re-run
``CREATE OR REPLACE`` and option set), so a retry after a failure past that
point is safe.

This revision is the first in that pattern to take a TABLE lock as well as the
view's, and the order of the two is load-bearing. A reader of the view locks
the VIEW when its query is parsed and the TABLE when the view is rewritten —
view, then table. Left to itself the upgrade would lock the table first
(``ALTER TABLE``) and the view second (``CREATE OR REPLACE VIEW``), the
opposite order, so a rollup read arriving while the ``ALTER`` waited for an
in-flight reader would hold the view, wait for the table, and deadlock with the
migration (``40P01``). Removing the ``LOCK`` below makes
``test_upgrade_does_not_deadlock_with_a_concurrent_view_reader`` fail with
``DeadlockDetected``. So the first statement after the
lock timeout is ``LOCK TABLE coord.pr_check_runs_latest, coord.pr_check_runs
IN ACCESS EXCLUSIVE MODE``: Postgres takes the locks in the order listed, view
first, which is the readers' order. A reader whose FIRST lock in its
transaction is the view then simply queues behind the migration.

That is the whole of the guarantee. A transaction that has already touched
``coord.pr_check_runs`` (an upsert, or a direct read of the table) and then
reads the view in the same transaction holds the table before it asks for the
view — the migration's order reversed — and can still deadlock with it: the
locks it holds and asks for are the cycle above with the roles swapped.
Postgres then aborts one side with ``40P01``. If that is the migration, the
deploy fails (``migrate.yml`` has no migration-level retry); the revision is
idempotent and safe to re-run, and the deploy is then re-run — the same
outcome as a ``55P03`` lock timeout. If it is the other transaction, it rolls
back and its caller sees the error. No order of the two
locks avoids both shapes; this one removes the common case, a plain rollup
read. The downgrade takes the same ``LOCK`` first (it already reached the
view before the table, by dropping the view before altering the table, but
naming the order beats depending on it). The migration test pins the ordering
with a concurrent reader.

Downgrade
---------
``CREATE OR REPLACE VIEW`` cannot REMOVE a column from a view, and the column
cannot be dropped while the view's stored projection names it. So the
downgrade, in one transaction of its own: records the view's owner and grants,
drops the view, drops the column, re-creates the view from the same constant,
sets ``security_invoker`` again, gives the view back to its recorded owner
(a re-create hands it to the migrating role), and replays the recorded grants
(``DROP VIEW`` discards a view's ACL; the re-create would otherwise carry only
what ``ALTER DEFAULT PRIVILEGES`` hands a NEW object, which need not match).
The view's oid changes — a downgrade is not a zero-downtime path and does not
claim to be.

The grant replay restores the ACL this view has carried since ``coordrls_01``.
It is NOT exact in general: three shapes come back approximately, and no
revision in the chain produces any of them:

* **A grant whose grantor is not the owner** (``b=r/a``, made by a grantee
  holding ``WITH GRANT OPTION``) comes back granted by the owner: the replay
  runs every ``GRANT`` as the migrating role, which Postgres records as the
  owner's grant. The grantee keeps the same privileges; only the grantor
  column differs.
* **A NULL ACL** (the owner's implicit default, never granted or revoked)
  comes back as the equivalent explicit owner-only ACL: SQL has no statement
  that resets an ACL to NULL. ``coordrls_01`` granted on this view, so its ACL
  is not NULL at the parent.
* **An owner whose own privileges were narrowed** (say ``REVOKE INSERT ... FROM
  <owner>``) comes back with full rights: the replay skips the owner's own
  entries, and a re-created view grants its owner everything.

Only the view's own ACL (``pg_class.relacl``) is recorded. Column-level grants
(``pg_attribute.attacl``) are NOT restored; ``DROP VIEW`` discards them and the
replay does not know they existed. No revision in the chain grants any.

The ``DROP COLUMN`` lives inside ``downgrade()`` and nowhere else on purpose:
the ``coord-column-drop-guard`` CI gate scans the module minus ``downgrade()``
for ``coord.*`` drops, and this revision's upgrade path drops nothing.

Landing
-------
coord's migration classifier rejects ``CREATE OR REPLACE VIEW`` and the explicit
``BEGIN`` / ``COMMIT``, so the PR is escalate-path-matched, as
``prcheckruns_base_sha_01`` and ``coordmem_01`` were.

Chains off the single head at authoring (``coord_claude_acct_usage_05``,
counted with ``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). If
another revision lands first, this one re-points its ``down_revision`` — never
``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_suite_01"
down_revision: str | Sequence[str] | None = "coord_claude_acct_usage_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Verbatim from prcheckruns_latest_03_conclusive_first.py (which
# prcheckruns_base_sha_01 also re-executes verbatim). The SELECT does not change
# in either direction: the upgrade re-executes it so `*` re-expands over
# `check_suite_id`; the downgrade re-executes it after the column is gone so `*`
# contracts again. The migration test compares it byte-for-byte with the
# author's constant.
_LATEST_VIEW_CONCLUSIVE_FIRST = """
    CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS
        SELECT DISTINCT ON (repo, head_sha, name) *
        FROM coord.pr_check_runs
        ORDER BY repo, head_sha, name,
                 COALESCE(conclusion IN ('cancelled', 'stale'), FALSE) ASC,
                 started_at DESC NULLS LAST, check_id DESC
"""

# CREATE OR REPLACE VIEW resets the options coordrls_01 set (module docs).
_SECURITY_INVOKER = (
    "ALTER VIEW coord.pr_check_runs_latest SET (security_invoker = true)"
)


# View first, then table: the order a reader of the view takes them in (module
# docs, "The lock"). Postgres locks a LOCK TABLE list in the order written.
_LOCK_VIEW_THEN_TABLE = (
    "LOCK TABLE coord.pr_check_runs_latest, coord.pr_check_runs "
    "IN ACCESS EXCLUSIVE MODE"
)


def _one_transaction(*statements: str) -> str:
    """The statements as one short transaction of their own, locks taken first
    in the readers' order (module docs, "The lock")."""
    body = ";\n".join(s.strip() for s in (_LOCK_VIEW_THEN_TABLE, *statements))
    return f"BEGIN;\nSET LOCAL lock_timeout = '3s';\n{body};\nCOMMIT"


def upgrade() -> None:
    """Add ``check_suite_id`` and re-expand ``pr_check_runs_latest`` over it."""
    with op.get_context().autocommit_block():
        op.execute(
            _one_transaction(
                """
                ALTER TABLE coord.pr_check_runs
                    ADD COLUMN IF NOT EXISTS check_suite_id BIGINT NULL
                """,
                """
                COMMENT ON COLUMN coord.pr_check_runs.check_suite_id IS
                    'The GitHub check suite this check run belongs to, from '
                    'check_run.check_suite.id (webhook payload or REST list). Used '
                    'to tie a check run created through the Checks API, whose '
                    'details_url names no workflow run, to its workflow run '
                    'through sibling rows: for the github-actions app one suite is '
                    'one workflow run, so any row on the same head with the same '
                    'suite id and a parseable run id names it. Writers must '
                    'COALESCE on upsert, so a payload without a suite never erases '
                    'a stored one. Readers must treat NULL as UNKNOWN (a row '
                    'written before coord stored the value, or a payload with no '
                    'suite) and fail closed on it.'
                """,
                _LATEST_VIEW_CONCLUSIVE_FIRST,
                _SECURITY_INVOKER,
            )
        )


def downgrade() -> None:
    """Drop ``check_suite_id``; restore the view's projection, options, owner and
    grants (approximately for the shapes the module docs list)."""
    with op.get_context().autocommit_block():
        op.execute(
            _one_transaction(
                # The owner and grants DROP VIEW is about to discard, kept for the
                # restore.
                """
                CREATE TEMP TABLE prcheckruns_suite_01_view_acl ON COMMIT DROP AS
                    SELECT c.relowner, c.relacl
                      FROM pg_class c
                     WHERE c.oid = 'coord.pr_check_runs_latest'::regclass
                """,
                # The view's stored projection names check_suite_id, so it goes
                # first; CREATE OR REPLACE cannot narrow a view.
                "DROP VIEW IF EXISTS coord.pr_check_runs_latest",
                "ALTER TABLE coord.pr_check_runs DROP COLUMN IF EXISTS check_suite_id",
                _LATEST_VIEW_CONCLUSIVE_FIRST,
                _SECURITY_INVOKER,
                # Give the view back to its recorded owner, strip what the
                # re-create was handed (ALTER DEFAULT PRIVILEGES) from every
                # non-owner, then grant back what was recorded (module docs,
                # "Downgrade", for the two shapes this replays approximately).
                """
                DO $$
                DECLARE
                    view_oid oid := 'coord.pr_check_runs_latest'::regclass;
                    owner_oid oid;
                    entry record;
                BEGIN
                    SELECT s.relowner INTO owner_oid FROM prcheckruns_suite_01_view_acl s;
                    EXECUTE format(
                        'ALTER VIEW coord.pr_check_runs_latest OWNER TO %I',
                        pg_get_userbyid(owner_oid)
                    );
                    FOR entry IN
                        SELECT DISTINCT a.grantee
                          FROM pg_class c, aclexplode(c.relacl) a
                         WHERE c.oid = view_oid AND a.grantee <> owner_oid
                    LOOP
                        EXECUTE format(
                            'REVOKE ALL ON coord.pr_check_runs_latest FROM %s',
                            CASE WHEN entry.grantee = 0 THEN 'PUBLIC'
                                 ELSE quote_ident(pg_get_userbyid(entry.grantee)) END
                        );
                    END LOOP;
                    FOR entry IN
                        SELECT a.grantee, a.privilege_type, a.is_grantable
                          FROM prcheckruns_suite_01_view_acl s, aclexplode(s.relacl) a
                         WHERE a.grantee <> owner_oid
                    LOOP
                        EXECUTE format(
                            'GRANT %s ON coord.pr_check_runs_latest TO %s%s',
                            entry.privilege_type,
                            CASE WHEN entry.grantee = 0 THEN 'PUBLIC'
                                 ELSE quote_ident(pg_get_userbyid(entry.grantee)) END,
                            CASE WHEN entry.is_grantable THEN ' WITH GRANT OPTION'
                                 ELSE '' END
                        );
                    END LOOP;
                END
                $$
                """,
            )
        )
