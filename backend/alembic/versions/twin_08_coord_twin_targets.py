"""twin Ξ_Release — coord.twin_targets (per-tenant config) + release_observations.tenant_id

Revision ID: twin_08_coord_twin_targets
Revises: seed_hot_file_grammars
Create Date: 2026-06-03

Phase 3 (genericity) of
``plans/2026-06-01-twin-vercel-github-deployments-and-observer-genericity.md``.

This is the **expand** step of an expand/contract rollout (Q5/Q6/Q8). It lands
FIRST, on its own; only a LATER coord deploy rewrites ``configured_surfaces()``
to read this table and deletes the ``parse_*_env`` / ``default_*()`` paths.
Landing the code before this migration + seed would read an empty table and
black out qontinui's own twin (coverage 0 across every surface), so the order
is mandatory.

What it does:

1. ``coord.twin_targets`` — the per-tenant config table that replaces the
   hardcoded ``VERCEL_TEAM_SLUG`` / ``default_projects`` / ``default_services``
   / ``default_npm_packages`` Rust constants. One table with a ``surface``
   discriminator + nullable per-surface columns (Q7), mirroring the
   ``coord.tenant_repos`` template (FK ``tenant_id -> coord.tenants`` ON DELETE
   CASCADE, ``op.execute`` raw DDL, CHECK on the discriminator). PK
   ``(tenant_id, surface, target)`` matches the observer's per-``(surface,
   target)`` identity. ``coord.tenants`` is the existing tenant table; no new
   tenant concept.

2. ``coord.release_observations.tenant_id`` — a nullable column + partial index,
   backfilled to the ``personal-jspinak`` tenant (Q8). Without it, two tenants
   watching the same ``(surface, target)`` collide on the oplog key + the
   ``prior_deployed`` rollback SELECT. ON DELETE SET NULL — losing the tenant
   must not delete the append-only observation history.

3. Seed qontinui's own targets as rows for the ``personal-jspinak`` tenant — the
   exact set the deleted ``default_*()`` functions hardcoded (verified against
   ``qontinui-coord`` ``release_observer.rs`` / ``ecs_image_freshness_watcher.rs``
   / ``vercel_deploy_freshness_watcher.rs`` on origin/main 2026-06-03). Uses the
   ``coord_tenant_scope_columns`` / ``pr_merge_02`` ``INSERT ... SELECT
   tenant_id FROM coord.tenants WHERE slug = '<bootstrap>'`` idiom so a fresh dev
   DB lacking the tenant is a no-op rather than an error.

Schema-arg gate: every raw-SQL DDL names the ``coord`` schema
(``.pre-commit-hooks/check_alembic_schema_args.py``). ``ON CONFLICT (col)`` in a
plain string is accepted (the INDEX-ON regex is anchored on the full
``CREATE INDEX ... ON`` shape).

Idempotency: ``CREATE TABLE IF NOT EXISTS`` / ``ADD COLUMN IF NOT EXISTS`` /
``CREATE INDEX IF NOT EXISTS`` / ``ON CONFLICT DO NOTHING``. Re-running against an
already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_08_coord_twin_targets"
down_revision: str = "seed_hot_file_grammars"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The canonical bootstrap tenant every coord data table backfills to
# (coord_tenant_scope_columns.py). There is no "qontinui" slug.
_BOOTSTRAP_SLUG = "personal-jspinak"

# qontinui's Vercel team id — the previously-hardcoded VERCEL_TEAM_SLUG const
# (release_observer.rs:117), now a seeded per-row value.
_VERCEL_TEAM_ID = "team_QshrMW2BcfZGXlEiJFkP6hZj"


def upgrade() -> None:
    """Expand: create twin_targets, add release_observations.tenant_id, seed."""

    # -----------------------------------------------------------------
    # 1. coord.twin_targets — per-tenant twin observation config.
    #    surface ∈ {vercel, ecs, npm}; the per-surface columns are
    #    nullable and only meaningful for their own surface. PK
    #    (tenant_id, surface, target) == the observer's identity tuple.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.twin_targets (
            tenant_id               UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            surface                 TEXT        NOT NULL,
            target                  TEXT        NOT NULL,
            -- vercel + npm: "<org>/<repo>"
            github_repo             TEXT,
            -- vercel
            branch                  TEXT,
            root_directory          TEXT,
            vercel_team_id          TEXT,
            production_environment  TEXT,
            -- ecs
            ecs_cluster             TEXT,
            ecs_service             TEXT,
            ecr_repo                TEXT,
            expected_tag            TEXT,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, surface, target),
            CONSTRAINT twin_targets_surface_check
                CHECK (surface IN ('vercel', 'ecs', 'npm'))
        )
        """
    )

    # -----------------------------------------------------------------
    # 2. coord.release_observations.tenant_id — per-tenant attribution
    #    of the append-only oplog. Nullable + partial index (matches the
    #    coord_tenant_scope_columns posture). Backfill existing rows to
    #    the bootstrap tenant. ON DELETE SET NULL: the history outlives
    #    the tenant row.
    # -----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.release_observations
            ADD COLUMN IF NOT EXISTS tenant_id UUID
                REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_release_observations_tenant_id
            ON coord.release_observations (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )
    op.execute(
        f"""
        UPDATE coord.release_observations
           SET tenant_id = (
                   SELECT tenant_id FROM coord.tenants
                    WHERE slug = '{_BOOTSTRAP_SLUG}'
               )
         WHERE tenant_id IS NULL
        """
    )

    # -----------------------------------------------------------------
    # 3. Seed qontinui's own targets for the bootstrap tenant — the set
    #    the deleted default_*() functions hardcoded. One INSERT per row
    #    (each names only its surface's columns; omitted columns stay
    #    NULL) — avoids VALUES type-inference noise and reads cleanly.
    #    A missing bootstrap tenant (fresh dev DB) makes each a no-op.
    # -----------------------------------------------------------------

    # -- vercel --------------------------------------------------------
    op.execute(
        f"""
        INSERT INTO coord.twin_targets
            (tenant_id, surface, target, github_repo, branch,
             root_directory, vercel_team_id, production_environment)
        SELECT tenant_id, 'vercel', 'qontinui-web', 'qontinui/qontinui-web',
               'main', 'frontend', '{_VERCEL_TEAM_ID}', 'Production'
          FROM coord.tenants
         WHERE slug = '{_BOOTSTRAP_SLUG}'
        ON CONFLICT (tenant_id, surface, target) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO coord.twin_targets
            (tenant_id, surface, target, github_repo, branch,
             root_directory, vercel_team_id, production_environment)
        SELECT tenant_id, 'vercel', 'qontinui-cloud', 'qontinui/qontinui-cloud',
               'main', NULL, '{_VERCEL_TEAM_ID}', 'Production'
          FROM coord.tenants
         WHERE slug = '{_BOOTSTRAP_SLUG}'
        ON CONFLICT (tenant_id, surface, target) DO NOTHING
        """
    )

    # -- ecs -----------------------------------------------------------
    op.execute(
        f"""
        INSERT INTO coord.twin_targets
            (tenant_id, surface, target, ecs_cluster, ecs_service,
             ecr_repo, expected_tag)
        SELECT tenant_id, 'ecs', 'qontinui-staging/coord', 'qontinui-staging',
               'coord', 'qontinui-coord', 'staging'
          FROM coord.tenants
         WHERE slug = '{_BOOTSTRAP_SLUG}'
        ON CONFLICT (tenant_id, surface, target) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO coord.twin_targets
            (tenant_id, surface, target, ecs_cluster, ecs_service,
             ecr_repo, expected_tag)
        SELECT tenant_id, 'ecs', 'qontinui-staging/web', 'qontinui-staging',
               'web', 'qontinui-web-backend', 'staging'
          FROM coord.tenants
         WHERE slug = '{_BOOTSTRAP_SLUG}'
        ON CONFLICT (tenant_id, surface, target) DO NOTHING
        """
    )

    # -- npm -----------------------------------------------------------
    op.execute(
        f"""
        INSERT INTO coord.twin_targets
            (tenant_id, surface, target, github_repo)
        SELECT tenant_id, 'npm', '@qontinui/ui-bridge', 'qontinui/qontinui'
          FROM coord.tenants
         WHERE slug = '{_BOOTSTRAP_SLUG}'
        ON CONFLICT (tenant_id, surface, target) DO NOTHING
        """
    )


def downgrade() -> None:
    """Contract: drop the column/index/table. No data preservation —
    config regenerates from the table seed; the observations tenant_id is
    a derived attribution, not source data."""
    op.execute("DROP INDEX IF EXISTS coord.idx_release_observations_tenant_id")
    op.execute("ALTER TABLE coord.release_observations DROP COLUMN IF EXISTS tenant_id")
    op.execute("DROP TABLE IF EXISTS coord.twin_targets")
