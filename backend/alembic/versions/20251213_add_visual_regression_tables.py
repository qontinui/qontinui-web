"""add_visual_regression_tables

Revision ID: 20251213_visual_regression
Revises: a8db8ecc8fa0
Create Date: 2025-12-13

This migration adds tables for visual regression testing:
- visual_baselines: Stores approved baseline screenshots per state
- visual_comparison_results: Stores comparison results between screenshots and baselines

Also adds columns to test_screenshots for state_name and perceptual_hash.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '20251213_visual_regression'
down_revision: Union[str, None] = 'a8db8ecc8fa0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum types
    op.execute("""
        CREATE TYPE visualcomparisonstatus AS ENUM (
            'passed', 'failed', 'pending_review', 'approved_as_new', 'no_baseline'
        )
    """)
    op.execute("""
        CREATE TYPE reviewdecision AS ENUM (
            'approved', 'rejected', 'new_baseline'
        )
    """)

    # Create visual_baselines table
    op.create_table(
        'visual_baselines',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('state_name', sa.String(length=500), nullable=False),
        sa.Column('workflow_id', sa.String(length=500), nullable=True),
        sa.Column('storage_path', sa.String(length=1000), nullable=False),
        sa.Column('thumbnail_path', sa.String(length=1000), nullable=True),
        sa.Column('width', sa.Integer(), nullable=False),
        sa.Column('height', sa.Integer(), nullable=False),
        sa.Column('file_size_bytes', sa.Integer(), nullable=True),
        sa.Column('perceptual_hash', sa.String(length=256), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approval_notes', sa.Text(), nullable=True),
        sa.Column('comparison_settings', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('source_test_run_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('source_screenshot_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_test_run_id'], ['software_test_runs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_screenshot_id'], ['test_screenshots.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for visual_baselines
    op.create_index('ix_visual_baselines_project_id', 'visual_baselines', ['project_id'], unique=False)
    op.create_index('ix_visual_baselines_state_name', 'visual_baselines', ['state_name'], unique=False)
    op.create_index('ix_visual_baselines_workflow_id', 'visual_baselines', ['workflow_id'], unique=False)
    op.create_index('ix_visual_baselines_is_active', 'visual_baselines', ['is_active'], unique=False)
    op.create_index('ix_visual_baselines_perceptual_hash', 'visual_baselines', ['perceptual_hash'], unique=False)
    op.create_index('ix_visual_baselines_approved_by_user_id', 'visual_baselines', ['approved_by_user_id'], unique=False)
    # Composite index for looking up active baseline by state
    op.create_index(
        'ix_visual_baselines_project_state_active',
        'visual_baselines',
        ['project_id', 'state_name', 'is_active'],
        unique=False
    )

    # Create visual_comparison_results table
    op.create_table(
        'visual_comparison_results',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('test_run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('baseline_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('screenshot_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('transition_execution_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('state_name', sa.String(length=500), nullable=False),
        sa.Column('comparison_algorithm', sa.String(length=50), nullable=False),
        sa.Column('similarity_score', sa.Float(), nullable=False),
        sa.Column('threshold_used', sa.Float(), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('passed', 'failed', 'pending_review', 'approved_as_new', 'no_baseline', name='visualcomparisonstatus', create_type=False),
            nullable=False
        ),
        sa.Column('diff_image_path', sa.String(length=1000), nullable=True),
        sa.Column('diff_regions', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('execution_time_ms', sa.Integer(), nullable=True),
        sa.Column('reviewed_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'review_decision',
            postgresql.ENUM('approved', 'rejected', 'new_baseline', name='reviewdecision', create_type=False),
            nullable=True
        ),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('deficiency_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['test_run_id'], ['software_test_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['baseline_id'], ['visual_baselines.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['screenshot_id'], ['test_screenshots.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['transition_execution_id'], ['transition_executions.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['reviewed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['deficiency_id'], ['test_deficiencies.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for visual_comparison_results
    op.create_index('ix_visual_comparison_results_test_run_id', 'visual_comparison_results', ['test_run_id'], unique=False)
    op.create_index('ix_visual_comparison_results_baseline_id', 'visual_comparison_results', ['baseline_id'], unique=False)
    op.create_index('ix_visual_comparison_results_screenshot_id', 'visual_comparison_results', ['screenshot_id'], unique=False)
    op.create_index('ix_visual_comparison_results_state_name', 'visual_comparison_results', ['state_name'], unique=False)
    op.create_index('ix_visual_comparison_results_status', 'visual_comparison_results', ['status'], unique=False)
    op.create_index('ix_visual_comparison_results_reviewed_by_user_id', 'visual_comparison_results', ['reviewed_by_user_id'], unique=False)
    op.create_index('ix_visual_comparison_results_deficiency_id', 'visual_comparison_results', ['deficiency_id'], unique=False)

    # Add columns to test_screenshots for visual regression support
    op.add_column('test_screenshots', sa.Column('state_name', sa.String(length=500), nullable=True))
    op.add_column('test_screenshots', sa.Column('perceptual_hash', sa.String(length=256), nullable=True))
    op.create_index('ix_test_screenshots_state_name', 'test_screenshots', ['state_name'], unique=False)
    op.create_index('ix_test_screenshots_perceptual_hash', 'test_screenshots', ['perceptual_hash'], unique=False)


def downgrade() -> None:
    # Drop indexes from test_screenshots
    op.drop_index('ix_test_screenshots_perceptual_hash', table_name='test_screenshots')
    op.drop_index('ix_test_screenshots_state_name', table_name='test_screenshots')

    # Drop columns from test_screenshots
    op.drop_column('test_screenshots', 'perceptual_hash')
    op.drop_column('test_screenshots', 'state_name')

    # Drop indexes from visual_comparison_results
    op.drop_index('ix_visual_comparison_results_deficiency_id', table_name='visual_comparison_results')
    op.drop_index('ix_visual_comparison_results_reviewed_by_user_id', table_name='visual_comparison_results')
    op.drop_index('ix_visual_comparison_results_status', table_name='visual_comparison_results')
    op.drop_index('ix_visual_comparison_results_state_name', table_name='visual_comparison_results')
    op.drop_index('ix_visual_comparison_results_screenshot_id', table_name='visual_comparison_results')
    op.drop_index('ix_visual_comparison_results_baseline_id', table_name='visual_comparison_results')
    op.drop_index('ix_visual_comparison_results_test_run_id', table_name='visual_comparison_results')

    # Drop visual_comparison_results table
    op.drop_table('visual_comparison_results')

    # Drop indexes from visual_baselines
    op.drop_index('ix_visual_baselines_project_state_active', table_name='visual_baselines')
    op.drop_index('ix_visual_baselines_approved_by_user_id', table_name='visual_baselines')
    op.drop_index('ix_visual_baselines_perceptual_hash', table_name='visual_baselines')
    op.drop_index('ix_visual_baselines_is_active', table_name='visual_baselines')
    op.drop_index('ix_visual_baselines_workflow_id', table_name='visual_baselines')
    op.drop_index('ix_visual_baselines_state_name', table_name='visual_baselines')
    op.drop_index('ix_visual_baselines_project_id', table_name='visual_baselines')

    # Drop visual_baselines table
    op.drop_table('visual_baselines')

    # Drop enum types
    op.execute('DROP TYPE IF EXISTS reviewdecision')
    op.execute('DROP TYPE IF EXISTS visualcomparisonstatus')
