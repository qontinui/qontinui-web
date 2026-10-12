"""coord.gate_arming_instants — seed the already-live phase-coverage instant

Revision ID: gate_arming_02
Revises: gate_arming_01
Create Date: 2026-10-06

Phase 1 of plan
``2026-09-23-phase-gate-armed-at-is-a-compiled-guess-at-its-own-deploy-time``,
the data half. ``gate_arming_01`` created the table as pure schema; this
revision writes the one row coord's phase-coverage promotion gate reads.

It is a separate revision because it is data DML: coord's migration
classifier refuses any ``INSERT`` and holds a PR carrying one on
``escalate-path-matched``. Kept apart, gate_arming_01 lands on the auto-safe
path, and this one lands by operator override (the ``twin_10`` / ``twin_11``
precedent).

The value is the LIVE instant, not ``now()``
============================================

``phase_coverage_promotion`` is seeded at ``2026-09-27T00:00:00Z`` — exactly
the value of coord's interim compiled literal ``phase_gate_armed_at()``
(``delivery_view.rs``), live in production since that instant. Stamping it
with ``now()`` at deploy would move ``armed_at`` forward and retroactively
exempt every unit first promoted to ``shipped`` under a gate that was already
enforcing, i.e. weaken a working gate. The plan's Design requires coord to
read this key read-only and never self-stamp it, so until this row exists
coord fails closed instead of inventing an instant.

``ON CONFLICT DO NOTHING`` makes it a no-op if the row already exists: an
armed instant is immutable once written, and this revision never overwrites
one.

Downgrade is a no-op: an equal operator-written row is indistinguishable from
the seed, and deleting it would make coord's reads fail closed. Downgrading
past ``gate_arming_01`` drops the table and the row with it.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gate_arming_02"
down_revision: str | Sequence[str] | None = "gate_arming_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Seed the instant coord's interim literal has had live since 2026-09-27."""
    op.execute(
        """
        INSERT INTO coord.gate_arming_instants (gate_key, armed_at)
        VALUES ('phase_coverage_promotion', '2026-09-27T00:00:00Z')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    """No-op: see the module docstring."""
