"""consolidation phase2 v_25 co_occurrence_observations.invalidation_token

Revision ID: consolidation_phase2_v_25_invalidation_token
Revises: consolidation_phase2_v_24_co_occurrence
Create Date: 2026-04-29

Phase 2, v25: add ``invalidation_token`` column to
``co_occurrence_observations`` for undo tracking.

Source: ``mod.rs:956-966``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 already includes
``invalidation_token`` and the partial index.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_25_invalidation_token"
down_revision: str = "consolidation_phase2_v_24_co_occurrence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE co_occurrence_observations
            ADD COLUMN IF NOT EXISTS invalidation_token TEXT;
        CREATE INDEX IF NOT EXISTS idx_observations_invalidation_token
            ON co_occurrence_observations (invalidation_token)
            WHERE invalidation_token IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DROP INDEX IF EXISTS idx_observations_invalidation_token;
        ALTER TABLE co_occurrence_observations DROP COLUMN IF EXISTS invalidation_token;
        """
    )
