"""consolidation phase2 v_22 phase_results

Revision ID: consolidation_phase2_v_22_phase_results
Revises: consolidation_phase2_v_21_compensation_actions
Create Date: 2026-04-29

Phase 2, v22: create ``project.phase_results`` (structured phase-level
persistence for restate-port-part-a).

Source: ``mod.rs:876-898``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_22_phase_results"
down_revision: str = "consolidation_phase2_v_21_compensation_actions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS phase_results (
            id              BIGSERIAL PRIMARY KEY,
            execution_id    TEXT NOT NULL,
            phase           TEXT NOT NULL,
            iteration       INT,
            stage_index     INT,
            success         BOOLEAN NOT NULL,
            all_passed      BOOLEAN NOT NULL,
            duration_ms     BIGINT NOT NULL,
            failure_context TEXT,
            commit_hash     TEXT,
            step_results    JSONB NOT NULL DEFAULT '[]'::jsonb,
            variables_set   JSONB,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_pr_execution ON phase_results(execution_id);
        CREATE INDEX IF NOT EXISTS idx_pr_execution_phase ON phase_results(execution_id, phase, iteration);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS phase_results CASCADE")
