"""
Repository for execution screenshot database operations.

Handles query logic for execution screenshots, encapsulating database access
and providing reusable methods for listing, filtering, and storage operations.
"""

from uuid import UUID

import structlog
from app.models.execution_screenshot import ExecutionScreenshot, ExecutionScreenshotType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ExecutionScreenshotRepository:
    """Repository for execution screenshot database operations."""

    @staticmethod
    async def list_for_run(
        db: AsyncSession,
        run_id: UUID,
        screenshot_type: ExecutionScreenshotType | None = None,
    ) -> list[ExecutionScreenshot]:
        """
        List screenshots for a run with optional type filtering.

        Args:
            db: Database session
            run_id: ID of the execution run
            screenshot_type: Optional filter by screenshot type

        Returns:
            List of ExecutionScreenshot ordered by sequence_number
        """
        query = select(ExecutionScreenshot).where(ExecutionScreenshot.run_id == run_id)

        if screenshot_type:
            query = query.where(ExecutionScreenshot.screenshot_type == screenshot_type)

        query = query.order_by(ExecutionScreenshot.sequence_number)

        result = await db.execute(query)
        screenshots = list(result.scalars().all())

        logger.debug(
            "list_for_run_executed",
            run_id=str(run_id),
            count=len(screenshots),
        )

        return screenshots

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        screenshot_id: UUID,
    ) -> ExecutionScreenshot | None:
        """
        Get screenshot by ID.

        Args:
            db: Database session
            screenshot_id: ID of the screenshot

        Returns:
            ExecutionScreenshot or None if not found
        """
        query = select(ExecutionScreenshot).where(
            ExecutionScreenshot.id == screenshot_id
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_ids(
        db: AsyncSession,
        screenshot_ids: list[UUID],
    ) -> list[ExecutionScreenshot]:
        """
        Get multiple screenshots by their IDs.

        Args:
            db: Database session
            screenshot_ids: List of screenshot IDs

        Returns:
            List of ExecutionScreenshot
        """
        if not screenshot_ids:
            return []

        query = select(ExecutionScreenshot).where(
            ExecutionScreenshot.id.in_(screenshot_ids)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def create(
        db: AsyncSession,
        screenshot: ExecutionScreenshot,
    ) -> ExecutionScreenshot:
        """
        Create a new screenshot record.

        Args:
            db: Database session
            screenshot: ExecutionScreenshot instance to create

        Returns:
            Created ExecutionScreenshot with populated ID
        """
        db.add(screenshot)
        await db.commit()
        await db.refresh(screenshot)

        logger.info(
            "screenshot_created",
            screenshot_id=str(screenshot.id),
            run_id=str(screenshot.run_id),
        )

        return screenshot
