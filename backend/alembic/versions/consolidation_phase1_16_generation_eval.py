"""consolidation phase1 16 generation rules + eval

Revision ID: consolidation_phase1_16_generation_eval
Revises: consolidation_phase1_15_state_machine
Create Date: 2026-04-29

Phase 1, batch 16: generation rules, pipeline artifacts, golden
datasets, eval specs/results, agent traces, meta-optimizer runs/
snapshots, reflection fixes, fix applications, workflow generation
feedback. All in ``project``.

Source: ``schema.pg.sql:2117-2383``.

DRIFT FLAGS (preserved):
- ``generation_pipeline_artifacts.workflow_id/task_run_id`` — no FKs.
- ``eval_results.spec_id`` — no FK to ``eval_specs(id)`` declared.
- ``pipeline_agent_traces.task_run_id`` — no FK declared.
- ``meta_optimizer_runs.task_run_id`` — no FK declared.
- ``reflection_fixes`` HAS multiple FKs (source/reflection task_runs
  CASCADE, source_finding_id SET NULL, source_knowledge_id SET NULL).
- ``fix_applications`` HAS FKs (fix_id, task_run_id) both CASCADE.
- ``workflow_generation_feedback`` HAS FKs (workflow_id CASCADE,
  task_run_id SET NULL).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_16_generation_eval"
down_revision: str = "consolidation_phase1_15_state_machine"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "generation_rules",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent", sa.Text(), nullable=False),
        sa.Column("section", sa.Text(), nullable=False),
        sa.Column("rule_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("condition", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("provenance", sa.Text(), nullable=False, server_default=sa.text("'seed'")),
        sa.Column("source_fix_id", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True, server_default=sa.text("1.0")),
        sa.Column("auto_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("severity", sa.Text(), nullable=False, server_default=sa.text("'normal'")),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("examples_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_generation_rules_agent", "generation_rules", ["agent"], schema="project")
    op.create_index("idx_generation_rules_status", "generation_rules", ["status"], schema="project")
    op.create_index("idx_generation_rules_agent_section", "generation_rules", ["agent", "section", "rule_number"], schema="project")
    op.create_index("idx_generation_rules_severity", "generation_rules", ["severity"], schema="project")

    op.create_table(
        "generation_pipeline_artifacts",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("investigation_duration_ms", sa.Integer(), nullable=True),
        sa.Column("investigation_enriched_description", sa.Text(), nullable=True),
        sa.Column("discovery_duration_ms", sa.Integer(), nullable=True),
        sa.Column("builder_duration_ms", sa.Integer(), nullable=True),
        sa.Column("autofix_duration_ms", sa.Integer(), nullable=True),
        sa.Column("verification_duration_ms", sa.Integer(), nullable=True),
        sa.Column("hardener_duration_ms", sa.Integer(), nullable=True),
        sa.Column("total_duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("discovery_calls", sa.Text(), nullable=True),
        sa.Column("builder_raw_output", sa.Text(), nullable=True),
        sa.Column("builder_parsed_json", sa.Text(), nullable=True),
        sa.Column("autofix_diff", sa.Text(), nullable=True),
        sa.Column("verification_iterations", sa.Text(), nullable=True),
        sa.Column("fixer_snapshots", sa.Text(), nullable=True),
        sa.Column("hardening_summary", sa.Text(), nullable=True),
        sa.Column("hardened_json", sa.Text(), nullable=True),
        sa.Column("final_json", sa.Text(), nullable=True),
        sa.Column("validation_errors", sa.Text(), nullable=True),
        sa.Column("specification_duration_ms", sa.Integer(), nullable=True),
        sa.Column("specification_criteria", sa.Text(), nullable=True),
        sa.Column("specification_prompt", sa.Text(), nullable=True),
        sa.Column("builder_prompt", sa.Text(), nullable=True),
        sa.Column("verification_prompts", sa.Text(), nullable=True),
        sa.Column("hardener_prompt", sa.Text(), nullable=True),
        sa.Column("revision_duration_ms", sa.Integer(), nullable=True),
        sa.Column("quality_report", sa.Text(), nullable=True),
        sa.Column("revision_cycles", sa.Integer(), nullable=True),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("model_used", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_pipeline_artifacts_workflow", "generation_pipeline_artifacts", ["workflow_id"], schema="project")
    op.create_index("idx_pipeline_artifacts_created", "generation_pipeline_artifacts", ["created_at"], schema="project")

    op.create_table(
        "golden_datasets",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("entries_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("entry_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_golden_agent", "golden_datasets", ["agent_type"], schema="project")

    op.create_table(
        "eval_specs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target_agent", sa.Text(), nullable=True),
        sa.Column("spec_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )

    op.create_table(
        "eval_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("spec_id", sa.Text(), nullable=False),
        sa.Column("recommendation_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("result_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("p_value", sa.Float(), nullable=True),
        sa.Column("trials_run", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_eval_results_spec", "eval_results", ["spec_id"], schema="project")
    op.create_index("idx_eval_results_rec", "eval_results", ["recommendation_id"], schema="project")

    op.create_table(
        "pipeline_agent_traces",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("input_snapshot", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("output_snapshot", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("config_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("tokens_in", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("tokens_out", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("downstream_success", sa.Boolean(), nullable=True),
        sa.Column("output_quality_score", sa.Float(), nullable=True),
        sa.Column("parent_span_id", sa.Text(), nullable=True),
        sa.Column("span_type", sa.Text(), nullable=True, server_default=sa.text("'agent'")),
        sa.Column("guardrail_results_json", sa.Text(), nullable=True),
        sa.Column("handoff_context_json", sa.Text(), nullable=True),
        sa.Column("schema_valid_first_attempt", sa.Boolean(), nullable=True),
        sa.Column("validation_retries", sa.Integer(), nullable=True),
        sa.Column("validation_error_summary", sa.Text(), nullable=True),
        sa.Column("coercions_applied", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_pipeline_agent_traces_task_run", "pipeline_agent_traces", ["task_run_id"], schema="project")
    op.create_index("idx_pipeline_agent_traces_agent_type", "pipeline_agent_traces", ["agent_type"], schema="project")
    op.create_index("idx_pipeline_agent_traces_run_id", "pipeline_agent_traces", ["run_id"], schema="project")
    op.create_index("idx_pipeline_traces_parent_span", "pipeline_agent_traces", ["parent_span_id"], schema="project")
    op.create_index("idx_pipeline_traces_span_type", "pipeline_agent_traces", ["span_type"], schema="project")

    op.create_table(
        "meta_optimizer_runs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("optimizer_type", sa.Text(), nullable=False),
        sa.Column("trigger_type", sa.Text(), nullable=False, server_default=sa.text("'threshold'")),
        sa.Column("runs_analyzed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("recommendations_produced", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_meta_optimizer_runs_type", "meta_optimizer_runs", ["optimizer_type"], schema="project")

    op.create_table(
        "meta_optimizer_snapshots",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("snapshot_type", sa.Text(), nullable=False),
        sa.Column("period_start", sa.Text(), nullable=False),
        sa.Column("period_end", sa.Text(), nullable=False),
        sa.Column("metrics_json", sa.Text(), nullable=False),
        sa.Column("breakdown_json", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("recommendation_id", sa.Text(), nullable=True),
        sa.Column("runs_included", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_meta_optimizer_snapshots_type", "meta_optimizer_snapshots", ["snapshot_type"], schema="project")
    op.create_index("idx_meta_optimizer_snapshots_rec", "meta_optimizer_snapshots", ["recommendation_id"], schema="project")

    # reflection_fixes — has 4 FKs declared in source
    op.create_table(
        "reflection_fixes",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "source_task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reflection_task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_finding_id",
            sa.Text(),
            sa.ForeignKey("project.task_run_findings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_knowledge_id",
            sa.Text(),
            sa.ForeignKey("project.task_knowledge.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("fix_type", sa.Text(), nullable=False),
        sa.Column("fix_description", sa.Text(), nullable=False),
        sa.Column("file_changed", sa.Text(), nullable=True),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Text(), nullable=False, server_default=sa.text("'medium'")),
        sa.Column("content_hash", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'applied'")),
        sa.Column("effectiveness", sa.Text(), nullable=True),
        sa.Column("effectiveness_evidence", sa.Text(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("source_agent", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("alternatives_considered", sa.Text(), nullable=True),
        sa.Column("reflection_scope", sa.Text(), nullable=True, server_default=sa.text("'workflow'")),
        sa.Column("project_path", sa.Text(), nullable=True),
        sa.Column("target_component", sa.Text(), nullable=True),
        sa.Column("reuse_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("applicability_context", sa.Text(), nullable=True),
        sa.Column("fix_description_embedding", postgresql.BYTEA(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_reflection_fixes_source", "reflection_fixes", ["source_task_run_id"], schema="project")
    op.create_index("idx_reflection_fixes_reflection", "reflection_fixes", ["reflection_task_run_id"], schema="project")
    op.create_index("idx_reflection_fixes_content_hash", "reflection_fixes", ["content_hash"], schema="project")
    op.create_index("idx_reflection_fixes_status", "reflection_fixes", ["status"], schema="project")
    op.create_index("idx_reflection_fixes_effectiveness", "reflection_fixes", ["effectiveness"], schema="project")
    op.create_index("idx_reflection_fixes_applied_at", "reflection_fixes", ["applied_at"], schema="project")
    op.create_index("idx_reflection_fixes_source_agent", "reflection_fixes", ["source_agent"], schema="project")
    op.create_index("idx_reflection_fixes_project", "reflection_fixes", ["project_path"], schema="project")
    op.create_index("idx_reflection_fixes_scope", "reflection_fixes", ["reflection_scope"], schema="project")

    op.create_table(
        "fix_applications",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "fix_id",
            sa.Text(),
            sa.ForeignKey("project.reflection_fixes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("error_signature_hash", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True, server_default=sa.text("'pending'")),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_fix_applications_fix", "fix_applications", ["fix_id"], schema="project")
    op.create_index("idx_fix_applications_task", "fix_applications", ["task_run_id"], schema="project")
    op.create_index("idx_fix_applications_sig", "fix_applications", ["error_signature_hash"], schema="project")

    op.create_table(
        "workflow_generation_feedback",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "workflow_id",
            sa.Text(),
            sa.ForeignKey("project.unified_workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("feedback_type", sa.Text(), nullable=False),
        sa.Column("edited_field", sa.Text(), nullable=True),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("delete_reason", sa.Text(), nullable=True),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("rating_comment", sa.Text(), nullable=True),
        sa.Column("workflow_category", sa.Text(), nullable=True),
        sa.Column("workflow_description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_wgf_workflow_id", "workflow_generation_feedback", ["workflow_id"], schema="project")
    op.create_index("idx_wgf_task_run_id", "workflow_generation_feedback", ["task_run_id"], schema="project")
    op.create_index("idx_wgf_feedback_type", "workflow_generation_feedback", ["feedback_type"], schema="project")
    op.create_index("idx_wgf_created_at", "workflow_generation_feedback", ["created_at"], schema="project")


def downgrade() -> None:
    op.drop_table("workflow_generation_feedback", schema="project")
    op.drop_table("fix_applications", schema="project")
    op.drop_table("reflection_fixes", schema="project")
    op.drop_table("meta_optimizer_snapshots", schema="project")
    op.drop_table("meta_optimizer_runs", schema="project")
    op.drop_table("pipeline_agent_traces", schema="project")
    op.drop_table("eval_results", schema="project")
    op.drop_table("eval_specs", schema="project")
    op.drop_table("golden_datasets", schema="project")
    op.drop_table("generation_pipeline_artifacts", schema="project")
    op.drop_table("generation_rules", schema="project")
