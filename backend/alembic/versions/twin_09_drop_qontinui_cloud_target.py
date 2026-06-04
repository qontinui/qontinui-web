"""twin Ξ_Release — drop the dead qontinui-cloud Vercel target from coord.twin_targets

Revision ID: twin_09_drop_qontinui_cloud_target
Revises: page_spec_01_coord_page_spec_paths
Create Date: 2026-06-04

Data correction following the Phase 3 contract step
(plans/2026-06-01-twin-vercel-github-deployments-and-observer-genericity.md).

`twin_08` seeded qontinui's targets from the (now-deleted) hardcoded
`default_projects`, which included a stale `qontinui-cloud` Vercel project. The
repo `qontinui/qontinui-cloud` does NOT exist (GitHub GraphQL "could not
resolve"; deployments 404), so the live observer reads it as a *dark* surface
(drift_class=unknown, coverage 0) — verified on prod `/metrics` after the
contract deploy. That single dark target pulls the Vercel surface's reported
coverage to 0.0 (per-(tenant,surface) MIN), masking the healthy `qontinui-web`
reading. It was never actually watched pre-contract (prod env only listed
`qontinui-web`); seeding it from the stale default surfaced the noise.

Delete the row. `qontinui-web` (the real, live target) is unaffected. Reversible:
downgrade re-inserts the row for the `personal-jspinak` bootstrap tenant.

Schema-arg gate: no gated DDL (DELETE/INSERT only); `coord.twin_targets` is
schema-qualified. Idempotent: DELETE is a no-op if already gone;
`ON CONFLICT DO NOTHING` on the downgrade re-insert.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_09_drop_qontinui_cloud_target"
down_revision: str = "page_spec_01_coord_page_spec_paths"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The canonical bootstrap tenant the twin_08 seed used (coord_tenant_scope_columns).
_BOOTSTRAP_SLUG = "personal-jspinak"

# qontinui's Vercel team id (matches the twin_08 seed for a faithful re-insert).
_VERCEL_TEAM_ID = "team_QshrMW2BcfZGXlEiJFkP6hZj"


def upgrade() -> None:
    """Delete the dead qontinui-cloud Vercel target (repo does not exist)."""
    op.execute(
        """
        DELETE FROM coord.twin_targets
         WHERE surface = 'vercel'
           AND target  = 'qontinui-cloud'
        """
    )


def downgrade() -> None:
    """Re-insert the qontinui-cloud row for the bootstrap tenant (reverses the
    delete; the row is inert — the project does not exist)."""
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
