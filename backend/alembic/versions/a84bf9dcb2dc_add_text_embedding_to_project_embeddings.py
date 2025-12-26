"""add_text_embedding_to_project_embeddings

Revision ID: a84bf9dcb2dc
Revises: f8cf90bc39a9
Create Date: 2025-12-25 22:26:19.587284

"""

from typing import Sequence, Union

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a84bf9dcb2dc"
down_revision: Union[str, None] = "f8cf90bc39a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add text_embedding column (384 dimensions for all-MiniLM-L6-v2)
    op.add_column(
        "project_embeddings",
        sa.Column("text_embedding", Vector(384), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_embeddings", "text_embedding")
