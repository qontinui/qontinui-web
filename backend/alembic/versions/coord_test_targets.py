"""coord.test_targets — fleet-fresh test-host designations.

Revision ID: coord_test_targets
Revises: app_deploy_state_tracking
Create Date: 2026-07-02

One row per (device, app) an operator has designated as a test host for
fleet-fresh routing. The runner's auto-fresh engine polls
``GET /coord/trees/test-targets/by-device/{device_id}`` each tick and
refreshes any row with ``auto_fresh = true``; the P4 dispatcher treats the
designation as "this device is allowed to receive test traffic for this app".

Tenant-partitioned like ``coord.primary_trees``: writes are operator-scoped
(TenantId bearer), the device-keyed runner read resolves the tenant
server-side from ``device_id`` (same posture as ``/coord/trees/upsert``).

NOT in coord's ``require_table`` boot gate — best-effort posture like the
``coord.commit_*`` / ``coord.land_*`` tables: coord deployed ahead of this
migration serves an empty designation list rather than refusing to boot.

Raw ``op.execute`` with ``IF NOT EXISTS`` — the collision-safe convention
used by the other coord.* migrations.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_targets"
down_revision: str | None = "app_deploy_state_tracking"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_targets (
            device_id  UUID NOT NULL,
            app_id     TEXT NOT NULL,
            tenant_id  UUID NOT NULL,
            auto_fresh BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (device_id, app_id)
        )
        """
    )
    # Runner poll: WHERE device_id = $1 AND tenant_id = $2 hits the PK's
    # leading column; the tenant index serves operator list/status reads.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_test_targets_tenant "
        "ON coord.test_targets (tenant_id)"
    )
    # P4 dispatcher fan-out: which devices are designated for an app.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_test_targets_app "
        "ON coord.test_targets (app_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.test_targets")
