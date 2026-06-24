"""coord.gates — persisted progress_* columns

Revision ID: coord_gates_progress_cols_01
Revises: coord_workunit_deps_01
Create Date: 2026-06-25

Adds eight nullable columns to ``coord.gates`` for plan
``2026-06-25-gate-progress-sweep-persisted`` (Phase 1):

- ``progress_basis TEXT`` — how progress was derived (e.g. the predicate kind /
  metric source the sweep used to compute the fraction).
- ``progress_current DOUBLE PRECISION`` — the current measured value.
- ``progress_target DOUBLE PRECISION`` — the target value the gate clears at.
- ``progress_unit TEXT`` — unit label for ``current``/``target``.
- ``progress_fraction DOUBLE PRECISION`` — normalized 0..1 completion fraction.
- ``progress_eta TIMESTAMPTZ`` — estimated time-of-arrival for the gate to clear.
- ``progress_eta_confidence TEXT`` — qualitative confidence in the ETA.
- ``progress_computed_at TIMESTAMPTZ`` — when the sweep last computed progress
  for this gate (drives the web "as of Xs ago" freshness indicator).

All columns are NULLABLE: progress is computed by the coord sweep, so an
un-swept / progress-less gate simply leaves them NULL. The companion coord PR
reads these exact column names and writes them on each sweep tick.

## House conventions followed

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` so
the migration is collision-safe against any canonical PG that might already
carry the columns from a self-heal mirror — same convention as the sibling
``coord_gates_observation_cols`` (``muted``/``snoozed_until``),
``coord_gates_clearance_audience``, and the ``coord_substrate_*`` revisions.

No DEFAULTs (all NULLABLE), so there is no IMMUTABLE-predicate hazard. No index
predicates are added.

Touches **only** ``coord.gates`` (created earlier in this same linear chain by
``coord_singleauthored_01_gates``); it makes no assumption about non-coord
tables, so it applies cleanly anywhere the chain is run.

NOTE: both ``revision`` and ``down_revision`` are RESERVED via a coord
head-claim — ``coord_workunit_deps_01`` is the reserved parent; do not
re-derive from a later ``alembic heads``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_gates_progress_cols_01"
down_revision: str | Sequence[str] | None = "coord_workunit_deps_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.gates ADD COLUMN IF NOT EXISTS progress_basis TEXT"
    )
    op.execute(
        "ALTER TABLE coord.gates "
        "ADD COLUMN IF NOT EXISTS progress_current DOUBLE PRECISION"
    )
    op.execute(
        "ALTER TABLE coord.gates "
        "ADD COLUMN IF NOT EXISTS progress_target DOUBLE PRECISION"
    )
    op.execute(
        "ALTER TABLE coord.gates ADD COLUMN IF NOT EXISTS progress_unit TEXT"
    )
    op.execute(
        "ALTER TABLE coord.gates "
        "ADD COLUMN IF NOT EXISTS progress_fraction DOUBLE PRECISION"
    )
    op.execute(
        "ALTER TABLE coord.gates ADD COLUMN IF NOT EXISTS progress_eta TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE coord.gates "
        "ADD COLUMN IF NOT EXISTS progress_eta_confidence TEXT"
    )
    op.execute(
        "ALTER TABLE coord.gates "
        "ADD COLUMN IF NOT EXISTS progress_computed_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_computed_at")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_eta_confidence")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_eta")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_fraction")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_unit")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_target")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_current")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS progress_basis")
