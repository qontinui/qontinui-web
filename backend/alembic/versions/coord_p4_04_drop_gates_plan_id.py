"""coord — drop coord.gates.plan_id + rewrite ck_gates_anchor to two-anchor (P4 Phase 4.4)

Revision ID: coord_p4_04_drop_gates_plan_id
Revises: coord_p4_03_drop_plans
Create Date: 2026-07-06

Phase 4.4 (final sweep) of plan
``D:/qontinui-root/plans/2026-07-02-coord-plans-table-drop-phase4.md``. After
Phase 4.3 dropped ``coord.plans``, the ``coord.gates.plan_id`` column is a
vestigial, all-NULL, FK-less anchor (every plan gate was re-anchored to
``work_unit_id`` in 4.2A, which asserted zero non-NULL plan_id gates, and 4.3
closed the registration door so no new ones appear). This removes it and
collapses ``ck_gates_anchor`` from three anchor arms to two
(``claim`` | ``work_unit``).

## ⚠️ DEPLOY GATE — do NOT merge/deploy until the coord code sweep is deployed

This drops ``coord.gates.plan_id``. A deployed coord that still SELECTs/INSERTs
that column would error the instant this applies. Before this merges + deploys,
coord ``origin/main`` MUST carry the Phase-4.4 code sweep (remove ``plan_id``
from ``gates.rs`` NewGate/INSERT/SELECTs, ``api/gate_routes.rs`` GateResponse +
list SELECTs + filter, ``api/dev_overview.rs``). Verify with
``git grep -n 'plan_id' qontinui-coord/src`` → no ``coord.gates.plan_id``
read/write remains. Coord PR: ``feat/p4-phase44-drop-gates-plan-id``.

## What it does
  * drop the current three-anchor ``ck_gates_anchor`` CHECK (it references
    ``plan_id``) and the ``idx_gates_plan`` partial index;
  * ``DROP COLUMN coord.gates.plan_id``;
  * re-add ``ck_gates_anchor`` in the two-anchor form:
    ``(claim_kind+resource_key)`` XOR ``(work_unit_id+phase_name)``.

Safe: every live gate is claim- or work_unit-anchored (plan_id already all-NULL),
so the tightened CHECK rejects nothing. ``coord.gates.work_unit_id`` carries no
FK (mirrors the old plan_id), so nothing else references the dropped column.

## Reversibility
``downgrade`` re-adds the ``plan_id`` column + ``idx_gates_plan`` + the original
three-anchor CHECK, so the reversal gate's upgrade→downgrade→upgrade round-trips
on an empty DB (data not restored — one-way).

## House conventions
Raw ``op.execute`` with ``DROP … IF EXISTS`` / ``ADD COLUMN IF NOT EXISTS`` so
the migration is collision-safe. Single linear head on ``coord_p4_03_drop_plans``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# RE-PARENTED 2026-07-06 onto the live head ``29cf2ab53410``. Authored against
# ``coord_p4_03_drop_plans`` (P4 4.3); web migrations have landed on top since,
# so this re-points to the current single head to keep a linear chain. The
# land-time re-point engine is the final fork authority at merge. (No data dep.)
revision: str = "coord_p4_04_drop_gates_plan_id"
down_revision: str | Sequence[str] | None = "29cf2ab53410"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Drop the CHECK first (it references plan_id) + the plan_id partial index.
    op.execute("ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS ck_gates_anchor")
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_plan")

    # 2. Drop the now-orphan plan_id column.
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS plan_id")

    # 3. Re-add the two-anchor CHECK: exactly one of
    #    (claim_kind + resource_key) or (work_unit_id + phase_name).
    op.execute(
        """
        ALTER TABLE coord.gates ADD CONSTRAINT ck_gates_anchor CHECK (
            (claim_kind IS NOT NULL AND resource_key IS NOT NULL
             AND work_unit_id IS NULL AND phase_name IS NULL)
            OR (claim_kind IS NULL AND resource_key IS NULL
                AND work_unit_id IS NOT NULL AND phase_name IS NOT NULL)
        )
        """
    )


def downgrade() -> None:
    # Reverse: drop the two-anchor CHECK, re-add the plan_id column + index, and
    # restore the original three-anchor CHECK. Data is NOT restored (one-way).
    op.execute("ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS ck_gates_anchor")
    op.execute("ALTER TABLE coord.gates ADD COLUMN IF NOT EXISTS plan_id UUID")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_plan
            ON coord.gates (plan_id, phase_name) WHERE plan_id IS NOT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates ADD CONSTRAINT ck_gates_anchor CHECK (
            (claim_kind IS NOT NULL AND resource_key IS NOT NULL
             AND plan_id IS NULL AND work_unit_id IS NULL AND phase_name IS NULL)
            OR (claim_kind IS NULL AND resource_key IS NULL
                AND plan_id IS NOT NULL AND work_unit_id IS NULL
                AND phase_name IS NOT NULL)
            OR (claim_kind IS NULL AND resource_key IS NULL
                AND plan_id IS NULL AND work_unit_id IS NOT NULL
                AND phase_name IS NOT NULL)
        )
        """
    )
