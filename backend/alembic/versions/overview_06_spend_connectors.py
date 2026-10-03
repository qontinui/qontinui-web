"""overview.* — spend connectors: namecheap_domains, import-run notices,
recurring-cost auto_renew

Revision ID: overview_06_spend_connectors
Revises: overview_05_spend_collection
Create Date: 2026-10-03

Phases 7–9 of ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``:

* ``overview.vendors.connector`` admits ``namecheap_domains`` (the domain
  renewal-date connector; it produces no money).
* ``overview.cost_import_runs.notices jsonb`` — the warnings a provider's answer
  raised (a changed Workspace seat count, a domain that will not auto-renew),
  shown on the vendor's Sources card. Never a credential.
* ``overview.recurring_costs.auto_renew boolean NULL`` — whether the provider
  renews the entry by itself, written only by a connector that knows; NULL is
  "not known", which the renewals read returns as ``null``.

Additive: two nullable / constant-default columns (metadata-only in PG 11+),
and a CHECK widened by adding the new constraint ``NOT VALID`` then
validating it — every existing row already satisfies the narrower one.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_06_spend_connectors"
down_revision: str | Sequence[str] | None = "overview_05_spend_collection"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BEFORE = (
    "'github_billing', 'aws_cost_explorer', 'vercel_billing', "
    "'cloudflare_billing', 'anthropic_cost_report', 'google_play_earnings', "
    "'google_workspace_seats', 'upstash_billing'"
)
_AFTER = _BEFORE + ", 'namecheap_domains'"


def _connector_check(values: str) -> None:
    op.execute(
        "ALTER TABLE overview.vendors "
        "DROP CONSTRAINT IF EXISTS ck_overview_vendors_connector"
    )
    op.execute(
        "ALTER TABLE overview.vendors ADD CONSTRAINT ck_overview_vendors_connector "
        f"CHECK (connector IS NULL OR connector IN ({values})) NOT VALID"
    )
    op.execute(
        "ALTER TABLE overview.vendors VALIDATE CONSTRAINT ck_overview_vendors_connector"
    )


def upgrade() -> None:
    _connector_check(_AFTER)
    op.execute(
        "ALTER TABLE overview.cost_import_runs "
        "ADD COLUMN IF NOT EXISTS notices jsonb NOT NULL DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE overview.recurring_costs "
        "ADD COLUMN IF NOT EXISTS auto_renew boolean"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE overview.recurring_costs DROP COLUMN IF EXISTS auto_renew")
    op.execute("ALTER TABLE overview.cost_import_runs DROP COLUMN IF EXISTS notices")
    op.execute(
        "UPDATE overview.vendors SET connector = NULL "
        "WHERE connector = 'namecheap_domains'"
    )
    _connector_check(_BEFORE)
