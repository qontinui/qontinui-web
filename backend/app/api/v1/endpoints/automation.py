"""
Automation Session API Endpoints

Endpoints for querying automation session data, including logs, screenshots,
and timeline analysis.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_db
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.schemas.automation import (
    AutomationSessionListResponse,
    AutomationSessionWithStats,
    ImageRecognitionReport,
    ImageRecognitionStats,
    ScreenshotWithInputs,
    SessionTimeline,
    TimelineEvent,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/sessions", response_model=AutomationSessionListResponse)
async def list_automation_sessions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    status: str | None = Query(None, description="Filter by session status"),
    start_date: datetime | None = Query(None, description="Filter sessions created after this date"),
    end_date: datetime | None = Query(None, description="Filter sessions created before this date"),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    List automation sessions with pagination and filtering.

    - **skip**: Number of sessions to skip (for pagination)
    - **limit**: Maximum number of sessions to return (1-100)
    - **status**: Filter by session status (active, completed, failed)
    - **start_date**: Filter sessions created after this date
    - **end_date**: Filter sessions created before this date

    Returns sessions with basic statistics (log count, screenshot count).
    """
    logger.info(
        "list_automation_sessions",
        skip=skip,
        limit=limit,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )

    # Build query with filters
    query = select(AutomationSession)

    if status:
        query = query.where(AutomationSession.status == status)
    if start_date:
        query = query.where(AutomationSession.created_at >= start_date)
    if end_date:
        query = query.where(AutomationSession.created_at <= end_date)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    # Apply pagination and ordering
    query = query.order_by(AutomationSession.created_at.desc())
    query = query.offset(skip).limit(limit)

    # Execute query
    result = await db.execute(query)
    sessions = result.scalars().all()

    # Build response with statistics
    sessions_with_stats = []
    for session in sessions:
        # Get counts from the eager-loaded relationships
        log_count = len(session.logs) if session.logs else 0
        screenshot_count = len(session.screenshots) if session.screenshots else 0

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
) -> Any:
    """
    Get details for a specific automation session.

    Returns session information with basic statistics.
    """
    logger.info("get_automation_session", session_id=str(session_id))

    # Query session with eager loading
    query = select(AutomationSession).where(AutomationSession.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation session '{session_id}' not found",
        )

    # Get counts
    log_count = len(session.logs) if session.logs else 0
    screenshot_count = len(session.screenshots) if session.screenshots else 0

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
) -> Any:
    """
    Get chronological timeline of all events (logs + screenshots) for a session.

    Merges logs and screenshots into a single timeline sorted by timestamp.
    Each event includes its type, timestamp, and full data.
    """
    logger.info("get_session_timeline", session_id=str(session_id))

    # First, verify the session exists
    session_query = select(AutomationSession).where(AutomationSession.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
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


@router.get("/sessions/{session_id}/image-recognition", response_model=ImageRecognitionReport)
async def get_image_recognition_stats(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Query image recognition logs and calculate statistics.

    Analyzes all image_recognition events in the session:
    - Overall statistics (total attempts, success rate)
    - Per-image statistics (grouped by image_id)
    - Average confidence scores

    Only includes logs where log_data->>'event_type' = 'image_recognition'.
    """
    logger.info("get_image_recognition_stats", session_id=str(session_id))

    # Verify session exists
    session_query = select(AutomationSession).where(AutomationSession.id == session_id)
    session_result = await db.execute(session_query)
    session = session_result.scalar_one_or_none()

    if not session:
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
    overall_success_rate = (successful / total_attempts * 100) if total_attempts > 0 else 0.0

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
) -> Any:
    """
    Get a screenshot with all associated input events.

    Returns the screenshot and an array of input events (clicks, types, etc.)
    that are associated with it through the ScreenshotInputAssociation table.
    """
    logger.info("get_screenshot_inputs", screenshot_id=str(screenshot_id))

    # Query screenshot with eager loading of input associations
    screenshot_query = (
        select(AutomationScreenshot)
        .where(AutomationScreenshot.id == screenshot_id)
        .options(selectinload(AutomationScreenshot.input_associations))
    )
    screenshot_result = await db.execute(screenshot_query)
    screenshot = screenshot_result.scalar_one_or_none()

    if not screenshot:
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
