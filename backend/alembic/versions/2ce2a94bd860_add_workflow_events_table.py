"""add workflow_events table

Revision ID: 2ce2a94bd860
Revises: z2a3b4c5d6e7
Create Date: 2026-04-05 22:36:19.961612

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "2ce2a94bd860"
down_revision: Union[str, None] = "z2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_events",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("runner_name", sa.String(length=255), nullable=False),
        sa.Column("run_id", sa.String(length=255), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "seen", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_events_id"), "workflow_events", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_events_user_id"), "workflow_events", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_events_event_type"),
        "workflow_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_events_device_id"),
        "workflow_events",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_events_run_id"), "workflow_events", ["run_id"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_events_seen"), "workflow_events", ["seen"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_workflow_events_seen"), table_name="workflow_events")
    op.drop_index(op.f("ix_workflow_events_run_id"), table_name="workflow_events")
    op.drop_index(op.f("ix_workflow_events_device_id"), table_name="workflow_events")
    op.drop_index(op.f("ix_workflow_events_event_type"), table_name="workflow_events")
    op.drop_index(op.f("ix_workflow_events_user_id"), table_name="workflow_events")
    op.drop_index(op.f("ix_workflow_events_id"), table_name="workflow_events")
    op.drop_table("workflow_events")
