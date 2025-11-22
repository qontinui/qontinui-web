"""add_organization_id_to_projects

Revision ID: 08e4e8448e57
Revises: a1b2c3d4e5f6
Create Date: 2025-11-16 13:48:36.945184

This migration adds organization_id column to the projects table to support
organization-based project ownership and management.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "08e4e8448e57"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add organization_id column to projects table."""
    # Add organization_id column as nullable for backward compatibility
    op.add_column(
        "projects",
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # Create foreign key constraint to organizations table
    op.create_foreign_key(
        "fk_projects_organization_id",
        "projects",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Create index on organization_id for query performance
    op.create_index("ix_projects_organization_id", "projects", ["organization_id"])


def downgrade() -> None:
    """Remove organization_id column from projects table."""
    # Drop index first
    op.drop_index("ix_projects_organization_id", table_name="projects")

    # Drop foreign key constraint
    op.drop_constraint("fk_projects_organization_id", "projects", type_="foreignkey")

    # Drop column
    op.drop_column("projects", "organization_id")
