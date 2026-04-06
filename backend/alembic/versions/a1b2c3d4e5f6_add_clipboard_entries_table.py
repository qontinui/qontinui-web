"""add_clipboard_entries_table

Revision ID: a1b2c3d4e5f6
Revises: z2a3b4c5d6e7
Create Date: 2026-04-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "z2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create clipboard_entries table for cross-device clipboard sync."""
    op.create_table(
        "clipboard_entries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_device_id", sa.String(255), nullable=False),
        sa.Column("source_device_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(2048), nullable=True),
        sa.Column("file_ref", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now() + interval '24 hours'"),
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
        "ix_clipboard_entries_user_id",
        "clipboard_entries",
        ["user_id"],
    )
    op.create_index(
        "ix_clipboard_entries_expires_at",
        "clipboard_entries",
        ["expires_at"],
    )


def downgrade() -> None:
    """Drop clipboard_entries table."""
    op.drop_index("ix_clipboard_entries_expires_at", table_name="clipboard_entries")
    op.drop_index("ix_clipboard_entries_user_id", table_name="clipboard_entries")
    op.drop_table("clipboard_entries")
