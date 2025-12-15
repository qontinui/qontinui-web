"""add_thumbnail_s3_key_to_project_images

Revision ID: 010a31065d3e
Revises: e8a009465904
Create Date: 2025-12-08 04:28:55.628373

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "010a31065d3e"
down_revision: str | None = "e8a009465904"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add thumbnail_s3_key column to project_images table
    op.add_column(
        "project_images",
        sa.Column("thumbnail_s3_key", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    # Remove thumbnail_s3_key column from project_images table
    op.drop_column("project_images", "thumbnail_s3_key")
