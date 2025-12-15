"""add_project_screenshots_and_images_tables

Revision ID: e8a009465904
Revises: 2276b3bf54c8
Create Date: 2025-12-07 20:35:39.993374

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8a009465904"
down_revision: str | None = "2276b3bf54c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create project_screenshots table
    op.create_table(
        "project_screenshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("s3_key", sa.String(length=500), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("capture_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("monitor_index", sa.Integer(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["capture_session_id"], ["capture_sessions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for project_screenshots
    op.create_index(
        op.f("ix_project_screenshots_project_id"),
        "project_screenshots",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_project_screenshots_user_id"),
        "project_screenshots",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_project_screenshots_source"),
        "project_screenshots",
        ["source"],
        unique=False,
    )
    op.create_index(
        op.f("ix_project_screenshots_created_at"),
        "project_screenshots",
        ["created_at"],
        unique=False,
    )

    # Create project_images table
    op.create_table(
        "project_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("s3_key", sa.String(length=500), nullable=False),
        sa.Column("mask_s3_key", sa.String(length=500), nullable=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("source_screenshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "source_region", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_screenshot_id"], ["project_screenshots.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for project_images
    op.create_index(
        op.f("ix_project_images_project_id"),
        "project_images",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_project_images_user_id"), "project_images", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_project_images_source"), "project_images", ["source"], unique=False
    )
    op.create_index(
        op.f("ix_project_images_source_screenshot_id"),
        "project_images",
        ["source_screenshot_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_project_images_created_at"),
        "project_images",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    # Drop project_images table and its indexes
    op.drop_index(op.f("ix_project_images_created_at"), table_name="project_images")
    op.drop_index(
        op.f("ix_project_images_source_screenshot_id"), table_name="project_images"
    )
    op.drop_index(op.f("ix_project_images_source"), table_name="project_images")
    op.drop_index(op.f("ix_project_images_user_id"), table_name="project_images")
    op.drop_index(op.f("ix_project_images_project_id"), table_name="project_images")
    op.drop_table("project_images")

    # Drop project_screenshots table and its indexes
    op.drop_index(
        op.f("ix_project_screenshots_created_at"), table_name="project_screenshots"
    )
    op.drop_index(
        op.f("ix_project_screenshots_source"), table_name="project_screenshots"
    )
    op.drop_index(
        op.f("ix_project_screenshots_user_id"), table_name="project_screenshots"
    )
    op.drop_index(
        op.f("ix_project_screenshots_project_id"), table_name="project_screenshots"
    )
    op.drop_table("project_screenshots")
