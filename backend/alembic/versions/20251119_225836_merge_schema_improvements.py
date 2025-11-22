"""merge_schema_improvements

Revision ID: 20251119_225836
Revises: 20251119_225835, cca9ba33dd5c
Create Date: 2025-11-19 22:58:36.000000

Merges two parallel migration branches:
- 20251119_225835: Schema improvements (metadata field, duplicate index fixes, type fixes)
- cca9ba33dd5c: Runner token and connection models
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20251119_225836"
down_revision: Union[str, None] = ("20251119_225835", "cca9ba33dd5c")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge migration - no changes needed."""
    pass


def downgrade() -> None:
    """Merge migration - no changes needed."""
    pass
