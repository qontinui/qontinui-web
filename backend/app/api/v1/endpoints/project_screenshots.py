"""
API endpoints for project screenshots management.

Handles uploading, listing, updating, and deleting screenshots for projects.
Screenshots can be used for workflow automation, pattern matching, and state discovery.
"""

import io
import uuid
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.core.error_codes import ErrorCode
from app.crud.project import get_project
from app.middleware.error_handler import (
    forbidden_error,
    not_found_error,
    validation_error,
)
from app.models.organization import PermissionLevel
from app.models.project_assets import ProjectScreenshot
from app.models.user import User
from app.schemas.project_assets import (
    BatchDeleteResponse,
    BatchProjectScreenshotDelete,
    ProjectScreenshotListResponse,
    ProjectScreenshotResponse,
    ProjectScreenshotUpdate,
)
from app.services.limit_checker import LimitChecker
from app.services.object_storage import object_storage
from app.services.permission_service import permission_service
from app.services.storage_service import StorageQuotaExceeded, StorageService

logger = structlog.get_logger(__name__)

router = APIRouter()

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


def validate_screenshot_mime_type(content_type: str | None) -> str:
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
        raise validation_error(
            f"Invalid file type. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}",
            "file",
            ErrorCode.INVALID_FILE_TYPE,
        )
    return content_type


async def validate_file_size(file: UploadFile) -> tuple[bytes, int]:
    """
    Validate file size is within limits.

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
            f"File too large. Maximum size: {MAX_FILE_SIZE / (1024*1024):.1f}MB",
            "file",
            ErrorCode.INVALID_FILE_SIZE,
        )

    return contents, file_size


def get_image_dimensions(file_contents: bytes) -> tuple[int, int]:
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
            return img.size
    except Exception as e:
        logger.error("image_open_failed", error=str(e))
        raise validation_error(
            "Failed to read image. File may be corrupted or not a valid image.",
            "file",
        )


@router.post("/{project_id}/screenshots/upload")
async def upload_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    file: UploadFile = File(...),
    name: str = Query(..., min_length=1, max_length=255, description="Screenshot name"),
    source: str = Query(
        "manual_upload",
        description="Source of screenshot: manual_upload, runner_capture, web_capture",
    ),
    monitor_index: int | None = Query(
        None, ge=0, description="Monitor index (for multi-monitor setups)"
    ),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Upload a screenshot to a project.

    Steps:
    1. Verify user has EDIT permission on project
    2. Check if user is in read-only mode
    3. Validate file type and size
    4. Check storage quota
    5. Upload to S3: screenshots/{user_id}/{project_id}/{uuid}.{ext}
    6. Create ProjectScreenshot record in database
    7. Return screenshot details with presigned URL

    Args:
        db: Database session
        project_id: Project ID to associate screenshot with
        file: Uploaded screenshot file
        name: Name for the screenshot
        source: Source of screenshot (manual_upload, runner_capture, web_capture)
        monitor_index: Optional monitor index for multi-monitor captures
        current_user: Current authenticated user

    Returns:
        ProjectScreenshotResponse with presigned URL

    Raises:
        HTTPException: For various validation and permission errors
    """
    logger.info(
        "screenshot_upload_request",
        user_id=str(current_user.id),
        project_id=project_id,
        filename=file.filename,
        content_type=file.content_type,
        name=name,
        source=source,
    )

    # Verify project exists and user has EDIT permission
    project = await get_project(db, project_id=UUID(project_id))
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, current_user.id, UUID(project_id), PermissionLevel.EDIT
    )
    if not has_permission:
        raise forbidden_error(
            "EDIT permission required to upload screenshots to this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Check if user is in read-only mode
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        raise forbidden_error(
            f"Account is in read-only mode. {reason}. Upgrade your plan to continue uploading.",
            ErrorCode.ACCOUNT_READ_ONLY,
        )

    # Validate MIME type
    content_type = validate_screenshot_mime_type(file.content_type)

    # Validate file size and read contents
    file_contents, file_size = await validate_file_size(file)

    # Get image dimensions
    width, height = get_image_dimensions(file_contents)

    # Check storage quota
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

    # Generate unique screenshot ID and determine extension
    screenshot_id = str(uuid.uuid4())
    extension = ""
    if file.filename and "." in file.filename:
        extension = file.filename.rsplit(".", 1)[1].lower()
    else:
        extension_map = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/webp": "webp",
        }
        extension = extension_map.get(content_type, "png")

    # Upload to S3
    # Path: screenshots/{user_id}/{project_id}/{uuid}.{ext}
    s3_key = f"screenshots/{current_user.id}/{project_id}/{screenshot_id}.{extension}"

    try:
        file_obj = io.BytesIO(file_contents)
        url = object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type=content_type,
            metadata={
                "user_id": str(current_user.id),
                "project_id": project_id,
                "screenshot_id": screenshot_id,
                "original_filename": file.filename or "unknown",
                "name": name,
                "source": source,
            },
        )

        logger.info(
            "screenshot_uploaded_to_s3",
            user_id=str(current_user.id),
            project_id=project_id,
            s3_key=s3_key,
            file_size=file_size,
        )
    except Exception as e:
        logger.error(
            "screenshot_upload_failed",
            user_id=str(current_user.id),
            project_id=project_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload screenshot: {str(e)}",
        )

    # Create database record
    screenshot = ProjectScreenshot(
        id=UUID(screenshot_id),
        project_id=UUID(project_id),
        user_id=current_user.id,
        name=name,
        s3_key=s3_key,
        width=width,
        height=height,
        size_bytes=file_size,
        source=source,
        monitor_index=monitor_index,
        metadata={
            "original_filename": file.filename or "unknown",
            "mime_type": content_type,
        },
    )

    db.add(screenshot)

    # Track storage usage
    try:
        await StorageService.track_upload(
            db=db,
            user_id=current_user.id,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_type="screenshot",
            project_id=project_id,
            metadata={
                "screenshot_id": screenshot_id,
                "name": name,
                "source": source,
            },
        )
    except Exception as e:
        logger.error(
            "storage_tracking_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        # Don't fail the upload if tracking fails

    await db.commit()
    await db.refresh(screenshot)

    # Generate presigned URL
    try:
        if hasattr(object_storage.backend, "get_cdn_url"):
            presigned_url = object_storage.backend.get_cdn_url(s3_key)
        else:
            presigned_url = object_storage.generate_presigned_url(
                s3_key, expiration=PRESIGNED_URL_EXPIRATION
            )
    except Exception as e:
        logger.error("presigned_url_generation_failed", s3_key=s3_key, error=str(e))
        presigned_url = url

    logger.info(
        "screenshot_upload_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        screenshot_id=screenshot_id,
    )

    return ProjectScreenshotResponse(
        id=screenshot.id,
        project_id=screenshot.project_id,
        name=screenshot.name,
        source=screenshot.source,
        monitor_index=screenshot.monitor_index,
        metadata=screenshot.metadata,
        storage_path=screenshot.s3_key,
        presigned_url=presigned_url,
        thumbnail_url=None,  # Could be added later
        width=screenshot.width,
        height=screenshot.height,
        file_size=screenshot.size_bytes,
        content_type=content_type,
        created_at=screenshot.created_at,
        updated_at=screenshot.updated_at,
    )


@router.get("/{project_id}/screenshots")
async def list_screenshots(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    source: str | None = Query(
        None,
        description="Filter by source (manual_upload, runner_capture, web_capture)",
    ),
    limit: int = Query(50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    List screenshots for a project.

    Args:
        db: Database session
        project_id: Project ID to list screenshots for
        source: Optional filter by source type
        limit: Maximum results
        offset: Pagination offset
        current_user: Current authenticated user

    Returns:
        ProjectScreenshotListResponse with paginated screenshots

    Raises:
        HTTPException: If project not found or access denied
    """
    logger.info(
        "list_screenshots_request",
        user_id=str(current_user.id),
        project_id=project_id,
        source=source,
        limit=limit,
        offset=offset,
    )

    # Verify project exists and user has VIEW permission
    project = await get_project(db, project_id=UUID(project_id))
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, current_user.id, UUID(project_id), PermissionLevel.VIEW
    )
    if not has_permission:
        raise forbidden_error(
            "VIEW permission required to access screenshots from this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Build query
    query = select(ProjectScreenshot).filter(
        ProjectScreenshot.project_id == UUID(project_id)
    )

    # Apply source filter if provided
    if source:
        query = query.filter(ProjectScreenshot.source == source)

    # Get total count
    count_result = await db.execute(query)
    total = len(count_result.scalars().all())

    # Apply pagination and ordering
    query = query.order_by(ProjectScreenshot.created_at.desc())
    query = query.limit(limit).offset(offset)

    # Execute query
    result = await db.execute(query)
    screenshots = result.scalars().all()

    # Generate presigned URLs for each screenshot
    screenshot_responses = []
    for screenshot in screenshots:
        try:
            if hasattr(object_storage.backend, "get_cdn_url"):
                presigned_url = object_storage.backend.get_cdn_url(screenshot.s3_key)
            else:
                presigned_url = object_storage.generate_presigned_url(
                    screenshot.s3_key, expiration=PRESIGNED_URL_EXPIRATION
                )
        except Exception as e:
            logger.error(
                "presigned_url_generation_failed",
                s3_key=screenshot.s3_key,
                error=str(e),
            )
            presigned_url = None

        screenshot_responses.append(
            ProjectScreenshotResponse(
                id=screenshot.id,
                project_id=screenshot.project_id,
                name=screenshot.name,
                source=screenshot.source,
                monitor_index=screenshot.monitor_index,
                metadata=screenshot.metadata,
                storage_path=screenshot.s3_key,
                presigned_url=presigned_url,
                thumbnail_url=None,
                width=screenshot.width,
                height=screenshot.height,
                file_size=screenshot.size_bytes,
                content_type=(
                    screenshot.metadata.get("mime_type", "image/png")
                    if screenshot.metadata
                    else "image/png"
                ),
                created_at=screenshot.created_at,
                updated_at=screenshot.updated_at,
            )
        )

    logger.info(
        "list_screenshots_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        count=len(screenshot_responses),
        total=total,
    )

    return ProjectScreenshotListResponse(
        screenshots=screenshot_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{project_id}/screenshots/{screenshot_id}")
async def get_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    screenshot_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a single screenshot by ID with fresh presigned URL.

    Args:
        db: Database session
        project_id: Project ID
        screenshot_id: Screenshot ID
        current_user: Current authenticated user

    Returns:
        ProjectScreenshotResponse with fresh presigned URL

    Raises:
        HTTPException: If screenshot not found or access denied
    """
    logger.info(
        "get_screenshot_request",
        user_id=str(current_user.id),
        project_id=project_id,
        screenshot_id=screenshot_id,
    )

    # Verify project exists and user has VIEW permission
    project = await get_project(db, project_id=UUID(project_id))
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, current_user.id, UUID(project_id), PermissionLevel.VIEW
    )
    if not has_permission:
        raise forbidden_error(
            "VIEW permission required to access screenshots from this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get screenshot
    result = await db.execute(
        select(ProjectScreenshot).filter(
            ProjectScreenshot.id == UUID(screenshot_id),
            ProjectScreenshot.project_id == UUID(project_id),
        )
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    # Generate fresh presigned URL
    try:
        if hasattr(object_storage.backend, "get_cdn_url"):
            presigned_url = object_storage.backend.get_cdn_url(screenshot.s3_key)
        else:
            presigned_url = object_storage.generate_presigned_url(
                screenshot.s3_key, expiration=PRESIGNED_URL_EXPIRATION
            )
    except Exception as e:
        logger.error(
            "presigned_url_generation_failed",
            s3_key=screenshot.s3_key,
            error=str(e),
        )
        presigned_url = None

    logger.info(
        "get_screenshot_complete",
        user_id=str(current_user.id),
        screenshot_id=screenshot_id,
    )

    return ProjectScreenshotResponse(
        id=screenshot.id,
        project_id=screenshot.project_id,
        name=screenshot.name,
        source=screenshot.source,
        monitor_index=screenshot.monitor_index,
        metadata=screenshot.metadata,
        storage_path=screenshot.s3_key,
        presigned_url=presigned_url,
        thumbnail_url=None,
        width=screenshot.width,
        height=screenshot.height,
        file_size=screenshot.size_bytes,
        content_type=(
            screenshot.metadata.get("mime_type", "image/png")
            if screenshot.metadata
            else "image/png"
        ),
        created_at=screenshot.created_at,
        updated_at=screenshot.updated_at,
    )


@router.patch("/{project_id}/screenshots/{screenshot_id}")
async def update_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    screenshot_id: str,
    update_data: ProjectScreenshotUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Update screenshot metadata (name, source, metadata).

    Args:
        db: Database session
        project_id: Project ID
        screenshot_id: Screenshot ID
        update_data: Update data
        current_user: Current authenticated user

    Returns:
        Updated ProjectScreenshotResponse

    Raises:
        HTTPException: If screenshot not found or access denied
    """
    logger.info(
        "update_screenshot_request",
        user_id=str(current_user.id),
        project_id=project_id,
        screenshot_id=screenshot_id,
    )

    # Verify project exists and user has EDIT permission
    project = await get_project(db, project_id=UUID(project_id))
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, current_user.id, UUID(project_id), PermissionLevel.EDIT
    )
    if not has_permission:
        raise forbidden_error(
            "EDIT permission required to update screenshots in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get screenshot
    result = await db.execute(
        select(ProjectScreenshot).filter(
            ProjectScreenshot.id == UUID(screenshot_id),
            ProjectScreenshot.project_id == UUID(project_id),
        )
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    # Update fields
    if update_data.name is not None:
        screenshot.name = update_data.name
    if update_data.source is not None:
        screenshot.source = update_data.source
    if update_data.monitor_index is not None:
        screenshot.monitor_index = update_data.monitor_index
    if update_data.metadata is not None:
        # Merge metadata
        if screenshot.metadata:
            screenshot.metadata.update(update_data.metadata)
        else:
            screenshot.metadata = update_data.metadata

    await db.commit()
    await db.refresh(screenshot)

    # Generate presigned URL
    try:
        if hasattr(object_storage.backend, "get_cdn_url"):
            presigned_url = object_storage.backend.get_cdn_url(screenshot.s3_key)
        else:
            presigned_url = object_storage.generate_presigned_url(
                screenshot.s3_key, expiration=PRESIGNED_URL_EXPIRATION
            )
    except Exception as e:
        logger.error(
            "presigned_url_generation_failed",
            s3_key=screenshot.s3_key,
            error=str(e),
        )
        presigned_url = None

    logger.info(
        "update_screenshot_complete",
        user_id=str(current_user.id),
        screenshot_id=screenshot_id,
    )

    return ProjectScreenshotResponse(
        id=screenshot.id,
        project_id=screenshot.project_id,
        name=screenshot.name,
        source=screenshot.source,
        monitor_index=screenshot.monitor_index,
        metadata=screenshot.metadata,
        storage_path=screenshot.s3_key,
        presigned_url=presigned_url,
        thumbnail_url=None,
        width=screenshot.width,
        height=screenshot.height,
        file_size=screenshot.size_bytes,
        content_type=(
            screenshot.metadata.get("mime_type", "image/png")
            if screenshot.metadata
            else "image/png"
        ),
        created_at=screenshot.created_at,
        updated_at=screenshot.updated_at,
    )


@router.delete(
    "/{project_id}/screenshots/{screenshot_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    screenshot_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """
    Delete a screenshot from S3 and database.

    Args:
        db: Database session
        project_id: Project ID
        screenshot_id: Screenshot ID
        current_user: Current authenticated user

    Raises:
        HTTPException: If screenshot not found or access denied
    """
    logger.info(
        "delete_screenshot_request",
        user_id=str(current_user.id),
        project_id=project_id,
        screenshot_id=screenshot_id,
    )

    # Verify project exists and user has EDIT permission
    project = await get_project(db, project_id=UUID(project_id))
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, current_user.id, UUID(project_id), PermissionLevel.EDIT
    )
    if not has_permission:
        raise forbidden_error(
            "EDIT permission required to delete screenshots from this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get screenshot
    result = await db.execute(
        select(ProjectScreenshot).filter(
            ProjectScreenshot.id == UUID(screenshot_id),
            ProjectScreenshot.project_id == UUID(project_id),
        )
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    # Delete from S3
    try:
        success = object_storage.delete_file(screenshot.s3_key)
        if not success:
            logger.warning(
                "s3_delete_failed",
                user_id=str(current_user.id),
                s3_key=screenshot.s3_key,
            )
    except Exception as e:
        logger.error(
            "s3_delete_error",
            user_id=str(current_user.id),
            s3_key=screenshot.s3_key,
            error=str(e),
        )

    # Update storage tracking
    try:
        await StorageService.delete_file_record(
            db=db, file_path=screenshot.s3_key, user_id=current_user.id
        )
    except Exception as e:
        logger.error(
            "storage_tracking_delete_failed",
            user_id=str(current_user.id),
            s3_key=screenshot.s3_key,
            error=str(e),
        )

    # Delete from database
    await db.delete(screenshot)
    await db.commit()

    logger.info(
        "delete_screenshot_complete",
        user_id=str(current_user.id),
        screenshot_id=screenshot_id,
    )


@router.post("/{project_id}/screenshots/batch-delete")
async def batch_delete_screenshots(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    delete_data: BatchProjectScreenshotDelete,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Batch delete multiple screenshots.

    Args:
        db: Database session
        project_id: Project ID
        delete_data: List of screenshot IDs to delete
        current_user: Current authenticated user

    Returns:
        BatchDeleteResponse with counts and any errors

    Raises:
        HTTPException: If project not found or access denied
    """
    logger.info(
        "batch_delete_screenshots_request",
        user_id=str(current_user.id),
        project_id=project_id,
        count=len(delete_data.screenshot_ids),
    )

    # Verify project exists and user has EDIT permission
    project = await get_project(db, project_id=UUID(project_id))
    if not project:
        raise not_found_error("Project", "project")

    has_permission = await permission_service.can_user_access_project(
        db, current_user.id, UUID(project_id), PermissionLevel.EDIT
    )
    if not has_permission:
        raise forbidden_error(
            "EDIT permission required to delete screenshots from this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    deleted_count = 0
    failed_ids = []
    errors = []

    for screenshot_id in delete_data.screenshot_ids:
        try:
            # Get screenshot
            result = await db.execute(
                select(ProjectScreenshot).filter(
                    ProjectScreenshot.id == screenshot_id,
                    ProjectScreenshot.project_id == UUID(project_id),
                )
            )
            screenshot = result.scalar_one_or_none()

            if not screenshot:
                failed_ids.append(screenshot_id)
                errors.append(f"Screenshot {screenshot_id} not found")
                continue

            # Delete from S3
            try:
                object_storage.delete_file(screenshot.s3_key)
            except Exception as e:
                logger.error(
                    "s3_delete_error",
                    screenshot_id=str(screenshot_id),
                    s3_key=screenshot.s3_key,
                    error=str(e),
                )

            # Update storage tracking
            try:
                await StorageService.delete_file_record(
                    db=db, file_path=screenshot.s3_key, user_id=current_user.id
                )
            except Exception:
                pass  # Don't fail if tracking delete fails

            # Delete from database
            await db.delete(screenshot)
            deleted_count += 1

        except Exception as e:
            failed_ids.append(screenshot_id)
            errors.append(f"Failed to delete {screenshot_id}: {str(e)}")
            logger.error(
                "screenshot_delete_failed",
                screenshot_id=str(screenshot_id),
                error=str(e),
            )

    await db.commit()

    logger.info(
        "batch_delete_screenshots_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        deleted_count=deleted_count,
        failed_count=len(failed_ids),
    )

    return BatchDeleteResponse(
        deleted_count=deleted_count,
        failed_ids=failed_ids,
        errors=errors,
    )
