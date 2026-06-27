"""tgha 01 — zero-touch repo onboarding account/installation mapping tables

Revision ID: tgha01_tenant_github_accounts
Revises: shadowreap01
Create Date: 2026-06-26

Zero-touch repo onboarding for the PR Merge Orchestrator. The GitHub App
installation webhook never creates a tenant — it RESOLVES an existing tenant
through ``coord.tenant_github_accounts`` (account login / installation id ->
tenant). An installation whose account is not yet mapped to any tenant is
parked in ``coord.pending_installations`` so it can be claimed later.

Tables added (both under the ``coord`` schema, both idempotent
``CREATE TABLE IF NOT EXISTS``):

1. ``coord.tenant_github_accounts`` — maps one GitHub account/installation to
   exactly one EXISTING coord tenant. ``UNIQUE(account_login)`` and
   ``UNIQUE(installation_id)`` enforce the one-account / one-installation ->
   one-tenant invariant. FK to ``coord.tenants(tenant_id)`` ON DELETE CASCADE,
   matching the ``coord.tenant_repos`` posture (a mapping row has no meaning
   once its tenant is gone).

2. ``coord.pending_installations`` — an App installation whose account is NOT
   yet mapped to any tenant. The webhook writes here instead of creating a
   tenant; ``claimed_at`` is set once the install is claimed by a tenant.
   ``UNIQUE(installation_id)`` so a re-delivered install event upserts rather
   than duplicates.

Conventions mirror ``pr_merge_02_tenant_settings`` /
``pr_merge_03_pr_dependencies``:

* Raw ``op.execute`` DDL, ``CREATE TABLE IF NOT EXISTS coord.<table>``.
* ``UUID PRIMARY KEY DEFAULT gen_random_uuid()``.
* ``TIMESTAMPTZ NOT NULL DEFAULT now()`` for created/received timestamps.
* ``JSONB ... DEFAULT '[]'::jsonb`` for the repo list.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.

Idempotency: every DDL is ``CREATE TABLE IF NOT EXISTS``. Re-running against an
already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "tgha01_tenant_github_accounts"
down_revision: str = "shadowreap01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the two zero-touch onboarding tables."""

    # -----------------------------------------------------------------
    # 1. coord.tenant_github_accounts — GitHub account/installation ->
    #    existing coord tenant. UNIQUE on both account_login and
    #    installation_id: each maps to exactly one tenant. FK to
    #    coord.tenants(tenant_id) ON DELETE CASCADE (mirrors
    #    coord.tenant_repos — the mapping is meaningless without its
    #    tenant).
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_github_accounts (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            account_login   TEXT        NOT NULL,
            account_type    TEXT        NOT NULL,
            installation_id BIGINT      NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT tenant_github_accounts_account_login_key
                UNIQUE (account_login),
            CONSTRAINT tenant_github_accounts_installation_id_key
                UNIQUE (installation_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tenant_github_accounts_by_tenant
            ON coord.tenant_github_accounts (tenant_id)
        """
    )

    # -----------------------------------------------------------------
    # 2. coord.pending_installations — an App installation not yet mapped
    #    to a tenant. UNIQUE(installation_id) so a re-delivered install
    #    webhook upserts. `repos` carries the repo full_names from the
    #    install event. `claimed_at` NULL until a tenant claims it.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pending_installations (
            id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            installation_id BIGINT      NOT NULL,
            account_login   TEXT        NOT NULL,
            account_type    TEXT        NOT NULL,
            repos           JSONB       NOT NULL DEFAULT '[]'::jsonb,
            received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            claimed_at      TIMESTAMPTZ,
            CONSTRAINT pending_installations_installation_id_key
                UNIQUE (installation_id)
        )
        """
    )


def downgrade() -> None:
    """Drop both onboarding tables in reverse FK order."""
    op.execute("DROP TABLE IF EXISTS coord.pending_installations")

    op.execute("DROP INDEX IF EXISTS coord.idx_tenant_github_accounts_by_tenant")
    op.execute("DROP TABLE IF EXISTS coord.tenant_github_accounts")
