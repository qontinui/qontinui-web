"""consolidation phase1 17 issues / discovery / knowledge (CROSS-SCHEMA)

Revision ID: consolidation_phase1_17_issues_discovery_knowledge
Revises: consolidation_phase1_16_generation_eval
Create Date: 2026-04-29

Phase 1, batch 17: THIRD cross-schema batch. Per mapping:

PROJECT (durable):
- ``project.known_issues`` (FK→task_runs SET NULL).
- ``project.issue_pattern_templates``.
- ``project.pending_discoveries``.
- ``project.step_type_knowledge`` (FK→reflection_fixes SET NULL).
- ``project.task_knowledge_summaries`` (FK→task_runs CASCADE).
- ``project.ai_workflows``.
- ``project.executions``.
- ``project.config_statistics`` (FK→configs CASCADE).
- ``project.causal_events``.

COORD (cross-instance coordination):
- ``coord.gui_lock`` — singleton mutex with CROSS-SCHEMA FK
  to ``project.sessions(id)`` SET NULL. Postgres supports cross-schema
  FKs natively; reference written as ``project.sessions.id``.

Source: ``schema.pg.sql:2388-2581``.

DRIFT FLAGS (preserved):
- ``known_issues.pattern_template_id`` is a soft FK to
  ``issue_pattern_templates(id)`` per source comment but no constraint.
- ``causal_events.task_run_id`` has no FK declared. Preserved.
- ``executions.workflow_name`` has no FK to ``unified_workflows.name``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_17_issues_discovery_knowledge"
down_revision: str = "consolidation_phase1_16_generation_eval"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---------- project.* ----------

    op.create_table(
        "known_issues",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False, server_default=sa.text("'other'")),
        sa.Column("scope_type", sa.Text(), nullable=False, server_default=sa.text("'global'")),
        sa.Column("scope_value", sa.Text(), nullable=True),
        sa.Column("scope_tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("detection_method", sa.Text(), nullable=False, server_default=sa.text("'ai_judgment'")),
        sa.Column("detection_config", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("pattern_template_id", sa.Text(), nullable=True),
        sa.Column("reproduction_context", sa.Text(), nullable=True),
        sa.Column("trigger_conditions", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("severity", sa.Text(), nullable=False, server_default=sa.text("'medium'")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("provenance", sa.Text(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("source_finding_ids", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column(
            "source_task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("verification_hint", sa.Text(), nullable=True),
        sa.Column("verification_step_template", sa.Text(), nullable=True),
        sa.Column("times_detected", sa.Integer(), nullable=True, server_default=sa.text("1")),
        sa.Column("times_checked", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("last_detected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("description_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_known_issues_category", "known_issues", ["category"], schema="project")
    op.create_index("idx_known_issues_scope_type", "known_issues", ["scope_type"], schema="project")
    op.create_index("idx_known_issues_status", "known_issues", ["status"], schema="project")
    op.create_index("idx_known_issues_severity", "known_issues", ["severity"], schema="project")
    op.create_index("idx_known_issues_scope_value", "known_issues", ["scope_value"], schema="project")
    op.create_index("idx_known_issues_scope_compound", "known_issues", ["scope_type", "scope_value", "status"], schema="project")

    op.create_table(
        "issue_pattern_templates",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("detection_type", sa.Text(), nullable=False),
        sa.Column("step_template", sa.Text(), nullable=True),
        sa.Column("ai_prompt_template", sa.Text(), nullable=True),
        sa.Column("parameters", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("built_in", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ipt_category", "issue_pattern_templates", ["category"], schema="project")
    op.create_index("idx_ipt_status", "issue_pattern_templates", ["status"], schema="project")

    op.create_table(
        "pending_discoveries",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_attempt", sa.Text(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_pending_discoveries_created_at", "pending_discoveries", ["created_at"], schema="project")
    op.create_index("idx_pending_discoveries_attempt_count", "pending_discoveries", ["attempt_count"], schema="project")

    op.create_table(
        "step_type_knowledge",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("step_type", sa.Text(), nullable=False),
        sa.Column("layer", sa.Text(), nullable=False, server_default=sa.text("'universal'")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("provenance", sa.Text(), nullable=False, server_default=sa.text("'seed'")),
        sa.Column(
            "source_fix_id",
            sa.Text(),
            sa.ForeignKey("project.reflection_fixes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_stk_step_type", "step_type_knowledge", ["step_type"], schema="project")
    op.create_index("idx_stk_layer", "step_type_knowledge", ["layer"], schema="project")
    op.create_index("idx_stk_composite", "step_type_knowledge", ["step_type", "layer", "status"], schema="project")

    op.create_table(
        "task_knowledge_summaries",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("covered_iterations", sa.Text(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("original_tokens", sa.Integer(), nullable=True),
        sa.Column("compressed_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_task_knowledge_summaries_task_run_id", "task_knowledge_summaries", ["task_run_id"], schema="project")
    op.create_index("idx_task_knowledge_summaries_category", "task_knowledge_summaries", ["category"], schema="project")

    op.create_table(
        "ai_workflows",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )

    op.create_table(
        "executions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("config_path", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("result_data", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_executions_started_at", "executions", ["started_at"], schema="project")
    op.create_index("idx_executions_workflow_name", "executions", ["workflow_name"], schema="project")

    op.create_table(
        "config_statistics",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "config_id",
            sa.Text(),
            sa.ForeignKey("project.configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("config_hash", sa.Text(), nullable=True),
        sa.Column("total_runs", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("successful_runs", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("failed_runs", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("timeout_runs", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("avg_duration_ms", sa.Integer(), nullable=True),
        sa.Column("recent_success_rate", sa.Float(), nullable=True),
        sa.Column("recent_avg_duration_ms", sa.Integer(), nullable=True),
        sa.Column("transition_stats", sa.Text(), nullable=True),
        sa.Column("template_stats", sa.Text(), nullable=True),
        sa.Column("state_stats", sa.Text(), nullable=True),
        sa.Column("error_patterns", sa.Text(), nullable=True),
        sa.Column("flaky_transitions", sa.Text(), nullable=True),
        sa.Column("flaky_templates", sa.Text(), nullable=True),
        sa.Column("first_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("config_id"),
        schema="project",
    )
    op.create_index("idx_config_statistics_config_id", "config_statistics", ["config_id"], schema="project")

    op.create_table(
        "causal_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("cause_event_type", sa.Text(), nullable=False),
        sa.Column("cause_event_id", sa.Text(), nullable=False),
        sa.Column("effect_event_type", sa.Text(), nullable=False),
        sa.Column("effect_event_id", sa.Text(), nullable=False),
        sa.Column("relationship", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Text(), nullable=False, server_default=sa.text("'high'")),
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'automated'")),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_causal_cause", "causal_events", ["cause_event_type", "cause_event_id"], schema="project")
    op.create_index("idx_causal_effect", "causal_events", ["effect_event_type", "effect_event_id"], schema="project")
    op.create_index("idx_causal_workflow", "causal_events", ["workflow_name"], schema="project")
    op.create_index("idx_causal_task_run", "causal_events", ["task_run_id"], schema="project")
    op.create_index(
        "idx_causal_dedup", "causal_events",
        ["cause_event_type", "cause_event_id", "effect_event_type", "effect_event_id"],
        unique=True,
        schema="project",
    )

    # ---------- coord.* ----------

    # coord.gui_lock — singleton; CROSS-SCHEMA FK to project.sessions(id) SET NULL
    op.create_table(
        "gui_lock",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "holder_session_id",
            sa.Text(),
            sa.ForeignKey("project.sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = 1", name="gui_lock_singleton"),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_table("gui_lock", schema="coord")
    op.drop_table("causal_events", schema="project")
    op.drop_table("config_statistics", schema="project")
    op.drop_table("executions", schema="project")
    op.drop_table("ai_workflows", schema="project")
    op.drop_table("task_knowledge_summaries", schema="project")
    op.drop_table("step_type_knowledge", schema="project")
    op.drop_table("pending_discoveries", schema="project")
    op.drop_table("issue_pattern_templates", schema="project")
    op.drop_table("known_issues", schema="project")
