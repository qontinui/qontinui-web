"""add_runner_name_to_runner_connection

Revision ID: f6a3533afdd8
Revises: e34e1d177ed8
Create Date: 2025-11-28 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a3533afdd8"
down_revision: Union[str, None] = "e34e1d177ed8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add runner_name column to runner_connections table
    # This allows users to set a custom name for their runner in the desktop app
    op.add_column(
        "runner_connections",
        sa.Column(
            "runner_name",
            sa.String(length=255),
            nullable=True,
            comment="Custom user-defined name for this runner (e.g., 'My Laptop')",
        ),
    )


def downgrade() -> None:
    op.drop_column("runner_connections", "runner_name")
