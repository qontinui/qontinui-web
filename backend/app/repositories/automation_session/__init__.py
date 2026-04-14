"""
Automation session repository package.

Split into focused sub-repositories:
- SessionRepository: Core session CRUD and access control
- TimelineRepository: Session event timelines
- StatsRepository: Image recognition analytics
- LogRepository: Paginated session logs
- ScreenshotRepository: Paginated screenshots and input associations

The AutomationSessionRepository facade composes all sub-repositories
and delegates to them, preserving the original single-class API.
"""

from typing import Any
from uuid import UUID

from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.repositories.automation_session.log_repository import LogRepository
from app.repositories.automation_session.schemas import (
    AutomationSessionCreate, ImageRecognitionReportData,
    ImageRecognitionStatsData, SessionWithStats, TimelineEventData)
from app.repositories.automation_session.screenshot_repository import \
    ScreenshotRepository
from app.repositories.automation_session.session_repository import \
    SessionRepository
from app.repositories.automation_session.stats_repository import \
    StatsRepository
from app.repositories.automation_session.timeline_repository import \
    TimelineRepository
from sqlalchemy.ext.asyncio import AsyncSession


class AutomationSessionRepository(SessionRepository):
    """
    Facade repository that composes all automation session sub-repositories.

    Extends SessionRepository (which provides BaseRepository CRUD + list_with_stats,
    get_with_stats, check_session_access) and delegates timeline, stats, log, and
    screenshot operations to their respective sub-repositories.

    This preserves the original single-class API so consumers do not need to change.
    """

    def __init__(self) -> None:
        super().__init__()
        self._timeline = TimelineRepository()
        self._stats = StatsRepository()
        self._log = LogRepository()
        self._screenshot = ScreenshotRepository()

    async def get_session_timeline(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> tuple[AutomationSession | None, list[TimelineEventData]]:
        """Delegate to TimelineRepository."""
        return await self._timeline.get_session_timeline(db, session_id)

    async def get_image_recognition_stats(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> tuple[AutomationSession | None, ImageRecognitionReportData | None]:
        """Delegate to StatsRepository."""
        return await self._stats.get_image_recognition_stats(db, session_id)

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
        """Delegate to LogRepository."""
        return await self._log.get_session_logs_paginated(
            db,
            session_id,
            skip=skip,
            limit=limit,
            level=level,
            order_by=order_by,
            order_desc=order_desc,
        )

    async def get_session_screenshots_paginated(
        self,
        db: AsyncSession,
        session_id: UUID,
        skip: int = 0,
        limit: int = 100,
        order_desc: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """Delegate to ScreenshotRepository."""
        return await self._screenshot.get_session_screenshots_paginated(
            db,
            session_id,
            skip=skip,
            limit=limit,
            order_desc=order_desc,
        )

    async def get_screenshot_with_inputs(
        self,
        db: AsyncSession,
        screenshot_id: UUID,
    ) -> tuple[AutomationScreenshot | None, list[dict[str, Any]]]:
        """Delegate to ScreenshotRepository."""
        return await self._screenshot.get_screenshot_with_inputs(db, screenshot_id)


# Singleton instance for convenience
automation_session_repository = AutomationSessionRepository()

__all__ = [
    "AutomationSessionRepository",
    "automation_session_repository",
    "AutomationSessionCreate",
    "ImageRecognitionReportData",
    "ImageRecognitionStatsData",
    "SessionWithStats",
    "TimelineEventData",
    "LogRepository",
    "ScreenshotRepository",
    "SessionRepository",
    "StatsRepository",
    "TimelineRepository",
]
