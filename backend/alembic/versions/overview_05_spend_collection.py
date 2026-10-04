"""overview.* — provider-reported spend: vendors, cost entries, import runs,
spend rules, recurring costs, alerts and their push deliveries, import
tokens, alert preferences

Revision ID: overview_05_spend_collection
Revises: coord_agent_sessions_context_01
Create Date: 2026-10-03

Phase 1 of ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``
(the cost tables of ``2026-09-19-project-overview-for-business-leaders`` §Data
model, plus the columns that plan adds). Numbered ``05`` so it cannot collide
with ``overview_04_timeline`` (qontinui-web#1648) if that lands later.

Every amount stored here is the provider's own statement or an
operator-entered invoice amount — never an estimate. Money is integer micros
beside a ``currency``; an amount a provider does not report is NULL, never 0.

``overview.vendors``            who the project pays; carries no money.
``overview.cost_import_runs``   one import attempt; the freshness signal.
``overview.cost_entries``       provider line items, unique per
                                ``(tenant_id, vendor_id, source_ref)`` so
                                every import is an idempotent upsert.
``overview.spend_rules``        alert thresholds, one per vendor or org-wide.
``overview.recurring_costs``    invoice amounts with no billing API,
                                materialised on read.
``overview.spend_push_deliveries`` one Expo send and its tickets/receipts.
``overview.spend_alerts``       one row per rule crossing; push and coord
                                delivery tracked on the row.
``overview.import_tokens``      hashed, revocable bearers for the ingest door.
``overview.spend_alert_preferences`` a recipient's own mute switch.

Development databases: every CREATE here is ``IF NOT EXISTS``, so a dev DB
that ran an EARLIER draft of this revision (before ``push_attempts`` was
added to ``spend_alerts``) keeps the old table shape. Recreate it with
``alembic downgrade coord_agent_sessions_context_01`` then ``alembic upgrade
head``. Production never ran a draft: this revision first ships complete.

Provably additive for coord's migration classifier, like
``overview_03_documents_and_wiki``: guarded ``CREATE TABLE IF NOT EXISTS``
with inline constraints (a new table holds no rows), and every index
``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_05_spend_collection"
down_revision: str | Sequence[str] | None = "coord_agent_sessions_context_01"
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
        CREATE TABLE IF NOT EXISTS overview.vendors (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            name text NOT NULL,
            category text NOT NULL,
            preset_key text,
            connector text,
            connector_config jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            version integer NOT NULL DEFAULT 1,{_AUDIT},
            CONSTRAINT ck_overview_vendors_category CHECK (category IN
                ('ai', 'cloud', 'source_hosting', 'saas', 'labour', 'other')),
            CONSTRAINT ck_overview_vendors_connector CHECK (connector IS NULL OR
                connector IN ('github_billing', 'aws_cost_explorer',
                'vercel_billing', 'cloudflare_billing', 'anthropic_cost_report',
                'google_play_earnings', 'google_workspace_seats',
                'upstash_billing')),
            CONSTRAINT uq_overview_vendors_name UNIQUE (tenant_id, name)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.cost_import_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            vendor_id uuid NOT NULL
                REFERENCES overview.vendors (id) ON DELETE CASCADE,
            connector text NOT NULL,
            source text,
            transport text NOT NULL,
            granularity text NOT NULL,
            provider_endpoint text,
            status text NOT NULL,
            started_at timestamptz NOT NULL,
            finished_at timestamptz,
            period_start date,
            period_end date,
            rows_upserted integer NOT NULL DEFAULT 0,
            items_seen integer NOT NULL DEFAULT 0,
            reconcile_delta_micros bigint,
            error text,{_AUDIT},
            CONSTRAINT ck_overview_cost_import_runs_status
                CHECK (status IN ('ok', 'failed', 'partial')),
            CONSTRAINT ck_overview_cost_import_runs_transport
                CHECK (transport IN ('push', 'pull')),
            CONSTRAINT ck_overview_cost_import_runs_granularity
                CHECK (granularity IN ('day', 'range', 'month'))
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.cost_entries (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            vendor_id uuid NOT NULL
                REFERENCES overview.vendors (id) ON DELETE CASCADE,
            category text,
            description text NOT NULL DEFAULT '',
            amount_micros bigint NOT NULL,
            currency char(3) NOT NULL,
            fx_rate_to_base numeric(18, 8),
            period_start date NOT NULL,
            period_end date NOT NULL,
            phase_id uuid REFERENCES overview.phases (id) ON DELETE SET NULL,
            source text NOT NULL,
            source_ref text,
            gross_micros bigint,
            discount_micros bigint,
            quantity numeric,
            unit text,
            scope_label text,
            sku text,
            product text,
            import_run_id uuid
                REFERENCES overview.cost_import_runs (id) ON DELETE SET NULL,{_AUDIT},
            CONSTRAINT ck_overview_cost_entries_source
                CHECK (source IN ('manual', 'recurring', 'connector')),
            CONSTRAINT ck_overview_cost_entries_period
                CHECK (period_end >= period_start),
            CONSTRAINT uq_overview_cost_entries_source_ref
                UNIQUE (tenant_id, vendor_id, source_ref)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.spend_rules (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            vendor_id uuid REFERENCES overview.vendors (id) ON DELETE CASCADE,
            currency char(3) NOT NULL DEFAULT 'USD',
            monthly_ceiling_micros bigint,
            daily_abs_micros bigint,
            spike_multiplier numeric(6, 2),
            median_window_days integer,
            mtd_thresholds_pct integer[],
            product_filter text[],
            note text,
            version integer NOT NULL DEFAULT 1,{_AUDIT},
            CONSTRAINT ck_overview_spend_rules_ceiling CHECK
                (monthly_ceiling_micros IS NULL OR monthly_ceiling_micros > 0),
            CONSTRAINT ck_overview_spend_rules_daily_abs CHECK
                (daily_abs_micros IS NULL OR daily_abs_micros > 0),
            CONSTRAINT ck_overview_spend_rules_spike_multiplier CHECK
                (spike_multiplier IS NULL OR spike_multiplier > 1),
            CONSTRAINT ck_overview_spend_rules_window CHECK
                (median_window_days IS NULL OR
                 (median_window_days >= 7 AND median_window_days <= 90))
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.recurring_costs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            vendor_id uuid NOT NULL
                REFERENCES overview.vendors (id) ON DELETE CASCADE,
            description text NOT NULL,
            unit_amount_micros bigint NOT NULL,
            quantity numeric(12, 4) NOT NULL DEFAULT 1,
            currency char(3) NOT NULL,
            cadence text NOT NULL,
            start_date date NOT NULL,
            end_date date,
            renews_on date,
            external_ref text,
            source_note text,
            version integer NOT NULL DEFAULT 1,{_AUDIT},
            CONSTRAINT ck_overview_recurring_costs_cadence
                CHECK (cadence IN ('monthly', 'annual')),
            CONSTRAINT ck_overview_recurring_costs_amount
                CHECK (unit_amount_micros >= 0),
            CONSTRAINT ck_overview_recurring_costs_quantity CHECK (quantity > 0),
            CONSTRAINT ck_overview_recurring_costs_period
                CHECK (end_date IS NULL OR end_date >= start_date)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.spend_push_deliveries (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            kind text NOT NULL,
            digest_day date,
            collapse_id text NOT NULL,
            title text NOT NULL,
            body text NOT NULL,
            status text NOT NULL,
            tickets jsonb NOT NULL DEFAULT '[]'::jsonb,
            detail text,
            sent_at timestamptz NOT NULL,
            receipts_checked_at timestamptz,{_AUDIT},
            CONSTRAINT ck_overview_spend_push_kind
                CHECK (kind IN ('single', 'digest')),
            CONSTRAINT ck_overview_spend_push_status
                CHECK (status IN ('accepted', 'delivered', 'failed'))
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.spend_alerts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            vendor_id uuid REFERENCES overview.vendors (id) ON DELETE CASCADE,
            vendor_key text NOT NULL,
            rule text NOT NULL,
            scope_key text NOT NULL,
            period_key text NOT NULL,
            threshold_key integer NOT NULL DEFAULT 0,
            observed_micros bigint,
            threshold_micros bigint,
            currency char(3) NOT NULL DEFAULT 'USD',
            detail jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            fired_at timestamptz NOT NULL,
            push_status text NOT NULL DEFAULT 'pending',
            push_detail text,
            push_attempts integer NOT NULL DEFAULT 0,
            push_delivery_id uuid REFERENCES overview.spend_push_deliveries (id)
                ON DELETE SET NULL,
            coord_status text NOT NULL DEFAULT 'pending',
            coord_detail text,
            resolved_at timestamptz,{_AUDIT},
            CONSTRAINT ck_overview_spend_alerts_rule CHECK
                (rule IN ('mtd_threshold', 'daily_abs', 'spike', 'stale')),
            CONSTRAINT ck_overview_spend_alerts_push_status CHECK (push_status IN
                ('pending', 'accepted', 'delivered', 'failed',
                 'unknown_recipients', 'muted')),
            CONSTRAINT ck_overview_spend_alerts_coord_status CHECK (coord_status IN
                ('pending', 'sent', 'failed', 'unsupported', 'disabled')),
            CONSTRAINT uq_overview_spend_alerts_crossing UNIQUE
                (tenant_id, rule, vendor_key, scope_key, period_key, threshold_key)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.import_tokens (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            vendor_id uuid REFERENCES overview.vendors (id) ON DELETE CASCADE,
            name text NOT NULL,
            token_hash text NOT NULL,
            last_used_at timestamptz,
            revoked_at timestamptz,{_AUDIT},
            CONSTRAINT uq_overview_import_tokens_hash UNIQUE (token_hash)
        )
        """
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.spend_alert_preferences (
            tenant_id uuid NOT NULL,
            user_id uuid NOT NULL,
            muted boolean NOT NULL DEFAULT false,{_AUDIT},
            CONSTRAINT pk_overview_spend_alert_preferences
                PRIMARY KEY (tenant_id, user_id)
        )
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_cost_import_runs_vendor "
            "ON overview.cost_import_runs (tenant_id, vendor_id, finished_at)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_cost_entries_vendor_period "
            "ON overview.cost_entries (tenant_id, vendor_id, period_start)"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_overview_spend_rules_vendor ON overview.spend_rules "
            "(tenant_id, COALESCE(vendor_id, "
            "'00000000-0000-0000-0000-000000000000'::uuid))"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_recurring_costs_vendor "
            "ON overview.recurring_costs (tenant_id, vendor_id)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_spend_push_deliveries_tenant "
            "ON overview.spend_push_deliveries (tenant_id, kind, digest_day)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_spend_alerts_tenant_fired "
            "ON overview.spend_alerts (tenant_id, fired_at)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_import_tokens_tenant "
            "ON overview.import_tokens (tenant_id)"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.spend_alert_preferences")
    op.execute("DROP TABLE IF EXISTS overview.import_tokens")
    op.execute("DROP TABLE IF EXISTS overview.spend_alerts")
    op.execute("DROP TABLE IF EXISTS overview.spend_push_deliveries")
    op.execute("DROP TABLE IF EXISTS overview.recurring_costs")
    op.execute("DROP TABLE IF EXISTS overview.spend_rules")
    op.execute("DROP TABLE IF EXISTS overview.cost_entries")
    op.execute("DROP TABLE IF EXISTS overview.cost_import_runs")
    op.execute("DROP TABLE IF EXISTS overview.vendors")
