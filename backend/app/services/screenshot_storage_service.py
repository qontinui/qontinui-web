"""
Service for screenshot storage and retrieval operations.

Handles uploading screenshots to object storage, generating thumbnails,
and retrieving screenshot records with related data.
"""

import io
from datetime import UTC, datetime
from uuid import UUID

import structlog
from fastapi import HTTPException, UploadFile, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.capture import CaptureScreenshot
from app.services.object_storage import object_storage
from app.services.session_repository import SessionRepository
from app.services.storage_service import StorageService

logger = structlog.get_logger(__name__)


class ScreenshotStorageService:
    """Service for managing screenshot storage and retrieval."""

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
        session = await SessionRepository.get_by_id(db, session_id, user_id)

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
        await SessionRepository.get_by_id(db, session_id, user_id)

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
