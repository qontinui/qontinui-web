"""coord.agent_sessions / coord.agent_worktrees: hash indexes for the subprojects same-anchor read

Revision ID: coord_subprojects_04_same_anchor_indexes
Revises: coord_subprojects_03_lineage_vocabulary
Create Date: 2026-11-17

A perf follow-up to plan
``2026-11-16-subproject-lineage-recovers-orphaned-continuations-rehomes-orphans-titles-from-evidence``
(rule 3b arm (ii)). coord's correctness does not depend on it.

The read
========

qontinui-coord ``subprojects::store::SAME_ANCHOR_SQL`` gathers the candidate
sessions carrying an anchor (``claim:pr:<repo>#<n>`` / ``unit:<wu>:<phase>``)
from two arms::

    SELECT w.agent_session_id FROM coord.agent_worktrees w
     WHERE w.tenant_id = $1 AND w.agent_session_id IS NOT NULL
       AND w.intent = ANY($2::text[])
    UNION
    SELECT a.id FROM coord.agent_sessions a
     WHERE a.label = ANY($3::text[])
       AND (EXISTS (... coord.sessions s WHERE s.tenant_id = $1 ...)
         OR EXISTS (... coord.subproject_members m WHERE m.tenant_id = $1 ...))

Neither ``agent_worktrees.intent`` nor ``agent_sessions.label`` is indexed, so
every anchored gather is two sequential scans. Both predicates are EQUALITY
against a parameter array (``= ANY``) — no ``LIKE`` — so no ``text_pattern_ops``
is needed and any equality-capable index serves them.

Why HASH, not btree
===================

The obvious DDL is a btree on ``(label)`` and on ``(tenant_id, intent)``. It is
not used here because both columns are unbounded free text written raw from the
client: ``agent_worktrees.intent`` is the full, un-slugified allocation intent
(``POST /agents/allocate`` stores it as sent; coord caps only the derived branch
slug), and ``agent_sessions.label`` has no length bound either. A btree entry
must fit in about a third of a page (2704 bytes after inline compression), and
Postgres REFUSES the INSERT/UPDATE whose value does not fit ("index row size
exceeds btree version 4 maximum"). A btree here would turn one verbose
allocation intent from "not matched by an anchor" into "allocate fails" — the
read-speed index would become a write-correctness dependency, which is exactly
what this follow-up must not be. The same limit would also fail the
``CREATE INDEX`` itself against any existing long value, leaving an INVALID
index behind.

A hash index stores the 32-bit hash, not the value, so it has no such limit, and
it serves exactly the operator these arms use. ``= ANY(array)`` on a hash index
is served only by a Bitmap Index Scan: the hash AM does not take arrays
natively (no ``amsearcharray``), so the executor iterates the array keys inside
that ONE bitmap index scan node, probing once per element — a handful of probes
per gather. There is no planner-level OR of separate scans.
Hash indexes are WAL-logged and crash-safe since PostgreSQL 10. They hold no
NULL keys, so a ``<col> IS NOT NULL`` predicate would add nothing.

Shape of each index
===================

``idx_agent_sessions_label`` — ``HASH (label)``, not partial. The
``agent_sessions`` arm carries no tenant predicate on ``agent_sessions`` itself
(the table has no ``tenant_id``; tenancy is proven by the two ``EXISTS``), so the
key is ``label`` alone.

``idx_agent_worktrees_session_intent`` — ``HASH (intent) WHERE agent_session_id
IS NOT NULL``. A hash index has one key column, so ``tenant_id`` cannot lead
it; it stays a heap filter on the few rows whose intent equals an anchor string,
and an anchor names a repo and PR or unit, so cross-tenant equal intents are
rare. The predicate is the arm's own ``agent_session_id IS NOT NULL`` conjunct
verbatim, so the planner proves the implication by identity, and allocations no
session ever bound (which the arm can never return) are left out of the index.
The name says ``session_intent`` rather than ``tenant_intent`` because the
tenant is not in the key.

Lock posture
============

Both are built ``CONCURRENTLY`` in an autocommit block (the house idiom —
``coord_subprojects_02_session_reported_index``, ``coord_test_results_idx_01``),
so writes to either table are never blocked by the build (it takes ``SHARE
UPDATE EXCLUSIVE``, which does block other DDL, VACUUM and ANALYZE on the
table). Outside the migration transaction neither ``lock_timeout`` nor
``statement_timeout`` bounds it, and a concurrent build WAITS, with no time
limit, for every transaction in the database whose snapshot is older than the
build's — one connection left idle in transaction anywhere stalls the deploy
while it holds the migration lock. If a deploy hangs here, read
``pg_stat_progress_create_index`` (``phase`` names the wait, e.g. "waiting for
old snapshots") and ``pg_stat_activity`` (``state``, ``xact_start``,
``backend_xmin``) to find the transaction it is waiting on.

No in-migration guards, deliberately — the ``coord_alerts_firstseen_01`` /
``coord_iops_idx_01`` reasoning. coord's migration classifier
(``pr_merge/migration_classifier.rs``) is fail-closed: it rejects a read through
``op.get_bind().execute`` and any ``DROP`` on the upgrade path, so a revision
that probes for and drops an INVALID leftover is held off the auto-land path.
And a re-run cannot repair one: a killed build raises out of ``upgrade()`` so
the revision is not stamped, but the retry then SKIPS the INVALID index through
``IF NOT EXISTS`` and stamps the revision, after which this revision never runs
again. The hazard is therefore handled AFTER the deploy, by a check that must be
run and recorded::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname IN ('idx_agent_sessions_label',
                         'idx_agent_worktrees_session_intent');

It must return BOTH rows, each with ``indisvalid = true``. An INVALID index
never serves a query but is still maintained by every write to its table. The
recovery is a FOLLOW-UP revision that runs ``DROP INDEX CONCURRENTLY IF EXISTS
coord.<name>`` for each invalid index and then this revision's CREATE again,
once ``pg_stat_progress_create_index`` shows no build on the table. Never a
plain ``DROP INDEX``, and never a manual drop followed by "re-run" — the
revision is already stamped. That follow-up carries a DROP on its upgrade path,
which coord's migration classifier rejects for auto-land (the rule cited above),
so it is held ``escalate-path-matched`` until cleared on evidence
(``coord_submit_escalate_evidence``: the Migration Reversal Gate green at the
head, one migration file) rather than fast-landing. The
indexes only speed a read, so until then the read is slow rather than wrong.

Two-repo ordering: no coord code names either index; the planner picks them up
on its own, so this lands in either order relative to any coord change.

Hand-authored; ``alembic revision --autogenerate`` was not run (served policy
``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_subprojects_04_same_anchor_indexes"
down_revision = "coord_subprojects_03_lineage_vocabulary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Expand: the two hash indexes, built CONCURRENTLY outside the transaction."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_sessions_label
                ON coord.agent_sessions USING hash (label)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_worktrees_session_intent
                ON coord.agent_worktrees USING hash (intent)
                WHERE agent_session_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Contract: drop both indexes. Nothing else depends on them."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_worktrees_session_intent"
        )
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_sessions_label")
