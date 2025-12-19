"""API endpoints for RAG Dashboard - View embeddings, jobs, and search.

These endpoints provide read-only access to RAG pre-processing results
stored in the database after runner sync.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.crud.rag_dashboard import (
    get_dashboard_stats,
    get_embeddings,
    get_jobs,
    get_unique_states,
)
from app.middleware.error_handler import not_found_error
from app.models.organization import PermissionLevel
from app.models.user import User
from app.schemas.rag_dashboard import (
    EmbeddingItem,
    EmbeddingListResponse,
    JobItem,
    JobListResponse,
    JobSummary,
    RAGDashboardStats,
    SemanticSearchRequest,
    SemanticSearchResponse,
)
from app.services.permission_service import permission_service

logger = structlog.get_logger(__name__)

router = APIRouter()


async def check_project_access(
    db: AsyncSession, project_id: UUID, user: User, level: PermissionLevel
) -> None:
    """Check if user has access to project."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, user.id, project_id, level
    )
    if not has_access:
        raise not_found_error("Project", "project")


def embedding_to_item(emb: Any) -> EmbeddingItem:
    """Convert ProjectEmbedding model to EmbeddingItem schema."""
    return EmbeddingItem(
        id=emb.id,
        pattern_id=emb.pattern_id,
        pattern_name=emb.pattern_name,
        state_id=emb.state_id,
        state_name=emb.state_name,
        image_id=emb.image_id,
        image_storage_path=emb.image_storage_path,
        embedding_model=emb.embedding_model,
        embedding_version=emb.embedding_version,
        image_width=emb.image_width,
        image_height=emb.image_height,
        pattern_metadata=emb.pattern_metadata,
        created_at=emb.created_at,
        updated_at=emb.updated_at,
    )


def job_to_item(job: Any) -> JobItem:
    """Convert EmbeddingGenerationJob model to JobItem schema."""
    return JobItem(
        id=job.id,
        status=job.status,
        total_patterns=job.total_patterns,
        processed_patterns=job.processed_patterns,
        progress_percent=job.calculate_progress_percent(),
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        job_metadata=job.job_metadata,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def job_to_summary(job: Any) -> JobSummary:
    """Convert EmbeddingGenerationJob model to JobSummary schema."""
    return JobSummary(
        id=job.id,
        status=job.status,
        progress_percent=job.calculate_progress_percent(),
        total_patterns=job.total_patterns,
        processed_patterns=job.processed_patterns,
        started_at=job.started_at,
        error_message=job.error_message,
    )


@router.get("/{project_id}/rag/dashboard", response_model=RAGDashboardStats)
async def get_rag_dashboard(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> RAGDashboardStats:
    """
    Get RAG dashboard summary statistics.

    Returns counts of embeddings, states, patterns, and active job status.
    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    stats = await get_dashboard_stats(db, project_id)

    return RAGDashboardStats(
        total_embeddings=stats["total_embeddings"],
        total_states=stats["total_states"],
        total_patterns=stats["total_patterns"],
        last_sync_at=stats["last_sync_at"],
        active_job=job_to_summary(stats["active_job"]) if stats["active_job"] else None,
    )


@router.get("/{project_id}/rag/embeddings", response_model=EmbeddingListResponse)
async def list_embeddings(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    state_filter: str | None = Query(None, description="Filter by state ID"),
    current_user: User = Depends(get_current_active_user_async),
) -> EmbeddingListResponse:
    """
    Get paginated list of embeddings for a project.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    embeddings, total = await get_embeddings(
        db, project_id, page=page, limit=limit, state_filter=state_filter
    )

    items = [embedding_to_item(emb) for emb in embeddings]
    has_more = (page * limit) < total

    return EmbeddingListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        has_more=has_more,
    )


@router.get("/{project_id}/rag/jobs", response_model=JobListResponse)
async def list_jobs(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    status_filter: str | None = Query(
        None, description="Filter by status (pending, in_progress, completed, failed)"
    ),
    current_user: User = Depends(get_current_active_user_async),
) -> JobListResponse:
    """
    Get paginated list of embedding generation jobs for a project.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    jobs, total = await get_jobs(
        db, project_id, page=page, limit=limit, status_filter=status_filter
    )

    items = [job_to_item(job) for job in jobs]
    has_more = (page * limit) < total

    return JobListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        has_more=has_more,
    )


@router.post("/{project_id}/rag/search", response_model=SemanticSearchResponse)
async def search_embeddings(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: SemanticSearchRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> SemanticSearchResponse:
    """
    Perform semantic search across indexed embeddings.

    This endpoint generates an embedding from the query text and finds
    similar patterns using pgvector cosine similarity.

    Note: Requires embedding generation to be implemented. Currently returns
    empty results as a placeholder.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    # TODO: Implement embedding generation for query text
    # For now, we return empty results since we need a text-to-embedding model
    # to convert the query string into a vector.
    #
    # Future implementation:
    # 1. Use CLIP or similar model to generate embedding from query text
    # 2. Call semantic_search() with the query embedding
    # 3. Return results
    #
    # Example when implemented:
    # query_embedding = await generate_text_embedding(request.query)
    # results = await semantic_search(
    #     db, project_id, query_embedding,
    #     limit=request.limit,
    #     min_similarity=request.min_similarity,
    #     state_filter=request.state_filter,
    # )

    logger.info(
        "rag_search_placeholder",
        project_id=str(project_id),
        query=request.query,
        message="Semantic search requires embedding generation - returning empty results",
    )

    return SemanticSearchResponse(
        results=[],
        query=request.query,
        total_found=0,
    )


@router.get("/{project_id}/rag/states")
async def list_states(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> dict:
    """
    Get list of unique states with embeddings for filter dropdown.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    states = await get_unique_states(db, project_id)

    return {"states": states, "count": len(states)}
