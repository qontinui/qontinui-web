"""add_capture_session_tables

Revision ID: 0105a6e182c5
Revises: 3fd23610e37f
Create Date: 2025-11-23 19:14:13.943874

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0105a6e182c5"
down_revision: Union[str, None] = "3fd23610e37f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create capture_sessions table
    op.create_table(
        "capture_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status", sa.String(length=50), nullable=False, server_default="capturing"
        ),
        sa.Column("extra_metadata", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create capture_screenshots table
    op.create_table(
        "capture_screenshots",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("image_url", sa.String(length=500), nullable=False),
        sa.Column("thumbnail_url", sa.String(length=500), nullable=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("extra_metadata", sa.JSON(), nullable=True),
        sa.Column(
            "analysis_status",
            sa.String(length=50),
            nullable=False,
            server_default="pending",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["capture_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create capture_actions table
    op.create_table(
        "capture_actions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("screenshot_id", sa.UUID(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("x", sa.Integer(), nullable=True),
        sa.Column("y", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("key", sa.String(length=50), nullable=True),
        sa.Column("button", sa.String(length=20), nullable=True),
        sa.Column("scroll_delta", sa.Integer(), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("extra_metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["screenshot_id"], ["capture_screenshots.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create capture_detected_elements table
    op.create_table(
        "capture_detected_elements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("screenshot_id", sa.UUID(), nullable=False),
        sa.Column("element_type", sa.String(length=50), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("properties", sa.JSON(), nullable=True),
        sa.Column("visual_hash", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["screenshot_id"], ["capture_screenshots.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create screenshot_state_matches table
    op.create_table(
        "screenshot_state_matches",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("screenshot_id", sa.UUID(), nullable=False),
        sa.Column("state_identifier", sa.String(length=255), nullable=False),
        sa.Column("state_metadata", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("matched_elements", sa.JSON(), nullable=False),
        sa.Column("is_confirmed", sa.Boolean(), nullable=True, default=None),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.ForeignKeyConstraint(
            ["screenshot_id"], ["capture_screenshots.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create learned_workflows table
    op.create_table(
        "learned_workflows",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("workflow_json", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column(
            "status", sa.String(length=50), nullable=False, server_default="draft"
        ),
        sa.Column("warnings", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewer_id", sa.UUID(), nullable=True),
        sa.Column("published_info", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["session_id"], ["capture_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table("learned_workflows")
    op.drop_table("screenshot_state_matches")
    op.drop_table("capture_detected_elements")
    op.drop_table("capture_actions")
    op.drop_table("capture_screenshots")
    op.drop_table("capture_sessions")
