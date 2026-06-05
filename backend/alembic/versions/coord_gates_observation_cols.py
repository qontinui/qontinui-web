"""coord.gates — observation + mute/snooze columns

Revision ID: coord_gates_observation_cols
Revises: coord_restack_verif_sig_unique
Create Date: 2026-06-05

Adds three columns to ``coord.gates`` for plan
``2026-06-05-plan-gate-web-surface-and-productization`` (Phase 1 + Phase 2):

- ``condition_met_since TIMESTAMPTZ NULL`` — sustain-window state for the
  Phase 1 ``MetricThreshold`` predicate. The predicate JSON is immutable and
  the sweep is stateless between ticks, so the sustain window (``window_secs``)
  needs a persisted "first satisfied at" timestamp: the sweep stamps it on the
  first satisfied tick, NULLs it when the condition lapses, and only emits
  ``Cleared`` once ``now - condition_met_since >= window_secs``.
- ``muted BOOLEAN NOT NULL DEFAULT FALSE`` — the web gates panel's reversible
  mute toggle. The sweep's open-gates query skips ``muted`` gates.
- ``snoozed_until TIMESTAMPTZ NULL`` — the web gates panel's "snooze until
  <ts>" action; the sweep skips a gate while ``snoozed_until`` is in the future.

This pairs with the coord PR ``feat/gate-observation-predicates`` — **this web
PR merges FIRST** because it carries the columns that PR's SQL references.

## House conventions followed

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` so
the migration is collision-safe against any canonical PG that might already
carry the columns from a self-heal mirror — same convention as the sibling
``coord_singleauthored_01_gates`` (which created the table with
``CREATE TABLE IF NOT EXISTS``) and the ``coord_substrate_*`` revisions.

Touches **only** ``coord.gates`` (created earlier in this same linear chain by
``coord_singleauthored_01_gates``); it makes no assumption about non-coord
tables, so it applies cleanly anywhere the chain is run.

``DEFAULT FALSE`` is an IMMUTABLE constant (no ``now()`` or other
non-IMMUTABLE function), so there is no IMMUTABLE-predicate hazard. No index
predicates are added.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: both ``revision`` and ``down_revision`` are RESERVED via a coord
# head-claim — do not re-derive from a later ``alembic heads``.
revision: str = "coord_gates_observation_cols"
down_revision: str | Sequence[str] | None = "coord_restack_verif_sig_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS condition_met_since TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS snoozed_until")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS muted")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS condition_met_since")
