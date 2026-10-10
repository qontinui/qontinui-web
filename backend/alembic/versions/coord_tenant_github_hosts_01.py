"""Per-tenant GitHub host: github.com or a GitHub Enterprise Server instance.

Phase 9 item 4 of plan ``2026-10-09-spec-front-end-of-the-software-factory``
(GitHub Enterprise Server support in coord).

WHY THIS EXISTS
---------------
coord addressed every GitHub REST, GraphQL, web and git URL at the hardcoded
``https://api.github.com`` / ``https://github.com`` origins, so a tenant whose
repositories live on a GitHub Enterprise Server (GHES) instance could not be
served at all. coord now builds every such URL from one ``GithubHost`` value;
this table is where a tenant's host is configured.

SHAPE
-----
At most one row per tenant (``tenant_id`` is the PRIMARY KEY). **No row means
github.com** — every existing tenant keeps its behaviour with no data
migration, and coord reads a missing table the same way (coord deployed ahead
of this revision cannot meet a tenant that configured another host).

* ``api_base`` — the REST origin, no trailing slash. GHES:
  ``https://<host>/api/v3``. GitHub Enterprise Cloud with data residency:
  ``https://api.<subdomain>.ghe.com``. coord derives GraphQL from it
  (``/api/v3`` → ``/api/graphql`` on GHES, otherwise ``{api_base}/graphql``).
* ``web_base`` — the web and git origin, no path, no trailing slash:
  ``https://<host>``.

The CHECK constraints are defence in depth for coord's own validation
(``GithubHost::from_bases``): ``https://`` only, no userinfo, no query or
fragment, no trailing slash, and ``web_base`` an origin. coord treats a row
that fails its validation as an error, never as github.com.

A host decides only where TOKENLESS URLs point (registry remotes, links shown
to people, fetch URLs handed to runners). coord never addresses a GitHub App
token to a tenant-configured host: a token is only ever sent to the host of
the App client that minted it.

ORDERING
--------
alembic is the sole author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); hand-authored, never
``--autogenerate``d. This revision MUST be deployed before the coord build that
reads ``coord.tenant_github_hosts`` relies on it; that coord build also
degrades a missing table to github.com, so either deploy order is safe. Every
statement names the ``coord`` schema and is idempotent (``IF NOT EXISTS``).

Revision ID: coord_tenant_github_hosts_01
Revises: devcred_01_credential_deny_and_bound_pair_codes
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_tenant_github_hosts_01"
down_revision: str | Sequence[str] | None = (
    "devcred_01_credential_deny_and_bound_pair_codes"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.tenant_github_hosts``."""
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.tenant_github_hosts (
            tenant_id   UUID PRIMARY KEY
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            api_base    TEXT NOT NULL,
            web_base    TEXT NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by  TEXT,
            CONSTRAINT tenant_github_hosts_api_base_shape CHECK (
                api_base ~ '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$'
                AND api_base !~ '/$'
            ),
            CONSTRAINT tenant_github_hosts_web_base_shape CHECK (
                web_base ~ '^https://[^/?#@[:space:]]+$'
            )
        )
        """
    )


def downgrade() -> None:
    """Drop the table: every tenant reads as github.com again."""
    op.execute("DROP TABLE IF EXISTS coord.tenant_github_hosts")
