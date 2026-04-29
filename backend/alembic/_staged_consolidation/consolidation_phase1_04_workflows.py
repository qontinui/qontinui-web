"""consolidation phase1 04 workflows

Revision ID: consolidation_phase1_04_workflows
Revises: consolidation_phase1_03_task_run_satellites
Create Date: 2026-04-29

Phase 1, batch 4 of the migration consolidation.

Creates the workflow + queueing tables in ``project``:

- ``project.queued_workflows`` — durable workflow queue (Inngest-inspired).
- ``project.unified_workflows`` — workflow definitions (core CRUD).
- ``project.workflow_execution_state`` — current state machine position.
- ``project.workflow_step_checkpoints`` — step-level checkpoints for resume.
- ``project.step_progress_markers`` — intra-step progress tracking.

Source: ``schema.pg.sql:311-574`` (workflow tables; learning + q_routing
tables in this range are split into batch 5).

Notable details:
- ``unified_workflows.description_embedding`` is ``BYTEA`` (BLOB-era
  convention).
- ``unified_workflows`` has a GIN FTS index on
  ``to_tsvector('english', name || ' ' || COALESCE(description, ''))``;
  alembic doesn't support expression indexes via ``op.create_index``
  cleanly, so it goes through ``op.execute``.
- ``workflow_step_checkpoints`` has a 5-column UNIQUE constraint
  declared inline on the table.
- ``unified_workflows.generated_by_task_run_id`` is ``ON DELETE SET NULL``
  per source — task_run deletion preserves the workflow definition.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_04_workflows"
down_revision: str = "consolidation_phase1_03_task_run_satellites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # queued_workflows (no FKs)
    op.create_table(
        "queued_workflows",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("workflow_id", sa.Text(), nullable=False),
        sa.Column("workflow_name", sa.Text(), nullable=False),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "priority",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "max_retries",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("3"),
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_queued_workflows_status",
        "queued_workflows",
        ["status"],
        schema="project",
    )
    op.create_index(
        "idx_queued_workflows_priority",
        "queued_workflows",
        [sa.text("priority DESC"), sa.text("queued_at ASC")],
        schema="project",
    )

    # unified_workflows (FK → project.task_runs SET NULL)
    op.create_table(
        "unified_workflows",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "description", sa.Text(), nullable=True, server_default=sa.text("''")
        ),
        sa.Column(
            "category",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'general'"),
        ),
        sa.Column(
            "tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")
        ),
        # Phase steps (JSON arrays)
        sa.Column(
            "setup_steps",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "verification_steps",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "agentic_steps",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "completion_steps",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        # Agentic configuration
        sa.Column("max_iterations", sa.BigInteger(), nullable=True),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column(
            "skip_ai_summary",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("timeout_seconds", sa.BigInteger(), nullable=True),
        sa.Column("prompt_template", sa.Text(), nullable=True),
        # Context configuration
        sa.Column(
            "context_ids",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "disabled_context_ids",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "auto_include_contexts",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        # Log configuration
        sa.Column(
            "log_watch_enabled",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "log_source_selection",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'\"default\"'"),
        ),
        # Health check configuration
        sa.Column(
            "health_check_enabled",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "health_check_urls",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        # Pre-flight check
        sa.Column(
            "preflight_check_enabled",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        # Completion sweep
        sa.Column(
            "enable_sweep",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "max_sweep_iterations",
            sa.BigInteger(),
            nullable=True,
            server_default=sa.text("5"),
        ),
        # Multi-stage
        sa.Column(
            "stages", sa.Text(), nullable=True, server_default=sa.text("'[]'")
        ),
        sa.Column(
            "stop_on_failure",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "constraint_overrides",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'{}'"),
        ),
        sa.Column(
            "approval_gate",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "reflection_mode",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "completion_prompts_first",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "model_overrides",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'{}'"),
        ),
        # Generation tracking (FK → project.task_runs SET NULL)
        sa.Column(
            "generated_by_task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Embedding (BYTEA in PG)
        sa.Column("description_embedding", postgresql.BYTEA(), nullable=True),
        # Example library
        sa.Column(
            "example_status",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'pending'"),
        ),
        # Sync
        sa.Column(
            "sync_pending",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        # Favorites
        sa.Column(
            "is_favorite",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        # Quality metadata
        sa.Column("dependency_graph", sa.Text(), nullable=True),
        sa.Column("cost_annotations", sa.Text(), nullable=True),
        sa.Column("quality_report", sa.Text(), nullable=True),
        sa.Column("acceptance_criteria", sa.Text(), nullable=True),
        sa.Column(
            "ai_reviewed",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("true"),
        ),
        # Architecture
        sa.Column("workflow_architecture", sa.Text(), nullable=True),
        # Slash command tracking
        sa.Column("source_file_path", sa.Text(), nullable=True),
        sa.Column("source_content_hash", sa.Text(), nullable=True),
        # Durable execution
        sa.Column(
            "rollback_policy",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'none'"),
        ),
        # CWD and tool filtering
        sa.Column(
            "strict_cwd",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "tool_tags",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'[]'"),
        ),
        # Token budget
        sa.Column(
            "enforce_token_budget",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        # Flow control (v147)
        sa.Column("flow_control_json", sa.Text(), nullable=True),
        sa.Column("phase_timeouts_json", sa.Text(), nullable=True),
        # HTN Planning (v23)
        sa.Column(
            "htn_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("FALSE"),
        ),
        sa.Column("htn_ui_bridge_url", sa.Text(), nullable=True),
        sa.Column("htn_state_machine_path", sa.Text(), nullable=True),
        # DAG workflows (v17)
        sa.Column("source_yaml", sa.Text(), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_uw_category", "unified_workflows", ["category"], schema="project"
    )
    op.create_index(
        "idx_uw_updated_at",
        "unified_workflows",
        ["updated_at"],
        schema="project",
    )
    op.create_index(
        "idx_uw_name", "unified_workflows", ["name"], schema="project"
    )
    op.create_index(
        "idx_uw_example_status",
        "unified_workflows",
        ["example_status"],
        schema="project",
    )
    op.create_index(
        "idx_uw_sync_pending",
        "unified_workflows",
        ["sync_pending"],
        schema="project",
    )
    op.create_index(
        "idx_uw_is_favorite",
        "unified_workflows",
        ["is_favorite"],
        schema="project",
    )
    op.create_index(
        "idx_uw_source_file",
        "unified_workflows",
        ["source_file_path"],
        schema="project",
    )
    # GIN FTS index on (name || ' ' || COALESCE(description, '')).
    # Alembic's op.create_index doesn't cleanly handle expression indexes
    # with concatenation, so emit raw SQL.
    op.execute(
        "CREATE INDEX idx_uw_fts ON project.unified_workflows "
        "USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')))"
    )

    # workflow_execution_state (execution_id is BOTH PK and FK→task_runs)
    op.create_table(
        "workflow_execution_state",
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("workflow_type", sa.Text(), nullable=False),
        sa.Column("state_name", sa.Text(), nullable=False),
        sa.Column("state_data", sa.Text(), nullable=True),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("execution_id"),
        schema="project",
    )
    op.create_index(
        "idx_wes_type",
        "workflow_execution_state",
        ["workflow_type"],
        schema="project",
    )
    op.create_index(
        "idx_wes_state",
        "workflow_execution_state",
        ["state_name"],
        schema="project",
    )

    # workflow_step_checkpoints (FK → task_runs CASCADE; 5-col UNIQUE)
    op.create_table(
        "workflow_step_checkpoints",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "execution_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("workflow_type", sa.Text(), nullable=False),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=True),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("step_type", sa.Text(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("step_config_json", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "stage_index",
            sa.Integer(),
            nullable=True,
            server_default=sa.text("0"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "execution_id",
            "phase",
            "iteration",
            "step_index",
            "stage_index",
            name="workflow_step_checkpoints_uniq",
        ),
        schema="project",
    )
    op.create_index(
        "idx_wsc_execution",
        "workflow_step_checkpoints",
        ["execution_id"],
        schema="project",
    )
    op.create_index(
        "idx_wsc_lookup",
        "workflow_step_checkpoints",
        ["execution_id", "phase", "iteration"],
        schema="project",
    )
    op.create_index(
        "idx_wsc_status",
        "workflow_step_checkpoints",
        ["status"],
        schema="project",
    )
    op.create_index(
        "idx_wsc_cursor",
        "workflow_step_checkpoints",
        ["execution_id", "step_index"],
        schema="project",
    )

    # step_progress_markers (FK → workflow_step_checkpoints CASCADE)
    op.create_table(
        "step_progress_markers",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "checkpoint_id",
            sa.Text(),
            sa.ForeignKey(
                "project.workflow_step_checkpoints.id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("marker_type", sa.Text(), nullable=False),
        sa.Column("current_value", sa.BigInteger(), nullable=False),
        sa.Column("total_value", sa.BigInteger(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("data_json", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "idx_spm_checkpoint",
        "step_progress_markers",
        ["checkpoint_id"],
        schema="project",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_spm_checkpoint",
        table_name="step_progress_markers",
        schema="project",
    )
    op.drop_table("step_progress_markers", schema="project")

    op.drop_index(
        "idx_wsc_cursor",
        table_name="workflow_step_checkpoints",
        schema="project",
    )
    op.drop_index(
        "idx_wsc_status",
        table_name="workflow_step_checkpoints",
        schema="project",
    )
    op.drop_index(
        "idx_wsc_lookup",
        table_name="workflow_step_checkpoints",
        schema="project",
    )
    op.drop_index(
        "idx_wsc_execution",
        table_name="workflow_step_checkpoints",
        schema="project",
    )
    op.drop_table("workflow_step_checkpoints", schema="project")

    op.drop_index(
        "idx_wes_state",
        table_name="workflow_execution_state",
        schema="project",
    )
    op.drop_index(
        "idx_wes_type",
        table_name="workflow_execution_state",
        schema="project",
    )
    op.drop_table("workflow_execution_state", schema="project")

    op.execute("DROP INDEX IF EXISTS project.idx_uw_fts")
    op.drop_index(
        "idx_uw_source_file",
        table_name="unified_workflows",
        schema="project",
    )
    op.drop_index(
        "idx_uw_is_favorite",
        table_name="unified_workflows",
        schema="project",
    )
    op.drop_index(
        "idx_uw_sync_pending",
        table_name="unified_workflows",
        schema="project",
    )
    op.drop_index(
        "idx_uw_example_status",
        table_name="unified_workflows",
        schema="project",
    )
    op.drop_index(
        "idx_uw_name", table_name="unified_workflows", schema="project"
    )
    op.drop_index(
        "idx_uw_updated_at",
        table_name="unified_workflows",
        schema="project",
    )
    op.drop_index(
        "idx_uw_category", table_name="unified_workflows", schema="project"
    )
    op.drop_table("unified_workflows", schema="project")

    op.drop_index(
        "idx_queued_workflows_priority",
        table_name="queued_workflows",
        schema="project",
    )
    op.drop_index(
        "idx_queued_workflows_status",
        table_name="queued_workflows",
        schema="project",
    )
    op.drop_table("queued_workflows", schema="project")
