"""create_conflict_logs_table

Revision ID: 20251120_conflict_logs
Revises: 20251120_093618
Create Date: 2025-11-20 10:00:00.000000

This migration creates the conflict_logs table for tracking merge conflicts
during collaborative editing. Implements 3-way merge conflict detection
with support for resolution tracking.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20251120_conflict_logs"
down_revision: str | None = "20251120_093618"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create conflict_logs table."""
    op.create_table(
        "conflict_logs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("resource_type", sa.String(), nullable=False),
        sa.Column("resource_id", sa.String(), nullable=False),
        sa.Column("local_version", sa.Integer(), nullable=False),
        sa.Column("remote_version", sa.Integer(), nullable=False),
        sa.Column("local_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("remote_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("local_data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("remote_data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("changes", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "detected_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolution_type", sa.String(), nullable=True),
        sa.Column(
            "resolved_data", postgresql.JSON(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(
            ["local_user_id"],
            ["users.id"],
            name="fk_conflict_logs_local_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["remote_user_id"],
            ["users.id"],
            name="fk_conflict_logs_remote_user_id",
            ondelete="CASCADE",
        ),
    )

    # Create indexes for better query performance
    op.create_index(
        "ix_conflict_logs_resource_id",
        "conflict_logs",
        ["resource_id"],
        unique=False,
    )
    op.create_index(
        "ix_conflict_logs_local_user_id",
        "conflict_logs",
        ["local_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_conflict_logs_remote_user_id",
        "conflict_logs",
        ["remote_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_conflict_logs_resolved",
        "conflict_logs",
        ["resolved"],
        unique=False,
    )
    op.create_index(
        "ix_conflict_logs_detected_at",
        "conflict_logs",
        ["detected_at"],
        unique=False,
    )


def downgrade() -> None:
    """Drop conflict_logs table."""
    # Drop indexes
    op.drop_index("ix_conflict_logs_detected_at", table_name="conflict_logs")
    op.drop_index("ix_conflict_logs_resolved", table_name="conflict_logs")
    op.drop_index("ix_conflict_logs_remote_user_id", table_name="conflict_logs")
    op.drop_index("ix_conflict_logs_local_user_id", table_name="conflict_logs")
    op.drop_index("ix_conflict_logs_resource_id", table_name="conflict_logs")

    # Drop table
    op.drop_table("conflict_logs")
