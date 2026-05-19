"""coord.plans schema evolution + coord.plan_status_history (Phase 2 substrate)

Revision ID: coord_plans
Revises: coord_primary_trees
Create Date: 2026-05-19

Phase 2 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

`coord.plans` already exists from `consolidation_phase2_v_28_productivity_plans_tasks.py`
as a thin pointer table (markdown_path, version_hash, status, title,
summary). Per Q7 resolution in the readiness plan, coord becomes the
canonical home for plan content — not just a pointer registry. This
revision evolves the existing schema:

  - Adds `slug`, `content`, `authored_by`, `origin_path`, `archive_path`,
    `metadata` columns to `coord.plans` (ADD COLUMN IF NOT EXISTS).
  - Adds an index on `slug` once backfilled (UNIQUE is deferred —
    backfill runs in coord-side `plan_ingest_worker` in a follow-up).
  - Creates `coord.plan_status_history` for the status-transition audit
    log. FK references `coord.plans(id)` (the existing PK) to preserve
    the existing `coord.tasks(plan_id) → coord.plans(id)` invariant.

Legacy columns (`markdown_path`, `version_hash`, `summary`) are left in
place for this revision; a follow-up cleanup revision drops them once
the `plan_ingest_worker` has migrated their content into `origin_path`
+ `metadata`. This is NOT a back-compat shim — it's a content-migration
sequencing concern (the data has to land in the new columns before the
old ones can be dropped).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_plans"
down_revision: str = "coord_primary_trees"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Evolve ``coord.plans`` + add ``coord.plan_status_history``. Idempotent."""
    # Phase 2 columns on existing coord.plans. ADD COLUMN IF NOT EXISTS
    # is PG 9.6+; canonical PG is far past that.
    op.execute(
        """
        ALTER TABLE coord.plans
            ADD COLUMN IF NOT EXISTS slug         TEXT,
            ADD COLUMN IF NOT EXISTS content      TEXT,
            ADD COLUMN IF NOT EXISTS authored_by  TEXT,
            ADD COLUMN IF NOT EXISTS origin_path  TEXT,
            ADD COLUMN IF NOT EXISTS archive_path TEXT,
            ADD COLUMN IF NOT EXISTS metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )
    # Slug index — coord.plans dashboard queries by slug. UNIQUE is
    # deferred until the plan_ingest_worker backfills rows.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plans_slug
            ON coord.plans(slug) WHERE slug IS NOT NULL
        """
    )
    # Recent-touch index for the dashboard's default sort.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plans_updated_at
            ON coord.plans(updated_at DESC)
        """
    )

    # plan_status_history — FK against existing coord.plans(id) PK.
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
        """
        CREATE INDEX IF NOT EXISTS idx_plan_status_history_plan
            ON coord.plan_status_history(plan_id, transitioned_at DESC)
        """
    )


def downgrade() -> None:
    """Reverse plan_status_history + drop Phase 2 columns."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_plan_status_history_plan"
    )
    op.execute("DROP TABLE IF EXISTS coord.plan_status_history")
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_updated_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_slug")
    op.execute(
        """
        ALTER TABLE coord.plans
            DROP COLUMN IF EXISTS metadata,
            DROP COLUMN IF EXISTS archive_path,
            DROP COLUMN IF EXISTS origin_path,
            DROP COLUMN IF EXISTS authored_by,
            DROP COLUMN IF EXISTS content,
            DROP COLUMN IF EXISTS slug
        """
    )
