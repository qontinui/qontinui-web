"""consolidation phase2 v_03 contradiction_resolutions

Revision ID: consolidation_phase2_v_03_contradiction_resolutions
Revises: consolidation_phase2_v_02_mcp_columns
Create Date: 2026-04-29

Phase 2, v3: create ``project.contradiction_resolutions`` table.

Source: ``mod.rs:133-155``. Honcho-inspired contradiction handling
(observation A vs observation B with winner/loser annotation).

On fresh canonical DB: NO-OP. Phase 1 batch 20 already created
``project.contradiction_resolutions`` with the same shape. ``CREATE
TABLE IF NOT EXISTS`` is idempotent.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_03_contradiction_resolutions"
down_revision: str = "consolidation_phase2_v_02_mcp_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS contradiction_resolutions (
            id BIGSERIAL PRIMARY KEY,
            observation_a_id BIGINT NOT NULL REFERENCES observations(id),
            observation_b_id BIGINT NOT NULL REFERENCES observations(id),
            resolution_type TEXT NOT NULL,
            winner_id BIGINT REFERENCES observations(id),
            loser_id BIGINT REFERENCES observations(id),
            confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            rationale TEXT NOT NULL,
            evidence_json TEXT,
            resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_by TEXT NOT NULL DEFAULT 'system',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_cr_obs_a ON contradiction_resolutions(observation_a_id);
        CREATE INDEX IF NOT EXISTS idx_cr_obs_b ON contradiction_resolutions(observation_b_id);
        CREATE INDEX IF NOT EXISTS idx_cr_resolved ON contradiction_resolutions(resolved_at);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS contradiction_resolutions CASCADE")
