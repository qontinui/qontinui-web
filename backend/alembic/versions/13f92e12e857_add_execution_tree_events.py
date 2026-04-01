"""Add execution tree events.

Revision ID: 13f92e12e857
Revises: c3a2b1d4e5f6
Create Date: 2025-12-27 19:36:24.665279

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "13f92e12e857"
down_revision: Union[str, None] = "c3a2b1d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade database schema."""
    # Create tables in dependency order to avoid FK issues

    # 1. execution_tree_events - our main table (depends on execution_runs which exists)
    op.create_table(
        "execution_tree_events",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column(
            "event_type",
            sa.String(length=50),
            nullable=False,
            comment="Type of tree event (workflow_started, action_completed, etc.)",
        ),
        sa.Column(
            "node_id",
            sa.String(length=100),
            nullable=False,
            comment="Unique identifier of the node within this execution",
        ),
        sa.Column(
            "node_type",
            sa.String(length=20),
            nullable=False,
            comment="Type of node (workflow, action, transition)",
        ),
        sa.Column(
            "node_name",
            sa.String(length=255),
            nullable=False,
            comment="Display name of the node",
        ),
        sa.Column(
            "parent_node_id",
            sa.String(length=100),
            nullable=True,
            comment="Parent node ID, null for root nodes",
        ),
        sa.Column(
            "path",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Path from root to this node (list of PathElement objects)",
        ),
        sa.Column(
            "sequence",
            sa.Integer(),
            nullable=False,
            comment="Sequence number for event ordering within a run",
        ),
        sa.Column(
            "event_timestamp",
            sa.Float(),
            nullable=False,
            comment="When this event was emitted (Unix epoch in seconds)",
        ),
        sa.Column(
            "node_start_timestamp",
            sa.Float(),
            nullable=True,
            comment="When the node started (Unix epoch)",
        ),
        sa.Column(
            "node_end_timestamp",
            sa.Float(),
            nullable=True,
            comment="When the node completed (Unix epoch)",
        ),
        sa.Column(
            "duration_ms",
            sa.Float(),
            nullable=True,
            comment="Node duration in milliseconds",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            comment="Node status (pending, running, success, failed)",
        ),
        sa.Column(
            "error_message",
            sa.Text(),
            nullable=True,
            comment="Error message if the node failed",
        ),
        sa.Column(
            "active_states_before",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Active states before this event",
        ),
        sa.Column(
            "active_states_after",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Active states after this event",
        ),
        sa.Column(
            "states_changed",
            sa.Boolean(),
            nullable=False,
            comment="Whether the active states changed",
        ),
        sa.Column(
            "node_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Full node metadata including runtime data, timing, outcome, etc.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["execution_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_execution_tree_events_event_type"),
        "execution_tree_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_tree_events_run_id"),
        "execution_tree_events",
        ["run_id"],
        unique=False,
    )
    op.create_index(
        "ix_tree_events_run_event_type",
        "execution_tree_events",
        ["run_id", "event_type"],
        unique=False,
    )
    op.create_index(
        "ix_tree_events_run_node_id",
        "execution_tree_events",
        ["run_id", "node_id"],
        unique=False,
    )
    op.create_index(
        "ix_tree_events_run_node_type",
        "execution_tree_events",
        ["run_id", "node_type"],
        unique=False,
    )
    op.create_index(
        "ix_tree_events_run_sequence",
        "execution_tree_events",
        ["run_id", "sequence"],
        unique=False,
    )

    # 2. recordings (depends on projects, users - both exist)
    op.create_table(
        "recordings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("created_by_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("recording_start_time", sa.DateTime(), nullable=False),
        sa.Column("recording_end_time", sa.DateTime(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("recorder_name", sa.String(), nullable=True),
        sa.Column("recorder_version", sa.String(), nullable=True),
        sa.Column("recorder_platform", sa.String(), nullable=True),
        sa.Column("screen_width", sa.Integer(), nullable=False),
        sa.Column("screen_height", sa.Integer(), nullable=False),
        sa.Column("screen_dpi", sa.Integer(), nullable=True),
        sa.Column("os_name", sa.String(), nullable=True),
        sa.Column("os_version", sa.String(), nullable=True),
        sa.Column("locale", sa.String(), nullable=True),
        sa.Column("app_name", sa.String(), nullable=False),
        sa.Column("app_version", sa.String(), nullable=True),
        sa.Column("app_type", sa.String(), nullable=True),
        sa.Column("app_url", sa.String(), nullable=True),
        sa.Column("frame_rate", sa.Float(), nullable=False),
        sa.Column("total_frames", sa.Integer(), nullable=False),
        sa.Column("total_interactions", sa.Integer(), nullable=True),
        sa.Column("total_context_events", sa.Integer(), nullable=True),
        sa.Column("s3_bucket", sa.String(), nullable=True),
        sa.Column("s3_prefix", sa.String(), nullable=True),
        sa.Column("upload_size_bytes", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "UPLOADED",
                "VALIDATING",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
                name="recordingstatus",
            ),
            nullable=False,
        ),
        sa.Column(
            "processing_phase",
            sa.Enum(
                "FRAME_ANALYSIS",
                "STATE_IDENTIFICATION",
                "INTERACTION_PROCESSING",
                "TRANSITION_DISCOVERY",
                "STATE_MACHINE_ASSEMBLY",
                "OPTIMIZATION",
                "COMPLETED",
                name="processingphase",
            ),
            nullable=True,
        ),
        sa.Column("processing_progress", sa.Float(), nullable=True),
        sa.Column("processing_started_at", sa.DateTime(), nullable=True),
        sa.Column("processing_completed_at", sa.DateTime(), nullable=True),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column("validation_errors", sa.JSON(), nullable=True),
        sa.Column("validation_warnings", sa.JSON(), nullable=True),
        sa.Column("discovered_states_count", sa.Integer(), nullable=True),
        sa.Column("discovered_transitions_count", sa.Integer(), nullable=True),
        sa.Column("discovered_workflows_count", sa.Integer(), nullable=True),
        sa.Column("discovery_confidence", sa.Float(), nullable=True),
        sa.Column("reviewed", sa.Boolean(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("accepted", sa.Boolean(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_recordings_created_at", "recordings", ["created_at"], unique=False
    )
    op.create_index(
        op.f("ix_recordings_project_id"), "recordings", ["project_id"], unique=False
    )
    op.create_index(
        "ix_recordings_project_status",
        "recordings",
        ["project_id", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recordings_status"), "recordings", ["status"], unique=False
    )

    # 3. discovered_states (depends on recordings, automation_sessions - both exist)
    op.create_table(
        "discovered_states",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("automation_session_id", sa.UUID(), nullable=True),
        sa.Column("recording_id", sa.UUID(), nullable=True),
        sa.Column("session_id", sa.UUID(), nullable=True),
        sa.Column("state_id", sa.String(length=100), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cluster_id", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("uniqueness_score", sa.Float(), nullable=True),
        sa.Column("stability_score", sa.Float(), nullable=True),
        sa.Column("distinctiveness_score", sa.Float(), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}", nullable=False),
        sa.Column(
            "screenshot_ids", sa.ARRAY(sa.UUID()), server_default="{}", nullable=True
        ),
        sa.Column("frame_ids", sa.JSON(), server_default="[]", nullable=True),
        sa.Column("frame_count", sa.Integer(), nullable=True),
        sa.Column("state_images", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("regions", sa.JSON(), server_default="[]", nullable=True),
        sa.Column("locations", sa.JSON(), server_default="[]", nullable=True),
        sa.Column("strings", sa.JSON(), server_default="[]", nullable=True),
        sa.Column("position_x", sa.Float(), nullable=True),
        sa.Column("position_y", sa.Float(), nullable=True),
        sa.Column("is_initial", sa.Boolean(), nullable=True),
        sa.Column("is_error_state", sa.Boolean(), nullable=True),
        sa.Column("is_transient", sa.Boolean(), nullable=True),
        sa.Column("window_context", sa.JSON(), nullable=True),
        sa.Column("url_context", sa.String(), nullable=True),
        sa.Column("user_edited", sa.Boolean(), nullable=True),
        sa.Column("user_approved", sa.Boolean(), nullable=True),
        sa.Column("user_notes", sa.Text(), nullable=True),
        sa.Column("converted_to_state_id", sa.UUID(), nullable=True),
        sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(automation_session_id IS NOT NULL AND recording_id IS NULL AND source_type = 'automation_session') OR (automation_session_id IS NULL AND recording_id IS NOT NULL AND source_type = 'recording')",
            name="check_single_source",
        ),
        sa.ForeignKeyConstraint(
            ["automation_session_id"], ["automation_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_discovered_states_automation_session_id"),
        "discovered_states",
        ["automation_session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_discovered_states_recording_id"),
        "discovered_states",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_discovered_states_source_type"),
        "discovered_states",
        ["source_type"],
        unique=False,
    )

    # 4. recording_interactions (depends on recordings, discovered_states)
    # Note: Will add FK to discovered_transitions later to avoid circular dependency
    op.create_table(
        "recording_interactions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("relative_time_ms", sa.Integer(), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=True),
        sa.Column("interaction_type", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=True),
        sa.Column("x", sa.Integer(), nullable=True),
        sa.Column("y", sa.Integer(), nullable=True),
        sa.Column("button", sa.String(), nullable=True),
        sa.Column("click_count", sa.Integer(), nullable=True),
        sa.Column("start_x", sa.Integer(), nullable=True),
        sa.Column("start_y", sa.Integer(), nullable=True),
        sa.Column("end_x", sa.Integer(), nullable=True),
        sa.Column("end_y", sa.Integer(), nullable=True),
        sa.Column("drag_path", sa.JSON(), nullable=True),
        sa.Column("key", sa.String(), nullable=True),
        sa.Column("key_code", sa.Integer(), nullable=True),
        sa.Column("char", sa.String(), nullable=True),
        sa.Column("text", sa.String(), nullable=True),
        sa.Column("is_sensitive", sa.Boolean(), nullable=True),
        sa.Column("modifiers", sa.JSON(), nullable=True),
        sa.Column("is_combo", sa.Boolean(), nullable=True),
        sa.Column("scroll_delta_x", sa.Integer(), nullable=True),
        sa.Column("scroll_delta_y", sa.Integer(), nullable=True),
        sa.Column("scroll_direction", sa.String(), nullable=True),
        sa.Column("hover_duration_ms", sa.Integer(), nullable=True),
        sa.Column("hover_triggered", sa.Boolean(), nullable=True),
        sa.Column("target_element", sa.JSON(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("causes_state_change", sa.Boolean(), nullable=True),
        sa.Column("target_state_id", sa.UUID(), nullable=True),
        sa.Column("transition_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["target_state_id"],
            ["discovered_states.id"],
        ),
        # Note: transition_id FK added later after discovered_transitions is created
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_recording_interactions_recording_id"),
        "recording_interactions",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        "ix_recording_interactions_recording_time",
        "recording_interactions",
        ["recording_id", "relative_time_ms"],
        unique=False,
    )
    op.create_index(
        "ix_recording_interactions_type",
        "recording_interactions",
        ["recording_id", "interaction_type"],
        unique=False,
    )

    # 5. discovered_transitions (depends on recordings, discovered_states, recording_interactions)
    op.create_table(
        "discovered_transitions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("from_state_id", sa.UUID(), nullable=False),
        sa.Column("to_state_id", sa.UUID(), nullable=True),
        sa.Column("activate_state_ids", sa.JSON(), nullable=True),
        sa.Column("deactivate_state_ids", sa.JSON(), nullable=True),
        sa.Column("stays_visible", sa.Boolean(), nullable=True),
        sa.Column("trigger_interaction_id", sa.UUID(), nullable=True),
        sa.Column("trigger_type", sa.String(), nullable=True),
        sa.Column("trigger_description", sa.Text(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("recommended_timeout_ms", sa.Integer(), nullable=True),
        sa.Column("recommended_retry_count", sa.Integer(), nullable=True),
        sa.Column("workflow", sa.JSON(), nullable=True),
        sa.Column("workflow_name", sa.String(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("clarity_score", sa.Float(), nullable=True),
        sa.Column("consistency_score", sa.Float(), nullable=True),
        sa.Column("completeness_score", sa.Float(), nullable=True),
        sa.Column("position_x", sa.Float(), nullable=True),
        sa.Column("position_y", sa.Float(), nullable=True),
        sa.Column("user_edited", sa.Boolean(), nullable=True),
        sa.Column("user_approved", sa.Boolean(), nullable=True),
        sa.Column("user_notes", sa.Text(), nullable=True),
        sa.Column("converted_to_transition_id", sa.UUID(), nullable=True),
        sa.Column("converted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["from_state_id"],
            ["discovered_states.id"],
        ),
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["to_state_id"],
            ["discovered_states.id"],
        ),
        sa.ForeignKeyConstraint(
            ["trigger_interaction_id"],
            ["recording_interactions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_discovered_transitions_from_state",
        "discovered_transitions",
        ["from_state_id"],
        unique=False,
    )
    op.create_index(
        "ix_discovered_transitions_recording",
        "discovered_transitions",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_discovered_transitions_recording_id"),
        "discovered_transitions",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        "ix_discovered_transitions_to_state",
        "discovered_transitions",
        ["to_state_id"],
        unique=False,
    )

    # Now add the FK from recording_interactions to discovered_transitions
    op.create_foreign_key(
        "fk_recording_interactions_transition_id",
        "recording_interactions",
        "discovered_transitions",
        ["transition_id"],
        ["id"],
    )

    # 6. recording_frames (depends on recordings, discovered_states)
    op.create_table(
        "recording_frames",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("relative_time_ms", sa.Integer(), nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("url_expires_at", sa.DateTime(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("format", sa.String(), nullable=True),
        sa.Column("perceptual_hash", sa.String(), nullable=True),
        sa.Column("phash_computed", sa.Boolean(), nullable=True),
        sa.Column("cluster_id", sa.Integer(), nullable=True),
        sa.Column("state_id", sa.UUID(), nullable=True),
        sa.Column("sharpness", sa.Float(), nullable=True),
        sa.Column("brightness", sa.Float(), nullable=True),
        sa.Column("contrast", sa.Float(), nullable=True),
        sa.Column("window_title", sa.String(), nullable=True),
        sa.Column("window_bounds", sa.JSON(), nullable=True),
        sa.Column("window_state", sa.String(), nullable=True),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("page_title", sa.String(), nullable=True),
        sa.Column("user_notes", sa.Text(), nullable=True),
        sa.Column("user_annotations", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["state_id"],
            ["discovered_states.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_recording_frames_cluster",
        "recording_frames",
        ["recording_id", "cluster_id"],
        unique=False,
    )
    op.create_index(
        "ix_recording_frames_recording_frame",
        "recording_frames",
        ["recording_id", "frame_number"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recording_frames_recording_id"),
        "recording_frames",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        "ix_recording_frames_recording_time",
        "recording_frames",
        ["recording_id", "relative_time_ms"],
        unique=False,
    )

    # 7. recording_contexts (depends on recordings)
    op.create_table(
        "recording_contexts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("relative_time_ms", sa.Integer(), nullable=False),
        sa.Column("frame_number", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("window_title", sa.String(), nullable=True),
        sa.Column("process_name", sa.String(), nullable=True),
        sa.Column("process_id", sa.Integer(), nullable=True),
        sa.Column("window_bounds", sa.JSON(), nullable=True),
        sa.Column("window_state", sa.String(), nullable=True),
        sa.Column("window_z_index", sa.Integer(), nullable=True),
        sa.Column("is_modal", sa.Boolean(), nullable=True),
        sa.Column("previous_window", sa.JSON(), nullable=True),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("previous_url", sa.String(), nullable=True),
        sa.Column("page_title", sa.String(), nullable=True),
        sa.Column("domain", sa.String(), nullable=True),
        sa.Column("pathname", sa.String(), nullable=True),
        sa.Column("navigation_type", sa.String(), nullable=True),
        sa.Column("load_time_ms", sa.Integer(), nullable=True),
        sa.Column("load_complete", sa.Boolean(), nullable=True),
        sa.Column("focused_element", sa.JSON(), nullable=True),
        sa.Column("previous_focus", sa.JSON(), nullable=True),
        sa.Column("app_state", sa.JSON(), nullable=True),
        sa.Column("cpu_usage", sa.Float(), nullable=True),
        sa.Column("memory_usage", sa.Integer(), nullable=True),
        sa.Column("network_activity", sa.Boolean(), nullable=True),
        sa.Column("is_loading", sa.Boolean(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_recording_contexts_recording_id"),
        "recording_contexts",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        "ix_recording_contexts_recording_time",
        "recording_contexts",
        ["recording_id", "relative_time_ms"],
        unique=False,
    )
    op.create_index(
        "ix_recording_contexts_type",
        "recording_contexts",
        ["recording_id", "event_type"],
        unique=False,
    )

    # 8. processing_logs (depends on recordings)
    op.create_table(
        "processing_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column(
            "phase",
            sa.Enum(
                "FRAME_ANALYSIS",
                "STATE_IDENTIFICATION",
                "INTERACTION_PROCESSING",
                "TRANSITION_DISCOVERY",
                "STATE_MACHINE_ASSEMBLY",
                "OPTIMIZATION",
                "COMPLETED",
                name="processingphase",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("level", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("progress", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["recording_id"], ["recordings.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_processing_logs_phase",
        "processing_logs",
        ["recording_id", "phase"],
        unique=False,
    )
    op.create_index(
        op.f("ix_processing_logs_recording_id"),
        "processing_logs",
        ["recording_id"],
        unique=False,
    )
    op.create_index(
        "ix_processing_logs_recording_time",
        "processing_logs",
        ["recording_id", "timestamp"],
        unique=False,
    )

    # 9. state_transitions (depends on discovered_states)
    op.create_table(
        "state_transitions",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("from_state_id", sa.UUID(), nullable=False),
        sa.Column("to_state_id", sa.UUID(), nullable=False),
        sa.Column("trigger_event_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["from_state_id"], ["discovered_states.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["to_state_id"], ["discovered_states.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_state_transitions_from_state_id"),
        "state_transitions",
        ["from_state_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_state_transitions_to_state_id"),
        "state_transitions",
        ["to_state_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade database schema."""
    # Drop in reverse order
    op.drop_index(
        op.f("ix_state_transitions_to_state_id"), table_name="state_transitions"
    )
    op.drop_index(
        op.f("ix_state_transitions_from_state_id"), table_name="state_transitions"
    )
    op.drop_table("state_transitions")

    op.drop_index("ix_processing_logs_recording_time", table_name="processing_logs")
    op.drop_index(op.f("ix_processing_logs_recording_id"), table_name="processing_logs")
    op.drop_index("ix_processing_logs_phase", table_name="processing_logs")
    op.drop_table("processing_logs")

    op.drop_index("ix_recording_contexts_type", table_name="recording_contexts")
    op.drop_index(
        "ix_recording_contexts_recording_time", table_name="recording_contexts"
    )
    op.drop_index(
        op.f("ix_recording_contexts_recording_id"), table_name="recording_contexts"
    )
    op.drop_table("recording_contexts")

    op.drop_index("ix_recording_frames_recording_time", table_name="recording_frames")
    op.drop_index(
        op.f("ix_recording_frames_recording_id"), table_name="recording_frames"
    )
    op.drop_index("ix_recording_frames_recording_frame", table_name="recording_frames")
    op.drop_index("ix_recording_frames_cluster", table_name="recording_frames")
    op.drop_table("recording_frames")

    # Drop FK before dropping discovered_transitions
    op.drop_constraint(
        "fk_recording_interactions_transition_id",
        "recording_interactions",
        type_="foreignkey",
    )

    op.drop_index(
        "ix_discovered_transitions_to_state", table_name="discovered_transitions"
    )
    op.drop_index(
        op.f("ix_discovered_transitions_recording_id"),
        table_name="discovered_transitions",
    )
    op.drop_index(
        "ix_discovered_transitions_recording", table_name="discovered_transitions"
    )
    op.drop_index(
        "ix_discovered_transitions_from_state", table_name="discovered_transitions"
    )
    op.drop_table("discovered_transitions")

    op.drop_index("ix_recording_interactions_type", table_name="recording_interactions")
    op.drop_index(
        "ix_recording_interactions_recording_time", table_name="recording_interactions"
    )
    op.drop_index(
        op.f("ix_recording_interactions_recording_id"),
        table_name="recording_interactions",
    )
    op.drop_table("recording_interactions")

    op.drop_index(
        op.f("ix_discovered_states_source_type"), table_name="discovered_states"
    )
    op.drop_index(
        op.f("ix_discovered_states_recording_id"), table_name="discovered_states"
    )
    op.drop_index(
        op.f("ix_discovered_states_automation_session_id"),
        table_name="discovered_states",
    )
    op.drop_table("discovered_states")

    op.drop_index(op.f("ix_recordings_status"), table_name="recordings")
    op.drop_index("ix_recordings_project_status", table_name="recordings")
    op.drop_index(op.f("ix_recordings_project_id"), table_name="recordings")
    op.drop_index("ix_recordings_created_at", table_name="recordings")
    op.drop_table("recordings")

    op.drop_index("ix_tree_events_run_sequence", table_name="execution_tree_events")
    op.drop_index("ix_tree_events_run_node_type", table_name="execution_tree_events")
    op.drop_index("ix_tree_events_run_node_id", table_name="execution_tree_events")
    op.drop_index("ix_tree_events_run_event_type", table_name="execution_tree_events")
    op.drop_index(
        op.f("ix_execution_tree_events_run_id"), table_name="execution_tree_events"
    )
    op.drop_index(
        op.f("ix_execution_tree_events_event_type"), table_name="execution_tree_events"
    )
    op.drop_table("execution_tree_events")

    # Drop enums
    sa.Enum(name="recordingstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="processingphase").drop(op.get_bind(), checkfirst=True)
