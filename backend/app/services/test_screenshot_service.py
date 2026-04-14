"""
Screenshot service for test execution.

Provides screenshot storage, retrieval, and cleanup for software testing sessions.
Screenshots are stored in object storage (S3/MinIO) with metadata in the database.
"""

import base64
import io
from datetime import UTC, datetime
from uuid import UUID

import structlog
from app.services.screenshot_storage import screenshot_storage
from PIL import Image

logger = structlog.get_logger(__name__)


class TestScreenshotService:
    """Service for managing test execution screenshots."""

    def __init__(self):
        self.storage = screenshot_storage

    def store_screenshot(
        self,
        project_id: UUID,
        test_run_id: UUID,
        screenshot_base64: str,
        screenshot_type: str,
        transition_id: UUID | None = None,
        deficiency_id: UUID | None = None,
        metadata: dict | None = None,
    ) -> tuple[str, int, int]:
        """
        Store a screenshot to object storage and return its URL.

        Args:
            project_id: Project ID for organizing storage
            test_run_id: Test run ID for organizing storage
            screenshot_base64: Base64-encoded PNG image
            screenshot_type: Type of screenshot (see TestScreenshotType enum)
            transition_id: Optional transition execution ID
            deficiency_id: Optional deficiency ID
            metadata: Optional metadata dict (confidence scores, etc.)

        Returns:
            Tuple of (storage_url, width, height)

        Raises:
            ValueError: If base64 data is invalid or image cannot be decoded
            Exception: If storage upload fails
        """
        try:
            # Step 1: Decode base64 image
            try:
                image_bytes = base64.b64decode(screenshot_base64)
            except Exception as e:
                logger.error(
                    "screenshot_decode_failed",
                    test_run_id=str(test_run_id),
                    error=str(e),
                )
                raise ValueError(f"Failed to decode base64 image: {str(e)}")

            # Step 2: Extract image dimensions using PIL
            try:
                image_file = io.BytesIO(image_bytes)
                with Image.open(image_file) as img:
                    width, height = img.size
            except Exception as e:
                logger.error(
                    "screenshot_dimension_extraction_failed",
                    test_run_id=str(test_run_id),
                    error=str(e),
                )
                raise ValueError(f"Failed to extract image dimensions: {str(e)}")

            # Step 3: Generate storage key and timestamp
            # Format: tests/{project_id}/{test_run_id}/{transition_id}_{timestamp}.png
            datetime.now(UTC).strftime("%Y%m%d_%H%M%S_%f")
            if transition_id:
                pass
            elif deficiency_id:
                pass
            else:
                pass

            # Step 4: Upload to storage using screenshot_storage service
            # Prepare metadata for storage
            storage_metadata = {}
            if transition_id:
                storage_metadata["transition_id"] = str(transition_id)
            if deficiency_id:
                storage_metadata["deficiency_id"] = str(deficiency_id)
            if metadata:
                # Add custom metadata
                for key, value in metadata.items():
                    storage_metadata[key] = value

            try:
                # Use transition_id or deficiency_id as step_id, fallback to test_run_id
                step_id = transition_id or deficiency_id or test_run_id

                storage_url = self.storage.upload_screenshot(
                    run_id=test_run_id,
                    step_id=step_id,
                    image_bytes=image_bytes,
                    screenshot_type=screenshot_type,
                    metadata=storage_metadata,
                )

                logger.info(
                    "test_screenshot_uploaded",
                    project_id=str(project_id),
                    test_run_id=str(test_run_id),
                    transition_id=str(transition_id) if transition_id else None,
                    deficiency_id=str(deficiency_id) if deficiency_id else None,
                    width=width,
                    height=height,
                    screenshot_type=screenshot_type,
                )

                return storage_url, width, height

            except Exception as e:
                logger.error(
                    "test_screenshot_upload_failed",
                    project_id=str(project_id),
                    test_run_id=str(test_run_id),
                    error=str(e),
                    error_type=type(e).__name__,
                )
                raise

        except Exception as e:
            logger.error(
                "test_screenshot_storage_error",
                test_run_id=str(test_run_id),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def get_screenshot_url(self, storage_path: str, expiration: int = 3600) -> str:
        """
        Get a presigned URL for accessing a stored screenshot.

        Args:
            storage_path: Storage key/path for the screenshot
            expiration: URL expiration time in seconds (default: 1 hour)

        Returns:
            Presigned URL for accessing the screenshot

        Raises:
            Exception: If URL generation fails
        """
        try:
            url = self.storage.get_screenshot_url(storage_path, expiration)
            logger.debug(
                "test_screenshot_url_generated",
                storage_path=storage_path,
                expiration=expiration,
            )
            return url
        except Exception as e:
            logger.error(
                "test_screenshot_url_generation_failed",
                storage_path=storage_path,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def delete_test_run_screenshots(self, project_id: UUID, test_run_id: UUID) -> int:
        """
        Delete all screenshots for a test run.

        This method uses the screenshot storage service's bulk delete functionality
        to remove all screenshots associated with a test run.

        Args:
            project_id: Project ID for organizing storage
            test_run_id: Test run ID to delete screenshots for

        Returns:
            Number of screenshots deleted

        Raises:
            Exception: If deletion fails
        """
        try:
            deleted_count = self.storage.delete_screenshots(test_run_id)

            logger.info(
                "test_run_screenshots_deleted",
                project_id=str(project_id),
                test_run_id=str(test_run_id),
                deleted_count=deleted_count,
            )

            return deleted_count

        except Exception as e:
            logger.error(
                "test_run_screenshots_cleanup_error",
                project_id=str(project_id),
                test_run_id=str(test_run_id),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise


# Singleton instance
test_screenshot_service = TestScreenshotService()
