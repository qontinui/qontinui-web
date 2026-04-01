"""add render_log tables for development debugging

Revision ID: a1b2c3d4e5f6
Revises: dbde027209c0
Create Date: 2026-01-20 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "dbde027209c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create render logging tables for development debugging.

    These tables store DOM snapshots captured by the frontend for AI-assisted
    debugging. Only used in development mode (RENDER_LOG_ENABLED=True).
    """
    # Main render_logs table storing DOM snapshots
    op.create_table(
        "render_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(64), nullable=False, index=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("page_url", sa.String(512), nullable=False),
        sa.Column("page_title", sa.String(256), nullable=True),
        sa.Column(
            "trigger", sa.String(64), nullable=False
        ),  # 'mutation', 'navigation', 'manual', 'interval'
        sa.Column(
            "mutation_type", sa.String(32), nullable=True
        ),  # 'childList', 'attributes', 'characterData'
        sa.Column(
            "target_selector", sa.Text(), nullable=True
        ),  # CSS selector of mutated element
        # DOM snapshot as JSONB - contains full element tree with text, position, styling
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        # Viewport information
        sa.Column("viewport_width", sa.Integer(), nullable=True),
        sa.Column("viewport_height", sa.Integer(), nullable=True),
        sa.Column("scroll_x", sa.Integer(), nullable=True),
        sa.Column("scroll_y", sa.Integer(), nullable=True),
        # Performance metrics
        sa.Column("capture_duration_ms", sa.Integer(), nullable=True),
        sa.Column("element_count", sa.Integer(), nullable=True),
        # User context (if authenticated)
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Index for efficient querying by session and time
    op.create_index(
        "ix_render_logs_session_timestamp",
        "render_logs",
        ["session_id", "timestamp"],
    )

    # Index for querying by page URL
    op.create_index(
        "ix_render_logs_page_url",
        "render_logs",
        ["page_url"],
    )

    # Render images table - stores references to captured images
    op.create_table(
        "render_images",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("render_log_id", sa.Integer(), nullable=False),
        sa.Column(
            "image_type", sa.String(32), nullable=False
        ),  # 'screenshot', 'element', 'canvas'
        sa.Column(
            "element_selector", sa.Text(), nullable=True
        ),  # CSS selector if element capture
        sa.Column(
            "file_path", sa.String(512), nullable=False
        ),  # Path relative to RENDER_LOG_IMAGE_DIR
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        sa.Column("mime_type", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["render_log_id"], ["render_logs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Index for finding images by render log
    op.create_index(
        "ix_render_images_render_log_id",
        "render_images",
        ["render_log_id"],
    )


def downgrade() -> None:
    """Drop render logging tables."""
    op.drop_index("ix_render_images_render_log_id", table_name="render_images")
    op.drop_table("render_images")
    op.drop_index("ix_render_logs_page_url", table_name="render_logs")
    op.drop_index("ix_render_logs_session_timestamp", table_name="render_logs")
    op.drop_table("render_logs")
