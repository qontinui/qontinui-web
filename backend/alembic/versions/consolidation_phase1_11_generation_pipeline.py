"""consolidation phase1 11 generation pipeline

Revision ID: consolidation_phase1_11_generation_pipeline
Revises: consolidation_phase1_10_findings_knowledge
Create Date: 2026-04-29

Phase 1, batch 11: workflow generation pipeline tables in ``project``.

- ``project.generation_pipeline_events`` — per-phase generation events.
- ``project.rule_influence_log`` — which generation rules ran when.
- ``project.cross_run_patterns`` — recurring findings / fix oscillations.
- ``project.prompt_evolution`` — meta-prompt optimizer history.
- ``project.workflow_verification_phase_results`` — verification phase
  results.
- ``project.workflow_ai_sessions`` — Claude CLI session tracking.

Source: ``schema.pg.sql:1340-1454``.

Notable details:
- ``workflow_ai_sessions`` has a UNIQUE EXPRESSION index on
  ``(task_run_id, iteration, phase, COALESCE(stage_index, -1))``
  — alembic doesn't support COALESCE in op.create_index, so emit raw
  SQL via op.execute.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_11_generation_pipeline"
down_revision: str = "consolidation_phase1_10_findings_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # generation_pipeline_events
    op.create_table(
        "generation_pipeline_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workflow_id",
            sa.Text(),
            sa.ForeignKey("project.unified_workflows.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("token_count", sa.BigInteger(), nullable=True),
        sa.Column("validation_errors_before", sa.Integer(), nullable=True),
        sa.Column("validation_errors_after", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_gpe_task_run", "generation_pipeline_events", ["task_run_id"], schema="project")
    op.create_index("idx_gpe_type", "generation_pipeline_events", ["event_type"], schema="project")
    op.create_index("idx_gpe_phase", "generation_pipeline_events", ["phase"], schema="project")

    # rule_influence_log
    op.create_table(
        "rule_influence_log",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("rule_id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workflow_id",
            sa.Text(),
            sa.ForeignKey("project.unified_workflows.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("influence_type", sa.Text(), nullable=False, server_default=sa.text("'loaded'")),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ril_rule", "rule_influence_log", ["rule_id"], schema="project")
    op.create_index("idx_ril_task_run", "rule_influence_log", ["task_run_id"], schema="project")
    op.create_index("idx_ril_influence", "rule_influence_log", ["influence_type"], schema="project")

    # cross_run_patterns
    op.create_table(
        "cross_run_patterns",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("pattern_type", sa.Text(), nullable=False),
        sa.Column("signature_hash", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("first_seen_task_run_id", sa.Text(), nullable=True),
        sa.Column("last_seen_task_run_id", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("affected_components", sa.Text(), nullable=True),
        sa.Column("pattern_data", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("resolved_by_fix_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pattern_type", "signature_hash", name="cross_run_patterns_unique"),
        schema="project",
    )
    op.create_index("idx_crp_type", "cross_run_patterns", ["pattern_type"], schema="project")
    op.create_index("idx_crp_workflow", "cross_run_patterns", ["workflow_name"], schema="project")
    op.create_index("idx_crp_status", "cross_run_patterns", ["status"], schema="project")
    op.create_index("idx_crp_signature", "cross_run_patterns", ["signature_hash"], schema="project")

    # prompt_evolution
    op.create_table(
        "prompt_evolution",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False),
        sa.Column("parent_variant_id", sa.Text(), nullable=True),
        sa.Column("variant_id", sa.Text(), nullable=False),
        sa.Column("recommendation_id", sa.Text(), nullable=True),
        sa.Column("critique", sa.Text(), nullable=True),
        sa.Column("changes_summary", sa.Text(), nullable=True),
        sa.Column("canary_verdict", sa.Text(), nullable=True),
        sa.Column("score_before", sa.Float(), nullable=True),
        sa.Column("score_after", sa.Float(), nullable=True),
        sa.Column("baseline_prompt_hash", sa.Text(), nullable=True),
        sa.Column("consecutive_rejections", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("beam_run_id", sa.Text(), nullable=True),
        sa.Column("generation", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_pe_agent", "prompt_evolution", ["agent_type"], schema="project")
    op.create_index("idx_pe_verdict", "prompt_evolution", ["agent_type", "canary_verdict"], schema="project")
    op.create_index("idx_pe_variant", "prompt_evolution", ["variant_id"], schema="project")

    # workflow_verification_phase_results (FK→task_runs CASCADE)
    op.create_table(
        "workflow_verification_phase_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("all_passed", sa.Boolean(), nullable=False),
        sa.Column("total_steps", sa.Integer(), nullable=False),
        sa.Column("passed_steps", sa.Integer(), nullable=False),
        sa.Column("failed_steps", sa.Integer(), nullable=False),
        sa.Column("skipped_steps", sa.Integer(), nullable=False),
        sa.Column("total_duration_ms", sa.BigInteger(), nullable=False),
        sa.Column("critical_failure", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_wf_ver_phase_task_run", "workflow_verification_phase_results", ["task_run_id"], schema="project")
    op.create_index(
        "idx_wf_ver_phase_unique", "workflow_verification_phase_results",
        ["task_run_id", "iteration"],
        unique=True,
        schema="project",
    )

    # workflow_ai_sessions (FK→task_runs CASCADE; UNIQUE expression with COALESCE)
    op.create_table(
        "workflow_ai_sessions",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("stage_index", sa.Integer(), nullable=True),
        sa.Column("claude_cli_session_id", sa.Text(), nullable=True),
        sa.Column("session_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("session_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("output_length", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_wf_ai_sessions_task_run", "workflow_ai_sessions", ["task_run_id"], schema="project")
    op.execute(
        "CREATE UNIQUE INDEX idx_wf_ai_sessions_unique ON project.workflow_ai_sessions"
        "(task_run_id, iteration, phase, COALESCE(stage_index, -1))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS project.idx_wf_ai_sessions_unique")
    op.drop_table("workflow_ai_sessions", schema="project")
    op.drop_table("workflow_verification_phase_results", schema="project")
    op.drop_table("prompt_evolution", schema="project")
    op.drop_table("cross_run_patterns", schema="project")
    op.drop_table("rule_influence_log", schema="project")
    op.drop_table("generation_pipeline_events", schema="project")
