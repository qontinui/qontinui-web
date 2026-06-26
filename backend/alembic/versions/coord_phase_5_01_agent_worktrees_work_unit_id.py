"""coord phase 5 01 agent_worktrees work_unit_id

Revision ID: coord_phase_5_01_agent_worktrees_work_unit_id
Revises: shadowreap01
Create Date: 2026-06-26

Phase 5 of the shepherd-sweep refactor (unlandable PR lifecycle).
Adds ``coord.agent_worktrees.work_unit_id`` — FK to coord.work_units,
enabling shepherd spawns to link worktrees back to their governing
work-unit (shepherd-qontinui-web-123, etc.).

This column enables the shepherd to:
1. Upsert a work-unit at spawn time
2. Link all spawned worktrees to that work-unit
3. Display work-unit metadata in dashboards + agent logs
4. Cancel all worktrees under a work-unit when the PR is abandoned

Columns added:

* ``work_unit_id`` — UUID FK to ``coord.work_units.id``. Nullable
  because pre-Phase-5 allocations have no work-unit; new shepherd
  spawns always populate it. Separately indexed for fast filtering
  by work-unit.

Indexes:

* ``idx_agent_worktrees_work_unit_id`` — covers "all worktrees for
  this work-unit" queries. Partial index (``WHERE work_unit_id IS
  NOT NULL``) to avoid bloating the index with null rows.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_phase_5_01_agent_worktrees_work_unit_id"
down_revision: str = "shadowreap01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add work_unit_id column with FK to coord.work_units
    op.add_column(
        "agent_worktrees",
        sa.Column(
            "work_unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.work_units.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="coord",
    )

    # Create index for fast lookup by work_unit_id
    op.create_index(
        "idx_agent_worktrees_work_unit_id",
        "agent_worktrees",
        ["work_unit_id"],
        schema="coord",
        postgresql_where=sa.text("work_unit_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "idx_agent_worktrees_work_unit_id",
        schema="coord",
    )
    op.drop_column("agent_worktrees", "work_unit_id", schema="coord")
