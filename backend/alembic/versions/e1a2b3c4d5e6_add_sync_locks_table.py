"""add sync_locks table

Revision ID: e1a2b3c4d5e6
Revises: 5d29ac9ab52d
Create Date: 2026-01-04 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# from sqlalchemy.dialects import postgresql  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = "e1a2b3c4d5e6"
down_revision: Union[str, None] = "5d29ac9ab52d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create sync_locks table for coordinating backend operations with frontend sync."""
    op.create_table(
        "sync_locks",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "operation",
            sa.String(length=100),
            nullable=False,
            comment="Description of the operation holding the lock",
        ),
        sa.Column(
            "acquired_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            comment="When the lock automatically expires",
        ),
        sa.Column(
            "released_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the lock was explicitly released (null if still held or expired)",
        ),
        sa.Column(
            "error_message",
            sa.Text(),
            nullable=True,
            comment="Error message if the operation failed",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # Index on project_id for quick lookups
    op.create_index(
        "ix_sync_locks_project_id",
        "sync_locks",
        ["project_id"],
        unique=False,
    )
    # Partial unique index to ensure only one unreleased lock per project
    # Note: Expiration check is done in application code since now() is not IMMUTABLE
    op.create_index(
        "ix_sync_locks_project_active",
        "sync_locks",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("released_at IS NULL"),
    )


def downgrade() -> None:
    """Drop sync_locks table."""
    op.drop_index("ix_sync_locks_project_active", table_name="sync_locks")
    op.drop_index("ix_sync_locks_project_id", table_name="sync_locks")
    op.drop_table("sync_locks")
