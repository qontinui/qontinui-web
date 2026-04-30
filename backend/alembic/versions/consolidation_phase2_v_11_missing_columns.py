"""consolidation phase2 v_11 add missing canonical columns

Revision ID: consolidation_phase2_v_11_missing_columns
Revises: consolidation_phase2_v_10_drift_repair_v2
Create Date: 2026-04-29

Phase 2, v11: add ``cache_creation_tokens`` / ``cache_read_tokens`` to
``project.phase_token_usage`` and ``cost_efficiency_signal`` to
``project.step_credit_assignments``.

Source: ``mod.rs:580-606``.

On fresh canonical DB: NO-OP. Phase 1 batch 3 created
``phase_token_usage`` with both cache_*_tokens columns; Phase 1 batch
20 created ``step_credit_assignments`` with cost_efficiency_signal.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_11_missing_columns"
down_revision: str = "consolidation_phase2_v_10_drift_repair_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = current_schema()
                         AND table_name = 'phase_token_usage') THEN
                ALTER TABLE phase_token_usage ADD COLUMN IF NOT EXISTS cache_creation_tokens BIGINT;
                ALTER TABLE phase_token_usage ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT;
            END IF;
        END $$;
        ALTER TABLE step_credit_assignments ADD COLUMN IF NOT EXISTS cost_efficiency_signal DOUBLE PRECISION;
        """
    )


def downgrade() -> None:
    pass
