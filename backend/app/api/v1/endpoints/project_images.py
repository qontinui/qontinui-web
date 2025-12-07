"""
API endpoints for project image management.

Handles image uploads, extraction from screenshots, and image management
for project assets used in visual automation workflows.
"""

import io
import uuid
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from PIL import Image
from pydantic import BaseModel, Field
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
from app.models.project_assets import ProjectImage, ProjectScreenshot
from app.models.user import User
from app.schemas.project_assets import (
    BatchDeleteResponse,
    BatchProjectImageDelete,
    ProjectImageListResponse,
    ProjectImageResponse,
    ProjectImageUpdate,
)
from app.services.limit_checker import LimitChecker
from app.services.object_storage import object_storage
from app.services.permission_service import permission_service
from app.services.storage_service import StorageQuotaExceeded, StorageService

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
    "image/png": b"\x89\x50\x4e\x47",  # PNG signature
    "image/jpeg": b"\xff\xd8\xff",  # JPEG signature
    "image/gif": b"\x47\x49\x46",  # GIF signature
    "image/webp": b"\x52\x49\x46\x46",  # RIFF (WebP container)
}

# Presigned URL expiration: 7 days
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60  # 604800 seconds


# ============================================================================
# Request/Response Schemas
# ============================================================================


class ImageExtractRequest(BaseModel):
    """Request schema for extracting image from screenshot."""

    screenshot_id: UUID = Field(..., description="ID of source screenshot")
    region: dict[str, int] = Field(
        ..., description="Region to extract: {x, y, width, height}"
    )
    name: str = Field(..., min_length=1, max_length=255, description="Image name")


# ============================================================================
# Helper Functions
# ============================================================================


def validate_image_mime_type(content_type: str | None) -> str:
    """Validate that the MIME type is an allowed image type."""
    if not content_type or content_type not in ALLOWED_MIME_TYPES:
        raise validation_error(
            f"Invalid file type. Allowed types: {', '.join(ALLOWED_MIME_TYPES)}",
            "file",
            ErrorCode.INVALID_FILE_TYPE,
        )
    return content_type


def validate_image_magic_bytes(file_data: bytes, content_type: str) -> None:
    """Validate file magic bytes match the declared MIME type."""
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


async def validate_file_size(file: UploadFile) -> int:
    """Validate file size is within limits."""
    contents = await file.read()
    file_size = len(contents)

    if file_size > MAX_FILE_SIZE:
        raise validation_error(
            f"File too large. Maximum size: {MAX_FILE_SIZE / (1024*1024):.1f}MB",
            "file",
            ErrorCode.INVALID_FILE_SIZE,
        )

    # Reset file pointer for later use
    await file.seek(0)
    return file_size


def generate_presigned_url(s3_key: str) -> str:
    """Generate presigned URL or CDN URL for an S3 key."""
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


async def check_project_permission(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    required_level: PermissionLevel,
) -> None:
    """Check if user has required permission level for project."""
    # Verify project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permission
    has_permission = await permission_service.can_user_access_project(
        db, user_id, project_id, required_level
    )
    if not has_permission:
        raise forbidden_error(
            f"{required_level.value} permission required for this operation",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )


def build_image_response(
    image: ProjectImage, presigned_url: str | None = None
) -> ProjectImageResponse:
    """Build ProjectImageResponse from database model."""
    # Generate presigned URL if not provided
    if presigned_url is None:
        presigned_url = generate_presigned_url(image.s3_key)

    return ProjectImageResponse(
        id=image.id,
        project_id=image.project_id,
        name=image.name,
        description=image.metadata.get("description") if image.metadata else None,
        image_type=(
            image.metadata.get("image_type", "other") if image.metadata else "other"
        ),
        tags=image.metadata.get("tags", []) if image.metadata else [],
        metadata=image.metadata,
        storage_path=image.s3_key,
        presigned_url=presigned_url,
        thumbnail_url=None,  # TODO: Add thumbnail support
        width=image.width,
        height=image.height,
        file_size=image.size_bytes,
        content_type=(
            image.metadata.get("mime_type", "image/png")
            if image.metadata
            else "image/png"
        ),
        created_at=image.created_at,
        updated_at=image.updated_at,
    )


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/{project_id}/images/upload")
async def upload_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Upload an image to a project.

    Steps:
    1. Verify user has EDIT permission on project
    2. Check if user is in read-only mode
    3. Validate file is an image (MIME type and magic bytes)
    4. Validate file size < 10MB
    5. Check storage quota
    6. Upload to S3: images/{user_id}/{project_id}/{uuid}.{ext}
    7. Create ProjectImage record in database
    8. Return ProjectImageResponse with presigned URL

    Returns:
        ProjectImageResponse with image details and presigned URL
    """
    logger.info(
        "image_upload_request",
        user_id=str(current_user.id),
        project_id=project_id,
        filename=file.filename,
        content_type=file.content_type,
    )

    # Check permission
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
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
    content_type = validate_image_mime_type(file.content_type)

    # Validate file size
    file_size = await validate_file_size(file)

    # Read file contents for validation and upload
    file_contents = await file.read()

    # Validate magic bytes
    validate_image_magic_bytes(file_contents, content_type)

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

    # Generate unique image ID and determine extension
    image_id = uuid.uuid4()
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

    # Upload to S3
    s3_key = f"images/{current_user.id}/{project_id}/{image_id}.{extension}"

    try:
        # Get image dimensions
        img = Image.open(io.BytesIO(file_contents))
        width, height = img.size
        img.close()

        # Upload to S3
        file_obj = io.BytesIO(file_contents)
        object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type=content_type,
            metadata={
                "user_id": str(current_user.id),
                "project_id": project_id,
                "image_id": str(image_id),
                "original_filename": file.filename or "unknown",
            },
        )

        logger.info(
            "image_uploaded",
            user_id=str(current_user.id),
            project_id=project_id,
            s3_key=s3_key,
            file_size=file_size,
        )
    except Exception as e:
        logger.error(
            "image_upload_failed",
            user_id=str(current_user.id),
            project_id=project_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image: {str(e)}",
        )

    # Create ProjectImage record
    project_image = ProjectImage(
        id=image_id,
        project_id=UUID(project_id),
        user_id=current_user.id,
        name=file.filename or f"image_{image_id}",
        s3_key=s3_key,
        width=width,
        height=height,
        size_bytes=file_size,
        source="uploaded",
        metadata={
            "mime_type": content_type,
            "original_filename": file.filename or "unknown",
            "image_type": "other",
        },
    )

    db.add(project_image)
    await db.commit()
    await db.refresh(project_image)

    # Track storage usage
    try:
        await StorageService.track_upload(
            db=db,
            user_id=current_user.id,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_type="image",
            project_id=project_id,
            metadata={
                "image_id": str(image_id),
                "original_filename": file.filename or "unknown",
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

    logger.info(
        "image_upload_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        image_id=str(image_id),
    )

    return build_image_response(project_image)


@router.post("/{project_id}/images/extract")
async def extract_image_from_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    extract_data: ImageExtractRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Extract an image region from a screenshot.

    Steps:
    1. Verify user has EDIT permission on project
    2. Verify screenshot exists and belongs to project
    3. Download screenshot from S3
    4. Crop region using PIL
    5. Upload cropped image to S3
    6. Create ProjectImage record with source_screenshot_id and source_region
    7. Return ProjectImageResponse

    Returns:
        ProjectImageResponse with extracted image details
    """
    logger.info(
        "image_extract_request",
        user_id=str(current_user.id),
        project_id=project_id,
        screenshot_id=str(extract_data.screenshot_id),
    )

    # Check permission
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    # Check if user is in read-only mode
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        raise forbidden_error(
            f"Account is in read-only mode. {reason}. Upgrade your plan to continue.",
            ErrorCode.ACCOUNT_READ_ONLY,
        )

    # Get screenshot
    result = await db.execute(
        select(ProjectScreenshot).filter(
            ProjectScreenshot.id == extract_data.screenshot_id,
            ProjectScreenshot.project_id == UUID(project_id),
        )
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    # Validate region
    region = extract_data.region
    required_keys = {"x", "y", "width", "height"}
    if not all(key in region for key in required_keys):
        raise validation_error(
            f"Region must contain: {', '.join(required_keys)}",
            "region",
        )

    x = region["x"]
    y = region["y"]
    width = region["width"]
    height = region["height"]

    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise validation_error("Invalid region coordinates", "region")

    if x + width > screenshot.width or y + height > screenshot.height:
        raise validation_error("Region exceeds screenshot boundaries", "region")

    # Download screenshot from S3
    try:
        screenshot_data = object_storage.download_file(screenshot.s3_key)
        if not screenshot_data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to download screenshot from storage",
            )

        # Crop region
        img = Image.open(io.BytesIO(screenshot_data))
        cropped = img.crop((x, y, x + width, y + height))

        # Convert to bytes
        output = io.BytesIO()
        # Use PNG for lossless extraction
        cropped.save(output, format="PNG")
        cropped_data = output.getvalue()
        output.close()
        img.close()

        cropped_size = len(cropped_data)

        logger.info(
            "image_cropped",
            user_id=str(current_user.id),
            screenshot_id=str(extract_data.screenshot_id),
            region=region,
            cropped_size=cropped_size,
        )
    except Exception as e:
        logger.error(
            "image_crop_failed",
            user_id=str(current_user.id),
            screenshot_id=str(extract_data.screenshot_id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to crop image: {str(e)}",
        )

    # Check storage quota
    try:
        await StorageService.check_quota(
            db, current_user.id, current_user.subscription_tier, cropped_size
        )
    except StorageQuotaExceeded as e:
        logger.warning(
            "storage_quota_exceeded",
            user_id=str(current_user.id),
            file_size=cropped_size,
        )
        raise e

    # Upload cropped image to S3
    image_id = uuid.uuid4()
    s3_key = f"images/{current_user.id}/{project_id}/{image_id}.png"

    try:
        file_obj = io.BytesIO(cropped_data)
        object_storage.backend.upload_file(
            file_obj=file_obj,
            key=s3_key,
            content_type="image/png",
            metadata={
                "user_id": str(current_user.id),
                "project_id": project_id,
                "image_id": str(image_id),
                "source_screenshot_id": str(extract_data.screenshot_id),
                "extraction_region": str(region),
            },
        )

        logger.info(
            "extracted_image_uploaded",
            user_id=str(current_user.id),
            project_id=project_id,
            s3_key=s3_key,
            file_size=cropped_size,
        )
    except Exception as e:
        logger.error(
            "extracted_image_upload_failed",
            user_id=str(current_user.id),
            project_id=project_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload extracted image: {str(e)}",
        )

    # Create ProjectImage record
    project_image = ProjectImage(
        id=image_id,
        project_id=UUID(project_id),
        user_id=current_user.id,
        name=extract_data.name,
        s3_key=s3_key,
        width=width,
        height=height,
        size_bytes=cropped_size,
        source="image_extraction",
        source_screenshot_id=extract_data.screenshot_id,
        source_region=region,
        metadata={
            "mime_type": "image/png",
            "source_screenshot_id": str(extract_data.screenshot_id),
            "extraction_region": region,
            "image_type": "template",
        },
    )

    db.add(project_image)
    await db.commit()
    await db.refresh(project_image)

    # Track storage usage
    try:
        await StorageService.track_upload(
            db=db,
            user_id=current_user.id,
            file_path=s3_key,
            file_size_bytes=cropped_size,
            file_type="image",
            project_id=project_id,
            metadata={
                "image_id": str(image_id),
                "source_screenshot_id": str(extract_data.screenshot_id),
                "extraction_region": region,
            },
        )
    except Exception as e:
        logger.error(
            "storage_tracking_failed",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        # Don't fail the operation if tracking fails

    logger.info(
        "image_extract_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        image_id=str(image_id),
    )

    return build_image_response(project_image)


@router.get("/{project_id}/images")
async def list_images(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    current_user: User = Depends(get_current_active_user_async),
    source: str | None = Query(None, description="Filter by source type"),
    limit: int = Query(50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> ProjectImageListResponse:
    """
    List images for a project.

    Supports:
    - Pagination (limit, offset)
    - Filtering by source type
    - Sorted by created_at descending

    Returns:
        ProjectImageListResponse with paginated image list
    """
    logger.info(
        "list_images_request",
        user_id=str(current_user.id),
        project_id=project_id,
        source=source,
    )

    # Check permission (VIEW level sufficient for listing)
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.VIEW
    )

    # Build query
    query = select(ProjectImage).filter(ProjectImage.project_id == UUID(project_id))

    # Filter by source if provided
    if source:
        query = query.filter(ProjectImage.source == source)

    # Get total count
    count_query = select(ProjectImage.id).filter(
        ProjectImage.project_id == UUID(project_id)
    )
    if source:
        count_query = count_query.filter(ProjectImage.source == source)

    count_result = await db.execute(count_query)
    total = len(list(count_result.scalars().all()))

    # Apply sorting and pagination
    query = query.order_by(ProjectImage.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    images = list(result.scalars().all())

    # Build response list
    image_responses = [build_image_response(img) for img in images]

    logger.info(
        "list_images_complete",
        user_id=str(current_user.id),
        project_id=project_id,
        total=total,
        returned=len(image_responses),
    )

    return ProjectImageListResponse(
        images=image_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{project_id}/images/{image_id}")
async def get_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    image_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> ProjectImageResponse:
    """
    Get a single project image with fresh presigned URL.

    Returns:
        ProjectImageResponse with image details and presigned URL
    """
    logger.info(
        "get_image_request",
        user_id=str(current_user.id),
        project_id=project_id,
        image_id=image_id,
    )

    # Check permission
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.VIEW
    )

    # Get image
    result = await db.execute(
        select(ProjectImage).filter(
            ProjectImage.id == UUID(image_id),
            ProjectImage.project_id == UUID(project_id),
        )
    )
    image = result.scalar_one_or_none()

    if not image:
        raise not_found_error("Image", "image")

    logger.info(
        "get_image_complete",
        user_id=str(current_user.id),
        image_id=image_id,
    )

    return build_image_response(image)


@router.patch("/{project_id}/images/{image_id}")
async def update_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    image_id: str,
    update_data: ProjectImageUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> ProjectImageResponse:
    """
    Update project image metadata.

    Supports updating:
    - name
    - description
    - image_type
    - tags
    - metadata

    Returns:
        ProjectImageResponse with updated image details
    """
    logger.info(
        "update_image_request",
        user_id=str(current_user.id),
        project_id=project_id,
        image_id=image_id,
    )

    # Check permission
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    # Get image
    result = await db.execute(
        select(ProjectImage).filter(
            ProjectImage.id == UUID(image_id),
            ProjectImage.project_id == UUID(project_id),
        )
    )
    image = result.scalar_one_or_none()

    if not image:
        raise not_found_error("Image", "image")

    # Update fields
    update_dict = update_data.model_dump(exclude_unset=True)

    if "name" in update_dict:
        image.name = update_dict["name"]

    # Update metadata fields (stored in metadata JSON)
    if image.metadata is None:
        image.metadata = {}

    for field in ["description", "image_type", "tags", "metadata"]:
        if field in update_dict:
            if field == "metadata":
                # Merge metadata
                image.metadata.update(update_dict["metadata"])
            else:
                image.metadata[field] = update_dict[field]

    await db.commit()
    await db.refresh(image)

    logger.info(
        "update_image_complete",
        user_id=str(current_user.id),
        image_id=image_id,
    )

    return build_image_response(image)


@router.delete(
    "/{project_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    image_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """
    Delete a project image from S3 and database.

    Returns:
        204 No Content on success
    """
    logger.info(
        "delete_image_request",
        user_id=str(current_user.id),
        project_id=project_id,
        image_id=image_id,
    )

    # Check permission
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    # Get image
    result = await db.execute(
        select(ProjectImage).filter(
            ProjectImage.id == UUID(image_id),
            ProjectImage.project_id == UUID(project_id),
        )
    )
    image = result.scalar_one_or_none()

    if not image:
        raise not_found_error("Image", "image")

    s3_key = image.s3_key

    # Delete from S3
    try:
        success = object_storage.delete_file(s3_key)
        if not success:
            logger.warning(
                "s3_delete_failed",
                user_id=str(current_user.id),
                s3_key=s3_key,
            )
            # Continue anyway to clean up database
    except Exception as e:
        logger.error(
            "s3_delete_error",
            user_id=str(current_user.id),
            s3_key=s3_key,
            error=str(e),
        )
        # Continue to clean up database even if S3 delete fails

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

    # Delete from database
    await db.delete(image)
    await db.commit()

    logger.info(
        "delete_image_complete",
        user_id=str(current_user.id),
        image_id=image_id,
    )


@router.post("/{project_id}/images/batch-delete")
async def batch_delete_images(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    delete_data: BatchProjectImageDelete,
    current_user: User = Depends(get_current_active_user_async),
) -> BatchDeleteResponse:
    """
    Batch delete multiple images.

    Deletes images from both S3 and database. Returns count of successful
    deletions and any failed IDs with error messages.

    Returns:
        BatchDeleteResponse with deletion results
    """
    logger.info(
        "batch_delete_images_request",
        user_id=str(current_user.id),
        project_id=project_id,
        image_count=len(delete_data.image_ids),
    )

    # Check permission
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    deleted_count = 0
    failed_ids = []
    errors = []

    for image_id in delete_data.image_ids:
        try:
            # Get image
            result = await db.execute(
                select(ProjectImage).filter(
                    ProjectImage.id == image_id,
                    ProjectImage.project_id == UUID(project_id),
                )
            )
            image = result.scalar_one_or_none()

            if not image:
                failed_ids.append(image_id)
                errors.append(f"Image {image_id} not found")
                continue

            s3_key = image.s3_key

            # Delete from S3
            try:
                object_storage.delete_file(s3_key)
            except Exception as e:
                logger.error(
                    "s3_delete_error_batch",
                    image_id=str(image_id),
                    s3_key=s3_key,
                    error=str(e),
                )
                # Continue anyway

            # Update storage tracking
            try:
                await StorageService.delete_file_record(
                    db=db, file_path=s3_key, user_id=current_user.id
                )
            except Exception as e:
                logger.error(
                    "storage_tracking_delete_failed_batch",
                    image_id=str(image_id),
                    error=str(e),
                )

            # Delete from database
            await db.delete(image)
            deleted_count += 1

        except Exception as e:
            logger.error(
                "batch_delete_image_failed",
                image_id=str(image_id),
                error=str(e),
            )
            failed_ids.append(image_id)
            errors.append(f"Image {image_id}: {str(e)}")

    # Commit all deletions
    await db.commit()

    logger.info(
        "batch_delete_images_complete",
        user_id=str(current_user.id),
        deleted_count=deleted_count,
        failed_count=len(failed_ids),
    )

    return BatchDeleteResponse(
        deleted_count=deleted_count,
        failed_ids=failed_ids,
        errors=errors,
    )
