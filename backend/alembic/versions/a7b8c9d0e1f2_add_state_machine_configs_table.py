"""Add state machine configs table

Revision ID: a7b8c9d0e1f2
Revises: 9c38e4b3c285
Create Date: 2026-02-07 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "9c38e4b3c285"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "state_machine_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.String(), nullable=False, server_default="1.0.0"),
        sa.Column("configuration", sa.JSON(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_state_machine_configs_id"),
        "state_machine_configs",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_state_machine_configs_project_id"),
        "state_machine_configs",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_state_machine_configs_created_by"),
        "state_machine_configs",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        op.f("ix_state_machine_configs_name"),
        "state_machine_configs",
        ["name"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_state_machine_configs_name"),
        table_name="state_machine_configs",
    )
    op.drop_index(
        op.f("ix_state_machine_configs_created_by"),
        table_name="state_machine_configs",
    )
    op.drop_index(
        op.f("ix_state_machine_configs_project_id"),
        table_name="state_machine_configs",
    )
    op.drop_index(
        op.f("ix_state_machine_configs_id"),
        table_name="state_machine_configs",
    )
    op.drop_table("state_machine_configs")
