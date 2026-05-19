"""coord SSO + RBAC + multi-tenant substrate (Phase 7)

Revision ID: coord_sso_rbac
Revises: coord_memories
Create Date: 2026-05-19

Phase 7 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

Stands up the multi-tenant operator + role substrate per the plan's Q4
resolution (multi-tenant from day 1, not single-tenant-with-upgrade).
Tables:

* ``coord.tenants``         — top-level isolation unit. Slug-keyed so
  it can appear in URL paths once the dashboard gains a tenant
  switcher.
* ``coord.operators``       — human SSO identities. ``(sso_provider,
  sso_subject)`` is the natural key from the IdP. ``tenant_id`` is
  the operator's *home* tenant; cross-tenant access is granted via
  ``coord.operator_roles`` rows in the target tenant.
* ``coord.operator_roles``  — many-to-many ``(operator, tenant, role)``
  triples. Role names are TEXT (not enum) so adding roles is a no-op
  migration. Composite primary key prevents duplicate grants.
* ``coord.operator_audit``  — append-only audit log of operator
  actions. Every mutating endpoint stamps a row here. ``ON DELETE SET
  NULL`` for operator/tenant FKs so audit history survives operator
  deletion (regulatory + forensic posture).
* ``coord.tenant_devices``  — which devices belong to which tenant.
  Composite primary key on ``(tenant_id, device_id)``. The device
  surface (dashboards, claims, agent sessions) will gain tenant
  filtering in a later phase by joining through this table.

Indices:

* ``idx_operators_tenant``           — list operators per tenant.
* ``idx_operator_audit_operator``    — per-operator audit timeline.
* ``idx_operator_audit_recent``      — global "recent operator
  activity" feed for the security/compliance view.

UNIQUE constraints:

* ``coord.tenants.slug``                       — URL-safe.
* ``coord.operators(sso_provider, sso_subject)`` — IdP natural key.

Note on referencing ``coord.devices``: ``coord.devices`` was unified
into the canonical device table by ``ud01_unify_devices_registry``
(2026-05-19; see [[proj_unified_devices_deferred_cutover_2026-05-19]]).
``tenant_devices.device_id`` FKs it directly.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS``. Runtime self-heal posture per
[[feedback_canonical_db_behind_alembic]].

Chains off ``coord_memories`` (Phase 6). This becomes the new
single-head per the alembic single-head invariant gated by
``alembic check``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_sso_rbac"
down_revision: str = "coord_memories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create tenant + operator + role + audit tables. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenants (
            tenant_id      UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            slug           TEXT NOT NULL UNIQUE,
            display_name   TEXT NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operators (
            operator_id     UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            email           TEXT NOT NULL,
            display_name    TEXT,
            sso_subject     TEXT NOT NULL,
            sso_provider    TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_login_at   TIMESTAMPTZ,
            UNIQUE (sso_provider, sso_subject)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_operators_tenant
            ON coord.operators(tenant_id)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_roles (
            operator_id  UUID NOT NULL
                REFERENCES coord.operators(operator_id) ON DELETE CASCADE,
            tenant_id    UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            role         TEXT NOT NULL,
            granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            granted_by   UUID REFERENCES coord.operators(operator_id),
            PRIMARY KEY (operator_id, tenant_id, role)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_audit (
            audit_id       UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            operator_id    UUID REFERENCES coord.operators(operator_id)
                ON DELETE SET NULL,
            tenant_id      UUID REFERENCES coord.tenants(tenant_id)
                ON DELETE SET NULL,
            action         TEXT NOT NULL,
            resource_kind  TEXT,
            resource_key   TEXT,
            metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
            occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_operator_audit_operator
            ON coord.operator_audit(operator_id, occurred_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_operator_audit_recent
            ON coord.operator_audit(occurred_at DESC)
        """
    )
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


def downgrade() -> None:
    """Drop tenant + operator + role + audit tables + indices."""
    op.execute("DROP TABLE IF EXISTS coord.tenant_devices")
    op.execute("DROP INDEX IF EXISTS coord.idx_operator_audit_recent")
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_operator_audit_operator"
    )
    op.execute("DROP TABLE IF EXISTS coord.operator_audit")
    op.execute("DROP TABLE IF EXISTS coord.operator_roles")
    op.execute("DROP INDEX IF EXISTS coord.idx_operators_tenant")
    op.execute("DROP TABLE IF EXISTS coord.operators")
    op.execute("DROP TABLE IF EXISTS coord.tenants")
