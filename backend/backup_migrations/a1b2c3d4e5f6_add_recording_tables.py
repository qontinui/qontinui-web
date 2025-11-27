"""add_recording_tables

Revision ID: a1b2c3d4e5f6
Revises: 63e5da6dd826
Create Date: 2025-11-13 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "63e5da6dd826"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create recordings table
    op.create_table(
        "recordings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("created_by_id", UUID(as_uuid=True), nullable=False),
        # Recording metadata
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tags", JSONB, nullable=False, server_default="[]"),
        # Recording details
        sa.Column("recording_start_time", sa.DateTime(), nullable=False),
        sa.Column("recording_end_time", sa.DateTime(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        # Recorder information
        sa.Column("recorder_name", sa.String(), nullable=True),
        sa.Column("recorder_version", sa.String(), nullable=True),
        sa.Column("recorder_platform", sa.String(), nullable=True),
        # System information
        sa.Column("screen_width", sa.Integer(), nullable=False),
        sa.Column("screen_height", sa.Integer(), nullable=False),
        sa.Column("screen_dpi", sa.Integer(), nullable=True),
        sa.Column("os_name", sa.String(), nullable=True),
        sa.Column("os_version", sa.String(), nullable=True),
        sa.Column("locale", sa.String(), nullable=True),
        # Target application
        sa.Column("app_name", sa.String(), nullable=False),
        sa.Column("app_version", sa.String(), nullable=True),
        sa.Column("app_type", sa.String(), nullable=True),
        sa.Column("app_url", sa.String(), nullable=True),
        # Frame information
        sa.Column("frame_rate", sa.Float(), nullable=False),
        sa.Column("total_frames", sa.Integer(), nullable=False),
        sa.Column(
            "total_interactions", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "total_context_events", sa.Integer(), nullable=False, server_default="0"
        ),
        # Storage
        sa.Column("s3_bucket", sa.String(), nullable=True),
        sa.Column("s3_prefix", sa.String(), nullable=True),
        sa.Column("upload_size_bytes", sa.Integer(), nullable=True),
        # Processing status
        sa.Column(
            "status", sa.String(), nullable=False, server_default="uploaded", index=True
        ),
        sa.Column("processing_phase", sa.String(), nullable=True),
        sa.Column(
            "processing_progress", sa.Float(), nullable=False, server_default="0.0"
        ),
        sa.Column("processing_started_at", sa.DateTime(), nullable=True),
        sa.Column("processing_completed_at", sa.DateTime(), nullable=True),
        sa.Column("processing_error", sa.Text(), nullable=True),
        # Validation results
        sa.Column("validation_errors", JSONB, nullable=False, server_default="[]"),
        sa.Column("validation_warnings", JSONB, nullable=False, server_default="[]"),
        # Discovered state structure
        sa.Column(
            "discovered_states_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "discovered_transitions_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "discovered_workflows_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("discovery_confidence", sa.Float(), nullable=True),
        # User review status
        sa.Column("reviewed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("accepted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        # Timestamps
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        # Foreign keys
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
    )

    # Create indexes for recordings
    op.create_index(
        "ix_recordings_project_status", "recordings", ["project_id", "status"]
    )
    op.create_index("ix_recordings_created_at", "recordings", ["created_at"])

    # Create recording_frames table
    op.create_table(
        "recording_frames",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", UUID(as_uuid=True), nullable=False, index=True),
        # Frame identification
        sa.Column("frame_number", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("relative_time_ms", sa.Integer(), nullable=False),
        # Image storage
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("url_expires_at", sa.DateTime(), nullable=True),
        # Image properties
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("format", sa.String(), nullable=True),
        # Visual analysis results
        sa.Column("perceptual_hash", sa.String(), nullable=True),
        sa.Column(
            "phash_computed", sa.Boolean(), nullable=False, server_default="false"
        ),
        # Cluster assignment
        sa.Column("cluster_id", sa.Integer(), nullable=True),
        sa.Column("state_id", UUID(as_uuid=True), nullable=True),
        # Quality metrics
        sa.Column("sharpness", sa.Float(), nullable=True),
        sa.Column("brightness", sa.Float(), nullable=True),
        sa.Column("contrast", sa.Float(), nullable=True),
        # Window context
        sa.Column("window_title", sa.String(), nullable=True),
        sa.Column("window_bounds", JSONB, nullable=True),
        sa.Column("window_state", sa.String(), nullable=True),
        # Web context
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("page_title", sa.String(), nullable=True),
        # User annotations
        sa.Column("user_notes", sa.Text(), nullable=True),
        sa.Column("user_annotations", JSONB, nullable=True),
        # Foreign keys
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
    )

    # Create indexes for recording_frames
    op.create_index(
        "ix_recording_frames_recording_frame",
        "recording_frames",
        ["recording_id", "frame_number"],
    )
    op.create_index(
        "ix_recording_frames_recording_time",
        "recording_frames",
        ["recording_id", "relative_time_ms"],
    )
    op.create_index(
        "ix_recording_frames_cluster",
        "recording_frames",
        ["recording_id", "cluster_id"],
    )

    # Create recording_interactions table
    op.create_table(
        "recording_interactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", UUID(as_uuid=True), nullable=False, index=True),
        # Timing
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("relative_time_ms", sa.Integer(), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=True),
        # Interaction type
        sa.Column("interaction_type", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=True),
        # Mouse interactions
        sa.Column("x", sa.Integer(), nullable=True),
        sa.Column("y", sa.Integer(), nullable=True),
        sa.Column("button", sa.String(), nullable=True),
        sa.Column("click_count", sa.Integer(), nullable=False, server_default="1"),
        # Drag interactions
        sa.Column("start_x", sa.Integer(), nullable=True),
        sa.Column("start_y", sa.Integer(), nullable=True),
        sa.Column("end_x", sa.Integer(), nullable=True),
        sa.Column("end_y", sa.Integer(), nullable=True),
        sa.Column("drag_path", JSONB, nullable=True),
        # Keyboard interactions
        sa.Column("key", sa.String(), nullable=True),
        sa.Column("key_code", sa.Integer(), nullable=True),
        sa.Column("char", sa.String(), nullable=True),
        sa.Column("text", sa.String(), nullable=True),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False, server_default="false"),
        # Modifiers
        sa.Column("modifiers", JSONB, nullable=False, server_default="[]"),
        sa.Column("is_combo", sa.Boolean(), nullable=False, server_default="false"),
        # Scroll interactions
        sa.Column("scroll_delta_x", sa.Integer(), nullable=True),
        sa.Column("scroll_delta_y", sa.Integer(), nullable=True),
        sa.Column("scroll_direction", sa.String(), nullable=True),
        # Hover interactions
        sa.Column("hover_duration_ms", sa.Integer(), nullable=True),
        sa.Column("hover_triggered", sa.Boolean(), nullable=True),
        # Target element
        sa.Column("target_element", JSONB, nullable=True),
        # Metadata
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        # Processing results
        sa.Column("causes_state_change", sa.Boolean(), nullable=True),
        sa.Column("target_state_id", UUID(as_uuid=True), nullable=True),
        sa.Column("transition_id", UUID(as_uuid=True), nullable=True),
        # Foreign keys
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
    )

    # Create indexes for recording_interactions
    op.create_index(
        "ix_recording_interactions_recording_time",
        "recording_interactions",
        ["recording_id", "relative_time_ms"],
    )
    op.create_index(
        "ix_recording_interactions_type",
        "recording_interactions",
        ["recording_id", "interaction_type"],
    )

    # Create recording_contexts table
    op.create_table(
        "recording_contexts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", UUID(as_uuid=True), nullable=False, index=True),
        # Timing
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("relative_time_ms", sa.Integer(), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=True),
        # Event type
        sa.Column("event_type", sa.String(), nullable=False),
        # Window information
        sa.Column("window_title", sa.String(), nullable=True),
        sa.Column("process_name", sa.String(), nullable=True),
        sa.Column("process_id", sa.Integer(), nullable=True),
        sa.Column("window_bounds", JSONB, nullable=True),
        sa.Column("window_state", sa.String(), nullable=True),
        sa.Column("window_z_index", sa.Integer(), nullable=True),
        sa.Column("is_modal", sa.Boolean(), nullable=True),
        # Previous window
        sa.Column("previous_window", JSONB, nullable=True),
        # Web context
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("previous_url", sa.String(), nullable=True),
        sa.Column("page_title", sa.String(), nullable=True),
        sa.Column("domain", sa.String(), nullable=True),
        sa.Column("pathname", sa.String(), nullable=True),
        sa.Column("navigation_type", sa.String(), nullable=True),
        sa.Column("load_time_ms", sa.Integer(), nullable=True),
        sa.Column("load_complete", sa.Boolean(), nullable=True),
        # Focus information
        sa.Column("focused_element", JSONB, nullable=True),
        sa.Column("previous_focus", JSONB, nullable=True),
        # Application state
        sa.Column("app_state", JSONB, nullable=True),
        # Performance metrics
        sa.Column("cpu_usage", sa.Float(), nullable=True),
        sa.Column("memory_usage", sa.Integer(), nullable=True),
        sa.Column("network_activity", sa.Boolean(), nullable=True),
        sa.Column("is_loading", sa.Boolean(), nullable=True),
        # Metadata
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        # Foreign keys
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
    )

    # Create indexes for recording_contexts
    op.create_index(
        "ix_recording_contexts_recording_time",
        "recording_contexts",
        ["recording_id", "relative_time_ms"],
    )
    op.create_index(
        "ix_recording_contexts_type",
        "recording_contexts",
        ["recording_id", "event_type"],
    )

    # Create discovered_states table
    op.create_table(
        "discovered_states",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", UUID(as_uuid=True), nullable=False, index=True),
        # State identification
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cluster_id", sa.Integer(), nullable=True),
        # Visual elements
        sa.Column("state_images", JSONB, nullable=False, server_default="[]"),
        sa.Column("regions", JSONB, nullable=False, server_default="[]"),
        sa.Column("locations", JSONB, nullable=False, server_default="[]"),
        sa.Column("strings", JSONB, nullable=False, server_default="[]"),
        # Frames
        sa.Column("frame_ids", JSONB, nullable=False, server_default="[]"),
        sa.Column("frame_count", sa.Integer(), nullable=False, server_default="0"),
        # Position
        sa.Column("position_x", sa.Float(), nullable=True),
        sa.Column("position_y", sa.Float(), nullable=True),
        # State properties
        sa.Column("is_initial", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "is_error_state", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column("is_transient", sa.Boolean(), nullable=False, server_default="false"),
        # Confidence scores
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("uniqueness_score", sa.Float(), nullable=True),
        sa.Column("stability_score", sa.Float(), nullable=True),
        sa.Column("distinctiveness_score", sa.Float(), nullable=True),
        # Context
        sa.Column("window_context", JSONB, nullable=True),
        sa.Column("url_context", sa.String(), nullable=True),
        # User review
        sa.Column("user_edited", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "user_approved", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column("user_notes", sa.Text(), nullable=True),
        # Conversion
        sa.Column("converted_to_state_id", UUID(as_uuid=True), nullable=True),
        sa.Column("converted_at", sa.DateTime(), nullable=True),
        # Timestamps
        sa.Column("created_at", sa.DateTime(), nullable=False),
        # Foreign keys
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
    )

    # Create indexes for discovered_states
    op.create_index(
        "ix_discovered_states_recording", "discovered_states", ["recording_id"]
    )
    op.create_index(
        "ix_discovered_states_confidence", "discovered_states", ["confidence"]
    )

    # Add foreign key constraint for recording_frames.state_id
    op.create_foreign_key(
        "fk_recording_frames_state_id",
        "recording_frames",
        "discovered_states",
        ["state_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Create discovered_transitions table
    op.create_table(
        "discovered_transitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", UUID(as_uuid=True), nullable=False, index=True),
        # Transition definition
        sa.Column("from_state_id", UUID(as_uuid=True), nullable=False),
        sa.Column("to_state_id", UUID(as_uuid=True), nullable=True),
        # Multi-state support
        sa.Column("activate_state_ids", JSONB, nullable=False, server_default="[]"),
        sa.Column("deactivate_state_ids", JSONB, nullable=False, server_default="[]"),
        sa.Column(
            "stays_visible", sa.Boolean(), nullable=False, server_default="false"
        ),
        # Trigger information
        sa.Column("trigger_interaction_id", UUID(as_uuid=True), nullable=True),
        sa.Column("trigger_type", sa.String(), nullable=True),
        sa.Column("trigger_description", sa.Text(), nullable=True),
        # Timing
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("recommended_timeout_ms", sa.Integer(), nullable=True),
        sa.Column(
            "recommended_retry_count", sa.Integer(), nullable=False, server_default="3"
        ),
        # Generated workflow
        sa.Column("workflow", JSONB, nullable=True),
        sa.Column("workflow_name", sa.String(), nullable=True),
        # Confidence
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("clarity_score", sa.Float(), nullable=True),
        sa.Column("consistency_score", sa.Float(), nullable=True),
        sa.Column("completeness_score", sa.Float(), nullable=True),
        # Position
        sa.Column("position_x", sa.Float(), nullable=True),
        sa.Column("position_y", sa.Float(), nullable=True),
        # User review
        sa.Column("user_edited", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "user_approved", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column("user_notes", sa.Text(), nullable=True),
        # Conversion
        sa.Column("converted_to_transition_id", UUID(as_uuid=True), nullable=True),
        sa.Column("converted_at", sa.DateTime(), nullable=True),
        # Timestamps
        sa.Column("created_at", sa.DateTime(), nullable=False),
        # Foreign keys
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["from_state_id"], ["discovered_states.id"]),
        sa.ForeignKeyConstraint(["to_state_id"], ["discovered_states.id"]),
        sa.ForeignKeyConstraint(
            ["trigger_interaction_id"], ["recording_interactions.id"]
        ),
    )

    # Create indexes for discovered_transitions
    op.create_index(
        "ix_discovered_transitions_recording",
        "discovered_transitions",
        ["recording_id"],
    )
    op.create_index(
        "ix_discovered_transitions_from_state",
        "discovered_transitions",
        ["from_state_id"],
    )
    op.create_index(
        "ix_discovered_transitions_to_state", "discovered_transitions", ["to_state_id"]
    )

    # Add foreign key constraints for recording_interactions
    op.create_foreign_key(
        "fk_recording_interactions_target_state_id",
        "recording_interactions",
        "discovered_states",
        ["target_state_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_recording_interactions_transition_id",
        "recording_interactions",
        "discovered_transitions",
        ["transition_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Create processing_logs table
    op.create_table(
        "processing_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", UUID(as_uuid=True), nullable=False, index=True),
        # Log entry
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("phase", sa.String(), nullable=False),
        sa.Column("level", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        # Additional data
        sa.Column("data", JSONB, nullable=True),
        # Progress
        sa.Column("progress", sa.Float(), nullable=True),
        # Foreign keys
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
    )

    # Create indexes for processing_logs
    op.create_index(
        "ix_processing_logs_recording_time",
        "processing_logs",
        ["recording_id", "timestamp"],
    )
    op.create_index(
        "ix_processing_logs_phase", "processing_logs", ["recording_id", "phase"]
    )


def downgrade() -> None:
    # Drop processing_logs
    op.drop_index("ix_processing_logs_phase", table_name="processing_logs")
    op.drop_index("ix_processing_logs_recording_time", table_name="processing_logs")
    op.drop_table("processing_logs")

    # Drop discovered_transitions
    op.drop_constraint(
        "fk_recording_interactions_transition_id",
        "recording_interactions",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_discovered_transitions_to_state", table_name="discovered_transitions"
    )
    op.drop_index(
        "ix_discovered_transitions_from_state", table_name="discovered_transitions"
    )
    op.drop_index(
        "ix_discovered_transitions_recording", table_name="discovered_transitions"
    )
    op.drop_table("discovered_transitions")

    # Drop discovered_states
    op.drop_constraint(
        "fk_recording_interactions_target_state_id",
        "recording_interactions",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_recording_frames_state_id", "recording_frames", type_="foreignkey"
    )
    op.drop_index("ix_discovered_states_confidence", table_name="discovered_states")
    op.drop_index("ix_discovered_states_recording", table_name="discovered_states")
    op.drop_table("discovered_states")

    # Drop recording_contexts
    op.drop_index("ix_recording_contexts_type", table_name="recording_contexts")
    op.drop_index(
        "ix_recording_contexts_recording_time", table_name="recording_contexts"
    )
    op.drop_table("recording_contexts")

    # Drop recording_interactions
    op.drop_index("ix_recording_interactions_type", table_name="recording_interactions")
    op.drop_index(
        "ix_recording_interactions_recording_time", table_name="recording_interactions"
    )
    op.drop_table("recording_interactions")

    # Drop recording_frames
    op.drop_index("ix_recording_frames_cluster", table_name="recording_frames")
    op.drop_index("ix_recording_frames_recording_time", table_name="recording_frames")
    op.drop_index("ix_recording_frames_recording_frame", table_name="recording_frames")
    op.drop_table("recording_frames")

    # Drop recordings
    op.drop_index("ix_recordings_created_at", table_name="recordings")
    op.drop_index("ix_recordings_project_status", table_name="recordings")
    op.drop_table("recordings")
