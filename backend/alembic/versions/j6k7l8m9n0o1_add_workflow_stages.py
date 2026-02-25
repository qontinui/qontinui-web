"""Add stages and stop_on_failure to unified_workflows, drop workflow_sequences.

Revision ID: j6k7l8m9n0o1
Revises: 63b5cddc8c1f
Create Date: 2026-02-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "j6k7l8m9n0o1"
down_revision: str | None = "63b5cddc8c1f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop the workflow_sequences table — feature fully removed
    op.drop_index(
        op.f("ix_workflow_sequences_project_id"),
        table_name="workflow_sequences",
    )
    op.drop_index(
        op.f("ix_workflow_sequences_name"), table_name="workflow_sequences"
    )
    op.drop_index(
        op.f("ix_workflow_sequences_id"), table_name="workflow_sequences"
    )
    op.drop_index(
        op.f("ix_workflow_sequences_created_by"),
        table_name="workflow_sequences",
    )
    op.drop_table("workflow_sequences")

    op.add_column(
        "unified_workflows",
        sa.Column(
            "stages",
            postgresql.JSONB(),
            nullable=True,
            comment="JSON array of WorkflowStage objects for multi-stage execution",
        ),
    )
    op.add_column(
        "unified_workflows",
        sa.Column(
            "stop_on_failure",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="Whether to stop execution if a stage fails verification",
        ),
    )


def downgrade() -> None:
    op.drop_column("unified_workflows", "stop_on_failure")
    op.drop_column("unified_workflows", "stages")

    # Recreate workflow_sequences table
    op.create_table(
        "workflow_sequences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("workflow_ids", sa.JSON(), nullable=False),
        sa.Column("stop_on_failure", sa.Boolean(), nullable=False),
        sa.Column("schedule", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_sequences_created_by"),
        "workflow_sequences",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_sequences_id"),
        "workflow_sequences",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_sequences_name"),
        "workflow_sequences",
        ["name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_sequences_project_id"),
        "workflow_sequences",
        ["project_id"],
        unique=False,
    )
