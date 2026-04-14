"""
API endpoints for discoveries.

This module provides REST API endpoints for:
- Runner -> Backend: Submitting discoveries from automation runs
- Web Frontend -> Backend: Reviewing and managing discoveries
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import discovery as discovery_crud
from app.models.project import Project
from app.models.user import User
from app.schemas.discovery import (DiscoveryAcceptRequest, DiscoveryFromRunner,
                                   DiscoveryListResponse,
                                   DiscoveryRejectRequest, DiscoveryResponse,
                                   DiscoveryStats, PendingCountResponse)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.get(
    "",
    response_model=DiscoveryListResponse,
    summary="List discoveries",
    description="List discoveries with optional filtering.",
)
async def list_discoveries(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    status_filter: str | None = Query(
        None,
        alias="status",
        description="Filter by status (pending, accepted, rejected, deferred)",
    ),
    discovery_type: str | None = Query(
        None, alias="type", description="Filter by discovery type"
    ),
    config_id: str | None = Query(None, description="Filter by config ID"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    limit: int = Query(50, ge=1, le=100, description="Limit for pagination"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DiscoveryListResponse:
    """List discoveries for the current user."""
    discoveries, total = await discovery_crud.list_discoveries(
        db=db,
        user_id=current_user.id,
        skip=offset,
        limit=limit,
        project_id=project_id,
        status=status_filter,
        discovery_type=discovery_type,
        config_id=config_id,
    )

    return DiscoveryListResponse(
        discoveries=[DiscoveryResponse.model_validate(d) for d in discoveries],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/pending-count",
    response_model=PendingCountResponse,
    summary="Get pending discoveries count",
    description="Get the count of pending discoveries for the current user.",
)
async def get_pending_count(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PendingCountResponse:
    """Get count of pending discoveries."""
    count = await discovery_crud.get_pending_count(
        db=db,
        user_id=current_user.id,
        project_id=project_id,
    )
    return PendingCountResponse(pending_count=count)


@router.get(
    "/stats",
    response_model=DiscoveryStats,
    summary="Get discovery statistics",
    description="Get aggregated statistics for discoveries.",
)
async def get_discovery_stats(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DiscoveryStats:
    """Get discovery statistics."""
    return await discovery_crud.get_discovery_stats(
        db=db,
        user_id=current_user.id,
        project_id=project_id,
    )


@router.get(
    "/{discovery_id}",
    response_model=DiscoveryResponse,
    summary="Get a discovery",
    description="Get a single discovery by ID.",
)
async def get_discovery(
    discovery_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DiscoveryResponse:
    """Get a discovery by ID."""
    discovery = await discovery_crud.get_discovery_by_user(
        db=db,
        discovery_id=discovery_id,
        user_id=current_user.id,
    )

    if not discovery:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discovery not found",
        )

    return DiscoveryResponse.model_validate(discovery)


@router.post(
    "",
    response_model=DiscoveryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a discovery from runner",
    description="Submit a new discovery from the runner. Looks up user from project.",
)
async def create_discovery_from_runner(
    discovery_data: DiscoveryFromRunner,
    db: AsyncSession = Depends(get_async_db),
) -> DiscoveryResponse:
    """
    Create a discovery from runner submission.

    The runner doesn't have user auth, so we look up the project owner.
    """
    # Look up the project to get the owner
    result = await db.execute(
        select(Project).filter(Project.id == discovery_data.project_id)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Create discovery with project owner as user
    discovery = await discovery_crud.create_discovery_from_runner(
        db=db,
        user_id=project.owner_id,  # type: ignore[arg-type]
        runner_data=discovery_data,
    )

    logger.info(
        "Created discovery from runner",
        discovery_id=str(discovery.id),
        project_id=str(project.id),
        runner_id=discovery_data.runner_id,
        discovery_type=discovery_data.discovery_type,
        title=discovery_data.title,
    )

    return DiscoveryResponse.model_validate(discovery)


@router.put(
    "/{discovery_id}/accept",
    response_model=DiscoveryResponse,
    summary="Accept a discovery",
    description="Accept a discovery and optionally mark it as applied to config.",
)
async def accept_discovery(
    discovery_id: UUID,
    request: DiscoveryAcceptRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DiscoveryResponse:
    """Accept a discovery."""
    discovery = await discovery_crud.accept_discovery(
        db=db,
        discovery_id=discovery_id,
        user_id=current_user.id,
        request=request,
    )

    if not discovery:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discovery not found",
        )

    logger.info(
        "Accepted discovery",
        discovery_id=str(discovery.id),
        user_id=str(current_user.id),
        apply_requested=request.apply_to_config,
        applied_to_config=discovery.applied_to_config,
    )

    return DiscoveryResponse.model_validate(discovery)


@router.put(
    "/{discovery_id}/reject",
    response_model=DiscoveryResponse,
    summary="Reject a discovery",
    description="Reject a discovery with optional notes.",
)
async def reject_discovery(
    discovery_id: UUID,
    request: DiscoveryRejectRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DiscoveryResponse:
    """Reject a discovery."""
    discovery = await discovery_crud.reject_discovery(
        db=db,
        discovery_id=discovery_id,
        user_id=current_user.id,
        request=request,
    )

    if not discovery:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discovery not found",
        )

    logger.info(
        "Rejected discovery",
        discovery_id=str(discovery.id),
        user_id=str(current_user.id),
    )

    return DiscoveryResponse.model_validate(discovery)


@router.put(
    "/{discovery_id}/defer",
    response_model=DiscoveryResponse,
    summary="Defer a discovery",
    description="Defer a discovery for later review.",
)
async def defer_discovery(
    discovery_id: UUID,
    user_notes: str | None = Query(None, description="Notes about deferral"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DiscoveryResponse:
    """Defer a discovery for later review."""
    discovery = await discovery_crud.defer_discovery(
        db=db,
        discovery_id=discovery_id,
        user_id=current_user.id,
        user_notes=user_notes,
    )

    if not discovery:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discovery not found",
        )

    logger.info(
        "Deferred discovery",
        discovery_id=str(discovery.id),
        user_id=str(current_user.id),
    )

    return DiscoveryResponse.model_validate(discovery)


@router.delete(
    "/{discovery_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a discovery",
    description="Delete a discovery.",
)
async def delete_discovery(
    discovery_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Delete a discovery."""
    success = await discovery_crud.delete_discovery(
        db=db,
        discovery_id=discovery_id,
        user_id=current_user.id,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discovery not found",
        )

    logger.info(
        "Deleted discovery",
        discovery_id=str(discovery_id),
        user_id=str(current_user.id),
    )
