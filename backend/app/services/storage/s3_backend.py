"""AWS S3 storage backend."""

import mimetypes
from typing import BinaryIO

import boto3
import structlog
from app.core.config import settings
from app.services.storage.base import StorageBackend
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

logger = structlog.get_logger(__name__)


class S3Backend(StorageBackend):
    """AWS S3 storage backend."""

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
        s3_addressing_style = "path" if endpoint_url else "auto"
        config = Config(
            region_name=region,
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            s3={"addressing_style": s3_addressing_style},
        )

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
            if access_key and secret_key:
                self.client = boto3.client(
                    "s3",
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    config=config,
                )
            else:
                self.client = boto3.client("s3", config=config)
            self.use_path_style = False

        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self):
        """Create bucket if it doesn't exist."""
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
                if settings.ENVIRONMENT == "production":
                    logger.warning(
                        "bucket_access_restricted",
                        bucket=self.bucket_name,
                        message="Received 403 on head_bucket, assuming bucket exists",
                    )
                else:
                    logger.debug(
                        "bucket_access_restricted_dev",
                        bucket=self.bucket_name,
                        message="403 on head_bucket (expected in development)",
                    )
            else:
                logger.error(
                    "bucket_check_failed", bucket=self.bucket_name, error=str(e)
                )
                raise

    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
        cache_control: str | None = None,
    ) -> str:
        """Upload file to S3."""
        try:
            extra_args: dict[str, str | dict[str, str]] = {}

            if content_type:
                extra_args["ContentType"] = content_type
            else:
                guessed_type = mimetypes.guess_type(key)[0]
                if guessed_type:
                    extra_args["ContentType"] = guessed_type

            if metadata:
                extra_args["Metadata"] = {str(k): str(v) for k, v in metadata.items()}

            if cache_control:
                extra_args["CacheControl"] = cache_control
            elif content_type and content_type.startswith("image/"):
                extra_args["CacheControl"] = "max-age=31536000, immutable"

            self.client.upload_fileobj(
                file_obj, self.bucket_name, key, ExtraArgs=extra_args
            )

            logger.info("file_uploaded", key=key, bucket=self.bucket_name)
            return f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{key}"

        except ClientError as e:
            logger.error("upload_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to upload file: {str(e)}",
            )

    def download_file(self, key: str) -> bytes:
        """Download file from S3."""
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=key)
            body_data: bytes = response["Body"].read()
            return body_data
        except ClientError as e:
            logger.error("download_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {key}",
            )

    def delete_file(self, key: str) -> bool:
        """Delete file from S3."""
        try:
            self.client.delete_object(Bucket=self.bucket_name, Key=key)
            logger.info("file_deleted", key=key, bucket=self.bucket_name)
            return True
        except ClientError as e:
            logger.error("delete_failed", key=key, error=str(e))
            return False

    def get_cdn_url(self, key: str) -> str:
        """Get CDN URL for accessing an image."""
        if settings.USE_CLOUDFRONT and settings.CLOUDFRONT_DOMAIN:
            return f"https://{settings.CLOUDFRONT_DOMAIN}/{key}"
        return self.generate_presigned_url(key, expiration=7 * 24 * 3600)

    def generate_presigned_url(
        self, key: str, expiration: int = 3600, http_method: str = "GET"
    ) -> str:
        """Generate presigned URL for temporary access."""
        try:
            url: str = self.client.generate_presigned_url(
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
        """Check if file exists."""
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False

    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata."""
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
