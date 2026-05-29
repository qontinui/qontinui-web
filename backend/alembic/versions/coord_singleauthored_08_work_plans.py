"""coord.work_plans — migrate single-authored Rust self-heal to alembic

Revision ID: coord_singleauthored_08_work_plans
Revises: coord_singleauthored_07_speculative_chains
Create Date: 2026-05-29

Mirrors ``qontinui-coord/src/work_plans.rs::ensure_work_plans_table``.
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_08_work_plans"
down_revision: str | Sequence[str] | None = "coord_singleauthored_07_speculative_chains"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_plans (
            id                     UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id              UUID NOT NULL,
            intent                 TEXT NOT NULL,
            correlation_topic      TEXT NOT NULL,
            repos                  TEXT[] NOT NULL DEFAULT '{}',
            items                  JSONB NOT NULL DEFAULT '[]'::jsonb,
            notes                  TEXT,
            status                 TEXT NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed', 'approved', 'discarded')),
            materialization        JSONB,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            approved_at            TIMESTAMPTZ,
            PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_plans_tenant_id
            ON coord.work_plans (tenant_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_plans_status
            ON coord.work_plans (status)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_work_plans_status")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_plans_tenant_id")
    op.execute("DROP TABLE IF EXISTS coord.work_plans")
