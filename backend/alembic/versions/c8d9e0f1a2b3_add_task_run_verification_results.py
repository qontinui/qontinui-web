"""add task_run_verification_results table

Stores verification phase results from unified workflow execution.
Each row captures summary stats and full JSON for one iteration.

Revision ID: c8d9e0f1a2b3
Revises: b97e3bd6e0c7
Create Date: 2026-02-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "b97e3bd6e0c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "task_run_verification_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "task_run_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("all_passed", sa.Boolean(), nullable=False),
        sa.Column("total_steps", sa.Integer(), nullable=False),
        sa.Column("passed_steps", sa.Integer(), nullable=False),
        sa.Column("failed_steps", sa.Integer(), nullable=False),
        sa.Column(
            "skipped_steps",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("total_duration_ms", sa.BigInteger(), nullable=False),
        sa.Column(
            "critical_failure",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["task_run_id"],
            ["task_runs.id"],
            name="fk_verification_results_task_run_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_run_id", "iteration", name="uq_task_run_verification_iteration"
        ),
    )
    op.create_index(
        "ix_task_run_verification_results_task_run_id",
        "task_run_verification_results",
        ["task_run_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_task_run_verification_results_task_run_id",
        table_name="task_run_verification_results",
    )
    op.drop_table("task_run_verification_results")
