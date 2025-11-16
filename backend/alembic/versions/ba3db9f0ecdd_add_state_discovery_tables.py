"""add_state_discovery_tables

Revision ID: ba3db9f0ecdd
Revises: d3e802f6be1b
Create Date: 2025-11-16 22:56:23.656338

This migration creates the state discovery infrastructure:
- discovered_states: Stores discovered application states from automation sessions
- state_transitions: Tracks transitions between states triggered by input events
- Adds state_discovery tracking fields to automation_sessions
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


# revision identifiers, used by Alembic.
revision: str = 'ba3db9f0ecdd'
down_revision: Union[str, None] = 'd3e802f6be1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create state discovery tables and add tracking fields to automation_sessions."""
    from sqlalchemy import inspect

    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    # Create discovered_states table (if it doesn't exist)
    if "discovered_states" not in existing_tables:
        op.create_table(
            "discovered_states",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
            sa.Column("session_id", UUID(as_uuid=True), nullable=False),
            sa.Column("state_id", sa.String(100), nullable=False),
            sa.Column("name", sa.String(255), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("metadata", JSONB, nullable=True, server_default="{}"),
            sa.Column("screenshot_ids", sa.ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"),
            sa.Column("state_images", JSONB, nullable=False, server_default="[]"),
            sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["session_id"], ["automation_sessions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("session_id", "state_id", name="uq_discovered_states_session_state"),
        )

        # Create indexes for discovered_states
        op.create_index(
            "idx_discovered_states_session",
            "discovered_states",
            ["session_id"],
        )

    # Create state_transitions table (if it doesn't exist)
    if "state_transitions" not in existing_tables:
        op.create_table(
            "state_transitions",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
            sa.Column("session_id", UUID(as_uuid=True), nullable=False),
            sa.Column("from_state_id", UUID(as_uuid=True), nullable=True),
            sa.Column("to_state_id", UUID(as_uuid=True), nullable=True),
            sa.Column("trigger_event_id", sa.BigInteger(), nullable=True),
            sa.Column("event_type", sa.String(50), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("timestamp", sa.TIMESTAMP(), nullable=False),
            sa.Column("metadata", JSONB, nullable=True, server_default="{}"),
            sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["session_id"], ["automation_sessions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["from_state_id"], ["discovered_states.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["to_state_id"], ["discovered_states.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["trigger_event_id"], ["automation_input_events.id"], ondelete="SET NULL"),
        )

        # Create indexes for state_transitions
        op.create_index(
            "idx_state_transitions_session",
            "state_transitions",
            ["session_id"],
        )
        op.create_index(
            "idx_state_transitions_from",
            "state_transitions",
            ["from_state_id"],
        )
        op.create_index(
            "idx_state_transitions_to",
            "state_transitions",
            ["to_state_id"],
        )
        op.create_index(
            "idx_state_transitions_trigger",
            "state_transitions",
            ["trigger_event_id"],
        )

    # Add state_discovery tracking fields to automation_sessions (if they don't exist)
    existing_columns = [col['name'] for col in inspector.get_columns('automation_sessions')]

    if 'state_discovery_status' not in existing_columns:
        op.add_column('automation_sessions', sa.Column('state_discovery_status', sa.String(50), nullable=True))

    if 'state_discovery_started_at' not in existing_columns:
        op.add_column('automation_sessions', sa.Column('state_discovery_started_at', sa.TIMESTAMP(), nullable=True))

    if 'state_discovery_completed_at' not in existing_columns:
        op.add_column('automation_sessions', sa.Column('state_discovery_completed_at', sa.TIMESTAMP(), nullable=True))

    if 'state_discovery_error' not in existing_columns:
        op.add_column('automation_sessions', sa.Column('state_discovery_error', sa.Text(), nullable=True))


def downgrade() -> None:
    """Drop state discovery tables and remove tracking fields from automation_sessions."""
    # Drop tables in reverse order (respecting foreign key constraints)
    op.drop_table("state_transitions")
    op.drop_table("discovered_states")

    # Remove columns from automation_sessions
    op.drop_column('automation_sessions', 'state_discovery_error')
    op.drop_column('automation_sessions', 'state_discovery_completed_at')
    op.drop_column('automation_sessions', 'state_discovery_started_at')
    op.drop_column('automation_sessions', 'state_discovery_status')
