"""
Project image service for handling image uploads, validation, and storage.

Orchestrates between the image processing service, storage service,
and database operations for project images.
"""

import io
from uuid import UUID

import structlog
from fastapi import UploadFile
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_codes import ErrorCode
from app.middleware.error_handler import validation_error
from app.models.project_assets import ProjectImage
from app.schemas.project_assets import ProjectImageResponse
from app.services.object_storage import object_storage
from app.services.storage_service import StorageQuotaExceeded, StorageService

logger = structlog.get_logger(__name__)


# ============================================================================
# Constants
# ============================================================================

# Allowed MIME types for images
ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
}

# File size limit: 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes

# Magic bytes for file type validation
MAGIC_BYTES = {
    "image/png": b"\x89\x50\x4e\x47",  # PNG signature
    "image/jpeg": b"\xff\xd8\xff",  # JPEG signature
    "image/gif": b"\x47\x49\x46",  # GIF signature
    "image/webp": b"\x52\x49\x46\x46",  # RIFF (WebP container)
}

# Presigned URL expiration: 7 days
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60  # 604800 seconds

# Thumbnail settings
THUMBNAIL_MAX_SIZE = (256, 256)  # Max dimensions (width, height)
THUMBNAIL_QUALITY = 85  # WebP quality (0-100)
THUMBNAIL_FORMAT = "WEBP"  # Use WebP for smaller file sizes

# Extension mapping from MIME type
EXTENSION_MAP = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


# ============================================================================
# Project Image Service
# ============================================================================


class ProjectImageService:
    """
    Service for project image operations.

    Provides methods for:
    - Validating uploaded images
    - Generating thumbnails
    - Cropping images from screenshots
    - Uploading to and deleting from storage
    - Generating presigned URLs
    - Building response schemas
    """

    def validate_mime_type(self, content_type: str | None) -> str:
        """
        Validate that the MIME type is an allowed image type.

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

    def validate_magic_bytes(self, file_data: bytes, content_type: str) -> None:
        """
        Validate file magic bytes match the declared MIME type.

        Args:
            file_data: Raw file bytes
            content_type: Declared MIME type

        Raises:
            HTTPException: If magic bytes don't match
        """
        # Special handling for JPEG (multiple valid signatures)
        if content_type in ("image/jpeg", "image/jpg"):
            if not file_data.startswith(MAGIC_BYTES["image/jpeg"]):
                raise validation_error("File content does not match JPEG format")
            return

        # Special handling for WebP (need to check WEBP signature after RIFF)
        if content_type == "image/webp":
            if not file_data.startswith(b"RIFF") or b"WEBP" not in file_data[:12]:
                raise validation_error("File content does not match WebP format")
            return

        # Standard validation for PNG and GIF
        expected_magic = MAGIC_BYTES.get(content_type)
        if expected_magic and not file_data.startswith(expected_magic):
            raise validation_error(f"File content does not match {content_type} format")

    async def validate_file_size(self, file: UploadFile) -> int:
        """
        Validate file size is within limits.

        Args:
            file: Uploaded file

        Returns:
            File size in bytes

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

        # Reset file pointer for later use
        await file.seek(0)
        return file_size

    async def check_storage_quota(
        self,
        db: AsyncSession,
        user_id: UUID,
        subscription_tier: str,
        file_size: int,
    ) -> None:
        """
        Check if user has sufficient storage quota.

        Args:
            db: Database session
            user_id: User UUID
            subscription_tier: User's subscription tier
            file_size: Size of file to upload

        Raises:
            StorageQuotaExceeded: If quota would be exceeded
        """
        try:
            await StorageService.check_quota(db, user_id, subscription_tier, file_size)
        except StorageQuotaExceeded:
            logger.warning(
                "storage_quota_exceeded",
                user_id=str(user_id),
                file_size=file_size,
            )
            raise

    def generate_thumbnail(self, image: Image.Image) -> tuple[bytes, int, int]:
        """
        Generate a thumbnail from a PIL Image.

        Creates a WebP thumbnail with max dimensions of 256x256, preserving aspect ratio.

        Args:
            image: PIL Image object

        Returns:
            Tuple of (thumbnail_bytes, thumbnail_width, thumbnail_height)
        """
        try:
            # Make a copy to avoid modifying the original
            thumbnail = image.copy()

            # Convert to RGB if image has transparency (WebP RGB is smaller)
            if thumbnail.mode in ("RGBA", "LA", "P"):
                # Create white background
                background = Image.new("RGB", thumbnail.size, (255, 255, 255))
                if thumbnail.mode == "P":
                    thumbnail = thumbnail.convert("RGBA")
                background.paste(
                    thumbnail,
                    mask=(
                        thumbnail.split()[-1]
                        if thumbnail.mode in ("RGBA", "LA")
                        else None
                    ),
                )
                thumbnail = background

            # Resize with aspect ratio preservation
            thumbnail.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)

            # Get dimensions after resize
            thumb_width, thumb_height = thumbnail.size

            # Convert to WebP bytes
            output = io.BytesIO()
            thumbnail.save(
                output,
                format=THUMBNAIL_FORMAT,
                quality=THUMBNAIL_QUALITY,
                method=6,  # Slowest but best compression
            )
            thumbnail_bytes = output.getvalue()
            output.close()

            logger.debug(
                "thumbnail_generated",
                original_size=image.size,
                thumbnail_size=(thumb_width, thumb_height),
                thumbnail_bytes=len(thumbnail_bytes),
            )

            return thumbnail_bytes, thumb_width, thumb_height

        except Exception as e:
            logger.error("thumbnail_generation_failed", error=str(e))
            raise

    def get_image_dimensions(self, file_data: bytes) -> tuple[int, int, Image.Image]:
        """
        Get image dimensions from raw bytes and return PIL Image.

        Args:
            file_data: Raw image bytes

        Returns:
            Tuple of (width, height, PIL Image)
        """
        img = Image.open(io.BytesIO(file_data))
        width, height = img.size
        return width, height, img

    def crop_image(
        self,
        image_data: bytes,
        x: int,
        y: int,
        width: int,
        height: int,
    ) -> tuple[bytes, int, int, Image.Image]:
        """
        Crop a region from an image.

        Args:
            image_data: Source image bytes
            x: Left coordinate
            y: Top coordinate
            width: Crop width
            height: Crop height

        Returns:
            Tuple of (cropped_bytes, width, height, cropped PIL Image)
        """
        img = Image.open(io.BytesIO(image_data))
        cropped = img.crop((x, y, x + width, y + height))

        # Convert to PNG bytes
        output = io.BytesIO()
        cropped.save(output, format="PNG")
        cropped_data = output.getvalue()
        output.close()
        img.close()

        return cropped_data, width, height, cropped

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
        return EXTENSION_MAP.get(content_type, "jpg")

    def upload_image(
        self,
        file_data: bytes,
        s3_key: str,
        content_type: str,
        metadata: dict | None = None,
    ) -> None:
        """
        Upload image to storage.

        Args:
            file_data: Image bytes
            s3_key: Storage key
            content_type: MIME type
            metadata: Optional metadata dict
        """
        file_obj = io.BytesIO(file_data)
        object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type=content_type,
            metadata=metadata,
        )

    def upload_thumbnail(
        self,
        thumbnail_data: bytes,
        s3_key: str,
        metadata: dict | None = None,
    ) -> None:
        """
        Upload thumbnail to storage.

        Args:
            thumbnail_data: Thumbnail bytes
            s3_key: Storage key
            metadata: Optional metadata dict
        """
        file_obj = io.BytesIO(thumbnail_data)
        object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type="image/webp",
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

    def download_from_storage(self, s3_key: str) -> bytes | None:
        """
        Download a file from storage.

        Args:
            s3_key: Storage key

        Returns:
            File bytes or None if not found
        """
        try:
            return object_storage.download_file(s3_key)
        except Exception:
            return None

    def generate_presigned_url(self, s3_key: str) -> str:
        """
        Generate presigned URL or CDN URL for an S3 key.

        Args:
            s3_key: Storage key

        Returns:
            Presigned or CDN URL
        """
        try:
            # Use get_cdn_url if available (S3Backend), otherwise fall back to presigned URL
            if hasattr(object_storage.backend, "get_cdn_url"):
                url = object_storage.backend.get_cdn_url(s3_key)
            else:
                url = object_storage.generate_presigned_url(
                    s3_key, expiration=PRESIGNED_URL_EXPIRATION
                )
            # Ensure we return a string
            return str(url) if url is not None else f"s3://{s3_key}"
        except Exception as e:
            logger.error("presigned_url_generation_failed", s3_key=s3_key, error=str(e))
            # Return a placeholder URL as fallback
            return f"s3://{s3_key}"

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
        Track storage usage for an upload.

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
                file_type="image",
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

    def build_image_response(
        self,
        image: ProjectImage,
        presigned_url: str | None = None,
    ) -> ProjectImageResponse:
        """
        Build ProjectImageResponse from database model.

        Args:
            image: ProjectImage database model
            presigned_url: Optional pre-computed presigned URL

        Returns:
            ProjectImageResponse schema
        """
        # Generate presigned URL if not provided
        if presigned_url is None:
            presigned_url = self.generate_presigned_url(image.s3_key)

        # Generate thumbnail URL if thumbnail exists
        thumbnail_url: str | None = None
        if image.thumbnail_s3_key:
            thumbnail_url = self.generate_presigned_url(image.thumbnail_s3_key)

        # Access metadata via the correct attribute name
        metadata = image.extra_metadata

        return ProjectImageResponse(
            id=image.id,
            project_id=image.project_id,
            name=image.name,
            description=metadata.get("description") if metadata else None,
            image_type=(metadata.get("image_type", "other") if metadata else "other"),
            tags=metadata.get("tags", []) if metadata else [],
            metadata=metadata,
            storage_path=image.s3_key,
            presigned_url=presigned_url,
            thumbnail_url=thumbnail_url,
            width=image.width,
            height=image.height,
            file_size=image.size_bytes,
            content_type=(
                metadata.get("mime_type", "image/png") if metadata else "image/png"
            ),
            created_at=image.created_at,
            updated_at=image.updated_at,
        )


# Singleton instance for convenience
project_image_service = ProjectImageService()
