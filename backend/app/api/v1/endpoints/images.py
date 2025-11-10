"""
Image upload and management endpoints.

Handles image uploads to S3/MinIO with validation, storage tracking,
and presigned URL generation for secure access.
"""

import io
import uuid
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.models.user import User
from app.services.limit_checker import LimitChecker
from app.services.object_storage import object_storage
from app.services.storage_service import StorageQuotaExceeded, StorageService
from app.utils.authorization import verify_project_access

logger = structlog.get_logger(__name__)

router = APIRouter()

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
    "image/png": b"\x89\x50\x4E\x47",  # PNG signature
    "image/jpeg": b"\xFF\xD8\xFF",  # JPEG signature
    "image/gif": b"\x47\x49\x46",  # GIF signature
    "image/webp": b"\x52\x49\x46\x46",  # RIFF (WebP container)
}

# Presigned URL expiration: 7 days
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60  # 604800 seconds


def validate_image_mime_type(content_type: str | None) -> str:
    """
    Validate that the MIME type is an allowed image type.

    Args:
        content_type: MIME type from upload

    Returns:
        Validated MIME type

    Raises:
        HTTPException: If MIME type is not allowed
    """
    if not content_type or content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}",
        )
    return content_type


def validate_image_magic_bytes(file_data: bytes, content_type: str) -> None:
    """
    Validate file magic bytes match the declared MIME type.

    Args:
        file_data: First bytes of the file
        content_type: Declared MIME type

    Raises:
        HTTPException: If magic bytes don't match MIME type
    """
    # Special handling for JPEG (multiple valid signatures)
    if content_type in ("image/jpeg", "image/jpg"):
        if not file_data.startswith(MAGIC_BYTES["image/jpeg"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match JPEG format",
            )
        return

    # Special handling for WebP (need to check WEBP signature after RIFF)
    if content_type == "image/webp":
        if not file_data.startswith(b"RIFF") or b"WEBP" not in file_data[:12]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match WebP format",
            )
        return

    # Standard validation for PNG and GIF
    expected_magic = MAGIC_BYTES.get(content_type)
    if expected_magic and not file_data.startswith(expected_magic):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File content does not match {content_type} format",
        )


async def validate_file_size(file: UploadFile) -> int:
    """
    Validate file size is within limits.

    Args:
        file: Uploaded file

    Returns:
        File size in bytes

    Raises:
        HTTPException: If file is too large
    """
    # Read file to get size
    contents = await file.read()
    file_size = len(contents)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / (1024*1024):.1f}MB",
        )

    # Reset file pointer for later use
    await file.seek(0)

    return file_size


@router.post("/{project_id}/images/upload")
async def upload_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Upload an image to S3 with full validation.

    Steps:
    1. Verify user owns the project
    2. Check if user is in read-only mode
    3. Validate file is an image (MIME type and magic bytes)
    4. Validate file size < 10MB
    5. Check storage quota
    6. Upload to S3 with path: images/{user_id}/{project_id}/{uuid}.{ext}
    7. Track storage usage
    8. Return image details with presigned URL

    Args:
        db: Database session
        project_id: Project ID to associate image with
        file: Uploaded image file
        current_user: Current authenticated user

    Returns:
        Dictionary with:
        - image_id: Generated UUID for the image
        - s3_key: S3 storage key
        - presigned_url: Temporary URL for accessing the image (7 days)
        - size: File size in bytes
        - content_type: MIME type
        - created_at: Upload timestamp

    Raises:
        HTTPException: For various validation and permission errors
    """
    logger.info(
        "image_upload_request",
        user_id=str(current_user.id),
        project_id=project_id,
        filename=file.filename,
        content_type=file.content_type,
    )

    # Step 1: Verify project exists and user has access
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    verify_project_access(project, current_user, "upload images to")

    # Step 2: Check if user is in read-only mode
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is in read-only mode. {reason}. Upgrade your plan to continue uploading.",
        )

    # Step 3: Validate MIME type
    content_type = validate_image_mime_type(file.content_type)

    # Step 4: Validate file size
    file_size = await validate_file_size(file)

    # Read file contents for validation and upload
    file_contents = await file.read()

    # Step 5: Validate magic bytes
    validate_image_magic_bytes(file_contents, content_type)

    # Step 6: Check storage quota
    try:
        await StorageService.check_quota(
            db, current_user.id, current_user.subscription_tier, file_size
        )
    except StorageQuotaExceeded as e:
        logger.warning(
            "storage_quota_exceeded",
            user_id=str(current_user.id),
            file_size=file_size,
        )
        raise e

    # Step 7: Generate unique image ID and S3 key
    image_id = str(uuid.uuid4())
    # Extract file extension from original filename
    extension = ""
    if file.filename and "." in file.filename:
        extension = file.filename.rsplit(".", 1)[1].lower()
    else:
        # Fallback to content type
        extension_map = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/gif": "gif",
            "image/webp": "webp",
        }
        extension = extension_map.get(content_type, "jpg")

    # S3 key format: images/{user_id}/{project_id}/{uuid}.{ext}
    s3_key = f"images/{current_user.id}/{project_id}/{image_id}.{extension}"

    # Step 8: Upload to S3
    try:
        file_obj = io.BytesIO(file_contents)
        url = object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type=content_type,
            metadata={
                "user_id": str(current_user.id),
                "project_id": project_id,
                "image_id": image_id,
                "original_filename": file.filename or "unknown",
            },
        )

        logger.info(
            "image_uploaded_to_s3",
            user_id=str(current_user.id),
            project_id=project_id,
            s3_key=s3_key,
            file_size=file_size,
        )
    except Exception as e:
        logger.error(
            "s3_upload_failed",
            user_id=str(current_user.id),
            project_id=project_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image: {str(e)}",
        )

    # Step 9: Track storage usage
    try:
        await StorageService.track_upload(
            db=db,
            user_id=current_user.id,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_type="image",
            project_id=project_id,
        )
    except Exception as e:
        logger.error(
            "storage_tracking_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        # Don't fail the upload if tracking fails, but log it
        # The file is already in S3, so we return success

    # Step 10: Generate presigned URL for access
    try:
        presigned_url = object_storage.generate_presigned_url(
            s3_key, expiration=PRESIGNED_URL_EXPIRATION
        )
    except Exception as e:
        logger.error(
            "presigned_url_generation_failed",
            s3_key=s3_key,
            error=str(e),
        )
        # Use the public URL as fallback
        presigned_url = url

    created_at = datetime.utcnow()

    logger.info(
        "image_upload_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        image_id=image_id,
        s3_key=s3_key,
    )

    return {
        "image_id": image_id,
        "s3_key": s3_key,
        "presigned_url": presigned_url,
        "size": file_size,
        "content_type": content_type,
        "created_at": created_at.isoformat(),
    }


@router.delete("/{project_id}/images/{s3_key:path}")
async def delete_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    s3_key: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Delete an image from S3 and update storage tracking.

    Args:
        db: Database session
        project_id: Project ID the image belongs to
        s3_key: S3 storage key (path) of the image
        current_user: Current authenticated user

    Returns:
        Success message

    Raises:
        HTTPException: If project not found or access denied
    """
    logger.info(
        "image_delete_request",
        user_id=str(current_user.id),
        project_id=project_id,
        s3_key=s3_key,
    )

    # Verify project exists and user has access
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    verify_project_access(project, current_user, "delete images from")

    # Verify s3_key belongs to this user and project (security check)
    expected_prefix = f"images/{current_user.id}/{project_id}/"
    if not s3_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete images from other users or projects",
        )

    # Delete from S3
    try:
        success = object_storage.delete_file(s3_key)
        if not success:
            logger.warning(
                "s3_delete_failed",
                user_id=str(current_user.id),
                s3_key=s3_key,
            )
            # Continue anyway to clean up storage tracking
    except Exception as e:
        logger.error(
            "s3_delete_error",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        # Continue to clean up storage tracking even if S3 delete fails

    # Update storage tracking
    try:
        deleted = await StorageService.delete_file_record(
            db=db, file_path=s3_key, user_id=current_user.id
        )
        if not deleted:
            logger.warning(
                "storage_record_not_found",
                user_id=str(current_user.id),
                s3_key=s3_key,
            )
    except Exception as e:
        logger.error(
            "storage_tracking_delete_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )

    logger.info(
        "image_deleted",
        user_id=str(current_user.id),
        project_id=project_id,
        s3_key=s3_key,
    )

    return {"message": "Image deleted successfully", "s3_key": s3_key}


@router.post("/{project_id}/images/{s3_key:path}/refresh-url")
async def refresh_presigned_url(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    s3_key: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Refresh presigned URL for an existing image.

    Verifies the image exists in S3 and generates a new 7-day presigned URL.

    Args:
        db: Database session
        project_id: Project ID the image belongs to
        s3_key: S3 storage key (path) of the image
        current_user: Current authenticated user

    Returns:
        Dictionary with new presigned URL and expiration info

    Raises:
        HTTPException: If project not found, access denied, or image doesn't exist
    """
    logger.info(
        "refresh_url_request",
        user_id=str(current_user.id),
        project_id=project_id,
        s3_key=s3_key,
    )

    # Verify project exists and user has access
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    verify_project_access(project, current_user, "access images from")

    # Verify s3_key belongs to this user and project (security check)
    expected_prefix = f"images/{current_user.id}/{project_id}/"
    if not s3_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot access images from other users or projects",
        )

    # Verify file exists in S3
    try:
        exists = object_storage.file_exists(s3_key)
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Image not found in storage",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "s3_exists_check_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify image existence",
        )

    # Generate new presigned URL
    try:
        presigned_url = object_storage.generate_presigned_url(
            s3_key, expiration=PRESIGNED_URL_EXPIRATION
        )
    except Exception as e:
        logger.error(
            "presigned_url_generation_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate presigned URL",
        )

    logger.info(
        "presigned_url_refreshed",
        user_id=str(current_user.id),
        project_id=project_id,
        s3_key=s3_key,
    )

    return {
        "s3_key": s3_key,
        "presigned_url": presigned_url,
        "expires_in_seconds": PRESIGNED_URL_EXPIRATION,
        "expires_in_days": 7,
    }
