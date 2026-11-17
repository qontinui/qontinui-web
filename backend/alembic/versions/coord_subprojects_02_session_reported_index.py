"""coord.agent_logs: partial index for the subprojects pruned-harness walk

Revision ID: coord_subprojects_02_session_reported_index
Revises: coord_fleet_focus_01
Create Date: 2026-11-16

Finding ``98e40c0e`` (N3) asked for the plan cost of qontinui-coord
``subprojects::store::PRUNED_HARNESS_SQL`` to be measured on production-sized
data once the subprojects coord deployed. Measured 2026-11-16 against
``coord.agent_logs`` at about 5.2 M rows: ``EXPLAIN (ANALYZE, BUFFERS)`` of the
keyset page (first page, ``LIMIT 100``) took 22.6 s and read about 261 000
buffers, all of it one ``Parallel Seq Scan on agent_logs`` for the arm
``event = 'session_reported' AND agent_session_id IS NOT NULL AND tenant_id IS
NOT NULL``. That arm matches about 1 600 rows. The other three arms (gates,
agent_worktrees, commit_lineage) each took milliseconds. The reconciler runs
this query every 10 ticks, so the scan was the whole cost.

The existing indexes cannot serve it: ``idx_agent_logs_session`` is
``(agent_session_id, occurred_at DESC)`` over every event, and nothing is keyed
on ``event``. A partial index whose predicate is the arm's own predicate makes
the arm an index-only scan over about 1 600 entries.

The index is built ``CONCURRENTLY`` in an autocommit block, the ``twin_10``
idiom for this append-heavy table, so no lock is held across the build. It runs
outside the migration transaction, where no ``lock_timeout`` applies, so a build
that is interrupted can leave an INVALID index that ``IF NOT EXISTS`` then
skips. The index only speeds a read, so an invalid one is slow rather than
wrong. Recovery: ``DROP INDEX CONCURRENTLY
coord.idx_agent_logs_session_reported`` and re-run.

Two-repo ordering: no coord code names this index; the planner picks it up on
its own, so this lands in either order relative to any coord change.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_subprojects_02_session_reported_index"
down_revision = "coord_fleet_focus_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Expand: the partial index, built CONCURRENTLY outside the transaction."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_logs_session_reported
                ON coord.agent_logs (tenant_id, agent_session_id)
                WHERE event = 'session_reported'
                  AND agent_session_id IS NOT NULL
                  AND tenant_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Contract: drop the index. Nothing else depends on it."""
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_logs_session_reported")
