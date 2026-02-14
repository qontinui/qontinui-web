"""Add semantic search embedding columns.

This migration adds pgvector Vector(384) columns for MiniLM-L6-v2
embeddings to enable semantic search across execution issues and
domain knowledge.

Columns added (conditional on table existence):
- execution_issues: title_embedding, description_embedding, resolution_embedding
- domain_knowledge: content_embedding

Note: Both tables may not exist at this point in the migration chain.
- execution_issues was never created (planned for future migration)
- domain_knowledge is created later by abce1e18f1a1
Operations are guarded with table/column existence checks so the
migration is safe to run regardless of current schema state.

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


def _table_exists(table_name: str) -> bool:
    """Check if a table exists in the current database."""
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.tables "
            "  WHERE table_schema = 'public' AND table_name = :tbl"
            ")"
        ),
        {"tbl": table_name},
    )
    return result.scalar()


def _column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists on a table in the current database."""
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM information_schema.columns "
            "  WHERE table_schema = 'public' "
            "    AND table_name = :tbl "
            "    AND column_name = :col"
            ")"
        ),
        {"tbl": table_name, "col": column_name},
    )
    return result.scalar()


def upgrade() -> None:
    # Ensure pgvector extension exists
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Add embedding columns to execution_issues (only if table exists)
    if _table_exists("execution_issues"):
        if not _column_exists("execution_issues", "title_embedding"):
            op.add_column(
                "execution_issues",
                sa.Column(
                    "title_embedding",
                    Vector(384),
                    nullable=True,
                    comment="384-dim MiniLM embedding of the issue title",
                ),
            )
        if not _column_exists("execution_issues", "description_embedding"):
            op.add_column(
                "execution_issues",
                sa.Column(
                    "description_embedding",
                    Vector(384),
                    nullable=True,
                    comment="384-dim MiniLM embedding of the issue description",
                ),
            )
        if not _column_exists("execution_issues", "resolution_embedding"):
            op.add_column(
                "execution_issues",
                sa.Column(
                    "resolution_embedding",
                    Vector(384),
                    nullable=True,
                    comment="384-dim MiniLM embedding of the resolution notes",
                ),
            )

        # Create IVFFlat indexes for fast similarity search on execution_issues
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

    # Add embedding column to domain_knowledge (only if table exists)
    # Note: domain_knowledge may be created by a later migration (abce1e18f1a1),
    # which also adds content_embedding. Skip if table or column doesn't exist yet.
    if _table_exists("domain_knowledge"):
        if not _column_exists("domain_knowledge", "content_embedding"):
            op.add_column(
                "domain_knowledge",
                sa.Column(
                    "content_embedding",
                    Vector(384),
                    nullable=True,
                    comment="384-dim MiniLM embedding of the knowledge content",
                ),
            )

        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_domain_knowledge_content_embedding "
            "ON domain_knowledge USING ivfflat (content_embedding vector_cosine_ops) "
            "WITH (lists = 10)"
        )


def downgrade() -> None:
    # Drop indexes unconditionally (IF EXISTS handles missing cases)
    op.execute("DROP INDEX IF EXISTS ix_domain_knowledge_content_embedding")
    op.execute("DROP INDEX IF EXISTS ix_execution_issues_description_embedding")
    op.execute("DROP INDEX IF EXISTS ix_execution_issues_title_embedding")

    # Drop columns only if their tables exist
    if _table_exists("domain_knowledge") and _column_exists(
        "domain_knowledge", "content_embedding"
    ):
        op.drop_column("domain_knowledge", "content_embedding")

    if _table_exists("execution_issues"):
        if _column_exists("execution_issues", "resolution_embedding"):
            op.drop_column("execution_issues", "resolution_embedding")
        if _column_exists("execution_issues", "description_embedding"):
            op.drop_column("execution_issues", "description_embedding")
        if _column_exists("execution_issues", "title_embedding"):
            op.drop_column("execution_issues", "title_embedding")
