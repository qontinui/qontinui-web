"""add push_devices table

Revision ID: 3df4b05ce971
Revises: 2ce2a94bd860
Create Date: 2026-04-06 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3df4b05ce971'
down_revision: Union[str, None] = '2ce2a94bd860'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'push_devices',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('push_token', sa.String(length=255), nullable=False),
        sa.Column('platform', sa.String(length=50), nullable=False, server_default='expo'),
        sa.Column('device_name', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_push_devices_id'), 'push_devices', ['id'], unique=False)
    op.create_index(op.f('ix_push_devices_user_id'), 'push_devices', ['user_id'], unique=False)
    op.create_index(op.f('ix_push_devices_push_token'), 'push_devices', ['push_token'], unique=True)
    op.create_index(op.f('ix_push_devices_is_active'), 'push_devices', ['is_active'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_push_devices_is_active'), table_name='push_devices')
    op.drop_index(op.f('ix_push_devices_push_token'), table_name='push_devices')
    op.drop_index(op.f('ix_push_devices_user_id'), table_name='push_devices')
    op.drop_index(op.f('ix_push_devices_id'), table_name='push_devices')
    op.drop_table('push_devices')
