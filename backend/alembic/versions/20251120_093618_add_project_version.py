"""add_project_version

Revision ID: 20251120_093618
Revises: 20251119_225836
Create Date: 2025-11-20 09:36:18.000000

This migration adds a version column to the projects table to track
configuration changes over time. The version is auto-incremented on
every project update to enable optimistic locking and version history.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251120_093618"
down_revision: str | None = "20251119_225836"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add version column to projects table."""
    # Add version column with default value of 1
    op.add_column(
        "projects",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )

    # Set existing projects to version 1 (server_default handles this)
    # The server_default will be used for existing rows and new inserts


def downgrade() -> None:
    """Remove version column from projects table."""
    # Drop version column
    op.drop_column("projects", "version")
