"""unified_execution_tables

Revision ID: c3a2b1d4e5f6
Revises: b2c9e1f34a56
Create Date: 2025-12-26 12:00:00.000000

Creates unified execution tracking tables:
- execution_runs: Unified run tracking (replaces software_test_runs + automation_sessions)
- action_executions: Unified action tracking (replaces transition_executions + automation_logs)
- execution_screenshots: Unified screenshots (replaces test_screenshots + automation_screenshots)
- execution_issues: Unified issues (replaces test_deficiencies + detected_issues)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c3a2b1d4e5f6"
down_revision: str | None = "b2c9e1f34a56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Enum definitions
run_type_enum = postgresql.ENUM(
    "qa_test",
    "integration_test",
    "live_automation",
    "recording",
    "debug",
    name="execution_run_type",
    create_type=False,
)

run_status_enum = postgresql.ENUM(
    "pending",
    "running",
    "completed",
    "failed",
    "timeout",
    "cancelled",
    "paused",
    name="execution_run_status",
    create_type=False,
)

action_type_enum = postgresql.ENUM(
    "find",
    "click",
    "double_click",
    "right_click",
    "type",
    "key_press",
    "scroll",
    "drag",
    "hover",
    "wait",
    "screenshot",
    "go_to_state",
    "assert_state",
    "assert_element",
    "custom",
    name="action_execution_type",
    create_type=False,
)

action_status_enum = postgresql.ENUM(
    "success",
    "failed",
    "timeout",
    "skipped",
    "error",
    "pending",
    name="action_execution_status",
    create_type=False,
)

screenshot_type_enum = postgresql.ENUM(
    "before_action",
    "after_action",
    "on_error",
    "on_success",
    "state_capture",
    "diff_baseline",
    "diff_comparison",
    "manual",
    name="execution_screenshot_type",
    create_type=False,
)

issue_type_enum = postgresql.ENUM(
    "visual_regression",
    "element_not_found",
    "state_mismatch",
    "timeout",
    "assertion_failed",
    "navigation_error",
    "script_error",
    "performance",
    "accessibility",
    "other",
    name="execution_issue_type",
    create_type=False,
)

issue_severity_enum = postgresql.ENUM(
    "critical",
    "high",
    "medium",
    "low",
    "info",
    name="execution_issue_severity",
    create_type=False,
)

issue_status_enum = postgresql.ENUM(
    "open",
    "in_progress",
    "resolved",
    "wont_fix",
    "duplicate",
    "cannot_reproduce",
    name="execution_issue_status",
    create_type=False,
)

issue_source_enum = postgresql.ENUM(
    "automation",
    "ai_analysis",
    "visual_regression",
    "user_reported",
    name="execution_issue_source",
    create_type=False,
)


def upgrade() -> None:
    # Create enum types
    run_type_enum.create(op.get_bind(), checkfirst=True)
    run_status_enum.create(op.get_bind(), checkfirst=True)
    action_type_enum.create(op.get_bind(), checkfirst=True)
    action_status_enum.create(op.get_bind(), checkfirst=True)
    screenshot_type_enum.create(op.get_bind(), checkfirst=True)
    issue_type_enum.create(op.get_bind(), checkfirst=True)
    issue_severity_enum.create(op.get_bind(), checkfirst=True)
    issue_status_enum.create(op.get_bind(), checkfirst=True)
    issue_source_enum.create(op.get_bind(), checkfirst=True)

    # Create execution_runs table
    op.create_table(
        "execution_runs",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("run_type", run_type_enum, nullable=False),
        sa.Column("run_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", run_status_enum, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "duration_seconds",
            sa.Integer(),
            nullable=True,
            comment="Total run duration in seconds",
        ),
        sa.Column(
            "runner_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Runner info: version, os, hostname, capabilities",
        ),
        sa.Column(
            "workflow_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Workflow info: workflow_id, workflow_name, version",
        ),
        sa.Column(
            "configuration",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Run configuration: timeouts, retries, environment",
        ),
        sa.Column(
            "stats",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Run statistics: total_actions, successful_actions, failed_actions",
        ),
        sa.Column(
            "coverage_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Coverage data: states_visited, transitions_executed, etc.",
        ),
        sa.Column(
            "max_duration_seconds",
            sa.Integer(),
            nullable=True,
            comment="Maximum allowed duration before timeout",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_execution_runs_project_id"),
        "execution_runs",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_runs_run_type"),
        "execution_runs",
        ["run_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_runs_status"),
        "execution_runs",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_runs_started_at"),
        "execution_runs",
        ["started_at"],
        unique=False,
    )
    op.create_index(
        "ix_execution_runs_project_status",
        "execution_runs",
        ["project_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_execution_runs_project_type",
        "execution_runs",
        ["project_id", "run_type"],
        unique=False,
    )
    op.create_index(
        "ix_execution_runs_project_started",
        "execution_runs",
        ["project_id", sa.literal_column("started_at DESC")],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_runs_created_by_user_id"),
        "execution_runs",
        ["created_by_user_id"],
        unique=False,
    )

    # Create action_executions table
    op.create_table(
        "action_executions",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column(
            "sequence_number",
            sa.Integer(),
            nullable=False,
            comment="Order of execution within the run",
        ),
        sa.Column("action_type", action_type_enum, nullable=False),
        sa.Column("action_name", sa.String(length=255), nullable=False),
        sa.Column("status", action_status_enum, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "duration_ms",
            sa.Integer(),
            nullable=True,
            comment="Action duration in milliseconds",
        ),
        sa.Column(
            "from_state",
            sa.String(length=255),
            nullable=True,
            comment="Source state before action",
        ),
        sa.Column(
            "to_state",
            sa.String(length=255),
            nullable=True,
            comment="Expected target state after action",
        ),
        sa.Column(
            "actual_state",
            sa.String(length=255),
            nullable=True,
            comment="Actual state reached after action",
        ),
        sa.Column(
            "input_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Action input parameters",
        ),
        sa.Column(
            "output_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Action output/results",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "error_type",
            sa.String(length=100),
            nullable=True,
            comment="Error classification: timeout, element_not_found, etc.",
        ),
        sa.Column(
            "screenshot_id",
            sa.UUID(),
            nullable=True,
            comment="Primary screenshot for this action",
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Additional action metadata",
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
        op.f("ix_action_executions_run_id"),
        "action_executions",
        ["run_id"],
        unique=False,
    )
    op.create_index(
        "ix_action_executions_run_sequence",
        "action_executions",
        ["run_id", "sequence_number"],
        unique=True,
    )
    op.create_index(
        op.f("ix_action_executions_action_type"),
        "action_executions",
        ["action_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_action_executions_status"),
        "action_executions",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_action_executions_run_status",
        "action_executions",
        ["run_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_action_executions_from_state",
        "action_executions",
        ["from_state"],
        unique=False,
    )
    op.create_index(
        "ix_action_executions_to_state",
        "action_executions",
        ["to_state"],
        unique=False,
    )

    # Create execution_screenshots table
    op.create_table(
        "execution_screenshots",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("action_execution_id", sa.UUID(), nullable=True),
        sa.Column(
            "sequence_number",
            sa.Integer(),
            nullable=False,
            comment="Order of screenshot within the run",
        ),
        sa.Column("screenshot_type", screenshot_type_enum, nullable=False),
        sa.Column(
            "storage_path",
            sa.String(length=500),
            nullable=False,
            comment="Path in storage system (S3, MinIO, local)",
        ),
        sa.Column(
            "image_url",
            sa.String(length=500),
            nullable=False,
            comment="Public URL to access the image",
        ),
        sa.Column(
            "thumbnail_url",
            sa.String(length=500),
            nullable=True,
            comment="URL to thumbnail version",
        ),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "state_name",
            sa.String(length=255),
            nullable=True,
            comment="State name when screenshot was taken",
        ),
        sa.Column(
            "perceptual_hash",
            sa.String(length=64),
            nullable=True,
            comment="Perceptual hash for image similarity comparison",
        ),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Additional screenshot metadata: annotations, regions, etc.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["execution_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["action_execution_id"], ["action_executions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_execution_screenshots_run_id"),
        "execution_screenshots",
        ["run_id"],
        unique=False,
    )
    op.create_index(
        "ix_execution_screenshots_run_sequence",
        "execution_screenshots",
        ["run_id", "sequence_number"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_screenshots_action_execution_id"),
        "execution_screenshots",
        ["action_execution_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_screenshots_screenshot_type"),
        "execution_screenshots",
        ["screenshot_type"],
        unique=False,
    )
    op.create_index(
        "ix_execution_screenshots_state_name",
        "execution_screenshots",
        ["state_name"],
        unique=False,
    )
    op.create_index(
        "ix_execution_screenshots_perceptual_hash",
        "execution_screenshots",
        ["perceptual_hash"],
        unique=False,
    )

    # Now add FK from action_executions.screenshot_id to execution_screenshots.id
    op.create_foreign_key(
        "fk_action_executions_screenshot_id",
        "action_executions",
        "execution_screenshots",
        ["screenshot_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Create execution_issues table
    op.create_table(
        "execution_issues",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("action_execution_id", sa.UUID(), nullable=True),
        sa.Column("issue_type", issue_type_enum, nullable=False),
        sa.Column("severity", issue_severity_enum, nullable=False),
        sa.Column("status", issue_status_enum, nullable=False),
        sa.Column("source", issue_source_enum, nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "state_name",
            sa.String(length=255),
            nullable=True,
            comment="State where issue was detected",
        ),
        sa.Column(
            "screenshot_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="Array of screenshot UUIDs related to this issue",
        ),
        sa.Column(
            "reproduction_steps",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="Array of steps to reproduce the issue",
        ),
        sa.Column(
            "error_details",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Detailed error information: stack trace, logs, etc.",
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="Additional issue metadata",
        ),
        sa.Column("assigned_to_user_id", sa.UUID(), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["execution_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["action_execution_id"], ["action_executions.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["assigned_to_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_execution_issues_run_id"),
        "execution_issues",
        ["run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_issues_action_execution_id"),
        "execution_issues",
        ["action_execution_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_issues_issue_type"),
        "execution_issues",
        ["issue_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_issues_severity"),
        "execution_issues",
        ["severity"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_issues_status"),
        "execution_issues",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_issues_source"),
        "execution_issues",
        ["source"],
        unique=False,
    )
    op.create_index(
        "ix_execution_issues_run_status",
        "execution_issues",
        ["run_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_execution_issues_run_severity",
        "execution_issues",
        ["run_id", "severity"],
        unique=False,
    )
    op.create_index(
        op.f("ix_execution_issues_assigned_to_user_id"),
        "execution_issues",
        ["assigned_to_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_execution_issues_state_name",
        "execution_issues",
        ["state_name"],
        unique=False,
    )
    # GIN index for JSONB screenshot_ids array
    op.create_index(
        "ix_execution_issues_screenshot_ids",
        "execution_issues",
        ["screenshot_ids"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"screenshot_ids": "jsonb_path_ops"},
    )


def downgrade() -> None:
    # Drop execution_issues table and indexes
    op.drop_index(
        "ix_execution_issues_screenshot_ids",
        table_name="execution_issues",
        postgresql_using="gin",
        postgresql_ops={"screenshot_ids": "jsonb_path_ops"},
    )
    op.drop_index("ix_execution_issues_state_name", table_name="execution_issues")
    op.drop_index(
        op.f("ix_execution_issues_assigned_to_user_id"), table_name="execution_issues"
    )
    op.drop_index("ix_execution_issues_run_severity", table_name="execution_issues")
    op.drop_index("ix_execution_issues_run_status", table_name="execution_issues")
    op.drop_index(op.f("ix_execution_issues_source"), table_name="execution_issues")
    op.drop_index(op.f("ix_execution_issues_status"), table_name="execution_issues")
    op.drop_index(op.f("ix_execution_issues_severity"), table_name="execution_issues")
    op.drop_index(op.f("ix_execution_issues_issue_type"), table_name="execution_issues")
    op.drop_index(
        op.f("ix_execution_issues_action_execution_id"), table_name="execution_issues"
    )
    op.drop_index(op.f("ix_execution_issues_run_id"), table_name="execution_issues")
    op.drop_table("execution_issues")

    # Drop FK from action_executions to execution_screenshots
    op.drop_constraint(
        "fk_action_executions_screenshot_id",
        "action_executions",
        type_="foreignkey",
    )

    # Drop execution_screenshots table and indexes
    op.drop_index(
        "ix_execution_screenshots_perceptual_hash", table_name="execution_screenshots"
    )
    op.drop_index(
        "ix_execution_screenshots_state_name", table_name="execution_screenshots"
    )
    op.drop_index(
        op.f("ix_execution_screenshots_screenshot_type"),
        table_name="execution_screenshots",
    )
    op.drop_index(
        op.f("ix_execution_screenshots_action_execution_id"),
        table_name="execution_screenshots",
    )
    op.drop_index(
        "ix_execution_screenshots_run_sequence", table_name="execution_screenshots"
    )
    op.drop_index(
        op.f("ix_execution_screenshots_run_id"), table_name="execution_screenshots"
    )
    op.drop_table("execution_screenshots")

    # Drop action_executions table and indexes
    op.drop_index("ix_action_executions_to_state", table_name="action_executions")
    op.drop_index("ix_action_executions_from_state", table_name="action_executions")
    op.drop_index("ix_action_executions_run_status", table_name="action_executions")
    op.drop_index(op.f("ix_action_executions_status"), table_name="action_executions")
    op.drop_index(
        op.f("ix_action_executions_action_type"), table_name="action_executions"
    )
    op.drop_index("ix_action_executions_run_sequence", table_name="action_executions")
    op.drop_index(op.f("ix_action_executions_run_id"), table_name="action_executions")
    op.drop_table("action_executions")

    # Drop execution_runs table and indexes
    op.drop_index(
        op.f("ix_execution_runs_created_by_user_id"), table_name="execution_runs"
    )
    op.drop_index("ix_execution_runs_project_started", table_name="execution_runs")
    op.drop_index("ix_execution_runs_project_type", table_name="execution_runs")
    op.drop_index("ix_execution_runs_project_status", table_name="execution_runs")
    op.drop_index(op.f("ix_execution_runs_started_at"), table_name="execution_runs")
    op.drop_index(op.f("ix_execution_runs_status"), table_name="execution_runs")
    op.drop_index(op.f("ix_execution_runs_run_type"), table_name="execution_runs")
    op.drop_index(op.f("ix_execution_runs_project_id"), table_name="execution_runs")
    op.drop_table("execution_runs")

    # Drop enum types
    issue_source_enum.drop(op.get_bind(), checkfirst=True)
    issue_status_enum.drop(op.get_bind(), checkfirst=True)
    issue_severity_enum.drop(op.get_bind(), checkfirst=True)
    issue_type_enum.drop(op.get_bind(), checkfirst=True)
    screenshot_type_enum.drop(op.get_bind(), checkfirst=True)
    action_status_enum.drop(op.get_bind(), checkfirst=True)
    action_type_enum.drop(op.get_bind(), checkfirst=True)
    run_status_enum.drop(op.get_bind(), checkfirst=True)
    run_type_enum.drop(op.get_bind(), checkfirst=True)
