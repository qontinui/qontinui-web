"""add ai_tasks tables

Revision ID: f2b3c4d5e6f7
Revises: e1a2b3c4d5e6
Create Date: 2026-01-04 15:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f2b3c4d5e6f7"
down_revision: Union[str, None] = "e1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create AI Tasks tables for multi-session Claude analysis tracking."""
    # Create enum types
    op.execute("""
        CREATE TYPE ai_task_status AS ENUM ('running', 'complete', 'failed', 'stopped');
        """)
    op.execute("""
        CREATE TYPE ai_task_finding_category AS ENUM (
            'code_bug', 'security', 'performance', 'todo', 'enhancement',
            'config_issue', 'test_issue', 'documentation', 'runtime_issue',
            'already_fixed', 'expected_behavior'
        );
        """)
    op.execute("""
        CREATE TYPE ai_task_finding_severity AS ENUM ('critical', 'high', 'medium', 'low', 'info');
        """)
    op.execute("""
        CREATE TYPE ai_task_finding_status AS ENUM (
            'detected', 'in_progress', 'needs_input', 'resolved', 'wont_fix', 'deferred'
        );
        """)
    op.execute("""
        CREATE TYPE ai_task_finding_action_type AS ENUM ('auto_fix', 'needs_user_input', 'informational');
        """)

    # Create ai_tasks table
    op.create_table(
        "ai_tasks",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", sa.UUID(), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column(
            "runner_id",
            sa.String(length=255),
            nullable=True,
            comment="Runner instance identifier",
        ),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column(
            "prompt",
            sa.Text(),
            nullable=False,
            comment="The task description/instructions given to Claude",
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                "running",
                "complete",
                "failed",
                "stopped",
                name="ai_task_status",
                create_type=False,
            ),
            nullable=False,
            server_default="running",
        ),
        sa.Column(
            "sessions_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="Number of Claude sessions spawned",
        ),
        sa.Column(
            "max_sessions",
            sa.Integer(),
            nullable=True,
            comment="Maximum sessions before giving up (null = unlimited)",
        ),
        sa.Column(
            "auto_continue",
            sa.Boolean(),
            nullable=False,
            server_default="true",
            comment="Whether to automatically spawn new sessions",
        ),
        sa.Column(
            "output_summary",
            sa.Text(),
            nullable=True,
            comment="Summary of task output for display",
        ),
        sa.Column(
            "full_output_stored",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment="Whether full output is stored",
        ),
        sa.Column(
            "full_output",
            sa.Text(),
            nullable=True,
            comment="Complete Claude conversation history (premium)",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "duration_seconds",
            sa.Integer(),
            nullable=True,
            comment="Total task duration in seconds",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_tasks_project_id", "ai_tasks", ["project_id"], unique=False)
    op.create_index(
        "ix_ai_tasks_created_by_user_id",
        "ai_tasks",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index("ix_ai_tasks_runner_id", "ai_tasks", ["runner_id"], unique=False)
    op.create_index("ix_ai_tasks_status", "ai_tasks", ["status"], unique=False)

    # Create ai_task_sessions table
    op.create_table(
        "ai_task_sessions",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column(
            "session_number",
            sa.Integer(),
            nullable=False,
            comment="Session number within the task (1-indexed)",
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "duration_seconds",
            sa.Integer(),
            nullable=True,
            comment="Session duration in seconds",
        ),
        sa.Column(
            "output_summary",
            sa.Text(),
            nullable=True,
            comment="Summary of session output",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["ai_tasks.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_task_sessions_task_id", "ai_task_sessions", ["task_id"], unique=False
    )

    # Create ai_task_findings table
    op.create_table(
        "ai_task_findings",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column(
            "category",
            postgresql.ENUM(
                "code_bug",
                "security",
                "performance",
                "todo",
                "enhancement",
                "config_issue",
                "test_issue",
                "documentation",
                "runtime_issue",
                "already_fixed",
                "expected_behavior",
                name="ai_task_finding_category",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "severity",
            postgresql.ENUM(
                "critical",
                "high",
                "medium",
                "low",
                "info",
                name="ai_task_finding_severity",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                "detected",
                "in_progress",
                "needs_input",
                "resolved",
                "wont_fix",
                "deferred",
                name="ai_task_finding_status",
                create_type=False,
            ),
            nullable=False,
            server_default="detected",
        ),
        sa.Column(
            "action_type",
            postgresql.ENUM(
                "auto_fix",
                "needs_user_input",
                "informational",
                name="ai_task_finding_action_type",
                create_type=False,
            ),
            nullable=False,
            server_default="auto_fix",
        ),
        sa.Column(
            "signature_hash",
            sa.String(length=64),
            nullable=True,
            comment="Hash for finding deduplication",
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "resolution",
            sa.Text(),
            nullable=True,
            comment="How the finding was resolved",
        ),
        sa.Column(
            "file_path",
            sa.String(length=1000),
            nullable=True,
            comment="File path where finding was detected",
        ),
        sa.Column("line_number", sa.Integer(), nullable=True),
        sa.Column("column_number", sa.Integer(), nullable=True),
        sa.Column(
            "code_snippet",
            sa.Text(),
            nullable=True,
            comment="Code snippet showing the issue",
        ),
        sa.Column(
            "detected_in_session",
            sa.Integer(),
            nullable=False,
            comment="Session number where finding was detected",
        ),
        sa.Column(
            "resolved_in_session",
            sa.Integer(),
            nullable=True,
            comment="Session number where finding was resolved",
        ),
        sa.Column(
            "needs_input",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment="Whether user input is required",
        ),
        sa.Column(
            "question",
            sa.Text(),
            nullable=True,
            comment="Question to ask user if input needed",
        ),
        sa.Column(
            "input_options",
            postgresql.JSONB(),
            nullable=True,
            comment="Array of options for user selection",
        ),
        sa.Column(
            "user_response",
            sa.Text(),
            nullable=True,
            comment="User's response to the question",
        ),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["ai_tasks.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_task_findings_task_id", "ai_task_findings", ["task_id"], unique=False
    )
    op.create_index(
        "ix_ai_task_findings_category", "ai_task_findings", ["category"], unique=False
    )
    op.create_index(
        "ix_ai_task_findings_severity", "ai_task_findings", ["severity"], unique=False
    )
    op.create_index(
        "ix_ai_task_findings_status", "ai_task_findings", ["status"], unique=False
    )
    op.create_index(
        "ix_ai_task_findings_signature_hash",
        "ai_task_findings",
        ["signature_hash"],
        unique=False,
    )


def downgrade() -> None:
    """Drop AI Tasks tables and enum types."""
    # Drop tables
    op.drop_index("ix_ai_task_findings_signature_hash", table_name="ai_task_findings")
    op.drop_index("ix_ai_task_findings_status", table_name="ai_task_findings")
    op.drop_index("ix_ai_task_findings_severity", table_name="ai_task_findings")
    op.drop_index("ix_ai_task_findings_category", table_name="ai_task_findings")
    op.drop_index("ix_ai_task_findings_task_id", table_name="ai_task_findings")
    op.drop_table("ai_task_findings")

    op.drop_index("ix_ai_task_sessions_task_id", table_name="ai_task_sessions")
    op.drop_table("ai_task_sessions")

    op.drop_index("ix_ai_tasks_status", table_name="ai_tasks")
    op.drop_index("ix_ai_tasks_runner_id", table_name="ai_tasks")
    op.drop_index("ix_ai_tasks_created_by_user_id", table_name="ai_tasks")
    op.drop_index("ix_ai_tasks_project_id", table_name="ai_tasks")
    op.drop_table("ai_tasks")

    # Drop enum types
    op.execute("DROP TYPE ai_task_finding_action_type;")
    op.execute("DROP TYPE ai_task_finding_status;")
    op.execute("DROP TYPE ai_task_finding_severity;")
    op.execute("DROP TYPE ai_task_finding_category;")
    op.execute("DROP TYPE ai_task_status;")
