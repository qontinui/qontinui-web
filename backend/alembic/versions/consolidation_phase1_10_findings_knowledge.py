"""consolidation phase1 10 findings / knowledge

Revision ID: consolidation_phase1_10_findings_knowledge
Revises: consolidation_phase1_09_activity_watchers_metrics
Create Date: 2026-04-29

Phase 1, batch 10: findings, task knowledge, and workflow-evolution
infrastructure in ``project``.

- ``project.task_run_findings`` — detected issues per task run
  (FK→task_runs CASCADE; BYTEA embeddings).
- ``project.task_knowledge`` — knowledge acquisition flywheel.
- ``project.workflow_versions`` — workflow version history (FK→
  unified_workflows CASCADE; self-FK; FK→task_runs SET NULL).
- ``project.step_finding_links`` — finding↔step attribution.
- ``project.step_provenance`` — per-step generating-agent tracking.

Source: ``schema.pg.sql:1223-1338``.

DRIFT FLAG: ``task_knowledge.task_run_id`` is ``TEXT NOT NULL`` with
no FK declared in source. Preserved.
DRIFT FLAG: ``task_run_findings.reflection_fix_id`` and
``step_finding_links.finding_id`` are referenced as soft FKs in the
source comments but have no actual constraint. Preserved.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_10_findings_knowledge"
down_revision: str = "consolidation_phase1_09_activity_watchers_metrics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # task_run_findings (FK → task_runs CASCADE)
    op.create_table(
        "task_run_findings",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("signature_hash", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("line_number", sa.Integer(), nullable=True),
        sa.Column("column_number", sa.Integer(), nullable=True),
        sa.Column("code_snippet", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'detected'")),
        sa.Column("action_type", sa.Text(), nullable=False, server_default=sa.text("'auto_fix'")),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("detected_in_session", sa.Integer(), nullable=False),
        sa.Column("resolved_in_session", sa.Integer(), nullable=True),
        sa.Column("needs_input", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("question", sa.Text(), nullable=True),
        sa.Column("input_options", sa.Text(), nullable=True),
        sa.Column("user_response", sa.Text(), nullable=True),
        sa.Column("title_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("description_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("reflection_fix_id", sa.Text(), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_findings_task_run", "task_run_findings", ["task_run_id"], schema="project")
    op.create_index("idx_findings_status", "task_run_findings", ["status"], schema="project")
    op.create_index("idx_findings_signature", "task_run_findings", ["signature_hash"], schema="project")
    op.create_index("idx_findings_category", "task_run_findings", ["category"], schema="project")

    # task_knowledge (no FK on task_run_id in source)
    op.create_table(
        "task_knowledge",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("agent_type", sa.Text(), nullable=False, server_default=sa.text("'system'")),
        sa.Column("iteration", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Text(), nullable=False, server_default=sa.text("'medium'")),
        sa.Column("related_files", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("related_criterion_id", sa.Text(), nullable=True),
        sa.Column("is_resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("summary_entry_id", sa.Text(), nullable=True),
        sa.Column("content_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("project_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_tk_task_run", "task_knowledge", ["task_run_id"], schema="project")
    op.create_index("idx_tk_category", "task_knowledge", ["category"], schema="project")
    op.create_index(
        "idx_tk_resolved", "task_knowledge", ["is_resolved"],
        schema="project",
        postgresql_where=sa.text("NOT is_resolved"),
    )
    op.create_index("idx_tk_created", "task_knowledge", [sa.text("created_at DESC")], schema="project")
    op.create_index(
        "idx_tk_project_path", "task_knowledge", ["project_path"],
        schema="project",
        postgresql_where=sa.text("project_path IS NOT NULL"),
    )
    op.create_index(
        "idx_tk_active", "task_knowledge", ["task_run_id", "category"],
        schema="project",
        postgresql_where=sa.text("archived_at IS NULL"),
    )

    # workflow_versions (FK→unified_workflows CASCADE; self-FK; FK→task_runs SET NULL)
    op.create_table(
        "workflow_versions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "workflow_id",
            sa.Text(),
            sa.ForeignKey("project.unified_workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column(
            "parent_version_id",
            sa.Text(),
            sa.ForeignKey(
                "project.workflow_versions.id",
                ondelete="SET NULL",
                name="workflow_versions_parent_fkey",
            ),
            nullable=True,
        ),
        sa.Column(
            "generation_task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("workflow_json", sa.Text(), nullable=False),
        sa.Column("diff_summary", sa.Text(), nullable=True),
        sa.Column("diff_json", sa.Text(), nullable=True),
        sa.Column("trigger", sa.Text(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_id", "version_number", name="workflow_versions_unique"),
        schema="project",
    )
    op.create_index("idx_wv_workflow", "workflow_versions", ["workflow_id"], schema="project")
    op.create_index("idx_wv_task_run", "workflow_versions", ["generation_task_run_id"], schema="project")

    # step_finding_links (FK → task_runs CASCADE; finding_id is soft FK)
    op.create_table(
        "step_finding_links",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("finding_id", sa.Text(), nullable=False),
        sa.Column("link_type", sa.Text(), nullable=False, server_default=sa.text("'detected_during'")),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sfl_task_run", "step_finding_links", ["task_run_id"], schema="project")
    op.create_index("idx_sfl_step", "step_finding_links", ["step_name"], schema="project")
    op.create_index("idx_sfl_finding", "step_finding_links", ["finding_id"], schema="project")

    # step_provenance (FK→unified_workflows CASCADE; FK→workflow_versions SET NULL)
    op.create_table(
        "step_provenance",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "workflow_id",
            sa.Text(),
            sa.ForeignKey("project.unified_workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workflow_version_id",
            sa.Text(),
            sa.ForeignKey("project.workflow_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("generating_agent", sa.Text(), nullable=False),
        sa.Column("generation_iteration", sa.Integer(), nullable=True),
        sa.Column("original_step_json", sa.Text(), nullable=True),
        sa.Column("final_step_json", sa.Text(), nullable=True),
        sa.Column("ui_bridge_event_ids", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sp_workflow", "step_provenance", ["workflow_id"], schema="project")
    op.create_index("idx_sp_agent", "step_provenance", ["generating_agent"], schema="project")


def downgrade() -> None:
    op.drop_table("step_provenance", schema="project")
    op.drop_table("step_finding_links", schema="project")
    op.drop_table("workflow_versions", schema="project")
    op.drop_table("task_knowledge", schema="project")
    op.drop_table("task_run_findings", schema="project")
