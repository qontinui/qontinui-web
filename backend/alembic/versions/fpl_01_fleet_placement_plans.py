"""coord.fleet_placement_plans - one row per tenant per placement tick (5 min, kept 30 days)

Revision ID: fpl_01
Revises: taste_inbox_01
Create Date: 2026-10-17

Phase 2 of plan
``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr`` (D1, D3, D4).

## What the table holds

The output of qontinui-coord's pure ``fleet_placement::placement_plan``,
computed by a leader-gated worker every 5 minutes for each tenant and
written as one row. A plan is a SHADOW record in Phase 2: no actuator reads
it yet. It exists so the model's predictions can be compared with what
happened (D4 step 5), and so ``GET /coord/fleet/placement`` and the MCP tool
``coord_query_fleet_placement`` can serve the newest plan.

## Column shape

* ``id`` BIGINT identity primary key.
* ``tenant_id`` UUID NOT NULL - the tenant the plan was computed for. No FK:
  a plan is a time-series observation, and dropping a tenant must not be
  blocked by, or cascade through, 30 days of shadow plans.
* ``computed_at`` TIMESTAMPTZ NOT NULL DEFAULT now() - when the tick ran.
* ``model_version`` INTEGER NOT NULL - the rule version of the pure model, so
  a row written under an older rule set is never compared as if it were the
  current one.
* ``mode`` TEXT NOT NULL - ``shadow`` in Phase 2. Text with no CHECK, the
  ``coord.notifications.kind`` choice, so Phase 7's ``enforce`` is a coord PR
  rather than a migration.
* ``inputs_digest`` TEXT NOT NULL - sha256 hex of the canonical JSON of the
  model's inputs. Two rows with the same digest were computed from the same
  inputs and, the model being pure and deterministic, hold the same plan.
* ``inputs_coverage`` JSONB NOT NULL - how many of each input were KNOWN and
  how many UNKNOWN (hosts with a fresh sample, hosts with a known speed
  factor, repos with a known queue, observations used). An UNKNOWN input is
  counted here and never defaulted.
* ``hosts`` JSONB NOT NULL - the per-host plan: lanes, binding resource,
  ``session_target`` (or UNKNOWN with its reason), reserved C1 slots, speed
  factors with sample counts, and C2 / offloaded-C3 eligibility.
* ``repos`` JSONB NOT NULL - per repo: queue, per-repo cap, C1 slots wanted,
  the hosts reserved and any shortfall that falls back to current behaviour.
* ``advice`` JSONB NOT NULL DEFAULT '[]' - D4 step 4 advice rows.
* ``predicted_ttm_delta_secs`` DOUBLE PRECISION - the predicted change in mean
  time to merge for the tenant's queued PRs (negative = faster). NULL means
  UNKNOWN, never zero: no repo had both a known speed factor and a known
  candidate baseline.
* ``predicted_delta_basis`` TEXT - how the prediction was formed, or why it is
  UNKNOWN.

## Indexes

* ``ix_fleet_placement_plans_tenant_computed`` on
  ``(tenant_id, computed_at DESC)`` - the read door's newest-plan lookup and
  the per-tenant history read.
* ``ix_fleet_placement_plans_computed`` on ``(computed_at)`` - the 30-day
  retention DELETE coord runs from the same worker.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema. The
qontinui-coord PR that writes and reads this table lands after this revision
is applied; until then coord's worker and read door degrade on 42P01 (the
read answers ``schema_migration_pending``, never an empty plan).

## Head choice

``down_revision`` is ``taste_inbox_01``, the single head of
``origin/main`` at ``06aca2d1a`` when this revision was written
(``scripts/ci/count_alembic_heads.py`` reported ``HEAD_COUNT=1``). If main has
moved before it lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head; this repo keeps
strict single-head discipline.

## Safety

A new table, so nothing existing is rewritten or locked. Every statement is
idempotent (``IF NOT EXISTS`` / ``IF EXISTS``) and a static literal, and both
directions are pure ``op.execute`` so they work under ``alembic ... --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fpl_01"
down_revision: str | Sequence[str] | None = "taste_inbox_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal (merge-train migration classifier).


def upgrade() -> None:
    """Create coord.fleet_placement_plans and its two indexes."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.fleet_placement_plans (
            id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            tenant_id                 UUID NOT NULL,
            computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
            model_version             INTEGER NOT NULL,
            mode                      TEXT NOT NULL,
            inputs_digest             TEXT NOT NULL,
            inputs_coverage           JSONB NOT NULL,
            hosts                     JSONB NOT NULL,
            repos                     JSONB NOT NULL,
            advice                    JSONB NOT NULL DEFAULT '[]'::jsonb,
            predicted_ttm_delta_secs  DOUBLE PRECISION,
            predicted_delta_basis     TEXT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fleet_placement_plans_tenant_computed
            ON coord.fleet_placement_plans (tenant_id, computed_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fleet_placement_plans_computed
            ON coord.fleet_placement_plans (computed_at)
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_placement_plans.predicted_ttm_delta_secs IS
            'Predicted change in mean time to merge for the tenant''s queued PRs, seconds, negative = faster. NULL = UNKNOWN (no repo had a known speed factor and a known candidate baseline), never zero.'
        """
    )


def downgrade() -> None:
    """Drop the table; its indexes and comment go with it."""
    op.execute("DROP TABLE IF EXISTS coord.fleet_placement_plans")
