"""Training data export endpoints.

Provides endpoints for exporting training data to S3 and local filesystem.
"""

import os
from pathlib import Path

import boto3
import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.training_export import (
    LocalExportRequest,
    LocalExportResponse,
    S3ExportRequest,
    S3ExportResponse,
)
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()

# Allowed base directories for local export (security measure)
# These should be configured based on deployment environment
ALLOWED_LOCAL_PATHS: list[str] = [
    # Development paths
    "D:/qontinui_parent_directory/exports",
    "D:/qontinui_parent_directory/training_data",
    # User home exports directory
    os.path.expanduser("~/qontinui_exports"),
    # Temp directory for testing
    os.path.join(os.environ.get("TEMP", "/tmp"), "qontinui_exports"),
]


def is_path_allowed(target_path: str) -> bool:
    """Check if the target path is within allowed directories.

    Args:
        target_path: The path to validate

    Returns:
        True if the path is within an allowed directory
    """
    # Resolve to absolute path to prevent path traversal
    try:
        resolved = Path(target_path).resolve()
    except (ValueError, OSError):
        return False

    for allowed in ALLOWED_LOCAL_PATHS:
        try:
            allowed_resolved = Path(allowed).resolve()
            # Check if target is under allowed path
            try:
                resolved.relative_to(allowed_resolved)
                return True
            except ValueError:
                continue
        except (ValueError, OSError):
            continue

    return False


@router.post("/s3", response_model=S3ExportResponse)
async def export_to_s3(
    *,
    db: AsyncSession = Depends(get_async_db),
    request: S3ExportRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> S3ExportResponse:
    """Export training data to S3.

    Uploads the provided data to an S3 bucket with the specified key prefix.
    Requires valid AWS credentials configured in the environment.

    Args:
        db: Database session (for future audit logging)
        request: Export request with data, filename, bucket, prefix, and region
        current_user: Authenticated user making the request

    Returns:
        S3ExportResponse with the URL of the uploaded file

    Raises:
        HTTPException: If S3 upload fails or credentials are invalid
    """
    logger.info(
        "s3_export_request",
        user_id=str(current_user.id),
        bucket=request.bucket,
        prefix=request.prefix,
        filename=request.filename,
        data_size=len(request.data),
        has_extra=request.extra is not None,
    )

    try:
        # Create S3 client with specified region
        s3_client = boto3.client(
            "s3",
            region_name=request.region,
            # Use default credential chain (env vars, IAM role, ~/.aws/credentials)
        )

        # Construct S3 key
        s3_key = (
            f"{request.prefix}/{request.filename}"
            if request.prefix
            else request.filename
        )

        # Upload main file
        s3_client.put_object(
            Bucket=request.bucket,
            Key=s3_key,
            Body=request.data.encode("utf-8"),
            ContentType="application/json",
        )

        # Construct URL
        main_url = f"s3://{request.bucket}/{s3_key}"

        logger.info(
            "s3_export_main_success",
            user_id=str(current_user.id),
            s3_key=s3_key,
            url=main_url,
        )

        # Upload extra file if provided
        extra_url = None
        extra_filename = None
        if request.extra:
            extra_s3_key = (
                f"{request.prefix}/{request.extra.filename}"
                if request.prefix
                else request.extra.filename
            )

            s3_client.put_object(
                Bucket=request.bucket,
                Key=extra_s3_key,
                Body=request.extra.data.encode("utf-8"),
                ContentType="application/json",
            )

            extra_url = f"s3://{request.bucket}/{extra_s3_key}"
            extra_filename = request.extra.filename

            logger.info(
                "s3_export_extra_success",
                user_id=str(current_user.id),
                s3_key=extra_s3_key,
                url=extra_url,
            )

        return S3ExportResponse(
            url=main_url,
            filename=request.filename,
            extra_url=extra_url,
            extra_filename=extra_filename,
        )

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", str(e))

        logger.error(
            "s3_export_client_error",
            user_id=str(current_user.id),
            bucket=request.bucket,
            error_code=error_code,
            error_message=error_message,
        )

        if error_code == "NoSuchBucket":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"S3 bucket '{request.bucket}' does not exist",
            )
        elif error_code in (
            "AccessDenied",
            "InvalidAccessKeyId",
            "SignatureDoesNotMatch",
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to S3 bucket. Check AWS credentials and permissions.",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"S3 upload failed: {error_message}",
            )

    except BotoCoreError as e:
        logger.error(
            "s3_export_boto_error",
            user_id=str(current_user.id),
            bucket=request.bucket,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"S3 connection error: {str(e)}",
        )

    except Exception as e:
        logger.error(
            "s3_export_unexpected_error",
            user_id=str(current_user.id),
            bucket=request.bucket,
            error=str(e),
            error_type=type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during S3 export: {str(e)}",
        )


@router.post("/local", response_model=LocalExportResponse)
async def export_to_local(
    *,
    db: AsyncSession = Depends(get_async_db),
    request: LocalExportRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> LocalExportResponse:
    """Export training data to local filesystem.

    Writes the provided data to a file in the specified directory.
    The directory must be within the allowed paths for security.

    Args:
        db: Database session (for future audit logging)
        request: Export request with data, filename, and path
        current_user: Authenticated user making the request

    Returns:
        LocalExportResponse with the full path of the written file

    Raises:
        HTTPException: If path is not allowed or write fails
    """
    logger.info(
        "local_export_request",
        user_id=str(current_user.id),
        path=request.path,
        filename=request.filename,
        data_size=len(request.data),
        has_extra=request.extra is not None,
    )

    # Security check: validate path is within allowed directories
    if not is_path_allowed(request.path):
        logger.warning(
            "local_export_path_denied",
            user_id=str(current_user.id),
            path=request.path,
            allowed_paths=ALLOWED_LOCAL_PATHS,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Export path not allowed. Allowed base directories: {ALLOWED_LOCAL_PATHS}",
        )

    try:
        # Create directory if it doesn't exist
        target_dir = Path(request.path)
        target_dir.mkdir(parents=True, exist_ok=True)

        # Write main file
        main_file_path = target_dir / request.filename
        main_file_path.write_text(request.data, encoding="utf-8")

        logger.info(
            "local_export_main_success",
            user_id=str(current_user.id),
            path=str(main_file_path),
        )

        # Write extra file if provided
        extra_path = None
        extra_filename = None
        if request.extra:
            extra_file_path = target_dir / request.extra.filename
            extra_file_path.write_text(request.extra.data, encoding="utf-8")
            extra_path = str(extra_file_path)
            extra_filename = request.extra.filename

            logger.info(
                "local_export_extra_success",
                user_id=str(current_user.id),
                path=extra_path,
            )

        return LocalExportResponse(
            path=str(main_file_path),
            filename=request.filename,
            extra_path=extra_path,
            extra_filename=extra_filename,
        )

    except PermissionError as e:
        logger.error(
            "local_export_permission_error",
            user_id=str(current_user.id),
            path=request.path,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied writing to path: {request.path}",
        )

    except OSError as e:
        logger.error(
            "local_export_os_error",
            user_id=str(current_user.id),
            path=request.path,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file: {str(e)}",
        )

    except Exception as e:
        logger.error(
            "local_export_unexpected_error",
            user_id=str(current_user.id),
            path=request.path,
            error=str(e),
            error_type=type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error during local export: {str(e)}",
        )
