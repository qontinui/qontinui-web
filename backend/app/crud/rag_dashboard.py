"""
CRUD operations for RAG Dashboard.

Provides database operations for querying project embeddings,
embedding generation jobs, and performing semantic search.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.embedding_generation_job import EmbeddingGenerationJob
from app.models.project_embedding import ProjectEmbedding


async def get_dashboard_stats(
    db: AsyncSession,
    project_id: UUID,
) -> dict[str, Any]:
    """
    Get summary statistics for RAG dashboard.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        Dictionary with stats: total_embeddings, total_states, total_patterns, etc.
    """
    # Count total embeddings
    total_embeddings_query = select(func.count(ProjectEmbedding.id)).where(
        ProjectEmbedding.project_id == project_id
    )
    result = await db.execute(total_embeddings_query)
    total_embeddings = result.scalar_one()

    # Count unique states
    unique_states_query = select(
        func.count(func.distinct(ProjectEmbedding.state_id))
    ).where(ProjectEmbedding.project_id == project_id)
    result = await db.execute(unique_states_query)
    total_states = result.scalar_one()

    # Count unique patterns
    unique_patterns_query = select(
        func.count(func.distinct(ProjectEmbedding.pattern_id))
    ).where(ProjectEmbedding.project_id == project_id)
    result = await db.execute(unique_patterns_query)
    total_patterns = result.scalar_one()

    # Get latest sync time (most recent embedding update)
    last_sync_query = select(func.max(ProjectEmbedding.updated_at)).where(
        ProjectEmbedding.project_id == project_id
    )
    result = await db.execute(last_sync_query)
    last_sync_at = result.scalar_one()

    # Get active job if any
    active_job_query = (
        select(EmbeddingGenerationJob)
        .where(
            EmbeddingGenerationJob.project_id == project_id,
            EmbeddingGenerationJob.status.in_(["pending", "in_progress"]),
        )
        .order_by(EmbeddingGenerationJob.created_at.desc())
        .limit(1)
    )
    result = await db.execute(active_job_query)
    active_job = result.scalar_one_or_none()

    return {
        "total_embeddings": total_embeddings,
        "total_states": total_states,
        "total_patterns": total_patterns,
        "last_sync_at": last_sync_at,
        "active_job": active_job,
    }


async def get_embeddings(
    db: AsyncSession,
    project_id: UUID,
    page: int = 1,
    limit: int = 20,
    state_filter: str | None = None,
) -> tuple[list[ProjectEmbedding], int]:
    """
    Get paginated list of embeddings for a project.

    Args:
        db: Database session
        project_id: Project ID
        page: Page number (1-indexed)
        limit: Items per page
        state_filter: Optional state ID to filter by

    Returns:
        Tuple of (list of embeddings, total count)
    """
    # Base query
    base_where = [ProjectEmbedding.project_id == project_id]

    if state_filter:
        base_where.append(ProjectEmbedding.state_id == state_filter)

    # Count query
    count_query = select(func.count(ProjectEmbedding.id)).where(*base_where)
    result = await db.execute(count_query)
    total = result.scalar_one()

    # Data query with pagination
    offset = (page - 1) * limit
    data_query = (
        select(ProjectEmbedding)
        .where(*base_where)
        .order_by(ProjectEmbedding.state_name, ProjectEmbedding.pattern_id)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(data_query)
    embeddings: list[ProjectEmbedding] = list(result.scalars().all())  # type: ignore[arg-type]

    return embeddings, total


async def get_jobs(
    db: AsyncSession,
    project_id: UUID,
    page: int = 1,
    limit: int = 20,
    status_filter: str | None = None,
) -> tuple[list[EmbeddingGenerationJob], int]:
    """
    Get paginated list of embedding generation jobs for a project.

    Args:
        db: Database session
        project_id: Project ID
        page: Page number (1-indexed)
        limit: Items per page
        status_filter: Optional status to filter by

    Returns:
        Tuple of (list of jobs, total count)
    """
    # Base query
    base_where = [EmbeddingGenerationJob.project_id == project_id]

    if status_filter:
        base_where.append(EmbeddingGenerationJob.status == status_filter)

    # Count query
    count_query = select(func.count(EmbeddingGenerationJob.id)).where(*base_where)
    result = await db.execute(count_query)
    total = result.scalar_one()

    # Data query with pagination
    offset = (page - 1) * limit
    data_query = (
        select(EmbeddingGenerationJob)
        .where(*base_where)
        .order_by(EmbeddingGenerationJob.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(data_query)
    jobs: list[EmbeddingGenerationJob] = list(result.scalars().all())  # type: ignore[arg-type]

    return jobs, total


async def semantic_search(
    db: AsyncSession,
    project_id: UUID,
    query_embedding: list[float],
    limit: int = 20,
    min_similarity: float = 0.5,
    state_filter: str | None = None,
) -> list[tuple[ProjectEmbedding, float]]:
    """
    Perform semantic search using pgvector.

    Args:
        db: Database session
        project_id: Project ID
        query_embedding: Query vector (512 dimensions for CLIP)
        limit: Max results to return
        min_similarity: Minimum similarity threshold (0-1)
        state_filter: Optional state ID to filter by

    Returns:
        List of (embedding, similarity_score) tuples
    """
    # Cosine similarity = 1 - cosine distance
    similarity = (
        1 - ProjectEmbedding.embedding.cosine_distance(query_embedding)
    ).label("similarity")

    # Base filters
    filters = [
        ProjectEmbedding.project_id == project_id,
        similarity >= min_similarity,
    ]

    if state_filter:
        filters.append(ProjectEmbedding.state_id == state_filter)

    # Query with similarity ordering
    query = (
        select(ProjectEmbedding, similarity)
        .where(*filters)
        .order_by(similarity.desc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()

    return [(row[0], row[1]) for row in rows]


async def get_unique_states(
    db: AsyncSession,
    project_id: UUID,
) -> list[dict[str, str | int]]:
    """
    Get list of unique states with embeddings for filter dropdown.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        List of dicts with state_id and state_name
    """
    query = (
        select(
            ProjectEmbedding.state_id,
            ProjectEmbedding.state_name,
            func.count(ProjectEmbedding.id).label("count"),
        )
        .where(ProjectEmbedding.project_id == project_id)
        .group_by(ProjectEmbedding.state_id, ProjectEmbedding.state_name)
        .order_by(ProjectEmbedding.state_name)
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        {"state_id": row.state_id, "state_name": row.state_name, "count": row[2]}
        for row in rows
    ]
