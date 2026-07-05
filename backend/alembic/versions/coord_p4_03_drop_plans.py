"""coord — DROP coord.plans + coord.plan_status_history (P4 Phase 4.3)

Revision ID: coord_p4_03_drop_plans
Revises: coord_p4_02_reanchor_plan_gates
Create Date: 2026-07-05

Phase 4.3 of plan
``D:/qontinui-root/plans/2026-07-02-coord-plans-table-drop-phase4.md`` — the
FINAL, destructive phase of the plan-decoupling program. Drops the two
plan-model tables now that every prod reader has been retired.

## ⚠️ DEPLOY GATE — DO NOT MERGE/DEPLOY until BOTH hold

This migration DROPs ``coord.plans``. A deployed coord that still reads
``coord.plans`` would start erroring the instant this applies. Before this
merges + deploys, coord `origin/main` MUST carry **zero** ``coord.plans``
reads:

  1. **web #712 (`coord_p4_02_reanchor_plan_gates`) applied** — added +
     backfilled ``coord.tasks.work_unit_id`` and re-anchored the gates
     (``plan_id`` → ``work_unit_id``); the post-condition
     ``count(coord.gates WHERE plan_id IS NOT NULL) = 0`` PASSED on prod.
  2. **coord #960 (`mark_tasks_done` → work_unit_id) deployed AND the
     ``plan_id`` fallback removed** — #960 repointed the merge→done tenant
     scope onto ``work_unit_id`` but kept a NULL-safe ``EXISTS (… coord.plans
     …)`` fallback. That fallback is the LAST ``coord.plans`` read; the
     "remove all coord.plans reads" coord change (drops the #960 fallback +
     ``plan_registry::slug_by_id`` and its callers) MUST land + DEPLOY before
     this migration. Re-verify with
     ``git grep -n 'coord\\.plans' qontinui-coord/src`` → only ``#[cfg(test)]``
     seams / comments / the ``hot_file_grammars`` string remain.

Also re-verify immediately before deploy (the DROP-safety boundary):
``SELECT count(*) FROM coord.gates WHERE plan_id IS NOT NULL;`` = 0 (already
asserted by 4.2A, re-check for drift) and stage behind an RDS snapshot.

## What it drops

  * the ``coord.tasks.plan_id`` FK to ``coord.plans`` (bare UUID on gates has
    NO FK — nothing to drop there; the ``ck_gates_anchor`` ``plan_id`` arm is
    rewritten in Phase 4.4, not here) + the now-orphan ``coord.tasks.plan_id``
    column and its index (``coord.tasks`` is tenant-scoped via
    ``work_unit_id`` post-4.2);
  * ``coord.plan_status_history`` (FK child of ``coord.plans``);
  * ``coord.plans``.

``coord.plan_pr_citations`` keys ``coord.plans`` only by a SOFT slug-text FK
(no constraint) and survives independently — not dropped here.

## Reversibility

``downgrade`` recreates the table SCHEMAS (union of the original
``consolidation_phase2_v_28`` + ``coord_plans`` + ``coord_plans_ingested_status``
+ ``coord_tenant_scope_columns`` shapes) and re-adds the ``coord.tasks.plan_id``
column + FK, so the reversal gate's ``upgrade → downgrade -1 → upgrade`` round
trips on an empty DB. DATA is NOT restored — a real rollback is a
restore-from-snapshot, not a downgrade.

## House conventions

Raw ``op.execute`` with ``DROP … IF EXISTS`` / ``ADD COLUMN IF NOT EXISTS`` so
the migration is collision-safe. Reserve the slot via ``coord_migration_reserve``
(many live heads — the land-time re-point engine + alembic-graph CI are the
fork authority; this authors against the current head ``coord_p4_02_reanchor_plan_gates``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# RE-PARENTED 2026-07-05 onto the live head ``coord_expectation_probes_01``.
# Originally authored against ``coord_p4_02_reanchor_plan_gates`` (P4 4.2A), but
# ``coord_expectation_probes_01`` landed on top of that lineage since — it is now
# the single head and ``coord_p4_02_reanchor_plan_gates`` is an interior ancestor
# of it, so parenting there forked the graph. Re-pointing to the true head keeps
# a single linear chain. (No data dependency on expectation_probes.)
revision: str = "coord_p4_03_drop_plans"
down_revision: str | Sequence[str] | None = "coord_expectation_probes_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Drop the coord.tasks → coord.plans FK. Robust: resolve the constraint
    #    name dynamically (the auto-generated name may vary across environments)
    #    by finding the FK on coord.tasks that references coord.plans.
    op.execute(
        """
        DO $$
        DECLARE fk_name text;
        BEGIN
            SELECT tc.constraint_name
              INTO fk_name
              FROM information_schema.table_constraints tc
              JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
               AND tc.constraint_schema = ccu.constraint_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_schema = 'coord'
               AND tc.table_name = 'tasks'
               AND ccu.table_schema = 'coord'
               AND ccu.table_name = 'plans'
             LIMIT 1;
            IF fk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE coord.tasks DROP CONSTRAINT %I', fk_name);
            END IF;
        END $$;
        """
    )

    # 2. Drop the now-orphan coord.tasks.plan_id column + its index. (Tenant
    #    scope is coord.tasks.work_unit_id post-4.2; the #960 plan_id fallback
    #    must be gone by deploy time — see the DEPLOY GATE above.)
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_plan")
    op.execute("ALTER TABLE coord.tasks DROP COLUMN IF EXISTS plan_id")

    # 3. Drop coord.plan_status_history (FK child of coord.plans).
    op.execute("DROP INDEX IF EXISTS coord.idx_plan_status_history_plan")
    op.execute("DROP TABLE IF EXISTS coord.plan_status_history")

    # 4. Drop coord.plans. No CASCADE — if an unforeseen dependant remains the
    #    DROP fails LOUD rather than silently cascade-deleting it.
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_slug")
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_updated_at")
    op.execute("DROP TABLE IF EXISTS coord.plans")


def downgrade() -> None:
    # Recreate the table SCHEMAS (data NOT restored) so the reversal gate round
    # trips. Columns are the union of the original chain; NOT NULL is relaxed to
    # nullable where a backfill would otherwise be required (the reversal test
    # inserts no rows, so this is schema-faithful enough to re-drop).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plans (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            markdown_path   TEXT,
            version_hash    TEXT,
            status          TEXT NOT NULL DEFAULT 'draft',
            title           TEXT,
            summary         TEXT,
            slug            TEXT,
            content         TEXT,
            authored_by     TEXT,
            origin_path     TEXT,
            archive_path    TEXT,
            metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
            ingested_status TEXT,
            tenant_id       UUID,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plans_slug ON coord.plans(slug) WHERE slug IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plans_updated_at ON coord.plans(updated_at DESC)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plan_status_history (
            history_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plan_id          UUID NOT NULL
                REFERENCES coord.plans(id) ON DELETE CASCADE,
            from_status      TEXT,
            to_status        TEXT NOT NULL,
            transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            by_actor         TEXT,
            reason           TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_status_history_plan "
        "ON coord.plan_status_history(plan_id, transitioned_at DESC)"
    )

    # Re-add coord.tasks.plan_id (nullable, mirroring the post-emergent shape)
    # + its FK to coord.plans + index.
    op.execute("ALTER TABLE coord.tasks ADD COLUMN IF NOT EXISTS plan_id UUID")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_schema = 'coord'
                   AND table_name = 'tasks'
                   AND constraint_name = 'tasks_plan_id_fkey'
            ) THEN
                ALTER TABLE coord.tasks
                    ADD CONSTRAINT tasks_plan_id_fkey
                    FOREIGN KEY (plan_id) REFERENCES coord.plans(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_tasks_plan ON coord.tasks(plan_id)")
