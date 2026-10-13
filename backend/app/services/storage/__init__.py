"""
Object storage service for local filesystem, S3, and MinIO.

Provides a unified interface for file storage supporting:
- Local filesystem (for testing and development)
- AWS S3 (for production)
- MinIO (for development with S3-compatible storage)
"""

import hashlib
import io
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Final
from uuid import UUID

import structlog
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

from app.core.config import settings
from app.services.storage.base import StorageBackend
from app.services.storage.local_backend import LocalBackend
from app.services.storage.s3_backend import S3Backend

logger = structlog.get_logger(__name__)

__all__ = [
    "StorageBackend",
    "S3Backend",
    "LocalBackend",
    "ContentAddressedObject",
    "ObjectStorageService",
    "content_addressed_key",
    "object_storage",
]

#: A key prefix: lower-case path segments, no ``..``, no leading or trailing
#: slash — so a content-addressed key can never escape its prefix.
_CONTENT_PREFIX_RE: Final = re.compile(
    r"\A[a-z0-9][a-z0-9_-]*(?:/[a-z0-9][a-z0-9_-]*)*\Z"
)
#: An extension: a dot and a short lower-case alphanumeric suffix.
_CONTENT_EXT_RE: Final = re.compile(r"\A\.[a-z0-9]{1,10}\Z")


@dataclass(frozen=True)
class ContentAddressedObject:
    """The outcome of :meth:`ObjectStorageService.put_content_addressed`."""

    key: str
    sha256: str
    size: int
    #: False when an identical object was already stored at ``key`` and the
    #: write was skipped.
    written: bool


def content_addressed_key(prefix: str, tenant_id: UUID, sha256: str, ext: str) -> str:
    """``{prefix}/{tenant_id}/sha256/{h[:2]}/{h}{ext}``.

    The tenant is part of the key, so the same bytes held by two tenants are
    two objects: one tenant's erasure can never break the other's asset, and a
    write cannot reveal whether another tenant already holds the image. The
    two-character fan-out keeps any one key "directory" small.
    """
    if not _CONTENT_PREFIX_RE.match(prefix):
        raise ValueError(f"invalid content-addressed prefix {prefix!r}")
    if not _CONTENT_EXT_RE.match(ext):
        raise ValueError(f"invalid content-addressed extension {ext!r}")
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("sha256 must be 64 lower-case hex characters")
    return f"{prefix}/{tenant_id}/sha256/{sha256[:2]}/{sha256}{ext}"


class ObjectStorageService:
    """
    Unified object storage service.

    Automatically configures backend based on environment variables.
    Supports local filesystem (testing), MinIO (development), and AWS S3 (production).
    """

    def __init__(self):
        self.backend: StorageBackend

        if settings.STORAGE_BACKEND == "local":
            logger.info("storage_backend_configured", backend="local")
            self.backend = LocalBackend()
        elif settings.STORAGE_ENDPOINT_URL:
            logger.info(
                "storage_backend_configured",
                backend="minio",
                endpoint=settings.STORAGE_ENDPOINT_URL,
            )
            self.backend = S3Backend(
                bucket_name=settings.STORAGE_BUCKET_NAME,
                region=settings.STORAGE_REGION,
                access_key=settings.STORAGE_ACCESS_KEY,
                secret_key=settings.STORAGE_SECRET_KEY,
                endpoint_url=settings.STORAGE_ENDPOINT_URL,
            )
        else:
            logger.info("storage_backend_configured", backend="s3")
            self.backend = S3Backend(
                bucket_name=settings.STORAGE_BUCKET_NAME,
                region=settings.STORAGE_REGION,
                access_key=settings.STORAGE_ACCESS_KEY,
                secret_key=settings.STORAGE_SECRET_KEY,
            )

    def upload_file(
        self,
        file_obj: BinaryIO,
        prefix: str,
        filename: str,
        content_type: str | None = None,
        metadata: dict | None = None,
        generate_unique_name: bool = True,
    ) -> tuple[str, str]:
        """Upload file to storage."""
        if generate_unique_name:
            extension = Path(filename).suffix
            unique_name = f"{uuid.uuid4()}{extension}"
            key = f"{prefix}/{unique_name}"
        else:
            key = f"{prefix}/{filename}"

        url = self.backend.upload_file(
            file_obj=file_obj,
            key=key,
            content_type=content_type,
            metadata=metadata,
        )

        return key, url

    def download_file(self, key: str) -> bytes:
        """Download file from storage."""
        return self.backend.download_file(key)

    def open_stream(self, key: str) -> BinaryIO:
        """Open a stored file for chunked reading; the caller closes it."""
        return self.backend.open_stream(key)

    def delete_file(self, key: str) -> bool:
        """Delete file from storage."""
        return self.backend.delete_file(key)

    def generate_presigned_url(self, key: str, expiration: int = 3600) -> str:
        """Generate temporary URL for file access."""
        return self.backend.generate_presigned_url(key, expiration)

    def file_exists(self, key: str) -> bool:
        """Check if file exists."""
        return self.backend.file_exists(key)

    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata."""
        return self.backend.get_file_metadata(key)

    def put_content_addressed(
        self,
        data: bytes,
        ext: str,
        prefix: str,
        *,
        tenant_id: UUID,
        content_type: str | None = None,
    ) -> ContentAddressedObject:
        """Store ``data`` under the key its own SHA-256 names, idempotently.

        The hash is computed HERE, from the bytes — a caller never supplies
        it — and the key is :func:`content_addressed_key`. ``ext`` and
        ``content_type`` must come from the bytes too (the caller sniffs
        them; this method only refuses a malformed ``ext``).

        Idempotent through :meth:`file_exists`: when an object is already
        stored at the key with the same size, nothing is written (the key
        already names these exact bytes). An object at the key with a
        DIFFERENT size can only be a torn earlier write (a crash mid-copy on
        the local backend; S3's PUT is atomic), so it is overwritten — the
        repair is logged. Works on every backend, because it uses only the
        :class:`StorageBackend` contract.
        """
        sha256 = hashlib.sha256(data).hexdigest()
        key = content_addressed_key(prefix, tenant_id, sha256, ext)
        if self.file_exists(key):
            stored_size = self.get_file_metadata(key).get("size")
            if stored_size == len(data):
                return ContentAddressedObject(
                    key=key, sha256=sha256, size=len(data), written=False
                )
            logger.warning(
                "content_addressed_object_repaired",
                key=key,
                stored_size=stored_size,
                expected_size=len(data),
            )
        self.backend.upload_file(
            file_obj=io.BytesIO(data), key=key, content_type=content_type
        )
        logger.info("content_addressed_object_written", key=key, size=len(data))
        return ContentAddressedObject(
            key=key, sha256=sha256, size=len(data), written=True
        )

    def upload_from_path(
        self,
        file_path: Path,
        prefix: str,
        content_type: str | None = None,
        metadata: dict | None = None,
        generate_unique_name: bool = True,
    ) -> tuple[str, str]:
        """Upload file from filesystem path."""
        with open(file_path, "rb") as f:
            return self.upload_file(
                file_obj=f,
                prefix=prefix,
                filename=file_path.name,
                content_type=content_type,
                metadata=metadata,
                generate_unique_name=generate_unique_name,
            )

    def upload_bytes(
        self,
        data: bytes,
        prefix: str,
        filename: str,
        content_type: str | None = None,
        metadata: dict | None = None,
        generate_unique_name: bool = True,
    ) -> tuple[str, str]:
        """Upload bytes to storage."""
        file_obj = io.BytesIO(data)
        return self.upload_file(
            file_obj=file_obj,
            prefix=prefix,
            filename=filename,
            content_type=content_type,
            metadata=metadata,
            generate_unique_name=generate_unique_name,
        )

    def upload_image(
        self,
        file_obj: BinaryIO,
        user_id: str | int,
        project_id: str | int,
        filename: str,
        metadata: dict | None = None,
    ) -> tuple[str, str, int]:
        """Upload image with proper path structure."""
        extension = Path(filename).suffix
        unique_filename = f"{uuid.uuid4()}{extension}"

        prefix = f"images/{user_id}/{project_id}"
        key = f"{prefix}/{unique_filename}"

        content_type = self._get_image_mime_type(filename)

        current_pos = file_obj.tell()
        file_obj.seek(0, 2)
        file_size = file_obj.tell()
        file_obj.seek(current_pos)

        try:
            self.backend.upload_file(
                file_obj=file_obj,
                key=key,
                content_type=content_type,
                metadata=metadata,
            )

            presigned_url = self.generate_presigned_url(key, expiration=604800)

            logger.info(
                "image_uploaded",
                key=key,
                user_id=user_id,
                project_id=project_id,
                file_size=file_size,
            )

            return key, presigned_url, file_size

        except Exception as e:
            logger.error(
                "image_upload_failed",
                key=key,
                user_id=user_id,
                project_id=project_id,
                error=str(e),
            )
            raise

    def delete_project_images(self, user_id: str | int, project_id: str | int) -> int:
        """Delete all images for a project."""
        prefix = f"images/{user_id}/{project_id}/"
        deleted_count = 0

        if not isinstance(self.backend, S3Backend):
            logger.warning(
                "delete_project_images_not_supported",
                backend_type=type(self.backend).__name__,
                message="Bulk delete not supported for this backend",
            )
            return 0

        try:
            response = self.backend.client.list_objects_v2(
                Bucket=self.backend.bucket_name, Prefix=prefix
            )

            if "Contents" not in response:
                logger.info(
                    "no_images_found",
                    user_id=user_id,
                    project_id=project_id,
                    prefix=prefix,
                )
                return 0

            for obj in response["Contents"]:
                key = obj["Key"]
                if self.delete_file(key):
                    deleted_count += 1

            logger.info(
                "project_images_deleted",
                user_id=user_id,
                project_id=project_id,
                deleted_count=deleted_count,
            )

            return deleted_count

        except ClientError as e:
            logger.error(
                "project_images_deletion_failed",
                user_id=user_id,
                project_id=project_id,
                error=str(e),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete project images: {str(e)}",
            )

    def _get_image_mime_type(self, filename: str) -> str:
        """Get MIME type from filename."""
        extension = Path(filename).suffix.lower()
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
        }
        return mime_types.get(extension, "application/octet-stream")


# Singleton instance
object_storage = ObjectStorageService()
