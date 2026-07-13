"""project.design_policies — tenant-scoped user-authored design/UX policies.

Revision ID: design_policies_01
Revises: coord_policy_rules_tenant_override
Create Date: 2026-07-02

Advisory design guidance authored by tenant admins and read tool-agnostically
by AI agents / CI over ``GET /api/v1/design-policies``. Distinct from
``coord.policy_rules`` (runtime automations the decision engine executes) — this
is a first-party web table following the ``project.finding_category_configs``
pattern, tenant-scoped rather than user-scoped.

Raw ``op.execute`` with ``IF NOT EXISTS`` — the collision-safe convention used
across the project/coord migrations.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "design_policies_01"
down_revision: str | None = "coord_policy_rules_tenant_override"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS project")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.design_policies (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL,
            slug         VARCHAR(100) NOT NULL,
            name         VARCHAR(255) NOT NULL,
            principle    TEXT NOT NULL DEFAULT '',
            rationale    TEXT NOT NULL DEFAULT '',
            enforcement  TEXT NOT NULL DEFAULT '',
            category     VARCHAR(50) NOT NULL DEFAULT '',
            severity     VARCHAR(20) NOT NULL DEFAULT 'info',
            applies_to   VARCHAR(255) NOT NULL DEFAULT '',
            is_built_in  BOOLEAN NOT NULL DEFAULT false,
            sort_order   INTEGER NOT NULL DEFAULT 0,
            enabled      BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by   VARCHAR(255),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by   VARCHAR(255),
            CONSTRAINT uq_design_policy_tenant_slug UNIQUE (tenant_id, slug)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_project_design_policies_tenant_id
            ON project.design_policies (tenant_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS project.design_policies")
