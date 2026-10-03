"""overview.* — costs authoring: cost entry versions, effort entries, ledger
indexes

Revision ID: overview_07_costs_authoring
Revises: overview_06_spend_connectors
Create Date: 2026-10-03

Phase 5 of ``2026-09-20-overview-authoring-layer`` (Costs), built on the spend
tables of ``overview_05_spend_collection``:

* ``overview.cost_entries.version integer DEFAULT 1`` — the authoring
  contract's concurrency token, now that cost entries are the registry
  resource ``costs/entries`` (manual entries authored by hand; provider rows
  re-assignable to a phase). Nullable with a constant default, so every
  existing row reads 1 without a rewrite; a reader maps a NULL to 1 too.
* ``overview.effort_entries`` — time logged against the project. Under
  ``labour_billing = day_rates`` an entry snapshots the role's day rate, its
  currency and the hours per day at logging time
  (``ck_overview_effort_entries_rate`` keeps the three together), so a later
  rate edit never rewrites history. ``role_code`` is a code, not a key
  (estimate roles are re-inserted on every estimate save); ``phase_id`` is a
  key, ``ON DELETE SET NULL``.
* Indexes: the ledger's date-ordered read over every vendor
  (``ix_overview_cost_entries_tenant_period``), and partial ``phase_id``
  indexes on both tables so a phase delete's ``SET NULL`` does not scan them.

Provably additive for coord's migration classifier: one ``ADD COLUMN IF NOT
EXISTS`` with a constant default and no ``NOT NULL``; a guarded ``CREATE
TABLE IF NOT EXISTS`` with inline constraints (a new table holds no rows);
every index ``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_07_costs_authoring"
down_revision: str | Sequence[str] | None = "overview_06_spend_connectors"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE overview.cost_entries "
        "ADD COLUMN IF NOT EXISTS version integer DEFAULT 1"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.effort_entries (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            work_date date NOT NULL,
            person text NOT NULL,
            person_user_id uuid,
            hours numeric(5, 2) NOT NULL,
            role_code text,
            phase_id uuid REFERENCES overview.phases (id) ON DELETE SET NULL,
            task_number text,
            note text NOT NULL DEFAULT '',
            rate_micros_used bigint,
            rate_currency char(3),
            hours_per_day_used numeric(5, 2),
            version integer NOT NULL DEFAULT 1,
            created_by text,
            updated_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_overview_effort_entries_hours
                CHECK (hours > 0 AND hours <= 24),
            CONSTRAINT ck_overview_effort_entries_rate CHECK (
                (rate_micros_used IS NULL) = (rate_currency IS NULL)
                AND (rate_micros_used IS NULL) = (hours_per_day_used IS NULL)
            ),
            CONSTRAINT ck_overview_effort_entries_rate_amount
                CHECK (rate_micros_used IS NULL OR rate_micros_used >= 0),
            CONSTRAINT ck_overview_effort_entries_hours_per_day CHECK (
                hours_per_day_used IS NULL
                OR (hours_per_day_used > 0 AND hours_per_day_used <= 24)
            )
        )
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_cost_entries_tenant_period "
            "ON overview.cost_entries (tenant_id, period_start)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_cost_entries_phase "
            "ON overview.cost_entries (phase_id) WHERE phase_id IS NOT NULL"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_effort_entries_tenant_date "
            "ON overview.effort_entries (tenant_id, work_date)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_effort_entries_person "
            "ON overview.effort_entries (tenant_id, person_user_id, work_date)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_effort_entries_phase "
            "ON overview.effort_entries (phase_id) WHERE phase_id IS NOT NULL"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.effort_entries")
    op.execute("DROP INDEX IF EXISTS overview.ix_overview_cost_entries_phase")
    op.execute("DROP INDEX IF EXISTS overview.ix_overview_cost_entries_tenant_period")
    op.execute("ALTER TABLE overview.cost_entries DROP COLUMN IF EXISTS version")
