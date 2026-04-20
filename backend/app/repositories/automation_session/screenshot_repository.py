"""
Screenshot repository for automation session screenshot queries.

Handles: get_session_screenshots_paginated, get_screenshot_with_inputs
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot

logger = structlog.get_logger(__name__)


class ScreenshotRepository:
    """
    Repository for automation session screenshot operations.

    Provides paginated screenshot access and screenshot-to-input associations.
    """

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
