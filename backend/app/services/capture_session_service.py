"""
Service layer for capture session management.

Handles business logic for creating, managing, and analyzing capture sessions
in the workflow learning pipeline.
"""

import io
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import structlog
from fastapi import HTTPException, UploadFile, status
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.capture import CaptureAction, CaptureScreenshot, CaptureSession
from app.schemas.capture import (
    CaptureActionCreate,
    CaptureSessionCreate,
    CaptureSessionUpdate,
)
from app.services.object_storage import object_storage
from app.services.state_matching_service import StateMatchingService
from app.services.storage_service import StorageService

logger = structlog.get_logger(__name__)


class CaptureSessionService:
    """Service for managing capture sessions and related entities."""

    @staticmethod
    async def create_session(
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        session_data: CaptureSessionCreate,
    ) -> CaptureSession:
        """
        Create a new capture session.

        Args:
            db: Database session
            project_id: ID of the project
            user_id: ID of the user creating the session
            session_data: Session creation data

        Returns:
            The created CaptureSession
        """
        session = CaptureSession(
            project_id=project_id,
            user_id=user_id,
            name=session_data.name,
            description=session_data.description,
            status="capturing",
            extra_metadata=session_data.extra_metadata,
            created_at=datetime.now(UTC),
        )

        db.add(session)
        await db.commit()
        await db.refresh(session)

        logger.info(
            "capture_session_created",
            session_id=str(session.id),
            project_id=project_id,
            user_id=str(user_id),
            name=session_data.name,
        )

        return session

    @staticmethod
    async def get_session(
        db: AsyncSession, session_id: UUID, user_id: UUID
    ) -> CaptureSession:
        """
        Get a capture session by ID.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization check)

        Returns:
            The CaptureSession

        Raises:
            HTTPException: If session not found or user doesn't have access
        """
        result = await db.execute(
            select(CaptureSession)
            .options(selectinload(CaptureSession.screenshots))
            .filter(CaptureSession.id == session_id, CaptureSession.user_id == user_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Capture session {session_id} not found",
            )

        return session

    @staticmethod
    async def list_sessions(
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID | None = None,
        status_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[CaptureSession], int]:
        """
        List capture sessions for a user.

        Args:
            db: Database session
            user_id: ID of the user
            project_id: Optional filter by project
            status_filter: Optional filter by status
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (sessions list, total count)
        """
        # Build query
        query = select(CaptureSession).filter(CaptureSession.user_id == user_id)

        if project_id:
            query = query.filter(CaptureSession.project_id == project_id)

        if status_filter:
            query = query.filter(CaptureSession.status == status_filter)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Get paginated results
        query = query.order_by(CaptureSession.created_at.desc())
        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        sessions = result.scalars().all()

        return list(sessions), total

    @staticmethod
    async def update_session(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        update_data: CaptureSessionUpdate,
    ) -> CaptureSession:
        """
        Update a capture session.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization)
            update_data: Update data

        Returns:
            The updated CaptureSession
        """
        session = await CaptureSessionService.get_session(db, session_id, user_id)

        # Update fields
        if update_data.name is not None:
            session.name = update_data.name
        if update_data.description is not None:
            session.description = update_data.description
        if update_data.status is not None:
            session.status = update_data.status
            # Set completed_at when status changes to completed
            if update_data.status == "completed":
                session.completed_at = datetime.now(UTC)
        if update_data.extra_metadata is not None:
            session.extra_metadata = update_data.extra_metadata

        await db.commit()
        await db.refresh(session)

        logger.info(
            "capture_session_updated",
            session_id=str(session_id),
            status=session.status,
        )

        return session

    @staticmethod
    async def delete_session(db: AsyncSession, session_id: UUID, user_id: UUID) -> bool:
        """
        Delete a capture session and all related data.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization)

        Returns:
            True if deleted
        """
        session = await CaptureSessionService.get_session(db, session_id, user_id)

        # Get all screenshots to delete from storage
        result = await db.execute(
            select(CaptureScreenshot).filter(CaptureScreenshot.session_id == session_id)
        )
        screenshots = result.scalars().all()

        # Delete images from storage
        for screenshot in screenshots:
            try:
                # Extract key from URL
                key = Path(screenshot.image_url).name
                object_storage.delete_file(key)
                if screenshot.thumbnail_url:
                    thumbnail_key = Path(screenshot.thumbnail_url).name
                    object_storage.delete_file(thumbnail_key)
            except Exception as e:
                logger.warning(
                    "failed_to_delete_screenshot_file",
                    screenshot_id=str(screenshot.id),
                    error=str(e),
                )

        # Delete session (cascade will handle related records)
        await db.delete(session)
        await db.commit()

        logger.info(
            "capture_session_deleted",
            session_id=str(session_id),
            screenshot_count=len(screenshots),
        )

        return True

    @staticmethod
    async def upload_screenshot(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        sequence_number: int,
        file: UploadFile,
        subscription_tier: str,
        extra_metadata: dict | None = None,
    ) -> CaptureScreenshot:
        """
        Upload a screenshot to a capture session.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user
            sequence_number: Order within session
            file: Uploaded image file
            subscription_tier: User's subscription tier (for quota check)
            extra_metadata: Optional metadata

        Returns:
            The created CaptureScreenshot

        Raises:
            HTTPException: If upload fails or quota exceeded
        """
        # Verify session exists and user has access
        session = await CaptureSessionService.get_session(db, session_id, user_id)

        # Read file
        file_content = await file.read()
        file_size = len(file_content)

        # Check storage quota
        await StorageService.check_quota(
            db, user_id, subscription_tier, additional_bytes=file_size
        )

        # Open image to get dimensions
        try:
            image = Image.open(io.BytesIO(file_content))
            width, height = image.size
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid image file: {str(e)}",
            )

        # Generate storage keys
        screenshot_key = (
            f"capture/{session_id}/screenshots/{sequence_number}_{session.id}.png"
        )
        thumbnail_key = (
            f"capture/{session_id}/thumbnails/{sequence_number}_{session.id}_thumb.png"
        )

        # Upload to storage
        # Upload full image
        file_obj = io.BytesIO(file_content)
        image_url = object_storage.backend.upload_file(
            file_obj, screenshot_key, content_type="image/png"
        )

        # Generate and upload thumbnail (200px wide max)
        thumbnail_url = None
        try:
            thumbnail = image.copy()
            thumbnail.thumbnail((200, 200), Image.Resampling.LANCZOS)
            thumb_buffer = io.BytesIO()
            thumbnail.save(thumb_buffer, format="PNG")
            thumb_buffer.seek(0)
            thumbnail_url = object_storage.backend.upload_file(
                thumb_buffer, thumbnail_key, content_type="image/png"
            )
        except Exception as e:
            logger.warning("thumbnail_generation_failed", error=str(e))

        # Track storage usage
        await StorageService.track_upload(
            db=db,
            user_id=user_id,
            file_path=screenshot_key,
            file_size_bytes=file_size,
            file_type="capture_screenshot",
            project_id=str(session.project_id),
            metadata={
                "session_id": str(session_id),
                "sequence_number": sequence_number,
                "width": width,
                "height": height,
            },
        )

        # Create screenshot record
        screenshot = CaptureScreenshot(
            session_id=session_id,
            sequence_number=sequence_number,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            width=width,
            height=height,
            timestamp=datetime.now(UTC),
            extra_metadata=extra_metadata,
            analysis_status="pending",
        )

        db.add(screenshot)
        await db.commit()
        await db.refresh(screenshot)

        logger.info(
            "screenshot_uploaded",
            screenshot_id=str(screenshot.id),
            session_id=str(session_id),
            sequence_number=sequence_number,
            file_size=file_size,
        )

        return screenshot

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
            # Verify screenshot access (could be optimized with a single query)
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
    async def get_session_screenshots(
        db: AsyncSession, session_id: UUID, user_id: UUID
    ) -> list[CaptureScreenshot]:
        """
        Get all screenshots for a session, ordered by sequence number.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization)

        Returns:
            List of screenshots
        """
        # Verify access
        await CaptureSessionService.get_session(db, session_id, user_id)

        # Get screenshots with related data
        result = await db.execute(
            select(CaptureScreenshot)
            .options(
                selectinload(CaptureScreenshot.actions),
                selectinload(CaptureScreenshot.detected_elements),
            )
            .filter(CaptureScreenshot.session_id == session_id)
            .order_by(CaptureScreenshot.sequence_number)
        )

        return list(result.scalars().all())

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

    @staticmethod
    async def match_session_to_states(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        confidence_threshold: float = 0.7,
    ) -> dict:
        """
        Match all screenshots in a session against known states.

        Args:
            db: Database session
            session_id: ID of the capture session
            user_id: ID of the user (for authorization)
            confidence_threshold: Minimum confidence for a match

        Returns:
            Dictionary with match statistics

        Raises:
            HTTPException: If session not found or user doesn't have access
        """
        # Verify session access
        session = await CaptureSessionService.get_session(db, session_id, user_id)

        # Get all screenshots for the session
        screenshots = await CaptureSessionService.get_session_screenshots(
            db, session_id, user_id
        )

        if not screenshots:
            return {
                "session_id": str(session_id),
                "total_screenshots": 0,
                "matched_screenshots": 0,
                "total_matches": 0,
                "unique_states": [],
            }

        # Match each screenshot
        total_matches = 0
        matched_screenshot_ids: set[UUID] = set()
        all_states: set[str] = set()

        for screenshot in screenshots:
            try:
                matches = await StateMatchingService.match_screenshot_to_states(
                    db=db,
                    screenshot_id=screenshot.id,
                    user_id=user_id,
                    confidence_threshold=confidence_threshold,
                )

                if matches:
                    total_matches += len(matches)
                    matched_screenshot_ids.add(screenshot.id)
                    all_states.update(m.state_identifier for m in matches)

            except Exception as e:
                logger.warning(
                    "screenshot_matching_failed",
                    screenshot_id=str(screenshot.id),
                    session_id=str(session_id),
                    error=str(e),
                )
                continue

        logger.info(
            "session_state_matching_completed",
            session_id=str(session_id),
            total_screenshots=len(screenshots),
            matched_screenshots=len(matched_screenshot_ids),
            total_matches=total_matches,
            unique_states=len(all_states),
        )

        return {
            "session_id": str(session_id),
            "total_screenshots": len(screenshots),
            "matched_screenshots": len(matched_screenshot_ids),
            "total_matches": total_matches,
            "unique_states": list(all_states),
        }
