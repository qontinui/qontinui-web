"""add_image_variants_metadata

Revision ID: 20251119_225834
Revises: 675031faaab9
Create Date: 2025-11-19 22:58:34.000000

This migration adds a metadata JSONB column to the storage_usage table
to store image variant paths (thumbnails, previews, etc.) and related
metadata for efficient image serving and storage optimization.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20251119_225834"
down_revision: Union[str, None] = "675031faaab9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add metadata JSONB column to storage_usage table for image variants."""
    # Add metadata JSONB column to store image variant paths
    op.add_column(
        "storage_usage",
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    # Add GIN index for faster metadata queries
    # GIN indexes are optimal for JSONB columns with containment queries
    op.create_index(
        "ix_storage_usage_metadata_gin",
        "storage_usage",
        ["metadata"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    """Remove metadata column and index from storage_usage table."""
    # Drop index first
    op.drop_index("ix_storage_usage_metadata_gin", table_name="storage_usage")

    # Drop metadata column
    op.drop_column("storage_usage", "metadata")
