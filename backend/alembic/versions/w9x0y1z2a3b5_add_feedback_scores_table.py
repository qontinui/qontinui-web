"""Add feedback_scores table

Revision ID: w9x0y1z2a3b5
Revises: w9x0y1z2a3b4
Create Date: 2026-03-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "w9x0y1z2a3b5"
down_revision: str = "w9x0y1z2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback_scores",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "action_execution_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("category_value", sa.String(255), nullable=True),
        sa.Column(
            "source",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'manual'"),
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Constraints
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["execution_runs.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["action_execution_id"],
            ["action_executions.id"],
            ondelete="CASCADE",
        ),
    )

    # Indexes for common query patterns
    op.create_index(
        "ix_feedback_scores_run_id",
        "feedback_scores",
        ["run_id"],
    )
    op.create_index(
        "ix_feedback_scores_action_execution_id",
        "feedback_scores",
        ["action_execution_id"],
    )
    op.create_index(
        "ix_feedback_scores_name_source",
        "feedback_scores",
        ["name", "source"],
    )


def downgrade() -> None:
    op.drop_index("ix_feedback_scores_name_source", table_name="feedback_scores")
    op.drop_index(
        "ix_feedback_scores_action_execution_id", table_name="feedback_scores"
    )
    op.drop_index("ix_feedback_scores_run_id", table_name="feedback_scores")
    op.drop_table("feedback_scores")
