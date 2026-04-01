"""add_vision_results_to_extraction_annotations

Revision ID: 1fbc4578ea71
Revises: g3h4i5j6k7l8
Create Date: 2026-01-06 19:13:30.493887

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1fbc4578ea71"
down_revision: Union[str, None] = "g3h4i5j6k7l8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add vision_results column to extraction_annotations table
    op.add_column(
        "extraction_annotations", sa.Column("vision_results", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    # Remove vision_results column
    op.drop_column("extraction_annotations", "vision_results")
