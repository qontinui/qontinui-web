"""
Automation Session API Endpoints

Endpoints for querying automation session data, including logs, screenshots,
and timeline analysis.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.user import User
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
from sqlalchemy import and_, func, or_, select
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
) -> Any:
    """
    List automation sessions with pagination and filtering.

    Only returns sessions that the user has access to:
    - Sessions linked to projects where user has VIEW+ permission
    - Sessions not yet linked to a project, but created by the user

    - **skip**: Number of sessions to skip (for pagination)
    - **limit**: Maximum number of sessions to return (1-100)
    - **status**: Filter by session status (active, completed, failed)
    - **start_date**: Filter sessions created after this date
    - **end_date**: Filter sessions created before this date

    Returns sessions with basic statistics (log count, screenshot count).
    """
    logger.info(
        "list_automation_sessions",
        user_id=current_user.id,
        skip=skip,
        limit=limit,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )

    # Get all projects the user has access to
    accessible_projects = await permission_service.get_user_accessible_projects(
        db, current_user.id
    )
    accessible_project_ids = [p.id for p in accessible_projects]

    logger.info(
        "accessible_projects_determined",
        user_id=current_user.id,
        project_count=len(accessible_project_ids),
    )

    # Build subqueries for counts (OPTIMIZATION: executed once, not per session)
    log_counts_subquery = (
        select(
            AutomationLog.session_id,
            func.count(AutomationLog.id).label("log_count"),
        )
        .group_by(AutomationLog.session_id)
        .subquery()
    )

    screenshot_counts_subquery = (
        select(
            AutomationScreenshot.session_id,
            func.count(AutomationScreenshot.id).label("screenshot_count"),
        )
        .group_by(AutomationScreenshot.session_id)
        .subquery()
    )

    # Build main query with LEFT JOINs to include sessions with 0 logs/screenshots
    # func.coalesce() ensures NULL counts become 0
    query = (
        select(
            AutomationSession,
            func.coalesce(log_counts_subquery.c.log_count, 0).label("log_count"),
            func.coalesce(screenshot_counts_subquery.c.screenshot_count, 0).label(
                "screenshot_count"
            ),
        )
        .outerjoin(
            log_counts_subquery,
            AutomationSession.id == log_counts_subquery.c.session_id,
        )
        .outerjoin(
            screenshot_counts_subquery,
            AutomationSession.id == screenshot_counts_subquery.c.session_id,
        )
        .where(
            or_(
                AutomationSession.project_id.in_(accessible_project_ids),
                and_(
                    AutomationSession.project_id.is_(None),
                    AutomationSession.user_id == current_user.id,
                ),
            )
        )
    )

    # Apply additional filters
    if status:
        query = query.where(AutomationSession.status == status)
    if start_date:
        query = query.where(AutomationSession.created_at >= start_date)
    if end_date:
        query = query.where(AutomationSession.created_at <= end_date)

    # Get total count (before pagination)
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    # Apply pagination and ordering
    query = query.order_by(AutomationSession.created_at.desc())
    query = query.offset(skip).limit(limit)

    # Execute query (OPTIMIZATION: single query fetches sessions + counts)
    result = await db.execute(query)
    rows = result.all()

    logger.info(
        "sessions_fetched_with_counts",
        user_id=current_user.id,
        session_count=len(rows),
        total=total,
    )

    # Build response from query results (OPTIMIZATION: no additional queries)
    sessions_with_stats = []
    for row in rows:
        session = row[0]  # AutomationSession object
        log_count = row[1]  # log_count from subquery
        screenshot_count = row[2]  # screenshot_count from subquery

        session_data = AutomationSessionWithStats(
            id=session.id,
            project_id=session.project_id,
            runner_version=session.runner_version,
            runner_os=session.runner_os,
            runner_hostname=session.runner_hostname,
            status=session.status,
            configuration_snapshot=session.configuration_snapshot,
            created_at=session.created_at,
            ended_at=session.ended_at,
            log_count=log_count,
            screenshot_count=screenshot_count,
        )
        sessions_with_stats.append(session_data)

    return {
        "sessions": sessions_with_stats,
        "total": total,
        "limit": limit,
        "offset": skip,
    }


@router.get("/sessions/{session_id}", response_model=AutomationSessionWithStats)
async def get_automation_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get details for a specific automation session.

    Only returns session if user has access:
    - Session is linked to a project where user has VIEW+ permission, OR
    - Session is not linked to a project and was created by the user

    Returns session information with basic statistics.
    """
    logger.info(
        "get_automation_session", session_id=str(session_id), user_id=current_user.id
    )

    # Build subqueries for counts (OPTIMIZATION: fetch in same query as session)
    log_count_subquery = (
        select(func.count(AutomationLog.id).label("log_count"))
        .where(AutomationLog.session_id == session_id)
        .scalar_subquery()
    )

    screenshot_count_subquery = (
        select(func.count(AutomationScreenshot.id).label("screenshot_count"))
        .where(AutomationScreenshot.session_id == session_id)
        .scalar_subquery()
    )

    # Single query to fetch session + counts (OPTIMIZATION: 3 queries → 1 query)
    query = select(
        AutomationSession,
        log_count_subquery.label("log_count"),
        screenshot_count_subquery.label("screenshot_count"),
    ).where(AutomationSession.id == session_id)

    result = await db.execute(query)
    row = result.one_or_none()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    session = row[0]
    log_count = row[1]
    screenshot_count = row[2]

    # Check permission
    # If session has a project_id, check project access
    # If session has no project_id, check if user created it
    has_access = False

    if session.project_id is not None:
        # Check if user has access to the project
        from app.models.organization import PermissionLevel

        has_access = await permission_service.can_user_access_project(
            db, current_user.id, session.project_id, PermissionLevel.VIEW
        )
    else:
        # No project linked - check if user created the session
        has_access = session.user_id == current_user.id

    if not has_access:
        logger.warning(
            "session_access_denied",
            session_id=str(session_id),
            user_id=current_user.id,
            project_id=session.project_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    return AutomationSessionWithStats(
        id=session.id,
        project_id=session.project_id,
        runner_version=session.runner_version,
        runner_os=session.runner_os,
        runner_hostname=session.runner_hostname,
        status=session.status,
        configuration_snapshot=session.configuration_snapshot,
        created_at=session.created_at,
        ended_at=session.ended_at,
        log_count=log_count,
        screenshot_count=screenshot_count,
    )


@router.get("/sessions/{session_id}/timeline", response_model=SessionTimeline)
async def get_session_timeline(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get chronological timeline of all events (logs + screenshots) for a session.

    Only accessible if user has permission to view the session.

    Merges logs and screenshots into a single timeline sorted by timestamp.
    Each event includes its type, timestamp, and full data.
    """
    logger.info(
        "get_session_timeline", session_id=str(session_id), user_id=current_user.id
    )

    # First, verify the session exists
    session_query = select(AutomationSession).where(AutomationSession.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission
    has_access = False
    if session.project_id is not None:
        from app.models.organization import PermissionLevel

        has_access = await permission_service.can_user_access_project(
            db, current_user.id, session.project_id, PermissionLevel.VIEW
        )
    else:
        has_access = session.user_id == current_user.id

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

    # Get all logs for the session
    logs_query = (
        select(AutomationLog)
        .where(AutomationLog.session_id == session_id)
        .order_by(AutomationLog.timestamp)
    )
    logs_result = await db.execute(logs_query)
    logs = logs_result.scalars().all()

    # Get all screenshots for the session
    screenshots_query = (
        select(AutomationScreenshot)
        .where(AutomationScreenshot.session_id == session_id)
        .order_by(AutomationScreenshot.timestamp)
    )
    screenshots_result = await db.execute(screenshots_query)
    screenshots = screenshots_result.scalars().all()

    # Build timeline events
    timeline: list[TimelineEvent] = []

    # Add log events
    for log in logs:
        timeline.append(
            TimelineEvent(
                event_type="log",
                timestamp=log.timestamp,
                id=log.id,
                data={
                    "sequence_number": log.sequence_number,
                    "level": log.level,
                    "message": log.message,
                    "log_data": log.log_data,
                    "created_at": log.created_at.isoformat() + "Z",
                },
            )
        )

    # Add screenshot events
    for screenshot in screenshots:
        timeline.append(
            TimelineEvent(
                event_type="screenshot",
                timestamp=screenshot.timestamp,
                id=screenshot.id,
                data={
                    "name": screenshot.name,
                    "storage_path": screenshot.storage_path,
                    "width": screenshot.width,
                    "height": screenshot.height,
                    "content_type": screenshot.content_type,
                    "automation_metadata": screenshot.automation_metadata,
                    "presigned_url": screenshot.presigned_url,
                    "created_at": screenshot.created_at.isoformat() + "Z",
                },
            )
        )

    # Sort timeline by timestamp
    timeline.sort(key=lambda event: event.timestamp)

    return SessionTimeline(
        session=session,
        timeline=timeline,
        total_events=len(timeline),
    )


@router.get(
    "/sessions/{session_id}/image-recognition", response_model=ImageRecognitionReport
)
async def get_image_recognition_stats(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Query image recognition logs and calculate statistics.

    Only accessible if user has permission to view the session.

    Analyzes all image_recognition events in the session:
    - Overall statistics (total attempts, success rate)
    - Per-image statistics (grouped by image_id)
    - Average confidence scores

    Only includes logs where log_data->>'event_type' = 'image_recognition'.
    """
    logger.info(
        "get_image_recognition_stats",
        session_id=str(session_id),
        user_id=current_user.id,
    )

    # Verify session exists
    session_query = select(AutomationSession).where(AutomationSession.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission
    has_access = False
    if session.project_id is not None:
        from app.models.organization import PermissionLevel

        has_access = await permission_service.can_user_access_project(
            db, current_user.id, session.project_id, PermissionLevel.VIEW
        )
    else:
        has_access = session.user_id == current_user.id

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

    # Query image recognition logs
    # Filter where log_data->>'event_type' = 'image_recognition'
    logs_query = select(AutomationLog).where(
        and_(
            AutomationLog.session_id == session_id,
            AutomationLog.log_data["event_type"].astext == "image_recognition",
        )
    )
    logs_result = await db.execute(logs_query)
    logs = logs_result.scalars().all()

    if not logs:
        # Return empty report if no image recognition events found
        return ImageRecognitionReport(
            session_id=session_id,
            total_attempts=0,
            successful=0,
            failed=0,
            overall_success_rate=0.0,
            images=[],
        )

    # Calculate overall statistics
    total_attempts = len(logs)
    successful = sum(1 for log in logs if log.log_data.get("success", False))
    failed = total_attempts - successful
    overall_success_rate = (
        (successful / total_attempts * 100) if total_attempts > 0 else 0.0
    )

    # Group by image_id and calculate per-image statistics
    image_stats_map: dict[str, dict[str, Any]] = {}

    for log in logs:
        image_id = log.log_data.get("image_id", "unknown")
        is_success = log.log_data.get("success", False)
        confidence = log.log_data.get("confidence")

        if image_id not in image_stats_map:
            image_stats_map[image_id] = {
                "total": 0,
                "successful": 0,
                "failed": 0,
                "confidences": [],
            }

        stats = image_stats_map[image_id]
        stats["total"] += 1
        if is_success:
            stats["successful"] += 1
        else:
            stats["failed"] += 1

        if confidence is not None:
            stats["confidences"].append(float(confidence))

    # Build per-image statistics
    image_stats_list: list[ImageRecognitionStats] = []
    for image_id, stats in image_stats_map.items():
        success_rate = (
            (stats["successful"] / stats["total"] * 100) if stats["total"] > 0 else 0.0
        )
        avg_confidence = (
            sum(stats["confidences"]) / len(stats["confidences"])
            if stats["confidences"]
            else None
        )

        image_stats_list.append(
            ImageRecognitionStats(
                image_id=image_id,
                total_attempts=stats["total"],
                successful=stats["successful"],
                failed=stats["failed"],
                success_rate=success_rate,
                avg_confidence=avg_confidence,
            )
        )

    # Sort by total attempts descending
    image_stats_list.sort(key=lambda x: x.total_attempts, reverse=True)

    return ImageRecognitionReport(
        session_id=session_id,
        total_attempts=total_attempts,
        successful=successful,
        failed=failed,
        overall_success_rate=overall_success_rate,
        images=image_stats_list,
    )


@router.get("/screenshots/{screenshot_id}/inputs", response_model=ScreenshotWithInputs)
async def get_screenshot_inputs(
    screenshot_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Get a screenshot with all associated input events.

    Only accessible if user has permission to view the screenshot's session.

    Returns the screenshot and an array of input events (clicks, types, etc.)
    that are associated with it through the ScreenshotInputAssociation table.
    """
    logger.info(
        "get_screenshot_inputs",
        screenshot_id=str(screenshot_id),
        user_id=current_user.id,
    )

    # Query screenshot with eager loading of input associations and session
    screenshot_query = (
        select(AutomationScreenshot)
        .where(AutomationScreenshot.id == screenshot_id)
        .options(
            selectinload(AutomationScreenshot.input_associations),
            selectinload(AutomationScreenshot.session),
        )
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
        has_access = False
        if screenshot.session.project_id is not None:
            from app.models.organization import PermissionLevel

            has_access = await permission_service.can_user_access_project(
                db, current_user.id, screenshot.session.project_id, PermissionLevel.VIEW
            )
        else:
            has_access = screenshot.session.user_id == current_user.id

        if not has_access:
            logger.warning(
                "screenshot_access_denied",
                screenshot_id=str(screenshot_id),
                user_id=current_user.id,
                session_id=screenshot.session_id,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    # Build input events array
    inputs: list[dict[str, Any]] = []

    if screenshot.input_associations:
        # Get the associated logs for each input
        for assoc in screenshot.input_associations:
            # Load the log if not already loaded
            log_query = select(AutomationLog).where(AutomationLog.id == assoc.log_id)
            log_result = await db.execute(log_query)
            log = log_result.scalar_one_or_none()

            if log:
                inputs.append(
                    {
                        "association_id": str(assoc.id),
                        "input_type": assoc.input_type,
                        "input_data": assoc.input_data,
                        "timestamp_diff_ms": assoc.timestamp_diff_ms,
                        "log_timestamp": log.timestamp.isoformat() + "Z",
                        "log_sequence": log.sequence_number,
                        "log_message": log.message,
                        "log_level": log.level,
                    }
                )

    # Sort inputs by timestamp difference (chronological order relative to screenshot)
    inputs.sort(key=lambda x: x["timestamp_diff_ms"])

    return ScreenshotWithInputs(
        screenshot=screenshot,
        inputs=inputs,
    )


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
    """
    Link an automation screenshot to a project.

    Requires EDIT permission on the target project.

    This enables cross-referencing between automation runs and project data,
    allowing automation screenshots to be used in pattern creation and state discovery.

    - **screenshot_id**: UUID of the automation screenshot
    - **project_id**: ID of the project to link to

    Returns the updated screenshot information.
    """
    logger.info(
        "link_screenshot_to_project",
        screenshot_id=str(screenshot_id),
        project_id=request.project_id,
        user_id=current_user.id,
    )

    # Check permission on target project (requires EDIT)
    from app.models.organization import PermissionLevel

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, request.project_id, PermissionLevel.EDIT
    )

    if not has_access:
        logger.warning(
            "link_screenshot_access_denied",
            screenshot_id=str(screenshot_id),
            project_id=request.project_id,
            user_id=current_user.id,
        )
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

    # Check if user has access to the screenshot's session
    if screenshot.session:
        session_access = False
        if screenshot.session.project_id is not None:
            session_access = await permission_service.can_user_access_project(
                db,
                current_user.id,
                screenshot.session.project_id,
                PermissionLevel.VIEW,
            )
        else:
            session_access = screenshot.session.user_id == current_user.id

        if not session_access:
            logger.warning(
                "link_screenshot_session_access_denied",
                screenshot_id=str(screenshot_id),
                user_id=current_user.id,
            )
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
    """
    Unlink an automation screenshot from its project.

    Requires EDIT permission on the current project.

    Removes the project association while keeping the screenshot data.

    - **screenshot_id**: UUID of the automation screenshot

    Returns the updated screenshot information.
    """
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

    # Check if user has access to the screenshot's session
    if screenshot.session:
        session_access = False
        if screenshot.session.project_id is not None:
            from app.models.organization import PermissionLevel

            session_access = await permission_service.can_user_access_project(
                db,
                current_user.id,
                screenshot.session.project_id,
                PermissionLevel.VIEW,
            )
        else:
            session_access = screenshot.session.user_id == current_user.id

        if not session_access:
            logger.warning(
                "unlink_screenshot_session_access_denied",
                screenshot_id=str(screenshot_id),
                user_id=current_user.id,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    # If screenshot is currently linked to a project, check EDIT permission on that project
    if screenshot.project_id is not None:
        from app.models.organization import PermissionLevel

        has_edit_access = await permission_service.can_user_access_project(
            db, current_user.id, screenshot.project_id, PermissionLevel.EDIT
        )

        if not has_edit_access:
            logger.warning(
                "unlink_screenshot_project_access_denied",
                screenshot_id=str(screenshot_id),
                project_id=screenshot.project_id,
                user_id=current_user.id,
            )
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


@router.get(
    "/screenshots/{screenshot_id}/url",
    response_model=PresignedUrlResponse,
)
async def get_screenshot_presigned_url(
    screenshot_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> Any:
    """
    Generate a fresh presigned URL for accessing a screenshot.

    Only accessible if user has permission to view the screenshot's session.

    This endpoint generates presigned URLs on-demand with a 30-day expiration,
    instead of storing them in the database. This ensures URLs are always fresh
    and reduces database storage requirements.

    - **screenshot_id**: UUID of the automation screenshot
    - **expiration**: 30 days (2,592,000 seconds)

    Returns a fresh presigned URL with expiration timestamp.
    """
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
        has_access = False
        if screenshot.session.project_id is not None:
            from app.models.organization import PermissionLevel

            has_access = await permission_service.can_user_access_project(
                db, current_user.id, screenshot.session.project_id, PermissionLevel.VIEW
            )
        else:
            has_access = screenshot.session.user_id == current_user.id

        if not has_access:
            logger.warning(
                "screenshot_url_access_denied",
                screenshot_id=str(screenshot_id),
                user_id=current_user.id,
                session_id=screenshot.session_id,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Screenshot '{screenshot_id}' not found",
            )

    # Generate fresh presigned URL (30 days = 2,592,000 seconds)
    expiration_seconds = 30 * 24 * 60 * 60  # 30 days
    try:
        presigned_url = object_storage.generate_presigned_url(
            screenshot.storage_path, expiration=expiration_seconds
        )
    except Exception as e:
        logger.error(
            "screenshot_presigned_url_generation_failed",
            screenshot_id=str(screenshot_id),
            storage_path=screenshot.storage_path,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate presigned URL",
        )

    # Calculate expiration timestamp
    expires_at = datetime.utcnow() + timedelta(seconds=expiration_seconds)

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
) -> Any:
    """
    Get paginated logs for an automation session.

    Only accessible if user has permission to view the session.

    - **skip**: Number of logs to skip for pagination (default: 0)
    - **limit**: Maximum logs to return (1-1000, default: 100)
    - **level**: Optional filter by log level (debug, info, warning, error)
    - **order_by**: Field to order by (timestamp or sequence_number, default: timestamp)
    - **order_desc**: Order descending (newest first, default: false)

    Returns paginated logs with total count.
    """
    logger.info(
        "get_session_logs_paginated",
        session_id=str(session_id),
        user_id=current_user.id,
        skip=skip,
        limit=limit,
        level=level,
        order_by=order_by,
        order_desc=order_desc,
    )

    # Verify session exists and check permission
    session_query = select(AutomationSession).where(AutomationSession.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission
    has_access = False
    if session.project_id is not None:
        from app.models.organization import PermissionLevel

        has_access = await permission_service.can_user_access_project(
            db, current_user.id, session.project_id, PermissionLevel.VIEW
        )
    else:
        has_access = session.user_id == current_user.id

    if not has_access:
        logger.warning(
            "session_logs_access_denied",
            session_id=str(session_id),
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Build query
    query = select(AutomationLog).where(AutomationLog.session_id == session_id)

    # Apply level filter
    if level:
        query = query.where(AutomationLog.level == level.lower())

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    # Apply ordering
    if order_by == "sequence_number":
        order_field = AutomationLog.sequence_number
    else:
        order_field = AutomationLog.timestamp

    if order_desc:
        query = query.order_by(order_field.desc())
    else:
        query = query.order_by(order_field.asc())

    # Apply pagination
    query = query.offset(skip).limit(limit)

    # Execute query
    result = await db.execute(query)
    logs = result.scalars().all()

    # Convert logs to dict
    logs_data = [
        {
            "id": log.id,
            "sequence_number": log.sequence_number,
            "level": log.level,
            "message": log.message,
            "log_data": log.log_data,
            "timestamp": log.timestamp.isoformat() + "Z",
            "created_at": log.created_at.isoformat() + "Z",
        }
        for log in logs
    ]

    return PaginatedLogsResponse(
        logs=logs_data,
        total=total,
        limit=limit,
        offset=skip,
    )


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
) -> Any:
    """
    Get paginated screenshots for an automation session.

    Only accessible if user has permission to view the session.

    - **skip**: Number of screenshots to skip for pagination (default: 0)
    - **limit**: Maximum screenshots to return (1-1000, default: 100)
    - **order_desc**: Order descending (newest first, default: false)

    Returns paginated screenshots with total count.

    Note: Presigned URLs are NOT included in this response for performance.
    Use GET /screenshots/{screenshot_id}/url to generate fresh presigned URLs on-demand.
    """
    logger.info(
        "get_session_screenshots_paginated",
        session_id=str(session_id),
        user_id=current_user.id,
        skip=skip,
        limit=limit,
        order_desc=order_desc,
    )

    # Verify session exists and check permission
    session_query = select(AutomationSession).where(AutomationSession.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Check permission
    has_access = False
    if session.project_id is not None:
        from app.models.organization import PermissionLevel

        has_access = await permission_service.can_user_access_project(
            db, current_user.id, session.project_id, PermissionLevel.VIEW
        )
    else:
        has_access = session.user_id == current_user.id

    if not has_access:
        logger.warning(
            "session_screenshots_access_denied",
            session_id=str(session_id),
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Build query
    query = select(AutomationScreenshot).where(
        AutomationScreenshot.session_id == session_id
    )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    # Apply ordering
    if order_desc:
        query = query.order_by(AutomationScreenshot.timestamp.desc())
    else:
        query = query.order_by(AutomationScreenshot.timestamp.asc())

    # Apply pagination
    query = query.offset(skip).limit(limit)

    # Execute query
    result = await db.execute(query)
    screenshots = result.scalars().all()

    # Convert screenshots to dict (excluding presigned_url for performance)
    screenshots_data = [
        {
            "id": str(screenshot.id),
            "name": screenshot.name,
            "storage_path": screenshot.storage_path,
            "width": screenshot.width,
            "height": screenshot.height,
            "content_type": screenshot.content_type,
            "automation_metadata": screenshot.automation_metadata,
            "timestamp": screenshot.timestamp.isoformat() + "Z",
            "created_at": screenshot.created_at.isoformat() + "Z",
            "project_id": screenshot.project_id,
        }
        for screenshot in screenshots
    ]

    return PaginatedScreenshotsResponse(
        screenshots=screenshots_data,
        total=total,
        limit=limit,
        offset=skip,
    )
