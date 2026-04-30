"""
Project screenshot service for handling screenshot uploads, validation, and storage.

Orchestrates between the storage service and database operations for project screenshots.
"""

import io
from typing import Literal, cast
from uuid import UUID

import structlog
from fastapi import UploadFile
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.middleware.error_handler import validation_error
from app.models.project_assets import ProjectScreenshot
from app.schemas.project_assets import ProjectScreenshotResponse
from app.services.object_storage import object_storage
from app.services.storage_service import StorageService

logger = structlog.get_logger(__name__)


# ============================================================================
# Constants
# ============================================================================

# Allowed MIME types for screenshots
ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}

# File size limit: 50MB for screenshots (larger than images since screenshots can be high-res)
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB in bytes

# Presigned URL expiration: 7 days
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60  # 604800 seconds

# Extension mapping from MIME type
EXTENSION_MAP = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}


# ============================================================================
# Project Screenshot Service
# ============================================================================


class ProjectScreenshotService:
    """
    Service for project screenshot operations.

    Provides methods for:
    - Validating uploaded screenshots
    - Uploading to and deleting from storage
    - Generating presigned URLs
    - Tracking storage usage
    - Building response schemas
    """

    def validate_mime_type(self, content_type: str | None) -> str:
        """
        Validate that the MIME type is an allowed screenshot type.

        Args:
            content_type: MIME type from upload

        Returns:
            Validated content type

        Raises:
            HTTPException: If MIME type is not allowed
        """
        if not content_type or content_type not in ALLOWED_MIME_TYPES:
            raise validation_error(
                f"Invalid file type. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}",
                "file",
                ErrorCode.INVALID_FILE_TYPE,
            )
        return content_type

    async def validate_file_size(self, file: UploadFile) -> tuple[bytes, int]:
        """
        Validate file size is within limits and return contents.

        Args:
            file: Uploaded file

        Returns:
            Tuple of (file_contents, file_size)

        Raises:
            HTTPException: If file is too large
        """
        contents = await file.read()
        file_size = len(contents)

        if file_size > MAX_FILE_SIZE:
            raise validation_error(
                f"File too large. Maximum size: {MAX_FILE_SIZE / (1024 * 1024):.1f}MB",
                "file",
                ErrorCode.INVALID_FILE_SIZE,
            )

        return contents, file_size

    def get_image_dimensions(self, file_contents: bytes) -> tuple[int, int]:
        """
        Get image dimensions from file contents.

        Args:
            file_contents: Image file bytes

        Returns:
            Tuple of (width, height)

        Raises:
            HTTPException: If image cannot be opened
        """
        try:
            with Image.open(io.BytesIO(file_contents)) as img:
                width, height = img.size
                return (width, height)
        except Exception as e:
            logger.error("image_open_failed", error=str(e))
            raise validation_error(
                "Failed to read image. File may be corrupted or not a valid image.",
                "file",
            )

    def get_extension_from_filename(
        self, filename: str | None, content_type: str
    ) -> str:
        """
        Get file extension from filename or fallback to content type.

        Args:
            filename: Original filename (may be None)
            content_type: MIME type

        Returns:
            File extension (without dot)
        """
        if filename and "." in filename:
            return filename.rsplit(".", 1)[1].lower()
        return EXTENSION_MAP.get(content_type, "png")

    def upload_screenshot(
        self,
        file_data: bytes,
        s3_key: str,
        content_type: str,
        metadata: dict | None = None,
    ) -> str:
        """
        Upload screenshot to storage.

        Args:
            file_data: Screenshot bytes
            s3_key: Storage key
            content_type: MIME type
            metadata: Optional metadata dict

        Returns:
            URL of uploaded file
        """
        file_obj = io.BytesIO(file_data)
        return object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type=content_type,
            metadata=metadata,
        )

    def delete_from_storage(self, s3_key: str) -> bool:
        """
        Delete a file from storage.

        Args:
            s3_key: Storage key

        Returns:
            True if deleted successfully
        """
        try:
            return object_storage.delete_file(s3_key)
        except Exception as e:
            logger.error("storage_delete_error", s3_key=s3_key, error=str(e))
            return False

    def generate_presigned_url(self, s3_key: str) -> str | None:
        """
        Generate presigned URL or CDN URL for an S3 key.

        Args:
            s3_key: Storage key

        Returns:
            Presigned or CDN URL, or None if generation fails
        """
        try:
            if hasattr(object_storage.backend, "get_cdn_url"):
                result = object_storage.backend.get_cdn_url(s3_key)
                return str(result) if result is not None else None
            else:
                result = object_storage.generate_presigned_url(
                    s3_key, expiration=PRESIGNED_URL_EXPIRATION
                )
                return str(result) if result is not None else None
        except Exception as e:
            logger.error("presigned_url_generation_failed", s3_key=s3_key, error=str(e))
            return None

    async def track_upload(
        self,
        db: AsyncSession,
        user_id: UUID,
        s3_key: str,
        file_size: int,
        project_id: str,
        metadata: dict | None = None,
    ) -> None:
        """
        Track storage usage for a screenshot upload.

        Args:
            db: Database session
            user_id: User UUID
            s3_key: Storage key
            file_size: File size in bytes
            project_id: Project UUID as string
            metadata: Optional metadata
        """
        try:
            await StorageService.track_upload(
                db=db,
                user_id=user_id,
                file_path=s3_key,
                file_size_bytes=file_size,
                file_type="screenshot",
                project_id=project_id,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(
                "storage_tracking_failed",
                user_id=str(user_id),
                s3_key=s3_key,
                error=str(e),
            )
            # Don't fail the upload if tracking fails

    async def delete_storage_record(
        self,
        db: AsyncSession,
        s3_key: str,
        user_id: UUID,
    ) -> bool:
        """
        Delete storage tracking record.

        Args:
            db: Database session
            s3_key: Storage key
            user_id: User UUID

        Returns:
            True if record was deleted
        """
        try:
            return await StorageService.delete_file_record(
                db=db, file_path=s3_key, user_id=user_id
            )
        except Exception as e:
            logger.error(
                "storage_tracking_delete_failed",
                user_id=str(user_id),
                s3_key=s3_key,
                error=str(e),
            )
            return False

    def build_screenshot_response(
        self,
        screenshot: ProjectScreenshot,
        presigned_url: str | None = None,
    ) -> ProjectScreenshotResponse:
        """
        Build ProjectScreenshotResponse from database model.

        Args:
            screenshot: ProjectScreenshot database model
            presigned_url: Optional pre-computed presigned URL

        Returns:
            ProjectScreenshotResponse schema
        """
        if presigned_url is None:
            presigned_url = self.generate_presigned_url(screenshot.s3_key)

        content_type = (
            screenshot.metadata.get("mime_type", "image/png")
            if screenshot.metadata
            else "image/png"
        )

        return ProjectScreenshotResponse(
            id=screenshot.id,
            project_id=screenshot.project_id,
            name=screenshot.name,
            source=cast(
                Literal["manual_upload", "runner_capture", "web_capture"],
                screenshot.source,
            ),
            monitor_index=screenshot.monitor_index,
            metadata=screenshot.metadata,
            storage_path=screenshot.s3_key,
            presigned_url=presigned_url,
            thumbnail_url=None,
            width=screenshot.width,
            height=screenshot.height,
            file_size=screenshot.size_bytes,
            content_type=content_type,
            created_at=screenshot.created_at,
            updated_at=screenshot.updated_at,
        )


# Singleton instance for convenience
project_screenshot_service = ProjectScreenshotService()
