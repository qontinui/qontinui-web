"""
Video upload and retrieval endpoints for automation sessions.

Handles video uploads to S3 storage with validation, storage tracking,
and presigned URL generation for secure video playback.
"""

import io
from typing import Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.automation_video import AutomationVideo
from app.models.user import User
from app.services.limit_checker import LimitChecker
from app.services.object_storage import object_storage
from app.services.storage_service import StorageQuotaExceeded, StorageService

logger = structlog.get_logger(__name__)

router = APIRouter()

# Allowed MIME types for videos
ALLOWED_VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",  # .mov files
    "video/x-matroska",  # .mkv files
    "video/avi",
}

# File size limit: 500MB for videos
MAX_VIDEO_FILE_SIZE = 500 * 1024 * 1024  # 500MB in bytes

# Presigned URL expiration: 1 hour
VIDEO_PRESIGNED_URL_EXPIRATION = 60 * 60  # 3600 seconds


def validate_video_mime_type(content_type: str | None) -> str:
    """
    Validate that the MIME type is an allowed video type.

    Args:
        content_type: MIME type from upload

    Returns:
        Validated MIME type

    Raises:
        HTTPException: If MIME type is not allowed
    """
    if not content_type or content_type not in ALLOWED_VIDEO_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid video type. Allowed types: {', '.join(ALLOWED_VIDEO_MIME_TYPES)}",
        )
    return content_type


async def validate_video_file_size(file: UploadFile) -> int:
    """
    Validate file size is within limits for videos.

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

    if file_size > MAX_VIDEO_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Video too large. Maximum size: {MAX_VIDEO_FILE_SIZE / (1024*1024):.1f}MB",
        )

    # Reset file pointer for later use
    await file.seek(0)

    return file_size


async def check_video_storage_quota(
    db: AsyncSession, user: User, file_size: int
) -> None:
    """
    Check if user has sufficient storage quota for video upload.

    Args:
        db: Database session
        user: Current user
        file_size: Size of video file in bytes

    Raises:
        HTTPException: If storage quota would be exceeded
    """
    try:
        await StorageService.check_quota(
            db, user.id, user.subscription_tier, file_size
        )
    except StorageQuotaExceeded as e:
        logger.warning(
            "video_storage_quota_exceeded",
            user_id=str(user.id),
            file_size=file_size,
        )
        raise e


@router.post("/sessions/{session_id}/upload-video")
async def upload_session_video(
    *,
    db: AsyncSession = Depends(get_async_db),
    session_id: str,
    file: UploadFile = File(...),
    duration_seconds: int | None = Form(None),
    fps: int | None = Form(None),
    quality: str | None = Form(None),
    project_id: int | None = Form(None),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Upload a video recording for an automation session.

    Steps:
    1. Check if user is in read-only mode
    2. Validate file is a video (MIME type)
    3. Validate file size < 500MB
    4. Check storage quota
    5. Check if video already exists for this session
    6. Upload to S3 with path: videos/{user_id}/sessions/{session_id}.{ext}
    7. Create database record
    8. Track storage usage
    9. Return video details with presigned URL

    Args:
        db: Database session
        session_id: Unique session identifier
        file: Uploaded video file
        duration_seconds: Video duration in seconds (optional)
        fps: Frames per second (optional)
        quality: Video quality descriptor (optional)
        project_id: Associated project ID (optional)
        current_user: Current authenticated user

    Returns:
        Dictionary with:
        - video_id: Database record ID
        - session_id: Session identifier
        - s3_key: S3 storage key
        - presigned_url: Temporary URL for accessing the video (1 hour)
        - duration_seconds: Video duration
        - fps: Frames per second
        - quality: Video quality
        - size: File size in bytes
        - content_type: MIME type
        - created_at: Upload timestamp

    Raises:
        HTTPException: For various validation and permission errors
    """
    logger.info(
        "video_upload_request",
        user_id=str(current_user.id),
        session_id=session_id,
        filename=file.filename,
        content_type=file.content_type,
    )

    # Step 1: Check if user is in read-only mode
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is in read-only mode. {reason}. Upgrade your plan to continue uploading.",
        )

    # Step 2: Validate MIME type
    content_type = validate_video_mime_type(file.content_type)

    # Step 3: Validate file size
    file_size = await validate_video_file_size(file)

    # Step 4: Check storage quota
    await check_video_storage_quota(db, current_user, file_size)

    # Step 5: Check if video already exists for this session
    result = await db.execute(
        select(AutomationVideo).filter(AutomationVideo.session_id == session_id)
    )
    existing_video = result.scalar_one_or_none()

    if existing_video:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Video already exists for session {session_id}",
        )

    # Step 6: Generate S3 key and upload
    # Extract file extension from original filename
    extension = ""
    if file.filename and "." in file.filename:
        extension = file.filename.rsplit(".", 1)[1].lower()
    else:
        # Fallback to content type
        extension_map = {
            "video/mp4": "mp4",
            "video/webm": "webm",
            "video/quicktime": "mov",
            "video/x-matroska": "mkv",
            "video/avi": "avi",
        }
        extension = extension_map.get(content_type, "mp4")

    # S3 key format: videos/{user_id}/sessions/{session_id}.{ext}
    s3_key = f"videos/{current_user.id}/sessions/{session_id}.{extension}"

    # Read file contents for upload
    file_contents = await file.read()

    # Upload to S3
    try:
        file_obj = io.BytesIO(file_contents)
        object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type=content_type,
            metadata={
                "user_id": str(current_user.id),
                "session_id": session_id,
                "project_id": str(project_id) if project_id else "",
                "original_filename": file.filename or "unknown",
            },
        )

        logger.info(
            "video_uploaded_to_s3",
            user_id=str(current_user.id),
            session_id=session_id,
            s3_key=s3_key,
            file_size=file_size,
        )
    except Exception as e:
        logger.error(
            "s3_video_upload_failed",
            user_id=str(current_user.id),
            session_id=session_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload video: {str(e)}",
        )

    # Step 7: Create database record
    try:
        video_record = AutomationVideo(
            session_id=session_id,
            user_id=current_user.id,
            project_id=project_id,
            s3_key=s3_key,
            duration_seconds=duration_seconds,
            fps=fps,
            quality=quality,
            file_size_bytes=file_size,
        )
        db.add(video_record)
        await db.commit()
        await db.refresh(video_record)

        logger.info(
            "video_record_created",
            video_id=video_record.id,
            session_id=session_id,
            user_id=str(current_user.id),
        )
    except Exception as e:
        logger.error(
            "video_record_creation_failed",
            user_id=str(current_user.id),
            session_id=session_id,
            error=str(e),
        )
        # Try to clean up S3 upload
        try:
            object_storage.delete_file(s3_key)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create video record: {str(e)}",
        )

    # Step 8: Track storage usage
    try:
        await StorageService.track_upload(
            db=db,
            user_id=current_user.id,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_type="video",
            project_id=str(project_id) if project_id else None,
        )
    except Exception as e:
        logger.error(
            "video_storage_tracking_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        # Don't fail the upload if tracking fails

    # Step 9: Generate presigned URL for access
    try:
        presigned_url = object_storage.generate_presigned_url(
            s3_key, expiration=VIDEO_PRESIGNED_URL_EXPIRATION
        )
    except Exception as e:
        logger.error(
            "video_presigned_url_generation_failed",
            s3_key=s3_key,
            error=str(e),
        )
        # Generate a fallback URL
        presigned_url = f"https://{object_storage.backend.bucket_name}.s3.{object_storage.backend.region}.amazonaws.com/{s3_key}"

    logger.info(
        "video_upload_complete",
        user_id=str(current_user.id),
        session_id=session_id,
        video_id=video_record.id,
        s3_key=s3_key,
    )

    return {
        "video_id": video_record.id,
        "session_id": video_record.session_id,
        "s3_key": video_record.s3_key,
        "presigned_url": presigned_url,
        "duration_seconds": video_record.duration_seconds,
        "fps": video_record.fps,
        "quality": video_record.quality,
        "size": video_record.file_size_bytes,
        "content_type": content_type,
        "created_at": video_record.created_at.isoformat(),
    }


@router.get("/sessions/{session_id}/video")
async def get_session_video(
    *,
    db: AsyncSession = Depends(get_async_db),
    session_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Retrieve video information for an automation session.

    Generates a fresh presigned URL for video access.

    Args:
        db: Database session
        session_id: Session identifier
        current_user: Current authenticated user

    Returns:
        Dictionary with:
        - video_id: Database record ID
        - session_id: Session identifier
        - s3_key: S3 storage key
        - presigned_url: Temporary URL for accessing the video (1 hour)
        - duration_seconds: Video duration
        - fps: Frames per second
        - quality: Video quality
        - size: File size in bytes
        - created_at: Upload timestamp
        - expires_in_seconds: Presigned URL expiration time

    Raises:
        HTTPException: If video not found or access denied
    """
    logger.info(
        "video_retrieval_request",
        user_id=str(current_user.id),
        session_id=session_id,
    )

    # Retrieve video record
    result = await db.execute(
        select(AutomationVideo).filter(
            AutomationVideo.session_id == session_id,
            AutomationVideo.user_id == current_user.id,
        )
    )
    video = result.scalar_one_or_none()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video not found for session {session_id}",
        )

    # Verify file exists in S3
    try:
        exists = object_storage.file_exists(video.s3_key)
        if not exists:
            logger.error(
                "video_file_missing_in_s3",
                video_id=video.id,
                s3_key=video.s3_key,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Video file not found in storage",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "s3_video_exists_check_failed",
            video_id=video.id,
            s3_key=video.s3_key,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify video existence",
        )

    # Generate presigned URL
    try:
        presigned_url = object_storage.generate_presigned_url(
            video.s3_key, expiration=VIDEO_PRESIGNED_URL_EXPIRATION
        )
    except Exception as e:
        logger.error(
            "video_presigned_url_generation_failed",
            video_id=video.id,
            s3_key=video.s3_key,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate video URL",
        )

    logger.info(
        "video_retrieval_complete",
        user_id=str(current_user.id),
        session_id=session_id,
        video_id=video.id,
    )

    return {
        "video_id": video.id,
        "session_id": video.session_id,
        "s3_key": video.s3_key,
        "presigned_url": presigned_url,
        "duration_seconds": video.duration_seconds,
        "fps": video.fps,
        "quality": video.quality,
        "size": video.file_size_bytes,
        "created_at": video.created_at.isoformat(),
        "expires_in_seconds": VIDEO_PRESIGNED_URL_EXPIRATION,
    }


@router.delete("/sessions/{session_id}/video")
async def delete_session_video(
    *,
    db: AsyncSession = Depends(get_async_db),
    session_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Delete a video recording for an automation session.

    Args:
        db: Database session
        session_id: Session identifier
        current_user: Current authenticated user

    Returns:
        Success message

    Raises:
        HTTPException: If video not found or access denied
    """
    logger.info(
        "video_deletion_request",
        user_id=str(current_user.id),
        session_id=session_id,
    )

    # Retrieve video record
    result = await db.execute(
        select(AutomationVideo).filter(
            AutomationVideo.session_id == session_id,
            AutomationVideo.user_id == current_user.id,
        )
    )
    video = result.scalar_one_or_none()

    if not video:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video not found for session {session_id}",
        )

    s3_key = video.s3_key

    # Delete from S3
    try:
        success = object_storage.delete_file(s3_key)
        if not success:
            logger.warning(
                "s3_video_delete_failed",
                video_id=video.id,
                s3_key=s3_key,
            )
    except Exception as e:
        logger.error(
            "s3_video_delete_error",
            video_id=video.id,
            s3_key=s3_key,
            error=str(e),
        )

    # Delete database record
    try:
        await db.delete(video)
        await db.commit()

        logger.info(
            "video_record_deleted",
            video_id=video.id,
            session_id=session_id,
        )
    except Exception as e:
        logger.error(
            "video_record_deletion_failed",
            video_id=video.id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete video record",
        )

    # Delete storage tracking record
    try:
        await StorageService.delete_file_record(
            db=db, file_path=s3_key, user_id=current_user.id
        )
    except Exception as e:
        logger.error(
            "video_storage_tracking_deletion_failed",
            s3_key=s3_key,
            error=str(e),
        )

    logger.info(
        "video_deletion_complete",
        user_id=str(current_user.id),
        session_id=session_id,
    )

    return {
        "message": "Video deleted successfully",
        "session_id": session_id,
        "s3_key": s3_key,
    }
