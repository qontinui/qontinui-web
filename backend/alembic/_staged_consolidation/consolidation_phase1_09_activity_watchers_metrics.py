"""consolidation phase1 09 activity / watchers / metrics

Revision ID: consolidation_phase1_09_activity_watchers_metrics
Revises: consolidation_phase1_08_checks_approval_deferred
Create Date: 2026-04-29

Phase 1, batch 9: activity timeline, watchers, agentic metrics, prompt
registry, canary rollouts, prompt-template canaries, and error events
in ``project``.

Source: ``schema.pg.sql:963-1222`` and ``2635-2643`` (for
``agentic_metric_baselines``).

Notable details:
- ``activity_timeline`` and ``error_events`` both have GIN FTS
  expression indexes via ``op.execute``.
- ``activity_timeline.task_run_id`` is ``TEXT`` with FK→task_runs
  SET NULL.
- ``error_events.task_run_id`` is ``TEXT`` with FK→task_runs SET NULL.
- ``agentic_metric_baselines.id`` placement: source has it at line 2635
  (much later in the file). Pulled into this batch for logical grouping
  with the rest of the agentic_metric_* family.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_09_activity_watchers_metrics"
down_revision: str = "consolidation_phase1_08_checks_approval_deferred"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # activity_timeline
    op.create_table(
        "activity_timeline",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("text_content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=False),
        sa.Column("capture_mode", sa.Text(), nullable=False),
        sa.Column("app_name", sa.Text(), nullable=True),
        sa.Column("window_title", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("screenshot_path", sa.Text(), nullable=True),
        sa.Column("element_count", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("duplicate_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_at_content_hash", "activity_timeline", ["content_hash"], schema="project")
    op.create_index("idx_at_created_at", "activity_timeline", ["created_at"], schema="project")
    op.create_index(
        "idx_at_task_run", "activity_timeline", ["task_run_id"],
        schema="project",
        postgresql_where=sa.text("task_run_id IS NOT NULL"),
    )
    op.create_index(
        "idx_at_app_name", "activity_timeline", ["app_name"],
        schema="project",
        postgresql_where=sa.text("app_name IS NOT NULL"),
    )
    op.create_index(
        "idx_at_source_type", "activity_timeline", ["source_type"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.execute(
        "CREATE INDEX idx_at_fts ON project.activity_timeline "
        "USING GIN (to_tsvector('english', text_content)) "
        "WHERE NOT is_deleted"
    )

    # watchers
    op.create_table(
        "watchers",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("schedule_json", sa.Text(), nullable=False),
        sa.Column("timeline_query", sa.Text(), nullable=False),
        sa.Column("app_name_filter", sa.Text(), nullable=True),
        sa.Column("source_type_filter", sa.Text(), nullable=True),
        sa.Column("lookback_window", sa.Text(), nullable=False, server_default=sa.text("'15 minutes'")),
        sa.Column("reasoning_prompt", sa.Text(), nullable=False),
        sa.Column("action_json", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_result_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_watchers_enabled", "watchers", ["enabled"],
        schema="project",
        postgresql_where=sa.text("enabled"),
    )

    # agentic_metric_scores
    op.create_table(
        "agentic_metric_scores",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("metric_type", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("is_llm_judged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ams_task_run", "agentic_metric_scores", ["task_run_id"], schema="project")
    op.create_index("idx_ams_metric", "agentic_metric_scores", ["metric_type"], schema="project")
    op.create_index(
        "idx_ams_unique", "agentic_metric_scores",
        ["task_run_id", "metric_type"],
        unique=True,
        schema="project",
    )

    # agentic_metric_baselines (pulled forward from line 2635 for logical grouping)
    op.create_table(
        "agentic_metric_baselines",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("metric_type", sa.Text(), nullable=False),
        sa.Column("baseline_value", sa.Text(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_baselines_unique", "agentic_metric_baselines",
        ["workflow_id", "metric_type"],
        unique=True,
        schema="project",
    )

    # prompt_registry
    op.create_table(
        "prompt_registry",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("variant_name", sa.Text(), nullable=False),
        sa.Column("prompt_content", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("source_recommendation_id", sa.Text(), nullable=True),
        sa.Column("performance_metrics", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_type", "variant_name", "version", name="prompt_registry_variant_uniq"),
        schema="project",
    )
    op.create_index("idx_pr_agent_type", "prompt_registry", ["agent_type"], schema="project")
    op.create_index("idx_pr_active", "prompt_registry", ["agent_type", "is_active"], schema="project")

    # meta_optimizer_recommendations
    op.create_table(
        "meta_optimizer_recommendations",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("optimizer_type", sa.Text(), nullable=False),
        sa.Column("recommendation_type", sa.Text(), nullable=False),
        sa.Column("target_agent", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("current_value", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("recommended_value", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("evidence", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome_after_apply", sa.Text(), nullable=True),
        sa.Column("optimizer_run_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("content_hash", sa.Text(), nullable=True),
        sa.Column("eval_result_id", sa.Text(), nullable=True),
        sa.Column("eval_status", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_mor_type", "meta_optimizer_recommendations", ["optimizer_type"], schema="project")
    op.create_index("idx_mor_status", "meta_optimizer_recommendations", ["status"], schema="project")
    op.create_index("idx_mor_run", "meta_optimizer_recommendations", ["optimizer_run_id"], schema="project")
    op.create_index("idx_mor_content_hash", "meta_optimizer_recommendations", ["content_hash"], schema="project")

    # canary_rollouts
    op.create_table(
        "canary_rollouts",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("recommendation_id", sa.Text(), nullable=False),
        sa.Column("percentage", sa.BigInteger(), nullable=False, server_default=sa.text("10")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("baseline_run_count", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("canary_run_count", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("baseline_metrics_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("canary_metrics_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_cr_status", "canary_rollouts", ["status"], schema="project")
    op.create_index("idx_cr_rec", "canary_rollouts", ["recommendation_id"], schema="project")

    # canary_run_records
    op.create_table(
        "canary_run_records",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("canary_id", sa.Text(), nullable=False),
        sa.Column("is_canary", sa.Boolean(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=True, server_default=sa.text("0.0")),
        sa.Column("duration_ms", sa.Float(), nullable=True, server_default=sa.text("0.0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_crr_canary", "canary_run_records", ["canary_id", "is_canary"], schema="project")

    # prompt_template_canaries
    op.create_table(
        "prompt_template_canaries",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("template_id", sa.Text(), nullable=False),
        sa.Column("baseline_version", sa.Integer(), nullable=False),
        sa.Column("candidate_version", sa.Integer(), nullable=False),
        sa.Column("traffic_percentage", sa.Float(), nullable=False, server_default=sa.text("0.1")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("baseline_metrics_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("candidate_metrics_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ptc_template", "prompt_template_canaries", ["template_id"], schema="project")
    op.create_index("idx_ptc_status", "prompt_template_canaries", ["status"], schema="project")

    # error_events (FK → task_runs SET NULL; GIN FTS expression)
    op.create_table(
        "error_events",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("log_source_id", sa.BigInteger(), nullable=True),
        sa.Column("log_source_name", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("workflow_step_id", sa.Text(), nullable=True),
        sa.Column("log_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("severity", sa.Text(), nullable=False, server_default=sa.text("'error'")),
        sa.Column("error_type", sa.Text(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("stack_trace", sa.Text(), nullable=True),
        sa.Column("context_lines", sa.Text(), nullable=True),
        sa.Column("raw_entry", sa.Text(), nullable=True),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("line_number", sa.Integer(), nullable=True),
        sa.Column("column_number", sa.Integer(), nullable=True),
        sa.Column("function_name", sa.Text(), nullable=True),
        sa.Column("signature_hash", sa.Text(), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=True, server_default=sa.text("1")),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("status", sa.Text(), nullable=True, server_default=sa.text("'new'")),
        sa.Column("finding_id", sa.Text(), nullable=True),
        sa.Column("resolved_by_task_run_id", sa.Text(), nullable=True),
        sa.Column("resolved_by_fix_id", sa.Text(), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("message_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("trace_id", sa.Text(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_error_events_log_source", "error_events", ["log_source_id"], schema="project")
    op.create_index("idx_error_events_task_run", "error_events", ["task_run_id"], schema="project")
    op.create_index("idx_error_events_signature", "error_events", ["signature_hash"], schema="project")
    op.create_index("idx_error_events_status", "error_events", ["status"], schema="project")
    op.create_index("idx_error_events_severity", "error_events", ["severity"], schema="project")
    op.create_index("idx_error_events_captured", "error_events", [sa.text("captured_at DESC")], schema="project")
    op.create_index("idx_error_events_last_seen", "error_events", [sa.text("last_seen_at DESC")], schema="project")
    op.create_index("idx_error_events_source_name", "error_events", ["log_source_name"], schema="project")
    op.create_index("idx_error_events_trace_id", "error_events", ["trace_id"], schema="project")
    op.execute(
        "CREATE INDEX idx_ee_fts ON project.error_events "
        "USING GIN (to_tsvector('english', message || ' ' || COALESCE(stack_trace, '') || ' ' || COALESCE(context_lines, '')))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS project.idx_ee_fts")
    op.drop_table("error_events", schema="project")
    op.drop_table("prompt_template_canaries", schema="project")
    op.drop_table("canary_run_records", schema="project")
    op.drop_table("canary_rollouts", schema="project")
    op.drop_table("meta_optimizer_recommendations", schema="project")
    op.drop_table("prompt_registry", schema="project")
    op.drop_table("agentic_metric_baselines", schema="project")
    op.drop_table("agentic_metric_scores", schema="project")
    op.drop_table("watchers", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_at_fts")
    op.drop_table("activity_timeline", schema="project")
