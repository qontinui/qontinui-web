"""coord.work_unit_status_history: index the (unit, status, time) lookup

Revision ID: coord_workunits_05_status_history_lookup
Revises: coord_sessions_tool_activity
Create Date: 2026-08-20

Plan
``D:/qontinui-root/plans/2026-08-20-coord-work-unit-lifecycle-timestamps-and-slug-exclusion.md``
Phase 4.

coord's work-unit list is gaining two derived columns — the FIRST transition
into ``in_progress`` and the FIRST transition into ``shipped`` — so the Plans
console can show when a unit started and when it shipped. Neither is a stored
column; both are ``LEFT JOIN LATERAL (… ORDER BY transitioned_at ASC LIMIT 1)``
against ``coord.work_unit_status_history``, evaluated once per row of a page up
to 500 wide.

``coord_workunits_01_work_units`` indexed that table on ``(work_unit_id)``
alone. That index alone makes each LATERAL fetch every history row for the unit
and then filter + sort it, and the history is not small: sampled 2026-08-20,
shipped units carry **35-70** transitions each (the markdown adapter re-stamps
a unit to ``in_progress`` and coord's derive worker re-derives ``shipped``, so
units genuinely oscillate). This index carries the equality columns first and
``transitioned_at`` last, so each LATERAL becomes an index range scan whose
first row IS the answer to ``ORDER BY transitioned_at ASC LIMIT 1``.

**This is a performance change only.** The Phase-1 query is CORRECT without it,
so this revision imposes NO migration-before-deploy ordering gate — unlike a
new *column* read by coord, which would (``coord_reads_new_column_without_web_migration``).
Landing it first is still preferred, simply so the query is never slow in prod.

alembic is the sole author of ``coord.*`` schema: coord's Rust side only DMLs
against these tables (``crates/coord/tests/coord_schema_authorship.rs`` enforces
that it authors no DDL), which is why an index needed by a Rust query lives in
this repo.

Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_workunits_05_status_history_lookup"
down_revision: str | Sequence[str] | None = "coord_sessions_tool_activity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the (work_unit_id, to_status, transitioned_at) index. Idempotent.

    Column order is load-bearing: two equality predicates first, then the sort
    key, so ``ORDER BY transitioned_at ASC LIMIT 1`` is answered by the first
    entry of the range rather than by a sort.
    """
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_wush_unit_status_time
            ON coord.work_unit_status_history(
                work_unit_id, to_status, transitioned_at
            )
        """
    )


def downgrade() -> None:
    """Drop the index. The older ``(work_unit_id)`` index is left alone —
    it predates this revision and other reads still use it."""
    op.execute("DROP INDEX IF EXISTS coord.idx_wush_unit_status_time")
