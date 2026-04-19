"""add runner tokens and runners

Revision ID: 60801728f43e
Revises: uh32g7h8i9d0
Create Date: 2026-04-19 20:59:54.755439

Phase 3A of restate-port-part-b-server-runner:

* Recreate the ``runner_tokens`` table (previously dropped by
  ``7931bff72fe5_remove_runner_tokens``) with ``token_hash`` widened from
  ``VARCHAR(64)`` (legacy SHA-256 hex) to ``VARCHAR(255)`` so a full Argon2
  hash fits.
* Add a new ``runners`` table — the server-mode runner fleet registry —
  with a nullable FK to ``runner_tokens.id`` (SET NULL on delete).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "60801728f43e"
down_revision: Union[str, None] = "uh32g7h8i9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # runner_tokens
    # ------------------------------------------------------------------
    op.create_table(
        "runner_tokens",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "name",
            sa.String(length=255),
            nullable=False,
            comment="User-friendly name like 'My Laptop', 'Work Desktop'",
        ),
        sa.Column(
            "token_hash",
            sa.String(length=255),
            nullable=False,
            comment="Argon2 hash of the plain token (plain never persisted)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Token expiration time. None = never expires",
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Last time this token was used for authentication",
        ),
        sa.Column(
            "is_revoked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="Soft-delete flag for audit trail",
        ),
        sa.Column(
            "revoked_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the token was revoked",
        ),
        sa.Column(
            "last_ip_address",
            sa.String(length=45),
            nullable=True,
            comment="Last IP address that used this token",
        ),
        sa.Column(
            "last_user_agent",
            sa.String(length=500),
            nullable=True,
            comment="Last user agent that used this token",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("runner_tokens_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("runner_tokens_pkey")),
    )
    op.create_index(
        op.f("ix_runner_tokens_user_id"),
        "runner_tokens",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_runner_tokens_token_hash"),
        "runner_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        op.f("ix_runner_tokens_last_used_at"),
        "runner_tokens",
        ["last_used_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_runner_tokens_is_revoked"),
        "runner_tokens",
        ["is_revoked"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # runners — fleet registry
    # ------------------------------------------------------------------
    op.create_table(
        "runners",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column(
            "capabilities",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "server_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "restate_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "restate_healthy",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'offline'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("runner_token_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("runners_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["runner_token_id"],
            ["runner_tokens.id"],
            name=op.f("runners_runner_token_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("runners_pkey")),
    )
    op.create_index(
        op.f("ix_runners_user_id"), "runners", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_runners_status"), "runners", ["status"], unique=False
    )
    op.create_index(
        op.f("ix_runners_runner_token_id"),
        "runners",
        ["runner_token_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_runners_runner_token_id"), table_name="runners")
    op.drop_index(op.f("ix_runners_status"), table_name="runners")
    op.drop_index(op.f("ix_runners_user_id"), table_name="runners")
    op.drop_table("runners")

    op.drop_index(op.f("ix_runner_tokens_is_revoked"), table_name="runner_tokens")
    op.drop_index(op.f("ix_runner_tokens_last_used_at"), table_name="runner_tokens")
    op.drop_index(op.f("ix_runner_tokens_token_hash"), table_name="runner_tokens")
    op.drop_index(op.f("ix_runner_tokens_user_id"), table_name="runner_tokens")
    op.drop_table("runner_tokens")
