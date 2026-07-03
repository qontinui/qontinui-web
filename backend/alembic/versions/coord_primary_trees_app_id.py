"""Add app_id to coord.primary_trees for fleet-fresh test-target routing.

Revision ID: coord_primary_trees_app_id_r0
Revises: devenv_03_coord_device_bridge
Create Date: 2026-07-01 01:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_primary_trees_app_id_r0"
down_revision: str | None = "devenv_03_coord_device_bridge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add app_id column to coord.primary_trees for fleet-fresh routing."""
    # Add app_id column to coord.primary_trees
    op.add_column(
        "primary_trees",
        sa.Column("app_id", sa.Text(), nullable=True),
        schema="coord",
    )

    # Add index on app_id for dispatcher fan-out queries
    op.create_index(
        "ix_primary_trees_app_id",
        "primary_trees",
        ["app_id"],
        schema="coord",
    )


def downgrade() -> None:
    """Remove app_id column and index from coord.primary_trees."""
    op.drop_index(
        "ix_primary_trees_app_id",
        table_name="primary_trees",
        schema="coord",
    )
    op.drop_column("primary_trees", "app_id", schema="coord")
