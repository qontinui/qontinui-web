"""
Service for template candidate image storage and retrieval operations.

Handles uploading candidate images (full-size, thumbnails, masks) to object storage,
generating WebP thumbnails, and managing presigned URLs.
"""

import base64
import io
from typing import TYPE_CHECKING

import structlog
from app.services.storage import S3Backend, object_storage
from PIL import Image

if TYPE_CHECKING:
    pass

logger = structlog.get_logger(__name__)


class TemplateCandidateStorageService:
    """Service for managing template candidate image storage."""

    # Maximum thumbnail dimensions
    THUMBNAIL_MAX_SIZE = (256, 256)

    # Default presigned URL expiration (1 hour)
    DEFAULT_URL_EXPIRATION = 3600

    @staticmethod
    def _get_storage_prefix(session_id: str, candidate_id: str) -> str:
        """Get the storage prefix for a candidate's files."""
        return f"template-capture/sessions/{session_id}/candidates/{candidate_id}"

    @staticmethod
    def _decode_base64_image(base64_data: str) -> bytes:
        """Decode base64 image data, handling data URL prefix if present."""
        if "," in base64_data:
            # Handle data URL format: data:image/png;base64,<data>
            base64_data = base64_data.split(",", 1)[1]
        return base64.b64decode(base64_data)

    @staticmethod
    def _generate_webp_thumbnail(
        image_data: bytes,
        max_size: tuple[int, int] = (256, 256),
    ) -> bytes:
        """
        Generate a WebP thumbnail from image data.

        Args:
            image_data: Raw image bytes (PNG, JPEG, etc.)
            max_size: Maximum dimensions (width, height)

        Returns:
            WebP-encoded thumbnail bytes
        """
        try:
            image: Image.Image = Image.open(io.BytesIO(image_data))

            # Convert to RGB if necessary (WebP doesn't support all modes)
            if image.mode in ("RGBA", "LA") or (
                image.mode == "P" and "transparency" in image.info
            ):
                # Preserve alpha channel
                image = image.convert("RGBA")
            elif image.mode != "RGB":
                image = image.convert("RGB")

            # Resize maintaining aspect ratio
            image.thumbnail(max_size, Image.Resampling.LANCZOS)

            # Save as WebP
            buffer = io.BytesIO()
            image.save(buffer, format="WEBP", quality=85, method=4)
            buffer.seek(0)
            return buffer.getvalue()

        except Exception as e:
            logger.warning(
                "thumbnail_generation_failed",
                error=str(e),
            )
            raise

    @staticmethod
    async def upload_candidate_image(
        candidate_id: str,
        session_id: str,
        image_data: bytes,
        image_format: str = "png",
    ) -> tuple[str, str]:
        """
        Upload the full-size candidate image to storage.

        Args:
            candidate_id: Unique candidate identifier
            session_id: Capture session identifier
            image_data: Raw image bytes
            image_format: Image format (png, jpeg, webp)

        Returns:
            Tuple of (storage_key, presigned_url)
        """
        prefix = TemplateCandidateStorageService._get_storage_prefix(
            session_id, candidate_id
        )
        filename = f"image.{image_format}"

        content_type_map = {
            "png": "image/png",
            "jpeg": "image/jpeg",
            "jpg": "image/jpeg",
            "webp": "image/webp",
        }
        content_type = content_type_map.get(image_format.lower(), "image/png")

        key, _ = object_storage.upload_bytes(
            data=image_data,
            prefix=prefix,
            filename=filename,
            content_type=content_type,
            generate_unique_name=False,
        )

        # Generate presigned URL
        url = object_storage.generate_presigned_url(
            key,
            expiration=TemplateCandidateStorageService.DEFAULT_URL_EXPIRATION,
        )

        logger.info(
            "candidate_image_uploaded",
            candidate_id=candidate_id,
            session_id=session_id,
            key=key,
            format=image_format,
        )

        return key, url

    @staticmethod
    async def upload_candidate_thumbnail(
        candidate_id: str,
        session_id: str,
        image_data: bytes,
    ) -> tuple[str, str]:
        """
        Generate and upload a WebP thumbnail for the candidate.

        Args:
            candidate_id: Unique candidate identifier
            session_id: Capture session identifier
            image_data: Raw image bytes (will be converted to WebP thumbnail)

        Returns:
            Tuple of (storage_key, presigned_url)
        """
        # Generate WebP thumbnail
        thumbnail_data = TemplateCandidateStorageService._generate_webp_thumbnail(
            image_data,
            max_size=TemplateCandidateStorageService.THUMBNAIL_MAX_SIZE,
        )

        prefix = TemplateCandidateStorageService._get_storage_prefix(
            session_id, candidate_id
        )
        filename = "thumbnail.webp"

        key, _ = object_storage.upload_bytes(
            data=thumbnail_data,
            prefix=prefix,
            filename=filename,
            content_type="image/webp",
            generate_unique_name=False,
        )

        # Generate presigned URL
        url = object_storage.generate_presigned_url(
            key,
            expiration=TemplateCandidateStorageService.DEFAULT_URL_EXPIRATION,
        )

        logger.info(
            "candidate_thumbnail_uploaded",
            candidate_id=candidate_id,
            session_id=session_id,
            key=key,
        )

        return key, url

    @staticmethod
    async def upload_candidate_mask(
        candidate_id: str,
        session_id: str,
        mask_data: bytes,
    ) -> tuple[str, str]:
        """
        Upload the candidate mask image to storage.

        Args:
            candidate_id: Unique candidate identifier
            session_id: Capture session identifier
            mask_data: Raw mask image bytes (PNG with alpha)

        Returns:
            Tuple of (storage_key, presigned_url)
        """
        prefix = TemplateCandidateStorageService._get_storage_prefix(
            session_id, candidate_id
        )
        filename = "mask.png"

        key, _ = object_storage.upload_bytes(
            data=mask_data,
            prefix=prefix,
            filename=filename,
            content_type="image/png",
            generate_unique_name=False,
        )

        # Generate presigned URL
        url = object_storage.generate_presigned_url(
            key,
            expiration=TemplateCandidateStorageService.DEFAULT_URL_EXPIRATION,
        )

        logger.info(
            "candidate_mask_uploaded",
            candidate_id=candidate_id,
            session_id=session_id,
            key=key,
        )

        return key, url

    @staticmethod
    async def upload_candidate_images_from_base64(
        candidate_id: str,
        session_id: str,
        pixel_data_base64: str | None,
        mask_base64: str | None = None,
    ) -> dict[str, tuple[str, str] | None]:
        """
        Upload all candidate images from base64-encoded data.

        This is a convenience method that handles:
        1. Decoding base64 pixel data
        2. Uploading the full-size image
        3. Generating and uploading WebP thumbnail
        4. Optionally uploading the mask

        Args:
            candidate_id: Unique candidate identifier
            session_id: Capture session identifier
            pixel_data_base64: Base64-encoded pixel data (may include data URL prefix)
            mask_base64: Optional base64-encoded mask data

        Returns:
            Dict with keys 'image', 'thumbnail', 'mask', each containing
            (storage_key, presigned_url) tuple or None
        """
        result: dict[str, tuple[str, str] | None] = {
            "image": None,
            "thumbnail": None,
            "mask": None,
        }

        if not pixel_data_base64:
            logger.debug(
                "no_pixel_data_to_upload",
                candidate_id=candidate_id,
                session_id=session_id,
            )
            return result

        try:
            # Decode the pixel data
            image_data = TemplateCandidateStorageService._decode_base64_image(
                pixel_data_base64
            )

            # Upload full-size image
            (
                image_key,
                image_url,
            ) = await TemplateCandidateStorageService.upload_candidate_image(
                candidate_id=candidate_id,
                session_id=session_id,
                image_data=image_data,
                image_format="png",
            )
            result["image"] = (image_key, image_url)

            # Generate and upload thumbnail
            try:
                (
                    thumb_key,
                    thumb_url,
                ) = await TemplateCandidateStorageService.upload_candidate_thumbnail(
                    candidate_id=candidate_id,
                    session_id=session_id,
                    image_data=image_data,
                )
                result["thumbnail"] = (thumb_key, thumb_url)
            except Exception as e:
                logger.warning(
                    "thumbnail_upload_failed",
                    candidate_id=candidate_id,
                    error=str(e),
                )

            # Upload mask if provided
            if mask_base64:
                try:
                    mask_data = TemplateCandidateStorageService._decode_base64_image(
                        mask_base64
                    )
                    (
                        mask_key,
                        mask_url,
                    ) = await TemplateCandidateStorageService.upload_candidate_mask(
                        candidate_id=candidate_id,
                        session_id=session_id,
                        mask_data=mask_data,
                    )
                    result["mask"] = (mask_key, mask_url)
                except Exception as e:
                    logger.warning(
                        "mask_upload_failed",
                        candidate_id=candidate_id,
                        error=str(e),
                    )

        except Exception as e:
            logger.error(
                "candidate_images_upload_failed",
                candidate_id=candidate_id,
                session_id=session_id,
                error=str(e),
            )
            raise

        return result

    @staticmethod
    def delete_candidate_files(candidate_id: str, session_id: str) -> int:
        """
        Delete all files for a candidate from storage.

        Args:
            candidate_id: Unique candidate identifier
            session_id: Capture session identifier

        Returns:
            Number of files deleted
        """
        prefix = TemplateCandidateStorageService._get_storage_prefix(
            session_id, candidate_id
        )
        deleted_count = 0

        # Known file names to delete
        files_to_delete = [
            f"{prefix}/image.png",
            f"{prefix}/thumbnail.webp",
            f"{prefix}/mask.png",
        ]

        for key in files_to_delete:
            if object_storage.delete_file(key):
                deleted_count += 1

        # For S3 backend, also try to list and delete any other files
        if isinstance(object_storage.backend, S3Backend):
            try:
                response = object_storage.backend.client.list_objects_v2(
                    Bucket=object_storage.backend.bucket_name,
                    Prefix=prefix,
                )
                if "Contents" in response:
                    for obj in response["Contents"]:
                        key = obj["Key"]
                        if object_storage.delete_file(key):
                            deleted_count += 1
            except Exception as e:
                logger.warning(
                    "failed_to_list_candidate_files",
                    candidate_id=candidate_id,
                    session_id=session_id,
                    error=str(e),
                )

        logger.info(
            "candidate_files_deleted",
            candidate_id=candidate_id,
            session_id=session_id,
            deleted_count=deleted_count,
        )

        return deleted_count

    @staticmethod
    def get_candidate_urls(
        candidate_id: str,
        session_id: str,
        expiration: int | None = None,
    ) -> dict[str, str | None]:
        """
        Get fresh presigned URLs for all candidate files.

        Args:
            candidate_id: Unique candidate identifier
            session_id: Capture session identifier
            expiration: URL expiration in seconds (default: 3600)

        Returns:
            Dict with keys 'pixel_data_url', 'thumbnail_url', 'mask_url'
            containing presigned URLs or None if file doesn't exist
        """
        if expiration is None:
            expiration = TemplateCandidateStorageService.DEFAULT_URL_EXPIRATION

        prefix = TemplateCandidateStorageService._get_storage_prefix(
            session_id, candidate_id
        )

        result: dict[str, str | None] = {
            "pixel_data_url": None,
            "thumbnail_url": None,
            "mask_url": None,
        }

        # Check and generate URL for full-size image
        image_key = f"{prefix}/image.png"
        if object_storage.file_exists(image_key):
            result["pixel_data_url"] = object_storage.generate_presigned_url(
                image_key, expiration
            )

        # Check and generate URL for thumbnail
        thumbnail_key = f"{prefix}/thumbnail.webp"
        if object_storage.file_exists(thumbnail_key):
            result["thumbnail_url"] = object_storage.generate_presigned_url(
                thumbnail_key, expiration
            )

        # Check and generate URL for mask
        mask_key = f"{prefix}/mask.png"
        if object_storage.file_exists(mask_key):
            result["mask_url"] = object_storage.generate_presigned_url(
                mask_key, expiration
            )

        return result

    @staticmethod
    def refresh_candidate_url(
        storage_key: str,
        expiration: int | None = None,
    ) -> str | None:
        """
        Generate a fresh presigned URL for a specific storage key.

        Args:
            storage_key: The storage key for the file
            expiration: URL expiration in seconds (default: 3600)

        Returns:
            Presigned URL or None if file doesn't exist
        """
        if expiration is None:
            expiration = TemplateCandidateStorageService.DEFAULT_URL_EXPIRATION

        if not storage_key or not object_storage.file_exists(storage_key):
            return None

        return object_storage.generate_presigned_url(storage_key, expiration)

    @staticmethod
    async def delete_session_files(session_id: str) -> int:
        """
        Delete all files for a capture session.

        Args:
            session_id: Capture session identifier

        Returns:
            Number of files deleted
        """
        prefix = f"template-capture/sessions/{session_id}/"
        deleted_count = 0

        # For S3 backend, list and delete all files under the prefix
        if isinstance(object_storage.backend, S3Backend):
            try:
                paginator = object_storage.backend.client.get_paginator(
                    "list_objects_v2"
                )
                for page in paginator.paginate(
                    Bucket=object_storage.backend.bucket_name,
                    Prefix=prefix,
                ):
                    if "Contents" in page:
                        for obj in page["Contents"]:
                            key = obj["Key"]
                            if object_storage.delete_file(key):
                                deleted_count += 1
            except Exception as e:
                logger.warning(
                    "failed_to_delete_session_files",
                    session_id=session_id,
                    error=str(e),
                )
        else:
            logger.warning(
                "session_file_deletion_not_supported",
                backend_type=type(object_storage.backend).__name__,
                message="Bulk delete only supported for S3 backend",
            )

        logger.info(
            "session_files_deleted",
            session_id=session_id,
            deleted_count=deleted_count,
        )

        return deleted_count
