"""add scheduled_workflow_runs table

Revision ID: b3e5d8a1c2f4
Revises: a1c4f2d8e3b5
Create Date: 2026-04-21 10:00:00.000000

Phase 3D of restate-port-part-b-server-runner:

* Add ``scheduled_workflow_runs`` — one row per user-configured cron schedule
  that dispatches a workflow to a server-mode runner. The DB row is the
  source of truth; the corresponding redbeat entry in Redis is the runtime
  mechanism that fires ``app.tasks.scheduled_dispatch.fire`` at cron time.

Hand-written (not autogen) per the plan.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3e5d8a1c2f4"
down_revision: str | None = "a1c4f2d8e3b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scheduled_workflow_runs",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("workflow_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "cron_expression",
            sa.String(length=255),
            nullable=False,
            comment="5-field cron expression, validated via croniter on write.",
        ),
        sa.Column(
            "target",
            sa.String(length=255),
            nullable=False,
            comment=(
                "Either the literal string 'auto' or a stringified runner UUID "
                "— mirrors the WorkflowDispatchRequest.target shape."
            ),
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "last_fired_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "last_execution_id",
            sa.String(length=255),
            nullable=True,
            comment=(
                "Runner-returned execution_id from the most recent successful "
                "dispatch."
            ),
        ),
        sa.Column(
            "last_status",
            sa.String(length=32),
            nullable=True,
            comment="'dispatched' | 'failed' — outcome of the most recent fire.",
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "redbeat_entry_id",
            sa.String(length=255),
            nullable=True,
            comment=(
                "Redbeat scheduler key for this row, conventionally "
                "'qontinui:schedule:{id}'. Present when a redbeat entry exists "
                "in Redis; cleared when the entry is removed (disable/delete)."
            ),
        ),
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
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("scheduled_workflow_runs_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workflow_id"],
            ["unified_workflows.id"],
            name=op.f("scheduled_workflow_runs_workflow_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("scheduled_workflow_runs_pkey")),
        sa.UniqueConstraint(
            "redbeat_entry_id",
            name=op.f("scheduled_workflow_runs_redbeat_entry_id_key"),
        ),
    )
    op.create_index(
        op.f("ix_scheduled_workflow_runs_user_id"),
        "scheduled_workflow_runs",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_workflow_runs_workflow_id",
        "scheduled_workflow_runs",
        ["workflow_id"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_workflow_runs_user_workflow",
        "scheduled_workflow_runs",
        ["user_id", "workflow_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_scheduled_workflow_runs_user_workflow",
        table_name="scheduled_workflow_runs",
    )
    op.drop_index(
        "ix_scheduled_workflow_runs_workflow_id",
        table_name="scheduled_workflow_runs",
    )
    op.drop_index(
        op.f("ix_scheduled_workflow_runs_user_id"),
        table_name="scheduled_workflow_runs",
    )
    op.drop_table("scheduled_workflow_runs")
