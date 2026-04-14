"""add_recording_sessions_table

Revision ID: y1z2a3b4c5d6
Revises: x0y1z2a3b4d6
Create Date: 2026-03-31

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "y1z2a3b4c5d6"
down_revision: Union[str, None] = "x0y1z2a3b4d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create recording_sessions table for experience memory."""
    op.create_table(
        "recording_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(100), nullable=False),
        sa.Column("app_name", sa.String(255), nullable=True),
        sa.Column("app_url", sa.String(2048), nullable=True),
        sa.Column("app_domain", sa.String(255), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "interaction_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("capture_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transition_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("variable_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_confidence", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column(
            "export_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "variables",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("playbook_content", sa.Text(), nullable=True),
        sa.Column("state_config_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["state_config_id"],
            ["ui_bridge_state_configs.id"],
            ondelete="SET NULL",
        ),
    )
    # Indexes for experience retrieval
    op.create_index(
        "ix_recording_sessions_project_id",
        "recording_sessions",
        ["project_id"],
    )
    op.create_index(
        "ix_recording_sessions_app_domain",
        "recording_sessions",
        ["app_domain"],
    )
    op.create_index(
        "ix_recording_sessions_app_name",
        "recording_sessions",
        ["app_name"],
    )


def downgrade() -> None:
    """Drop recording_sessions table."""
    op.drop_index("ix_recording_sessions_app_name", table_name="recording_sessions")
    op.drop_index("ix_recording_sessions_app_domain", table_name="recording_sessions")
    op.drop_index("ix_recording_sessions_project_id", table_name="recording_sessions")
    op.drop_table("recording_sessions")
