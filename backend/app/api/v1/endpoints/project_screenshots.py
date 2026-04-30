"""
API endpoints for project screenshots management.

Handles uploading, listing, updating, and deleting screenshots for projects.
Screenshots can be used for workflow automation, pattern matching, and state discovery.
"""

import uuid
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.middleware.error_handler import not_found_error
from app.models.organization import PermissionLevel
from app.models.project_assets import ProjectScreenshot
from app.models.user import User
from app.repositories.project_image import project_screenshot_repository
from app.schemas.project_assets import (
    BatchDeleteResponse,
    BatchProjectScreenshotDelete,
    ProjectScreenshotListResponse,
    ProjectScreenshotUpdate,
)
from app.services.project_screenshot_service import project_screenshot_service
from app.utils.permission_utils import check_project_permission

logger = structlog.get_logger(__name__)

router = APIRouter()


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
    """Upload a screenshot to a project."""
    logger.info(
        "screenshot_upload_request",
        user_id=str(current_user.id),
        project_id=project_id,
        filename=file.filename,
        name=name,
        source=source,
    )

    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    content_type = project_screenshot_service.validate_mime_type(file.content_type)
    file_contents, file_size = await project_screenshot_service.validate_file_size(file)
    width, height = project_screenshot_service.get_image_dimensions(file_contents)

    screenshot_id = str(uuid.uuid4())
    extension = project_screenshot_service.get_extension_from_filename(
        file.filename, content_type
    )

    # Upload to S3
    s3_key = f"screenshots/{current_user.id}/{project_id}/{screenshot_id}.{extension}"
    try:
        url = project_screenshot_service.upload_screenshot(
            file_data=file_contents,
            s3_key=s3_key,
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
    except Exception as e:
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

    await project_screenshot_service.track_upload(
        db=db,
        user_id=current_user.id,
        s3_key=s3_key,
        file_size=file_size,
        project_id=project_id,
        metadata={"screenshot_id": screenshot_id, "name": name, "source": source},
    )

    await db.commit()
    await db.refresh(screenshot)

    presigned_url = project_screenshot_service.generate_presigned_url(s3_key)
    if not presigned_url:
        presigned_url = url

    return project_screenshot_service.build_screenshot_response(
        screenshot, presigned_url=presigned_url
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
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List screenshots for a project."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.VIEW
    )

    screenshots, total = await project_screenshot_repository.list_by_project(
        db, UUID(project_id), source=source, offset=offset, limit=limit
    )

    screenshot_responses = [
        project_screenshot_service.build_screenshot_response(s) for s in screenshots
    ]

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
    """Get a single screenshot by ID with fresh presigned URL."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.VIEW
    )

    screenshot = await project_screenshot_repository.get_by_project(
        db, UUID(screenshot_id), UUID(project_id)
    )
    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    return project_screenshot_service.build_screenshot_response(screenshot)


@router.patch("/{project_id}/screenshots/{screenshot_id}")
async def update_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    screenshot_id: str,
    update_data: ProjectScreenshotUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update screenshot metadata (name, source, metadata)."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    screenshot = await project_screenshot_repository.get_by_project(
        db, UUID(screenshot_id), UUID(project_id)
    )
    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    if update_data.name is not None:
        screenshot.name = update_data.name
    if update_data.source is not None:
        screenshot.source = update_data.source
    if update_data.monitor_index is not None:
        screenshot.monitor_index = update_data.monitor_index
    if update_data.metadata is not None:
        if screenshot.metadata:
            screenshot.metadata.update(update_data.metadata)
        else:
            screenshot.metadata = update_data.metadata

    await db.commit()
    await db.refresh(screenshot)

    return project_screenshot_service.build_screenshot_response(screenshot)


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
    """Delete a screenshot from S3 and database."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    screenshot = await project_screenshot_repository.get_by_project(
        db, UUID(screenshot_id), UUID(project_id)
    )
    if not screenshot:
        raise not_found_error("Screenshot", "screenshot")

    project_screenshot_service.delete_from_storage(screenshot.s3_key)
    await project_screenshot_service.delete_storage_record(
        db, screenshot.s3_key, current_user.id
    )
    await project_screenshot_repository.delete_screenshot(db, screenshot)


@router.post("/{project_id}/screenshots/batch-delete")
async def batch_delete_screenshots(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    delete_data: BatchProjectScreenshotDelete,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Batch delete multiple screenshots."""
    await check_project_permission(
        db, UUID(project_id), current_user.id, PermissionLevel.EDIT
    )

    deleted_count = 0
    failed_ids = []
    errors = []

    for screenshot_id in delete_data.screenshot_ids:
        try:
            screenshot = await project_screenshot_repository.get_by_project(
                db, screenshot_id, UUID(project_id)
            )
            if not screenshot:
                failed_ids.append(screenshot_id)
                errors.append(f"Screenshot {screenshot_id} not found")
                continue

            project_screenshot_service.delete_from_storage(screenshot.s3_key)
            await project_screenshot_service.delete_storage_record(
                db, screenshot.s3_key, current_user.id
            )
            await db.delete(screenshot)
            deleted_count += 1
        except Exception as e:
            failed_ids.append(screenshot_id)
            errors.append(f"Failed to delete {screenshot_id}: {str(e)}")

    await db.commit()

    return BatchDeleteResponse(
        deleted_count=deleted_count,
        failed_ids=failed_ids,
        errors=errors,
    )
