"""add_discovered_states_table

Revision ID: 20251125_112445
Revises: 20251124_projects_uuid
Create Date: 2025-11-25

This migration creates the discovered_states table for storing discovered
application states from both automation sessions and recordings.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251125_112445"
down_revision: str | None = "20251124_projects_uuid"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the discovered_states table."""
    # Check if table already exists
    from sqlalchemy import inspect

    bind = op.get_bind()
    inspector = inspect(bind)
    if "discovered_states" in inspector.get_table_names():
        return  # Table already exists, skip creation

    op.create_table(
        "discovered_states",
        # Primary key
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        # Source type and foreign keys
        sa.Column(
            "source_type",
            sa.String(50),
            nullable=False,
            comment="Source of discovery: 'automation_session' or 'recording'",
        ),
        sa.Column(
            "automation_session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("automation_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "recording_id",
            UUID(as_uuid=True),
            sa.ForeignKey("recordings.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # Legacy field for backward compatibility
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            nullable=True,
        ),
        # State identification
        sa.Column("state_id", sa.String(100), nullable=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("cluster_id", sa.Integer, nullable=True),
        # Confidence scores
        sa.Column("confidence", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("uniqueness_score", sa.Float, nullable=True),
        sa.Column("stability_score", sa.Float, nullable=True),
        sa.Column("distinctiveness_score", sa.Float, nullable=True),
        # Metadata
        sa.Column(
            "metadata",
            JSON,
            nullable=False,
            server_default="{}",
            comment="Additional state metadata",
        ),
        # Screenshot and frame data
        sa.Column(
            "screenshot_ids",
            ARRAY(UUID(as_uuid=True)),
            nullable=True,
            server_default="{}",
            comment="Screenshot IDs from automation sessions",
        ),
        sa.Column(
            "frame_ids",
            JSON,
            nullable=True,
            server_default="[]",
            comment="Frame IDs from recordings",
        ),
        sa.Column("frame_count", sa.Integer, nullable=True, server_default="0"),
        # State images
        sa.Column(
            "state_images",
            JSON,
            nullable=False,
            server_default="[]",
            comment="StateImage objects extracted for this state",
        ),
        # Visual elements (from recordings)
        sa.Column(
            "regions",
            JSON,
            nullable=True,
            server_default="[]",
        ),
        sa.Column(
            "locations",
            JSON,
            nullable=True,
            server_default="[]",
        ),
        sa.Column(
            "strings",
            JSON,
            nullable=True,
            server_default="[]",
        ),
        # Position on canvas (from recordings)
        sa.Column("position_x", sa.Float, nullable=True),
        sa.Column("position_y", sa.Float, nullable=True),
        # State properties (from recordings)
        sa.Column("is_initial", sa.Boolean, nullable=True, server_default="false"),
        sa.Column("is_error_state", sa.Boolean, nullable=True, server_default="false"),
        sa.Column("is_transient", sa.Boolean, nullable=True, server_default="false"),
        # Context (from recordings)
        sa.Column("window_context", JSON, nullable=True),
        sa.Column("url_context", sa.String, nullable=True),
        # User review (from recordings)
        sa.Column("user_edited", sa.Boolean, nullable=True, server_default="false"),
        sa.Column("user_approved", sa.Boolean, nullable=True, server_default="false"),
        sa.Column("user_notes", sa.Text, nullable=True),
        # Conversion to actual state (from recordings)
        sa.Column("converted_to_state_id", UUID(as_uuid=True), nullable=True),
        sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Constraints
        sa.CheckConstraint(
            "(automation_session_id IS NOT NULL AND recording_id IS NULL AND source_type = 'automation_session') OR "
            "(automation_session_id IS NULL AND recording_id IS NOT NULL AND source_type = 'recording')",
            name="check_single_source",
        ),
    )

    # Create indexes
    op.create_index(
        "ix_discovered_states_source_type",
        "discovered_states",
        ["source_type"],
    )
    op.create_index(
        "ix_discovered_states_automation_session_id",
        "discovered_states",
        ["automation_session_id"],
    )
    op.create_index(
        "ix_discovered_states_recording_id",
        "discovered_states",
        ["recording_id"],
    )


def downgrade() -> None:
    """Drop the discovered_states table."""
    op.drop_index("ix_discovered_states_recording_id", table_name="discovered_states")
    op.drop_index(
        "ix_discovered_states_automation_session_id", table_name="discovered_states"
    )
    op.drop_index("ix_discovered_states_source_type", table_name="discovered_states")
    op.drop_table("discovered_states")
