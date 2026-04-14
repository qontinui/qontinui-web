"""
API endpoints for project image management.

Handles image uploads, extraction from screenshots, and image management
for project assets used in visual automation workflows.
"""

import uuid
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.middleware.error_handler import not_found_error, validation_error
from app.models.organization import PermissionLevel
from app.models.project_assets import ProjectImage
from app.models.user import User
from app.repositories.project_image import (
    project_image_repository,
    project_screenshot_repository,
)
from app.schemas.project_assets import (
    BatchDeleteResponse,
    BatchProjectImageDelete,
    ProjectImageListResponse,
    ProjectImageResponse,
    ProjectImageUpdate,
)
from app.services.project_image_service import project_image_service
from app.utils.permission_utils import check_project_permission, check_read_only_mode

logger = structlog.get_logger(__name__)

router = APIRouter()


class ImageExtractRequest(BaseModel):
    """Request schema for extracting image from screenshot."""

    screenshot_id: UUID = Field(..., description="ID of source screenshot")
    region: dict[str, int] = Field(
        ..., description="Region to extract: {x, y, width, height}"
    )
    name: str = Field(..., min_length=1, max_length=255, description="Image name")


@router.post("/{project_id}/images/upload")
async def upload_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Upload an image to a project."""
    logger.info(
        "image_upload_request",
        user_id=str(current_user.id),
        project_id=project_id,
        filename=file.filename,
    )

    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )
    await check_read_only_mode(db, current_user.id, current_user.subscription_tier)

    content_type = project_image_service.validate_mime_type(file.content_type)
    file_size = await project_image_service.validate_file_size(file)
    file_contents = await file.read()
    project_image_service.validate_magic_bytes(file_contents, content_type)

    await project_image_service.check_storage_quota(
        db, current_user.id, current_user.subscription_tier, file_size
    )

    image_id = uuid.uuid4()
    extension = project_image_service.get_extension_from_filename(
        file.filename, content_type
    )
    width, height, img = project_image_service.get_image_dimensions(file_contents)

    # Generate and upload thumbnail
    thumbnail_s3_key: str | None = None
    try:
        thumbnail_bytes, _, _ = project_image_service.generate_thumbnail(img)
        thumbnail_s3_key = f"thumbnails/{current_user.id}/{project_id}/{image_id}.webp"
        project_image_service.upload_thumbnail(
            thumbnail_data=thumbnail_bytes,
            s3_key=thumbnail_s3_key,
            metadata={
                "user_id": str(current_user.id),
                "project_id": project_id,
                "image_id": str(image_id),
            },
        )
    except Exception as e:
        logger.warning("thumbnail_generation_failed", error=str(e))
        thumbnail_s3_key = None
    img.close()

    # Upload main image
    s3_key = f"images/{current_user.id}/{project_id}/{image_id}.{extension}"
    try:
        project_image_service.upload_image(
            file_data=file_contents,
            s3_key=s3_key,
            content_type=content_type,
            metadata={
                "user_id": str(current_user.id),
                "project_id": project_id,
                "image_id": str(image_id),
                "original_filename": file.filename or "unknown",
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload image: {str(e)}",
        )

    # Create database record
    project_image = ProjectImage(
        id=image_id,
        project_id=UUID(project_id),
        user_id=current_user.id,
        name=file.filename or f"image_{image_id}",
        s3_key=s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        width=width,
        height=height,
        size_bytes=file_size,
        source="uploaded",
        extra_metadata={
            "mime_type": content_type,
            "original_filename": file.filename or "unknown",
            "image_type": "other",
        },
    )
    db.add(project_image)
    await db.commit()
    await db.refresh(project_image)

    await project_image_service.track_upload(
        db=db,
        user_id=current_user.id,
        s3_key=s3_key,
        file_size=file_size,
        project_id=project_id,
        metadata={"image_id": str(image_id)},
    )

    return project_image_service.build_image_response(project_image)


@router.post("/{project_id}/images/extract")
async def extract_image_from_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    extract_data: ImageExtractRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Extract an image region from a screenshot."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )
    await check_read_only_mode(db, current_user.id, current_user.subscription_tier)

    screenshot = await project_screenshot_repository.get_by_project(
        db, extract_data.screenshot_id, UUID(project_id)
    )
    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    # Validate region
    region = extract_data.region
    required_keys = {"x", "y", "width", "height"}
    if not all(key in region for key in required_keys):
        raise validation_error(
            f"Region must contain: {', '.join(required_keys)}", "region"
        )

    x, y, width, height = region["x"], region["y"], region["width"], region["height"]
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise validation_error("Invalid region coordinates", "region")
    if x + width > screenshot.width or y + height > screenshot.height:
        raise validation_error("Region exceeds screenshot boundaries", "region")

    # Download and crop screenshot
    screenshot_data = project_image_service.download_from_storage(screenshot.s3_key)
    if not screenshot_data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to download screenshot from storage",
        )

    try:
        cropped_data, _, _, cropped_img = project_image_service.crop_image(
            screenshot_data, x, y, width, height
        )
        cropped_size = len(cropped_data)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to crop image: {str(e)}",
        )

    # Generate thumbnail
    thumbnail_s3_key: str | None = None
    try:
        thumbnail_bytes, _, _ = project_image_service.generate_thumbnail(cropped_img)
        thumbnail_s3_key = f"thumbnails/{current_user.id}/{project_id}/{extract_data.screenshot_id}.webp"
        project_image_service.upload_thumbnail(
            thumbnail_data=thumbnail_bytes,
            s3_key=thumbnail_s3_key,
            metadata={"user_id": str(current_user.id), "project_id": project_id},
        )
    except Exception:
        thumbnail_s3_key = None
    cropped_img.close()

    await project_image_service.check_storage_quota(
        db, current_user.id, current_user.subscription_tier, cropped_size
    )

    # Upload cropped image
    image_id = uuid.uuid4()
    s3_key = f"images/{current_user.id}/{project_id}/{image_id}.png"
    try:
        project_image_service.upload_image(
            file_data=cropped_data,
            s3_key=s3_key,
            content_type="image/png",
            metadata={
                "user_id": str(current_user.id),
                "source_screenshot_id": str(extract_data.screenshot_id),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload extracted image: {str(e)}",
        )

    # Create database record
    project_image = ProjectImage(
        id=image_id,
        project_id=UUID(project_id),
        user_id=current_user.id,
        name=extract_data.name,
        s3_key=s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        width=width,
        height=height,
        size_bytes=cropped_size,
        source="image_extraction",
        source_screenshot_id=extract_data.screenshot_id,
        source_region=region,
        extra_metadata={"mime_type": "image/png", "image_type": "template"},
    )
    db.add(project_image)
    await db.commit()
    await db.refresh(project_image)

    await project_image_service.track_upload(
        db=db,
        user_id=current_user.id,
        s3_key=s3_key,
        file_size=cropped_size,
        project_id=project_id,
        metadata={"image_id": str(image_id)},
    )

    return project_image_service.build_image_response(project_image)


@router.get("/{project_id}/images")
async def list_images(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    current_user: User = Depends(get_current_active_user_async),
    source: str | None = Query(None, description="Filter by source type"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> ProjectImageListResponse:
    """List images for a project."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.VIEW
    )

    images, total = await project_image_repository.list_by_project(
        db, UUID(project_id), source=source, offset=offset, limit=limit
    )

    return ProjectImageListResponse(
        images=[project_image_service.build_image_response(img) for img in images],
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
    """Get a single project image with fresh presigned URL."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.VIEW
    )

    image = await project_image_repository.get_by_project(
        db, UUID(image_id), UUID(project_id)
    )
    if not image:
        raise not_found_error("Image", "image")

    return project_image_service.build_image_response(image)


@router.patch("/{project_id}/images/{image_id}")
async def update_image(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    image_id: str,
    update_data: ProjectImageUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> ProjectImageResponse:
    """Update project image metadata."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    image = await project_image_repository.get_by_project(
        db, UUID(image_id), UUID(project_id)
    )
    if not image:
        raise not_found_error("Image", "image")

    update_dict = update_data.model_dump(exclude_unset=True)

    if "name" in update_dict:
        image.name = update_dict["name"]

    if image.extra_metadata is None:
        image.extra_metadata = {}

    for field in ["description", "image_type", "tags", "metadata"]:
        if field in update_dict:
            if field == "metadata":
                image.extra_metadata.update(update_dict["metadata"])
            else:
                image.extra_metadata[field] = update_dict[field]

    await db.commit()
    await db.refresh(image)

    return project_image_service.build_image_response(image)


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
    """Delete a project image from S3 and database."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    image = await project_image_repository.get_by_project(
        db, UUID(image_id), UUID(project_id)
    )
    if not image:
        raise not_found_error("Image", "image")

    project_image_service.delete_from_storage(image.s3_key)
    if image.thumbnail_s3_key:
        project_image_service.delete_from_storage(image.thumbnail_s3_key)

    await project_image_service.delete_storage_record(db, image.s3_key, current_user.id)
    await project_image_repository.delete_image(db, image)


@router.post("/{project_id}/images/batch-delete")
async def batch_delete_images(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    delete_data: BatchProjectImageDelete,
    current_user: User = Depends(get_current_active_user_async),
) -> BatchDeleteResponse:
    """Batch delete multiple images."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    deleted_count = 0
    failed_ids: list[UUID] = []
    errors: list[str] = []

    for image_id in delete_data.image_ids:
        try:
            image = await project_image_repository.get_by_project(
                db, image_id, UUID(project_id)
            )
            if not image:
                failed_ids.append(image_id)
                errors.append(f"Image {image_id} not found")
                continue

            project_image_service.delete_from_storage(image.s3_key)
            if image.thumbnail_s3_key:
                project_image_service.delete_from_storage(image.thumbnail_s3_key)

            await project_image_service.delete_storage_record(
                db, image.s3_key, current_user.id
            )
            await db.delete(image)
            deleted_count += 1
        except Exception as e:
            failed_ids.append(image_id)
            errors.append(f"Image {image_id}: {str(e)}")

    await db.commit()

    return BatchDeleteResponse(
        deleted_count=deleted_count,
        failed_ids=failed_ids,
        errors=errors,
    )
