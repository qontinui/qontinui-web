"""
API endpoints for Training Dataset management.

Provides endpoints for:
- Dataset CRUD operations
- Image browsing and management
- Annotation review workflow
- Dataset import from ZIP files
- Dataset export to ML formats (COCO, YOLO, etc.)
- Statistics and analytics
- Bulk operations
"""

import hashlib
import io
import json
import math
import os
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import String, and_, cast, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import ColumnElement

from app.api import deps
from app.models.training_dataset import (
    AnnotationSource,
    DatasetSource,
    ElementType,
    ExportFormat,
    ExportJobStatus,
    ReviewStatus,
    TrainingDataset,
    TrainingDatasetAnnotation,
    TrainingDatasetExportJob,
    TrainingDatasetImage,
)
from app.models.user import User
from app.schemas.training_dataset import (
    BulkAnnotationUpdate,
    BulkOperationResult,
    ConfidenceHistogramBucket,
    ConfidenceHistogramResponse,
    ConfidenceStats,
    DatasetAnnotationResponse,
    DatasetAnnotationUpdate,
    DatasetCreate,
    DatasetExportJobResponse,
    DatasetExportRequest,
    DatasetImageResponse,
    DatasetImageUpdate,
    DatasetImportResponse,
    DatasetResponse,
    DatasetStatisticsResponse,
    DatasetUpdate,
    PaginatedAnnotationsResponse,
    PaginatedImagesResponse,
)
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)

router = APIRouter()


# ============================================================================
# Helper Functions
# ============================================================================


def compute_image_hash(content: bytes) -> str:
    """Compute SHA256 hash of image content"""
    return hashlib.sha256(content).hexdigest()


async def update_dataset_stats(db: AsyncSession, dataset_id: uuid.UUID) -> None:
    """Update denormalized statistics for a dataset"""
    # Count images
    image_count = await db.scalar(
        select(func.count())
        .select_from(TrainingDatasetImage)
        .where(TrainingDatasetImage.dataset_id == dataset_id)
    )

    # Count annotations
    annotation_count = await db.scalar(
        select(func.count())
        .select_from(TrainingDatasetAnnotation)
        .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
    )

    # Count reviewed images
    reviewed_count = await db.scalar(
        select(func.count())
        .select_from(TrainingDatasetImage)
        .where(
            and_(
                TrainingDatasetImage.dataset_id == dataset_id,
                TrainingDatasetImage.reviewed.is_(True),
            )
        )
    )

    # Update dataset
    result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if dataset:
        dataset.total_images = image_count or 0  # type: ignore[assignment]
        dataset.total_annotations = annotation_count or 0  # type: ignore[assignment]
        dataset.reviewed_count = reviewed_count or 0  # type: ignore[assignment]


# ============================================================================
# Dataset CRUD Endpoints
# ============================================================================


@router.get("/", response_model=list[DatasetResponse])
async def list_datasets(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> list[DatasetResponse]:
    """List all training datasets (admin only)"""
    result = await db.execute(
        select(TrainingDataset)
        .order_by(TrainingDataset.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    datasets = result.scalars().all()

    # Convert to response format with created_by as string
    response_datasets: list[DatasetResponse] = []
    for d in datasets:
        response_datasets.append(DatasetResponse.model_validate(d))

    return response_datasets


@router.post("/", response_model=DatasetResponse)
async def create_dataset(
    dataset_in: DatasetCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetResponse:
    """Create a new empty dataset (admin only)"""
    dataset = TrainingDataset(
        name=dataset_in.name,
        description=dataset_in.description,
        source=DatasetSource.MANUAL_UPLOAD,
        created_by_id=current_user.id,
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)

    return DatasetResponse.model_validate(dataset)


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetResponse:
    """Get a specific dataset (admin only)"""
    result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return DatasetResponse.model_validate(dataset)


@router.put("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(
    dataset_id: str,
    dataset_in: DatasetUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetResponse:
    """Update a dataset (admin only)"""
    result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset_in.name is not None:
        dataset.name = dataset_in.name  # type: ignore[assignment]
    if dataset_in.description is not None:
        dataset.description = dataset_in.description  # type: ignore[assignment]

    await db.commit()
    await db.refresh(dataset)

    return DatasetResponse.model_validate(dataset)


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict[str, Any]:
    """Delete a dataset and all its images/annotations (admin only)"""
    result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Delete associated files from storage
    images_result = await db.execute(
        select(TrainingDatasetImage).where(
            TrainingDatasetImage.dataset_id == dataset_id
        )
    )
    images = images_result.scalars().all()

    for image in images:
        try:
            object_storage.backend.delete_file(image.storage_path)  # type: ignore[arg-type]
        except Exception as e:
            logger.warning(
                "failed_to_delete_image_file", path=image.storage_path, error=str(e)
            )

    await db.delete(dataset)
    await db.commit()

    return {"success": True, "message": "Dataset deleted"}


# ============================================================================
# Image Endpoints
# ============================================================================


@router.get("/{dataset_id}/images", response_model=PaginatedImagesResponse)
async def get_dataset_images(
    dataset_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    review_status: list[str] | None = Query(None),
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: str = "desc",
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> PaginatedImagesResponse:
    """Get paginated images for a dataset (admin only)"""
    # Verify dataset exists
    dataset_result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    if not dataset_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Build query
    query = select(TrainingDatasetImage).where(
        TrainingDatasetImage.dataset_id == dataset_id
    )

    # Apply filters
    if review_status:
        if "reviewed" in review_status:
            query = query.where(TrainingDatasetImage.reviewed.is_(True))
        elif "pending" in review_status:
            query = query.where(TrainingDatasetImage.reviewed.is_(False))

    if search:
        query = query.where(
            or_(
                TrainingDatasetImage.filename.ilike(f"%{search}%"),
                TrainingDatasetImage.action_type.ilike(f"%{search}%"),
            )
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply sorting
    order_col: ColumnElement[Any]
    if sort_by == "filename":
        order_col = TrainingDatasetImage.filename
    elif sort_by == "created_at":
        order_col = TrainingDatasetImage.created_at
    else:
        order_col = TrainingDatasetImage.created_at

    if sort_order == "asc":
        query = query.order_by(order_col.asc())
    else:
        query = query.order_by(order_col.desc())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    images = result.scalars().all()

    # Get annotation counts
    annotation_counts: dict[str, int] = {}
    if images:
        image_ids = [img.id for img in images]
        count_result = await db.execute(
            select(
                TrainingDatasetAnnotation.image_id,
                func.count().label("count"),
            )
            .where(TrainingDatasetAnnotation.image_id.in_(image_ids))
            .group_by(TrainingDatasetAnnotation.image_id)
        )
        for row in count_result:
            annotation_counts[str(row.image_id)] = row.count  # type: ignore[assignment]

    # Build response
    items: list[DatasetImageResponse] = []
    for img in images:
        img_response = DatasetImageResponse.model_validate(img)
        # Override computed fields
        img_response.image_url = (
            f"/api/v1/datasets/{dataset_id}/images/{img.image_hash}/file"
        )
        img_response.annotation_count = annotation_counts.get(str(img.id), 0)
        items.append(img_response)

    return PaginatedImagesResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0,
    )


@router.get("/{dataset_id}/images/{image_hash}/file")
async def get_image_file(
    dataset_id: str,
    image_hash: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> StreamingResponse:
    """Get the actual image file"""
    result = await db.execute(
        select(TrainingDatasetImage).where(
            and_(
                TrainingDatasetImage.dataset_id == dataset_id,
                TrainingDatasetImage.image_hash == image_hash,
            )
        )
    )
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Get file from storage
    try:
        file_content = object_storage.backend.download_file(image.storage_path)  # type: ignore[arg-type]

        # Determine content type
        ext = (
            image.filename.rsplit(".", 1)[-1].lower()
            if "." in image.filename
            else "png"
        )
        content_type = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "gif": "image/gif",
            "webp": "image/webp",
        }.get(ext, "image/png")

        return StreamingResponse(
            io.BytesIO(file_content),
            media_type=content_type,
            headers={"Content-Disposition": f'inline; filename="{image.filename}"'},
        )
    except Exception as e:
        logger.error("failed_to_get_image_file", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to retrieve image file")


@router.get("/{dataset_id}/images/{image_hash}/thumbnail")
async def get_image_thumbnail(
    dataset_id: str,
    image_hash: str,
    size: int = Query(200, ge=50, le=500),
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> StreamingResponse:
    """Get a thumbnail of the image"""
    # For simplicity, return the full image. In production, you'd generate thumbnails.
    return await get_image_file(dataset_id, image_hash, db, current_user)


@router.put("/{dataset_id}/images/{image_id}", response_model=DatasetImageResponse)
async def update_image(
    dataset_id: str,
    image_id: str,
    image_in: DatasetImageUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetImageResponse:
    """Update an image's review status"""
    result = await db.execute(
        select(TrainingDatasetImage).where(
            and_(
                TrainingDatasetImage.dataset_id == dataset_id,
                TrainingDatasetImage.id == image_id,
            )
        )
    )
    image = result.scalar_one_or_none()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    if image_in.reviewed is not None:
        image.reviewed = image_in.reviewed  # type: ignore[assignment]
        if image_in.reviewed:
            image.reviewed_by_id = current_user.id  # type: ignore[assignment]
            image.reviewed_at = datetime.utcnow()  # type: ignore[assignment]
        else:
            image.reviewed_by_id = None  # type: ignore[assignment]
            image.reviewed_at = None  # type: ignore[assignment]

    if image_in.reviewer_notes is not None:
        image.reviewer_notes = image_in.reviewer_notes  # type: ignore[assignment]

    await db.commit()
    await db.refresh(image)

    # Update dataset stats
    await update_dataset_stats(db, image.dataset_id)  # type: ignore[arg-type]
    await db.commit()

    img_response = DatasetImageResponse.model_validate(image)
    img_response.image_url = (
        f"/api/v1/datasets/{dataset_id}/images/{image.image_hash}/file"
    )
    img_response.annotation_count = 0  # Would need separate query
    return img_response


# ============================================================================
# Annotation Endpoints
# ============================================================================


@router.get(
    "/{dataset_id}/images/{image_id}/annotations",
    response_model=list[DatasetAnnotationResponse],
)
async def get_image_annotations(
    dataset_id: str,
    image_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> list[DatasetAnnotationResponse]:
    """Get all annotations for a specific image"""
    result = await db.execute(
        select(TrainingDatasetAnnotation)
        .where(
            and_(
                TrainingDatasetAnnotation.dataset_id == dataset_id,
                TrainingDatasetAnnotation.image_id == image_id,
            )
        )
        .order_by(TrainingDatasetAnnotation.created_at)
    )
    annotations = result.scalars().all()

    return [DatasetAnnotationResponse.model_validate(ann) for ann in annotations]


@router.get("/{dataset_id}/annotations", response_model=PaginatedAnnotationsResponse)
async def get_dataset_annotations(
    dataset_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    source: list[str] | None = Query(None),
    element_type: list[str] | None = Query(None),
    confidence_min: float | None = Query(None, ge=0.0, le=1.0),
    confidence_max: float | None = Query(None, ge=0.0, le=1.0),
    review_status: list[str] | None = Query(None),
    verified: bool | None = None,
    category_name: list[str] | None = Query(None),
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: str = "desc",
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> PaginatedAnnotationsResponse:
    """Get paginated annotations for a dataset with filters"""
    # Verify dataset exists
    dataset_result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    if not dataset_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Build query
    query = select(TrainingDatasetAnnotation).where(
        TrainingDatasetAnnotation.dataset_id == dataset_id
    )

    # Apply filters
    if source:
        source_enums = [
            AnnotationSource(s)
            for s in source
            if s in [e.value for e in AnnotationSource]
        ]
        if source_enums:
            query = query.where(TrainingDatasetAnnotation.source.in_(source_enums))

    if element_type:
        type_enums = [
            ElementType(t) for t in element_type if t in [e.value for e in ElementType]
        ]
        if type_enums:
            query = query.where(TrainingDatasetAnnotation.element_type.in_(type_enums))

    if confidence_min is not None:
        query = query.where(TrainingDatasetAnnotation.confidence >= confidence_min)

    if confidence_max is not None:
        query = query.where(TrainingDatasetAnnotation.confidence <= confidence_max)

    if review_status:
        status_enums = [
            ReviewStatus(s)
            for s in review_status
            if s in [e.value for e in ReviewStatus]
        ]
        if status_enums:
            query = query.where(
                TrainingDatasetAnnotation.review_status.in_(status_enums)
            )

    if verified is not None:
        query = query.where(TrainingDatasetAnnotation.verified == verified)

    if category_name:
        query = query.where(TrainingDatasetAnnotation.category_name.in_(category_name))

    if search:
        query = query.where(
            TrainingDatasetAnnotation.category_name.ilike(f"%{search}%")
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    # Apply sorting
    order_col: ColumnElement[Any]
    if sort_by == "confidence":
        order_col = TrainingDatasetAnnotation.confidence
    elif sort_by == "category_name":
        order_col = TrainingDatasetAnnotation.category_name
    elif sort_by == "review_status":
        order_col = cast(TrainingDatasetAnnotation.review_status, String)
    else:
        order_col = TrainingDatasetAnnotation.created_at

    if sort_order == "asc":
        query = query.order_by(order_col.asc())
    else:
        query = query.order_by(order_col.desc())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    annotations = result.scalars().all()

    items = [DatasetAnnotationResponse.model_validate(ann) for ann in annotations]

    return PaginatedAnnotationsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0,
    )


@router.get(
    "/{dataset_id}/annotations/{annotation_id}",
    response_model=DatasetAnnotationResponse,
)
async def get_annotation(
    dataset_id: str,
    annotation_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetAnnotationResponse:
    """Get a specific annotation"""
    result = await db.execute(
        select(TrainingDatasetAnnotation).where(
            and_(
                TrainingDatasetAnnotation.dataset_id == dataset_id,
                TrainingDatasetAnnotation.id == annotation_id,
            )
        )
    )
    ann = result.scalar_one_or_none()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    return DatasetAnnotationResponse.model_validate(ann)


@router.put(
    "/{dataset_id}/annotations/{annotation_id}",
    response_model=DatasetAnnotationResponse,
)
async def update_annotation(
    dataset_id: str,
    annotation_id: str,
    annotation_in: DatasetAnnotationUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetAnnotationResponse:
    """Update an annotation"""
    result = await db.execute(
        select(TrainingDatasetAnnotation).where(
            and_(
                TrainingDatasetAnnotation.dataset_id == dataset_id,
                TrainingDatasetAnnotation.id == annotation_id,
            )
        )
    )
    ann = result.scalar_one_or_none()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Update fields
    if annotation_in.x is not None:
        ann.x = annotation_in.x  # type: ignore[assignment]
    if annotation_in.y is not None:
        ann.y = annotation_in.y  # type: ignore[assignment]
    if annotation_in.width is not None:
        ann.width = annotation_in.width  # type: ignore[assignment]
    if annotation_in.height is not None:
        ann.height = annotation_in.height  # type: ignore[assignment]
    if annotation_in.category_id is not None:
        ann.category_id = annotation_in.category_id  # type: ignore[assignment]
    if annotation_in.category_name is not None:
        ann.category_name = annotation_in.category_name  # type: ignore[assignment]
    if annotation_in.confidence is not None:
        ann.confidence = annotation_in.confidence  # type: ignore[assignment]
    if annotation_in.element_type is not None:
        ann.element_type = ElementType(annotation_in.element_type)
    if annotation_in.verified is not None:
        ann.verified = annotation_in.verified  # type: ignore[assignment]
    if annotation_in.review_status is not None:
        ann.review_status = ReviewStatus(annotation_in.review_status)
        ann.reviewed_by_id = current_user.id  # type: ignore[assignment]
        ann.reviewed_at = datetime.utcnow()  # type: ignore[assignment]
    if annotation_in.reviewer_notes is not None:
        ann.reviewer_notes = annotation_in.reviewer_notes  # type: ignore[assignment]

    await db.commit()
    await db.refresh(ann)

    return DatasetAnnotationResponse.model_validate(ann)


@router.delete("/{dataset_id}/annotations/{annotation_id}")
async def delete_annotation(
    dataset_id: str,
    annotation_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict[str, Any]:
    """Delete an annotation"""
    result = await db.execute(
        select(TrainingDatasetAnnotation).where(
            and_(
                TrainingDatasetAnnotation.dataset_id == dataset_id,
                TrainingDatasetAnnotation.id == annotation_id,
            )
        )
    )
    ann = result.scalar_one_or_none()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    await db.delete(ann)
    await db.commit()

    # Update dataset stats
    await update_dataset_stats(db, uuid.UUID(dataset_id))
    await db.commit()

    return {"success": True, "message": "Annotation deleted"}


@router.post("/{dataset_id}/annotations/bulk", response_model=BulkOperationResult)
async def bulk_update_annotations(
    dataset_id: str,
    bulk_update: BulkAnnotationUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> BulkOperationResult:
    """Bulk update annotations"""
    updated_count = 0
    failed_count = 0
    errors: list[dict[str, Any]] = []

    for annotation_id in bulk_update.annotation_ids:
        try:
            result = await db.execute(
                select(TrainingDatasetAnnotation).where(
                    and_(
                        TrainingDatasetAnnotation.dataset_id == dataset_id,
                        TrainingDatasetAnnotation.id == annotation_id,
                    )
                )
            )
            ann = result.scalar_one_or_none()
            if not ann:
                errors.append({"annotation_id": annotation_id, "error": "Not found"})
                failed_count += 1
                continue

            # Apply updates
            update_data = bulk_update.update
            if update_data.review_status is not None:
                ann.review_status = ReviewStatus(update_data.review_status)
                ann.reviewed_by_id = current_user.id  # type: ignore[assignment]
                ann.reviewed_at = datetime.utcnow()  # type: ignore[assignment]
            if update_data.reviewer_notes is not None:
                ann.reviewer_notes = update_data.reviewer_notes  # type: ignore[assignment]
            if update_data.verified is not None:
                ann.verified = update_data.verified  # type: ignore[assignment]

            updated_count += 1

        except Exception as e:
            errors.append({"annotation_id": annotation_id, "error": str(e)})
            failed_count += 1

    await db.commit()

    return BulkOperationResult(
        updated_count=updated_count,
        failed_count=failed_count,
        errors=errors,  # type: ignore[arg-type]
    )


# ============================================================================
# Statistics Endpoints
# ============================================================================


@router.get("/{dataset_id}/stats", response_model=DatasetStatisticsResponse)
async def get_dataset_statistics(
    dataset_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetStatisticsResponse:
    """Get comprehensive statistics for a dataset"""
    # Verify dataset exists
    dataset_result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    dataset = dataset_result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Total and unique images
    total_images: int = dataset.total_images  # type: ignore[assignment]
    unique_images = (
        await db.scalar(
            select(func.count(distinct(TrainingDatasetImage.image_hash))).where(
                TrainingDatasetImage.dataset_id == dataset_id
            )
        )
        or 0
    )

    # Total annotations
    total_annotations: int = dataset.total_annotations  # type: ignore[assignment]

    # Reviewed counts
    reviewed_images: int = dataset.reviewed_count  # type: ignore[assignment]
    reviewed_annotations = (
        await db.scalar(
            select(func.count())
            .select_from(TrainingDatasetAnnotation)
            .where(
                and_(
                    TrainingDatasetAnnotation.dataset_id == dataset_id,
                    TrainingDatasetAnnotation.review_status != ReviewStatus.PENDING,
                )
            )
        )
        or 0
    )

    # By source
    source_result = await db.execute(
        select(
            TrainingDatasetAnnotation.source,
            func.count().label("count"),
        )
        .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
        .group_by(TrainingDatasetAnnotation.source)
    )
    by_source: dict[str, int] = {row.source.value: row.count for row in source_result}  # type: ignore[misc]

    # By element type
    type_result = await db.execute(
        select(
            TrainingDatasetAnnotation.element_type,
            func.count().label("count"),
        )
        .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
        .group_by(TrainingDatasetAnnotation.element_type)
    )
    by_element_type: dict[str, int] = {
        (row.element_type.value if row.element_type else "unknown"): row.count  # type: ignore[misc]
        for row in type_result
    }

    # By review status
    status_result = await db.execute(
        select(
            TrainingDatasetAnnotation.review_status,
            func.count().label("count"),
        )
        .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
        .group_by(TrainingDatasetAnnotation.review_status)
    )
    by_review_status: dict[str, int] = {row.review_status.value: row.count for row in status_result}  # type: ignore[misc]

    # Confidence stats
    confidence_result = await db.execute(
        select(
            func.min(TrainingDatasetAnnotation.confidence).label("min"),
            func.max(TrainingDatasetAnnotation.confidence).label("max"),
            func.avg(TrainingDatasetAnnotation.confidence).label("mean"),
        ).where(TrainingDatasetAnnotation.dataset_id == dataset_id)
    )
    conf_row = confidence_result.one_or_none()

    # Calculate median (approximation)
    median_result = await db.execute(
        select(TrainingDatasetAnnotation.confidence)
        .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
        .order_by(TrainingDatasetAnnotation.confidence)
        .offset(total_annotations // 2)
        .limit(1)
    )
    median_row = median_result.scalar_one_or_none()

    confidence_stats = ConfidenceStats(
        min=conf_row.min if conf_row and conf_row.min is not None else 0.0,
        max=conf_row.max if conf_row and conf_row.max is not None else 1.0,
        mean=float(conf_row.mean) if conf_row and conf_row.mean is not None else 0.5,
        median=median_row if median_row is not None else 0.5,
    )

    # By category
    category_result = await db.execute(
        select(
            TrainingDatasetAnnotation.category_id,
            TrainingDatasetAnnotation.category_name,
            func.count().label("count"),
        )
        .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
        .group_by(
            TrainingDatasetAnnotation.category_id,
            TrainingDatasetAnnotation.category_name,
        )
    )
    by_category: list[dict[str, Any]] = [
        {
            "category_id": row.category_id,
            "category_name": row.category_name,
            "count": row.count,
        }
        for row in category_result
    ]

    return DatasetStatisticsResponse(
        total_images=total_images,
        unique_images=unique_images,
        total_annotations=total_annotations,
        reviewed_images=reviewed_images,
        reviewed_annotations=reviewed_annotations,
        by_source=by_source,
        by_element_type=by_element_type,
        by_review_status=by_review_status,
        confidence_stats=confidence_stats,
        by_category=by_category,  # type: ignore[arg-type]
    )


@router.get(
    "/{dataset_id}/stats/confidence-histogram",
    response_model=ConfidenceHistogramResponse,
)
async def get_confidence_histogram(
    dataset_id: str,
    buckets: int = Query(10, ge=2, le=100),
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> ConfidenceHistogramResponse:
    """Get confidence score histogram"""
    # Get all confidence values
    result = await db.execute(
        select(TrainingDatasetAnnotation.confidence).where(
            TrainingDatasetAnnotation.dataset_id == dataset_id
        )
    )
    confidences: list[float] = [row[0] for row in result]

    if not confidences:
        return ConfidenceHistogramResponse(
            buckets=[
                ConfidenceHistogramBucket(
                    min=i / buckets, max=(i + 1) / buckets, count=0
                )
                for i in range(buckets)
            ]
        )

    # Build histogram
    bucket_size = 1.0 / buckets
    histogram = [0] * buckets

    for conf in confidences:
        bucket_idx = min(int(conf / bucket_size), buckets - 1)
        histogram[bucket_idx] += 1

    return ConfidenceHistogramResponse(
        buckets=[
            ConfidenceHistogramBucket(
                min=i * bucket_size,
                max=(i + 1) * bucket_size,
                count=histogram[i],
            )
            for i in range(buckets)
        ]
    )


# ============================================================================
# Import Endpoint
# ============================================================================


@router.post("/import", response_model=DatasetImportResponse)
async def import_dataset(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str | None = Form(None),
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetImportResponse:
    """
    Import a training dataset from a ZIP file.

    The ZIP file should contain:
    - manifest.jsonl: Line-delimited JSON with image metadata
    - images/: Directory containing image files
    - annotations/: Directory containing annotation JSON files
    - metadata.json (optional): Export metadata
    """
    warnings: list[str] = []
    errors: list[str] = []
    images_imported = 0
    annotations_imported = 0

    # Create dataset
    dataset = TrainingDataset(
        name=name,
        description=description,
        source=DatasetSource.RUNNER_EXPORT,
        created_by_id=current_user.id,
    )
    db.add(dataset)
    await db.flush()

    try:
        # Read ZIP file
        content = await file.read()
        with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
            # Check for required files
            names = zf.namelist()
            manifest_path: str | None = None
            for n in names:
                if n.endswith("manifest.jsonl"):
                    manifest_path = n
                    break

            if not manifest_path:
                raise HTTPException(
                    status_code=400, detail="ZIP file must contain manifest.jsonl"
                )

            # Read metadata if present
            metadata_path: str | None = None
            for n in names:
                if n.endswith("metadata.json"):
                    metadata_path = n
                    break

            if metadata_path:
                with zf.open(metadata_path) as mf:
                    metadata = json.load(mf)
                    dataset.export_metadata = metadata
                    dataset.dataset_version = metadata.get("version")

            # Process manifest
            with zf.open(manifest_path) as mf:
                for line in mf:
                    try:
                        entry = json.loads(line.decode("utf-8"))

                        # Find image file
                        image_filename = entry.get("image_path", entry.get("filename"))
                        if not image_filename:
                            warnings.append(f"Entry missing image_path: {entry}")
                            continue

                        # Try to find the image in the ZIP
                        image_path: str | None = None
                        for n in names:
                            if n.endswith(image_filename) or n.endswith(
                                os.path.basename(image_filename)
                            ):
                                image_path = n
                                break

                        if not image_path:
                            warnings.append(f"Image not found in ZIP: {image_filename}")
                            continue

                        # Read image
                        with zf.open(image_path) as img_file:
                            image_content = img_file.read()

                        # Compute hash
                        image_hash = compute_image_hash(image_content)

                        # Check if image already exists in this dataset
                        existing = await db.execute(
                            select(TrainingDatasetImage).where(
                                and_(
                                    TrainingDatasetImage.dataset_id == dataset.id,
                                    TrainingDatasetImage.image_hash == image_hash,
                                )
                            )
                        )
                        if existing.scalar_one_or_none():
                            warnings.append(
                                f"Duplicate image skipped: {image_filename}"
                            )
                            continue

                        # Upload to storage
                        storage_key = f"training-datasets/{dataset.id}/{image_hash}/{os.path.basename(image_filename)}"
                        object_storage.backend.upload_file(
                            file_obj=io.BytesIO(image_content),
                            key=storage_key,
                            content_type="image/png",
                        )

                        # Get image dimensions (would need PIL in production)
                        width = entry.get("width", 1920)
                        height = entry.get("height", 1080)

                        # Create image record
                        image = TrainingDatasetImage(
                            dataset_id=dataset.id,
                            image_hash=image_hash,
                            filename=os.path.basename(image_filename),
                            width=width,
                            height=height,
                            storage_path=storage_key,
                            action_id=entry.get("action_id"),
                            action_type=entry.get("action_type"),
                            active_states=entry.get("active_states"),
                            timestamp=(
                                datetime.fromisoformat(entry["timestamp"])
                                if entry.get("timestamp")
                                else None
                            ),
                        )
                        db.add(image)
                        await db.flush()
                        images_imported += 1

                        # Process annotations
                        annotation_filename = entry.get("annotation_path")
                        if annotation_filename:
                            ann_path: str | None = None
                            for n in names:
                                if n.endswith(annotation_filename) or n.endswith(
                                    os.path.basename(annotation_filename)
                                ):
                                    ann_path = n
                                    break

                            if ann_path:
                                with zf.open(ann_path) as ann_file:
                                    ann_data = json.load(ann_file)

                                    for ann in ann_data.get(
                                        "annotations",
                                        [ann_data] if "bbox" in ann_data else [],
                                    ):
                                        bbox = ann.get(
                                            "bbox", ann.get("bounding_box", {})
                                        )
                                        x: float
                                        y: float
                                        w: float
                                        h: float
                                        if isinstance(bbox, dict):
                                            x = bbox.get("x", 0)
                                            y = bbox.get("y", 0)
                                            w = bbox.get("width", 50)
                                            h = bbox.get("height", 50)
                                        elif isinstance(bbox, list) and len(bbox) >= 4:
                                            x, y, w, h = bbox[:4]
                                        else:
                                            continue

                                        # Parse source
                                        source_str = ann.get("source", "user_click")
                                        try:
                                            source = AnnotationSource(source_str)
                                        except ValueError:
                                            source = AnnotationSource.USER_CLICK

                                        # Parse element type
                                        element_type_str = ann.get("element_type")
                                        element_type: ElementType | None = None
                                        if element_type_str:
                                            try:
                                                element_type = ElementType(
                                                    element_type_str
                                                )
                                            except ValueError:
                                                element_type = ElementType.UNKNOWN

                                        annotation = TrainingDatasetAnnotation(
                                            dataset_id=dataset.id,
                                            image_id=image.id,
                                            x=int(x),
                                            y=int(y),
                                            width=int(w),
                                            height=int(h),
                                            category_id=ann.get("category_id", 1),
                                            category_name=ann.get(
                                                "category_name", "gui_element"
                                            ),
                                            confidence=ann.get("confidence", 1.0),
                                            source=source,
                                            element_type=element_type,
                                            verified=ann.get("verified", False),
                                            inference_metadata=ann.get(
                                                "inference_metadata"
                                            ),
                                        )
                                        db.add(annotation)
                                        annotations_imported += 1

                    except json.JSONDecodeError as e:
                        warnings.append(f"Invalid JSON in manifest line: {str(e)}")
                    except Exception as e:
                        warnings.append(f"Error processing entry: {str(e)}")

        # Update stats
        dataset.total_images = images_imported  # type: ignore[assignment]
        dataset.total_annotations = annotations_imported  # type: ignore[assignment]

        await db.commit()

        return DatasetImportResponse(
            dataset_id=str(dataset.id),
            images_imported=images_imported,
            annotations_imported=annotations_imported,
            warnings=warnings,
            errors=errors,
        )

    except zipfile.BadZipFile:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    except Exception as e:
        await db.rollback()
        logger.error("import_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


# ============================================================================
# Export Endpoints
# ============================================================================


@router.post("/{dataset_id}/export", response_model=DatasetExportJobResponse)
async def start_export(
    dataset_id: str,
    request: DatasetExportRequest,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetExportJobResponse:
    """Start an export job for a dataset"""
    # Verify dataset exists
    result = await db.execute(
        select(TrainingDataset).where(TrainingDataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Create export job
    try:
        export_format = ExportFormat(request.format)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid export format: {request.format}"
        )

    job = TrainingDatasetExportJob(
        dataset_id=uuid.UUID(dataset_id),
        format=export_format,
        include_images=request.include_images,
        train_percent=request.split.train_percent if request.split else None,
        val_percent=request.split.val_percent if request.split else None,
        test_percent=request.split.test_percent if request.split else None,
        random_seed=request.split.random_seed if request.split else None,
        filters=request.filters.model_dump() if request.filters else None,
        status=ExportJobStatus.PENDING,
        created_by_id=current_user.id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # In production, this would be handled by a background task/Celery
    # For now, we'll process synchronously
    try:
        job.status = ExportJobStatus.PROCESSING
        await db.commit()

        # Generate export
        download_url = await generate_export(db, job, dataset)

        job.status = ExportJobStatus.COMPLETED
        job.download_url = download_url  # type: ignore[assignment]
        job.completed_at = datetime.utcnow()  # type: ignore[assignment]
        job.progress = 100  # type: ignore[assignment]
        await db.commit()

    except Exception as e:
        job.status = ExportJobStatus.FAILED
        job.error = str(e)  # type: ignore[assignment]
        await db.commit()
        logger.error("export_failed", error=str(e))

    return DatasetExportJobResponse.model_validate(job)


async def generate_export(
    db: AsyncSession,
    job: TrainingDatasetExportJob,
    dataset: TrainingDataset,
) -> str:
    """Generate export file and return download URL.

    NOTE: Images are NEVER included in exports to avoid AWS transfer costs.
    Users package local images via qontinui-runner.
    """
    # Get all images and annotations
    images_result = await db.execute(
        select(TrainingDatasetImage).where(
            TrainingDatasetImage.dataset_id == dataset.id
        )
    )
    images = images_result.scalars().all()

    annotations_result = await db.execute(
        select(TrainingDatasetAnnotation).where(
            TrainingDatasetAnnotation.dataset_id == dataset.id
        )
    )
    annotations = annotations_result.scalars().all()

    # Build annotations by image
    annotations_by_image: dict[str, list[Any]] = defaultdict(list)
    for ann in annotations:
        annotations_by_image[str(ann.image_id)].append(ann)

    # Create export based on format
    export_data: Any
    if job.format == ExportFormat.COCO:
        export_data = generate_coco_export(images, annotations, dataset)
    elif job.format == ExportFormat.YOLO:
        export_data = generate_yolo_export(images, annotations_by_image, dataset)
    elif job.format == ExportFormat.JSONL:
        export_data = generate_jsonl_export(images, annotations_by_image)
    else:
        export_data = generate_coco_export(images, annotations, dataset)

    # Create ZIP file
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if isinstance(export_data, dict):
            zf.writestr("annotations.json", json.dumps(export_data, indent=2))
        elif isinstance(export_data, list):
            for item in export_data:
                zf.writestr(item["path"], item["content"])

        # Always include image manifest for matching local files
        manifest = generate_image_manifest(images, dataset)
        zf.writestr("image_manifest.json", json.dumps(manifest, indent=2))

    # Upload export file
    zip_buffer.seek(0)
    export_key = f"exports/{dataset.id}/{job.id}/export.zip"
    url = object_storage.backend.upload_file(
        file_obj=zip_buffer,
        key=export_key,
        content_type="application/zip",
    )

    return url


def generate_image_manifest(images: Any, dataset: Any) -> dict[str, Any]:
    """Generate manifest to help match local images with annotations.

    This manifest allows qontinui-runner to package local images
    with the exported annotations.
    """
    return {
        "version": "1.0",
        "dataset_id": str(dataset.id),
        "dataset_name": dataset.name,
        "export_date": datetime.utcnow().isoformat(),
        "total_images": len(images),
        "images": [
            {
                "filename": img.filename,
                "image_hash": img.image_hash,
                "width": img.width,
                "height": img.height,
                "action_id": img.action_id,
                "action_type": img.action_type,
                "active_states": img.active_states,
                "timestamp": img.timestamp.isoformat() if img.timestamp else None,
            }
            for img in images
        ],
    }


def generate_coco_export(images: Any, annotations: Any, dataset: Any) -> dict[str, Any]:
    """Generate COCO format export"""
    coco: dict[str, Any] = {
        "info": {
            "description": dataset.name,
            "version": dataset.dataset_version or "1.0",
            "year": datetime.utcnow().year,
            "contributor": "qontinui",
            "date_created": datetime.utcnow().isoformat(),
        },
        "images": [],
        "annotations": [],
        "categories": [],
    }

    # Build category list
    categories: dict[int, str] = {}
    for ann in annotations:
        if ann.category_id not in categories:
            categories[ann.category_id] = ann.category_name

    coco["categories"] = [
        {"id": cat_id, "name": cat_name, "supercategory": "gui"}
        for cat_id, cat_name in categories.items()
    ]

    # Add images
    image_id_map: dict[str, int] = {}
    for idx, img in enumerate(images):
        image_id = idx + 1
        image_id_map[str(img.id)] = image_id
        coco["images"].append(
            {
                "id": image_id,
                "file_name": img.filename,
                "width": img.width,
                "height": img.height,
            }
        )

    # Add annotations
    for idx, ann in enumerate(annotations):
        mapped_image_id: int | None = image_id_map.get(str(ann.image_id))
        if not mapped_image_id:
            continue

        coco["annotations"].append(
            {
                "id": idx + 1,
                "image_id": mapped_image_id,
                "category_id": ann.category_id,
                "bbox": [ann.x, ann.y, ann.width, ann.height],
                "area": ann.width * ann.height,
                "iscrowd": 0,
                "attributes": {
                    "confidence": ann.confidence,
                    "source": (
                        ann.source.value
                        if hasattr(ann.source, "value")
                        else str(ann.source)
                    ),
                    "element_type": (
                        ann.element_type.value
                        if ann.element_type and hasattr(ann.element_type, "value")
                        else None
                    ),
                },
            }
        )

    return coco


def generate_yolo_export(
    images: Any, annotations_by_image: Any, dataset: Any
) -> list[dict[str, str]]:
    """Generate YOLO format export with data.yaml and classes.txt.

    Output structure:
    - data.yaml          # YOLO configuration
    - classes.txt        # Class names (one per line)
    - labels/            # Label files (.txt)
    - README.md          # Instructions for packaging images
    """
    files: list[dict[str, str]] = []

    # Collect all unique categories
    categories: dict[int, str] = {}
    for img in images:
        img_anns = annotations_by_image.get(str(img.id), [])
        for ann in img_anns:
            if ann.category_id not in categories:
                categories[ann.category_id] = (
                    ann.category_name or f"class_{ann.category_id}"
                )

    # Sort categories by ID for consistent ordering
    sorted_categories = sorted(categories.items(), key=lambda x: x[0])

    # Create class ID mapping (remap to 0-based sequential IDs)
    class_id_remap: dict[int, int] = {}
    class_names: list[str] = []
    for new_id, (orig_id, name) in enumerate(sorted_categories):
        class_id_remap[orig_id] = new_id
        class_names.append(name)

    # Generate classes.txt
    files.append(
        {
            "path": "classes.txt",
            "content": "\n".join(class_names),
        }
    )

    # Generate data.yaml (YOLO configuration)
    data_yaml_content = f"""# YOLO Dataset Configuration
# Dataset: {dataset.name}
# Exported: {datetime.utcnow().isoformat()}
#
# IMPORTANT: This export contains annotations only.
# Use qontinui-runner to package your local images.

# Path to dataset root (update after packaging images)
path: ./

# Train/val/test directories (create after packaging)
train: images/train
val: images/val
test: images/test

# Number of classes
nc: {len(class_names)}

# Class names
names:
{chr(10).join(f'  {i}: "{name}"' for i, name in enumerate(class_names))}
"""
    files.append(
        {
            "path": "data.yaml",
            "content": data_yaml_content,
        }
    )

    # Generate label files
    for img in images:
        img_anns = annotations_by_image.get(str(img.id), [])
        lines: list[str] = []

        for ann in img_anns:
            # YOLO format: class_id x_center y_center width height (normalized)
            remapped_class_id = class_id_remap.get(ann.category_id, 0)
            x_center = (ann.x + ann.width / 2) / img.width
            y_center = (ann.y + ann.height / 2) / img.height
            norm_width = ann.width / img.width
            norm_height = ann.height / img.height

            lines.append(
                f"{remapped_class_id} {x_center:.6f} {y_center:.6f} {norm_width:.6f} {norm_height:.6f}"
            )

        label_filename = os.path.splitext(img.filename)[0] + ".txt"
        files.append(
            {
                "path": f"labels/{label_filename}",
                "content": "\n".join(lines),
            }
        )

    # Generate README with instructions
    readme_content = f"""# YOLO Dataset Export

**Dataset:** {dataset.name}
**Exported:** {datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")} UTC
**Images:** {len(images)}
**Classes:** {len(class_names)}

## Important: Images Not Included

This export contains **annotations only**. Images are stored locally on your
machine by the Qontinui Runner to avoid cloud storage transfer costs.

## Packaging Your Dataset

Use the Qontinui Runner to package your local images with these annotations:

1. Open Qontinui Runner
2. Go to Settings > Dataset Export
3. Select this annotation export file
4. The runner will match and package your local images

Alternatively, manually copy images to match the label filenames:
- For each `labels/screenshot_001.txt`, place `images/screenshot_001.png`

## Directory Structure for Training

After packaging, organize as:

```
dataset/
├── data.yaml
├── images/
│   ├── train/
│   ├── val/
│   └── test/
└── labels/
    ├── train/
    ├── val/
    └── test/
```

## Classes

{chr(10).join(f'{i}: {name}' for i, name in enumerate(class_names))}

## Using with Ultralytics YOLOv8

```python
from ultralytics import YOLO

model = YOLO('yolov8n.pt')
model.train(data='data.yaml', epochs=100)
```
"""
    files.append(
        {
            "path": "README.md",
            "content": readme_content,
        }
    )

    return files


def generate_jsonl_export(
    images: Any, annotations_by_image: Any
) -> list[dict[str, str]]:
    """Generate JSONL format export"""
    lines: list[str] = []

    for img in images:
        img_anns = annotations_by_image.get(str(img.id), [])
        entry = {
            "image": img.filename,
            "width": img.width,
            "height": img.height,
            "annotations": [
                {
                    "bbox": [ann.x, ann.y, ann.width, ann.height],
                    "category_id": ann.category_id,
                    "category_name": ann.category_name,
                    "confidence": ann.confidence,
                    "source": (
                        ann.source.value
                        if hasattr(ann.source, "value")
                        else str(ann.source)
                    ),
                }
                for ann in img_anns
            ],
        }
        lines.append(json.dumps(entry))

    return [{"path": "annotations.jsonl", "content": "\n".join(lines)}]


@router.get("/{dataset_id}/export/{job_id}", response_model=DatasetExportJobResponse)
async def get_export_job(
    dataset_id: str,
    job_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetExportJobResponse:
    """Get export job status"""
    result = await db.execute(
        select(TrainingDatasetExportJob).where(
            and_(
                TrainingDatasetExportJob.dataset_id == dataset_id,
                TrainingDatasetExportJob.id == job_id,
            )
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    return DatasetExportJobResponse.model_validate(job)
