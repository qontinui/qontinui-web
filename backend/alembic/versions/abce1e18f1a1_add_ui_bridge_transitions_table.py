"""add ui bridge transitions table

Revision ID: abce1e18f1a1
Revises: b97e3bd6e0c7
Create Date: 2026-02-13 22:37:39.670164

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "abce1e18f1a1"
down_revision: str | None = "b97e3bd6e0c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ui_bridge_transitions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "config_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("transition_id", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("from_states", sa.JSON(), server_default="[]", nullable=False),
        sa.Column(
            "activate_states", sa.JSON(), server_default="[]", nullable=False
        ),
        sa.Column("exit_states", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("actions", sa.JSON(), server_default="[]", nullable=False),
        sa.Column(
            "path_cost", sa.Float(), nullable=False, server_default="1.0"
        ),
        sa.Column(
            "stays_visible", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column(
            "extra_metadata", sa.JSON(), server_default="{}", nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["config_id"],
            ["ui_bridge_state_configs.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_ui_bridge_transitions_config_id",
        "ui_bridge_transitions",
        ["config_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ui_bridge_transitions_config_id",
        table_name="ui_bridge_transitions",
    )
    op.drop_table("ui_bridge_transitions")
