"""add_text_description_to_project_embeddings

Revision ID: f8cf90bc39a9
Revises: 7931bff72fe5
Create Date: 2025-12-25 22:03:55.211441

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8cf90bc39a9"
down_revision: Union[str, None] = "7931bff72fe5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_embeddings",
        sa.Column("text_description", sa.String(1000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_embeddings", "text_description")
