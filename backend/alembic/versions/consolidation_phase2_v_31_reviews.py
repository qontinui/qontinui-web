"""consolidation phase2 v_31 reviews (CROSS-SCHEMA: coord)

Revision ID: consolidation_phase2_v_31_reviews
Revises: consolidation_phase2_v_30_productivity_knowledge
Create Date: 2026-04-29

Phase 2, v31: create ``coord.reviews``.

Source: ``mod.rs:1184-1221``.

Targets ``coord`` per schema mapping. FK to ``coord.tasks`` CASCADE.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_31_reviews"
down_revision: str = "consolidation_phase2_v_30_productivity_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.reviews (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id                 UUID NOT NULL REFERENCES coord.tasks(id) ON DELETE CASCADE,
            reviewer_session_id     TEXT NOT NULL,
            reviewed_session_id     TEXT NOT NULL,
            verdict                 TEXT NOT NULL,
            confidence              DOUBLE PRECISION NOT NULL,
            reasoning               TEXT NOT NULL,
            diff_summary            JSONB,
            test_results            JSONB,
            user_decision           TEXT,
            user_decided_at         TIMESTAMPTZ,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_reviews_task
            ON coord.reviews(task_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_session
            ON coord.reviews(reviewed_session_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_verdict
            ON coord.reviews(verdict);
        CREATE INDEX IF NOT EXISTS idx_reviews_pending_recommendations
            ON coord.reviews(created_at DESC)
            WHERE verdict = 'approved'
              AND confidence >= 0.7
              AND confidence < 0.85
              AND user_decision IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.reviews CASCADE")
