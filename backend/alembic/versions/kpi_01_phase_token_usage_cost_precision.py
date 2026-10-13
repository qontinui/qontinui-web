"""project.phase_token_usage — sub-cent cost and its provenance

Revision ID: kpi_01_phase_token_usage_cost_precision
Revises: devcred_01_credential_deny_and_bound_pair_codes
Create Date: 2026-10-09

Phase 0 of plan ``2026-10-09-kpi-telemetry-and-dashboards``.

The gap
=======

``project.phase_token_usage.cost_cents`` (created by
``consolidation_phase1_03_task_run_satellites``) stores cost as WHOLE cents.
A cheap Claude call — a few hundred tokens on a small model — costs a
fraction of a cent, and the runner rounds to the NEAREST cent: a call under
half a cent records a fabricated $0.00, and every row is off by up to half a
cent in either direction. Summed over a run of many cheap phases the error
accumulates, and a per-phase cost chart reads "free" for work that was not.

The runner now has Claude's own reported cost at full precision. This revision
gives it somewhere to put it, and says where the number came from:

``cost_microusd BIGINT NULL``
    Cost in millionths of a US dollar (1 cent = 10 000 µUSD). Integer, so sums
    are exact. NULL means "no cost recorded at this precision" — every row
    written before this revision, and any writer that only knows whole cents.
    NULL is never a stand-in for zero. ``ck_phase_token_usage_cost_microusd_nonneg``
    refuses a negative value.

``cost_source TEXT NULL`` — CHECK ``reported`` | ``estimated``
    ``reported`` — the provider reported the cost (Claude's ``total_cost_usd``).
    ``estimated`` — computed from token counts against a price table.
    NULL — unknown provenance (legacy rows). Named
    ``ck_phase_token_usage_cost_source``.

``cost_cents`` is left untouched: existing readers keep working, and the runner
will write it alongside the precise value.

Mechanics
=========

* Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — re-running is
  harmless. ``ADD COLUMN IF NOT EXISTS`` cannot attach a CHECK on the re-run
  path, so each constraint is added separately inside a ``pg_constraint``
  existence guard (the ``cinode_01_dispatch_ledger`` shape).
* Both columns are nullable with no default, so ADD COLUMN is a catalog-only
  change: no table rewrite, no backfill. Each ADD CONSTRAINT still validates
  by a full scan under the ACCESS EXCLUSIVE lock the ALTER takes. Every row is
  NULL in both columns at that point, so the scan cannot fail; it only holds
  runner writes for as long as the table takes to read.
* No CHECK pairs ``cost_microusd`` with ``cost_source``: the runner's writer is
  not yet proven to set them together, and a refused row would drop telemetry.
* HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Pure
  DDL, no app imports — the prod migrator lacks app deps.

The re-point rule
=================

``down_revision`` is this repo's LOCAL single alembic head at authoring time
and is deliberately not pinned to it: if another revision lands first, re-point
this line at the new head. Do NOT author an ``alembic merge`` revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "kpi_01_phase_token_usage_cost_precision"
# A plain `str` annotation keeps this on one line: a formatter-wrapped
# `= (\n"..."\n)` reads to coord's escalate-evidence door as a merge tuple.
down_revision: str = "devcred_01_credential_deny_and_bound_pair_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``cost_microusd`` + ``cost_source`` and their CHECKs. Idempotent."""
    op.execute(
        """
        ALTER TABLE project.phase_token_usage
            ADD COLUMN IF NOT EXISTS cost_source TEXT NULL,
            ADD COLUMN IF NOT EXISTS cost_microusd BIGINT NULL
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_phase_token_usage_cost_source'
                  AND conrelid = 'project.phase_token_usage'::regclass
            ) THEN
                ALTER TABLE project.phase_token_usage
                    ADD CONSTRAINT ck_phase_token_usage_cost_source
                    CHECK (cost_source IN ('reported', 'estimated'));
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_phase_token_usage_cost_microusd_nonneg'
                  AND conrelid = 'project.phase_token_usage'::regclass
            ) THEN
                ALTER TABLE project.phase_token_usage
                    ADD CONSTRAINT ck_phase_token_usage_cost_microusd_nonneg
                    CHECK (cost_microusd IS NULL OR cost_microusd >= 0);
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    """Drop both constraints and both columns. Idempotent."""
    op.execute(
        """
        ALTER TABLE project.phase_token_usage
            DROP CONSTRAINT IF EXISTS ck_phase_token_usage_cost_microusd_nonneg,
            DROP CONSTRAINT IF EXISTS ck_phase_token_usage_cost_source
        """
    )
    op.execute(
        """
        ALTER TABLE project.phase_token_usage
            DROP COLUMN IF EXISTS cost_microusd,
            DROP COLUMN IF EXISTS cost_source
        """
    )
