"""coord.pr_check_runs — add changed_at (when a check row last changed, not last written)

Revision ID: prcheckruns_changed_at_01
Revises: agent_status_intent_globs_declared_01
Create Date: 2026-11-26

Phase 3a of plan
``2026-10-17-coord-overdue-floor-gives-every-seat-to-newer-inputs-so-stale-pass-and-stale-ready-block-never-fire``.
A re-port of qontinui-web#2022, closed unmerged 2026-11-24: its tests pinned the
view's pre-revision projection, which ``prcheckruns_suite_01`` then extended.
It also ran the table and the view as two transactions, leaving a moment where
the view lacked the column, and its downgrade replayed a fixed GRANT rather than
the recorded owner and ACL. This revision takes ``prcheckruns_suite_01``'s shape
instead.

The defect this serves
----------------------
coord's overdue floor ranks a PR ``NewerInputs`` when its check rows are newer
than its last decision, and it reads that from ``updated_at``. But ``updated_at``
is a WRITE stamp: every webhook redelivery, REST re-read and heal re-upsert moves
it, whether or not anything about the check changed. So a no-change re-upsert
reads as a newer input, and ``NewerInputs`` takes floor seats from the
stale-pass and stale-ready arms on PRs whose inputs did not change.

Why a new column, and why it has no default
-------------------------------------------
``updated_at`` keeps its meaning, because other coord readers rely on it as the
write stamp (the heal arms' age bound, the stale-check throttle, "last heard
anything"). ``changed_at`` is the separate CHANGE stamp ``NewerInputs`` will key
on. coord's writer (Phase 3b) sets it on insert and, on conflict, moves it only
when a decision input differs; the read becomes ``COALESCE(changed_at,
updated_at)``.

It is nullable with NO default on purpose. A ``DEFAULT now()`` would stamp every
existing row at migration time and turn the whole open population into
``NewerInputs`` at once. A NULL reads as ``updated_at``, which is what the row
reads as today, so landing this revision changes no decision.

The upgrade
-----------
PostgreSQL expands ``SELECT *`` at view-creation time, so a column added to the
base table afterwards is invisible through ``coord.pr_check_runs_latest`` until
the view is re-executed. In one transaction of its own:

* ``LOCK TABLE coord.pr_check_runs_latest, coord.pr_check_runs IN ACCESS
  EXCLUSIVE MODE`` first: view, then table, the order a reader of the view takes
  them in. ``prcheckruns_suite_01``'s module docs ("The lock") give the deadlock
  this avoids and the one shape it cannot.
* ``ALTER TABLE ... ADD COLUMN IF NOT EXISTS changed_at timestamptz NULL`` and its
  ``COMMENT``.
* The view re-executed from ``_LATEST_VIEW_CONCLUSIVE_FIRST``, byte-identical to
  the constant ``prcheckruns_latest_03_conclusive_first`` defines (no newer
  revision redefines the view's SELECT). ``CREATE OR REPLACE`` is legal because
  the column is APPENDED, and it keeps the view's oid, owner and grants.
* ``ALTER VIEW ... SET (security_invoker = true)``, because ``CREATE OR REPLACE
  VIEW`` resets the option ``coordrls_01`` set; without it the view becomes an
  owner-rights view again, an RLS bypass
  (``tests/test_coord_views_security_invoker.py``).

It runs in an ``autocommit_block`` under ``SET LOCAL lock_timeout = '3s'``,
because ``alembic/env.py`` runs a deploy batch in one transaction and would
otherwise hold the table's ``AccessExclusiveLock`` until the batch commits. Every
statement is idempotent, so a retry after a lock timeout is safe.

Downgrade
---------
``prcheckruns_suite_01``'s, with the column swapped: in one transaction, record
the view's owner and ACL, drop the view, drop the column, re-create the view,
set ``security_invoker``, give the view back to its recorded owner, strip what
default privileges handed the re-create, and replay the recorded grants. The
approximations that revision's docs list (a non-owner grantor, a NULL ACL, a
narrowed owner, column-level grants) apply unchanged. ``DROP COLUMN`` lives only
inside ``downgrade()`` for ``coord-column-drop-guard``.

Landing
-------
coord's migration classifier rejects ``CREATE OR REPLACE VIEW`` and the explicit
``BEGIN`` / ``COMMIT``, so the PR is escalate-path-matched, as
``prcheckruns_suite_01`` was.

Chains off the single head at authoring (``agent_status_intent_globs_declared_01``,
``alembic heads`` printing one head). If another revision lands first, this one
re-points its ``down_revision``, never ``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_changed_at_01"
down_revision: str | Sequence[str] | None = "agent_status_intent_globs_declared_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Verbatim from prcheckruns_latest_03_conclusive_first.py (which
# prcheckruns_base_sha_01 also re-executes verbatim). The SELECT does not change
# in either direction: the upgrade re-executes it so `*` re-expands over
# `changed_at`; the downgrade re-executes it after the column is gone so `*`
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
    """Add ``changed_at`` and re-expand ``pr_check_runs_latest`` over it."""
    with op.get_context().autocommit_block():
        op.execute(
            _one_transaction(
                """
                ALTER TABLE coord.pr_check_runs
                    ADD COLUMN IF NOT EXISTS changed_at timestamptz NULL
                """,
                """
                COMMENT ON COLUMN coord.pr_check_runs.changed_at IS
                    'When this check row last CHANGED in a way a merge decision '
                    'reads, as opposed to updated_at, the write stamp every '
                    'redelivery and re-read moves. Set on insert and moved on '
                    'conflict only when a decision input differs. NULL is a row no '
                    'change has been stamped on since this column was added: read '
                    'COALESCE(changed_at, updated_at). No default on purpose, '
                    'because now() would stamp every existing row at migration '
                    'time and make the whole open PR population read as having '
                    'newer inputs at once.'
                """,
                _LATEST_VIEW_CONCLUSIVE_FIRST,
                _SECURITY_INVOKER,
            )
        )


def downgrade() -> None:
    """Drop ``changed_at``; restore the view's projection, options, owner and
    grants (approximately for the shapes the module docs list)."""
    with op.get_context().autocommit_block():
        op.execute(
            _one_transaction(
                # The owner and grants DROP VIEW is about to discard, kept for the
                # restore.
                """
                CREATE TEMP TABLE prcheckruns_changed_at_01_view_acl ON COMMIT DROP AS
                    SELECT c.relowner, c.relacl
                      FROM pg_class c
                     WHERE c.oid = 'coord.pr_check_runs_latest'::regclass
                """,
                # The view's stored projection names changed_at, so it goes
                # first; CREATE OR REPLACE cannot narrow a view.
                "DROP VIEW IF EXISTS coord.pr_check_runs_latest",
                "ALTER TABLE coord.pr_check_runs DROP COLUMN IF EXISTS changed_at",
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
                    SELECT s.relowner INTO owner_oid FROM prcheckruns_changed_at_01_view_acl s;
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
                          FROM prcheckruns_changed_at_01_view_acl s, aclexplode(s.relacl) a
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
