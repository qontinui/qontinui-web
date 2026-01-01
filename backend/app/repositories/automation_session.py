"""
Repository for automation session database operations.

Extracts complex query logic from automation.py endpoints into reusable methods.
Handles sessions, logs, screenshots, and their statistics.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.repositories.base import BaseRepository

logger = structlog.get_logger(__name__)


class AutomationSessionCreate(BaseModel):
    """Schema for creating an automation session."""

    project_id: UUID | None = None
    user_id: UUID
    runner_version: str
    runner_os: str
    runner_hostname: str
    status: str = "active"
    configuration_snapshot: dict[str, Any] = {}
    max_duration_seconds: int = 28800


class SessionWithStats(BaseModel):
    """A session with computed log and screenshot counts."""

    session: AutomationSession
    log_count: int
    screenshot_count: int

    class Config:
        arbitrary_types_allowed = True


class ImageRecognitionStatsData(BaseModel):
    """Per-image recognition statistics."""

    image_id: str
    total_attempts: int
    successful: int
    failed: int
    success_rate: float
    avg_confidence: float | None


class ImageRecognitionReportData(BaseModel):
    """Complete image recognition report for a session."""

    session_id: UUID
    total_attempts: int
    successful: int
    failed: int
    overall_success_rate: float
    images: list[ImageRecognitionStatsData]


class TimelineEventData(BaseModel):
    """A single event in the session timeline."""

    event_type: str  # "log" or "screenshot"
    timestamp: datetime
    id: UUID
    data: dict[str, Any]


class AutomationSessionRepository(
    BaseRepository[AutomationSession, AutomationSessionCreate]
):
    """
    Repository for automation session database operations.

    Provides specialized query methods for automation sessions including:
    - List sessions with log/screenshot counts
    - Session timeline (merged logs + screenshots)
    - Image recognition statistics
    - Screenshot with input associations
    """

    def __init__(self) -> None:
        super().__init__(AutomationSession)

    async def list_with_stats(
        self,
        db: AsyncSession,
        accessible_project_ids: list[UUID],
        user_id: UUID,
        status: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        List automation sessions with log and screenshot counts.

        Sessions are returned if:
        - Session is linked to a project where user has VIEW+ permission, OR
        - Session is not linked to a project and was created by the user

        Args:
            db: Async database session
            accessible_project_ids: List of project UUIDs the user can access
            user_id: ID of the current user
            status: Optional filter by session status
            start_date: Optional filter for sessions created after this date
            end_date: Optional filter for sessions created before this date
            skip: Number of sessions to skip (pagination)
            limit: Maximum number of sessions to return

        Returns:
            Tuple of (list of session dicts with stats, total count)
        """
        # Build subqueries for counts (executed once, not per session)
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
                        AutomationSession.user_id == user_id,
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

        # Execute query
        result = await db.execute(query)
        rows = result.all()

        # Build response from query results
        sessions_with_stats = []
        for row in rows:
            session = row[0]
            log_count = row[1]
            screenshot_count = row[2]

            sessions_with_stats.append(
                {
                    "id": session.id,
                    "project_id": session.project_id,
                    "user_id": session.user_id,
                    "runner_version": session.runner_version,
                    "runner_os": session.runner_os,
                    "runner_hostname": session.runner_hostname,
                    "status": session.status,
                    "configuration_snapshot": session.configuration_snapshot,
                    "created_at": session.created_at,
                    "ended_at": session.ended_at,
                    "log_count": log_count,
                    "screenshot_count": screenshot_count,
                }
            )

        logger.debug(
            "list_with_stats_completed",
            user_id=str(user_id),
            session_count=len(sessions_with_stats),
            total=total,
        )

        return sessions_with_stats, total

    async def get_with_stats(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> dict[str, Any] | None:
        """
        Get a single session with log and screenshot counts.

        Args:
            db: Async database session
            session_id: UUID of the session to retrieve

        Returns:
            Session dict with stats if found, None otherwise
        """
        # Build scalar subqueries for counts
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

        # Single query to fetch session + counts
        query = select(
            AutomationSession,
            log_count_subquery.label("log_count"),
            screenshot_count_subquery.label("screenshot_count"),
        ).where(AutomationSession.id == session_id)

        result = await db.execute(query)
        row = result.one_or_none()

        if not row:
            return None

        session = row[0]
        log_count = row[1]
        screenshot_count = row[2]

        return {
            "id": session.id,
            "project_id": session.project_id,
            "user_id": session.user_id,
            "runner_version": session.runner_version,
            "runner_os": session.runner_os,
            "runner_hostname": session.runner_hostname,
            "status": session.status,
            "configuration_snapshot": session.configuration_snapshot,
            "created_at": session.created_at,
            "ended_at": session.ended_at,
            "log_count": log_count,
            "screenshot_count": screenshot_count,
        }

    async def get_session_timeline(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> tuple[AutomationSession | None, list[TimelineEventData]]:
        """
        Get chronological timeline of all events (logs + screenshots) for a session.

        Merges logs and screenshots into a single timeline sorted by timestamp.

        Args:
            db: Async database session
            session_id: UUID of the session

        Returns:
            Tuple of (session, list of timeline events) or (None, []) if not found
        """
        # Verify session exists
        session_query = select(AutomationSession).where(
            AutomationSession.id == session_id
        )
        session_result = await db.execute(session_query)
        session = session_result.scalar_one_or_none()

        if not session:
            return None, []

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
        timeline: list[TimelineEventData] = []

        # Add log events
        for log in logs:
            timeline.append(
                TimelineEventData(
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
                TimelineEventData(
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

        logger.debug(
            "get_session_timeline_completed",
            session_id=str(session_id),
            log_count=len(logs),
            screenshot_count=len(screenshots),
            total_events=len(timeline),
        )

        return session, timeline

    async def get_image_recognition_stats(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> tuple[AutomationSession | None, ImageRecognitionReportData | None]:
        """
        Query image recognition logs and calculate statistics.

        Analyzes all image_recognition events in the session:
        - Overall statistics (total attempts, success rate)
        - Per-image statistics (grouped by image_id)
        - Average confidence scores

        Only includes logs where log_data->>'event_type' = 'image_recognition'.

        Args:
            db: Async database session
            session_id: UUID of the session

        Returns:
            Tuple of (session, report) or (None, None) if session not found.
            If no image recognition events, returns session with empty report.
        """
        # Verify session exists
        session_query = select(AutomationSession).where(
            AutomationSession.id == session_id
        )
        session_result = await db.execute(session_query)
        session = session_result.scalar_one_or_none()

        if not session:
            return None, None

        # Query image recognition logs
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
            return session, ImageRecognitionReportData(
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

        # Build per-image statistics list
        image_stats_list: list[ImageRecognitionStatsData] = []
        for image_id, stats in image_stats_map.items():
            success_rate = (
                (stats["successful"] / stats["total"] * 100)
                if stats["total"] > 0
                else 0.0
            )
            avg_confidence = (
                sum(stats["confidences"]) / len(stats["confidences"])
                if stats["confidences"]
                else None
            )

            image_stats_list.append(
                ImageRecognitionStatsData(
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

        report = ImageRecognitionReportData(
            session_id=session_id,
            total_attempts=total_attempts,
            successful=successful,
            failed=failed,
            overall_success_rate=overall_success_rate,
            images=image_stats_list,
        )

        logger.debug(
            "get_image_recognition_stats_completed",
            session_id=str(session_id),
            total_attempts=total_attempts,
            successful=successful,
            failed=failed,
            image_count=len(image_stats_list),
        )

        return session, report

    async def get_screenshot_with_inputs(
        self,
        db: AsyncSession,
        screenshot_id: UUID,
    ) -> tuple[AutomationScreenshot | None, list[dict[str, Any]]]:
        """
        Get screenshot with all associated input events.

        Uses eager loading for input associations.

        Args:
            db: Async database session
            screenshot_id: UUID of the screenshot

        Returns:
            Tuple of (screenshot, list of input dicts) or (None, []) if not found.
        """
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
            return None, []

        # Build input events array
        inputs: list[dict[str, Any]] = []

        if screenshot.input_associations:
            # Get the associated logs for each input
            for assoc in screenshot.input_associations:
                log_query = select(AutomationLog).where(
                    AutomationLog.id == assoc.log_id
                )
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

        logger.debug(
            "get_screenshot_with_inputs_completed",
            screenshot_id=str(screenshot_id),
            input_count=len(inputs),
        )

        return screenshot, inputs

    async def check_session_access(
        self,
        db: AsyncSession,
        session: AutomationSession,
        user_id: UUID,
        accessible_project_ids: list[UUID],
    ) -> bool:
        """
        Check if a user can access a session.

        Access is granted if:
        - Session is linked to a project in accessible_project_ids, OR
        - Session has no project and was created by the user

        Args:
            db: Async database session (for future permission checks)
            session: The automation session to check
            user_id: ID of the user requesting access
            accessible_project_ids: List of project UUIDs the user can access

        Returns:
            True if user has access, False otherwise
        """
        if session.project_id is not None:
            # Session is linked to a project - check if user has access
            return session.project_id in accessible_project_ids
        else:
            # No project linked - check if user created the session
            return session.user_id == user_id

    async def get_session_logs_paginated(
        self,
        db: AsyncSession,
        session_id: UUID,
        skip: int = 0,
        limit: int = 100,
        level: str | None = None,
        order_by: str = "timestamp",
        order_desc: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Get paginated logs for an automation session.

        Args:
            db: Async database session
            session_id: UUID of the session
            skip: Number of logs to skip for pagination
            limit: Maximum logs to return
            level: Optional filter by log level
            order_by: Field to order by (timestamp or sequence_number)
            order_desc: Order descending (newest first)

        Returns:
            Tuple of (list of log dicts, total count)
        """
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
            if order_desc:
                query = query.order_by(AutomationLog.sequence_number.desc())
            else:
                query = query.order_by(AutomationLog.sequence_number.asc())
        else:
            if order_desc:
                query = query.order_by(AutomationLog.timestamp.desc())
            else:
                query = query.order_by(AutomationLog.timestamp.asc())

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

        logger.debug(
            "get_session_logs_paginated_completed",
            session_id=str(session_id),
            log_count=len(logs_data),
            total=total,
        )

        return logs_data, total

    async def get_session_screenshots_paginated(
        self,
        db: AsyncSession,
        session_id: UUID,
        skip: int = 0,
        limit: int = 100,
        order_desc: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Get paginated screenshots for an automation session.

        Args:
            db: Async database session
            session_id: UUID of the session
            skip: Number of screenshots to skip for pagination
            limit: Maximum screenshots to return
            order_desc: Order descending (newest first)

        Returns:
            Tuple of (list of screenshot dicts, total count)
        """
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

        logger.debug(
            "get_session_screenshots_paginated_completed",
            session_id=str(session_id),
            screenshot_count=len(screenshots_data),
            total=total,
        )

        return screenshots_data, total


# Singleton instance for convenience
automation_session_repository = AutomationSessionRepository()
