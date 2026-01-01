"""add_timezone_to_runner_connection_timestamps

Revision ID: d082ecd43831
Revises: 13f92e12e857
Create Date: 2025-12-31 19:40:52.804123

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d082ecd43831"
down_revision: Union[str, None] = "13f92e12e857"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add timezone awareness to runner_connections timestamp columns
    # This fixes "can't subtract offset-naive and offset-aware datetimes" error
    # in the connection cleanup task
    op.alter_column(
        "runner_connections",
        "connected_at",
        existing_type=postgresql.TIMESTAMP(),
        type_=sa.DateTime(timezone=True),
        existing_comment="When the WebSocket connection was established",
        existing_nullable=False,
    )
    op.alter_column(
        "runner_connections",
        "disconnected_at",
        existing_type=postgresql.TIMESTAMP(),
        type_=sa.DateTime(timezone=True),
        existing_comment="When the WebSocket connection was closed",
        existing_nullable=True,
    )


def downgrade() -> None:
    # Revert to naive timestamps (not recommended)
    op.alter_column(
        "runner_connections",
        "disconnected_at",
        existing_type=sa.DateTime(timezone=True),
        type_=postgresql.TIMESTAMP(),
        existing_comment="When the WebSocket connection was closed",
        existing_nullable=True,
    )
    op.alter_column(
        "runner_connections",
        "connected_at",
        existing_type=sa.DateTime(timezone=True),
        type_=postgresql.TIMESTAMP(),
        existing_comment="When the WebSocket connection was established",
        existing_nullable=False,
    )
