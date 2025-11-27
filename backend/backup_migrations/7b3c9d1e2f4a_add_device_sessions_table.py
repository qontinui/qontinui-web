"""add_device_sessions_table

Revision ID: 7b3c9d1e2f4a
Revises: 6a54cc0f9180
Create Date: 2025-10-24 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7b3c9d1e2f4a"
down_revision: str | None = "6a54cc0f9180"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create device_sessions table
    op.create_table(
        "device_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("device_fingerprint", sa.String(length=255), nullable=False),
        sa.Column("ip_address", sa.String(length=45), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=False),
        sa.Column("accept_language", sa.String(length=255), nullable=True),
        sa.Column("is_trusted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "first_seen", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "last_seen", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("last_ip", sa.String(length=45), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes for performance
    op.create_index(
        "ix_device_sessions_user_id", "device_sessions", ["user_id"], unique=False
    )
    op.create_index(
        "ix_device_sessions_device_fingerprint",
        "device_sessions",
        ["device_fingerprint"],
        unique=False,
    )
    op.create_index(
        "ix_device_sessions_user_id_fingerprint",
        "device_sessions",
        ["user_id", "device_fingerprint"],
        unique=False,
    )


def downgrade() -> None:
    # Drop indexes
    op.drop_index(
        "ix_device_sessions_user_id_fingerprint", table_name="device_sessions"
    )
    op.drop_index("ix_device_sessions_device_fingerprint", table_name="device_sessions")
    op.drop_index("ix_device_sessions_user_id", table_name="device_sessions")

    # Drop table
    op.drop_table("device_sessions")
