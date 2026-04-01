"""merge_training_jobs_and_element_annotations

Revision ID: e07a6d62e09f
Revises: c4d5e6f7g8h9, d4e5f6g7h8i9
Create Date: 2026-02-01 14:56:34.703445

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e07a6d62e09f"
down_revision: Union[str, None] = ("c4d5e6f7g8h9", "d4e5f6g7h8i9")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
