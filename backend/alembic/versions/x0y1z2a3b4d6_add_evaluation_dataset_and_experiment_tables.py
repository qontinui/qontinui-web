"""Add evaluation_datasets, dataset_items, evaluation_experiments, experiment_results tables

Revision ID: x0y1z2a3b4d6
Revises: x0y1z2a3b4c5
Create Date: 2026-03-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "x0y1z2a3b4d6"
down_revision: str = "x0y1z2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # -- evaluation_datasets --------------------------------------------------
    op.create_table(
        "evaluation_datasets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # -- dataset_items --------------------------------------------------------
    op.create_table(
        "dataset_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("input", postgresql.JSONB(), nullable=False),
        sa.Column("expected_output", postgresql.JSONB(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["evaluation_datasets.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_dataset_items_dataset_id",
        "dataset_items",
        ["dataset_id"],
    )

    # -- evaluation_experiments -----------------------------------------------
    op.create_table(
        "evaluation_experiments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "dataset_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("prompt_variant_id", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("metrics", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["evaluation_datasets.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_evaluation_experiments_dataset_id",
        "evaluation_experiments",
        ["dataset_id"],
    )

    # -- experiment_results ---------------------------------------------------
    op.create_table(
        "experiment_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "experiment_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "dataset_item_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("output", postgresql.JSONB(), nullable=False),
        sa.Column("scores", postgresql.JSONB(), nullable=True),
        sa.Column("duration_ms", sa.Float(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("tokens_total", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["experiment_id"],
            ["evaluation_experiments.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["dataset_item_id"],
            ["dataset_items.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_experiment_results_experiment_id",
        "experiment_results",
        ["experiment_id"],
    )
    op.create_index(
        "ix_experiment_results_dataset_item_id",
        "experiment_results",
        ["dataset_item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_experiment_results_dataset_item_id", table_name="experiment_results"
    )
    op.drop_index(
        "ix_experiment_results_experiment_id", table_name="experiment_results"
    )
    op.drop_table("experiment_results")

    op.drop_index(
        "ix_evaluation_experiments_dataset_id", table_name="evaluation_experiments"
    )
    op.drop_table("evaluation_experiments")

    op.drop_index("ix_dataset_items_dataset_id", table_name="dataset_items")
    op.drop_table("dataset_items")

    op.drop_table("evaluation_datasets")
