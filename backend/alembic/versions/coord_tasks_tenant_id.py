"""coord.tasks tenant_id — re-anchor tasks off plan_id (P4 Phase 4.2)

Revision ID: coord_tasks_tenant_id
Revises: coord_prompt_injection_events
Create Date: 2026-07-05

P4 Phase 4.2 of ``2026-06-18-coord-decommission-markdown-plan-ingest``.

``coord.tasks`` is currently tenant-scoped SOLELY through
``plan_id -> coord.plans.tenant_id`` — an ``EXISTS``-join in the merge->done
reconciler (coord ``repo_branches.rs::mark_tasks_done_from_merge``). Before
``coord.plans`` can be dropped (Phase 4.3) ``coord.tasks`` needs its OWN tenant
column. This migration adds ``coord.tasks.tenant_id`` and backfills it from
``coord.plans`` across the existing ``plan_id`` FK.

Nullable, no FK — mirrors the ``coord.commit_lineage`` /
``coord.plan_pr_citations`` tenant_id convention (an equality-scoping column,
not a join key). Every existing task row has a NOT NULL ``plan_id`` FK into
``coord.plans`` (``ON DELETE CASCADE`` => no orphans) and ``coord.plans``
carries a NOT NULL ``tenant_id``, so the backfill covers 100% of rows. Left
nullable so the additive add stays lock-light and the coord read path (guarded
on the column's presence, and which treats a NULL tenant as "unscoped =>
matches nothing") degrades safely if any row is ever un-backfilled. Tightening
to NOT NULL is deferred to Phase 4.3 (when ``plan_id`` + ``coord.plans`` go).

Idempotent: ``ADD COLUMN IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS`` + a
backfill ``UPDATE`` that only touches rows whose ``tenant_id IS NULL``, so a
re-run (or a partially-applied prior run) converges.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_tasks_tenant_id"
down_revision: str = "coord_prompt_injection_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Additive column (nullable, no FK): the tenant scope coord.tasks
    #    currently borrows from coord.plans via plan_id.
    op.execute(
        """
        ALTER TABLE coord.tasks
            ADD COLUMN IF NOT EXISTS tenant_id UUID
        """
    )
    # 2. Backfill from coord.plans across the existing plan_id FK. Idempotent:
    #    only still-NULL rows are touched. coord.tasks.plan_id is NOT NULL and
    #    coord.plans.tenant_id is NOT NULL, so every existing row resolves.
    op.execute(
        """
        UPDATE coord.tasks AS t
           SET tenant_id = p.tenant_id
          FROM coord.plans AS p
         WHERE t.plan_id = p.id
           AND t.tenant_id IS NULL
        """
    )
    # 3. Partial index backing the tenant-scoped merge->done UPDATE predicate
    #    (coord repo_branches.rs::mark_tasks_done_from_merge, new path).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tasks_tenant
            ON coord.tasks(tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_tenant")
    op.execute("ALTER TABLE coord.tasks DROP COLUMN IF EXISTS tenant_id")
