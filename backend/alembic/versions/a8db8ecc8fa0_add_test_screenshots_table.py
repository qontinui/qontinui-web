"""add_test_screenshots_table

Revision ID: a8db8ecc8fa0
Revises: b36e13627683
Create Date: 2025-12-13 03:19:36.804365

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a8db8ecc8fa0'
down_revision: Union[str, None] = 'b36e13627683'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create test_screenshots table
    op.create_table(
        'test_screenshots',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('test_run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('transition_execution_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('deficiency_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            'screenshot_type',
            sa.Enum('STATE_VERIFICATION', 'ACTION_RESULT', 'FAILURE', 'BEFORE_ACTION', 'AFTER_ACTION', name='testscreenshottype'),
            nullable=False,
        ),
        sa.Column('storage_path', sa.String(length=1000), nullable=False),
        sa.Column('width', sa.Integer(), nullable=False),
        sa.Column('height', sa.Integer(), nullable=False),
        sa.Column('captured_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('screenshot_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['test_run_id'], ['software_test_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['transition_execution_id'], ['transition_executions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['deficiency_id'], ['test_deficiencies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes
    op.create_index(op.f('ix_test_screenshots_test_run_id'), 'test_screenshots', ['test_run_id'], unique=False)
    op.create_index(op.f('ix_test_screenshots_transition_execution_id'), 'test_screenshots', ['transition_execution_id'], unique=False)
    op.create_index(op.f('ix_test_screenshots_deficiency_id'), 'test_screenshots', ['deficiency_id'], unique=False)
    op.create_index(op.f('ix_test_screenshots_screenshot_type'), 'test_screenshots', ['screenshot_type'], unique=False)
    op.create_index(op.f('ix_test_screenshots_captured_at'), 'test_screenshots', ['captured_at'], unique=False)


def downgrade() -> None:
    # Drop indexes
    op.drop_index(op.f('ix_test_screenshots_captured_at'), table_name='test_screenshots')
    op.drop_index(op.f('ix_test_screenshots_screenshot_type'), table_name='test_screenshots')
    op.drop_index(op.f('ix_test_screenshots_deficiency_id'), table_name='test_screenshots')
    op.drop_index(op.f('ix_test_screenshots_transition_execution_id'), table_name='test_screenshots')
    op.drop_index(op.f('ix_test_screenshots_test_run_id'), table_name='test_screenshots')

    # Drop table
    op.drop_table('test_screenshots')

    # Drop enum type
    op.execute('DROP TYPE IF EXISTS testscreenshottype')
