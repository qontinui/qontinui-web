"""coord — re-anchor live plan_id gates + tasks off coord.plans (P4 Phase 4.2)

Revision ID: coord_p4_02_reanchor_plan_gates
Revises: coord_session_expectations_01
Create Date: 2026-07-03

Phase 4.2 of plan
``D:/qontinui-root/plans/2026-07-02-coord-plans-table-drop-phase4.md`` (§4.2)
— the final phase of the plan-decoupling program. Phase 4.1
(``a23fa4a5``) migrated the READ consumers of ``coord.plans`` to
``coord.work_units``; this migration re-anchors the live durable state that
still carries a ``plan_id`` — ``coord.gates`` and ``coord.tasks`` — onto the
corresponding ``coord.work_units`` row (matched by ``slug``), so Phase 4.3 can
DROP ``coord.plans``/``coord.plan_status_history`` without cascade-deleting
live work or orphaning gates.

DESTRUCTIVE + runs against PROD RDS on deploy. This migration:
  * adds ``coord.tasks.work_unit_id`` + partial index, backfills it by slug;
  * re-anchors ``coord.gates`` (plan_id → work_unit_id) where a same-slug
    work_unit exists, and DELETEs the orphan gates that have no work_unit
    (their plans shipped + archived before the adapter's first run) — NULLing
    plan_id on an orphan would violate ``ck_gates_anchor`` (zero anchors);
  * asserts ``SELECT count(*) FROM coord.gates WHERE plan_id IS NOT NULL = 0``
    as a self-verifying go/no-go for Phase 4.3.

It does NOT drop ``coord.gates.plan_id`` / ``coord.tasks.plan_id`` columns or
FKs (that is Phase 4.3, held), and does NOT drop ``coord.plans`` /
``coord.plan_status_history``.

## CHECK-safety of the gate re-anchor

``ck_gates_anchor`` (``coord_workunits_02_gate_anchor``) requires EXACTLY ONE
of three anchor triples. A plan gate is
``(plan_id NOT NULL, phase_name NOT NULL, claim_kind/resource_key/work_unit_id
NULL)`` = arm 2. After the RE-ANCHOR UPDATE the row becomes
``(work_unit_id NOT NULL, phase_name NOT NULL, all others NULL)`` = arm 3 —
still exactly one anchor. ``phase_name`` is preserved (untouched), so the
``(work_unit_id + phase_name)`` invariant holds and no CHECK is violated.

## Ordering (within upgrade)

The ``coord.tasks`` backfill (step 2) must precede the coord code change
``mark_tasks_done_from_merge`` that reads ``work_units.tenant_id`` off
``coord.tasks.work_unit_id`` (deployed separately as part of 4.2). The gate
re-anchor (step 3) is independent of the tasks work and may run in either
order; it is placed after for readability.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT
EXISTS`` / ``DROP … IF EXISTS`` so the migration is collision-safe against a
canonical PG that already self-healed the column — same convention as the
sibling ``coord_workunits_02_gate_anchor``. ``coord.tasks.work_unit_id`` is
nullable with NO FK, mirroring the ``coord.gates.work_unit_id`` no-FK decision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# RE-PARENTED 2026-07-05 onto the live single head ``coord_tenant_backfill_01``.
# The original reservation (id 24b81412-a9a4-4829-a6de-deffd951f0a3, position 5)
# stacked this on ``coord_session_expectations_01`` (web PR #720,
# coord.expectation_probes) — a DIFFERENT, disjoint table set with NO data
# dependency on this migration. That parent stalled unlanded (PR #720 red +
# untouched), so the stack was decoupled: this migration is re-pointed at the
# current chain head. Fork-safe — coord's land-time re-point engine finalizes
# ``down_revision`` at merge and the alembic-graph CI gate rejects any true fork.
revision: str = "coord_p4_02_reanchor_plan_gates"
down_revision: str | Sequence[str] | None = "coord_tenant_backfill_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. coord.tasks — add the work-unit anchor column + partial index.
    #    Nullable, NO FK (mirrors coord.gates.work_unit_id).
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.tasks
            ADD COLUMN IF NOT EXISTS work_unit_id UUID
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tasks_work_unit
            ON coord.tasks (work_unit_id)
            WHERE work_unit_id IS NOT NULL
        """
    )

    # ------------------------------------------------------------------
    # 2. coord.tasks — backfill work_unit_id by slug (same-tenant bridge
    #    plan.slug == work_unit.slug). Tasks whose plan shipped + archived
    #    (no work_unit) keep a NULL work_unit_id — acceptable: they are
    #    terminal and mark_tasks_done only flips ACTIVE rows.
    # ------------------------------------------------------------------
    op.execute(
        """
        UPDATE coord.tasks t
           SET work_unit_id = wu.id
          FROM coord.plans p
          JOIN coord.work_units wu ON wu.slug = p.slug
         WHERE t.plan_id = p.id
        """
    )

    # ------------------------------------------------------------------
    # 3. coord.gates — 3-way re-anchor. Count-independent SQL (the plan
    #    gate universe is larger than the 500-row /coord/gates window).
    # ------------------------------------------------------------------
    # 3a. RE-ANCHOR: a same-slug work_unit exists → move the anchor from
    #     plan_id to work_unit_id and NULL plan_id. CHECK-safe: arm 2 → arm 3.
    op.execute(
        """
        UPDATE coord.gates g
           SET work_unit_id = wu.id, plan_id = NULL
          FROM coord.work_units wu
          JOIN coord.plans p ON p.slug = wu.slug
         WHERE g.plan_id = p.id
           AND g.tenant_id = wu.tenant_id
        """
    )

    # 3b. DELETE terminal orphans: no same-slug work_unit AND verdict
    #     terminal (cleared/failed). NULLing plan_id would leave zero
    #     anchors → violate ck_gates_anchor; the work shipped so the gate
    #     is inert → DELETE.
    op.execute(
        """
        DELETE FROM coord.gates g
         WHERE g.plan_id IS NOT NULL
           AND g.verdict IN ('cleared','failed')
           AND NOT EXISTS (
                 SELECT 1
                   FROM coord.plans p
                   JOIN coord.work_units wu ON wu.slug = p.slug
                  WHERE p.id = g.plan_id
                    AND wu.tenant_id = g.tenant_id
           )
        """
    )

    # 3c. DELETE open orphans: no same-slug work_unit AND verdict NOT
    #     terminal. Stuck-open gates for already-shipped plans with no
    #     mirrored work_unit. (§4.2 HANDLE arm: if any is genuinely still
    #     gating live work at impl time, coord_work_unit_upsert its plan
    #     first so it falls into the RE-ANCHOR arm (3a) instead.)
    op.execute(
        """
        DELETE FROM coord.gates g
         WHERE g.plan_id IS NOT NULL
           AND g.verdict NOT IN ('cleared','failed')
           AND NOT EXISTS (
                 SELECT 1
                   FROM coord.plans p
                   JOIN coord.work_units wu ON wu.slug = p.slug
                  WHERE p.id = g.plan_id
                    AND wu.tenant_id = g.tenant_id
           )
        """
    )

    # ------------------------------------------------------------------
    # 4. Self-verifying post-condition (§4.2 go/no-go for Phase 4.3):
    #    NO gate may carry a non-NULL plan_id after the re-anchor. If any
    #    remains, the re-anchor was incomplete — RAISE to fail the
    #    migration rather than leave a silent partial state.
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$
        DECLARE
            leftover integer;
        BEGIN
            SELECT count(*) INTO leftover
              FROM coord.gates
             WHERE plan_id IS NOT NULL;
            IF leftover > 0 THEN
                RAISE EXCEPTION
                    'P4.2 re-anchor incomplete: % coord.gates rows still carry a non-NULL plan_id (expected 0)',
                    leftover;
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    # Best-effort reverse: drop the coord.tasks.work_unit_id index + column.
    #
    # NOTE: the data re-anchor is ONE-WAY and NOT restored here. The gate
    # RE-ANCHOR (plan_id → work_unit_id) could in principle be reversed by
    # slug, but the re-anchored rows have already lost their plan_id, and the
    # orphan-gate DELETEs (3b/3c) are irreversible — those rows are gone. A
    # real rollback of this migration is a restore-from-backup, not a
    # downgrade. This downgrade only removes the additive schema (column +
    # index) so the schema shape is reversible.
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_work_unit")
    op.execute("ALTER TABLE coord.tasks DROP COLUMN IF EXISTS work_unit_id")
