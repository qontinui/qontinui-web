"""
Service for screenshot upload and visual comparison operations.

Handles screenshot uploads, thumbnail generation, and visual regression testing.
Separates business logic from HTTP handling.
"""

import io
from typing import Any
from uuid import UUID

import structlog
from PIL import Image
from qontinui_schemas.common import utc_now
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.test_screenshot import TestScreenshot, TestScreenshotType
from app.models.transition_execution import TransitionExecution
from app.schemas.testing import ScreenshotMetadata, VisualComparisonSummary
from app.services.object_storage import object_storage
from app.services.visual_comparison_service import VisualComparisonService

logger = structlog.get_logger(__name__)


class ScreenshotUploadError(Exception):
    """Raised when screenshot upload fails."""


class InvalidImageError(Exception):
    """Raised when the uploaded image is invalid."""


# Screenshot type string to enum mapping
SCREENSHOT_TYPE_MAP = {
    "state_verification": TestScreenshotType.STATE_VERIFICATION,
    "action_result": TestScreenshotType.ACTION_RESULT,
    "failure": TestScreenshotType.FAILURE,
    "error": TestScreenshotType.FAILURE,
    "before_action": TestScreenshotType.BEFORE_ACTION,
    "after_action": TestScreenshotType.AFTER_ACTION,
    "success": TestScreenshotType.ACTION_RESULT,
    "manual": TestScreenshotType.STATE_VERIFICATION,
    "periodic": TestScreenshotType.STATE_VERIFICATION,
}


class ScreenshotUploadService:
    """Service for screenshot upload operations."""

    def validate_content_type(self, content_type: str | None) -> None:
        """
        Validate the image content type.

        Args:
            content_type: MIME type of the uploaded file

        Raises:
            InvalidImageError: If content type is not allowed
        """
        allowed_types = ["image/png", "image/jpeg", "image/jpg"]
        if content_type not in allowed_types:
            raise InvalidImageError(
                f"Invalid image type: {content_type}. Only PNG and JPEG are allowed."
            )

    async def upload_screenshot(
        self,
        db: AsyncSession,
        run_id: UUID,
        metadata: ScreenshotMetadata,
        image_data: bytes,
        original_filename: str | None,
        content_type: str | None,
    ) -> dict[str, Any]:
        """
        Upload a screenshot with metadata.

        Args:
            db: Database session
            run_id: Test run ID
            metadata: Screenshot metadata
            image_data: Raw image bytes
            original_filename: Original filename
            content_type: MIME type

        Returns:
            Dictionary with upload result data

        Raises:
            ScreenshotUploadError: If upload fails
        """
        logger.info(
            "uploading_screenshot",
            run_id=str(run_id),
            screenshot_id=str(metadata.screenshot_id),
            filename=original_filename,
        )

        file_size = len(image_data)
        screenshot_key = (
            f"testing/{run_id}/screenshots/"
            f"{metadata.sequence_number}_{metadata.screenshot_id}.png"
        )

        try:
            # Upload main image
            image_url = await self._upload_image(
                image_data, screenshot_key, content_type or "image/png"
            )

            # Generate and upload thumbnail
            thumbnail_url = await self._generate_thumbnail(image_data, run_id, metadata)

            # Find associated transition execution if provided
            transition_execution_id = await self._find_transition(
                db, run_id, metadata.transition_sequence_number
            )

            # Create database record
            test_screenshot = await self._create_screenshot_record(
                db=db,
                run_id=run_id,
                metadata=metadata,
                screenshot_key=screenshot_key,
                file_size=file_size,
                thumbnail_url=thumbnail_url,
                original_filename=original_filename,
                content_type=content_type,
                transition_execution_id=transition_execution_id,
            )

            logger.info(
                "screenshot_uploaded",
                run_id=str(run_id),
                screenshot_id=str(metadata.screenshot_id),
                file_size=file_size,
                state_name=metadata.state,
            )

            # Perform visual comparison if state is provided
            visual_comparison = await self._perform_visual_comparison(
                db, test_screenshot, metadata.state
            )

            await db.commit()

            return {
                "screenshot_id": metadata.screenshot_id,
                "run_id": run_id,
                "image_url": image_url,
                "thumbnail_url": thumbnail_url,
                "uploaded_at": utc_now(),
                "file_size_bytes": file_size,
                "state_name": metadata.state,
                "visual_comparison": visual_comparison,
            }

        except Exception as e:
            logger.error(
                "screenshot_upload_failed",
                run_id=str(run_id),
                error=str(e),
            )
            raise ScreenshotUploadError(f"Failed to upload screenshot: {str(e)}") from e

    async def _upload_image(
        self, image_data: bytes, key: str, content_type: str
    ) -> str:
        """Upload image to object storage and return URL."""
        image_file = io.BytesIO(image_data)
        object_storage.backend.upload_file(
            image_file,
            key,
            content_type=content_type,
        )
        return object_storage.generate_presigned_url(key, expiration=7 * 24 * 3600)

    async def _generate_thumbnail(
        self,
        image_data: bytes,
        run_id: UUID,
        metadata: ScreenshotMetadata,
    ) -> str | None:
        """Generate and upload thumbnail, return URL or None if failed."""
        try:
            pil_image = Image.open(io.BytesIO(image_data))
            thumbnail = pil_image.copy()
            thumbnail.thumbnail((200, 200), Image.Resampling.LANCZOS)

            thumb_buffer = io.BytesIO()
            thumbnail.save(thumb_buffer, format="PNG")
            thumb_buffer.seek(0)

            thumbnail_key = (
                f"testing/{run_id}/thumbnails/"
                f"{metadata.sequence_number}_{metadata.screenshot_id}_thumb.png"
            )
            object_storage.backend.upload_file(
                thumb_buffer,
                thumbnail_key,
                content_type="image/png",
            )
            return object_storage.generate_presigned_url(
                thumbnail_key, expiration=7 * 24 * 3600
            )
        except Exception as thumb_error:
            logger.warning(
                "thumbnail_generation_failed",
                run_id=str(run_id),
                screenshot_id=str(metadata.screenshot_id),
                error=str(thumb_error),
            )
            return None

    async def _find_transition(
        self,
        db: AsyncSession,
        run_id: UUID,
        transition_sequence_number: int | None,
    ) -> UUID | None:
        """Find transition execution by sequence number."""
        if not transition_sequence_number:
            return None

        result = await db.execute(
            select(TransitionExecution).filter(
                and_(
                    TransitionExecution.test_run_id == run_id,
                    TransitionExecution.sequence_number == transition_sequence_number,
                )
            )
        )
        transition = result.scalar_one_or_none()
        return transition.id if transition else None

    async def _create_screenshot_record(
        self,
        db: AsyncSession,
        run_id: UUID,
        metadata: ScreenshotMetadata,
        screenshot_key: str,
        file_size: int,
        thumbnail_url: str | None,
        original_filename: str | None,
        content_type: str | None,
        transition_execution_id: UUID | None,
    ) -> TestScreenshot:
        """Create screenshot database record."""
        db_screenshot_type = SCREENSHOT_TYPE_MAP.get(
            metadata.screenshot_type, TestScreenshotType.STATE_VERIFICATION
        )

        test_screenshot = TestScreenshot(
            id=metadata.screenshot_id,
            test_run_id=run_id,
            transition_execution_id=transition_execution_id,
            screenshot_type=db_screenshot_type,
            storage_path=screenshot_key,
            width=metadata.width,
            height=metadata.height,
            captured_at=metadata.timestamp,
            screenshot_metadata={
                "sequence_number": metadata.sequence_number,
                "original_filename": original_filename,
                "content_type": content_type,
                "file_size_bytes": file_size,
                "thumbnail_url": thumbnail_url,
                **metadata.metadata,
            },
            state_name=metadata.state,
        )
        db.add(test_screenshot)
        await db.flush()

        return test_screenshot

    async def _perform_visual_comparison(
        self,
        db: AsyncSession,
        screenshot: TestScreenshot,
        state_name: str | None,
    ) -> VisualComparisonSummary | None:
        """Perform visual comparison if state is provided."""
        if not state_name:
            return None

        try:
            comparison_service = VisualComparisonService()
            comparison = await comparison_service.compare_screenshot(
                db=db,
                screenshot_id=screenshot.id,
            )

            if comparison:
                # Get presigned URL for diff image if available
                diff_url = None
                if comparison.diff_image_path:
                    try:
                        diff_url = object_storage.generate_presigned_url(
                            comparison.diff_image_path
                        )
                    except Exception:
                        pass

                result = VisualComparisonSummary(
                    comparison_id=comparison.id,
                    baseline_id=comparison.baseline_id,
                    similarity_score=comparison.similarity_score,
                    threshold=comparison.threshold_used,
                    passed=comparison.status == "passed",
                    status=comparison.status,
                    diff_image_url=diff_url,
                    diff_region_count=comparison.diff_region_count,
                )

                logger.info(
                    "visual_comparison_completed",
                    screenshot_id=str(screenshot.id),
                    state_name=state_name,
                    similarity_score=comparison.similarity_score,
                    status=comparison.status,
                )

                return result

        except Exception as comparison_error:
            logger.warning(
                "visual_comparison_failed",
                screenshot_id=str(screenshot.id),
                state_name=state_name,
                error=str(comparison_error),
            )

        return None


# Singleton instance
screenshot_upload_service = ScreenshotUploadService()
