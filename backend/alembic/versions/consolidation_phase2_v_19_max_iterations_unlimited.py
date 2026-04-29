"""consolidation phase2 v_19 max_iterations unlimited (NULL) backfill

Revision ID: consolidation_phase2_v_19_max_iterations_unlimited
Revises: consolidation_phase2_v_18_workflow_event_log
Create Date: 2026-04-29

Phase 2, v19: drop ``max_iterations`` default; backfill 0/1 → NULL.

Source: ``mod.rs:796-815``.

NULL means "unlimited" (translated to u32::MAX at LoopConfig boundary).
Previously the column defaulted to 10 (or 1 from buggy generators), so
many AI-generated workflows died after a single verification attempt.

On fresh canonical DB: ALTER COLUMN DROP DEFAULT is a no-op if no
default exists. Phase 1 batch 4 created max_iterations as nullable
BIGINT with no default. UPDATE on rows with values <= 1 is a no-op
on a fresh DB (no rows exist).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_19_max_iterations_unlimited"
down_revision: str = "consolidation_phase2_v_18_workflow_event_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE unified_workflows ALTER COLUMN max_iterations DROP DEFAULT;
        UPDATE unified_workflows SET max_iterations = NULL WHERE max_iterations IS NOT NULL AND max_iterations <= 1;
        """
    )


def downgrade() -> None:
    pass
