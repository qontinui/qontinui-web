"""Rename ai_tasks to task_runs and add unified fields.

This migration:
1. Renames ai_tasks -> task_runs
2. Renames ai_task_sessions -> task_run_sessions
3. Renames ai_task_findings -> task_run_findings
4. Adds new columns for unified architecture (task_type, config_id, workflow_name, etc.)
5. Creates task_run_automations table for GUI automation tracking

Revision ID: g3h4i5j6k7l8
Revises: 377a08d43176
Create Date: 2025-01-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g3h4i5j6k7l8"
down_revision: str | None = "377a08d43176"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # =========================================================================
    # Step 1: Create new enum types
    # =========================================================================

    # Create task_type enum
    task_type_enum = postgresql.ENUM(
        "task", "automation", "scheduled", name="task_type", create_type=False
    )
    task_type_enum.create(op.get_bind(), checkfirst=True)

    # Create new enum types for findings (without AI prefix)
    # Note: We keep the old enums for now and use them with new names
    # The actual values remain the same

    # =========================================================================
    # Step 2: Rename tables
    # =========================================================================

    # Rename ai_tasks -> task_runs
    op.rename_table("ai_tasks", "task_runs")

    # Rename ai_task_sessions -> task_run_sessions
    op.rename_table("ai_task_sessions", "task_run_sessions")

    # Rename ai_task_findings -> task_run_findings
    op.rename_table("ai_task_findings", "task_run_findings")

    # =========================================================================
    # Step 3: Rename foreign key columns in child tables
    # =========================================================================

    # Rename task_id -> task_run_id in task_run_sessions
    op.alter_column(
        "task_run_sessions",
        "task_id",
        new_column_name="task_run_id",
    )

    # Rename task_id -> task_run_id in task_run_findings
    op.alter_column(
        "task_run_findings",
        "task_id",
        new_column_name="task_run_id",
    )

    # =========================================================================
    # Step 4: Add new columns to task_runs
    # =========================================================================

    # Task type column
    op.add_column(
        "task_runs",
        sa.Column(
            "task_type",
            sa.Enum("task", "automation", "scheduled", name="task_type"),
            nullable=False,
            server_default="task",
            comment="Type of task: task, automation, scheduled",
        ),
    )

    # Config linkage for automation-enabled tasks
    op.add_column(
        "task_runs",
        sa.Column(
            "config_id",
            sa.String(255),
            nullable=True,
            comment="Config ID for automation tasks",
        ),
    )

    op.add_column(
        "task_runs",
        sa.Column(
            "workflow_name",
            sa.String(255),
            nullable=True,
            comment="Workflow name for automation tasks",
        ),
    )

    # Summary fields (renamed from ai_summary)
    op.add_column(
        "task_runs",
        sa.Column(
            "summary",
            sa.Text(),
            nullable=True,
            comment="Post-completion summary",
        ),
    )

    op.add_column(
        "task_runs",
        sa.Column(
            "goal_achieved",
            sa.Boolean(),
            nullable=True,
            comment="Whether the task goal was achieved",
        ),
    )

    op.add_column(
        "task_runs",
        sa.Column(
            "remaining_work",
            sa.Text(),
            nullable=True,
            comment="Description of remaining work",
        ),
    )

    op.add_column(
        "task_runs",
        sa.Column(
            "summary_generated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the summary was generated",
        ),
    )

    # Execution configuration
    op.add_column(
        "task_runs",
        sa.Column(
            "execution_steps_json",
            sa.Text(),
            nullable=True,
            comment="JSON array of execution steps configuration",
        ),
    )

    op.add_column(
        "task_runs",
        sa.Column(
            "log_sources_json",
            sa.Text(),
            nullable=True,
            comment="JSON array of log sources to capture",
        ),
    )

    # Make prompt nullable (for pure automation tasks)
    op.alter_column(
        "task_runs",
        "prompt",
        existing_type=sa.TEXT(),
        nullable=True,
        comment="The task description/instructions (NULL for pure automation)",
    )

    # Create indexes on new columns
    op.create_index("ix_task_runs_task_type", "task_runs", ["task_type"])
    op.create_index("ix_task_runs_config_id", "task_runs", ["config_id"])

    # =========================================================================
    # Step 5: Create task_run_automations table
    # =========================================================================

    op.create_table(
        "task_run_automations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "task_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("task_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("workflow_name", sa.String(255), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "automation_status",
            sa.String(50),
            nullable=False,
            server_default="running",
            comment="Automation status: running, completed, failed, timeout",
        ),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("error_type", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "actions_summary",
            sa.Text(),
            nullable=True,
            comment="JSON summary of actions executed",
        ),
        sa.Column(
            "states_visited",
            sa.Text(),
            nullable=True,
            comment="JSON list of states visited",
        ),
        sa.Column(
            "transitions_executed",
            sa.Text(),
            nullable=True,
            comment="JSON list of transitions executed",
        ),
        sa.Column(
            "template_matches",
            sa.Text(),
            nullable=True,
            comment="JSON list of template match results",
        ),
        sa.Column(
            "anomalies",
            sa.Text(),
            nullable=True,
            comment="JSON list of detected anomalies",
        ),
        sa.Column(
            "screenshots",
            sa.Text(),
            nullable=True,
            comment="JSON list of screenshot records",
        ),
        sa.Column(
            "iteration_number",
            sa.Integer(),
            nullable=False,
            server_default="1",
            comment="Iteration number within the task run",
        ),
    )


def downgrade() -> None:
    # =========================================================================
    # Step 1: Drop task_run_automations table
    # =========================================================================
    op.drop_table("task_run_automations")

    # =========================================================================
    # Step 2: Drop new columns from task_runs
    # =========================================================================
    op.drop_index("ix_task_runs_config_id", table_name="task_runs")
    op.drop_index("ix_task_runs_task_type", table_name="task_runs")

    op.drop_column("task_runs", "log_sources_json")
    op.drop_column("task_runs", "execution_steps_json")
    op.drop_column("task_runs", "summary_generated_at")
    op.drop_column("task_runs", "remaining_work")
    op.drop_column("task_runs", "goal_achieved")
    op.drop_column("task_runs", "summary")
    op.drop_column("task_runs", "workflow_name")
    op.drop_column("task_runs", "config_id")
    op.drop_column("task_runs", "task_type")

    # Make prompt not nullable again
    op.alter_column(
        "task_runs",
        "prompt",
        existing_type=sa.TEXT(),
        nullable=False,
    )

    # =========================================================================
    # Step 3: Rename foreign key columns back
    # =========================================================================
    op.alter_column(
        "task_run_findings",
        "task_run_id",
        new_column_name="task_id",
    )

    op.alter_column(
        "task_run_sessions",
        "task_run_id",
        new_column_name="task_id",
    )

    # =========================================================================
    # Step 4: Rename tables back
    # =========================================================================
    op.rename_table("task_run_findings", "ai_task_findings")
    op.rename_table("task_run_sessions", "ai_task_sessions")
    op.rename_table("task_runs", "ai_tasks")

    # =========================================================================
    # Step 5: Drop enum type
    # =========================================================================
    task_type_enum = postgresql.ENUM(
        "task", "automation", "scheduled", name="task_type"
    )
    task_type_enum.drop(op.get_bind(), checkfirst=True)
