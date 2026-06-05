"""coord.gates — clearance_audience column

Revision ID: coord_gates_clearance_audience
Revises: deploy_effect_02_rollback_dispatch_marker
Create Date: 2026-06-05

Adds one column to ``coord.gates`` for plan
``2026-06-05-gate-clearance-ux-and-attestation`` (Phase 3):

- ``clearance_audience TEXT NOT NULL DEFAULT 'operator'
  CHECK (clearance_audience IN ('operator','agent'))`` — splits gates by who
  clears them. ``'operator'`` (the default, preserving current behavior for any
  unknown registrant) gates surface a primary ``Mark met…`` attestation button
  on the web panel; ``'agent'`` gates are cleared by the agent session that
  completes the watched work (via ``coord_attest_gate`` / ``POST
  /coord/gates/:id/attest``) and render read-only on the panel's primary
  surface (operator override behind an overflow menu).

## House conventions followed

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` so
the migration is collision-safe against any canonical PG that might already
carry the column from a self-heal mirror — same convention as the sibling
``coord_gates_observation_cols`` (the ``muted``/``snoozed_until`` migration) and
the ``coord_substrate_*`` revisions. The CHECK constraint is added separately
and idempotently (``DROP CONSTRAINT IF EXISTS`` then ``ADD CONSTRAINT``) so a
re-run does not collide on the constraint name.

``DEFAULT 'operator'`` is an IMMUTABLE constant (no ``now()`` or other
non-IMMUTABLE function), so there is no IMMUTABLE-predicate hazard. No index
predicates are added.

Touches **only** ``coord.gates`` (created earlier in this same linear chain by
``coord_singleauthored_01_gates``); it makes no assumption about non-coord
tables, so it applies cleanly anywhere the chain is run.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: ``down_revision`` chains off the single current head
# ``deploy_effect_02_rollback_dispatch_marker`` (reserved by the parent
# session; not re-reserved here).
revision: str = "coord_gates_clearance_audience"
down_revision: str | Sequence[str] | None = "deploy_effect_02_rollback_dispatch_marker"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS clearance_audience TEXT NOT NULL DEFAULT 'operator'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            DROP CONSTRAINT IF EXISTS coord_gates_clearance_audience_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD CONSTRAINT coord_gates_clearance_audience_check
            CHECK (clearance_audience IN ('operator', 'agent'))
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            DROP CONSTRAINT IF EXISTS coord_gates_clearance_audience_check
        """
    )
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS clearance_audience")
