"""API endpoints for RAG Dashboard - View embeddings, jobs, and search.

These endpoints provide read-only access to RAG pre-processing results
stored in the database after runner sync.
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.crud.rag_dashboard import (get_dashboard_stats, get_embeddings,
                                    get_jobs, get_unique_states,
                                    semantic_search)
from app.middleware.error_handler import not_found_error
from app.models.organization import PermissionLevel
from app.models.user import User
from app.schemas.rag_dashboard import (EmbeddingItem, EmbeddingListResponse,
                                       JobItem, JobListResponse, JobSummary,
                                       RAGDashboardStats,
                                       SemanticSearchRequest,
                                       SemanticSearchResponse)
from app.services.embedding_service import EmbeddingService
from app.services.object_storage import object_storage
from app.services.permission_service import permission_service
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

# Presigned URL expiration: 7 days
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60  # 604800 seconds

logger = structlog.get_logger(__name__)

router = APIRouter()


async def check_project_access(
    db: AsyncSession, project_id: UUID, user: User, level: PermissionLevel
) -> None:
    """Check if user has access to project."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Superusers have access to all projects
    if user.is_superuser:
        return

    has_access = await permission_service.can_user_access_project(
        db, user.id, project_id, level
    )
    if not has_access:
        raise not_found_error("Project", "project")


def embedding_to_item(
    emb: Any, image_lookup: dict[str, dict[str, Any]] | None = None
) -> EmbeddingItem:
    """Convert ProjectEmbedding model to EmbeddingItem schema.

    Args:
        emb: The ProjectEmbedding model instance
        image_lookup: Optional dict mapping image_id to image data from project config.
                     Used to resolve inline: storage paths to actual data URLs.
    """
    # Generate presigned URL for the image or use data URL directly
    image_url = None
    if emb.image_storage_path:
        # Check if it's a data URL (local storage) - use directly
        if emb.image_storage_path.startswith("data:"):
            image_url = emb.image_storage_path
        # Check if it's an inline reference that needs resolution
        elif emb.image_storage_path.startswith("inline:"):
            # Extract image_id from "inline:{image_id}" format
            inline_image_id = emb.image_storage_path[7:]  # Remove "inline:" prefix
            if image_lookup and inline_image_id in image_lookup:
                # Get the actual data URL from project config
                image_data = image_lookup[inline_image_id]
                url = image_data.get("url", "")
                if url.startswith("data:"):
                    image_url = url
            # Fallback: try using emb.image_id if inline extraction failed
            elif image_lookup and emb.image_id and emb.image_id in image_lookup:
                image_data = image_lookup[emb.image_id]
                url = image_data.get("url", "")
                if url.startswith("data:"):
                    image_url = url
        else:
            # S3/MinIO path - generate presigned URL
            try:
                image_url = object_storage.generate_presigned_url(
                    emb.image_storage_path, expiration=PRESIGNED_URL_EXPIRATION
                )
            except Exception as e:
                logger.warning(
                    "failed_to_generate_presigned_url",
                    image_storage_path=emb.image_storage_path,
                    error=str(e),
                )

    # Convert UUID to string for JSON serialization
    return EmbeddingItem(
        id=str(emb.id),
        pattern_id=emb.pattern_id,
        pattern_name=emb.pattern_name,
        state_id=emb.state_id,
        state_name=emb.state_name,
        image_id=emb.image_id,
        image_storage_path=emb.image_storage_path,
        image_url=image_url,
        embedding_model=emb.embedding_model,
        embedding_version=emb.embedding_version,
        image_width=emb.image_width,
        image_height=emb.image_height,
        text_description=getattr(emb, "text_description", None),
        has_text_embedding=getattr(emb, "text_embedding", None) is not None,
        pattern_metadata=emb.pattern_metadata,
        created_at=emb.created_at,
        updated_at=emb.updated_at,
    )


def job_to_item(job: Any) -> JobItem:
    """Convert EmbeddingGenerationJob model to JobItem schema."""
    return JobItem(
        id=str(job.id),
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
        id=str(job.id),
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

    # Get project to access configuration for image lookup
    project = await get_project(db, project_id=project_id)
    raw_config = project.configuration if project else None
    config: dict[str, Any] = dict(raw_config) if raw_config else {}

    # Build image lookup for resolving inline: storage paths
    image_lookup: dict[str, dict[str, Any]] = {}
    for image in config.get("images", []):
        image_id = image.get("id")
        if image_id:
            image_lookup[image_id] = image

    embeddings, total = await get_embeddings(
        db, project_id, page=page, limit=limit, state_filter=state_filter
    )

    items = [embedding_to_item(emb, image_lookup) for emb in embeddings]
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

    This endpoint generates a CLIP text embedding from the query and finds
    similar patterns using pgvector cosine similarity.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    # Generate query embedding via the runner's embedding service
    embedding_service = EmbeddingService()
    embedding_result = await embedding_service.compute_text_embedding(request.query)

    if not embedding_result.get("success"):
        logger.warning(
            "rag_search_embedding_failed",
            project_id=str(project_id),
            query=request.query,
            error=embedding_result.get("error"),
        )
        return SemanticSearchResponse(
            results=[],
            query=request.query,
            total_found=0,
        )

    query_embedding = embedding_result.get("embedding")
    if not query_embedding:
        logger.warning(
            "rag_search_no_embedding",
            project_id=str(project_id),
            query=request.query,
        )
        return SemanticSearchResponse(
            results=[],
            query=request.query,
            total_found=0,
        )

    # Get project to access configuration for image lookup
    project = await get_project(db, project_id=project_id)
    raw_config_2 = project.configuration if project else None
    config_2: dict[str, Any] = dict(raw_config_2) if raw_config_2 else {}

    # Build image lookup for resolving inline: storage paths
    image_lookup: dict[str, dict[str, Any]] = {}
    for image in config_2.get("images", []):
        image_id = image.get("id")
        if image_id:
            image_lookup[image_id] = image

    # Perform semantic search using pgvector
    results = await semantic_search(
        db,
        project_id,
        query_embedding,
        limit=request.limit,
        min_similarity=request.min_similarity,
        state_filter=request.state_filter,
    )

    # Convert results to response format
    from app.schemas.rag_dashboard import SearchResultItem

    search_results = [
        SearchResultItem(
            embedding=embedding_to_item(emb, image_lookup),
            similarity_score=score,
        )
        for emb, score in results
    ]

    logger.info(
        "rag_search_complete",
        project_id=str(project_id),
        query=request.query,
        results_found=len(search_results),
    )

    return SemanticSearchResponse(
        results=search_results,
        query=request.query,
        total_found=len(search_results),
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
