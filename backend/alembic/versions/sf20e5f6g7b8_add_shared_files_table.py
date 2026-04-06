"""add_shared_files_table

Revision ID: sf20e5f6g7b8
Revises: cb10d4e5f6a7
Create Date: 2026-04-06

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "sf20e5f6g7b8"
down_revision: Union[str, None] = "cb10d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create shared_files table for cross-device file sharing."""
    op.create_table(
        "shared_files",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_device_id", sa.String(255), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now() + interval '7 days'"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shared_files_user_id",
        "shared_files",
        ["user_id"],
    )
    op.create_index(
        "ix_shared_files_expires_at",
        "shared_files",
        ["expires_at"],
    )


def downgrade() -> None:
    """Drop shared_files table."""
    op.drop_index("ix_shared_files_expires_at", table_name="shared_files")
    op.drop_index("ix_shared_files_user_id", table_name="shared_files")
    op.drop_table("shared_files")
