"""populate_project_organization_ids

Revision ID: b1c2d3e4f5g6
Revises: 08e4e8448e57
Create Date: 2025-11-16 14:00:00.000000

This data migration populates the organization_id field for existing projects
by assigning them to their owner's personal organization.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5g6"
down_revision: str | None = "08e4e8448e57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """
    Populate organization_id for existing projects.

    This migration:
    1. Finds each project's owner
    2. Looks up the owner's personal organization
    3. Sets the project's organization_id to that organization
    """
    connection = op.get_bind()

    # Update projects to reference their owner's personal organization
    # This uses a SQL UPDATE with a subquery to find the personal org
    connection.execute(
        sa.text(
            """
            UPDATE projects p
            SET organization_id = (
                SELECT o.id
                FROM organizations o
                WHERE o.owner_id = p.owner_id
                AND (o.slug LIKE '%-personal%' OR o.slug LIKE '%-personal-%')
                LIMIT 1
            )
            WHERE p.organization_id IS NULL
            AND EXISTS (
                SELECT 1
                FROM organizations o
                WHERE o.owner_id = p.owner_id
                AND (o.slug LIKE '%-personal%' OR o.slug LIKE '%-personal-%')
            )
        """
        )
    )

    # Log how many projects were updated
    result = connection.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM projects
            WHERE organization_id IS NOT NULL
        """
        )
    )
    projects_with_org = result.fetchone()[0]

    result = connection.execute(sa.text("SELECT COUNT(*) FROM projects"))
    total_projects = result.fetchone()[0]

    print(f"Updated {projects_with_org}/{total_projects} projects with organization_id")

    # Warn about any projects without an organization
    result = connection.execute(
        sa.text(
            """
            SELECT id, name, owner_id
            FROM projects
            WHERE organization_id IS NULL
            LIMIT 10
        """
        )
    )
    orphaned_projects = result.fetchall()

    if orphaned_projects:
        print(
            f"\nWARNING: {len(orphaned_projects)} projects could not be assigned to an organization:"
        )
        for project in orphaned_projects:
            print(
                f"  Project ID: {project[0]}, Name: {project[1]}, Owner ID: {project[2]}"
            )
        print("\nThese projects' owners may not have personal organizations yet.")
        print(
            "Run the migrate_to_organizations.py script to create missing personal organizations."
        )


def downgrade() -> None:
    """
    Clear organization_id for projects.

    This sets all project organization_id values back to NULL.
    """
    connection = op.get_bind()

    # Clear organization_id from all projects
    connection.execute(
        sa.text(
            """
            UPDATE projects
            SET organization_id = NULL
            WHERE organization_id IS NOT NULL
        """
        )
    )

    print("Cleared organization_id from all projects")
