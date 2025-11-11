"""
API endpoints for annotation management (admin only)
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc

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
from app.utils.authorization import verify_superuser
import uuid
from datetime import datetime

router = APIRouter()


@router.get("/", response_model=List[AnnotationSetResponse])
async def list_annotation_sets(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> List[AnnotationSet]:
    """List all annotation sets (admin only)"""
    annotation_sets = (
        db.query(AnnotationSet)
        .order_by(desc(AnnotationSet.created_at))
        .offset(skip)
        .limit(limit)
        .all()
    )
    return annotation_sets


@router.post("/", response_model=AnnotationSetResponse)
async def create_annotation_set(
    annotation_set_in: AnnotationSetCreate,
    db: Session = Depends(deps.get_db),
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
        created_by_id=current_user.id,
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
            metadata=ann_data.metadata,
            order=i,
        )
        db.add(annotation)

    db.commit()
    db.refresh(annotation_set)
    return annotation_set


@router.get("/{annotation_set_id}", response_model=AnnotationSetResponse)
async def get_annotation_set(
    annotation_set_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> AnnotationSet:
    """Get a specific annotation set (admin only)"""
    annotation_set = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")
    return annotation_set


@router.put("/{annotation_set_id}", response_model=AnnotationSetResponse)
async def update_annotation_set(
    annotation_set_id: str,
    annotation_set_in: AnnotationSetUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> AnnotationSet:
    """Update an annotation set (admin only)"""
    annotation_set = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first()
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
        db.query(Annotation).filter(Annotation.annotation_set_id == annotation_set_id).delete()

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
                metadata=ann_data.metadata,
                order=i,
            )
            db.add(annotation)

    db.commit()
    db.refresh(annotation_set)
    return annotation_set


@router.delete("/{annotation_set_id}")
async def delete_annotation_set(
    annotation_set_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict:
    """Delete an annotation set (admin only)"""
    annotation_set = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")

    db.delete(annotation_set)
    db.commit()
    return {"success": True, "message": "Annotation set deleted"}


# Individual annotation endpoints (for fine-grained control)

@router.post("/{annotation_set_id}/annotations", response_model=AnnotationResponse)
async def add_annotation(
    annotation_set_id: str,
    annotation_in: AnnotationCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> Annotation:
    """Add an annotation to an existing set (admin only)"""
    annotation_set = db.query(AnnotationSet).filter(AnnotationSet.id == annotation_set_id).first()
    if not annotation_set:
        raise HTTPException(status_code=404, detail="Annotation set not found")

    # Get max order
    max_order = db.query(Annotation).filter(Annotation.annotation_set_id == annotation_set_id).count()

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
        metadata=annotation_in.metadata,
        order=max_order,
    )

    db.add(annotation)
    annotation_set.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(annotation)
    return annotation


@router.put("/annotations/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: str,
    annotation_in: AnnotationUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> Annotation:
    """Update an annotation (admin only)"""
    annotation = db.query(Annotation).filter(Annotation.id == annotation_id).first()
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
    if annotation_in.metadata is not None:
        annotation.metadata = annotation_in.metadata

    # Update annotation set timestamp
    annotation.annotation_set.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(annotation)
    return annotation


@router.delete("/annotations/{annotation_id}")
async def delete_annotation(
    annotation_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict:
    """Delete an annotation (admin only)"""
    annotation = db.query(Annotation).filter(Annotation.id == annotation_id).first()
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Update annotation set timestamp
    annotation.annotation_set.updated_at = datetime.utcnow()

    db.delete(annotation)
    db.commit()
    return {"success": True, "message": "Annotation deleted"}
