"""add_analytics_tracking

Revision ID: 8d5f2a3c1b9e
Revises: 7b3c9d1e2f4a
Create Date: 2025-10-24 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8d5f2a3c1b9e"
down_revision: str | None = "7b3c9d1e2f4a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create analytics_events table
    op.create_table(
        "analytics_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("event_name", sa.String(255), nullable=False, index=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("properties", JSONB, nullable=False, server_default="{}"),
        sa.Column("timestamp", sa.DateTime(), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )

    # Create composite indexes for efficient queries
    op.create_index(
        "ix_analytics_events_name_timestamp",
        "analytics_events",
        ["event_name", "timestamp"],
    )
    op.create_index(
        "ix_analytics_events_user_name", "analytics_events", ["user_id", "event_name"]
    )
    op.create_index(
        "ix_analytics_events_timestamp_desc",
        "analytics_events",
        [sa.text("timestamp DESC")],
    )

    # Add analytics tracking fields to users table
    op.add_column(
        "users",
        sa.Column("login_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column(
            "remember_me_usage_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(), nullable=True))
    op.add_column(
        "users", sa.Column("last_device_fingerprint", sa.Text(), nullable=True)
    )

    # Create index on last_login_at for efficient queries
    op.create_index("ix_users_last_login_at", "users", ["last_login_at"])


def downgrade() -> None:
    # Drop indexes on users table
    op.drop_index("ix_users_last_login_at", table_name="users")

    # Drop columns from users table
    op.drop_column("users", "last_device_fingerprint")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "remember_me_usage_count")
    op.drop_column("users", "login_count")

    # Drop analytics_events indexes
    op.drop_index("ix_analytics_events_timestamp_desc", table_name="analytics_events")
    op.drop_index("ix_analytics_events_user_name", table_name="analytics_events")
    op.drop_index("ix_analytics_events_name_timestamp", table_name="analytics_events")

    # Drop analytics_events table
    op.drop_table("analytics_events")
