"""add_automation_streaming_fields

Revision ID: 3dc9c2bf5574
Revises: 63e5da6dd826
Create Date: 2025-11-16 14:56:10.210449

This migration adds automation streaming fields to the users table to support
automation session limits and tracking.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3dc9c2bf5574"
down_revision: str | None = "63e5da6dd826"  # merge_migration_branches
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add automation streaming fields to users table."""
    # Use IF NOT EXISTS to handle production database that may already have these columns
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS automation_streaming_enabled BOOLEAN NOT NULL DEFAULT false
    """)

    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS automation_sessions_limit INTEGER
    """)

    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS automation_sessions_used INTEGER NOT NULL DEFAULT 0
    """)

    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS automation_sessions_reset_at TIMESTAMP WITH TIME ZONE
    """)

    # Create index if not exists
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_users_automation_streaming_enabled
        ON users (automation_streaming_enabled)
    """)


def downgrade() -> None:
    """Remove automation streaming fields from users table."""
    # Drop index first
    op.drop_index(op.f("ix_users_automation_streaming_enabled"), table_name="users")

    # Drop columns
    op.drop_column("users", "automation_sessions_reset_at")
    op.drop_column("users", "automation_sessions_used")
    op.drop_column("users", "automation_sessions_limit")
    op.drop_column("users", "automation_streaming_enabled")
