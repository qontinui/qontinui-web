"""add_file_metadata_to_storage_usage

Revision ID: 47c77a22852f
Revises: 20251119_225836
Create Date: 2025-11-19 23:04:06.218277

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '47c77a22852f'
down_revision: Union[str, None] = '20251119_225836'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add file_metadata column to storage_usage table
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('storage_usage')]

    if 'file_metadata' not in columns:
        op.add_column(
            'storage_usage',
            sa.Column('file_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True)
        )
    else:
        print("⚠️  file_metadata column already exists in storage_usage, skipping")


def downgrade() -> None:
    # Remove file_metadata column from storage_usage table
    op.drop_column('storage_usage', 'file_metadata')
