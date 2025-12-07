"""add_automation_tables_and_input_events

Revision ID: 67c33a12bedb
Revises: d703626068d7
Create Date: 2025-11-16 19:35:19.791385

This migration creates the complete automation infrastructure:
- automation_sessions: Automation workflow execution sessions
- automation_screenshots: Screenshot storage and metadata
- automation_input_events: Input events (mouse, keyboard) with detailed tracking
- screenshot_input_associations: Many-to-many linking between screenshots and events
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "67c33a12bedb"
down_revision: str | None = "63e5da6dd826"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create automation tables and input event tracking."""
    # Import bind and connection for table existence checks
    from sqlalchemy import inspect

    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    # Create automation_sessions table (if it doesn't exist)
    if "automation_sessions" not in existing_tables:
        op.create_table(
            "automation_sessions",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), nullable=False),
            sa.Column("workflow_name", sa.String(255), nullable=False),
            sa.Column("status", sa.String(50), nullable=False),
            sa.Column(
                "started_at",
                sa.TIMESTAMP(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("ended_at", sa.TIMESTAMP(), nullable=True),
            sa.Column(
                "created_at",
                sa.TIMESTAMP(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )

        # Create indexes for automation_sessions
        op.create_index(
            "ix_automation_sessions_id",
            "automation_sessions",
            ["id"],
        )
        op.create_index(
            "ix_automation_sessions_user_id",
            "automation_sessions",
            ["user_id"],
        )
        op.create_index(
            "ix_automation_sessions_user_started",
            "automation_sessions",
            ["user_id", "started_at"],
        )
        op.create_index(
            "ix_automation_sessions_status",
            "automation_sessions",
            ["status"],
        )

    # Create automation_screenshots table (if it doesn't exist)
    if "automation_screenshots" not in existing_tables:
        op.create_table(
            "automation_screenshots",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("session_id", UUID(as_uuid=True), nullable=False),
            sa.Column("s3_key", sa.String(512), nullable=False),
            sa.Column("timestamp", sa.TIMESTAMP(), nullable=False),
            sa.Column("screenshot_metadata", JSONB, nullable=True, server_default="{}"),
            sa.Column(
                "created_at",
                sa.TIMESTAMP(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["session_id"], ["automation_sessions.id"], ondelete="CASCADE"
            ),
        )

        # Create indexes for automation_screenshots
        op.create_index(
            "ix_automation_screenshots_id",
            "automation_screenshots",
            ["id"],
        )
        op.create_index(
            "ix_automation_screenshots_session_id",
            "automation_screenshots",
            ["session_id"],
        )
        op.create_index(
            "ix_automation_screenshots_session_timestamp",
            "automation_screenshots",
            ["session_id", "timestamp"],
        )

    # Create automation_input_events table (if it doesn't exist)
    if "automation_input_events" not in existing_tables:
        op.create_table(
            "automation_input_events",
            sa.Column(
                "id",
                sa.BigInteger(),
                primary_key=True,
                nullable=False,
                autoincrement=True,
            ),
            sa.Column("session_id", UUID(as_uuid=True), nullable=False),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("timestamp", sa.TIMESTAMP(), nullable=False),
            # Mouse event fields
            sa.Column("mouse_x", sa.Integer(), nullable=True),
            sa.Column("mouse_y", sa.Integer(), nullable=True),
            sa.Column("mouse_button", sa.String(20), nullable=True),
            # Drag event fields
            sa.Column("drag_from_x", sa.Integer(), nullable=True),
            sa.Column("drag_from_y", sa.Integer(), nullable=True),
            sa.Column("drag_to_x", sa.Integer(), nullable=True),
            sa.Column("drag_to_y", sa.Integer(), nullable=True),
            sa.Column("drag_duration", sa.Float(), nullable=True),
            sa.Column("drag_path_points", JSONB, nullable=True),
            sa.Column("drag_avg_speed", sa.Float(), nullable=True),
            sa.Column("drag_max_speed", sa.Float(), nullable=True),
            # Keyboard event fields
            sa.Column("text_typed", sa.Text(), nullable=True),
            sa.Column("character_count", sa.Integer(), nullable=True),
            # Screenshot references
            sa.Column("screenshot_before_id", UUID(as_uuid=True), nullable=True),
            sa.Column("screenshot_after_id", UUID(as_uuid=True), nullable=True),
            sa.Column(
                "created_at",
                sa.TIMESTAMP(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["session_id"], ["automation_sessions.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["screenshot_before_id"],
                ["automation_screenshots.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["screenshot_after_id"],
                ["automation_screenshots.id"],
                ondelete="SET NULL",
            ),
        )

        # Create indexes for automation_input_events
        op.create_index(
            "ix_automation_input_events_id",
            "automation_input_events",
            ["id"],
        )
        op.create_index(
            "ix_automation_input_events_session_id",
            "automation_input_events",
            ["session_id"],
        )
        op.create_index(
            "ix_automation_input_events_session_timestamp",
            "automation_input_events",
            ["session_id", "timestamp"],
        )
        op.create_index(
            "ix_automation_input_events_event_type",
            "automation_input_events",
            ["event_type"],
        )

    # Create screenshot_input_associations table (many-to-many) (if it doesn't exist)
    if "screenshot_input_associations" not in existing_tables:
        op.create_table(
            "screenshot_input_associations",
            sa.Column(
                "id",
                sa.BigInteger(),
                primary_key=True,
                nullable=False,
                autoincrement=True,
            ),
            sa.Column("screenshot_id", UUID(as_uuid=True), nullable=False),
            sa.Column("input_event_id", sa.BigInteger(), nullable=False),
            sa.Column("association_type", sa.String(20), nullable=False),
            sa.Column("time_delta_ms", sa.Integer(), nullable=True),
            sa.Column(
                "created_at",
                sa.TIMESTAMP(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["screenshot_id"], ["automation_screenshots.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["input_event_id"], ["automation_input_events.id"], ondelete="CASCADE"
            ),
        )

        # Create indexes for screenshot_input_associations
        op.create_index(
            "ix_screenshot_input_associations_id",
            "screenshot_input_associations",
            ["id"],
        )
        op.create_index(
            "ix_screenshot_input_associations_screenshot_id",
            "screenshot_input_associations",
            ["screenshot_id"],
        )
        op.create_index(
            "ix_screenshot_input_associations_input_event_id",
            "screenshot_input_associations",
            ["input_event_id"],
        )
        op.create_index(
            "ix_screenshot_input_assoc_screenshot_input",
            "screenshot_input_associations",
            ["screenshot_id", "input_event_id"],
        )
        op.create_index(
            "ix_screenshot_input_assoc_type",
            "screenshot_input_associations",
            ["association_type"],
        )


def downgrade() -> None:
    """Drop automation tables and input event tracking."""
    # Drop tables in reverse order (respecting foreign key constraints)
    op.drop_table("screenshot_input_associations")
    op.drop_table("automation_input_events")
    op.drop_table("automation_screenshots")
    op.drop_table("automation_sessions")
