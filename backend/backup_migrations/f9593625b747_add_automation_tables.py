"""Add automation tables

Revision ID: f9593625b747
Revises: collaboration_001
Create Date: 2025-11-14 20:33:00.000000

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "f9593625b747"
down_revision = "collaboration_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create automation_sessions table
    op.create_table(
        "automation_sessions",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("runner_version", sa.String(length=100), nullable=False),
        sa.Column("runner_os", sa.String(length=100), nullable=False),
        sa.Column("runner_hostname", sa.String(length=255), nullable=False),
        sa.Column(
            "status", sa.String(length=50), nullable=False, server_default="active"
        ),
        sa.Column(
            "configuration_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_automation_sessions_project_id"),
        "automation_sessions",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_sessions_user_id"),
        "automation_sessions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_sessions_status"),
        "automation_sessions",
        ["status"],
        unique=False,
    )

    # Create automation_logs table
    op.create_table(
        "automation_logs",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(length=50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "log_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["automation_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_automation_logs_session_id"),
        "automation_logs",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_logs_level"), "automation_logs", ["level"], unique=False
    )
    op.create_index(
        op.f("ix_automation_logs_timestamp"),
        "automation_logs",
        ["timestamp"],
        unique=False,
    )
    op.create_index(
        "ix_automation_logs_session_sequence",
        "automation_logs",
        ["session_id", "sequence_number"],
        unique=False,
    )
    op.create_index(
        "ix_automation_logs_event_type",
        "automation_logs",
        ["log_data"],
        unique=False,
        postgresql_using="gin",
    )

    # Create automation_screenshots table
    op.create_table(
        "automation_screenshots",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column(
            "content_type",
            sa.String(length=100),
            nullable=False,
            server_default="image/png",
        ),
        sa.Column(
            "automation_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("presigned_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["automation_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_automation_screenshots_session_id"),
        "automation_screenshots",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_screenshots_name"),
        "automation_screenshots",
        ["name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_screenshots_timestamp"),
        "automation_screenshots",
        ["timestamp"],
        unique=False,
    )

    # Create screenshot_input_associations table
    op.create_table(
        "screenshot_input_associations",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("screenshot_id", sa.UUID(), nullable=False),
        sa.Column("log_id", sa.UUID(), nullable=False),
        sa.Column("input_type", sa.String(length=100), nullable=False),
        sa.Column(
            "input_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("timestamp_diff_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["screenshot_id"], ["automation_screenshots.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["log_id"], ["automation_logs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_screenshot_input_associations_input_type"),
        "screenshot_input_associations",
        ["input_type"],
        unique=False,
    )
    op.create_index(
        "ix_screenshot_input_assoc_screenshot",
        "screenshot_input_associations",
        ["screenshot_id"],
        unique=False,
    )
    op.create_index(
        "ix_screenshot_input_assoc_log",
        "screenshot_input_associations",
        ["log_id"],
        unique=False,
    )


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index(
        "ix_screenshot_input_assoc_log", table_name="screenshot_input_associations"
    )
    op.drop_index(
        "ix_screenshot_input_assoc_screenshot",
        table_name="screenshot_input_associations",
    )
    op.drop_index(
        op.f("ix_screenshot_input_associations_input_type"),
        table_name="screenshot_input_associations",
    )
    op.drop_table("screenshot_input_associations")

    op.drop_index(
        op.f("ix_automation_screenshots_timestamp"), table_name="automation_screenshots"
    )
    op.drop_index(
        op.f("ix_automation_screenshots_name"), table_name="automation_screenshots"
    )
    op.drop_index(
        op.f("ix_automation_screenshots_session_id"),
        table_name="automation_screenshots",
    )
    op.drop_table("automation_screenshots")

    op.drop_index("ix_automation_logs_event_type", table_name="automation_logs")
    op.drop_index("ix_automation_logs_session_sequence", table_name="automation_logs")
    op.drop_index(op.f("ix_automation_logs_timestamp"), table_name="automation_logs")
    op.drop_index(op.f("ix_automation_logs_level"), table_name="automation_logs")
    op.drop_index(op.f("ix_automation_logs_session_id"), table_name="automation_logs")
    op.drop_table("automation_logs")

    op.drop_index(
        op.f("ix_automation_sessions_status"), table_name="automation_sessions"
    )
    op.drop_index(
        op.f("ix_automation_sessions_project_id"), table_name="automation_sessions"
    )
    op.drop_table("automation_sessions")
