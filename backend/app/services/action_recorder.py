"""
Service for recording and retrieving user actions.

Handles creating action records for user interactions within screenshots
and retrieving actions for analysis.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from app.models.capture import CaptureAction, CaptureScreenshot, CaptureSession
from app.schemas.capture import CaptureActionCreate
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ActionRecorder:
    """Service for recording and retrieving user actions."""

    @staticmethod
    async def create_action(
        db: AsyncSession, user_id: UUID, action_data: CaptureActionCreate
    ) -> CaptureAction:
        """
        Create a user action within a screenshot.

        Args:
            db: Database session
            user_id: ID of the user (for authorization)
            action_data: Action creation data

        Returns:
            The created CaptureAction
        """
        # Verify screenshot exists and belongs to user
        result = await db.execute(
            select(CaptureScreenshot)
            .join(CaptureSession)
            .filter(
                CaptureScreenshot.id == action_data.screenshot_id,
                CaptureSession.user_id == user_id,
            )
        )
        screenshot = result.scalar_one_or_none()

        if not screenshot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Screenshot not found or access denied",
            )

        # Create action
        action = CaptureAction(
            screenshot_id=action_data.screenshot_id,
            sequence_number=action_data.sequence_number,
            action_type=action_data.action_type,
            x=action_data.x,
            y=action_data.y,
            text=action_data.text,
            key=action_data.key,
            button=action_data.button,
            scroll_delta=action_data.scroll_delta,
            timestamp=datetime.now(UTC),
            extra_metadata=action_data.extra_metadata,
        )

        db.add(action)
        await db.commit()
        await db.refresh(action)

        logger.info(
            "action_created",
            action_id=str(action.id),
            screenshot_id=str(action_data.screenshot_id),
            action_type=action_data.action_type,
        )

        return action

    @staticmethod
    async def batch_create_actions(
        db: AsyncSession, user_id: UUID, actions_data: list[CaptureActionCreate]
    ) -> list[CaptureAction]:
        """
        Batch create multiple actions.

        Args:
            db: Database session
            user_id: ID of the user
            actions_data: List of action creation data

        Returns:
            List of created CaptureActions
        """
        actions = []

        for action_data in actions_data:
            # Verify screenshot access
            result = await db.execute(
                select(CaptureScreenshot)
                .join(CaptureSession)
                .filter(
                    CaptureScreenshot.id == action_data.screenshot_id,
                    CaptureSession.user_id == user_id,
                )
            )
            screenshot = result.scalar_one_or_none()

            if not screenshot:
                logger.warning(
                    "screenshot_not_found_skipping_action",
                    screenshot_id=str(action_data.screenshot_id),
                )
                continue

            action = CaptureAction(
                screenshot_id=action_data.screenshot_id,
                sequence_number=action_data.sequence_number,
                action_type=action_data.action_type,
                x=action_data.x,
                y=action_data.y,
                text=action_data.text,
                key=action_data.key,
                button=action_data.button,
                scroll_delta=action_data.scroll_delta,
                timestamp=datetime.now(UTC),
                extra_metadata=action_data.extra_metadata,
            )
            actions.append(action)

        # Bulk insert
        db.add_all(actions)
        await db.commit()

        logger.info("actions_batch_created", count=len(actions))

        return actions

    @staticmethod
    async def get_screenshot_actions(
        db: AsyncSession, screenshot_id: UUID, user_id: UUID
    ) -> list[CaptureAction]:
        """
        Get all actions for a screenshot, ordered by sequence number.

        Args:
            db: Database session
            screenshot_id: ID of the screenshot
            user_id: ID of the user (for authorization)

        Returns:
            List of actions
        """
        # Verify access
        result = await db.execute(
            select(CaptureScreenshot)
            .join(CaptureSession)
            .filter(
                CaptureScreenshot.id == screenshot_id,
                CaptureSession.user_id == user_id,
            )
        )
        screenshot = result.scalar_one_or_none()

        if not screenshot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Screenshot not found or access denied",
            )

        # Get actions
        result = await db.execute(
            select(CaptureAction)
            .filter(CaptureAction.screenshot_id == screenshot_id)
            .order_by(CaptureAction.sequence_number)
        )

        return list(result.scalars().all())
