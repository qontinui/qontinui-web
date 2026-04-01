"""add_ui_bridge_exploration_sessions_table

Revision ID: 796396a4de25
Revises: e07a6d62e09f
Create Date: 2026-02-01 14:57:46.378935

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "796396a4de25"
down_revision: Union[str, None] = "e07a6d62e09f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create ui_bridge_exploration_sessions table.

    Stores exploration session data including render logs so they can be
    recovered after page reloads or browser crashes.
    """
    op.create_table(
        "ui_bridge_exploration_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="running"),
        sa.Column(
            "target_type", sa.String(50), nullable=False, server_default="extension"
        ),
        sa.Column("target_url", sa.String(2048), nullable=True),
        sa.Column(
            "exploration_config",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "render_logs",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "elements_discovered", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "elements_explored", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("render_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "discovery_completed", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column(
            "saved_config_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_exploration_sessions_project_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["saved_config_id"],
            ["ui_bridge_state_configs.id"],
            name="fk_exploration_sessions_saved_config_id",
            ondelete="SET NULL",
        ),
    )

    # Create indexes
    op.create_index(
        "ix_exploration_sessions_project_id",
        "ui_bridge_exploration_sessions",
        ["project_id"],
    )
    op.create_index(
        "ix_exploration_sessions_status",
        "ui_bridge_exploration_sessions",
        ["status"],
    )
    op.create_index(
        "ix_exploration_sessions_created_at",
        "ui_bridge_exploration_sessions",
        ["created_at"],
    )


def downgrade() -> None:
    """Drop ui_bridge_exploration_sessions table."""
    op.drop_index(
        "ix_exploration_sessions_created_at",
        table_name="ui_bridge_exploration_sessions",
    )
    op.drop_index(
        "ix_exploration_sessions_status",
        table_name="ui_bridge_exploration_sessions",
    )
    op.drop_index(
        "ix_exploration_sessions_project_id",
        table_name="ui_bridge_exploration_sessions",
    )
    op.drop_table("ui_bridge_exploration_sessions")
