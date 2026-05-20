"""coord devices_tenant_id — add tenant_id to coord.devices + drop tenant_devices

Revision ID: coord_devices_tenant_id
Revises: coord_tenant_scope_columns
Create Date: 2026-05-20

Phase 1 of the default-tenant-propagation rollout
(``D:/qontinui-root/plans/2026-05-20-default-tenant-propagation.md``).

Adds ``coord.devices.tenant_id UUID`` as the single source of truth for the
tenant a device's writes scope to, with an index and a FK to
``coord.tenants(tenant_id)``. Backfills existing devices using a
``user_id → auth.users.email → coord.operators.email → operators.tenant_id``
chain so multi-user staging RDS lands correct rows; falls back to the
bootstrap ``personal-jspinak`` tenant for system devices (``user_id`` NULL
or no matching operator).

Drops ``coord.tenant_devices`` — the m:n linkage shipped by
``coord_sso_rbac`` is over-modeled for the in-scope 1:1 reality. Per
Q1 resolution in the plan: the single denormalized column on
``coord.devices`` is the cleaner authoritative source. Verified at vet
time + here (Grep tenant_devices) that the table has no inbound FKs
and no code-level consumers — only documentation/comment references.

NOT NULL is deliberately deferred — Phase 6 owns that revision after
Phases 2-5 stop the bleeding on new inserts.

Why parented off ``coord_tenant_scope_columns``
-----------------------------------------------
``coord_tenant_scope_columns`` introduced ``tenant_id`` columns on six
sibling data tables + bootstrapped the ``personal-jspinak`` tenant row
that this revision's backfill references. Sitting downstream of it lets
the COALESCE subselect reliably resolve.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_devices_tenant_id"
down_revision: str = "coord_tenant_scope_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Stable identifier for the bootstrap personal tenant (matches
# ``coord_tenant_scope_columns._PERSONAL_SLUG``).
_PERSONAL_SLUG = "personal-jspinak"


def upgrade() -> None:
    """Add ``coord.devices.tenant_id`` + index + smart backfill; drop
    ``coord.tenant_devices``. Idempotent on re-run."""
    # ----------------------------------------------------------------
    # 1. ADD COLUMN IF NOT EXISTS — nullable for now (NOT NULL is
    #    Phase 6 once every downstream surface stamps cleanly).
    #    FK with ON DELETE RESTRICT — a tenant can't be deleted while
    #    devices still scope to it; the operator must reassign first.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS tenant_id UUID
                REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT
        """
    )

    # ----------------------------------------------------------------
    # 2. Index for the per-write tenant-scope lookups Phase 4 will
    #    issue. Non-partial because Phase 6 brings the column to
    #    NOT NULL — no need to exclude NULLs at the index layer.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_devices_tenant_id
            ON coord.devices(tenant_id)
        """
    )

    # ----------------------------------------------------------------
    # 3. Smart backfill.
    #
    # For each existing device, resolve the owning tenant via:
    #   (a) ``user_id → auth.users.email → coord.operators.email →
    #        operators.tenant_id``
    #   (b) Fall back to ``personal-jspinak`` when (a) returns NULL
    #       (system device with no paired user, or operator row missing).
    #
    # Multi-user staging RDS picks up correct per-user assignments
    # without manual intervention; the single-user bootstrap still
    # lands every row under ``personal-jspinak``.
    # ----------------------------------------------------------------
    op.execute(
        f"""
        UPDATE coord.devices d
        SET tenant_id = COALESCE(
            (SELECT o.tenant_id
               FROM coord.operators o
               JOIN auth.users u ON u.email = o.email
              WHERE u.id = d.user_id),
            (SELECT tenant_id FROM coord.tenants WHERE slug = '{_PERSONAL_SLUG}')
        )
        WHERE tenant_id IS NULL
        """
    )

    # ----------------------------------------------------------------
    # 4. Drop coord.tenant_devices.
    #
    # Verified at vet time and at write time (Grep tenant_devices over
    # both qontinui-web/backend and qontinui-coord/src) that there are
    # no inbound FKs and no code-level consumers — only docstring +
    # comment references remain. The m:n shape is over-modeled for the
    # in-scope 1:1 reality; ``coord.devices.tenant_id`` is now the
    # single source of truth.
    # ----------------------------------------------------------------
    op.execute("DROP TABLE IF EXISTS coord.tenant_devices")


def downgrade() -> None:
    """Reverse: drop ``tenant_id`` column + index, re-create
    ``coord.tenant_devices`` per the ``coord_sso_rbac`` shape."""
    op.execute("DROP INDEX IF EXISTS coord.idx_devices_tenant_id")
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS tenant_id")

    # Re-create coord.tenant_devices to match coord_sso_rbac:151-160.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_devices (
            tenant_id  UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            device_id  UUID NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, device_id)
        )
        """
    )
