"""consolidation phase2 v_16 breakpoint_snapshots

Revision ID: consolidation_phase2_v_16_breakpoint_snapshots
Revises: consolidation_phase2_v_15_runner_instances
Create Date: 2026-04-29

Phase 2, v16: create ``project.breakpoint_snapshots`` (step-level
debugging snapshots).

Source: ``mod.rs:748-770``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_16_breakpoint_snapshots"
down_revision: str = "consolidation_phase2_v_15_runner_instances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS breakpoint_snapshots (
            id                  TEXT PRIMARY KEY,
            execution_id        TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
            step_index          INTEGER NOT NULL,
            step_name           TEXT,
            phase               TEXT,
            iteration           INTEGER,
            variables_json      TEXT NOT NULL,
            last_screenshot_ref TEXT,
            pending_steps_json  TEXT NOT NULL,
            freshness_ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status              TEXT NOT NULL DEFAULT 'waiting',
            resumed_at          TIMESTAMPTZ,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_bps_execution ON breakpoint_snapshots(execution_id);
        CREATE INDEX IF NOT EXISTS idx_bps_status ON breakpoint_snapshots(status);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS breakpoint_snapshots CASCADE")
