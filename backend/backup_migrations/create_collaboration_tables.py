"""Create collaboration tables for real-time collaboration features

Revision ID: collaboration_001
Revises:
Create Date: 2025-11-14

Creates tables for:
- project_locks: Resource locking for concurrent editing
- project_comments: Comments and discussions
- activity_logs: Activity tracking for real-time updates
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "collaboration_001"
down_revision = None  # Update this to point to your latest migration
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create collaboration tables."""

    # Create resource_type enum
    op.execute("""
        CREATE TYPE resourcetype AS ENUM (
            'workflow', 'state', 'image', 'transition', 'action', 'project'
        )
    """)

    # Create action_type enum
    op.execute("""
        CREATE TYPE actiontype AS ENUM (
            'created', 'modified', 'deleted', 'shared', 'commented',
            'locked', 'unlocked', 'viewed', 'exported', 'imported'
        )
    """)

    # Create project_locks table
    op.create_table(
        "project_locks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "resource_type",
            postgresql.ENUM(
                "workflow",
                "state",
                "image",
                "transition",
                "action",
                "project",
                name="resourcetype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("resource_id", sa.String(), nullable=False),
        sa.Column("acquired_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column(
            "auto_release", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for project_locks
    op.create_index("ix_project_locks_project_id", "project_locks", ["project_id"])
    op.create_index("ix_project_locks_user_id", "project_locks", ["user_id"])
    op.create_index("ix_project_locks_resource_id", "project_locks", ["resource_id"])
    op.create_index("ix_project_locks_expires_at", "project_locks", ["expires_at"])

    # Create project_comments table
    op.create_table(
        "project_comments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.String(), nullable=True),
        sa.Column("action_id", sa.String(), nullable=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("position", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("mentions", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("parent_comment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["parent_comment_id"], ["project_comments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for project_comments
    op.create_index(
        "ix_project_comments_project_id", "project_comments", ["project_id"]
    )
    op.create_index(
        "ix_project_comments_workflow_id", "project_comments", ["workflow_id"]
    )
    op.create_index("ix_project_comments_action_id", "project_comments", ["action_id"])
    op.create_index("ix_project_comments_author_id", "project_comments", ["author_id"])
    op.create_index(
        "ix_project_comments_parent_comment_id",
        "project_comments",
        ["parent_comment_id"],
    )
    op.create_index("ix_project_comments_resolved", "project_comments", ["resolved"])
    op.create_index(
        "ix_project_comments_created_at", "project_comments", ["created_at"]
    )

    # Create activity_logs table
    op.create_table(
        "activity_logs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "action_type",
            postgresql.ENUM(
                "created",
                "modified",
                "deleted",
                "shared",
                "commented",
                "locked",
                "unlocked",
                "viewed",
                "exported",
                "imported",
                name="actiontype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "resource_type",
            postgresql.ENUM(
                "workflow",
                "state",
                "image",
                "transition",
                "action",
                "project",
                name="resourcetype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("resource_id", sa.String(), nullable=False),
        sa.Column("resource_name", sa.String(), nullable=True),
        sa.Column("changes", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for activity_logs
    op.create_index("ix_activity_logs_project_id", "activity_logs", ["project_id"])
    op.create_index("ix_activity_logs_user_id", "activity_logs", ["user_id"])
    op.create_index("ix_activity_logs_action_type", "activity_logs", ["action_type"])
    op.create_index("ix_activity_logs_resource_id", "activity_logs", ["resource_id"])
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"])

    # Create composite indexes for common queries
    op.create_index(
        "ix_project_locks_project_resource",
        "project_locks",
        ["project_id", "resource_id"],
    )
    op.create_index(
        "ix_activity_logs_project_created",
        "activity_logs",
        ["project_id", "created_at"],
    )


def downgrade() -> None:
    """Drop collaboration tables."""

    # Drop indexes first
    op.drop_index("ix_activity_logs_project_created", table_name="activity_logs")
    op.drop_index("ix_project_locks_project_resource", table_name="project_locks")

    op.drop_index("ix_activity_logs_created_at", table_name="activity_logs")
    op.drop_index("ix_activity_logs_resource_id", table_name="activity_logs")
    op.drop_index("ix_activity_logs_action_type", table_name="activity_logs")
    op.drop_index("ix_activity_logs_user_id", table_name="activity_logs")
    op.drop_index("ix_activity_logs_project_id", table_name="activity_logs")

    op.drop_index("ix_project_comments_created_at", table_name="project_comments")
    op.drop_index("ix_project_comments_resolved", table_name="project_comments")
    op.drop_index(
        "ix_project_comments_parent_comment_id", table_name="project_comments"
    )
    op.drop_index("ix_project_comments_author_id", table_name="project_comments")
    op.drop_index("ix_project_comments_action_id", table_name="project_comments")
    op.drop_index("ix_project_comments_workflow_id", table_name="project_comments")
    op.drop_index("ix_project_comments_project_id", table_name="project_comments")

    op.drop_index("ix_project_locks_expires_at", table_name="project_locks")
    op.drop_index("ix_project_locks_resource_id", table_name="project_locks")
    op.drop_index("ix_project_locks_user_id", table_name="project_locks")
    op.drop_index("ix_project_locks_project_id", table_name="project_locks")

    # Drop tables
    op.drop_table("activity_logs")
    op.drop_table("project_comments")
    op.drop_table("project_locks")

    # Drop enums
    op.execute("DROP TYPE actiontype")
    op.execute("DROP TYPE resourcetype")
