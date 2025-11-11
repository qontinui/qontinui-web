"""
API endpoints for annotation management (admin only)
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, select, delete as sql_delete, func
from sqlalchemy.orm import selectinload

from app.api import deps
from app.models.user import User
from app.models.annotation import AnnotationSet, Annotation
from app.schemas.annotation import (
    AnnotationSetCreate,
    AnnotationSetUpdate,
    AnnotationSetResponse,
    AnnotationCreate,
    AnnotationUpdate,
    AnnotationResponse,
)
import uuid
from datetime import datetime

router = APIRouter()


@router.get("/", response_model=List[AnnotationSetResponse])
async def list_annotation_sets(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> List[AnnotationSet]:
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
    annotation_set = AnnotationSet(
        id=str(uuid.uuid4()),
        screenshot_name=annotation_set_in.screenshot_name,
        screenshot_url=annotation_set_in.screenshot_url,
        image_width=annotation_set_in.image_width,
        image_height=annotation_set_in.image_height,
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
    await db.refresh(annotation_set, ['annotations'])
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
        annotation_set.screenshot_name = annotation_set_in.screenshot_name
    if annotation_set_in.screenshot_url is not None:
        annotation_set.screenshot_url = annotation_set_in.screenshot_url
    if annotation_set_in.notes is not None:
        annotation_set.notes = annotation_set_in.notes
    if annotation_set_in.boundary_width is not None:
        annotation_set.boundary_width = annotation_set_in.boundary_width

    annotation_set.updated_at = datetime.utcnow()

    # Update annotations if provided
    if annotation_set_in.annotations is not None:
        # Delete existing annotations
        await db.execute(
            sql_delete(Annotation).filter(Annotation.annotation_set_id == annotation_set_id)
        )

        # Add new annotations
        for i, ann_data in enumerate(annotation_set_in.annotations):
            annotation = Annotation(
                id=str(uuid.uuid4()),
                annotation_set_id=annotation_set.id,
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
    await db.refresh(annotation_set, ['annotations'])
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

    # Get max order
    count_result = await db.execute(
        select(func.count()).select_from(Annotation).filter(Annotation.annotation_set_id == annotation_set_id)
    )
    max_order = count_result.scalar()

    annotation = Annotation(
        id=str(uuid.uuid4()),
        annotation_set_id=annotation_set_id,
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
    annotation_set.updated_at = datetime.utcnow()
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

    # Update fields
    if annotation_in.x is not None:
        annotation.x = annotation_in.x
    if annotation_in.y is not None:
        annotation.y = annotation_in.y
    if annotation_in.width is not None:
        annotation.width = annotation_in.width
    if annotation_in.height is not None:
        annotation.height = annotation_in.height
    if annotation_in.label is not None:
        annotation.label = annotation_in.label
    if annotation_in.description is not None:
        annotation.description = annotation_in.description
    if annotation_in.reason is not None:
        annotation.reason = annotation_in.reason
    if annotation_in.extra_data is not None:
        annotation.extra_data = annotation_in.extra_data

    # Update annotation set timestamp
    annotation.annotation_set.updated_at = datetime.utcnow()

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
    annotation.annotation_set.updated_at = datetime.utcnow()

    await db.delete(annotation)
    await db.commit()
    return {"success": True, "message": "Annotation deleted"}
