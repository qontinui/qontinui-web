"""consolidation phase2 v_26 meta_optimizer_snapshots.runs_included BIGINT

Revision ID: consolidation_phase2_v_26_runs_included_bigint
Revises: consolidation_phase2_v_25_invalidation_token
Create Date: 2026-04-29

Phase 2, v26: cast ``meta_optimizer_snapshots.runs_included`` from
INT4 to BIGINT (Rust reads as i64; INT4 caused tokio panics).

Source: ``mod.rs:967-980``.

On fresh canonical DB: NO-OP. Phase 1 batch 16 created
``meta_optimizer_snapshots.runs_included`` as ``BigInteger`` (BIGINT)
already. Wrapped in idempotency guard so the cast doesn't fail when
the column is already INT8.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_26_runs_included_bigint"
down_revision: str = "consolidation_phase2_v_25_invalidation_token"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'meta_optimizer_snapshots'
                  AND column_name = 'runs_included'
                  AND data_type = 'integer'
            ) THEN
                ALTER TABLE meta_optimizer_snapshots
                    ALTER COLUMN runs_included TYPE BIGINT USING runs_included::bigint;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    pass
