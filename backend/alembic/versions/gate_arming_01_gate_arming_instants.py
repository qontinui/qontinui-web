"""coord.gate_arming_instants — persisted arming instants for forward-only gates

Revision ID: gate_arming_01
Revises: coordtouch_02_operator_touch_closes
Create Date: 2026-10-06

Phase 1 of plan
``2026-09-23-phase-gate-armed-at-is-a-compiled-guess-at-its-own-deploy-time``.

What the table is
=================

One row per **forward-only gate**: a gate that applies only to rows whose
triggering event happened AFTER the gate was armed, so everything older is
grandfathered. ``gate_key`` names the gate; ``armed_at`` is the instant it was
armed. The table is deliberately generic (a key column, not a single-purpose
``phase_gate_armed_at`` column) so the next forward-only gate of the same
shape reuses it instead of prompting a second migration for the same idea.

The consumer is coord (``qontinui-coord``), which today carries the arming
instant of its phase-coverage promotion gate as a compiled literal
(``phase_gate_armed_at()`` in ``delivery_view.rs``). Phase 2 of the plan
replaces that literal with a cached read of this table. Web makes no read of
``coord.*``; alembic is only the schema author (served policy
``production-and-cost`` ``alembic-sole-authorship``).

Schema only — the seed is ``gate_arming_02``
============================================

This revision is pure DDL, shipped in its own PR (coord classifies every
migration a PR adds together), so it lands on coord's auto-safe path.
The ``phase_coverage_promotion`` row (the LIVE instant
``2026-09-27T00:00:00Z``, never ``now()``) is data DML, which coord's
migration classifier holds for operator review, so it is the separate
revision ``gate_arming_02_seed_phase_coverage_promotion`` — the same split as
``twin_10`` / ``twin_11``. The plan's Design requires coord to read that key
read-only and never self-stamp it, so the table existing without the row is
safe: coord's reads fail closed (grandfather / skip the derive cycle) until
the seed lands.

The ``DEFAULT now()`` on ``armed_at`` is for gate keys introduced AFTER this
plan only, which coord self-stamps lazily on first use
(``INSERT ... ON CONFLICT (gate_key) DO NOTHING``).

Downgrade drops the table.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gate_arming_01"
down_revision: str | Sequence[str] | None = "coordtouch_02_operator_touch_closes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the table. The seed row is gate_arming_02."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.gate_arming_instants (
            gate_key   TEXT PRIMARY KEY,
            armed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    """Reverse exactly this revision: drop the table."""
    op.execute("DROP TABLE IF EXISTS coord.gate_arming_instants")
