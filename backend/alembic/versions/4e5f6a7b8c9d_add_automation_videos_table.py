"""add_automation_videos_table

Revision ID: 4e5f6a7b8c9d
Revises: 3dc9c2bf5574
Create Date: 2025-11-16 18:00:00.000000

This migration adds the automation_videos table to store video recordings
from automation sessions with S3 storage and metadata.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "4e5f6a7b8c9d"
down_revision: str | None = "3dc9c2bf5574"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add automation_videos table."""
    op.create_table(
        "automation_videos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("fps", sa.Integer(), nullable=True),
        sa.Column("quality", sa.String(), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for performance
    op.create_index(
        op.f("ix_automation_videos_id"),
        "automation_videos",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_videos_session_id"),
        "automation_videos",
        ["session_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_automation_videos_user_id"),
        "automation_videos",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_videos_project_id"),
        "automation_videos",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_automation_videos_s3_key"),
        "automation_videos",
        ["s3_key"],
        unique=True,
    )


def downgrade() -> None:
    """Remove automation_videos table."""
    op.drop_index(op.f("ix_automation_videos_s3_key"), table_name="automation_videos")
    op.drop_index(
        op.f("ix_automation_videos_project_id"), table_name="automation_videos"
    )
    op.drop_index(op.f("ix_automation_videos_user_id"), table_name="automation_videos")
    op.drop_index(
        op.f("ix_automation_videos_session_id"), table_name="automation_videos"
    )
    op.drop_index(op.f("ix_automation_videos_id"), table_name="automation_videos")
    op.drop_table("automation_videos")
