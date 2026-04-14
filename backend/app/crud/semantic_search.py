"""CRUD operations for cross-entity semantic search.

Provides pgvector-based cosine similarity search across multiple entity types
(execution issues, domain knowledge, project embeddings).
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.execution_issue import ExecutionIssue
from app.models.project_embedding import ProjectEmbedding
from app.models.ui_bridge_state import DomainKnowledge


async def search_execution_issues(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int = 20,
    min_similarity: float = 0.5,
    project_id: UUID | None = None,
    status_filter: str | None = None,
    severity_filter: str | None = None,
) -> list[tuple[ExecutionIssue, float]]:
    """Search execution issues by semantic similarity.

    Searches across title_embedding and description_embedding columns,
    taking the maximum similarity between the two.

    Args:
        db: Database session
        query_embedding: 384-dimensional MiniLM query embedding
        limit: Max results
        min_similarity: Minimum cosine similarity threshold (0-1)
        project_id: Optional project ID filter (via run -> project)
        status_filter: Optional issue status filter
        severity_filter: Optional severity filter

    Returns:
        List of (issue, similarity_score) tuples ordered by similarity desc
    """
    # Use title_embedding for primary similarity ranking
    # (title is more concise and usually more semantically meaningful)
    title_sim = (
        1 - ExecutionIssue.title_embedding.cosine_distance(query_embedding)
    ).label("similarity")

    filters = [
        ExecutionIssue.title_embedding.is_not(None),
        title_sim >= min_similarity,
    ]

    if status_filter:
        filters.append(ExecutionIssue.status == status_filter)
    if severity_filter:
        filters.append(ExecutionIssue.severity == severity_filter)

    query = (
        select(ExecutionIssue, title_sim)
        .where(*filters)
        .order_by(title_sim.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()
    return [(row[0], float(row[1])) for row in rows]


async def search_domain_knowledge(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int = 20,
    min_similarity: float = 0.5,
    project_id: UUID | None = None,
) -> list[tuple[DomainKnowledge, float]]:
    """Search domain knowledge by semantic similarity.

    Args:
        db: Database session
        query_embedding: 384-dimensional MiniLM query embedding
        limit: Max results
        min_similarity: Minimum cosine similarity threshold (0-1)
        project_id: Optional project ID filter

    Returns:
        List of (knowledge, similarity_score) tuples ordered by similarity desc
    """
    similarity = (
        1 - DomainKnowledge.content_embedding.cosine_distance(query_embedding)
    ).label("similarity")

    filters = [
        DomainKnowledge.content_embedding.is_not(None),
        similarity >= min_similarity,
    ]

    if project_id:
        filters.append(DomainKnowledge.project_id == project_id)

    query = (
        select(DomainKnowledge, similarity)
        .where(*filters)
        .order_by(similarity.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()
    return [(row[0], float(row[1])) for row in rows]


async def search_project_embeddings(
    db: AsyncSession,
    query_embedding: list[float],
    limit: int = 20,
    min_similarity: float = 0.5,
    project_id: UUID | None = None,
) -> list[tuple[ProjectEmbedding, float]]:
    """Search project embeddings by text embedding similarity.

    Uses the text_embedding (384-dim MiniLM) column, NOT the image embedding.

    Args:
        db: Database session
        query_embedding: 384-dimensional MiniLM query embedding
        limit: Max results
        min_similarity: Minimum cosine similarity threshold (0-1)
        project_id: Optional project ID filter

    Returns:
        List of (embedding, similarity_score) tuples ordered by similarity desc
    """
    similarity = (
        1 - ProjectEmbedding.text_embedding.cosine_distance(query_embedding)
    ).label("similarity")

    filters = [
        ProjectEmbedding.text_embedding.is_not(None),
        similarity >= min_similarity,
    ]

    if project_id:
        filters.append(ProjectEmbedding.project_id == project_id)

    query = (
        select(ProjectEmbedding, similarity)
        .where(*filters)
        .order_by(similarity.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()
    return [(row[0], float(row[1])) for row in rows]
