"""consolidation phase1 14 workflows + flows (CROSS-SCHEMA)

Revision ID: consolidation_phase1_14_workflows_flows_cross
Revises: consolidation_phase1_13_mobile_tasks_misc
Create Date: 2026-04-29

Phase 1, batch 14: SECOND cross-schema batch. Per mapping:

PROJECT (durable):
- ``project.active_workflows``, ``project.orchestrator_flows``,
  ``project.flow_executions``, ``project.flow_versions``,
  ``project.orchestrator_checkpoints``, ``project.decisions``,
  ``project.concept_summaries``, ``project.development_intelligence``,
  ``project.canvas_panels``.

COORD (cross-instance coordination):
- ``coord.runner_instances``.
- ``coord.process_sessions``.
- ``coord.process_session_output``.

AGENT (ephemeral / cache):
- ``agent.api_surface_snapshots`` (scan-result cache).
- ``agent.cached_app_specs`` (discovered-spec cache).

Source: ``schema.pg.sql:1681-1898``.

DRIFT FLAGS:
- ``project.orchestrator_checkpoints.task_id`` is ``TEXT`` with no FK
  declared in source; preserved as plain TEXT. Could conceptually be
  a soft FK to ``project.task_runs``.
- ``project.canvas_panels.task_run_id`` is FK→task_runs CASCADE
  (declared in source).
- ``coord.process_session_output.session_id`` FK→
  ``coord.process_sessions`` CASCADE (cross-schema FK within coord).

NOTE on concept_summaries placement:
The plan's mapping table allows ``concept_summaries → agent`` "if used
as scratch" but recommends following the "when in doubt, project"
heuristic. The content (durable feature narratives with descriptions,
benefits, decision links) is durable, not scratch — placed in
``project``. Documenting choice per the plan's directive.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_14_workflows_flows_cross"
down_revision: str = "consolidation_phase1_13_mobile_tasks_misc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---------- project.* ----------

    op.create_table(
        "active_workflows",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("checkpoint_data", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=False),
        sa.Column("phase_field", sa.Text(), nullable=False, server_default=sa.text("'current_phase'")),
        sa.Column("completion_value", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_name"),
        schema="project",
    )

    op.create_table(
        "orchestrator_flows",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("steps", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("start_step", sa.Text(), nullable=True),
        sa.Column("timeout_secs", sa.Integer(), nullable=True),
        sa.Column("inputs", sa.Text(), nullable=True),
        sa.Column("outputs", sa.Text(), nullable=True),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("version", sa.Text(), nullable=False, server_default=sa.text("'1.0.0'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_orch_flows_name", "orchestrator_flows", ["name"], schema="project")

    op.create_table(
        "flow_executions",
        sa.Column("instance_id", sa.Text(), nullable=False),
        sa.Column(
            "flow_id",
            sa.Text(),
            sa.ForeignKey("project.orchestrator_flows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("current_step", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("context", sa.Text(), nullable=True),
        sa.Column("history", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("instance_id"),
        schema="project",
    )
    op.create_index("idx_flow_exec_flow", "flow_executions", ["flow_id"], schema="project")
    op.create_index("idx_flow_exec_status", "flow_executions", ["status"], schema="project")

    op.create_table(
        "flow_versions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "flow_id",
            sa.Text(),
            sa.ForeignKey("project.orchestrator_flows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("definition", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("flow_id", "version", name="flow_versions_flow_version_uniq"),
        schema="project",
    )
    op.create_index("idx_flow_versions_flow_id", "flow_versions", ["flow_id"], schema="project")
    op.create_index("idx_flow_versions_flow_version", "flow_versions", ["flow_id", "version"], schema="project")

    op.create_table(
        "orchestrator_checkpoints",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("iteration", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("trigger", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_orch_checkpoints_task", "orchestrator_checkpoints", ["task_id"], schema="project")
    op.create_index("idx_orch_checkpoints_task_iter", "orchestrator_checkpoints", ["task_id", "iteration"], schema="project")

    op.create_table(
        "decisions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("scale", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("alternatives_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("tradeoffs_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("triggered_by", sa.Text(), nullable=True),
        sa.Column("inspiration_json", sa.Text(), nullable=True),
        sa.Column("related_decisions_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("affected_files_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("affected_endpoints_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("affected_tables_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("superseded_by", sa.Text(), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_dec_timestamp", "decisions", ["timestamp"], schema="project")
    op.create_index("idx_dec_category", "decisions", ["category"], schema="project")
    op.create_index("idx_dec_scale", "decisions", ["scale"], schema="project")
    op.create_index(
        "idx_dec_status", "decisions", ["status"],
        schema="project",
        postgresql_where=sa.text("status = 'active'"),
    )
    op.execute(
        "CREATE INDEX idx_dec_fts ON project.decisions "
        "USING GIN (to_tsvector('english', title || ' ' || summary || ' ' || rationale)) "
        "WHERE NOT is_deleted"
    )

    op.create_table(
        "concept_summaries",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("tagline", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("inspiration_json", sa.Text(), nullable=True),
        sa.Column("benefits_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("components_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("related_decisions_json", sa.Text(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("metrics_json", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.execute(
        "CREATE INDEX idx_cs_fts ON project.concept_summaries "
        "USING GIN (to_tsvector('english', name || ' ' || tagline || ' ' || description)) "
        "WHERE NOT is_deleted"
    )

    op.create_table(
        "development_intelligence",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("project_path", sa.Text(), nullable=False),
        sa.Column("analysis_type", sa.Text(), nullable=False),
        sa.Column("page_route", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("details_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_di_project", "development_intelligence", ["project_path", "analysis_type"], schema="project")
    op.create_index("idx_di_created", "development_intelligence", ["created_at"], schema="project")

    op.create_table(
        "canvas_panels",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("component", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("data_json", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=True, server_default=sa.text("50")),
        sa.Column("size", sa.Text(), nullable=True, server_default=sa.text("'normal'")),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_canvas_panels_task_run_id", "canvas_panels", ["task_run_id"], schema="project")

    # ---------- coord.* ----------

    op.create_table(
        "runner_instances",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("hostname", sa.Text(), nullable=False, server_default=sa.text("'localhost'")),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("FALSE")),
        sa.Column("pid", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'starting'")),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("running_tasks", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("port"),
        schema="coord",
    )
    op.create_index("idx_ri_port", "runner_instances", ["port"], schema="coord")
    op.create_index("idx_ri_status", "runner_instances", ["status"], schema="coord")
    op.create_index("idx_ri_heartbeat", "runner_instances", ["last_heartbeat"], schema="coord")

    op.create_table(
        "process_sessions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("process_config_id", sa.Text(), nullable=False),
        sa.Column("process_name", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("state", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_process_sessions_config_id", "process_sessions", ["process_config_id"], schema="coord")
    op.create_index("idx_process_sessions_started_at", "process_sessions", ["started_at"], schema="coord")

    op.create_table(
        "process_session_output",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "session_id",
            sa.Text(),
            sa.ForeignKey("coord.process_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("stream", sa.Text(), nullable=False),
        sa.Column("line", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_process_session_output_session", "process_session_output", ["session_id"], schema="coord")

    # ---------- agent.* ----------

    op.create_table(
        "api_surface_snapshots",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("scan_json", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("total_endpoints", sa.Integer(), nullable=False),
        sa.Column("orphan_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="agent",
    )
    op.create_index(
        "idx_api_surface_snapshots_created", "api_surface_snapshots",
        [sa.text("created_at DESC")],
        schema="agent",
    )

    op.create_table(
        "cached_app_specs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("app_url", sa.Text(), nullable=False),
        sa.Column("app_name", sa.Text(), nullable=False),
        sa.Column("spec_id", sa.Text(), nullable=False),
        sa.Column("spec_json", sa.Text(), nullable=False),
        sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("page_url", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="agent",
    )
    op.create_index("idx_cached_specs_app", "cached_app_specs", ["app_url"], schema="agent")


def downgrade() -> None:
    op.drop_table("cached_app_specs", schema="agent")
    op.drop_table("api_surface_snapshots", schema="agent")
    op.drop_table("process_session_output", schema="coord")
    op.drop_table("process_sessions", schema="coord")
    op.drop_table("runner_instances", schema="coord")
    op.drop_table("canvas_panels", schema="project")
    op.drop_table("development_intelligence", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_cs_fts")
    op.drop_table("concept_summaries", schema="project")
    op.execute("DROP INDEX IF EXISTS project.idx_dec_fts")
    op.drop_table("decisions", schema="project")
    op.drop_table("orchestrator_checkpoints", schema="project")
    op.drop_table("flow_versions", schema="project")
    op.drop_table("flow_executions", schema="project")
    op.drop_table("orchestrator_flows", schema="project")
    op.drop_table("active_workflows", schema="project")
