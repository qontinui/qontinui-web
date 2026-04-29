"""consolidation phase1 20 tail + specialty (CROSS-SCHEMA, large)

Revision ID: consolidation_phase1_20_tail_specialty
Revises: consolidation_phase1_19_tests_verification_comparison
Create Date: 2026-04-29

Phase 1, batch 20: FINAL Phase 1 batch. Cross-schema. Largest batch by
table count — this is the "everything else" sweep.

PROJECT (durable):
- task_run_automation, task_run_mcp_calls, task_run_output_chunks
- trigger_history, scheduler_history, workflow_triggers, workflow_variables
- spec_versions, entailment_cache, wsv_shadow_disagreements
- prm_training_exports, playbook_entries, curated_examples
- template_performance, template_lifecycle_events
- gepa_optimization_runs, step_templates, exploration_stats
- iteration_logs, performance_drift_signals, drift_detector_state
- model_routing_table, model_routing_overrides, model_routing_decisions
- experience_summaries, step_credit_assignments, strategy_bank
- security_audit_events, phase_model_routing
- restate_workflow_executions, restate_awakeables
- contradiction_resolutions, entity_profiles, reasoning_traces
- working_representations, span_events
- duel_pools, duel_candidates, duel_results
- beam_search_runs, beam_candidates, resource_versions
- pr_watch_state, learned_patterns
- ticket_task_mapping, ticket_provider_configs
- ui_bridge_baselines, breakpoint_snapshots, workflow_event_log
- compensation_actions, phase_results
- vga_state_machines, vga_runs, vga_shadow_samples
- co_occurrence_observations, state_discovery_artifacts, state_discovery_drift_scores
- chunk_labels, productivity_knowledge

COORD (cross-instance coordination, productivity stack):
- plans, tasks, reviews
- coordinator_decisions, coordinator_leader, session_file_snapshots

AGENT (ephemeral / cache):
- memory_query_cache (TTL cache)

CROSS-SCHEMA FKs in this batch:
- ``project.productivity_knowledge.task_id`` → ``coord.tasks(id)`` SET NULL.

DRIFT FLAGS / NOTABLE DETAILS:
- ``learned_patterns`` source uses ``CREATE INDEX CONCURRENTLY``; this
  port uses regular ``CREATE INDEX`` since CONCURRENTLY can't run inside
  alembic's transaction. Fresh-DB scenario: regular CREATE INDEX is safe
  (no concurrent contention). Documented.
- ``compensation_actions`` and ``phase_results`` use JSONB columns (the
  rest of the schema mostly uses TEXT for JSON).
- ``vga_state_machines.id`` is ``UUID``.
- ``security_audit_events.timestamp`` is ``TEXT`` not ``TIMESTAMPTZ``.

ALTER TABLEs folded in:
- ``learning_outcomes.model_used`` (Phase 1A addition; learning_outcomes
  was created in batch 5 without this column).
- ``memory_consolidation_log`` Dreamer columns (is_dreamer,
  inductive_traces, deductive_traces, abductive_traces).
- ``scheduler_history.scheduled_for`` and ``catch_up_run`` (folded
  inline into the CREATE TABLE since scheduler_history is created here).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_20_tail_specialty"
down_revision: str = "consolidation_phase1_19_tests_verification_comparison"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ============================================================
    # COORD — productivity stack (must precede project tables that
    # cross-reference coord.tasks)
    # ============================================================

    op.create_table(
        "plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("markdown_path", sa.Text(), nullable=False),
        sa.Column("version_hash", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_plans_path", "plans", ["markdown_path"], unique=True, schema="coord")
    op.create_index("idx_plans_status", "plans", ["status"], schema="coord")

    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plan_version_hash", sa.Text(), nullable=False),
        sa.Column("phase_name", sa.Text(), nullable=False),
        sa.Column("sequence_in_phase", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("expected_file_claims", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("expected_dirs", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("depends_on", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("assigned_session_id", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_tasks_plan", "tasks", ["plan_id"], schema="coord")
    op.create_index("idx_tasks_status", "tasks", ["status"], schema="coord")
    op.create_index(
        "idx_tasks_assigned_session", "tasks", ["assigned_session_id"],
        schema="coord",
        postgresql_where=sa.text("assigned_session_id IS NOT NULL"),
    )
    op.create_index("idx_tasks_phase", "tasks", ["plan_id", "phase_name", "sequence_in_phase"], schema="coord")

    op.create_table(
        "coordinator_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("iteration", sa.BigInteger(), nullable=False),
        sa.Column("rule", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=False),
        sa.Column("auto_acted", sa.Boolean(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_cd_session", "coordinator_decisions", ["session_id"], schema="coord")
    op.create_index("idx_cd_created", "coordinator_decisions", [sa.text("created_at DESC")], schema="coord")
    op.create_index("idx_cd_rule_action", "coordinator_decisions", ["rule", "action"], schema="coord")
    op.create_index(
        "idx_cd_open_escalations", "coordinator_decisions", [sa.text("created_at DESC")],
        schema="coord",
        postgresql_where=sa.text("resolved = FALSE AND auto_acted = FALSE AND action IN ('escalate', 'kill-session', 'force-promote-to-worktree')"),
    )

    op.create_table(
        "coordinator_leader",
        sa.Column("id", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("instance_id", sa.Text(), nullable=False),
        sa.Column("leased_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("renewed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = TRUE", name="coordinator_leader_singleton"),
        schema="coord",
    )

    op.create_table(
        "session_file_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("snapshot_blob_path", sa.Text(), nullable=False),
        sa.Column("blob_sha256", sa.Text(), nullable=False),
        sa.Column("captured_before", sa.Boolean(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_sfs_session", "session_file_snapshots", ["session_id"], schema="coord")
    op.create_index("idx_sfs_session_file", "session_file_snapshots", ["session_id", "file_path"], schema="coord")

    op.create_table(
        "reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reviewer_session_id", sa.Text(), nullable=False),
        sa.Column("reviewed_session_id", sa.Text(), nullable=False),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("reasoning", sa.Text(), nullable=False),
        sa.Column("diff_summary", postgresql.JSONB(), nullable=True),
        sa.Column("test_results", postgresql.JSONB(), nullable=True),
        sa.Column("user_decision", sa.Text(), nullable=True),
        sa.Column("user_decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_reviews_task", "reviews", ["task_id"], schema="coord")
    op.create_index("idx_reviews_reviewed_session", "reviews", ["reviewed_session_id"], schema="coord")
    op.create_index("idx_reviews_verdict", "reviews", ["verdict"], schema="coord")
    op.create_index(
        "idx_reviews_pending_recommendations", "reviews", [sa.text("created_at DESC")],
        schema="coord",
        postgresql_where=sa.text("verdict = 'approved' AND confidence >= 0.7 AND confidence < 0.85 AND user_decision IS NULL"),
    )

    # ============================================================
    # AGENT — ephemeral cache
    # ============================================================

    op.create_table(
        "memory_query_cache",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("query_hash", sa.Text(), nullable=False),
        sa.Column("reasoning_level", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("hit_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="agent",
    )
    op.create_index("idx_mqc_hash_level", "memory_query_cache", ["query_hash", "reasoning_level"], unique=True, schema="agent")
    op.create_index("idx_mqc_expires", "memory_query_cache", ["expires_at"], schema="agent")

    # ============================================================
    # PROJECT — all remaining durable tables
    # ============================================================

    # task_run_automation
    op.create_table(
        "task_run_automation",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("automation_status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("error_type", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("actions_summary", sa.Text(), nullable=True),
        sa.Column("states_visited", sa.Text(), nullable=True),
        sa.Column("transitions_executed", sa.Text(), nullable=True),
        sa.Column("template_matches", sa.Text(), nullable=True),
        sa.Column("anomalies", sa.Text(), nullable=True),
        sa.Column("iteration_number", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_task_run_automation_task_run_id", "task_run_automation", ["task_run_id"], schema="project")
    op.create_index("idx_task_run_automation_started_at", "task_run_automation", ["started_at"], schema="project")
    op.create_index("idx_task_run_automation_status", "task_run_automation", ["automation_status"], schema="project")

    # task_run_mcp_calls (FK→task_runs, FK→mcp_servers)
    op.create_table(
        "task_run_mcp_calls",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_id", sa.Text(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=True),
        sa.Column(
            "server_id",
            sa.Text(),
            sa.ForeignKey("project.mcp_servers.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column("server_name", sa.Text(), nullable=True),
        sa.Column("tool_name", sa.Text(), nullable=False),
        sa.Column("arguments", sa.Text(), nullable=True),
        sa.Column("resolved_arguments", sa.Text(), nullable=True),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("response_type", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("extractions", sa.Text(), nullable=True),
        sa.Column("assertions", sa.Text(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_task_run_mcp_calls_task_run_id", "task_run_mcp_calls", ["task_run_id"], schema="project")
    op.create_index("idx_task_run_mcp_calls_server_id", "task_run_mcp_calls", ["server_id"], schema="project")
    op.create_index("idx_task_run_mcp_calls_step_id", "task_run_mcp_calls", ["step_id"], schema="project")
    op.create_index("idx_task_run_mcp_calls_created_at", "task_run_mcp_calls", ["created_at"], schema="project")
    op.create_index("idx_task_run_mcp_calls_success", "task_run_mcp_calls", ["success"], schema="project")

    # task_run_output_chunks
    op.create_table(
        "task_run_output_chunks",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_sequence", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_chunks_task_run", "task_run_output_chunks", ["task_run_id", "chunk_sequence"], schema="project")

    # trigger_history
    op.create_table(
        "trigger_history",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("trigger_id", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("event_data", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_trigger_history_trigger_id", "trigger_history", ["trigger_id"], schema="project")
    op.create_index("idx_trigger_history_triggered_at", "trigger_history", ["triggered_at"], schema="project")

    # scheduler_history (folds Phase A scheduled_for + catch_up_run inline)
    op.create_table(
        "scheduler_history",
        sa.Column("execution_id", sa.Text(), nullable=False),
        sa.Column(
            "task_id",
            sa.Text(),
            sa.ForeignKey("project.scheduled_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("triggered_auto_fix", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("auto_fix_session_id", sa.Text(), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("catch_up_run", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("execution_id"),
        schema="project",
    )
    op.create_index("idx_scheduler_history_task_id", "scheduler_history", ["task_id"], schema="project")
    op.create_index("idx_scheduler_history_started_at", "scheduler_history", ["started_at"], schema="project")
    op.create_index("idx_scheduler_history_status", "scheduler_history", ["status"], schema="project")
    op.create_index("idx_scheduler_history_task_scheduled_for", "scheduler_history", ["task_id", "scheduled_for"], schema="project")

    # workflow_triggers
    op.create_table(
        "workflow_triggers",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("trigger_type", sa.Text(), nullable=False),
        sa.Column("trigger_config", sa.Text(), nullable=False),
        sa.Column(
            "workflow_id",
            sa.Text(),
            sa.ForeignKey("project.unified_workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("workflow_overrides", sa.Text(), nullable=True),
        sa.Column("conditions", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("debounce_ms", sa.BigInteger(), nullable=True, server_default=sa.text("1000")),
        sa.Column("cooldown_seconds", sa.BigInteger(), nullable=True, server_default=sa.text("60")),
        sa.Column("max_concurrent", sa.Integer(), nullable=True, server_default=sa.text("1")),
        sa.Column("retry_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("retry_delay_seconds", sa.BigInteger(), nullable=True, server_default=sa.text("30")),
        sa.Column("enabled", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_execution_id", sa.Text(), nullable=True),
        sa.Column("trigger_count", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_workflow_triggers_type", "workflow_triggers", ["trigger_type"], schema="project")
    op.create_index("idx_workflow_triggers_enabled", "workflow_triggers", ["enabled"], schema="project")

    # workflow_variables
    op.create_table(
        "workflow_variables",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("variable_name", sa.Text(), nullable=False),
        sa.Column("variable_value", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_step_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_run_id", "variable_name", name="workflow_variables_uniq"),
        schema="project",
    )
    op.create_index("idx_workflow_variables_task_run_id", "workflow_variables", ["task_run_id"], schema="project")
    op.create_index("idx_workflow_variables_name", "workflow_variables", ["variable_name"], schema="project")

    # spec_versions
    op.create_table(
        "spec_versions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("spec_id", sa.Text(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("spec_json", sa.Text(), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("change_type", sa.Text(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("parent_version_id", sa.Text(), nullable=True),
        sa.Column("assertion_count", sa.Integer(), nullable=False),
        sa.Column("group_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_spec_versions_spec", "spec_versions", ["spec_id"], schema="project")
    op.create_index("idx_spec_versions_hash", "spec_versions", ["content_hash"], schema="project")
    op.create_index("idx_spec_versions_num", "spec_versions", ["spec_id", "version_number"], unique=True, schema="project")

    # entailment_cache (composite PK)
    op.create_table(
        "entailment_cache",
        sa.Column("criterion_hash", sa.BigInteger(), nullable=False),
        sa.Column("step_hash", sa.BigInteger(), nullable=False),
        sa.Column("score", postgresql.DOUBLE_PRECISION(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("tier", sa.Text(), nullable=True),
        sa.Column("cached_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("criterion_hash", "step_hash"),
        schema="project",
    )
    op.create_index("idx_entailment_cache_cached_at", "entailment_cache", ["cached_at"], schema="project")

    # wsv_shadow_disagreements
    op.create_table(
        "wsv_shadow_disagreements",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("text_status", sa.Text(), nullable=False),
        sa.Column("wsm_status", sa.Text(), nullable=False),
        sa.Column("text_confidence", sa.Float(), nullable=False),
        sa.Column("wsm_confidence", sa.Float(), nullable=False),
        sa.Column("intent", sa.Text(), nullable=False),
        sa.Column("wsm_observations", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_wsv_disagreements_task_run", "wsv_shadow_disagreements", ["task_run_id"], schema="project")
    op.create_index("idx_wsv_disagreements_created_at", "wsv_shadow_disagreements", [sa.text("created_at DESC")], schema="project")

    # prm_training_exports
    op.create_table(
        "prm_training_exports",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("export_format", sa.Text(), nullable=False, server_default=sa.text("'jsonl'")),
        sa.Column("total_examples", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("passed_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("fixed_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("runs_processed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_prm_exports_created", "prm_training_exports", ["created_at"], schema="project")

    # playbook_entries
    op.create_table(
        "playbook_entries",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("lesson", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=True),
        sa.Column("severity", sa.Text(), nullable=False, server_default=sa.text("'minor'")),
        sa.Column("source_run_id", sa.Text(), nullable=False),
        sa.Column("source_step_id", sa.Text(), nullable=True),
        sa.Column("positive", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("times_applied", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("times_helped", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'staged'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_playbook_entries_domain", "playbook_entries", ["domain"], schema="project")
    op.create_index("idx_playbook_entries_status", "playbook_entries", ["status"], schema="project")
    op.create_index("idx_playbook_entries_severity", "playbook_entries", ["severity"], schema="project")

    # curated_examples
    op.create_table(
        "curated_examples",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("criterion_description", sa.Text(), nullable=False),
        sa.Column("steps_json", sa.Text(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("execution_verified", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("times_used", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_curated_examples_domain", "curated_examples", ["domain"], schema="project")
    op.create_index("idx_curated_examples_quality", "curated_examples", ["quality_score"], schema="project")

    # template_performance
    op.create_table(
        "template_performance",
        sa.Column("template_id", sa.Text(), nullable=False),
        sa.Column("template_name", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_quality_score", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("template_id"),
        schema="project",
    )

    # template_lifecycle_events
    op.create_table(
        "template_lifecycle_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("template_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("old_source", sa.Text(), nullable=False),
        sa.Column("new_source", sa.Text(), nullable=False),
        sa.Column("confidence_at_transition", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_lifecycle_events_template", "template_lifecycle_events", ["template_id"], schema="project")

    # gepa_optimization_runs
    op.create_table(
        "gepa_optimization_runs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("old_instructions", sa.Text(), nullable=False),
        sa.Column("new_instructions", sa.Text(), nullable=True),
        sa.Column("old_score", sa.Float(), nullable=True),
        sa.Column("new_score", sa.Float(), nullable=True),
        sa.Column("improvement", sa.Float(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_gepa_runs_domain", "gepa_optimization_runs", ["domain"], schema="project")
    op.create_index("idx_gepa_runs_created", "gepa_optimization_runs", ["created_at"], schema="project")

    # step_templates
    op.create_table(
        "step_templates",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("pattern_description", sa.Text(), nullable=False),
        sa.Column("template_steps_json", sa.Text(), nullable=False),
        sa.Column("parameters_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'seeded'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_step_templates_domain", "step_templates", ["domain"], schema="project")

    # exploration_stats
    op.create_table(
        "exploration_stats",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("total_candidates", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("search_depth", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("search_duration_ms", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("best_score", sa.Float(), nullable=True),
        sa.Column("strategy_used", sa.Text(), nullable=True),
        sa.Column("score_progression", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_exploration_stats_workflow", "exploration_stats", ["workflow_id"], schema="project")

    # iteration_logs
    op.create_table(
        "iteration_logs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("provider_used", sa.Text(), nullable=True),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_iteration_logs_task_run", "iteration_logs", ["task_run_id"], schema="project")
    op.create_index(
        "idx_iteration_logs_provider", "iteration_logs", ["provider_used"],
        schema="project",
        postgresql_where=sa.text("provider_used IS NOT NULL"),
    )

    # performance_drift_signals
    op.create_table(
        "performance_drift_signals",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("detector_type", sa.Text(), nullable=False),
        sa.Column("metric_name", sa.Text(), nullable=False),
        sa.Column("context_key", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("drift_level", sa.Text(), nullable=False),
        sa.Column("pre_drift_mean", sa.Float(), nullable=True),
        sa.Column("post_drift_mean", sa.Float(), nullable=True),
        sa.Column("window_size", sa.BigInteger(), nullable=True),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_drift_context", "performance_drift_signals", ["context_key", "metric_name"], schema="project")
    op.create_index(
        "idx_drift_unack", "performance_drift_signals", ["acknowledged"],
        schema="project",
        postgresql_where=sa.text("acknowledged = false"),
    )

    # drift_detector_state
    op.create_table(
        "drift_detector_state",
        sa.Column("detector_id", sa.Text(), nullable=False),
        sa.Column("detector_type", sa.Text(), nullable=False),
        sa.Column("state_json", sa.Text(), nullable=False),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("detector_id"),
        schema="project",
    )

    # model_routing_table
    op.create_table(
        "model_routing_table",
        sa.Column("context_key", sa.Text(), nullable=False),
        sa.Column("model_id", sa.Text(), nullable=False),
        sa.Column("q_value", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("visit_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("sum_of_squares", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("context_key", "model_id"),
        schema="project",
    )

    # model_routing_overrides
    op.create_table(
        "model_routing_overrides",
        sa.Column("context_key", sa.Text(), nullable=False),
        sa.Column("forced_model", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("context_key"),
        schema="project",
    )

    # model_routing_decisions
    op.create_table(
        "model_routing_decisions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("context_key", sa.Text(), nullable=False),
        sa.Column("model_selected", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("exploration", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reward", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_mrd_task_run", "model_routing_decisions", ["task_run_id"], schema="project")
    op.create_index("idx_mrd_model", "model_routing_decisions", ["model_selected"], schema="project")

    # experience_summaries
    op.create_table(
        "experience_summaries",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("complexity_tier", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("key_decisions_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("failure_points_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("effective_patterns_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("similarity_cluster", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_exp_domain", "experience_summaries", ["domain"], schema="project")
    op.create_index("idx_exp_outcome", "experience_summaries", ["outcome"], schema="project")

    # step_credit_assignments
    op.create_table(
        "step_credit_assignments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("step_type", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=True),
        sa.Column("raw_credit", sa.Float(), nullable=False),
        sa.Column("normalized_credit", sa.Float(), nullable=False),
        sa.Column("temporal_proximity", sa.Float(), nullable=True),
        sa.Column("output_utilization", sa.Float(), nullable=True),
        sa.Column("confidence_delta_signal", sa.Float(), nullable=True),
        sa.Column("downstream_success_signal", sa.Float(), nullable=True),
        sa.Column("cost_efficiency_signal", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sca_task_run", "step_credit_assignments", ["task_run_id"], schema="project")
    op.create_index("idx_sca_step_type", "step_credit_assignments", ["step_type"], schema="project")

    # strategy_bank (self-FK SET NULL)
    op.create_table(
        "strategy_bank",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("applicability_json", sa.Text(), nullable=False),
        sa.Column("components_json", sa.Text(), nullable=False),
        sa.Column("stats_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("provenance_json", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'candidate'")),
        sa.Column(
            "parent_strategy_id",
            sa.Text(),
            sa.ForeignKey(
                "project.strategy_bank.id",
                ondelete="SET NULL",
                name="strategy_bank_parent_fkey",
            ),
            nullable=True,
        ),
        sa.Column("embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_strategy_status", "strategy_bank", ["status"], schema="project")
    op.create_index("idx_strategy_parent", "strategy_bank", ["parent_strategy_id"], schema="project")

    # security_audit_events
    op.create_table(
        "security_audit_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("step_name", sa.Text(), nullable=True),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_sec_audit_task_run", "security_audit_events", ["task_run_id"],
        schema="project",
        postgresql_where=sa.text("task_run_id IS NOT NULL"),
    )
    op.create_index("idx_sec_audit_type", "security_audit_events", ["event_type"], schema="project")
    op.create_index("idx_sec_audit_decision", "security_audit_events", ["decision"], schema="project")
    op.create_index("idx_sec_audit_created", "security_audit_events", ["created_at"], schema="project")

    # phase_model_routing
    op.create_table(
        "phase_model_routing",
        sa.Column("state_key", sa.Text(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("model_tier", sa.Text(), nullable=False),
        sa.Column("q_value", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("visit_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("state_key", "phase", "model_tier"),
        schema="project",
    )
    op.create_index("idx_phase_model_routing_state", "phase_model_routing", ["state_key"], schema="project")

    # restate_workflow_executions (PK is execution_id; FK→task_runs CASCADE)
    op.create_table(
        "restate_workflow_executions",
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("restate_workflow_id", sa.Text(), nullable=False),
        sa.Column("restate_invocation_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("launched_via_restate", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("execution_id"),
        schema="project",
    )
    op.create_index("idx_rwe_status", "restate_workflow_executions", ["status"], schema="project")
    op.create_index("idx_rwe_restate_wf", "restate_workflow_executions", ["restate_workflow_id"], schema="project")

    # restate_awakeables (FK→task_runs CASCADE)
    op.create_table(
        "restate_awakeables",
        sa.Column("awakeable_id", sa.Text(), nullable=False),
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("awakeable_type", sa.Text(), nullable=False),
        sa.Column("type_data", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("awakeable_id"),
        schema="project",
    )
    op.create_index("idx_ra_execution", "restate_awakeables", ["execution_id"], schema="project")
    op.create_index("idx_ra_status", "restate_awakeables", ["status"], schema="project")

    # contradiction_resolutions (multiple FKs to observations)
    op.create_table(
        "contradiction_resolutions",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "observation_a_id",
            sa.BigInteger(),
            sa.ForeignKey("project.observations.id"),
            nullable=False,
        ),
        sa.Column(
            "observation_b_id",
            sa.BigInteger(),
            sa.ForeignKey("project.observations.id"),
            nullable=False,
        ),
        sa.Column("resolution_type", sa.Text(), nullable=False),
        sa.Column(
            "winner_id",
            sa.BigInteger(),
            sa.ForeignKey("project.observations.id"),
            nullable=True,
        ),
        sa.Column(
            "loser_id",
            sa.BigInteger(),
            sa.ForeignKey("project.observations.id"),
            nullable=True,
        ),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("evidence_json", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_by", sa.Text(), nullable=False, server_default=sa.text("'system'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_cr_obs_a", "contradiction_resolutions", ["observation_a_id"], schema="project")
    op.create_index("idx_cr_obs_b", "contradiction_resolutions", ["observation_b_id"], schema="project")
    op.create_index("idx_cr_resolved", "contradiction_resolutions", ["resolved_at"], schema="project")

    # entity_profiles (self-FK; GIN FTS; arrays)
    op.create_table(
        "entity_profiles",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("entity_kind", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        sa.Column("entity_label", sa.Text(), nullable=False),
        sa.Column("profile_summary", sa.Text(), nullable=False),
        sa.Column("profile_detail", sa.Text(), nullable=True),
        sa.Column("topic_key", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("importance", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("decay_rate", sa.Float(), nullable=False, server_default=sa.text("0.02")),
        sa.Column("access_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision_count", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("source_observation_ids", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("source_finding_ids", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("source_fix_ids", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("source_cross_run_pattern_ids", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "superseded_by",
            sa.BigInteger(),
            sa.ForeignKey("project.entity_profiles.id", name="entity_profiles_superseded_by_fkey"),
            nullable=True,
        ),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_ep_entity", "entity_profiles", ["entity_kind", "entity_id"],
        unique=True,
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "idx_ep_topic_key", "entity_profiles", ["topic_key"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.create_index(
        "idx_ep_importance", "entity_profiles", ["importance"],
        schema="project",
        postgresql_where=sa.text("NOT is_deleted"),
    )
    op.execute(
        "CREATE INDEX idx_ep_fts ON project.entity_profiles "
        "USING GIN (to_tsvector('english', entity_label || ' ' || profile_summary)) "
        "WHERE NOT is_deleted"
    )

    # reasoning_traces
    op.create_table(
        "reasoning_traces",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("reasoning_type", sa.Text(), nullable=False),
        sa.Column("premise_ids", postgresql.ARRAY(sa.BigInteger()), nullable=False),
        sa.Column("conclusion", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("evidence_json", sa.Text(), nullable=True),
        sa.Column(
            "created_observation_id",
            sa.BigInteger(),
            sa.ForeignKey("project.observations.id"),
            nullable=True,
        ),
        sa.Column("dreamer_run_id", sa.BigInteger(), nullable=True),
        sa.Column("is_valid", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "invalidated_by",
            sa.BigInteger(),
            sa.ForeignKey("project.reasoning_traces.id", name="reasoning_traces_invalidated_by_fkey"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_rt_type", "reasoning_traces", ["reasoning_type"], schema="project")
    op.create_index("idx_rt_run", "reasoning_traces", ["dreamer_run_id"], schema="project")
    op.create_index("idx_rt_created", "reasoning_traces", ["created_at"], schema="project")
    op.create_index(
        "idx_rt_valid", "reasoning_traces", ["is_valid"],
        schema="project",
        postgresql_where=sa.text("is_valid"),
    )

    # working_representations (FK→task_runs CASCADE; UNIQUE)
    op.create_table(
        "working_representations",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("observations_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("cross_run_patterns_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("entity_profiles_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("recent_findings_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("recent_fixes_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("applicable_skills_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("total_items", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("build_duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_run_id"),
        schema="project",
    )
    op.create_index("idx_wr_task_run", "working_representations", ["task_run_id"], schema="project")
    op.create_index("idx_wr_expires", "working_representations", ["expires_at"], schema="project")

    # span_events (no FK on execution_id per source)
    op.create_table(
        "span_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("execution_id", sa.Text(), nullable=False),
        sa.Column("trace_id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("metric_name", sa.Text(), nullable=True),
        sa.Column("reward_value", sa.Float(), nullable=True),
        sa.Column("data_key", sa.Text(), nullable=True),
        sa.Column("data_json", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_span_events_exec", "span_events", ["execution_id"], schema="project")
    op.create_index("idx_span_events_trace", "span_events", ["trace_id"], schema="project")
    op.create_index("idx_span_events_type", "span_events", ["event_type"], schema="project")

    # duel_pools / candidates / results
    op.create_table(
        "duel_pools",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("generation", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("config_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_dp_agent", "duel_pools", ["agent_type"], schema="project")
    op.create_index("idx_dp_status", "duel_pools", ["status"], schema="project")

    op.create_table(
        "duel_candidates",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("pool_id", sa.Text(), nullable=False),
        sa.Column("prompt_content", sa.Text(), nullable=False),
        sa.Column("variant_id", sa.Text(), nullable=True),
        sa.Column("generation", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("parent_id", sa.Text(), nullable=True),
        sa.Column("copeland_score", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("alpha", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("beta", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_dc_pool", "duel_candidates", ["pool_id"], schema="project")
    op.create_index("idx_dc_status", "duel_candidates", ["pool_id", "status"], schema="project")

    op.create_table(
        "duel_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("pool_id", sa.Text(), nullable=False),
        sa.Column("candidate_a_id", sa.Text(), nullable=False),
        sa.Column("candidate_b_id", sa.Text(), nullable=False),
        sa.Column("winner_id", sa.Text(), nullable=False),
        sa.Column("judge_rationale", sa.Text(), nullable=True),
        sa.Column("position_swapped", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_dr_pool", "duel_results", ["pool_id"], schema="project")

    # beam_search_runs / candidates
    op.create_table(
        "beam_search_runs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("pool_id", sa.Text(), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_bsr_agent", "beam_search_runs", ["agent_type"], schema="project")
    op.create_index("idx_bsr_pool", "beam_search_runs", ["pool_id"], schema="project")

    op.create_table(
        "beam_candidates",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("beam_run_id", sa.Text(), nullable=False),
        sa.Column("parent_id", sa.Text(), nullable=True),
        sa.Column("prompt_content", sa.Text(), nullable=False),
        sa.Column("critique", sa.Text(), nullable=True),
        sa.Column("changes_summary", sa.Text(), nullable=True),
        sa.Column("generation", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("thinking_style", sa.Text(), nullable=True),
        sa.Column("variant_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_bc_run", "beam_candidates", ["beam_run_id"], schema="project")
    op.create_index("idx_bc_gen", "beam_candidates", ["beam_run_id", "generation"], schema="project")

    # resource_versions
    op.create_table(
        "resource_versions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("resource_key", sa.Text(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("resource_type", "resource_key", "version", name="resource_versions_uniq"),
        schema="project",
    )
    op.create_index("idx_rv_resource", "resource_versions", ["resource_type", "resource_key"], schema="project")
    op.create_index("idx_rv_latest", "resource_versions", ["resource_type", "resource_key", sa.text("version DESC")], schema="project")
    op.create_index("idx_rv_hash", "resource_versions", ["content_hash"], schema="project")

    # pr_watch_state
    op.create_table(
        "pr_watch_state",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("pr_number", sa.BigInteger(), nullable=False),
        sa.Column("repo_full_name", sa.Text(), nullable=False),
        sa.Column("head_sha", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("workflow_id", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("last_checks_status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("last_review_status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("auto_resume_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("max_auto_resumes", sa.Integer(), nullable=False, server_default=sa.text("10")),
        sa.Column("github_token", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("auto_resume_enabled", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_reason", sa.Text(), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_run_id", "pr_number", name="pr_watch_state_uniq"),
        schema="project",
    )
    op.create_index(
        "idx_prw_active", "pr_watch_state", ["completed_at"],
        schema="project",
        postgresql_where=sa.text("completed_at IS NULL"),
    )
    op.create_index("idx_prw_task_run", "pr_watch_state", ["task_run_id"], schema="project")

    # learned_patterns (no CONCURRENTLY — fresh DB)
    op.create_table(
        "learned_patterns",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("problem_hash", sa.Text(), nullable=False),
        sa.Column("trigger_keywords", postgresql.JSONB(), nullable=False),
        sa.Column("problem_description", sa.Text(), nullable=False),
        sa.Column("solution_description", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("project_path", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("problem_hash"),
        schema="project",
    )
    op.create_index("idx_learned_patterns_confidence", "learned_patterns", [sa.text("confidence DESC")], schema="project")
    op.create_index("idx_learned_patterns_workflow", "learned_patterns", ["workflow_name"], schema="project")
    # Source uses CREATE INDEX CONCURRENTLY here; alembic transactions don't
    # allow CONCURRENTLY. Plain CREATE INDEX is safe on fresh DB.
    op.execute(
        "CREATE INDEX idx_learned_patterns_keywords_gin "
        "ON project.learned_patterns USING GIN(trigger_keywords)"
    )

    # ticket_task_mapping
    op.create_table(
        "ticket_task_mapping",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("ticket_source", sa.Text(), nullable=False),
        sa.Column("ticket_external_id", sa.Text(), nullable=False),
        sa.Column("ticket_url", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=False),
        sa.Column("sync_status", sa.Text(), nullable=False, server_default=sa.text("'synced'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticket_source", "ticket_external_id", name="ticket_task_mapping_uniq"),
        schema="project",
    )
    op.create_index("idx_ticket_task_mapping_task", "ticket_task_mapping", ["task_run_id"], schema="project")

    # ticket_provider_configs
    op.create_table(
        "ticket_provider_configs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_id"),
        schema="project",
    )
    op.create_index("idx_ticket_provider_configs_workflow", "ticket_provider_configs", ["workflow_id"], schema="project")

    # ui_bridge_baselines
    op.create_table(
        "ui_bridge_baselines",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("target_scope", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=True),
        sa.Column("png_bytes", postgresql.BYTEA(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("ttl_days", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ui_bridge_baselines_target", "ui_bridge_baselines", ["target_scope"], schema="project")

    # breakpoint_snapshots
    op.create_table(
        "breakpoint_snapshots",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=True),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column("variables_json", sa.Text(), nullable=False),
        sa.Column("last_screenshot_ref", sa.Text(), nullable=True),
        sa.Column("pending_steps_json", sa.Text(), nullable=False),
        sa.Column("freshness_ts", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'waiting'")),
        sa.Column("resumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_bps_execution", "breakpoint_snapshots", ["execution_id"], schema="project")
    op.create_index("idx_bps_status", "breakpoint_snapshots", ["status"], schema="project")

    # workflow_event_log
    op.create_table(
        "workflow_event_log",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("event_data", sa.Text(), nullable=True),
        sa.Column("cursor", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_event_log_execution", "workflow_event_log", ["execution_id", "cursor"], schema="project")
    op.create_index("idx_event_log_node", "workflow_event_log", ["execution_id", "node_id"], schema="project")

    # compensation_actions (JSONB)
    op.create_table(
        "compensation_actions",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("execution_id", sa.Text(), nullable=False),
        sa.Column("action_index", sa.Integer(), nullable=False),
        sa.Column("action_json", postgresql.JSONB(), nullable=False),
        sa.Column("executed", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
        sa.Column("result_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ca_execution", "compensation_actions", ["execution_id"], schema="project")
    op.create_index(
        "idx_ca_pending", "compensation_actions", ["execution_id"],
        schema="project",
        postgresql_where=sa.text("NOT executed"),
    )

    # phase_results (JSONB)
    op.create_table(
        "phase_results",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("execution_id", sa.Text(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column("stage_index", sa.Integer(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("all_passed", sa.Boolean(), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False),
        sa.Column("failure_context", sa.Text(), nullable=True),
        sa.Column("commit_hash", sa.Text(), nullable=True),
        sa.Column("step_results", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("variables_set", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_pr_execution", "phase_results", ["execution_id"], schema="project")
    op.create_index("idx_pr_execution_phase", "phase_results", ["execution_id", "phase", "iteration"], schema="project")

    # vga_state_machines (UUID PK, JSONB)
    op.create_table(
        "vga_state_machines",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target_process", sa.Text(), nullable=False),
        sa.Column("target_os", sa.Text(), nullable=False),
        sa.Column("grounding_model", sa.Text(), nullable=False, server_default=sa.text("'qontinui-grounding-v5'")),
        sa.Column("private", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("state_graph", postgresql.JSONB(), nullable=False),
        sa.Column("v5_proposed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("v5_confirmed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("v5_corrected", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("content_hash", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_vga_sm_target_process", "vga_state_machines", ["target_process"], schema="project")
    op.create_index("idx_vga_sm_grounding_model", "vga_state_machines", ["grounding_model"], schema="project")

    # vga_runs
    op.create_table(
        "vga_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "state_machine_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project.vga_state_machines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("grounding_model", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("step_log", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_vga_runs_sm", "vga_runs", ["state_machine_id"], schema="project")
    op.create_index(
        "idx_vga_runs_task", "vga_runs", ["task_run_id"],
        schema="project",
        postgresql_where=sa.text("task_run_id IS NOT NULL"),
    )

    # vga_shadow_samples (state_machine_id nullable)
    op.create_table(
        "vga_shadow_samples",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "state_machine_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project.vga_state_machines.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("image_sha", sa.Text(), nullable=False),
        sa.Column("image_path", sa.Text(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("target_process", sa.Text(), nullable=False),
        sa.Column("predicted_bbox", postgresql.JSONB(), nullable=False),
        sa.Column("model_used", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_vga_shadow_sm", "vga_shadow_samples", ["state_machine_id"], schema="project")
    op.create_index("idx_vga_shadow_target", "vga_shadow_samples", ["target_process"], schema="project")
    op.create_index("idx_vga_shadow_model", "vga_shadow_samples", ["model_used"], schema="project")

    # co_occurrence_observations (UUID PK, JSONB)
    op.create_table(
        "co_occurrence_observations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("spec_id", sa.Text(), nullable=True),
        sa.Column("runner_instance", sa.Text(), nullable=True),
        sa.Column("fingerprints", postgresql.JSONB(), nullable=False),
        sa.Column("snapshot_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_reason", sa.Text(), nullable=True),
        sa.Column("invalidated_by", sa.Text(), nullable=True),
        sa.Column("invalidation_token", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_observations_captured_at", "co_occurrence_observations", ["captured_at"],
        schema="project",
        postgresql_where=sa.text("invalidated_at IS NULL"),
    )
    op.create_index(
        "idx_observations_spec", "co_occurrence_observations", ["spec_id", "captured_at"],
        schema="project",
        postgresql_where=sa.text("invalidated_at IS NULL"),
    )
    op.execute(
        "CREATE INDEX idx_observations_fingerprints "
        "ON project.co_occurrence_observations USING gin(fingerprints)"
    )
    op.create_index(
        "idx_observations_invalidation_token", "co_occurrence_observations", ["invalidation_token"],
        schema="project",
        postgresql_where=sa.text("invalidation_token IS NOT NULL"),
    )

    # state_discovery_artifacts
    op.create_table(
        "state_discovery_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("spec_id", sa.Text(), nullable=True),
        sa.Column("derived_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("window_days", sa.Integer(), nullable=False),
        sa.Column("artifact", postgresql.JSONB(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_discovery_spec_derived", "state_discovery_artifacts", ["spec_id", sa.text("derived_at DESC")], schema="project")

    # state_discovery_drift_scores
    op.create_table(
        "state_discovery_drift_scores",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("spec_id", sa.Text(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("window_size", sa.Integer(), nullable=False),
        sa.Column("fit_score", sa.Float(), nullable=False),
        sa.Column("observations_considered", sa.Integer(), nullable=False),
        sa.Column("states_matched", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_drift_scores_spec_computed", "state_discovery_drift_scores", ["spec_id", sa.text("computed_at DESC")], schema="project")

    # chunk_labels (composite PK; placed in project per heuristic)
    op.create_table(
        "chunk_labels",
        sa.Column("config_id", sa.Text(), nullable=False),
        sa.Column("chunk_id", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("config_id", "chunk_id"),
        schema="project",
    )
    op.create_index("idx_chunk_labels_config", "chunk_labels", ["config_id"], schema="project")

    # productivity_knowledge — CROSS-SCHEMA FK to coord.tasks
    op.create_table(
        "productivity_knowledge",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("area", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_pk_area", "productivity_knowledge", ["area"], schema="project")
    op.create_index(
        "idx_pk_task", "productivity_knowledge", ["task_id"],
        schema="project",
        postgresql_where=sa.text("task_id IS NOT NULL"),
    )
    op.create_index(
        "idx_pk_session", "productivity_knowledge", ["session_id"],
        schema="project",
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )
    op.create_index("idx_pk_created", "productivity_knowledge", [sa.text("created_at DESC")], schema="project")
    op.execute(
        "CREATE INDEX idx_pk_fts ON project.productivity_knowledge "
        "USING GIN (to_tsvector('english', area || ' ' || summary || ' ' || body))"
    )

    # ============================================================
    # ALTER TABLEs from later in source — cross-batch column adds
    # ============================================================

    # Phase 1A: model_used on learning_outcomes (created in batch 5)
    op.add_column(
        "learning_outcomes",
        sa.Column("model_used", sa.Text(), nullable=True),
        schema="project",
    )

    # Dreamer columns on memory_consolidation_log (created in batch 8)
    op.add_column(
        "memory_consolidation_log",
        sa.Column("is_dreamer", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="project",
    )
    op.add_column(
        "memory_consolidation_log",
        sa.Column("inductive_traces", sa.Integer(), nullable=False, server_default=sa.text("0")),
        schema="project",
    )
    op.add_column(
        "memory_consolidation_log",
        sa.Column("deductive_traces", sa.Integer(), nullable=False, server_default=sa.text("0")),
        schema="project",
    )
    op.add_column(
        "memory_consolidation_log",
        sa.Column("abductive_traces", sa.Integer(), nullable=False, server_default=sa.text("0")),
        schema="project",
    )


def downgrade() -> None:
    # Reverse ALTERs first
    op.drop_column("memory_consolidation_log", "abductive_traces", schema="project")
    op.drop_column("memory_consolidation_log", "deductive_traces", schema="project")
    op.drop_column("memory_consolidation_log", "inductive_traces", schema="project")
    op.drop_column("memory_consolidation_log", "is_dreamer", schema="project")
    op.drop_column("learning_outcomes", "model_used", schema="project")

    # Drop project tables (reverse FK order)
    op.execute("DROP INDEX IF EXISTS project.idx_pk_fts")
    op.drop_table("productivity_knowledge", schema="project")
    op.drop_table("chunk_labels", schema="project")
    op.drop_table("state_discovery_drift_scores", schema="project")
    op.drop_table("state_discovery_artifacts", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_observations_fingerprints")
    op.drop_table("co_occurrence_observations", schema="project")
    op.drop_table("vga_shadow_samples", schema="project")
    op.drop_table("vga_runs", schema="project")
    op.drop_table("vga_state_machines", schema="project")
    op.drop_table("phase_results", schema="project")
    op.drop_table("compensation_actions", schema="project")
    op.drop_table("workflow_event_log", schema="project")
    op.drop_table("breakpoint_snapshots", schema="project")
    op.drop_table("ui_bridge_baselines", schema="project")
    op.drop_table("ticket_provider_configs", schema="project")
    op.drop_table("ticket_task_mapping", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_learned_patterns_keywords_gin")
    op.drop_table("learned_patterns", schema="project")
    op.drop_table("pr_watch_state", schema="project")
    op.drop_table("resource_versions", schema="project")
    op.drop_table("beam_candidates", schema="project")
    op.drop_table("beam_search_runs", schema="project")
    op.drop_table("duel_results", schema="project")
    op.drop_table("duel_candidates", schema="project")
    op.drop_table("duel_pools", schema="project")
    op.drop_table("span_events", schema="project")
    op.drop_table("working_representations", schema="project")
    op.drop_table("reasoning_traces", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_ep_fts")
    op.drop_table("entity_profiles", schema="project")
    op.drop_table("contradiction_resolutions", schema="project")
    op.drop_table("restate_awakeables", schema="project")
    op.drop_table("restate_workflow_executions", schema="project")
    op.drop_table("phase_model_routing", schema="project")
    op.drop_table("security_audit_events", schema="project")
    op.drop_table("strategy_bank", schema="project")
    op.drop_table("step_credit_assignments", schema="project")
    op.drop_table("experience_summaries", schema="project")
    op.drop_table("model_routing_decisions", schema="project")
    op.drop_table("model_routing_overrides", schema="project")
    op.drop_table("model_routing_table", schema="project")
    op.drop_table("drift_detector_state", schema="project")
    op.drop_table("performance_drift_signals", schema="project")
    op.drop_table("iteration_logs", schema="project")
    op.drop_table("exploration_stats", schema="project")
    op.drop_table("step_templates", schema="project")
    op.drop_table("gepa_optimization_runs", schema="project")
    op.drop_table("template_lifecycle_events", schema="project")
    op.drop_table("template_performance", schema="project")
    op.drop_table("curated_examples", schema="project")
    op.drop_table("playbook_entries", schema="project")
    op.drop_table("prm_training_exports", schema="project")
    op.drop_table("wsv_shadow_disagreements", schema="project")
    op.drop_table("entailment_cache", schema="project")
    op.drop_table("spec_versions", schema="project")
    op.drop_table("workflow_variables", schema="project")
    op.drop_table("workflow_triggers", schema="project")
    op.drop_table("scheduler_history", schema="project")
    op.drop_table("trigger_history", schema="project")
    op.drop_table("task_run_output_chunks", schema="project")
    op.drop_table("task_run_mcp_calls", schema="project")
    op.drop_table("task_run_automation", schema="project")

    # Drop agent table
    op.drop_table("memory_query_cache", schema="agent")

    # Drop coord tables (reverse FK order)
    op.drop_table("reviews", schema="coord")
    op.drop_table("session_file_snapshots", schema="coord")
    op.drop_table("coordinator_leader", schema="coord")
    op.drop_table("coordinator_decisions", schema="coord")
    op.drop_table("tasks", schema="coord")
    op.drop_table("plans", schema="coord")
