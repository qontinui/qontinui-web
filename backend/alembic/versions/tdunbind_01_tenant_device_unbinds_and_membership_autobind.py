"""coord: tenant_device_unbinds tombstones and devices.membership_autobind

Revision ID: tdunbind_01
Revises: overlord_02_four_class_vocabulary
Create Date: 2026-10-18

Phase 1 of plan ``2026-10-17-runner-credential-for-every-account-tenant``.
Web FIRST: coord authors zero DDL (``[policy: alembic-sole-authorship]``; the
coord-schema freeze of plan
``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord`` Phase 6
has not landed), and the coord doors that read these objects ship in the
plan's Phases 3 and 4, each degrading fail-closed while the object is missing.

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time. If
another revision lands ahead of this one, re-point it at the new head; do NOT
author an ``alembic merge`` revision.

What changes
============

* ``coord.tenant_device_unbinds`` (design decision D6): one row per
  ``(tenant_id, device_id)`` a binding was removed from on purpose, so a
  later unattended pass does not re-create it. ``reason`` says whose purpose:
  ``operator_unbind`` (written by ``DELETE /coord/devices/:id/tenant-binding``
  in the same transaction as the unbind; ``unbound_by_operator_id`` is that
  operator) or ``owner_declined`` (a tenant the device owner left unticked at
  sign-in; ``unbound_by_operator_id`` is NULL). The consent door and
  ``all_memberships`` skip a tombstoned tenant. An explicit attended
  ``tenant_ids`` naming it re-binds it and deletes the row.
  ``unbound_by_operator_id`` is a soft pointer (no FK), matching
  ``coord.tenant_devices.paired_by_user_id``: attribution must not block on
  the user lifecycle. Both FKs cascade, so a deleted tenant or device takes
  its tombstones with it. The device-side index serves the per-device skip
  read, which walks the primary key backwards.
* ``coord.devices.membership_autobind`` (design decision D2): the standing
  consent for the unattended bind. ``created`` (the default, applied to every
  existing device) lets it bind tenants the device owner created; ``off``
  disables it for the device.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "tdunbind_01"
down_revision: str | Sequence[str] | None = "overlord_02_four_class_vocabulary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.tenant_device_unbinds and add coord.devices.membership_autobind."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_device_unbinds (
            tenant_id              UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            device_id              UUID        NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            unbound_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            unbound_by_operator_id UUID        NULL,
            reason                 TEXT        NOT NULL DEFAULT 'operator_unbind',
            CONSTRAINT tenant_device_unbinds_pkey PRIMARY KEY (tenant_id, device_id),
            CONSTRAINT ck_tenant_device_unbinds_reason
                CHECK (reason IN ('operator_unbind', 'owner_declined'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_tenant_device_unbinds_device
            ON coord.tenant_device_unbinds (device_id)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.tenant_device_unbinds IS
            'Sticky tenant-binding removals. A row means the binding of this device to this tenant was removed on purpose, so the unattended consent door and pair-cli all_memberships skip the tenant; only an explicit attended tenant_ids naming it re-binds it and deletes the row. Plan 2026-10-17-runner-credential-for-every-account-tenant, D6.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_device_unbinds.reason IS
            'operator_unbind = an operator removed the binding (unbound_by_operator_id names them); owner_declined = the device owner left the tenant unticked at sign-in (unbound_by_operator_id is NULL).'
        """
    )

    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS membership_autobind TEXT NOT NULL DEFAULT 'created'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS ck_devices_membership_autobind
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD CONSTRAINT ck_devices_membership_autobind
            CHECK (membership_autobind IN ('created', 'off'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.devices.membership_autobind IS
            'Standing consent for the unattended membership bind. created = it may bind tenants the device owner created; off = it binds nothing for this device. Plan 2026-10-17-runner-credential-for-every-account-tenant, D2.'
        """
    )


def downgrade() -> None:
    """Drop coord.devices.membership_autobind and coord.tenant_device_unbinds."""
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS ck_devices_membership_autobind
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP COLUMN IF EXISTS membership_autobind
        """
    )
    op.execute("DROP INDEX IF EXISTS coord.ix_tenant_device_unbinds_device")
    op.execute("DROP TABLE IF EXISTS coord.tenant_device_unbinds")
