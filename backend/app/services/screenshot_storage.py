"""
Screenshot storage service for test results using MinIO/S3.

Provides specialized screenshot management for test execution results:
- Upload screenshots with automatic organization by run/step
- Generate presigned URLs for temporary access
- Cleanup operations for old test data
"""

import io
from datetime import UTC, datetime
from uuid import UUID

import structlog
from PIL import Image

from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class ScreenshotStorageService:
    """
    Screenshot storage service for test results.

    Uses MinIO/S3 backend through the object_storage service to store
    test execution screenshots with organized paths and metadata.
    """

    def __init__(self):
        """Initialize screenshot storage service."""
        self.storage = object_storage
        self.bucket_prefix = "test-screenshots"

    def upload_screenshot(
        self,
        run_id: UUID,
        step_id: UUID,
        image_bytes: bytes,
        screenshot_type: str = "step",
        metadata: dict | None = None,
    ) -> str:
        """
        Upload a screenshot to storage.

        Args:
            run_id: Test run ID for organization
            step_id: Test step/transition ID
            image_bytes: Raw image data (PNG/JPEG)
            screenshot_type: Type of screenshot (step, error, before, after)
            metadata: Optional metadata to attach

        Returns:
            Storage URL for the uploaded screenshot

        Raises:
            ValueError: If image_bytes is invalid
            Exception: If upload fails

        Example:
            url = upload_screenshot(
                run_id=UUID("..."),
                step_id=UUID("..."),
                image_bytes=png_bytes,
                screenshot_type="error",
                metadata={"confidence": 0.95}
            )
        """
        try:
            # Validate image and extract dimensions
            try:
                image_file = io.BytesIO(image_bytes)
                with Image.open(image_file) as img:
                    width, height = img.size
                    image_format = img.format or "PNG"
            except Exception as e:
                logger.error(
                    "screenshot_validation_failed",
                    run_id=str(run_id),
                    step_id=str(step_id),
                    error=str(e),
                )
                raise ValueError(f"Invalid image data: {str(e)}")

            # Generate storage path
            # Format: test-screenshots/{run_id}/{step_id}_{timestamp}.{ext}
            timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S_%f")
            extension = image_format.lower()
            if extension == "jpeg":
                extension = "jpg"

            filename = f"{step_id}_{timestamp}.{extension}"
            prefix = f"{self.bucket_prefix}/{run_id}"

            # Prepare metadata
            storage_metadata = {
                "run_id": str(run_id),
                "step_id": str(step_id),
                "screenshot_type": screenshot_type,
                "width": str(width),
                "height": str(height),
                "captured_at": datetime.now(UTC).isoformat(),
            }

            if metadata:
                # Add custom metadata with meta_ prefix
                for key, value in metadata.items():
                    storage_metadata[f"meta_{key}"] = str(value)

            # Determine content type
            content_type = f"image/{extension}"

            # Upload to storage
            image_file = io.BytesIO(image_bytes)
            storage_key, storage_url = self.storage.upload_file(
                file_obj=image_file,
                prefix=prefix,
                filename=filename,
                content_type=content_type,
                metadata=storage_metadata,
                generate_unique_name=False,  # Use our generated filename
            )

            logger.info(
                "screenshot_uploaded",
                run_id=str(run_id),
                step_id=str(step_id),
                storage_key=storage_key,
                width=width,
                height=height,
                screenshot_type=screenshot_type,
                file_size=len(image_bytes),
            )

            return storage_url

        except ValueError:
            # Re-raise validation errors
            raise
        except Exception as e:
            logger.error(
                "screenshot_upload_failed",
                run_id=str(run_id),
                step_id=str(step_id),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def get_screenshot_url(self, path: str, expiration: int = 3600) -> str:
        """
        Get presigned URL for accessing a screenshot.

        Args:
            path: Storage path/key for the screenshot
            expiration: URL expiration time in seconds (default: 1 hour)

        Returns:
            Presigned URL for temporary access

        Raises:
            Exception: If URL generation fails

        Example:
            url = get_screenshot_url(
                "test-screenshots/run-123/step-456_20240115.png",
                expiration=7200  # 2 hours
            )
        """
        try:
            url = self.storage.generate_presigned_url(path, expiration)

            logger.debug(
                "screenshot_url_generated",
                path=path,
                expiration=expiration,
            )

            return url

        except Exception as e:
            logger.error(
                "screenshot_url_generation_failed",
                path=path,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def delete_screenshots(self, run_id: UUID) -> int:
        """
        Delete all screenshots for a test run.

        This performs bulk deletion of all screenshots associated with
        the specified test run ID.

        Args:
            run_id: Test run ID to delete screenshots for

        Returns:
            Number of screenshots deleted

        Raises:
            Exception: If deletion fails

        Example:
            count = delete_screenshots(run_id=UUID("..."))
            print(f"Deleted {count} screenshots")
        """
        try:
            prefix = f"{self.bucket_prefix}/{run_id}/"

            # Import S3Backend to check backend type
            from app.services.object_storage import S3Backend

            if not isinstance(self.storage.backend, S3Backend):
                logger.warning(
                    "delete_screenshots_not_supported",
                    backend_type=type(self.storage.backend).__name__,
                    message="Bulk delete not supported for this backend",
                )
                return 0

            # List and delete all objects with the prefix
            from botocore.exceptions import ClientError

            try:
                response = self.storage.backend.client.list_objects_v2(
                    Bucket=self.storage.backend.bucket_name, Prefix=prefix
                )

                # Check if any objects were found
                if "Contents" not in response:
                    logger.info(
                        "no_screenshots_found",
                        run_id=str(run_id),
                        prefix=prefix,
                    )
                    return 0

                # Delete each object
                deleted_count = 0
                for obj in response["Contents"]:
                    key = obj["Key"]
                    if self.storage.delete_file(key):
                        deleted_count += 1

                logger.info(
                    "screenshots_deleted",
                    run_id=str(run_id),
                    deleted_count=deleted_count,
                )

                return deleted_count

            except ClientError as e:
                logger.error(
                    "screenshots_deletion_failed",
                    run_id=str(run_id),
                    error=str(e),
                )
                raise

        except Exception as e:
            logger.error(
                "screenshot_cleanup_error",
                run_id=str(run_id),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def delete_screenshot(self, path: str) -> bool:
        """
        Delete a single screenshot.

        Args:
            path: Storage path/key for the screenshot

        Returns:
            True if deleted successfully, False otherwise

        Example:
            success = delete_screenshot("test-screenshots/run-123/step-456.png")
        """
        try:
            result = self.storage.delete_file(path)

            if result:
                logger.info("screenshot_deleted", path=path)
            else:
                logger.warning("screenshot_delete_failed", path=path)

            return result

        except Exception as e:
            logger.error(
                "screenshot_deletion_error",
                path=path,
                error=str(e),
                error_type=type(e).__name__,
            )
            return False

    def get_screenshot_metadata(self, path: str) -> dict:
        """
        Get metadata for a screenshot.

        Args:
            path: Storage path/key for the screenshot

        Returns:
            Dictionary with size, content_type, last_modified, and metadata

        Raises:
            Exception: If screenshot not found or metadata fetch fails

        Example:
            metadata = get_screenshot_metadata("test-screenshots/run-123/step-456.png")
            print(f"Size: {metadata['size']} bytes")
            print(f"Captured at: {metadata['metadata'].get('captured_at')}")
        """
        try:
            metadata = self.storage.get_file_metadata(path)

            logger.debug("screenshot_metadata_retrieved", path=path)

            return metadata

        except Exception as e:
            logger.error(
                "screenshot_metadata_error",
                path=path,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    def screenshot_exists(self, path: str) -> bool:
        """
        Check if a screenshot exists in storage.

        Args:
            path: Storage path/key for the screenshot

        Returns:
            True if screenshot exists, False otherwise

        Example:
            if screenshot_exists("test-screenshots/run-123/step-456.png"):
                print("Screenshot found")
        """
        try:
            exists = self.storage.file_exists(path)

            logger.debug("screenshot_existence_checked", path=path, exists=exists)

            return exists

        except Exception as e:
            logger.error(
                "screenshot_existence_check_error",
                path=path,
                error=str(e),
                error_type=type(e).__name__,
            )
            return False


# Singleton instance
screenshot_storage = ScreenshotStorageService()
