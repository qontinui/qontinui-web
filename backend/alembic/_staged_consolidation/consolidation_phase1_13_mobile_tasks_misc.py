"""consolidation phase1 13 mobile / tasks misc

Revision ID: consolidation_phase1_13_mobile_tasks_misc
Revises: consolidation_phase1_12_coord_sessions_worktrees
Create Date: 2026-04-29

Phase 1, batch 13: mobile state/logs, prompts, verification tests,
task hooks, and scheduled tasks in ``project``.

- ``project.task_run_mobile_state`` (FK→task_runs CASCADE).
- ``project.task_run_mobile_logs`` (FK→task_runs CASCADE).
- ``project.prompts``.
- ``project.verification_tests``.
- ``project.task_hooks``.
- ``project.scheduled_tasks`` (folds Phase A reliability columns).

Source: ``schema.pg.sql:1543-1678``.

DRIFT FLAGS (preserved):
- ``task_run_mobile_logs.mobile_state_id`` is ``BIGINT`` with no FK to
  ``task_run_mobile_state``. Preserved as plain BIGINT.
- ``verification_tests.workflow_id`` has no FK declared. Preserved.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_13_mobile_tasks_misc"
down_revision: str = "consolidation_phase1_12_coord_sessions_worktrees"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # task_run_mobile_state (FK→task_runs CASCADE)
    op.create_table(
        "task_run_mobile_state",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("device_id", sa.Text(), nullable=True),
        sa.Column("device_type", sa.Text(), nullable=True),
        sa.Column("device_model", sa.Text(), nullable=True),
        sa.Column("app_package", sa.Text(), nullable=True),
        sa.Column("app_activity", sa.Text(), nullable=True),
        sa.Column("app_state", sa.Text(), nullable=True),
        sa.Column("metro_connected", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("bundle_status", sa.Text(), nullable=True),
        sa.Column("last_reload_type", sa.Text(), nullable=True),
        sa.Column("last_reload_time", sa.Text(), nullable=True),
        sa.Column("screenshot_path", sa.Text(), nullable=True),
        sa.Column("logcat_path", sa.Text(), nullable=True),
        sa.Column("has_errors", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_mobile_state_task_run", "task_run_mobile_state", ["task_run_id"], schema="project")
    op.create_index("idx_mobile_state_timestamp", "task_run_mobile_state", ["timestamp"], schema="project")

    # task_run_mobile_logs (FK→task_runs CASCADE; mobile_state_id is plain BIGINT)
    op.create_table(
        "task_run_mobile_logs",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mobile_state_id", sa.BigInteger(), nullable=True),
        sa.Column("log_source", sa.Text(), nullable=False),
        sa.Column("log_level", sa.Text(), nullable=True),
        sa.Column("log_tag", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("raw_line", sa.Text(), nullable=True),
        sa.Column("data", sa.Text(), nullable=True),
        sa.Column("error_type", sa.Text(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("stack_trace", sa.Text(), nullable=True),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("line_number", sa.Integer(), nullable=True),
        sa.Column("column_number", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("device_timestamp", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_mobile_logs_task_run", "task_run_mobile_logs", ["task_run_id"], schema="project")
    op.create_index("idx_mobile_logs_source", "task_run_mobile_logs", ["log_source"], schema="project")

    # prompts
    op.create_table(
        "prompts",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False, server_default=sa.text("'general'")),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("variables", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_prompts_name", "prompts", ["name"], schema="project")

    # verification_tests
    op.create_table(
        "verification_tests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("test_type", sa.Text(), nullable=False, server_default=sa.text("'python_script'")),
        sa.Column("command", sa.Text(), nullable=True),
        sa.Column("expected_exit_code", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("expected_output", sa.Text(), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True, server_default=sa.text("60")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("playwright_code", sa.Text(), nullable=True),
        sa.Column("vision_config", sa.Text(), nullable=True),
        sa.Column("python_code", sa.Text(), nullable=True),
        sa.Column("repo_test_config", sa.Text(), nullable=True),
        sa.Column("success_criteria", sa.Text(), nullable=True),
        sa.Column("config", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("is_critical", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ai_generation_prompt", sa.Text(), nullable=True),
        sa.Column("creation_analysis", sa.Text(), nullable=True),
        sa.Column("source_file", sa.Text(), nullable=True),
        sa.Column("last_exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_verification_tests_workflow", "verification_tests", ["workflow_id"], schema="project")
    op.create_index(
        "idx_verification_tests_category", "verification_tests", ["category"],
        schema="project",
        postgresql_where=sa.text("category IS NOT NULL"),
    )
    op.create_index(
        "idx_verification_tests_enabled", "verification_tests", ["enabled"],
        schema="project",
        postgresql_where=sa.text("enabled"),
    )

    # task_hooks
    op.create_table(
        "task_hooks",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("hook_type", sa.Text(), nullable=False),
        sa.Column("trigger_event", sa.Text(), nullable=False),
        sa.Column("command", sa.Text(), nullable=False),
        sa.Column("working_directory", sa.Text(), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True, server_default=sa.text("30")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("workflow_filter", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_task_hooks_trigger", "task_hooks", ["trigger_event"], schema="project")

    # scheduled_tasks (folds Phase A reliability columns)
    op.create_table(
        "scheduled_tasks",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("schedule_type", sa.Text(), nullable=False, server_default=sa.text("'cron'")),
        sa.Column("schedule_value", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("task_config", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("skip_if_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("auto_fix_on_failure", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("success_criteria", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("next_run", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_id", sa.Text(), nullable=True),
        sa.Column("condition_status", sa.Text(), nullable=True),
        # Phase A reliability columns (folded in from later ALTERs in source)
        sa.Column("catch_up_policy", sa.Text(), nullable=False, server_default=sa.text("'run_once'")),
        sa.Column("catch_up_grace_seconds", sa.Integer(), nullable=False, server_default=sa.text("300")),
        sa.Column("consecutive_launch_failures", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("launch_failure_backoff_seconds", sa.Integer(), nullable=False, server_default=sa.text("60")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_scheduled_tasks_enabled", "scheduled_tasks", ["enabled"], schema="project")


def downgrade() -> None:
    op.drop_table("scheduled_tasks", schema="project")
    op.drop_table("task_hooks", schema="project")
    op.drop_table("verification_tests", schema="project")
    op.drop_table("prompts", schema="project")
    op.drop_table("task_run_mobile_logs", schema="project")
    op.drop_table("task_run_mobile_state", schema="project")
