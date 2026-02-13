"""Add semantic search embedding columns.

This migration adds pgvector Vector(384) columns for MiniLM-L6-v2
embeddings to enable semantic search across execution issues and
domain knowledge.

Columns added:
- execution_issues: title_embedding, description_embedding, resolution_embedding
- domain_knowledge: content_embedding

Revision ID: b5c6d7e8f9a0
Revises: 32dc4690e6b5
Create Date: 2026-02-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c6d7e8f9a0"
down_revision: str | None = "32dc4690e6b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Ensure pgvector extension exists
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Add embedding columns to execution_issues
    op.add_column(
        "execution_issues",
        sa.Column(
            "title_embedding",
            Vector(384),
            nullable=True,
            comment="384-dim MiniLM embedding of the issue title",
        ),
    )
    op.add_column(
        "execution_issues",
        sa.Column(
            "description_embedding",
            Vector(384),
            nullable=True,
            comment="384-dim MiniLM embedding of the issue description",
        ),
    )
    op.add_column(
        "execution_issues",
        sa.Column(
            "resolution_embedding",
            Vector(384),
            nullable=True,
            comment="384-dim MiniLM embedding of the resolution notes",
        ),
    )

    # Add embedding column to domain_knowledge
    op.add_column(
        "domain_knowledge",
        sa.Column(
            "content_embedding",
            Vector(384),
            nullable=True,
            comment="384-dim MiniLM embedding of the knowledge content",
        ),
    )

    # Create IVFFlat indexes for fast similarity search
    # These require at least ~100 rows to be effective; they will
    # gracefully degrade to sequential scan on small tables
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_execution_issues_title_embedding "
        "ON execution_issues USING ivfflat (title_embedding vector_cosine_ops) "
        "WITH (lists = 10)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_execution_issues_description_embedding "
        "ON execution_issues USING ivfflat (description_embedding vector_cosine_ops) "
        "WITH (lists = 10)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_domain_knowledge_content_embedding "
        "ON domain_knowledge USING ivfflat (content_embedding vector_cosine_ops) "
        "WITH (lists = 10)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_domain_knowledge_content_embedding")
    op.execute("DROP INDEX IF EXISTS ix_execution_issues_description_embedding")
    op.execute("DROP INDEX IF EXISTS ix_execution_issues_title_embedding")

    op.drop_column("domain_knowledge", "content_embedding")
    op.drop_column("execution_issues", "resolution_embedding")
    op.drop_column("execution_issues", "description_embedding")
    op.drop_column("execution_issues", "title_embedding")
