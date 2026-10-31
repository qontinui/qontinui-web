"""overview.* — the Costs page's ledger: categories, recurring costs, entries

Revision ID: overview_05_cost_ledger
Revises: overview_05_page_sources
Create Date: 2026-10-27

The money a project has actually spent, entered by hand on the Costs page
(``/overview/financials``). Money is integer micros beside an ISO currency,
as everywhere in ``overview.*``; no float anywhere.

``overview.cost_categories``
    The headings costs are grouped under. Names are unique per project,
    ignoring case. A category in use cannot be deleted (``RESTRICT``).

``overview.recurring_costs``
    A cost that falls due on a cadence (monthly / quarterly / annual). A
    ``fixed`` one charges ``amount_micros`` every period; a ``variable`` one
    (a usage bill) needs each period's amount entered. Periods are derived on
    read, never stored: a period with no entry is a scheduled charge (fixed)
    or awaiting its amount (variable) — never a zero.

``overview.cost_entries``
    Money actually spent: a one-time purchase, or one period of a recurring
    cost (``recurring_cost_id`` + ``period_start``, unique together).
    ``expects_delivery`` + ``received_on`` track a physical item from order
    to arrival.

Provably additive for coord's migration classifier, like
``overview_04_timeline``: guarded ``CREATE TABLE IF NOT EXISTS`` with inline
constraints (a new table holds no rows), and every index
``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_05_cost_ledger"
down_revision: str | Sequence[str] | None = "overview_05_page_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_AUDIT = """
            created_by text,
            updated_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()"""


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.cost_categories (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            name text NOT NULL,
            description text NOT NULL DEFAULT '',
            sort_order integer NOT NULL DEFAULT 0,
            version integer NOT NULL DEFAULT 1,{_AUDIT}
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.recurring_costs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            name text NOT NULL,
            vendor text NOT NULL DEFAULT '',
            category_id uuid
                REFERENCES overview.cost_categories (id) ON DELETE RESTRICT,
            cadence text NOT NULL DEFAULT 'monthly',
            amount_kind text NOT NULL DEFAULT 'fixed',
            amount_micros bigint,
            currency char(3) NOT NULL,
            start_date date NOT NULL,
            end_date date,
            notes text NOT NULL DEFAULT '',
            version integer NOT NULL DEFAULT 1,{_AUDIT},
            CONSTRAINT ck_overview_recurring_costs_cadence
                CHECK (cadence IN ('monthly', 'quarterly', 'annual')),
            CONSTRAINT ck_overview_recurring_costs_amount_kind
                CHECK (amount_kind IN ('fixed', 'variable')),
            CONSTRAINT ck_overview_recurring_costs_fixed_has_amount
                CHECK (amount_kind <> 'fixed' OR amount_micros IS NOT NULL),
            CONSTRAINT ck_overview_recurring_costs_period
                CHECK (end_date IS NULL OR end_date >= start_date)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.cost_entries (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            incurred_on date NOT NULL,
            description text NOT NULL,
            vendor text NOT NULL DEFAULT '',
            category_id uuid
                REFERENCES overview.cost_categories (id) ON DELETE RESTRICT,
            amount_micros bigint NOT NULL,
            currency char(3) NOT NULL,
            quantity integer NOT NULL DEFAULT 1,
            expects_delivery boolean NOT NULL DEFAULT false,
            received_on date,
            order_ref text NOT NULL DEFAULT '',
            notes text NOT NULL DEFAULT '',
            recurring_cost_id uuid
                REFERENCES overview.recurring_costs (id) ON DELETE RESTRICT,
            period_start date,
            version integer NOT NULL DEFAULT 1,{_AUDIT},
            CONSTRAINT ck_overview_cost_entries_quantity CHECK (quantity > 0),
            CONSTRAINT ck_overview_cost_entries_received_needs_delivery
                CHECK (received_on IS NULL OR expects_delivery),
            CONSTRAINT ck_overview_cost_entries_period_with_recurring
                CHECK ((recurring_cost_id IS NULL) = (period_start IS NULL)),
            CONSTRAINT uq_overview_cost_entries_period
                UNIQUE (recurring_cost_id, period_start)
        )
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_overview_cost_categories_name "
            "ON overview.cost_categories (tenant_id, lower(name))"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_recurring_costs_tenant "
            "ON overview.recurring_costs (tenant_id, start_date)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_cost_entries_tenant "
            "ON overview.cost_entries (tenant_id, incurred_on)"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.cost_entries")
    op.execute("DROP TABLE IF EXISTS overview.recurring_costs")
    op.execute("DROP TABLE IF EXISTS overview.cost_categories")
