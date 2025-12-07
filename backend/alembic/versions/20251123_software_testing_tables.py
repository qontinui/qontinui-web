"""add_software_testing_tables

Revision ID: 20251123_software_testing_tables
Revises: 0105a6e182c5
Create Date: 2025-11-23 21:45:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251123_software_testing_tables"
down_revision: Union[str, None] = "0105a6e182c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: Enum types are already created or will be created by SQLAlchemy
    # We just need to create the tables

    # Create software_test_runs table
    op.create_table(
        "software_test_runs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("runner_connection_id", sa.Integer(), nullable=True),
        sa.Column("workflow_id", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "RUNNING",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
                "TIMEOUT",
                name="testrunstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_transitions", sa.Integer(), nullable=False),
        sa.Column("successful_transitions", sa.Integer(), nullable=False),
        sa.Column("failed_transitions", sa.Integer(), nullable=False),
        sa.Column("skipped_transitions", sa.Integer(), nullable=False),
        sa.Column(
            "coverage_percentage", sa.Numeric(precision=5, scale=2), nullable=False
        ),
        sa.Column("unique_paths_found", sa.Integer(), nullable=False),
        sa.Column("unique_states_visited", sa.Integer(), nullable=False),
        sa.Column(
            "configuration_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("test_mode", sa.String(length=50), nullable=True),
        sa.Column("max_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("seed_value", sa.String(length=255), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("deficiencies_found", sa.Integer(), nullable=False),
        sa.Column(
            "runner_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["runner_connection_id"], ["runner_connections.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_software_test_runs_project_id"),
        "software_test_runs",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_software_test_runs_runner_connection_id"),
        "software_test_runs",
        ["runner_connection_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_software_test_runs_started_at"),
        "software_test_runs",
        ["started_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_software_test_runs_status"),
        "software_test_runs",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_software_test_runs_workflow_id"),
        "software_test_runs",
        ["workflow_id"],
        unique=False,
    )

    # Create transition_reliability table
    op.create_table(
        "transition_reliability",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", sa.String(length=255), nullable=True),
        sa.Column("transition_id", sa.String(length=255), nullable=False),
        sa.Column("total_executions", sa.Integer(), nullable=False),
        sa.Column("successful_executions", sa.Integer(), nullable=False),
        sa.Column("failed_executions", sa.Integer(), nullable=False),
        sa.Column("timeout_executions", sa.Integer(), nullable=False),
        sa.Column("success_rate", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("avg_execution_time_ms", sa.Integer(), nullable=True),
        sa.Column("min_execution_time_ms", sa.Integer(), nullable=True),
        sa.Column("max_execution_time_ms", sa.Integer(), nullable=True),
        sa.Column(
            "stddev_execution_time_ms", sa.Numeric(precision=10, scale=2), nullable=True
        ),
        sa.Column("first_executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "failure_patterns", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "common_errors", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("consecutive_successes", sa.Integer(), nullable=False),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        sa.Column("is_flaky", sa.Boolean(), nullable=False),
        sa.Column("flakiness_score", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column(
            "reliability_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_calculated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_transition_reliability_is_flaky"),
        "transition_reliability",
        ["is_flaky"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_reliability_last_executed_at"),
        "transition_reliability",
        ["last_executed_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_reliability_project_id"),
        "transition_reliability",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_reliability_success_rate"),
        "transition_reliability",
        ["success_rate"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_reliability_transition_id"),
        "transition_reliability",
        ["transition_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_reliability_workflow_id"),
        "transition_reliability",
        ["workflow_id"],
        unique=False,
    )

    # Create coverage_snapshots table
    op.create_table(
        "coverage_snapshots",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("test_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", sa.String(length=255), nullable=True),
        sa.Column("snapshot_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transitions_covered", sa.Integer(), nullable=False),
        sa.Column("transitions_total", sa.Integer(), nullable=False),
        sa.Column(
            "coverage_percentage", sa.Numeric(precision=5, scale=2), nullable=False
        ),
        sa.Column("states_covered", sa.Integer(), nullable=False),
        sa.Column("states_total", sa.Integer(), nullable=False),
        sa.Column(
            "state_coverage_percentage",
            sa.Numeric(precision=5, scale=2),
            nullable=False,
        ),
        sa.Column("paths_discovered", sa.Integer(), nullable=False),
        sa.Column("unique_paths", sa.Integer(), nullable=False),
        sa.Column(
            "coverage_map", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "state_coverage_map",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "uncovered_transitions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "uncovered_states", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "snapshot_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["test_run_id"], ["software_test_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_coverage_snapshots_coverage_percentage"),
        "coverage_snapshots",
        ["coverage_percentage"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_snapshots_project_id"),
        "coverage_snapshots",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_snapshots_snapshot_time"),
        "coverage_snapshots",
        ["snapshot_time"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_snapshots_test_run_id"),
        "coverage_snapshots",
        ["test_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_snapshots_workflow_id"),
        "coverage_snapshots",
        ["workflow_id"],
        unique=False,
    )

    # Create path_discoveries table
    op.create_table(
        "path_discoveries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("test_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("path_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "path_sequence", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("path_length", sa.Integer(), nullable=False),
        sa.Column("unique_states_visited", sa.Integer(), nullable=False),
        sa.Column("unique_transitions_used", sa.Integer(), nullable=False),
        sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("execution_time_ms", sa.Integer(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("end_state", sa.String(length=255), nullable=True),
        sa.Column("is_cyclic", sa.Boolean(), nullable=False),
        sa.Column("cycle_detected_at", sa.Integer(), nullable=True),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column("last_traversed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "path_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["test_run_id"], ["software_test_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_path_discoveries_discovered_at"),
        "path_discoveries",
        ["discovered_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_path_discoveries_path_hash"),
        "path_discoveries",
        ["path_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_path_discoveries_success"),
        "path_discoveries",
        ["success"],
        unique=False,
    )
    op.create_index(
        op.f("ix_path_discoveries_test_run_id"),
        "path_discoveries",
        ["test_run_id"],
        unique=False,
    )

    # Create transition_executions table
    op.create_table(
        "transition_executions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("test_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transition_id", sa.String(length=255), nullable=False),
        sa.Column("transition_name", sa.String(length=500), nullable=True),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "SUCCESS",
                "FAILED",
                "TIMEOUT",
                "SKIPPED",
                "ERROR",
                name="transitionexecutionstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("execution_time_ms", sa.Integer(), nullable=True),
        sa.Column("error_type", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("error_stacktrace", sa.Text(), nullable=True),
        sa.Column(
            "screenshot_urls", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("video_url", sa.String(length=500), nullable=True),
        sa.Column("source_state", sa.String(length=255), nullable=True),
        sa.Column("target_state", sa.String(length=255), nullable=True),
        sa.Column("actual_state", sa.String(length=255), nullable=True),
        sa.Column("state_match", sa.Boolean(), nullable=True),
        sa.Column(
            "input_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "output_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "path_sequence", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("path_depth", sa.Integer(), nullable=True),
        sa.Column("action_count", sa.Integer(), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column(
            "execution_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["test_run_id"], ["software_test_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_transition_executions_status"),
        "transition_executions",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_executions_test_run_id"),
        "transition_executions",
        ["test_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_transition_executions_transition_id"),
        "transition_executions",
        ["transition_id"],
        unique=False,
    )

    # Create test_deficiencies table
    op.create_table(
        "test_deficiencies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("test_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "transition_execution_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "severity",
            sa.Enum(
                "CRITICAL",
                "HIGH",
                "MEDIUM",
                "LOW",
                "INFO",
                name="deficiencyseverity",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "deficiency_type",
            sa.Enum(
                "CRASH",
                "TIMEOUT",
                "VISUAL",
                "FUNCTIONAL",
                "PERFORMANCE",
                "DATA",
                "ACCESSIBILITY",
                "SECURITY",
                name="deficiencytype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "screenshot_urls", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("video_url", sa.String(length=500), nullable=True),
        sa.Column(
            "reproduction_steps",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("reproduction_rate", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("reproducible", sa.Boolean(), nullable=False),
        sa.Column(
            "environment_info", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "preconditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "status",
            sa.Enum(
                "NEW",
                "TRIAGED",
                "ASSIGNED",
                "IN_PROGRESS",
                "RESOLVED",
                "CLOSED",
                "WONT_FIX",
                name="deficiencystatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("resolution", sa.String(length=100), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column("external_ticket_id", sa.String(length=255), nullable=True),
        sa.Column("external_ticket_url", sa.String(length=500), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "custom_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_to_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["test_run_id"], ["software_test_runs.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["transition_execution_id"],
            ["transition_executions.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_test_deficiencies_assigned_to_user_id"),
        "test_deficiencies",
        ["assigned_to_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_test_deficiencies_deficiency_type"),
        "test_deficiencies",
        ["deficiency_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_test_deficiencies_first_seen_at"),
        "test_deficiencies",
        ["first_seen_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_test_deficiencies_severity"),
        "test_deficiencies",
        ["severity"],
        unique=False,
    )
    op.create_index(
        op.f("ix_test_deficiencies_status"),
        "test_deficiencies",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_test_deficiencies_test_run_id"),
        "test_deficiencies",
        ["test_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_test_deficiencies_transition_execution_id"),
        "test_deficiencies",
        ["transition_execution_id"],
        unique=False,
    )


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index(
        op.f("ix_test_deficiencies_transition_execution_id"),
        table_name="test_deficiencies",
    )
    op.drop_index(
        op.f("ix_test_deficiencies_test_run_id"), table_name="test_deficiencies"
    )
    op.drop_index(op.f("ix_test_deficiencies_status"), table_name="test_deficiencies")
    op.drop_index(op.f("ix_test_deficiencies_severity"), table_name="test_deficiencies")
    op.drop_index(
        op.f("ix_test_deficiencies_first_seen_at"), table_name="test_deficiencies"
    )
    op.drop_index(
        op.f("ix_test_deficiencies_deficiency_type"), table_name="test_deficiencies"
    )
    op.drop_index(
        op.f("ix_test_deficiencies_assigned_to_user_id"), table_name="test_deficiencies"
    )
    op.drop_table("test_deficiencies")

    op.drop_index(
        op.f("ix_transition_executions_transition_id"),
        table_name="transition_executions",
    )
    op.drop_index(
        op.f("ix_transition_executions_test_run_id"), table_name="transition_executions"
    )
    op.drop_index(
        op.f("ix_transition_executions_status"), table_name="transition_executions"
    )
    op.drop_table("transition_executions")

    op.drop_index(
        op.f("ix_path_discoveries_test_run_id"), table_name="path_discoveries"
    )
    op.drop_index(op.f("ix_path_discoveries_success"), table_name="path_discoveries")
    op.drop_index(op.f("ix_path_discoveries_path_hash"), table_name="path_discoveries")
    op.drop_index(
        op.f("ix_path_discoveries_discovered_at"), table_name="path_discoveries"
    )
    op.drop_table("path_discoveries")

    op.drop_index(
        op.f("ix_coverage_snapshots_workflow_id"), table_name="coverage_snapshots"
    )
    op.drop_index(
        op.f("ix_coverage_snapshots_test_run_id"), table_name="coverage_snapshots"
    )
    op.drop_index(
        op.f("ix_coverage_snapshots_snapshot_time"), table_name="coverage_snapshots"
    )
    op.drop_index(
        op.f("ix_coverage_snapshots_project_id"), table_name="coverage_snapshots"
    )
    op.drop_index(
        op.f("ix_coverage_snapshots_coverage_percentage"),
        table_name="coverage_snapshots",
    )
    op.drop_table("coverage_snapshots")

    op.drop_index(
        op.f("ix_transition_reliability_workflow_id"),
        table_name="transition_reliability",
    )
    op.drop_index(
        op.f("ix_transition_reliability_transition_id"),
        table_name="transition_reliability",
    )
    op.drop_index(
        op.f("ix_transition_reliability_success_rate"),
        table_name="transition_reliability",
    )
    op.drop_index(
        op.f("ix_transition_reliability_project_id"),
        table_name="transition_reliability",
    )
    op.drop_index(
        op.f("ix_transition_reliability_last_executed_at"),
        table_name="transition_reliability",
    )
    op.drop_index(
        op.f("ix_transition_reliability_is_flaky"), table_name="transition_reliability"
    )
    op.drop_table("transition_reliability")

    op.drop_index(
        op.f("ix_software_test_runs_workflow_id"), table_name="software_test_runs"
    )
    op.drop_index(op.f("ix_software_test_runs_status"), table_name="software_test_runs")
    op.drop_index(
        op.f("ix_software_test_runs_started_at"), table_name="software_test_runs"
    )
    op.drop_index(
        op.f("ix_software_test_runs_runner_connection_id"),
        table_name="software_test_runs",
    )
    op.drop_index(
        op.f("ix_software_test_runs_project_id"), table_name="software_test_runs"
    )
    op.drop_table("software_test_runs")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS deficiencystatus")
    op.execute("DROP TYPE IF EXISTS deficiencytype")
    op.execute("DROP TYPE IF EXISTS deficiencyseverity")
    op.execute("DROP TYPE IF EXISTS transitionexecutionstatus")
    op.execute("DROP TYPE IF EXISTS testrunstatus")
