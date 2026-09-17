"""Remember every slug a tenant has been renamed away from.

Phase A.1 of plan ``2026-09-17-tenant-rename`` (design decision D3).

WHY THIS EXISTS
---------------
No foreign key references ``coord.tenants(slug)``: every slug relationship in
coord is a plain text column (``coord.group_tenant_roles.tenant_slug``, the
``COORD_SSO_BOOTSTRAP_GROUP_MAPPINGS`` env, ``<slug>-home`` Cognito groups).
A rename that only cascades the rows it can see in its own transaction does
not close the **tenant split**:

* ``auth_sso::lookup_or_provision_operator`` resolves a home slug and then
  runs a separate ``INSERT INTO coord.tenants … ON CONFLICT (slug) DO UPDATE``
  outside any transaction, and
* ``reconcile_group_memberships`` reads a mapping's slug, then
  ``SELECT … WHERE slug = $1`` under READ COMMITTED before auto-creating.

A rename committing between those two steps mints a brand-new tenant under the
OLD slug and re-homes operators into it. A ``FOR UPDATE`` on the renamed row
cannot block an insert of a different slug, so the only robust fix is for the
old slug to stay *known*: coord's slug-materialising paths consult this table
and never insert a slug found here (Phase B), and a stale mapping or home group
that still names the old slug resolves onto the renamed tenant instead.

The table is also the undo key for a rename: ``(old_slug, tenant_id)`` names
exactly which row moved, which is how
``coord_system_tenant_rename_qontinui``'s downgrade finds the row it renamed.

SHAPE
-----
``old_slug`` is the PRIMARY KEY because a slug can be remembered for at most
one tenant — a slug in history for another tenant will be
refused as ``historical_slug`` by the rename route (Phase B). ``ON DELETE CASCADE`` because a
deleted tenant's retired names are no longer anyone's to protect. The
``tenant_id`` index serves "every former slug of this tenant" and the cascade.

ORDERING
--------
alembic is the sole author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); hand-authored, never
``--autogenerate``d. This migration MUST be deployed before the coord build
that reads ``coord.tenant_slug_history`` merges (the 2026-07-13
missing-column incident). Every statement names the ``coord`` schema (the
``forbid-public-schema`` check) and is idempotent (``IF NOT EXISTS``), so it is
collision-safe against a canonical Postgres that already carries the table.

Revision ID: coord_tenant_slug_history
Revises: findings_triage_01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_tenant_slug_history"
down_revision: str | Sequence[str] | None = "findings_triage_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.tenant_slug_history`` and its ``tenant_id`` index."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_slug_history (
            old_slug    TEXT PRIMARY KEY,
            tenant_id   UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            renamed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            renamed_by  TEXT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tenant_slug_history_tenant_id
            ON coord.tenant_slug_history (tenant_id)
        """
    )


def downgrade() -> None:
    """Drop the table (its index goes with it). Forgets every recorded rename."""
    op.execute("DROP INDEX IF EXISTS coord.idx_tenant_slug_history_tenant_id")
    op.execute("DROP TABLE IF EXISTS coord.tenant_slug_history")
