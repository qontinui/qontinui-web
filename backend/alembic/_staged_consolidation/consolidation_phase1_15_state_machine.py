"""consolidation phase1 15 state machine

Revision ID: consolidation_phase1_15_state_machine
Revises: consolidation_phase1_14_workflows_flows_cross
Create Date: 2026-04-29

Phase 1, batch 15: state machine, capture/thumbnails, log sources,
recordings, convergence, scheduler settings — all in ``project``.

- ``project.state_machine_configs`` (root for state-machine FKs).
- ``project.state_machine_states`` (FK→configs CASCADE).
- ``project.state_machine_transitions`` (FK→configs CASCADE).
- ``project.sm_capture_screenshots`` (FK→configs CASCADE; BYTEA WebP).
- ``project.sm_element_thumbnails`` (FK→configs CASCADE; composite PK).
- ``project.log_sources`` (no FKs).
- ``project.recordings`` (no FKs).
- ``project.recording_actions`` (FK→recordings CASCADE).
- ``project.recording_exports`` (FK→recordings CASCADE).
- ``project.convergence_snapshots`` (no FKs).
- ``project.scheduler_settings`` (singleton via CHECK id = 1).

Source: ``schema.pg.sql:1900-2112``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_15_state_machine"
down_revision: str = "consolidation_phase1_14_workflows_flows_cross"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "state_machine_configs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False, server_default=sa.text("'default'")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("render_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("element_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("include_html_ids", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )

    op.create_table(
        "state_machine_states",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "config_id",
            sa.Text(),
            sa.ForeignKey("project.state_machine_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("element_ids", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("render_ids", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.9")),
        sa.Column("acceptance_criteria", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("extra_metadata", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("domain_knowledge", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sm_states_config_id", "state_machine_states", ["config_id"], schema="project")

    op.create_table(
        "state_machine_transitions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "config_id",
            sa.Text(),
            sa.ForeignKey("project.state_machine_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("transition_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("from_states", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("activate_states", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("exit_states", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("actions", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("path_cost", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("stays_visible", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
        sa.Column("extra_metadata", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sm_transitions_config_id", "state_machine_transitions", ["config_id"], schema="project")

    op.create_table(
        "sm_capture_screenshots",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "config_id",
            sa.Text(),
            sa.ForeignKey("project.state_machine_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("capture_index", sa.Integer(), nullable=False),
        sa.Column("screenshot_webp", postgresql.BYTEA(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("element_bounds_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("fingerprint_hashes_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sm_screenshots_config", "sm_capture_screenshots", ["config_id"], schema="project")

    op.create_table(
        "sm_element_thumbnails",
        sa.Column(
            "config_id",
            sa.Text(),
            sa.ForeignKey("project.state_machine_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fingerprint_hash", sa.Text(), nullable=False),
        sa.Column("thumbnail_base64", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("config_id", "fingerprint_hash"),
        schema="project",
    )
    op.create_index("idx_sm_thumbnails_config", "sm_element_thumbnails", ["config_id"], schema="project")

    op.create_table(
        "log_sources",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("path_type", sa.Text(), nullable=True, server_default=sa.text("'file'")),
        sa.Column("format", sa.Text(), nullable=True, server_default=sa.text("'plaintext'")),
        sa.Column("parser", sa.Text(), nullable=True, server_default=sa.text("'generic'")),
        sa.Column("timestamp_pattern", sa.Text(), nullable=True),
        sa.Column("timezone", sa.Text(), nullable=True, server_default=sa.text("'local'")),
        sa.Column("error_patterns", sa.Text(), nullable=True),
        sa.Column("warning_patterns", sa.Text(), nullable=True),
        sa.Column("ignore_patterns", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("poll_interval_ms", sa.Integer(), nullable=True, server_default=sa.text("5000")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        schema="project",
    )
    op.create_index("idx_log_sources_name", "log_sources", ["name"], schema="project")
    op.create_index("idx_log_sources_enabled", "log_sources", ["enabled"], schema="project")

    op.create_table(
        "recordings",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("action_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("status", sa.Text(), nullable=True, server_default=sa.text("'recording'")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("browser_info", sa.Text(), nullable=True),
        sa.Column("tab_id", sa.Integer(), nullable=True),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_recordings_status", "recordings", ["status"], schema="project")
    op.create_index("idx_recordings_created_at", "recordings", ["created_at"], schema="project")
    op.create_index("idx_recordings_base_url", "recordings", ["base_url"], schema="project")

    op.create_table(
        "recording_actions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "recording_id",
            sa.Text(),
            sa.ForeignKey("project.recordings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("page_title", sa.Text(), nullable=True),
        sa.Column("target_json", sa.Text(), nullable=False),
        sa.Column("action_data_json", sa.Text(), nullable=True),
        sa.Column("screenshot_path", sa.Text(), nullable=True),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_recording_actions_recording_id", "recording_actions", ["recording_id"], schema="project")
    op.create_index("idx_recording_actions_sequence", "recording_actions", ["recording_id", "sequence_number"], schema="project")
    op.create_index("idx_recording_actions_action_type", "recording_actions", ["action_type"], schema="project")

    op.create_table(
        "recording_exports",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "recording_id",
            sa.Text(),
            sa.ForeignKey("project.recordings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("export_format", sa.Text(), nullable=False),
        sa.Column("script_content", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("options_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_recording_exports_recording_id", "recording_exports", ["recording_id"], schema="project")
    op.create_index("idx_recording_exports_format", "recording_exports", ["export_format"], schema="project")

    op.create_table(
        "convergence_snapshots",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("project_path", sa.Text(), nullable=True),
        sa.Column("scope", sa.Text(), nullable=False, server_default=sa.text("'workflow'")),
        sa.Column("convergence_score", sa.Float(), nullable=False),
        sa.Column("consecutive_clean_runs", sa.Integer(), nullable=False),
        sa.Column("novelty_score", sa.Float(), nullable=False),
        sa.Column("effective_fix_rate", sa.Float(), nullable=False),
        sa.Column("change_velocity", sa.Float(), nullable=False),
        sa.Column("total_fixes", sa.Integer(), nullable=False),
        sa.Column("effective_fixes", sa.Integer(), nullable=False),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_convergence_workflow", "convergence_snapshots", ["workflow_name"], schema="project")
    op.create_index("idx_convergence_project", "convergence_snapshots", ["project_path"], schema="project")
    op.create_index("idx_convergence_scope", "convergence_snapshots", ["scope"], schema="project")

    op.create_table(
        "scheduler_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("max_concurrent", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("default_auto_fix_on_failure", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timezone", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = 1", name="scheduler_settings_singleton"),
        schema="project",
    )


def downgrade() -> None:
    op.drop_table("scheduler_settings", schema="project")
    op.drop_table("convergence_snapshots", schema="project")
    op.drop_table("recording_exports", schema="project")
    op.drop_table("recording_actions", schema="project")
    op.drop_table("recordings", schema="project")
    op.drop_table("log_sources", schema="project")
    op.drop_table("sm_element_thumbnails", schema="project")
    op.drop_table("sm_capture_screenshots", schema="project")
    op.drop_table("state_machine_transitions", schema="project")
    op.drop_table("state_machine_states", schema="project")
    op.drop_table("state_machine_configs", schema="project")
