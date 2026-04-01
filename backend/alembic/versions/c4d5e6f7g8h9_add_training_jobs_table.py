"""add_training_jobs_table

Revision ID: c4d5e6f7g8h9
Revises: b2c3d4e5f6g7
Create Date: 2026-01-31

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7g8h9"
down_revision: Union[str, None] = "b2c3d4e5f6g7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create training_jobs table for ML training pipeline integration."""
    op.create_table(
        "training_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("annotation_set_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "model_type",
            sa.String(length=50),
            nullable=False,
            server_default="detection",
        ),
        sa.Column("config", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "status", sa.String(length=50), nullable=False, server_default="pending"
        ),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_epoch", sa.Integer(), nullable=True),
        sa.Column("total_epochs", sa.Integer(), nullable=True),
        sa.Column("logs", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("metrics", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("output_path", sa.String(length=500), nullable=True),
        sa.Column("model_url", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["annotation_set_id"],
            ["annotation_sets.id"],
            name=op.f("fk_training_jobs_annotation_set_id_annotation_sets"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_training_jobs_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_training_jobs_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_training_jobs")),
    )
    op.create_index(
        op.f("ix_training_jobs_project_id"),
        "training_jobs",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_training_jobs_user_id"), "training_jobs", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_training_jobs_status"), "training_jobs", ["status"], unique=False
    )


def downgrade() -> None:
    """Drop training_jobs table."""
    op.drop_index(op.f("ix_training_jobs_status"), table_name="training_jobs")
    op.drop_index(op.f("ix_training_jobs_user_id"), table_name="training_jobs")
    op.drop_index(op.f("ix_training_jobs_project_id"), table_name="training_jobs")
    op.drop_table("training_jobs")
