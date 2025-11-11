"""add_multi_screenshot_support

Revision ID: 4f8e9b2d3c5a
Revises: 8d5f2a3c1b9e
Create Date: 2025-11-11 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "4f8e9b2d3c5a"
down_revision: str | None = "8d5f2a3c1b9e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add multi-screenshot support to annotation sets and annotations"""

    # Add screenshots JSON column to annotation_sets
    # This is nullable for backward compatibility
    op.add_column(
        "annotation_sets",
        sa.Column("screenshots", JSONB, nullable=True)
    )

    # Add screenshot_index column to annotations
    # Default to 0 for backward compatibility with single-screenshot sets
    op.add_column(
        "annotations",
        sa.Column("screenshot_index", sa.Integer(), nullable=False, server_default="0")
    )

    # Create index on screenshot_index for efficient queries
    op.create_index(
        "ix_annotations_screenshot_index",
        "annotations",
        ["screenshot_index"]
    )

    # Create composite index for efficient queries by annotation_set_id and screenshot_index
    op.create_index(
        "ix_annotations_set_screenshot",
        "annotations",
        ["annotation_set_id", "screenshot_index"]
    )

    # Populate screenshots JSON from existing single-screenshot data
    # This migrates existing data to the new multi-screenshot format
    op.execute("""
        UPDATE annotation_sets
        SET screenshots = jsonb_build_array(
            jsonb_build_object(
                'name', screenshot_name,
                'url', screenshot_url,
                'width', image_width,
                'height', image_height
            )
        )
        WHERE screenshots IS NULL
    """)


def downgrade() -> None:
    """Remove multi-screenshot support"""

    # Drop composite index
    op.drop_index("ix_annotations_set_screenshot", table_name="annotations")

    # Drop screenshot_index index
    op.drop_index("ix_annotations_screenshot_index", table_name="annotations")

    # Drop screenshot_index column
    op.drop_column("annotations", "screenshot_index")

    # Drop screenshots column
    op.drop_column("annotation_sets", "screenshots")
