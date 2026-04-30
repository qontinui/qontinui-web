"""consolidation phase1 02 task_runs

Revision ID: consolidation_phase1_02_task_runs
Revises: consolidation_phase1_01_infrastructure
Create Date: 2026-04-29

Phase 1, batch 2 of the migration consolidation.

Creates ``project.task_runs``, the root execution-history table that
nearly every other ``project.*`` table FK-references. Per the schema
mapping in the plan, ``task_runs`` is the canonical durable execution
record and lives in the ``project`` schema.

Source: ``qontinui-runner/src-tauri/schema.pg.sql:13-125``.

Notable details:
- Primary key is ``TEXT``, not ``UUID`` — runner-native used TEXT for
  all IDs and the values flowing through this table are runner-issued
  strings, not pg-generated UUIDs. Keeping TEXT preserves fidelity.
- ``parent_task_run_id`` is a self-FK with ``ON DELETE SET NULL``.
- ``prompt_embedding`` / ``summary_embedding`` are ``BYTEA`` (1536
  bytes = 384 × f32 LE), not ``vector(N)`` — the runner-native
  tradition for embeddings predates pgvector adoption. Migration to
  ``vector`` columns is a separate future cleanup.
- 9 secondary indexes per the source's ``CREATE INDEX`` list.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_02_task_runs"
down_revision: str = "consolidation_phase1_01_infrastructure"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_runs",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("task_name", sa.Text(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column(
            "task_type",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'task'"),
        ),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'running'"),
        ),
        # Session tracking
        sa.Column(
            "sessions_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("max_sessions", sa.Integer(), nullable=True),
        sa.Column(
            "auto_continue",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        # Output
        sa.Column(
            "output_log", sa.Text(), nullable=True, server_default=sa.text("''")
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        # Execution configuration
        sa.Column("execution_steps_json", sa.Text(), nullable=True),
        sa.Column("log_sources_json", sa.Text(), nullable=True),
        # Config linkage
        sa.Column("config_id", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("workflow_id", sa.Text(), nullable=True),
        # Summary
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("goal_achieved", sa.Boolean(), nullable=True),
        sa.Column("remaining_work", sa.Text(), nullable=True),
        sa.Column(
            "summary_generated_at", sa.DateTime(timezone=True), nullable=True
        ),
        # Runtime context
        sa.Column("runtime_context_json", sa.Text(), nullable=True),
        sa.Column("transition_history_json", sa.Text(), nullable=True),
        # Hierarchy (self-FK)
        sa.Column(
            "parent_task_run_id",
            sa.Text(),
            sa.ForeignKey(
                "project.task_runs.id",
                ondelete="SET NULL",
                name="task_runs_parent_task_run_id_fkey",
            ),
            nullable=True,
        ),
        sa.Column("root_task_run_id", sa.Text(), nullable=True),
        sa.Column("depth", sa.Integer(), nullable=True, server_default=sa.text("0")),
        # Multi-bridge
        sa.Column("bridge_id", sa.Text(), nullable=True),
        # Workflow type
        sa.Column("workflow_type", sa.Text(), nullable=True),
        # Structured result data
        sa.Column("result_data", sa.Text(), nullable=True),
        # Web integration
        sa.Column("workspace_id", sa.Text(), nullable=True),
        sa.Column("triggered_by", sa.Text(), nullable=True),
        # Embeddings
        sa.Column("prompt_embedding", postgresql.BYTEA(), nullable=True),
        sa.Column("summary_embedding", postgresql.BYTEA(), nullable=True),
        # Reflection
        sa.Column(
            "is_reflection",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column("reflection_source_task_run_id", sa.Text(), nullable=True),
        # Follow-up
        sa.Column(
            "is_follow_up",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column("follow_up_source_task_run_id", sa.Text(), nullable=True),
        # Runner port
        sa.Column("runner_port", sa.Integer(), nullable=True),
        # Fixer
        sa.Column(
            "is_fixer",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column("fixer_source_task_run_id", sa.Text(), nullable=True),
        sa.Column(
            "fix_attempts", sa.Integer(), nullable=True, server_default=sa.text("0")
        ),
        # Review / CI
        sa.Column(
            "is_review",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "blocks_parent",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "ci_auto_resumes",
            sa.Integer(),
            nullable=True,
            server_default=sa.text("0"),
        ),
        # Meta-optimizer
        sa.Column(
            "is_meta_optimizer",
            sa.Boolean(),
            nullable=True,
            server_default=sa.text("false"),
        ),
        # Cross-iteration context
        sa.Column("iteration_history", sa.Text(), nullable=True),
        # Pipeline checkpoint
        sa.Column("pipeline_checkpoint", sa.Text(), nullable=True),
        # Durable execution
        sa.Column("iteration_diffs", sa.Text(), nullable=True),
        sa.Column("iteration_commits", sa.Text(), nullable=True),
        sa.Column("verification_passed", sa.Boolean(), nullable=True),
        # Token totals (aggregated from phase_token_usage)
        sa.Column(
            "total_input_tokens",
            sa.BigInteger(),
            nullable=True,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "total_output_tokens",
            sa.BigInteger(),
            nullable=True,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "total_cost_cents",
            sa.BigInteger(),
            nullable=True,
            server_default=sa.text("0"),
        ),
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
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )

    op.create_index(
        "idx_tr_status", "task_runs", ["status"], schema="project"
    )
    op.create_index(
        "idx_tr_created_at", "task_runs", ["created_at"], schema="project"
    )
    op.create_index(
        "idx_tr_task_type", "task_runs", ["task_type"], schema="project"
    )
    op.create_index(
        "idx_tr_config_id", "task_runs", ["config_id"], schema="project"
    )
    op.create_index(
        "idx_tr_parent", "task_runs", ["parent_task_run_id"], schema="project"
    )
    op.create_index(
        "idx_tr_root", "task_runs", ["root_task_run_id"], schema="project"
    )
    op.create_index(
        "idx_tr_bridge_id", "task_runs", ["bridge_id"], schema="project"
    )
    op.create_index(
        "idx_tr_runner_port", "task_runs", ["runner_port"], schema="project"
    )
    op.create_index(
        "idx_tr_workflow_id", "task_runs", ["workflow_id"], schema="project"
    )


def downgrade() -> None:
    op.drop_index("idx_tr_workflow_id", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_runner_port", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_bridge_id", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_root", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_parent", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_config_id", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_task_type", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_created_at", table_name="task_runs", schema="project")
    op.drop_index("idx_tr_status", table_name="task_runs", schema="project")
    op.drop_table("task_runs", schema="project")
