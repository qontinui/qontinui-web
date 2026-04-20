"""
API endpoints for annotation management (admin only)
"""

import io
import uuid
from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete as sql_delete
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.models.annotation import Annotation, AnnotationSet
from app.models.user import User
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationResponse,
    AnnotationSetCreate,
    AnnotationSetResponse,
    AnnotationSetUpdate,
    AnnotationUpdate,
)
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post("/upload-screenshot")
async def upload_screenshot(
    file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict:
    """
    Upload a screenshot for annotations and return the permanent URL.
    This must be called before creating an annotation set to get a permanent URL.
    """
    logger.info(
        "upload_screenshot_called",
        user_id=str(current_user.id),
        is_superuser=current_user.is_superuser,
        filename=file.filename,
    )
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    try:
        # Read file content
        content = await file.read()
        file_obj = io.BytesIO(content)

        # Generate unique filename
        filename = file.filename or "screenshot.png"
        file_extension = filename.split(".")[-1] if "." in filename else "png"
        unique_filename = f"{uuid.uuid4()}.{file_extension}"

        # Upload to S3/MinIO using the backend directly
        key = f"annotations/{str(current_user.id)}/{unique_filename}"
        url = object_storage.backend.upload_file(
            file_obj=file_obj,
            key=key,
            content_type=file.content_type,
        )

        logger.info(
            "screenshot_uploaded",
            user_id=str(current_user.id),
            key=key,
            url=url,
        )

        return {
            "url": url,
            "filename": file.filename,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to upload screenshot: {str(e)}"
        )


@router.get("/", response_model=list[AnnotationSetResponse])
async def list_annotation_sets(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> list[AnnotationSet]:
    """List all annotation sets (admin only)"""
    result = await db.execute(
        select(AnnotationSet)
        .options(selectinload(AnnotationSet.annotations))
        .order_by(desc(AnnotationSet.created_at))
        .offset(skip)
        .limit(limit)
    )
    annotation_sets = result.scalars().all()
    return list(annotation_sets)


@router.post("/", response_model=AnnotationSetResponse)
async def create_annotation_set(
    annotation_set_in: AnnotationSetCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> AnnotationSet:
    """Create a new annotation set (admin only)"""
    # Convert screenshots to JSON if provided
    screenshots_json = None
    if annotation_set_in.screenshots:
        screenshots_json = [s.model_dump() for s in annotation_set_in.screenshots]

    annotation_set = AnnotationSet(
        id=str(uuid.uuid4()),
        screenshot_name=annotation_set_in.screenshot_name,
        screenshot_url=annotation_set_in.screenshot_url,
        image_width=annotation_set_in.image_width,
        image_height=annotation_set_in.image_height,
        screenshots=screenshots_json,
        notes=annotation_set_in.notes,
        boundary_width=annotation_set_in.boundary_width,
        created_by_id=str(current_user.id),
    )

    db.add(annotation_set)

    # Add annotations
    for i, ann_data in enumerate(annotation_set_in.annotations or []):
        annotation = Annotation(
            id=str(uuid.uuid4()),
            annotation_set_id=annotation_set.id,
            screenshot_index=ann_data.screenshot_index,
            x=ann_data.x,
            y=ann_data.y,
            width=ann_data.width,
            height=ann_data.height,
            label=ann_data.label,
            description=ann_data.description,
            reason=ann_data.reason,
            extra_data=ann_data.extra_data,
            order=i,
        )
        db.add(annotation)

    await db.commit()
    await db.refresh(annotation_set, ["annotations"])
    return annotation_set


@router.get("/{annotation_set_id}", response_model=AnnotationSetResponse)
async def get_annotation_set(
    annotation_set_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> AnnotationSet:
    """Get a specific annotation set (admin only)"""
    result = await db.execute(
        select(AnnotationSet)
        .options(selectinload(AnnotationSet.annotations))
        .filter(AnnotationSet.id == annotation_set_id)
    )
    annotation_set = result.scalar_one_or_none()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")
    return annotation_set


@router.put("/{annotation_set_id}", response_model=AnnotationSetResponse)
async def update_annotation_set(
    annotation_set_id: str,
    annotation_set_in: AnnotationSetUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> AnnotationSet:
    """Update an annotation set (admin only)"""
    result = await db.execute(
        select(AnnotationSet)
        .options(selectinload(AnnotationSet.annotations))
        .filter(AnnotationSet.id == annotation_set_id)
    )
    annotation_set = result.scalar_one_or_none()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")

    # Update annotation set fields
    if annotation_set_in.screenshot_name is not None:
        annotation_set.screenshot_name = annotation_set_in.screenshot_name  # type: ignore[assignment]
    if annotation_set_in.screenshot_url is not None:
        annotation_set.screenshot_url = annotation_set_in.screenshot_url  # type: ignore[assignment]
    if annotation_set_in.notes is not None:
        annotation_set.notes = annotation_set_in.notes  # type: ignore[assignment]
    if annotation_set_in.boundary_width is not None:
        annotation_set.boundary_width = annotation_set_in.boundary_width  # type: ignore[assignment]
    if annotation_set_in.screenshots is not None:
        # Convert screenshots to JSON
        annotation_set.screenshots = [
            s.model_dump() for s in annotation_set_in.screenshots
        ]

    annotation_set.updated_at = datetime.now(UTC)  # type: ignore[assignment]

    # Update annotations if provided
    if annotation_set_in.annotations is not None:
        # Delete existing annotations
        await db.execute(
            sql_delete(Annotation).filter(
                Annotation.annotation_set_id == annotation_set_id
            )
        )

        # Add new annotations
        for i, ann_data in enumerate(annotation_set_in.annotations):
            annotation = Annotation(
                id=str(uuid.uuid4()),
                annotation_set_id=annotation_set.id,
                screenshot_index=ann_data.screenshot_index,
                x=ann_data.x,
                y=ann_data.y,
                width=ann_data.width,
                height=ann_data.height,
                label=ann_data.label,
                description=ann_data.description,
                reason=ann_data.reason,
                extra_data=ann_data.extra_data,
                order=i,
            )
            db.add(annotation)

    await db.commit()
    await db.refresh(annotation_set, ["annotations"])
    return annotation_set


@router.delete("/{annotation_set_id}")
async def delete_annotation_set(
    annotation_set_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict:
    """Delete an annotation set (admin only)"""
    result = await db.execute(
        select(AnnotationSet).filter(AnnotationSet.id == annotation_set_id)
    )
    annotation_set = result.scalar_one_or_none()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")

    await db.delete(annotation_set)
    await db.commit()
    return {"success": True, "message": "Annotation set deleted"}


# Individual annotation endpoints (for fine-grained control)


@router.post("/{annotation_set_id}/annotations", response_model=AnnotationResponse)
async def add_annotation(
    annotation_set_id: str,
    annotation_in: AnnotationCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> Annotation:
    """Add an annotation to an existing set (admin only)"""
    result = await db.execute(
        select(AnnotationSet).filter(AnnotationSet.id == annotation_set_id)
    )
    annotation_set = result.scalar_one_or_none()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")

    # Validate screenshot_index is within bounds
    max_screenshot_index = annotation_set.screenshot_count - 1
    if annotation_in.screenshot_index > max_screenshot_index:
        raise HTTPException(
            status_code=400,
            detail=f"screenshot_index {annotation_in.screenshot_index} exceeds maximum {max_screenshot_index}",
        )

    # Get max order
    count_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .filter(Annotation.annotation_set_id == annotation_set_id)
    )
    max_order = count_result.scalar()

    annotation = Annotation(
        id=str(uuid.uuid4()),
        annotation_set_id=annotation_set_id,
        screenshot_index=annotation_in.screenshot_index,
        x=annotation_in.x,
        y=annotation_in.y,
        width=annotation_in.width,
        height=annotation_in.height,
        label=annotation_in.label,
        description=annotation_in.description,
        reason=annotation_in.reason,
        extra_data=annotation_in.extra_data,
        order=max_order,
    )

    db.add(annotation)
    annotation_set.updated_at = datetime.now(UTC)  # type: ignore[assignment]
    await db.commit()
    await db.refresh(annotation)
    return annotation


@router.put("/annotations/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: str,
    annotation_in: AnnotationUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> Annotation:
    """Update an annotation (admin only)"""
    result = await db.execute(
        select(Annotation)
        .options(selectinload(Annotation.annotation_set))
        .filter(Annotation.id == annotation_id)
    )
    annotation = result.scalar_one_or_none()
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Validate screenshot_index if being updated
    if annotation_in.screenshot_index is not None:
        max_screenshot_index = annotation.annotation_set.screenshot_count - 1
        if annotation_in.screenshot_index > max_screenshot_index:
            raise HTTPException(
                status_code=400,
                detail=f"screenshot_index {annotation_in.screenshot_index} exceeds maximum {max_screenshot_index}",
            )
        annotation.screenshot_index = annotation_in.screenshot_index  # type: ignore[assignment]

    # Update fields
    if annotation_in.x is not None:
        annotation.x = annotation_in.x  # type: ignore[assignment]
    if annotation_in.y is not None:
        annotation.y = annotation_in.y  # type: ignore[assignment]
    if annotation_in.width is not None:
        annotation.width = annotation_in.width  # type: ignore[assignment]
    if annotation_in.height is not None:
        annotation.height = annotation_in.height  # type: ignore[assignment]
    if annotation_in.label is not None:
        annotation.label = annotation_in.label  # type: ignore[assignment]
    if annotation_in.description is not None:
        annotation.description = annotation_in.description  # type: ignore[assignment]
    if annotation_in.reason is not None:
        annotation.reason = annotation_in.reason  # type: ignore[assignment]
    if annotation_in.extra_data is not None:
        annotation.extra_data = annotation_in.extra_data  # type: ignore[assignment]

    # Update annotation set timestamp
    annotation.annotation_set.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(annotation)
    return annotation


@router.delete("/annotations/{annotation_id}")
async def delete_annotation(
    annotation_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict:
    """Delete an annotation (admin only)"""
    result = await db.execute(
        select(Annotation)
        .options(selectinload(Annotation.annotation_set))
        .filter(Annotation.id == annotation_id)
    )
    annotation = result.scalar_one_or_none()
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Update annotation set timestamp
    annotation.annotation_set.updated_at = datetime.now(UTC)

    await db.delete(annotation)
    await db.commit()
    return {"success": True, "message": "Annotation deleted"}


# Export endpoints


@router.get("/{annotation_set_id}/export/multi")
async def export_annotation_set_multi(
    annotation_set_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict:
    """
    Export annotation set in research format for multi-screenshot support.

    This endpoint exports annotations grouped by screenshot, suitable for
    research and analysis purposes where annotations need to be organized
    by the screenshot they belong to.

    Returns:
        {
            "id": str,
            "screenshots": [
                {
                    "index": int,
                    "name": str,
                    "url": str,
                    "width": int,
                    "height": int,
                    "annotations": [...]
                },
                ...
            ],
            "notes": str,
            "boundary_width": int,
            "created_at": datetime,
            "updated_at": datetime
        }
    """
    result = await db.execute(
        select(AnnotationSet)
        .options(selectinload(AnnotationSet.annotations))
        .filter(AnnotationSet.id == annotation_set_id)
    )
    annotation_set = result.scalar_one_or_none()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")

    # Group annotations by screenshot_index
    from collections import defaultdict

    annotations_by_screenshot = defaultdict(list)
    for ann in annotation_set.annotations:
        annotations_by_screenshot[ann.screenshot_index].append(
            {
                "id": ann.id,
                "x": ann.x,
                "y": ann.y,
                "width": ann.width,
                "height": ann.height,
                "label": ann.label,
                "description": ann.description,
                "reason": ann.reason,
                "extra_data": ann.extra_data,
                "order": ann.order,
            }
        )

    # Build screenshots array with their annotations
    screenshots = []
    for i in range(annotation_set.screenshot_count):
        screenshot_data = annotation_set.get_screenshot(i)
        if screenshot_data:
            screenshots.append(
                {
                    "index": i,
                    "name": screenshot_data["name"],
                    "url": screenshot_data["url"],
                    "width": screenshot_data["width"],
                    "height": screenshot_data["height"],
                    "annotations": sorted(
                        annotations_by_screenshot.get(i, []), key=lambda a: a["order"]
                    ),
                }
            )

    return {
        "id": annotation_set.id,
        "screenshots": screenshots,
        "notes": annotation_set.notes,
        "boundary_width": annotation_set.boundary_width,
        "created_at": annotation_set.created_at.isoformat(),
        "updated_at": annotation_set.updated_at.isoformat(),
        "created_by_id": annotation_set.created_by_id,
    }
