"""add_project_id_to_automation_screenshots

Revision ID: c811d4fb1d00
Revises: 64cfd485302c
Create Date: 2025-11-20 16:03:02.497947

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c811d4fb1d00"
down_revision: Union[str, None] = "64cfd485302c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add project_id column to automation_screenshots table

    This allows automation screenshots to be associated with projects,
    enabling cross-referencing between automation runs and project data.
    """
    # Check if column already exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col["name"] for col in inspector.get_columns("automation_screenshots")]

    if "project_id" not in columns:
        # Add project_id column (nullable, since existing screenshots don't have projects)
        op.add_column(
            "automation_screenshots",
            sa.Column("project_id", sa.Integer(), nullable=True),
        )

        # Add foreign key constraint
        op.create_foreign_key(
            "fk_automation_screenshots_project_id",
            "automation_screenshots",
            "projects",
            ["project_id"],
            ["id"],
            ondelete="SET NULL",  # Keep screenshots if project is deleted
        )

        # Add index for faster queries
        op.create_index(
            "ix_automation_screenshots_project_id",
            "automation_screenshots",
            ["project_id"],
        )

        print("✓ Added project_id column to automation_screenshots table")
    else:
        print("⚠️  project_id column already exists in automation_screenshots, skipping")


def downgrade() -> None:
    """
    Remove project_id column from automation_screenshots table
    """
    # Drop index
    op.drop_index(
        "ix_automation_screenshots_project_id", table_name="automation_screenshots"
    )

    # Drop foreign key constraint
    op.drop_constraint(
        "fk_automation_screenshots_project_id",
        "automation_screenshots",
        type_="foreignkey",
    )

    # Drop column
    op.drop_column("automation_screenshots", "project_id")
