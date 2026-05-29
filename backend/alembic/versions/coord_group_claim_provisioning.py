"""coord SSO group-claim → operator_roles auto-provisioning substrate

Revision ID: coord_group_claim_provisioning
Revises: c5d6e7f8a9b0
Create Date: 2026-05-29

Phase 0 of plan
``D:/qontinui-root/plans/2026-05-29-sso-group-claim-tenant-membership-auto-provisioning.md``.

Stands up the substrate for reconciling ``coord.operator_roles`` against
the IdP's group claim on every SSO login:

* ``coord.group_tenant_roles`` — the declarative ``group → (tenant_slug,
  role)`` mapping, editable without a coord deploy. A single group can
  fan out to N tenants and N roles (same ``group_id`` may appear in
  multiple rows). ``auto_create_tenant`` (default ``TRUE`` per Open Q3 —
  power over robustness, the mapping author owns the typo) lets the
  reconciliation insert the tenant on first use.
* ``coord.operator_membership_sync`` — a per-login audit log of what the
  last reconciliation did (granted / revoked / skipped-unmapped /
  auto-created). One row per login that exercised the sync; idle logins
  (no groups claim, no diff) skip the write.

Sentinel operator: the reconciliation marks claim-driven
``coord.operator_roles`` rows with ``granted_by = <sentinel operator>``
so a later reconciliation only revokes rows it owns — manual admin
grants (``granted_by = <admin operator>``) and the default-role
bootstrap (``granted_by = NULL``) survive. This migration UPSERTs the
sentinel operator with the known natural key
``(sso_provider, sso_subject) = ('', 'system-sync')`` so coord can
resolve its ``operator_id`` at startup. Idempotent on the
``(sso_provider, sso_subject)`` UNIQUE constraint from
``coord_sso_rbac``.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS`` + ``ON CONFLICT DO NOTHING``. Runtime self-heal posture per
[[feedback_canonical_db_behind_alembic]]: the coord-side helper
``auth_sso::ensure_group_claim_substrate`` mirrors these statements so
coord boots cleanly against a PG where this revision hasn't been applied
yet.

Chains off ``c5d6e7f8a9b0`` (add CI runner columns to coord.devices),
the current single head.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_group_claim_provisioning"
down_revision: str = "c5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create mapping + sync-log tables and seed the sentinel. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.group_tenant_roles (
            group_id            TEXT NOT NULL,
            tenant_slug         TEXT NOT NULL,
            role                TEXT NOT NULL,
            auto_create_tenant  BOOLEAN NOT NULL DEFAULT TRUE,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (group_id, tenant_slug, role)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_group_tenant_roles_group
            ON coord.group_tenant_roles(group_id)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_membership_sync (
            sync_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            operator_id          UUID NOT NULL
                REFERENCES coord.operators(operator_id) ON DELETE CASCADE,
            occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            claimed_groups       TEXT[] NOT NULL,
            granted_pairs        JSONB NOT NULL DEFAULT '[]'::jsonb,
            revoked_pairs        JSONB NOT NULL DEFAULT '[]'::jsonb,
            skipped_unmapped     TEXT[] NOT NULL DEFAULT '{}'::text[],
            auto_created_tenants TEXT[] NOT NULL DEFAULT '{}'::text[]
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_operator_membership_sync_operator
            ON coord.operator_membership_sync(operator_id, occurred_at DESC)
        """
    )
    # Seed the claim-sync sentinel operator. Its home tenant is parked on
    # the bootstrap tenant; semantics never depend on which (it is never
    # used as a real operator). Idempotent on (sso_provider, sso_subject).
    op.execute(
        """
        INSERT INTO coord.operators
            (tenant_id, email, display_name, sso_subject, sso_provider)
        SELECT t.tenant_id, 'system-sync@qontinui.local',
               'System Sync', 'system-sync', ''
        FROM coord.tenants t
        WHERE t.slug = 'personal-jspinak'
        ON CONFLICT (sso_provider, sso_subject) DO NOTHING
        """
    )


def downgrade() -> None:
    """Drop the substrate. The sentinel operator row is left in place —
    dropping it would cascade-delete any claim-driven role rows it
    granted, which downgrade should not silently do."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_operator_membership_sync_operator"
    )
    op.execute("DROP TABLE IF EXISTS coord.operator_membership_sync")
    op.execute("DROP INDEX IF EXISTS coord.idx_group_tenant_roles_group")
    op.execute("DROP TABLE IF EXISTS coord.group_tenant_roles")
