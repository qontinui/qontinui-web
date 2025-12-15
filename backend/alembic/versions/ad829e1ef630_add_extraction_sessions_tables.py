"""add_extraction_sessions_tables

Revision ID: ad829e1ef630
Revises: 010a31065d3e
Create Date: 2025-12-08 09:38:35.146617

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ad829e1ef630"
down_revision: str | None = "010a31065d3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create extraction_sessions table
    op.create_table(
        "extraction_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_urls", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("config", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "stats",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_extraction_sessions_project_id", "extraction_sessions", ["project_id"]
    )
    op.create_index("ix_extraction_sessions_status", "extraction_sessions", ["status"])
    op.create_index(
        "ix_extraction_sessions_created_at", "extraction_sessions", ["created_at"]
    )

    # Create extraction_annotations table
    op.create_table(
        "extraction_annotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("screenshot_id", sa.String(100), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column(
            "viewport_width", sa.Integer(), nullable=False, server_default="1920"
        ),
        sa.Column(
            "viewport_height", sa.Integer(), nullable=False, server_default="1080"
        ),
        sa.Column(
            "elements",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "states",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["extraction_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_extraction_annotations_session_id", "extraction_annotations", ["session_id"]
    )
    op.create_index(
        "ix_extraction_annotations_screenshot_id",
        "extraction_annotations",
        ["screenshot_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_extraction_annotations_screenshot_id", table_name="extraction_annotations"
    )
    op.drop_index(
        "ix_extraction_annotations_session_id", table_name="extraction_annotations"
    )
    op.drop_table("extraction_annotations")

    op.drop_index("ix_extraction_sessions_created_at", table_name="extraction_sessions")
    op.drop_index("ix_extraction_sessions_status", table_name="extraction_sessions")
    op.drop_index("ix_extraction_sessions_project_id", table_name="extraction_sessions")
    op.drop_table("extraction_sessions")
