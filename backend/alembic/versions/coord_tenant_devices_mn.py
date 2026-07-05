"""coord tenant_devices — m:n tenant<->device binding table + backfill

Revision ID: coord_tenant_devices_mn
Revises: coord_consistent_snapshots_01
Create Date: 2026-07-02

Phase 2 of the session-scoped multi-tenant device-binding rollout
(``D:/qontinui-root/plans/2026-07-02-session-scoped-multi-tenant-device-binding.md``,
Option A — full concurrent).

Re-introduces ``coord.tenant_devices`` (dropped by
``coord_devices_tenant_id`` back when the 1:1 reality made the m:n
shape over-modeled) as the authoritative binding set: one runner
device serves N tenants concurrently, tenancy is SESSION-scoped, and
pairing becomes additive (plan Phase 3). Compared to the original
``coord_sso_rbac`` shape (``added_at`` only) this adds
``paired_by_user_id`` (who created the binding) and
``last_active_at`` (per-binding heartbeat touch, plan D3).

Backfill: every existing device starts with exactly one binding — its
current ``coord.devices.tenant_id`` pointer — so binding count ==
device count and there is zero behavior change while the table stays
dark (coord reads land in plan Phase 2 item 4 with the fail-safe
missing-table posture; writes start at Phase 3's additive pairing).

``coord.devices.tenant_id`` is NOT touched here — it remains
dual-written through Phases 3-9 and is deleted in Phase 10.

Forward-only + additive (a new table + backfill) — safe for a running
app on the prior schema. Idempotent on re-run (IF NOT EXISTS /
ON CONFLICT DO NOTHING).

``down_revision`` chains off the local head
(``devenv_03_coord_device_bridge``); coord's migration-reserve
confirmed position 1 (reservation
``6bdd347f-586a-4e0c-8b67-a2ca685ded00``) — no stacked sibling.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_tenant_devices_mn"
down_revision: str = "coord_consistent_snapshots_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.tenant_devices`` + device-keyed index + backfill
    one binding per existing device from ``coord.devices.tenant_id``."""
    # ----------------------------------------------------------------
    # 1. The m:n binding table. PK (tenant_id, device_id) — one row per
    #    binding; the same device may appear under N tenants.
    #    ``paired_by_user_id`` is a soft pointer (no FK): pairing
    #    attribution must not block on auth.users lifecycle, matching
    #    the nullable ``coord.devices.user_id`` it is backfilled from.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_devices (
            tenant_id         UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            device_id         UUID NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            paired_by_user_id UUID NULL,
            paired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_active_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, device_id)
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. Device-keyed lookups (bindings_for_device / sole_binding /
    #    the D2 resolution helpers) walk the PK backwards — index the
    #    device side.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tenant_devices_device
            ON coord.tenant_devices (device_id)
        """
    )

    # ----------------------------------------------------------------
    # 3. Backfill: one binding per device from the legacy 1:1 pointer.
    #    ``tenant_id`` is NOT NULL on coord.devices today, but guard
    #    anyway — a NULL row would otherwise fail the INSERT's own
    #    NOT NULL. COALESCE is required: ``paired_at`` is nullable on
    #    coord.devices (system devices never paired).
    # ----------------------------------------------------------------
    op.execute(
        """
        INSERT INTO coord.tenant_devices
            (tenant_id, device_id, paired_by_user_id, paired_at)
        SELECT tenant_id, device_id, user_id, COALESCE(paired_at, now())
          FROM coord.devices
         WHERE tenant_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    """Reverse: drop the binding table (index goes with it)."""
    op.execute("DROP TABLE IF EXISTS coord.tenant_devices")
