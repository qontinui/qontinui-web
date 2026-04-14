"""
Automation Session API Endpoints

Endpoints for querying automation session data, including logs, screenshots,
and timeline analysis.

Refactored to use thin controllers that delegate to AutomationSessionRepository.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.automation_screenshot import AutomationScreenshot
from app.models.organization import PermissionLevel
from app.models.user import User
from app.repositories import AutomationSessionRepository
from app.repositories.deps import get_automation_session_repository
from app.schemas.automation import (
    AutomationSessionListResponse,
    AutomationSessionWithStats,
    ImageRecognitionReport,
    ImageRecognitionStats,
    ScreenshotWithInputs,
    SessionTimeline,
    TimelineEvent,
)
from app.services.object_storage import object_storage
from app.services.permission_service import permission_service
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/sessions", response_model=AutomationSessionListResponse)
async def list_automation_sessions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    status: str | None = Query(None, description="Filter by session status"),
    start_date: datetime | None = Query(
        None, description="Filter sessions created after this date"
    ),
    end_date: datetime | None = Query(
        None, description="Filter sessions created before this date"
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """
    List automation sessions with pagination and filtering.

    Only returns sessions that the user has access to.
    """
    logger.info(
        "list_automation_sessions",
        user_id=current_user.id,
        skip=skip,
        limit=limit,
        status=status,
    )

    # Get accessible projects (permission logic stays in endpoint)
    accessible_projects = await permission_service.get_user_accessible_projects(
        db, current_user.id
    )
    # p.id is UUID at runtime, mypy sees Column[UUID]
    accessible_project_ids: list[UUID] = [p.id for p in accessible_projects]  # type: ignore[misc]

    # Delegate to repository
    sessions_with_stats, total = await repo.list_with_stats(
        db,
        accessible_project_ids=accessible_project_ids,
        user_id=current_user.id,
        status=status,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit,
    )

    # Convert dicts to response schema
    sessions = [AutomationSessionWithStats(**s) for s in sessions_with_stats]

    return {"sessions": sessions, "total": total, "limit": limit, "offset": skip}


@router.get("/sessions/{session_id}", response_model=AutomationSessionWithStats)
async def get_automation_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """Get details for a specific automation session."""
    logger.info(
        "get_automation_session", session_id=str(session_id), user_id=current_user.id
    )

    # Get session with stats from repository
    session_data = await repo.get_with_stats(db, session_id)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission (permission logic stays in endpoint)
    has_access = await _check_session_permission(
        db, current_user.id, session_data["project_id"], session_data["user_id"]
    )
    if not has_access:
        logger.warning(
            "session_access_denied", session_id=str(session_id), user_id=current_user.id
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    return AutomationSessionWithStats(**session_data)


@router.get("/sessions/{session_id}/timeline", response_model=SessionTimeline)
async def get_session_timeline(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """Get chronological timeline of all events (logs + screenshots) for a session."""
    logger.info(
        "get_session_timeline", session_id=str(session_id), user_id=current_user.id
    )

    # Get timeline from repository
    session, timeline_data = await repo.get_session_timeline(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission
    has_access = await _check_session_permission(
        db, current_user.id, session.project_id, session.user_id
    )
    if not has_access:
        logger.warning(
            "session_timeline_access_denied",
            session_id=str(session_id),
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Convert to response schema
    timeline = [
        TimelineEvent(
            event_type=e.event_type,
            timestamp=e.timestamp,
            id=e.id,
            data=e.data,
        )
        for e in timeline_data
    ]

    return SessionTimeline(
        session=session, timeline=timeline, total_events=len(timeline)
    )


@router.get(
    "/sessions/{session_id}/image-recognition", response_model=ImageRecognitionReport
)
async def get_image_recognition_stats(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """Query image recognition logs and calculate statistics."""
    logger.info(
        "get_image_recognition_stats",
        session_id=str(session_id),
        user_id=current_user.id,
    )

    # Get stats from repository
    session, report_data = await repo.get_image_recognition_stats(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission
    has_access = await _check_session_permission(
        db, current_user.id, session.project_id, session.user_id
    )
    if not has_access:
        logger.warning(
            "image_recognition_stats_access_denied",
            session_id=str(session_id),
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Handle case where no image recognition logs found
    if not report_data:
        return ImageRecognitionReport(
            session_id=session_id,
            total_attempts=0,
            successful=0,
            failed=0,
            overall_success_rate=0.0,
            images=[],
        )

    # Convert to response schema
    images = [
        ImageRecognitionStats(
            image_id=img.image_id,
            total_attempts=img.total_attempts,
            successful=img.successful,
            failed=img.failed,
            success_rate=img.success_rate,
            avg_confidence=img.avg_confidence,
        )
        for img in report_data.images
    ]

    return ImageRecognitionReport(
        session_id=session_id,
        total_attempts=report_data.total_attempts,
        successful=report_data.successful,
        failed=report_data.failed,
        overall_success_rate=report_data.overall_success_rate,
        images=images,
    )


@router.get("/screenshots/{screenshot_id}/inputs", response_model=ScreenshotWithInputs)
async def get_screenshot_inputs(
    screenshot_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """Get a screenshot with all associated input events."""
    logger.info(
        "get_screenshot_inputs",
        screenshot_id=str(screenshot_id),
        user_id=current_user.id,
    )

    # Get screenshot with inputs from repository
    screenshot, inputs = await repo.get_screenshot_with_inputs(db, screenshot_id)
    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Screenshot '{screenshot_id}' not found",
        )

    # Check permission via the screenshot's session
    if screenshot.session:
        has_access = await _check_session_permission(
            db,
            current_user.id,
            screenshot.session.project_id,
            screenshot.session.user_id,
        )
        if not has_access:
            logger.warning(
                "screenshot_access_denied",
                screenshot_id=str(screenshot_id),
                user_id=current_user.id,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    return ScreenshotWithInputs(screenshot=screenshot, inputs=inputs)


class LinkScreenshotToProjectRequest(BaseModel):
    """Request body for linking a screenshot to a project"""

    project_id: UUID


class LinkScreenshotToProjectResponse(BaseModel):
    """Response for linking a screenshot to a project"""

    screenshot_id: UUID
    project_id: UUID | None
    message: str


@router.post(
    "/screenshots/{screenshot_id}/link-to-project",
    response_model=LinkScreenshotToProjectResponse,
)
async def link_screenshot_to_project(
    screenshot_id: UUID,
    request: LinkScreenshotToProjectRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """Link an automation screenshot to a project. Requires EDIT permission."""
    logger.info(
        "link_screenshot_to_project",
        screenshot_id=str(screenshot_id),
        project_id=request.project_id,
        user_id=current_user.id,
    )

    # Check EDIT permission on target project
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, request.project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to edit this project",
        )

    # Query screenshot with session eager loading
    screenshot_query = (
        select(AutomationScreenshot)
        .where(AutomationScreenshot.id == screenshot_id)
        .options(selectinload(AutomationScreenshot.session))
    )
    screenshot_result = await db.execute(screenshot_query)
    screenshot = screenshot_result.scalar_one_or_none()

    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Screenshot '{screenshot_id}' not found",
        )

    # Check access to screenshot's session
    if screenshot.session:
        session_access = await _check_session_permission(
            db,
            current_user.id,
            screenshot.session.project_id,
            screenshot.session.user_id,
        )
        if not session_access:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    # Update project_id
    screenshot.project_id = request.project_id
    await db.commit()
    await db.refresh(screenshot)

    logger.info(
        "screenshot_linked_to_project",
        screenshot_id=str(screenshot_id),
        project_id=request.project_id,
    )

    return LinkScreenshotToProjectResponse(
        screenshot_id=screenshot.id,
        project_id=screenshot.project_id,
        message=f"Screenshot successfully linked to project {request.project_id}",
    )


@router.delete(
    "/screenshots/{screenshot_id}/link-to-project",
    response_model=LinkScreenshotToProjectResponse,
)
async def unlink_screenshot_from_project(
    screenshot_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """Unlink an automation screenshot from its project. Requires EDIT permission."""
    logger.info(
        "unlink_screenshot_from_project",
        screenshot_id=str(screenshot_id),
        user_id=current_user.id,
    )

    # Query screenshot with session eager loading
    screenshot_query = (
        select(AutomationScreenshot)
        .where(AutomationScreenshot.id == screenshot_id)
        .options(selectinload(AutomationScreenshot.session))
    )
    screenshot_result = await db.execute(screenshot_query)
    screenshot = screenshot_result.scalar_one_or_none()

    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Screenshot '{screenshot_id}' not found",
        )

    # Check access to screenshot's session
    if screenshot.session:
        session_access = await _check_session_permission(
            db,
            current_user.id,
            screenshot.session.project_id,
            screenshot.session.user_id,
        )
        if not session_access:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    # Check EDIT permission on current project (if linked)
    if screenshot.project_id is not None:
        has_edit_access = await permission_service.can_user_access_project(
            db, current_user.id, screenshot.project_id, PermissionLevel.EDIT
        )
        if not has_edit_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to edit this project",
            )

    # Remove project_id
    screenshot.project_id = None
    await db.commit()
    await db.refresh(screenshot)

    logger.info("screenshot_unlinked_from_project", screenshot_id=str(screenshot_id))

    return LinkScreenshotToProjectResponse(
        screenshot_id=screenshot.id,
        project_id=screenshot.project_id,
        message="Screenshot successfully unlinked from project",
    )


class PresignedUrlResponse(BaseModel):
    """Response for presigned URL generation"""

    screenshot_id: UUID
    presigned_url: str
    expires_at: datetime
    expiration_seconds: int


@router.get("/screenshots/{screenshot_id}/url", response_model=PresignedUrlResponse)
async def get_screenshot_presigned_url(
    screenshot_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """Generate a fresh presigned URL for accessing a screenshot."""
    logger.info(
        "get_screenshot_presigned_url",
        screenshot_id=str(screenshot_id),
        user_id=current_user.id,
    )

    # Query screenshot with session eager loading
    screenshot_query = (
        select(AutomationScreenshot)
        .where(AutomationScreenshot.id == screenshot_id)
        .options(selectinload(AutomationScreenshot.session))
    )
    screenshot_result = await db.execute(screenshot_query)
    screenshot = screenshot_result.scalar_one_or_none()

    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Screenshot '{screenshot_id}' not found",
        )

    # Check permission via the screenshot's session
    if screenshot.session:
        has_access = await _check_session_permission(
            db,
            current_user.id,
            screenshot.session.project_id,
            screenshot.session.user_id,
        )
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    # Generate presigned URL (object_storage call stays in endpoint)
    expiration_seconds = 30 * 24 * 60 * 60  # 30 days
    try:
        presigned_url = object_storage.generate_presigned_url(
            screenshot.storage_path, expiration=expiration_seconds
        )
    except Exception as e:
        logger.error(
            "screenshot_presigned_url_generation_failed",
            screenshot_id=str(screenshot_id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate presigned URL",
        )

    expires_at = utc_now() + timedelta(seconds=expiration_seconds)
    logger.info(
        "screenshot_presigned_url_generated",
        screenshot_id=str(screenshot_id),
        expires_at=expires_at.isoformat(),
    )

    return PresignedUrlResponse(
        screenshot_id=screenshot.id,
        presigned_url=presigned_url,
        expires_at=expires_at,
        expiration_seconds=expiration_seconds,
    )


class PaginatedLogsResponse(BaseModel):
    """Paginated response for automation logs"""

    logs: list[dict]
    total: int
    limit: int
    offset: int


class PaginatedScreenshotsResponse(BaseModel):
    """Paginated response for automation screenshots"""

    screenshots: list[dict]
    total: int
    limit: int
    offset: int


@router.get("/sessions/{session_id}/logs", response_model=PaginatedLogsResponse)
async def get_session_logs_paginated(
    session_id: UUID,
    skip: int = Query(0, ge=0, description="Number of logs to skip"),
    limit: int = Query(
        100, ge=1, le=1000, description="Maximum number of logs to return (1-1000)"
    ),
    level: str | None = Query(
        None, description="Filter by log level (debug, info, warning, error)"
    ),
    order_by: str = Query(
        "timestamp", description="Field to order by (timestamp, sequence_number)"
    ),
    order_desc: bool = Query(False, description="Order descending (newest first)"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """Get paginated logs for an automation session."""
    logger.info(
        "get_session_logs_paginated",
        session_id=str(session_id),
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Verify session exists and check permission
    session_data = await repo.get_with_stats(db, session_id)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    has_access = await _check_session_permission(
        db, current_user.id, session_data["project_id"], session_data["user_id"]
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Delegate to repository
    logs_data, total = await repo.get_session_logs_paginated(
        db,
        session_id,
        skip=skip,
        limit=limit,
        level=level,
        order_by=order_by,
        order_desc=order_desc,
    )

    return PaginatedLogsResponse(logs=logs_data, total=total, limit=limit, offset=skip)


@router.get(
    "/sessions/{session_id}/screenshots", response_model=PaginatedScreenshotsResponse
)
async def get_session_screenshots_paginated(
    session_id: UUID,
    skip: int = Query(0, ge=0, description="Number of screenshots to skip"),
    limit: int = Query(
        100,
        ge=1,
        le=1000,
        description="Maximum number of screenshots to return (1-1000)",
    ),
    order_desc: bool = Query(False, description="Order descending (newest first)"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: AutomationSessionRepository = Depends(get_automation_session_repository),
) -> Any:
    """Get paginated screenshots for an automation session."""
    logger.info(
        "get_session_screenshots_paginated",
        session_id=str(session_id),
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )

    # Verify session exists and check permission
    session_data = await repo.get_with_stats(db, session_id)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    has_access = await _check_session_permission(
        db, current_user.id, session_data["project_id"], session_data["user_id"]
    )
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Delegate to repository
    screenshots_data, total = await repo.get_session_screenshots_paginated(
        db, session_id, skip=skip, limit=limit, order_desc=order_desc
    )

    return PaginatedScreenshotsResponse(
        screenshots=screenshots_data, total=total, limit=limit, offset=skip
    )


async def _check_session_permission(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID | None,
    session_user_id: UUID,
) -> bool:
    """
    Check if a user has permission to access a session.

    Access is granted if:
    - Session is linked to a project where user has VIEW+ permission, OR
    - Session has no project and was created by the user
    """
    if project_id is not None:
        return await permission_service.can_user_access_project(
            db, user_id, project_id, PermissionLevel.VIEW
        )
    return session_user_id == user_id
