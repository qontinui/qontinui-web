"""consolidation phase1 19 tests / verification / comparison

Revision ID: consolidation_phase1_19_tests_verification_comparison
Revises: consolidation_phase1_18_architecture_components
Create Date: 2026-04-29

Phase 1, batch 19: test associations/results, verification plans,
orchestrator verification results, orchestration loop configs,
comparison runs — all in ``project``.

Source: ``schema.pg.sql:2766-2877``.

DRIFT FLAGS (preserved):
- ``comparison_runs.workflow_id`` has no FK declared.
- ``verification_plans.previous_version_id`` is a SELF-FK SET NULL.

FK chain:
- test_associations FK→verification_tests CASCADE, FK→configs CASCADE.
- test_results FK→verification_tests CASCADE, FK→task_runs CASCADE.
- verification_plans FK→task_runs CASCADE, self-FK SET NULL.
- orchestrator_verification_results FK→task_runs CASCADE,
  FK→verification_plans CASCADE.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_19_tests_verification_comparison"
down_revision: str = "consolidation_phase1_18_architecture_components"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "test_associations",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "test_id",
            sa.Text(),
            sa.ForeignKey("project.verification_tests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "config_id",
            sa.Text(),
            sa.ForeignKey("project.configs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("trigger_point", sa.Text(), nullable=False),
        sa.Column("action_id", sa.Text(), nullable=True),
        sa.Column("execution_order", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_test_associations_test_id", "test_associations", ["test_id"], schema="project")
    op.create_index("idx_test_associations_config_id", "test_associations", ["config_id"], schema="project")

    op.create_table(
        "test_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "test_id",
            sa.Text(),
            sa.ForeignKey("project.verification_tests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("structured_output", sa.Text(), nullable=True),
        sa.Column("assertions_passed", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("assertions_failed", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("screenshots", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("visual_evidence", sa.Text(), nullable=True),
        sa.Column("ai_analysis", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_test_results_test_id", "test_results", ["test_id"], schema="project")
    op.create_index("idx_test_results_task_run_id", "test_results", ["task_run_id"], schema="project")
    op.create_index("idx_test_results_status", "test_results", ["status"], schema="project")

    op.create_table(
        "verification_plans",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("plan_json", sa.Text(), nullable=False),
        sa.Column("goal_summary", sa.Text(), nullable=False),
        sa.Column("criteria_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("has_ai_criteria", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("replan_reason", sa.Text(), nullable=True),
        sa.Column(
            "previous_version_id",
            sa.Text(),
            sa.ForeignKey(
                "project.verification_plans.id",
                ondelete="SET NULL",
                name="verification_plans_previous_version_fkey",
            ),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_verification_plans_task_run_id", "verification_plans", ["task_run_id"], schema="project")
    op.create_index("idx_verification_plans_version", "verification_plans", ["version"], schema="project")
    op.create_index("idx_verification_plans_created_at", "verification_plans", ["created_at"], schema="project")

    op.create_table(
        "orchestrator_verification_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "plan_id",
            sa.Text(),
            sa.ForeignKey("project.verification_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("criterion_id", sa.Text(), nullable=False),
        sa.Column("criterion_type", sa.Text(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("is_critical", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("confidence", sa.Text(), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("issues", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("suggestions", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("raw_output", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_orch_ver_results_task_run_id", "orchestrator_verification_results", ["task_run_id"], schema="project")
    op.create_index("idx_orch_ver_results_plan_id", "orchestrator_verification_results", ["plan_id"], schema="project")
    op.create_index("idx_orch_ver_results_iteration", "orchestrator_verification_results", ["iteration"], schema="project")
    op.create_index("idx_orch_ver_results_passed", "orchestrator_verification_results", ["passed"], schema="project")
    op.create_index("idx_orch_ver_results_criterion_id", "orchestrator_verification_results", ["criterion_id"], schema="project")

    op.create_table(
        "orchestration_loop_configs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_favorite", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ol_configs_favorite", "orchestration_loop_configs", ["is_favorite"], schema="project")
    op.create_index("idx_ol_configs_updated", "orchestration_loop_configs", ["updated_at"], schema="project")

    op.create_table(
        "comparison_runs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=False),
        sa.Column("variation_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("entries_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("report", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_comparison_runs_workflow", "comparison_runs", ["workflow_id"], schema="project")
    op.create_index("idx_comparison_runs_status", "comparison_runs", ["status"], schema="project")


def downgrade() -> None:
    op.drop_table("comparison_runs", schema="project")
    op.drop_table("orchestration_loop_configs", schema="project")
    op.drop_table("orchestrator_verification_results", schema="project")
    op.drop_table("verification_plans", schema="project")
    op.drop_table("test_results", schema="project")
    op.drop_table("test_associations", schema="project")
