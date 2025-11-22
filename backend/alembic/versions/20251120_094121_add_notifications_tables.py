"""add_notifications_tables

Revision ID: 20251120_094121
Revises: 47c77a22852f
Create Date: 2025-11-20 09:41:21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20251120_094121'
down_revision: Union[str, None] = '47c77a22852f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create notifications and notification_preferences tables."""

    # Check if enum exists and drop/recreate to avoid conflicts
    conn = op.get_bind()
    result = conn.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'notificationtype'"))
    enum_exists = result.fetchone() is not None

    if enum_exists:
        print("⚠️  notificationtype enum already exists, dropping and recreating")
        op.execute("DROP TYPE IF EXISTS notificationtype CASCADE")

    # Create notification_type enum
    op.execute("""
        CREATE TYPE notificationtype AS ENUM (
            'mention', 'share', 'comment', 'reply', 'lock_released',
            'project_update', 'team_invite', 'access_granted', 'access_revoked'
        )
    """)

    # Check if table exists
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'notifications' not in existing_tables:
        # Create notifications table
        op.create_table(
        'notifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('type', sa.Enum('mention', 'share', 'comment', 'reply', 'lock_released', 'project_update', 'team_invite', 'access_granted', 'access_revoked', name='notificationtype', create_type=False), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('resource_type', sa.String(), nullable=True),
        sa.Column('resource_id', sa.String(), nullable=True),
        sa.Column('actor_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('read', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.Column('metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
            sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )

        # Create indexes for notifications
        op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])
        op.create_index('ix_notifications_type', 'notifications', ['type'])
        op.create_index('ix_notifications_project_id', 'notifications', ['project_id'])
        op.create_index('ix_notifications_read', 'notifications', ['read'])
        op.create_index('ix_notifications_created_at', 'notifications', ['created_at'])
    else:
        print("⚠️  notifications table already exists, skipping creation")

    if 'notification_preferences' not in existing_tables:
        # Create notification_preferences table
        op.create_table(
        'notification_preferences',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email_mentions', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('email_comments', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('email_shares', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('email_replies', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('email_team_invites', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_app_mentions', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_app_comments', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_app_shares', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_app_replies', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_app_team_invites', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('in_app_project_updates', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id')
        )
    else:
        print("⚠️  notification_preferences table already exists, skipping creation")


def downgrade() -> None:
    """Drop notifications and notification_preferences tables."""
    op.drop_table('notification_preferences')
    op.drop_index('ix_notifications_created_at', table_name='notifications')
    op.drop_index('ix_notifications_read', table_name='notifications')
    op.drop_index('ix_notifications_project_id', table_name='notifications')
    op.drop_index('ix_notifications_type', table_name='notifications')
    op.drop_index('ix_notifications_user_id', table_name='notifications')
    op.drop_table('notifications')
    op.execute('DROP TYPE notificationtype')
