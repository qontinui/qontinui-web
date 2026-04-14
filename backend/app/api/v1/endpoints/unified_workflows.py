"""
Unified Workflows API endpoints.

CRUD for workflow definitions. Source of truth is PostgreSQL.
The runner fetches workflows from here for execution and caches locally.
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.services.unified_workflow_service import (
    UnifiedWorkflowCreate,
    UnifiedWorkflowListResponse,
    UnifiedWorkflowResponse,
    UnifiedWorkflowService,
    UnifiedWorkflowUpdate,
)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


def get_service() -> UnifiedWorkflowService:
    return UnifiedWorkflowService()


# =============================================================================
# CRUD Endpoints
# =============================================================================


@router.post(
    "",
    response_model=UnifiedWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workflow",
)
async def create_workflow(
    data: UnifiedWorkflowCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowResponse:
    return await service.create_workflow(db, data, current_user.id)


@router.get(
    "",
    response_model=UnifiedWorkflowListResponse,
    summary="List workflows",
)
async def list_workflows(
    project_id: str | None = Query(None, description="Filter by project ID"),
    category: str | None = Query(None, description="Filter by category"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowListResponse:
    return await service.list_workflows(
        db,
        user_id=current_user.id,
        project_id=UUID(project_id) if project_id else None,
        category=category,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/search",
    response_model=UnifiedWorkflowListResponse,
    summary="Search workflows",
)
async def search_workflows(
    q: str | None = Query(None, description="Search query (name or description)"),
    category: str | None = Query(None, description="Filter by category"),
    tag: str | None = Query(None, description="Filter by tag"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowListResponse:
    return await service.search_workflows(
        db,
        user_id=current_user.id,
        q=q,
        category=category,
        tag=tag,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/{workflow_id}",
    response_model=UnifiedWorkflowResponse,
    summary="Get a workflow",
)
async def get_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowResponse:
    try:
        return await service.get_workflow(db, workflow_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )


@router.put(
    "/{workflow_id}",
    response_model=UnifiedWorkflowResponse,
    summary="Update a workflow",
)
async def update_workflow(
    workflow_id: UUID,
    data: UnifiedWorkflowUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowResponse:
    try:
        return await service.update_workflow(db, workflow_id, data, current_user.id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )


@router.delete(
    "/{workflow_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workflow",
)
async def delete_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> None:
    try:
        await service.delete_workflow(db, workflow_id, current_user.id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )


# =============================================================================
# Utility Endpoints
# =============================================================================


@router.post(
    "/{workflow_id}/duplicate",
    response_model=UnifiedWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate a workflow",
)
async def duplicate_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowResponse:
    try:
        return await service.duplicate_workflow(db, workflow_id, current_user.id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )


@router.get(
    "/{workflow_id}/export",
    summary="Export a workflow as JSON",
)
async def export_workflow(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return await service.export_workflow(db, workflow_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )


@router.post(
    "/import",
    response_model=UnifiedWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Import a workflow from JSON",
)
async def import_workflow(
    data: dict[str, Any],
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: UnifiedWorkflowService = Depends(get_service),
) -> UnifiedWorkflowResponse:
    return await service.import_workflow(db, data, current_user.id)
