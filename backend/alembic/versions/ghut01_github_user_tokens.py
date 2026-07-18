"""ghut 01 — GitHub App user-to-server OAuth token storage

Revision ID: ghut01_github_user_tokens
Revises: coord_sessions_role_01
Create Date: 2026-07-18

Stores GitHub App user-to-server OAuth tokens for the qontinui-dev GitHub
App, used by coord to create repositories on personal GitHub accounts
(new-project initiation). One row per (tenant, GitHub account login).

``coord.github_user_tokens``:

* ``encrypted_refresh_token`` — ciphertext only; encryption/decryption is
  coord-side. The DB never sees plaintext refresh tokens.
* ``access_token_cache`` / ``access_token_expires_at`` — optional cache of
  the short-lived user access token so coord can skip a refresh round-trip
  while it is still valid.
* ``UNIQUE (tenant_id, account_login)`` — a tenant holds at most one token
  set per GitHub account.
* FK to ``coord.tenants(tenant_id)`` ON DELETE CASCADE, matching the
  ``coord.tenant_github_accounts`` posture (a token row has no meaning once
  its tenant is gone).

Conventions mirror ``tgha01_tenant_github_accounts``:

* Raw ``op.execute`` DDL, ``CREATE TABLE IF NOT EXISTS coord.<table>``.
* ``UUID PRIMARY KEY DEFAULT gen_random_uuid()``.
* ``TIMESTAMPTZ NOT NULL DEFAULT now()`` for created/updated timestamps.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.

Idempotency: every DDL is ``CREATE TABLE IF NOT EXISTS`` /
``CREATE INDEX IF NOT EXISTS``. Re-running against an already-applied DB is
a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ghut01_github_user_tokens"
down_revision: str = "coord_sessions_role_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.github_user_tokens."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.github_user_tokens (
            id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            account_login           TEXT        NOT NULL,
            encrypted_refresh_token TEXT        NOT NULL,
            access_token_cache      TEXT,
            access_token_expires_at TIMESTAMPTZ,
            scopes                  TEXT,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT github_user_tokens_tenant_id_account_login_key
                UNIQUE (tenant_id, account_login)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_github_user_tokens_by_tenant
            ON coord.github_user_tokens (tenant_id)
        """
    )


def downgrade() -> None:
    """Drop coord.github_user_tokens."""
    op.execute("DROP INDEX IF EXISTS coord.idx_github_user_tokens_by_tenant")
    op.execute("DROP TABLE IF EXISTS coord.github_user_tokens")
