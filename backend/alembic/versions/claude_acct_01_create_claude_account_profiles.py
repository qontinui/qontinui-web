"""create auth.claude_account_profiles

Revision ID: claude_acct_01
Revises: ptbe_01_primary_tree_branch_events
Create Date: 2026-09-11

Server-side roster of a user's Claude Code accounts (gmail, hotmail, ...),
so any runner paired to that user can fetch it (GET /api/v1/claude-accounts,
device-JWT authenticated) rather than relying on the OneDrive-synced
PowerShell profile or the git-tracked qontinui-claude-config/accounts.json
alone. See app/models/claude_account.py for field semantics.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "claude_acct_01"
down_revision = "ptbe_01_primary_tree_branch_events"
branch_labels = None
depends_on = None

_SCHEMA = "auth"
_TABLE = "claude_account_profiles"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("account_key", sa.String(100), nullable=False),
        sa.Column("shortcut", sa.String(20), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("dir_name", sa.String(200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "user_id", "account_key", name="uq_claude_account_profiles_user_key"
        ),
        sa.UniqueConstraint(
            "user_id", "shortcut", name="uq_claude_account_profiles_user_shortcut"
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_claude_account_profiles_user",
        _TABLE,
        ["user_id"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_claude_account_profiles_user", table_name=_TABLE, schema=_SCHEMA
    )
    op.drop_table(_TABLE, schema=_SCHEMA)
