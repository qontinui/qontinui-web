"""Drop project.design_policies — the store had no reader outside its own editor.

Revision ID: design_policies_02_drop
Revises: coord_policy_outcome_counts_02
Create Date: 2026-11-21

Plan ``2026-11-19-design-surface-defects-and-stale-records-found-by-the-design-loop-study``
Phase 2. The design-policies store (``design_policies_01``) was read only by its
own editor on ``/admin/coord/policies``; the served prompt documents
(``policy/ux-priorities``, ``domain_spec/visual-system``) already carry the
rules, so the store is deleted rather than kept beside them.

Before this revision was written, every production row was exported read-only
(2026-11-21): 14 rows across 2 tenants, all seven built-ins per tenant, none
custom and none edited from the seed — so dropping the table loses no
tenant-authored content.

The downgrade recreates the table exactly as ``design_policies_01`` created it
(empty; the built-ins were seeded lazily by the deleted CRUD layer).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "design_policies_02_drop"
down_revision: str | None = "coord_policy_outcome_counts_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("design_policies", schema="project")


def downgrade() -> None:
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
