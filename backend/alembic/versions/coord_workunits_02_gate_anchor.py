"""coord.gates — add (work_unit_id + phase_name) as a THIRD gate anchor

Revision ID: coord_workunits_02_gate_anchor
Revises: coord_workunits_01_work_units
Create Date: 2026-06-18

Phase 3 of plan
``D:/qontinui-root/plans/2026-06-18-coord-generic-work-unit-primitive.md``
("coord stops knowing about plans").

Adds a third gate anchor to ``coord.gates`` so a gate can attach to a
generic ``coord.work_units`` row (Phase 1) and fire/clear exactly like a
plan-anchored gate. The existing two anchors are
``(claim_kind + resource_key)`` and ``(plan_id + phase_name)``; this adds
``(work_unit_id + phase_name)``.

The anchor is enforced in THREE places that MUST stay in lockstep:
1. the DB CHECK constraint ``ck_gates_anchor`` (this migration);
2. the Rust anchor enforcement in ``qontinui-coord/src/gates.rs``
   (``register_gate_core``);
3. the ``NewGate`` struct + INSERT/SELECT column lists in the same file.

Because BOTH the plan anchor and the work-unit anchor use ``phase_name``,
the rewritten CHECK keys off ``plan_id`` vs ``work_unit_id`` to keep the
two mutually exclusive — a gate may set ``plan_id`` OR ``work_unit_id``
(with ``phase_name``), never both. This explicitly guards the §6 risk
"a gate accidentally anchoring to both".

## FK decision

``coord.gates.plan_id`` has NO foreign key to ``coord.plans`` (see
``coord_singleauthored_01_gates`` — the column is a bare ``UUID`` with no
``REFERENCES``). For consistency, ``work_unit_id`` likewise carries NO FK
to ``coord.work_units(id)``. Mirroring the plan-anchor choice keeps the
two analogous anchors symmetric and avoids a cross-table delete coupling
the plan anchor deliberately does not have.

## House conventions followed

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT
EXISTS`` + ``DROP CONSTRAINT IF EXISTS`` so the migration is
collision-safe against any canonical PG that already carries the column
or constraint from a self-heal mirror — same convention as the sibling
``coord_gates_observation_cols`` and ``coord_singleauthored_01_gates``.

Touches **only** ``coord.gates`` (created earlier in this linear chain by
``coord_singleauthored_01_gates``) and references ``coord.work_units``
(created by ``coord_workunits_01_work_units``, this revision's parent) by
column name only — no FK — so it applies cleanly anywhere the chain runs.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: this slot is RESERVED via the coord migration head-claim
# (reservation_id c334d213-b189-4779-8c66-792945bfc8c9, down_revision
# coord_workunits_01_work_units) — do not re-derive from a later
# ``alembic heads``.
revision: str = "coord_workunits_02_gate_anchor"
down_revision: str | Sequence[str] | None = "coord_workunits_01_work_units"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add the nullable work-unit anchor column. No FK (mirrors plan_id).
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS work_unit_id UUID
        """
    )
    # 2. Replace the two-anchor CHECK with a three-anchor CHECK. plan_id and
    #    work_unit_id are mutually exclusive (both pair with phase_name).
    op.execute(
        "ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS ck_gates_anchor"
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
    # 3. Partial index on the work-unit anchor — mirrors idx_gates_plan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_work_unit_anchor
            ON coord.gates (work_unit_id, phase_name)
            WHERE work_unit_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # Reverse: drop the work-unit index, restore the two-anchor CHECK, drop
    # the column. Any work-unit-anchored gate rows must be removed first or
    # the restored CHECK would reject them — same caveat as adding the anchor.
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_work_unit_anchor")
    op.execute(
        "ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS ck_gates_anchor"
    )
    op.execute(
        """
        ALTER TABLE coord.gates ADD CONSTRAINT ck_gates_anchor CHECK (
            (claim_kind IS NOT NULL AND resource_key IS NOT NULL
             AND plan_id IS NULL AND phase_name IS NULL)
            OR (claim_kind IS NULL AND resource_key IS NULL
                AND plan_id IS NOT NULL AND phase_name IS NOT NULL)
        )
        """
    )
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS work_unit_id")
