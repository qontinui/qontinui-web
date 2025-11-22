"""add_automation_streaming_fields

Revision ID: 3dc9c2bf5574
Revises: collaboration_001
Create Date: 2025-11-16 14:56:10.210449

This migration adds automation streaming fields to the users table to support
automation session limits and tracking.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3dc9c2bf5574"
down_revision: str | None = "collaboration_001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add automation streaming fields to users table."""
    # Add automation_streaming_enabled column
    op.add_column(
        "users",
        sa.Column(
            "automation_streaming_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # Add automation_sessions_limit column (nullable = unlimited)
    op.add_column(
        "users",
        sa.Column("automation_sessions_limit", sa.Integer(), nullable=True),
    )

    # Add automation_sessions_used column
    op.add_column(
        "users",
        sa.Column(
            "automation_sessions_used",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # Add automation_sessions_reset_at column
    op.add_column(
        "users",
        sa.Column(
            "automation_sessions_reset_at", sa.DateTime(timezone=True), nullable=True
        ),
    )

    # Create index on automation_streaming_enabled for fast lookups
    op.create_index(
        op.f("ix_users_automation_streaming_enabled"),
        "users",
        ["automation_streaming_enabled"],
        unique=False,
    )


def downgrade() -> None:
    """Remove automation streaming fields from users table."""
    # Drop index first
    op.drop_index(op.f("ix_users_automation_streaming_enabled"), table_name="users")

    # Drop columns
    op.drop_column("users", "automation_sessions_reset_at")
    op.drop_column("users", "automation_sessions_used")
    op.drop_column("users", "automation_sessions_limit")
    op.drop_column("users", "automation_streaming_enabled")
