"""add_user_metadata_to_template_candidates

Revision ID: 9c38e4b3c285
Revises: e53b8e5dccef
Create Date: 2026-02-02 08:28:58.679630

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c38e4b3c285"
down_revision: Union[str, None] = "e53b8e5dccef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add user_metadata column to template_candidates table
    op.add_column(
        "template_candidates", sa.Column("user_metadata", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    # Remove user_metadata column from template_candidates table
    op.drop_column("template_candidates", "user_metadata")
