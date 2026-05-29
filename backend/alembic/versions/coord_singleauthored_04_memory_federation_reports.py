"""coord.memory_federation_reports — migrate single-authored Rust self-heal

Revision ID: coord_singleauthored_04_memory_federation_reports
Revises: coord_singleauthored_03_leader_lease
Create Date: 2026-05-29

Mirrors
``qontinui-coord/src/federation_reports.rs::ensure_federation_reports_table``.

FK ORDERING: ``tenant_id`` references ``coord.tenants(tenant_id)``, an
alembic-owned table created in an earlier revision, so this migration (chained
after it on the linear head) finds the parent present on a fresh DB. Do NOT
reorder this revision ahead of the ``coord.tenants`` migration.
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_04_memory_federation_reports"
down_revision: str | Sequence[str] | None = "coord_singleauthored_03_leader_lease"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memory_federation_reports (
            report_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID REFERENCES coord.tenants(tenant_id),
            device_id      UUID NOT NULL,
            session_id     UUID NOT NULL,
            account_name   TEXT NOT NULL,
            pushed         INT NOT NULL DEFAULT 0,
            pulled         INT NOT NULL DEFAULT 0,
            unchanged      INT NOT NULL DEFAULT 0,
            failed         INT NOT NULL DEFAULT 0,
            failed_names   TEXT[],
            reported_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            metadata       JSONB DEFAULT '{}'
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_mfr_tenant_reported
            ON coord.memory_federation_reports(tenant_id, reported_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_mfr_device_reported
            ON coord.memory_federation_reports(device_id, reported_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_mfr_device_reported")
    op.execute("DROP INDEX IF EXISTS coord.idx_mfr_tenant_reported")
    op.execute("DROP TABLE IF EXISTS coord.memory_federation_reports")
