"""add ui_bridge_state tables for state discovery persistence

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-01-23 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6g7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create UI Bridge state discovery tables.

    These tables store discovered states from UI Bridge render logs:
    - ui_bridge_state_configs: Configuration for a discovery session
    - ui_bridge_states: Individual discovered states with element groupings
    - domain_knowledge: Reusable knowledge entries
    - ui_bridge_state_domain_knowledge: Association table for states and knowledge
    """
    # UI Bridge State Configs table
    op.create_table(
        "ui_bridge_state_configs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False, server_default="default"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("render_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("element_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "include_html_ids", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column(
            "discovery_result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ui_bridge_state_configs_project_id",
        "ui_bridge_state_configs",
        ["project_id"],
    )

    # UI Bridge States table
    op.create_table(
        "ui_bridge_states",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("config_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state_id", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "element_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "render_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.9"),
        sa.Column(
            "acceptance_criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "extra_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["config_id"],
            ["ui_bridge_state_configs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ui_bridge_states_config_id",
        "ui_bridge_states",
        ["config_id"],
    )

    # Domain Knowledge table
    op.create_table(
        "domain_knowledge",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),  # Nullable for global knowledge
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_domain_knowledge_project_id",
        "domain_knowledge",
        ["project_id"],
    )

    # Association table: UI Bridge State <-> Domain Knowledge
    op.create_table(
        "ui_bridge_state_domain_knowledge",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("state_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("knowledge_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["state_id"],
            ["ui_bridge_states.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_id"],
            ["domain_knowledge.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ui_bridge_state_domain_knowledge_state_id",
        "ui_bridge_state_domain_knowledge",
        ["state_id"],
    )
    op.create_index(
        "ix_ui_bridge_state_domain_knowledge_knowledge_id",
        "ui_bridge_state_domain_knowledge",
        ["knowledge_id"],
    )


def downgrade() -> None:
    """Drop UI Bridge state discovery tables."""
    op.drop_index(
        "ix_ui_bridge_state_domain_knowledge_knowledge_id",
        table_name="ui_bridge_state_domain_knowledge",
    )
    op.drop_index(
        "ix_ui_bridge_state_domain_knowledge_state_id",
        table_name="ui_bridge_state_domain_knowledge",
    )
    op.drop_table("ui_bridge_state_domain_knowledge")
    op.drop_index("ix_domain_knowledge_project_id", table_name="domain_knowledge")
    op.drop_table("domain_knowledge")
    op.drop_index("ix_ui_bridge_states_config_id", table_name="ui_bridge_states")
    op.drop_table("ui_bridge_states")
    op.drop_index(
        "ix_ui_bridge_state_configs_project_id", table_name="ui_bridge_state_configs"
    )
    op.drop_table("ui_bridge_state_configs")
