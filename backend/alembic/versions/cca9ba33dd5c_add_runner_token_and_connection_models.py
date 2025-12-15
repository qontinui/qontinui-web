"""add_runner_token_and_connection_models

Revision ID: cca9ba33dd5c
Revises: 675031faaab9
Create Date: 2025-11-19 11:23:49.514612

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cca9ba33dd5c"
down_revision: str | None = "675031faaab9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create runner_tokens table
    op.create_table(
        "runner_tokens",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_ip_address", sa.String(length=45), nullable=True),
        sa.Column("last_user_agent", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    # Create indexes for runner_tokens
    op.create_index(
        op.f("ix_runner_tokens_user_id"), "runner_tokens", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_runner_tokens_token_hash"),
        "runner_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        op.f("ix_runner_tokens_is_revoked"),
        "runner_tokens",
        ["is_revoked"],
        unique=False,
    )
    op.create_index(
        op.f("ix_runner_tokens_last_used_at"),
        "runner_tokens",
        ["last_used_at"],
        unique=False,
    )

    # Create runner_connections table
    op.create_table(
        "runner_connections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("runner_token_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("connected_at", sa.DateTime(), nullable=False),
        sa.Column("disconnected_at", sa.DateTime(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("session_id", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(
            ["runner_token_id"], ["runner_tokens.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Create indexes for runner_connections
    op.create_index(
        op.f("ix_runner_connections_runner_token_id"),
        "runner_connections",
        ["runner_token_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_runner_connections_user_id"),
        "runner_connections",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_runner_connections_connected_at"),
        "runner_connections",
        ["connected_at"],
        unique=False,
    )


def downgrade() -> None:
    # Drop runner_connections table and indexes
    op.drop_index(
        op.f("ix_runner_connections_connected_at"), table_name="runner_connections"
    )
    op.drop_index(
        op.f("ix_runner_connections_user_id"), table_name="runner_connections"
    )
    op.drop_index(
        op.f("ix_runner_connections_runner_token_id"), table_name="runner_connections"
    )
    op.drop_table("runner_connections")

    # Drop runner_tokens table and indexes
    op.drop_index(op.f("ix_runner_tokens_last_used_at"), table_name="runner_tokens")
    op.drop_index(op.f("ix_runner_tokens_is_revoked"), table_name="runner_tokens")
    op.drop_index(op.f("ix_runner_tokens_token_hash"), table_name="runner_tokens")
    op.drop_index(op.f("ix_runner_tokens_user_id"), table_name="runner_tokens")
    op.drop_table("runner_tokens")
