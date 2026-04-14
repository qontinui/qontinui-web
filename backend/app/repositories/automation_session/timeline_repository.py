"""
Timeline repository for automation session event timelines.

Handles: get_session_timeline
"""

from uuid import UUID

import structlog
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.repositories.automation_session.schemas import TimelineEventData
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class TimelineRepository:
    """
    Repository for session timeline operations.

    Merges logs and screenshots into a single chronological timeline.
    """

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
