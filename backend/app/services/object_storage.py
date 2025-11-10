"""
Object storage service for S3/MinIO

Provides a unified interface for file storage supporting both AWS S3 and MinIO.
Automatically selects the appropriate backend based on configuration.
"""

import io
import mimetypes
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO

import boto3
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

from app.core.config import settings

logger = structlog.get_logger(__name__)


class StorageBackend(ABC):
    """Abstract base class for storage backends"""

    @abstractmethod
    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Upload file and return public URL"""
        pass

    @abstractmethod
    def download_file(self, key: str) -> bytes:
        """Download file and return bytes"""
        pass

    @abstractmethod
    def delete_file(self, key: str) -> bool:
        """Delete file, return True if successful"""
        pass

    @abstractmethod
    def generate_presigned_url(
        self, key: str, expiration: int = 3600, http_method: str = "GET"
    ) -> str:
        """Generate presigned URL for temporary access"""
        pass

    @abstractmethod
    def file_exists(self, key: str) -> bool:
        """Check if file exists"""
        pass

    @abstractmethod
    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata"""
        pass


class S3Backend(StorageBackend):
    """AWS S3 storage backend"""

    def __init__(
        self,
        bucket_name: str,
        region: str,
        access_key: str | None = None,
        secret_key: str | None = None,
        endpoint_url: str | None = None,
    ):
        self.bucket_name = bucket_name
        self.region = region

        # Configure boto3 client
        # MinIO requires path-style addressing
        s3_addressing_style = "path" if endpoint_url else "auto"
        config = Config(
            region_name=region,
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            s3={"addressing_style": s3_addressing_style},
        )

        # Support for MinIO or S3-compatible services
        if endpoint_url:
            self.client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                config=config,
            )
            self.use_path_style = True
        else:
            # AWS S3
            if access_key and secret_key:
                self.client = boto3.client(
                    "s3",
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    config=config,
                )
            else:
                # Use IAM role or environment credentials
                self.client = boto3.client("s3", config=config)
            self.use_path_style = False

        # Ensure bucket exists
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self):
        """Create bucket if it doesn't exist"""
        try:
            self.client.head_bucket(Bucket=self.bucket_name)
            logger.info("bucket_exists", bucket=self.bucket_name)
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code == "404":
                try:
                    if self.region == "us-east-1":
                        self.client.create_bucket(Bucket=self.bucket_name)
                    else:
                        self.client.create_bucket(
                            Bucket=self.bucket_name,
                            CreateBucketConfiguration={
                                "LocationConstraint": self.region
                            },
                        )
                    logger.info("bucket_created", bucket=self.bucket_name)
                except ClientError as create_error:
                    logger.error(
                        "bucket_creation_failed",
                        bucket=self.bucket_name,
                        error=str(create_error),
                    )
                    raise
            elif error_code == "403":
                # For MinIO, 403 on head_bucket often means bucket exists but has access restrictions
                # We'll assume the bucket exists and continue
                logger.warning(
                    "bucket_access_restricted",
                    bucket=self.bucket_name,
                    message="Received 403 on head_bucket, assuming bucket exists"
                )
            else:
                logger.error(
                    "bucket_check_failed",
                    bucket=self.bucket_name,
                    error=str(e),
                )
                raise

    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Upload file to S3"""
        try:
            # Prepare upload arguments
            extra_args = {}

            if content_type:
                extra_args["ContentType"] = content_type
            else:
                # Guess content type from filename
                guessed_type = mimetypes.guess_type(key)[0]
                if guessed_type:
                    extra_args["ContentType"] = guessed_type

            if metadata:
                extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}

            # Upload file
            self.client.upload_fileobj(
                file_obj, self.bucket_name, key, ExtraArgs=extra_args
            )

            logger.info("file_uploaded", key=key, bucket=self.bucket_name)

            # Return public URL (or use presigned URL if bucket is private)
            return f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{key}"

        except ClientError as e:
            logger.error("upload_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to upload file: {str(e)}",
            )

    def download_file(self, key: str) -> bytes:
        """Download file from S3"""
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=key)
            return response["Body"].read()
        except ClientError as e:
            logger.error("download_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {key}",
            )

    def delete_file(self, key: str) -> bool:
        """Delete file from S3"""
        try:
            self.client.delete_object(Bucket=self.bucket_name, Key=key)
            logger.info("file_deleted", key=key, bucket=self.bucket_name)
            return True
        except ClientError as e:
            logger.error("delete_failed", key=key, error=str(e))
            return False

    def generate_presigned_url(
        self, key: str, expiration: int = 3600, http_method: str = "GET"
    ) -> str:
        """Generate presigned URL for temporary access"""
        try:
            url = self.client.generate_presigned_url(
                "get_object" if http_method == "GET" else "put_object",
                Params={"Bucket": self.bucket_name, "Key": key},
                ExpiresIn=expiration,
            )
            return url
        except ClientError as e:
            logger.error("presigned_url_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate presigned URL",
            )

    def file_exists(self, key: str) -> bool:
        """Check if file exists"""
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False

    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata"""
        try:
            response = self.client.head_object(Bucket=self.bucket_name, Key=key)
            return {
                "size": response["ContentLength"],
                "content_type": response.get("ContentType"),
                "last_modified": response["LastModified"],
                "metadata": response.get("Metadata", {}),
            }
        except ClientError as e:
            logger.error("metadata_fetch_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {key}",
            )


class ObjectStorageService:
    """
    Unified object storage service

    Automatically configures backend based on environment variables.
    Supports both AWS S3 (production) and MinIO (development).
    """

    def __init__(self):
        self.backend: StorageBackend

        # Determine which backend to use
        if settings.STORAGE_ENDPOINT_URL:
            # MinIO or S3-compatible service
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
            # AWS S3
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
        """
        Upload file to storage

        Args:
            file_obj: File object to upload
            prefix: Path prefix (e.g., "avatars", "screenshots")
            filename: Original filename
            content_type: MIME type
            metadata: Additional metadata
            generate_unique_name: Whether to generate unique filename

        Returns:
            Tuple of (storage_key, public_url)
        """
        # Generate unique filename if requested
        if generate_unique_name:
            extension = Path(filename).suffix
            unique_name = f"{uuid.uuid4()}{extension}"
            key = f"{prefix}/{unique_name}"
        else:
            key = f"{prefix}/{filename}"

        # Upload file
        url = self.backend.upload_file(
            file_obj=file_obj,
            key=key,
            content_type=content_type,
            metadata=metadata,
        )

        return key, url

    def download_file(self, key: str) -> bytes:
        """Download file from storage"""
        return self.backend.download_file(key)

    def delete_file(self, key: str) -> bool:
        """Delete file from storage"""
        return self.backend.delete_file(key)

    def generate_presigned_url(self, key: str, expiration: int = 3600) -> str:
        """Generate temporary URL for file access"""
        return self.backend.generate_presigned_url(key, expiration)

    def file_exists(self, key: str) -> bool:
        """Check if file exists"""
        return self.backend.file_exists(key)

    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata"""
        return self.backend.get_file_metadata(key)

    def upload_from_path(
        self,
        file_path: Path,
        prefix: str,
        content_type: str | None = None,
        metadata: dict | None = None,
        generate_unique_name: bool = True,
    ) -> tuple[str, str]:
        """Upload file from filesystem path"""
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
        """Upload bytes to storage"""
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
        """
        Upload image with proper path structure

        Args:
            file_obj: Image file object to upload
            user_id: User ID for path organization
            project_id: Project ID for path organization
            filename: Original filename (used for extension detection)
            metadata: Optional metadata to attach to the file

        Returns:
            Tuple of (s3_key, presigned_url, file_size)

        Example:
            s3_key, presigned_url, file_size = upload_image(
                file_obj=image_file,
                user_id=123,
                project_id=456,
                filename="screenshot.png",
                metadata={"description": "UI screenshot"}
            )
        """
        # Generate unique filename with UUID
        extension = Path(filename).suffix
        unique_filename = f"{uuid.uuid4()}{extension}"

        # Construct path: images/{user_id}/{project_id}/{uuid}.{ext}
        prefix = f"images/{user_id}/{project_id}"
        key = f"{prefix}/{unique_filename}"

        # Detect MIME type from filename
        content_type = self._get_image_mime_type(filename)

        # Get file size by seeking to end and back
        current_pos = file_obj.tell()
        file_obj.seek(0, 2)  # Seek to end
        file_size = file_obj.tell()
        file_obj.seek(current_pos)  # Seek back to original position

        # Upload to S3 with metadata
        try:
            self.backend.upload_file(
                file_obj=file_obj,
                key=key,
                content_type=content_type,
                metadata=metadata,
            )

            # Generate presigned URL (7 days = 604800 seconds)
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

    def delete_project_images(
        self, user_id: str | int, project_id: str | int
    ) -> int:
        """
        Delete all images for a project

        Args:
            user_id: User ID for path organization
            project_id: Project ID for path organization

        Returns:
            Number of files deleted

        Example:
            deleted_count = delete_project_images(user_id=123, project_id=456)
        """
        prefix = f"images/{user_id}/{project_id}/"
        deleted_count = 0

        try:
            # List all objects with the prefix
            response = self.backend.client.list_objects_v2(
                Bucket=self.backend.bucket_name, Prefix=prefix
            )

            # Check if any objects were found
            if "Contents" not in response:
                logger.info(
                    "no_images_found",
                    user_id=user_id,
                    project_id=project_id,
                    prefix=prefix,
                )
                return 0

            # Delete each object
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
        """
        Private helper to get MIME type from filename

        Args:
            filename: Filename with extension

        Returns:
            MIME type string

        Supported formats:
            - .png -> image/png
            - .jpg, .jpeg -> image/jpeg
            - .gif -> image/gif
            - .webp -> image/webp
        """
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
