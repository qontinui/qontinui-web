"""Add P1a auto-fresh fields to project.apps for fleet-fresh engine.

Revision ID: project_apps_p1a_auto_fresh_fields
Revises: coord_primary_trees_app_id_r0
Create Date: 2026-07-01 01:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "project_apps_p1a_auto_fresh_fields"
down_revision: str | None = "coord_primary_trees_app_id_r0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add auto-fresh engine fields to project.apps for P1a configuration."""
    # Add update_strategy column (pull_only | pull_build)
    op.add_column(
        "apps",
        sa.Column(
            "update_strategy",
            sa.String(),
            nullable=False,
            server_default="pull_only",
        ),
        schema="project",
    )

    # Add build_command column (optional, used when update_strategy=pull_build)
    op.add_column(
        "apps",
        sa.Column("build_command", sa.Text(), nullable=True),
        schema="project",
    )

    # Add start_command column (optional, used when update_strategy=pull_build)
    op.add_column(
        "apps",
        sa.Column("start_command", sa.Text(), nullable=True),
        schema="project",
    )


def downgrade() -> None:
    """Remove P1a auto-fresh fields from project.apps."""
    op.drop_column("apps", "start_command", schema="project")
    op.drop_column("apps", "build_command", schema="project")
    op.drop_column("apps", "update_strategy", schema="project")
