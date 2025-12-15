"""add_project_type_and_rag_config

Revision ID: b36e13627683
Revises: 44f3f852a84c
Create Date: 2025-12-11 04:57:53.537058

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b36e13627683"
down_revision: str | None = "44f3f852a84c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add project_type column with default value
    op.add_column(
        "projects",
        sa.Column(
            "project_type", sa.String(), nullable=False, server_default="traditional"
        ),
    )
    # Add rag_config column (nullable)
    op.add_column("projects", sa.Column("rag_config", sa.JSON(), nullable=True))
    # Create index on project_type
    op.create_index(
        op.f("ix_projects_project_type"), "projects", ["project_type"], unique=False
    )


def downgrade() -> None:
    # Drop index
    op.drop_index(op.f("ix_projects_project_type"), table_name="projects")
    # Drop columns
    op.drop_column("projects", "rag_config")
    op.drop_column("projects", "project_type")
