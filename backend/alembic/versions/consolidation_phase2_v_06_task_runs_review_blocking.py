"""consolidation phase2 v_06 task_runs review/blocking columns

Revision ID: consolidation_phase2_v_06_task_runs_review_blocking
Revises: consolidation_phase2_v_05_reasoning_traces_dreamer
Create Date: 2026-04-29

Phase 2, v6: add ``is_review`` / ``blocks_parent`` to
``project.task_runs`` and a partial index for blocking children.

Source: ``mod.rs:219-229``.

On fresh canonical DB: NO-OP. Phase 1 batch 2 already created task_runs
with both columns.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_06_task_runs_review_blocking"
down_revision: str = "consolidation_phase2_v_05_reasoning_traces_dreamer"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS is_review BOOLEAN DEFAULT FALSE;
        ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS blocks_parent BOOLEAN DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_task_runs_blocking_children
            ON task_runs(parent_task_run_id, blocks_parent)
            WHERE blocks_parent = true AND status NOT IN ('complete', 'failed', 'stopped');
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DROP INDEX IF EXISTS idx_task_runs_blocking_children;
        ALTER TABLE task_runs DROP COLUMN IF EXISTS blocks_parent;
        ALTER TABLE task_runs DROP COLUMN IF EXISTS is_review;
        """
    )
