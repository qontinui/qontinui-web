"""overview.* — the project estimate (the baseline): phases, tasks, roles, tiers

Revision ID: overview_01_estimate_baseline
Revises: tenant_policies_02_transcript_sync_enabled
Create Date: 2026-09-20

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``. Ten tables in
a NEW web-owned schema, ``overview``, holding the *estimate* a business leader
approves a project against — separate by design from the *actuals* Phase 4
records beside it.

Every table carries ``tenant_id`` (the active coord tenant, resolved from
``X-Qontinui-Active-Tenant`` — the "project" the Overview is scoped to) plus
``created_by`` / ``updated_by`` / ``created_at`` / ``updated_at``. There is no
FK on ``tenant_id``: tenants live in coord's own deployment and a cross-schema
FK would re-couple exactly what the web↔coord schema-boundary decoupling
separated (same reasoning as ``agent.work_artifacts.organization_id``).

Tables
======
``overview.settings``
    One row per tenant: base currency, hand-entered FX rates, the labour
    billing arrangement, hours per day and the working-day factor. These are
    PROJECT settings, not estimate settings — they outlive any one estimate.

``overview.estimates``
    A tenant may hold several (a v0.1 "for decision", then a re-baseline);
    at most one is ``is_baseline``, enforced by a partial unique index.
    ``purpose`` is what makes the same numbers mean different things —
    ``budget`` (money the project will spend), ``comparison`` (what
    conventional delivery would cost) or ``forecast`` (a projection).

``overview.phases`` / ``overview.phase_tasks``
    The delivery schedule and the work inside each phase.

``overview.roles`` / ``overview.task_efforts`` / ``overview.phase_allocations``
    Who is needed, the role × person-day split per task, and the FTE matrix.
    The two effort tables are DELIBERATELY independent: delivery plans state
    them separately and they need not reconcile exactly, so person-days are
    summed from ``task_efforts`` alone and FTE from ``phase_allocations``
    alone. Deriving one from the other is the double-count the rollup tests
    exist to catch.

``overview.price_tiers`` / ``overview.cost_lines`` / ``overview.calendar_breaks``
    Optional low/mid/high pricing, non-labour build and annual-run cost
    lines, and the holidays that shorten a phase's working days.

Design notes
============

* **Money is integer micros** — ``*_micros BIGINT`` plus an ISO 4217
  ``currency``, never a float. One micro is 1e-6 of a currency unit, the
  spelling the fleet already uses for ``coord.prepaid_balances``
  (``balance_micros: 19280000`` == 19.28). A rate always names its currency:
  a CHECK ties ``day_rate_micros`` and ``currency`` to be both-null or
  both-set, so nothing can store an amount whose unit is unknown.

* **Derived figures are NOT stored.** Calendar weeks, working weeks, working
  days, person-day totals, fees and contingency are all computed on read by
  ``GET /api/v1/overview/estimates/{id}/rollup``. The one near-exception is
  ``phases.stated_working_weeks``, which is **not** a cache of the derived
  value: it records the number the source delivery plan *claimed*, so the
  rollup can show it beside its own computation and a disagreement is
  visible rather than silently overwritten. The plan's data model called this
  column ``working_weeks``; it is spelled ``stated_`` here precisely so no
  reader mistakes it for the derived figure the same plan says is never
  stored.

* **``source_page_id`` carries no FK.** It points at the delivery-plan
  document in ``overview.pages``, a table Phase 7 creates. Until then it is a
  nullable UUID that is allowed to dangle — the same soft-link posture as
  ``agent.work_artifacts.work_unit_slug``.

* **``version`` is the optimistic-concurrency counter** on the two rows this
  API addresses individually — ``overview.settings`` (one per tenant) and
  ``overview.estimates``. It starts at 1 and is bumped by every write that
  changes the row OR its content graph, so a caller that read version N can
  refuse to overwrite a row that has since moved. The estimate's children are
  replaced wholesale as one graph rather than addressed individually, so they
  carry no counter of their own; the shared authoring layer of plan
  ``2026-09-20-overview-authoring-layer`` is what will give them one, along
  with the ``If-Match`` / change-log contract this revision deliberately does
  not invent a second time.

* **Cross-estimate integrity is the API's job, not a constraint's.** A
  ``task_efforts`` row joins a task (→ phase → estimate) to a role
  (→ estimate); SQL alone cannot require those two estimates to agree without
  denormalising the estimate id into both children. The content-replace
  endpoint builds an estimate's whole graph inside one transaction from one
  payload, so a mismatch is unconstructible through the API, and
  ``tests/test_overview_estimates_api.py`` pins that.

* **CHECK constraints carry explicit stable names** (``ck_overview_*``) so a
  later widening can ``DROP CONSTRAINT <known name>`` instead of the
  discover-and-drop ``pg_constraint`` loop an auto-named inline CHECK forces.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly and downgrade → upgrade is a no-op on a
fresh database.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "overview_01_estimate_baseline"
# Re-pointed at the tip as `main` moved: this revision creates a schema of
# its own and reads nothing from the chain, so ordering is all that changes,
# and chaining off the single existing head is what keeps the count at one
# without a merge revision.
down_revision: str = "tenant_policies_02_transcript_sync_enabled"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Columns every overview table carries. Spelled once so the ten CREATE TABLEs
# below cannot drift from each other.
_AUDIT_COLUMNS = """
            created_by         TEXT,
            updated_by         TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
"""


def upgrade() -> None:
    """Create the ``overview`` schema and the ten estimate-baseline tables."""
    op.execute("CREATE SCHEMA IF NOT EXISTS overview")

    # ── 1. Project settings — one row per tenant ────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.settings (
            tenant_id          UUID PRIMARY KEY,
            base_currency      CHAR(3) NOT NULL DEFAULT 'USD',
            fx_rates           JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            labour_billing     TEXT NOT NULL DEFAULT 'unbilled'
                CONSTRAINT ck_overview_settings_labour_billing
                CHECK (labour_billing IN ('unbilled', 'day_rates', 'fixed_fee')),
            hours_per_day      NUMERIC(5, 2) NOT NULL DEFAULT 8
                CONSTRAINT ck_overview_settings_hours_per_day
                CHECK (hours_per_day > 0 AND hours_per_day <= 24),
            working_day_factor NUMERIC(6, 4) NOT NULL DEFAULT 1.0
                CONSTRAINT ck_overview_settings_working_day_factor
                CHECK (working_day_factor > 0 AND working_day_factor <= 1),
            first_value_date   DATE,
            version            INTEGER NOT NULL DEFAULT 1,
{_AUDIT_COLUMNS}
        )
        """
    )

    # ── 2. Estimates ────────────────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.estimates (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            name             TEXT NOT NULL,
            purpose          TEXT NOT NULL
                CONSTRAINT ck_overview_estimates_purpose
                CHECK (purpose IN ('budget', 'comparison', 'forecast')),
            status           TEXT NOT NULL DEFAULT 'draft'
                CONSTRAINT ck_overview_estimates_status
                CHECK (status IN ('draft', 'for_decision', 'approved', 'superseded')),
            is_baseline      BOOLEAN NOT NULL DEFAULT false,
            source_page_id   UUID,
            accuracy_note    TEXT,
            contingency_pct  NUMERIC(6, 3)
                CONSTRAINT ck_overview_estimates_contingency_pct
                CHECK (contingency_pct IS NULL OR contingency_pct >= 0),
            notes            TEXT NOT NULL DEFAULT '',
            version          INTEGER NOT NULL DEFAULT 1,
{_AUDIT_COLUMNS}
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_estimates_tenant "
        "ON overview.estimates (tenant_id)"
    )
    # At most one baseline per tenant. Partial, because the non-baseline rows
    # are unlimited.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_overview_estimates_baseline "
        "ON overview.estimates (tenant_id) WHERE is_baseline"
    )

    # ── 3. Phases ───────────────────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.phases (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            estimate_id          UUID NOT NULL
                REFERENCES overview.estimates (id) ON DELETE CASCADE,
            code                 TEXT NOT NULL,
            name                 TEXT NOT NULL,
            sort_order           INTEGER NOT NULL DEFAULT 0,
            planned_start        DATE,
            planned_end          DATE,
            stated_working_weeks NUMERIC(8, 2)
                CONSTRAINT ck_overview_phases_stated_working_weeks
                CHECK (stated_working_weeks IS NULL OR stated_working_weeks >= 0),
            gate_criteria        TEXT NOT NULL DEFAULT '',
            actual_start         DATE,
            actual_end           DATE,
            gate_status          TEXT NOT NULL DEFAULT 'pending'
                CONSTRAINT ck_overview_phases_gate_status
                CHECK (gate_status IN ('pending', 'passed', 'failed', 'waived')),
            gate_decided_at      DATE,
            gate_notes           TEXT NOT NULL DEFAULT '',
{_AUDIT_COLUMNS},
            CONSTRAINT ck_overview_phases_planned_order
                CHECK (planned_start IS NULL OR planned_end IS NULL
                       OR planned_end >= planned_start),
            CONSTRAINT ck_overview_phases_actual_order
                CHECK (actual_start IS NULL OR actual_end IS NULL
                       OR actual_end >= actual_start),
            CONSTRAINT uq_overview_phases_code UNIQUE (estimate_id, code)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_phases_tenant "
        "ON overview.phases (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_phases_estimate "
        "ON overview.phases (estimate_id, sort_order)"
    )

    # ── 4. Tasks within a phase ─────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.phase_tasks (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            phase_id         UUID NOT NULL
                REFERENCES overview.phases (id) ON DELETE CASCADE,
            number           TEXT NOT NULL,
            title            TEXT NOT NULL,
            requirement_refs TEXT,
            planned_start    DATE,
            planned_end      DATE,
            is_critical      BOOLEAN NOT NULL DEFAULT false,
            status           TEXT NOT NULL DEFAULT 'planned'
                CONSTRAINT ck_overview_phase_tasks_status
                CHECK (status IN ('planned', 'in_progress', 'done')),
            sort_order       INTEGER NOT NULL DEFAULT 0,
{_AUDIT_COLUMNS},
            CONSTRAINT ck_overview_phase_tasks_planned_order
                CHECK (planned_start IS NULL OR planned_end IS NULL
                       OR planned_end >= planned_start),
            CONSTRAINT uq_overview_phase_tasks_number UNIQUE (phase_id, number)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_phase_tasks_tenant "
        "ON overview.phase_tasks (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_phase_tasks_phase "
        "ON overview.phase_tasks (phase_id, sort_order)"
    )

    # ── 5. Roles ────────────────────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.roles (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            estimate_id     UUID NOT NULL
                REFERENCES overview.estimates (id) ON DELETE CASCADE,
            code            TEXT NOT NULL,
            name            TEXT NOT NULL,
            responsibility  TEXT NOT NULL DEFAULT '',
            day_rate_micros BIGINT
                CONSTRAINT ck_overview_roles_day_rate_non_negative
                CHECK (day_rate_micros IS NULL OR day_rate_micros >= 0),
            currency        CHAR(3),
            client_side     BOOLEAN NOT NULL DEFAULT false,
            sort_order      INTEGER NOT NULL DEFAULT 0,
{_AUDIT_COLUMNS},
            -- An amount with no unit is unreadable, and a unit with no amount
            -- is noise: the two travel together or not at all.
            CONSTRAINT ck_overview_roles_rate_has_currency
                CHECK ((day_rate_micros IS NULL) = (currency IS NULL)),
            CONSTRAINT uq_overview_roles_code UNIQUE (estimate_id, code)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_roles_tenant "
        "ON overview.roles (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_roles_estimate "
        "ON overview.roles (estimate_id, sort_order)"
    )

    # ── 6. Task × role person-days ──────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.task_efforts (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL,
            task_id             UUID NOT NULL
                REFERENCES overview.phase_tasks (id) ON DELETE CASCADE,
            role_id             UUID NOT NULL
                REFERENCES overview.roles (id) ON DELETE CASCADE,
            planned_person_days NUMERIC(10, 2) NOT NULL
                CONSTRAINT ck_overview_task_efforts_non_negative
                CHECK (planned_person_days >= 0),
{_AUDIT_COLUMNS},
            CONSTRAINT uq_overview_task_efforts UNIQUE (task_id, role_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_task_efforts_tenant "
        "ON overview.task_efforts (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_task_efforts_role "
        "ON overview.task_efforts (role_id)"
    )

    # ── 7. Phase × role FTE matrix ──────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.phase_allocations (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id  UUID NOT NULL,
            phase_id   UUID NOT NULL
                REFERENCES overview.phases (id) ON DELETE CASCADE,
            role_id    UUID NOT NULL
                REFERENCES overview.roles (id) ON DELETE CASCADE,
            fte        NUMERIC(8, 3) NOT NULL
                CONSTRAINT ck_overview_phase_allocations_non_negative
                CHECK (fte >= 0),
{_AUDIT_COLUMNS},
            CONSTRAINT uq_overview_phase_allocations UNIQUE (phase_id, role_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_phase_allocations_tenant "
        "ON overview.phase_allocations (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_phase_allocations_role "
        "ON overview.phase_allocations (role_id)"
    )

    # ── 8. Price tiers ──────────────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.price_tiers (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            estimate_id UUID NOT NULL
                REFERENCES overview.estimates (id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            multiplier  NUMERIC(8, 4) NOT NULL
                CONSTRAINT ck_overview_price_tiers_multiplier
                CHECK (multiplier > 0),
            is_primary  BOOLEAN NOT NULL DEFAULT false,
            sort_order  INTEGER NOT NULL DEFAULT 0,
{_AUDIT_COLUMNS},
            CONSTRAINT uq_overview_price_tiers_name UNIQUE (estimate_id, name)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_price_tiers_tenant "
        "ON overview.price_tiers (tenant_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_overview_price_tiers_primary "
        "ON overview.price_tiers (estimate_id) WHERE is_primary"
    )

    # ── 9. Non-labour build / annual-run cost lines ─────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.cost_lines (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            estimate_id UUID NOT NULL
                REFERENCES overview.estimates (id) ON DELETE CASCADE,
            kind        TEXT NOT NULL
                CONSTRAINT ck_overview_cost_lines_kind
                CHECK (kind IN ('build_non_labour', 'run_annual')),
            label       TEXT NOT NULL,
            basis       TEXT NOT NULL DEFAULT '',
            low_micros  BIGINT
                CONSTRAINT ck_overview_cost_lines_low_non_negative
                CHECK (low_micros IS NULL OR low_micros >= 0),
            high_micros BIGINT
                CONSTRAINT ck_overview_cost_lines_high_non_negative
                CHECK (high_micros IS NULL OR high_micros >= 0),
            currency    CHAR(3),
            phase_id    UUID REFERENCES overview.phases (id) ON DELETE SET NULL,
            run_model   TEXT,
            sort_order  INTEGER NOT NULL DEFAULT 0,
{_AUDIT_COLUMNS},
            CONSTRAINT ck_overview_cost_lines_band
                CHECK (low_micros IS NULL OR high_micros IS NULL
                       OR high_micros >= low_micros),
            -- Same rule as a role's rate: an amount always names its unit.
            CONSTRAINT ck_overview_cost_lines_amount_has_currency
                CHECK ((low_micros IS NULL AND high_micros IS NULL)
                       = (currency IS NULL))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_cost_lines_tenant "
        "ON overview.cost_lines (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_cost_lines_estimate "
        "ON overview.cost_lines (estimate_id, kind, sort_order)"
    )

    # ── 10. Calendar breaks (holidays) ──────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS overview.calendar_breaks (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            estimate_id UUID NOT NULL
                REFERENCES overview.estimates (id) ON DELETE CASCADE,
            label       TEXT NOT NULL,
            start_date  DATE NOT NULL,
            end_date    DATE NOT NULL,
{_AUDIT_COLUMNS},
            CONSTRAINT ck_overview_calendar_breaks_order
                CHECK (end_date >= start_date)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_calendar_breaks_tenant "
        "ON overview.calendar_breaks (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_overview_calendar_breaks_estimate "
        "ON overview.calendar_breaks (estimate_id, start_date)"
    )


def downgrade() -> None:
    """Drop the ten tables. The schema itself is left in place — dropping it
    would take any later phase's tables with it."""
    for table in (
        "calendar_breaks",
        "cost_lines",
        "price_tiers",
        "phase_allocations",
        "task_efforts",
        "phase_tasks",
        "roles",
        "phases",
        "estimates",
        "settings",
    ):
        op.execute(f"DROP TABLE IF EXISTS overview.{table} CASCADE")
