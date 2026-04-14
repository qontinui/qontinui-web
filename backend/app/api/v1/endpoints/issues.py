"""
API endpoints for detected issues.

This module provides REST API endpoints for:
- Runner → Backend: Syncing issues detected during AI-assisted automation
- Web Frontend → Backend: Querying and managing detected issues
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import detected_issue as issue_crud
from app.models.user import User
from app.schemas.detected_issue import (DetectedIssueCreate,
                                        DetectedIssueResponse,
                                        DetectedIssueUpdate, IssueListResponse,
                                        IssuesSyncRequest, IssuesSyncResponse,
                                        IssueStats)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.post(
    "/sync",
    response_model=IssuesSyncResponse,
    summary="Sync issues from runner",
    description="Bulk sync detected issues from the runner to the backend.",
)
async def sync_issues(
    request: IssuesSyncRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> IssuesSyncResponse:
    """Sync issues from runner."""
    logger.info(
        "Syncing issues from runner",
        user_id=str(current_user.id),
        issue_count=len(request.issues),
        project_id=str(request.project_id) if request.project_id else None,
    )

    synced, updated, errors = await issue_crud.sync_issues(
        db=db,
        user_id=current_user.id,
        project_id=request.project_id,
        issues=request.issues,
    )

    return IssuesSyncResponse(synced=synced, updated=updated, errors=errors)


@router.get(
    "",
    response_model=IssueListResponse,
    summary="List detected issues",
    description="List detected issues with optional filtering.",
)
async def list_issues(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    session_id: str | None = Query(None, description="Filter by session ID"),
    status_filter: str | None = Query(
        None, alias="status", description="Filter by status"
    ),
    severity: str | None = Query(None, description="Filter by severity"),
    issue_type: str | None = Query(None, alias="type", description="Filter by type"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    limit: int = Query(50, ge=1, le=100, description="Limit for pagination"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> IssueListResponse:
    """List detected issues."""
    issues, total = await issue_crud.list_detected_issues(
        db=db,
        user_id=current_user.id,
        skip=offset,
        limit=limit,
        project_id=project_id,
        session_id=session_id,
        status=status_filter,
        severity=severity,
        issue_type=issue_type,
    )

    return IssueListResponse(
        issues=[DetectedIssueResponse.model_validate(issue) for issue in issues],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/stats",
    response_model=IssueStats,
    summary="Get issue statistics",
    description="Get aggregated statistics for detected issues.",
)
async def get_issue_stats(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> IssueStats:
    """Get issue statistics."""
    return await issue_crud.get_issue_stats(
        db=db,
        user_id=current_user.id,
        project_id=project_id,
    )


@router.get(
    "/{issue_id}",
    response_model=DetectedIssueResponse,
    summary="Get a detected issue",
    description="Get a single detected issue by ID.",
)
async def get_issue(
    issue_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DetectedIssueResponse:
    """Get a detected issue by ID."""
    issue = await issue_crud.get_detected_issue_by_user(
        db=db,
        issue_id=issue_id,
        user_id=current_user.id,
    )

    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found",
        )

    return DetectedIssueResponse.model_validate(issue)


@router.post(
    "",
    response_model=DetectedIssueResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a detected issue",
    description="Create a new detected issue.",
)
async def create_issue(
    issue_data: DetectedIssueCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DetectedIssueResponse:
    """Create a new detected issue."""
    issue = await issue_crud.create_detected_issue(
        db=db,
        user_id=current_user.id,
        issue_data=issue_data,
    )

    logger.info(
        "Created detected issue",
        issue_id=str(issue.id),
        user_id=str(current_user.id),
        title=issue.title,
    )

    return DetectedIssueResponse.model_validate(issue)


@router.patch(
    "/{issue_id}",
    response_model=DetectedIssueResponse,
    summary="Update a detected issue",
    description="Update an existing detected issue.",
)
async def update_issue(
    issue_id: UUID,
    update_data: DetectedIssueUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DetectedIssueResponse:
    """Update a detected issue."""
    issue = await issue_crud.update_detected_issue(
        db=db,
        issue_id=issue_id,
        user_id=current_user.id,
        update_data=update_data,
    )

    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found",
        )

    logger.info(
        "Updated detected issue",
        issue_id=str(issue.id),
        user_id=str(current_user.id),
        status=issue.status,
    )

    return DetectedIssueResponse.model_validate(issue)


@router.delete(
    "/{issue_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a detected issue",
    description="Delete a detected issue.",
)
async def delete_issue(
    issue_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Delete a detected issue."""
    success = await issue_crud.delete_detected_issue(
        db=db,
        issue_id=issue_id,
        user_id=current_user.id,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found",
        )

    logger.info(
        "Deleted detected issue",
        issue_id=str(issue_id),
        user_id=str(current_user.id),
    )
