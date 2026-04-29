"""consolidation phase1 18 architecture / components

Revision ID: consolidation_phase1_18_architecture_components
Revises: consolidation_phase1_17_issues_discovery_knowledge
Create Date: 2026-04-29

Phase 1, batch 18: architecture/component health, spec results, artifacts,
robustness, model profiles, check/shell results — all in ``project``.

Source: ``schema.pg.sql:2584-2763``.

DRIFT FLAGS (preserved):
- ``architecture_components`` has ``UNIQUE(workflow_name, component_path)``.
- ``component_relationships`` has ``UNIQUE(workflow_name, source_component, target_component, relationship_type)``.
- ``artifacts.passed`` is ``INTEGER`` not ``BOOLEAN`` in source.
- ``model_profiles.last_updated`` is ``TEXT`` not ``TIMESTAMPTZ`` in source.
- ``model_profiles.model_id`` is ``UNIQUE``.
- ``spec_compliance_results.task_run_id`` has no FK in source.
- ``robustness_reports.prompt_variant_id`` has no FK in source.

Note: ``agentic_metric_baselines`` is at line 2635 in source but was
pulled into batch 9 for logical grouping with the ``agentic_metric_*``
family. Skipped here to avoid duplication.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_18_architecture_components"
down_revision: str = "consolidation_phase1_17_issues_discovery_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "architecture_components",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("component_path", sa.Text(), nullable=False),
        sa.Column("component_type", sa.Text(), nullable=False, server_default=sa.text("'file'")),
        sa.Column("fix_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("causal_involvement_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("effective_fix_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("ineffective_fix_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("health_score", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("change_velocity", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_name", "component_path", name="architecture_components_uniq"),
        schema="project",
    )
    op.create_index("idx_arch_comp_workflow", "architecture_components", ["workflow_name"], schema="project")
    op.create_index("idx_arch_comp_health", "architecture_components", ["health_score"], schema="project")

    op.create_table(
        "component_relationships",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("source_component", sa.Text(), nullable=False),
        sa.Column("target_component", sa.Text(), nullable=False),
        sa.Column("relationship_type", sa.Text(), nullable=False),
        sa.Column("strength", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_name", "source_component", "target_component", "relationship_type", name="component_relationships_uniq"),
        schema="project",
    )
    op.create_index("idx_comp_rel_workflow", "component_relationships", ["workflow_name"], schema="project")
    op.create_index("idx_comp_rel_source", "component_relationships", ["source_component"], schema="project")

    op.create_table(
        "component_health_snapshots",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("component_path", sa.Text(), nullable=False),
        sa.Column("health_score", sa.Float(), nullable=False),
        sa.Column("fix_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("effective_fix_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("change_velocity", sa.Float(), nullable=False, server_default=sa.text("0.0")),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_comp_health_snap_wf", "component_health_snapshots", ["workflow_name"], schema="project")
    op.create_index("idx_comp_health_snap_comp", "component_health_snapshots", ["workflow_name", "component_path"], schema="project")
    op.create_index("idx_comp_health_snap_at", "component_health_snapshots", ["snapshot_at"], schema="project")

    op.create_table(
        "spec_compliance_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("spec_id", sa.Text(), nullable=True),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("overall_score", sa.Float(), nullable=False),
        sa.Column("raw_pass_rate", sa.Float(), nullable=False),
        sa.Column("critical_passed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("critical_total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("warning_passed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("warning_total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("info_passed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("info_total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("assertions_passed", sa.Integer(), nullable=False),
        sa.Column("assertions_total", sa.Integer(), nullable=False),
        sa.Column("group_scores_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("assertion_details_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_spec_compliance_task", "spec_compliance_results", ["task_run_id"], schema="project")
    op.create_index("idx_spec_compliance_score", "spec_compliance_results", ["overall_score"], schema="project")
    op.create_index("idx_spec_compliance_spec", "spec_compliance_results", ["spec_id"], schema="project")

    op.create_table(
        "spec_accuracy_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("spec_id", sa.Text(), nullable=False),
        sa.Column("analysis_type", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("detail_json", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_spec_accuracy_spec", "spec_accuracy_results", ["spec_id"], schema="project")
    op.create_index("idx_spec_accuracy_type", "spec_accuracy_results", ["analysis_type"], schema="project")

    op.create_table(
        "artifacts",
        sa.Column("artifact_id", sa.Text(), nullable=False),
        sa.Column("source_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("environment_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("passed", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("artifact_id"),
        schema="project",
    )
    op.create_index("idx_artifacts_created_at", "artifacts", ["created_at"], schema="project")
    op.create_index("idx_artifacts_passed", "artifacts", ["passed"], schema="project")

    op.create_table(
        "robustness_reports",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("prompt_variant_id", sa.Text(), nullable=True),
        sa.Column("recommendation_id", sa.Text(), nullable=True),
        sa.Column("total_tests", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("report_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_robustness_variant", "robustness_reports", ["prompt_variant_id"], schema="project")

    op.create_table(
        "model_profiles",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("model_id", sa.Text(), nullable=False),
        sa.Column("profile_json", sa.Text(), nullable=False),
        sa.Column("trial_count", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("last_updated", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("model_id"),
        schema="project",
    )
    op.create_index("idx_model_profiles_model", "model_profiles", ["model_id"], schema="project")

    op.create_table(
        "check_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "check_id",
            sa.Text(),
            sa.ForeignKey("project.checks.id", ondelete="CASCADE"),
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
        sa.Column("issues_found", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("issues_fixed", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("files_checked", sa.BigInteger(), nullable=True, server_default=sa.text("0")),
        sa.Column("structured_output", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_check_results_check_id", "check_results", ["check_id"], schema="project")
    op.create_index("idx_check_results_task_run_id", "check_results", ["task_run_id"], schema="project")
    op.create_index("idx_check_results_status", "check_results", ["status"], schema="project")
    op.create_index("idx_check_results_created_at", "check_results", ["created_at"], schema="project")

    op.create_table(
        "shell_command_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "shell_command_id",
            sa.Text(),
            sa.ForeignKey("project.shell_commands.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("stdout", sa.Text(), nullable=True),
        sa.Column("stderr", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_shell_command_results_shell_command_id", "shell_command_results", ["shell_command_id"], schema="project")
    op.create_index("idx_shell_command_results_task_run_id", "shell_command_results", ["task_run_id"], schema="project")
    op.create_index("idx_shell_command_results_status", "shell_command_results", ["status"], schema="project")
    op.create_index("idx_shell_command_results_created_at", "shell_command_results", ["created_at"], schema="project")


def downgrade() -> None:
    op.drop_table("shell_command_results", schema="project")
    op.drop_table("check_results", schema="project")
    op.drop_table("model_profiles", schema="project")
    op.drop_table("robustness_reports", schema="project")
    op.drop_table("artifacts", schema="project")
    op.drop_table("spec_accuracy_results", schema="project")
    op.drop_table("spec_compliance_results", schema="project")
    op.drop_table("component_health_snapshots", schema="project")
    op.drop_table("component_relationships", schema="project")
    op.drop_table("architecture_components", schema="project")
