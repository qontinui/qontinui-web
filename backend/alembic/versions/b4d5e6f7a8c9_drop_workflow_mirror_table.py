"""drop project.workflows mirror table

Revision ID: b4d5e6f7a8c9
Revises: f3a4b5c6d7e8
Create Date: 2026-05-26

Phase 4 of the lossless-workflow-authoring plan removes the runner-authored
``project.workflows`` mirror subsystem. The canonical store is now
``project.unified_workflows`` (lossless ``definition`` JSONB, added in
``f3a4b5c6d7e8``), which makes the mirror table + its endpoints + its model
fully redundant. This migration drops the mirror table.

``downgrade()`` faithfully recreates the table (matching the
``remove_runner_tokens`` reversible-drop convention) from the original
``workflow_mirror_2026_05_23`` definition, so the migration is reversible.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b4d5e6f7a8c9"
down_revision: str = "f3a4b5c6d7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS project.workflows CASCADE")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names(schema="project")

    if "workflows" not in existing_tables:
        op.create_table(
            "workflows",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                comment="Mirrors runner's local UnifiedWorkflow.id.",
            ),
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                comment="Resolved server-side from the device JWT.",
            ),
            sa.Column(
                "device_id",
                postgresql.UUID(as_uuid=True),
                nullable=True,
                comment="The runner device that authored this mirror entry.",
            ),
            sa.Column(
                "owner_user_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
                comment="The operator that owns this workflow.",
            ),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column(
                "definition",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                comment="Full UnifiedWorkflow payload from the runner.",
            ),
            sa.Column(
                "runner_updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                comment="Runner's local mtime — used for last-write-wins.",
            ),
            sa.Column(
                "mirrored_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["device_id"],
                ["coord.devices.device_id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["owner_user_id"],
                ["auth.users.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            schema="project",
        )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_tenant_owner "
        "ON project.workflows (tenant_id, owner_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_tenant_id "
        "ON project.workflows (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_owner_user_id "
        "ON project.workflows (owner_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_workflows_category "
        "ON project.workflows (category)"
    )
