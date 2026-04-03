"""add_deferred_questions_table

Revision ID: z2a3b4c5d6e7
Revises: y1z2a3b4c5d6
Create Date: 2026-04-02

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "z2a3b4c5d6e7"
down_revision: Union[str, None] = "y1z2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create deferred_questions table for cross-computer question review."""
    op.create_table(
        "deferred_questions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("task_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column(
            "context_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("auto_decision_type", sa.String(100), nullable=False),
        sa.Column("auto_decision_detail", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("risk_level", sa.String(50), nullable=False),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("git_checkpoint", sa.String(255), nullable=True),
        sa.Column(
            "contingent_iterations",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("reviewer_comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["task_run_id"],
            ["task_runs.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_deferred_questions_task_run_id",
        "deferred_questions",
        ["task_run_id"],
    )
    op.create_index(
        "ix_deferred_questions_status",
        "deferred_questions",
        ["status"],
    )


def downgrade() -> None:
    """Drop deferred_questions table."""
    op.drop_index("ix_deferred_questions_status", table_name="deferred_questions")
    op.drop_index("ix_deferred_questions_task_run_id", table_name="deferred_questions")
    op.drop_table("deferred_questions")
