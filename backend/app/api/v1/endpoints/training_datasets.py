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

import io
import math
from typing import Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.models.training_dataset import ExportFormat
from app.models.user import User
from app.repositories.training_dataset import TrainingDatasetRepository
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
from app.services.dataset_export_service import DatasetExportService
from app.services.dataset_labeling_service import DatasetLabelingService
from app.services.dataset_processing_service import DatasetProcessingService

logger = structlog.get_logger(__name__)

router = APIRouter()


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
    datasets = await TrainingDatasetRepository.list_datasets(db, skip, limit)
    return [DatasetResponse.model_validate(d) for d in datasets]


@router.post("/", response_model=DatasetResponse)
async def create_dataset(
    dataset_in: DatasetCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetResponse:
    """Create a new empty dataset (admin only)"""
    dataset = await TrainingDatasetRepository.create(
        db=db,
        name=dataset_in.name,
        description=dataset_in.description,
        created_by_id=current_user.id,
    )
    return DatasetResponse.model_validate(dataset)


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetResponse:
    """Get a specific dataset (admin only)"""
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
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
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset = await TrainingDatasetRepository.update(
        db=db,
        dataset=dataset,
        name=dataset_in.name,
        description=dataset_in.description,
    )
    return DatasetResponse.model_validate(dataset)


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict[str, Any]:
    """Delete a dataset and all its images/annotations (admin only)"""
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Delete associated files from storage
    await DatasetProcessingService.delete_all_images_for_dataset(db, dataset_id)

    await TrainingDatasetRepository.delete(db, dataset)
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
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    images, total = await TrainingDatasetRepository.list_images(
        db=db,
        dataset_id=dataset_id,
        page=page,
        page_size=page_size,
        review_status=review_status,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    # Get annotation counts
    annotation_counts: dict[str, int] = {}
    if images:
        image_ids = [img.id for img in images]
        annotation_counts = (
            await TrainingDatasetRepository.get_annotation_counts_for_images(
                db, image_ids
            )
        )

    # Build response
    items: list[DatasetImageResponse] = []
    for img in images:
        img_response = DatasetImageResponse.model_validate(img)
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
    image = await TrainingDatasetRepository.get_image_by_hash(
        db, dataset_id, image_hash
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        file_content = DatasetProcessingService.get_image_file(image.storage_path)  # type: ignore[arg-type]

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
    # For simplicity, return the full image. In production, generate thumbnails.
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
    image = await TrainingDatasetRepository.get_image_by_id(db, dataset_id, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    image = await DatasetLabelingService.update_image_review(
        db=db,
        image=image,
        update_data=image_in,
        reviewer_id=current_user.id,
    )

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
    annotations = await TrainingDatasetRepository.list_annotations_for_image(
        db, dataset_id, image_id
    )
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
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    annotations, total = await TrainingDatasetRepository.list_annotations(
        db=db,
        dataset_id=dataset_id,
        page=page,
        page_size=page_size,
        source=source,
        element_type=element_type,
        confidence_min=confidence_min,
        confidence_max=confidence_max,
        review_status=review_status,
        verified=verified,
        category_name=category_name,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
    )

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
    ann = await TrainingDatasetRepository.get_annotation_by_id(
        db, dataset_id, annotation_id
    )
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
    ann = await TrainingDatasetRepository.get_annotation_by_id(
        db, dataset_id, annotation_id
    )
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    ann = await DatasetLabelingService.update_annotation(
        db=db,
        annotation=ann,
        update_data=annotation_in,
        reviewer_id=current_user.id,
    )
    return DatasetAnnotationResponse.model_validate(ann)


@router.delete("/{dataset_id}/annotations/{annotation_id}")
async def delete_annotation(
    dataset_id: str,
    annotation_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> dict[str, Any]:
    """Delete an annotation"""
    ann = await TrainingDatasetRepository.get_annotation_by_id(
        db, dataset_id, annotation_id
    )
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")

    await DatasetLabelingService.delete_annotation(db, ann)
    return {"success": True, "message": "Annotation deleted"}


@router.post("/{dataset_id}/annotations/bulk", response_model=BulkOperationResult)
async def bulk_update_annotations(
    dataset_id: str,
    bulk_update: BulkAnnotationUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> BulkOperationResult:
    """Bulk update annotations"""
    result = await DatasetLabelingService.bulk_update_annotations(
        db=db,
        dataset_id=dataset_id,
        annotation_ids=bulk_update.annotation_ids,
        update_data=bulk_update.update,
        reviewer_id=current_user.id,
    )
    return BulkOperationResult(
        updated_count=result["updated_count"],
        failed_count=result["failed_count"],
        errors=result["errors"],  # type: ignore[arg-type]
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
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    stats = await DatasetLabelingService.get_dataset_statistics(db, dataset_id)

    return DatasetStatisticsResponse(
        total_images=stats["total_images"],
        unique_images=stats["unique_images"],
        total_annotations=stats["total_annotations"],
        reviewed_images=stats["reviewed_images"],
        reviewed_annotations=stats["reviewed_annotations"],
        by_source=stats["by_source"],
        by_element_type=stats["by_element_type"],
        by_review_status=stats["by_review_status"],
        confidence_stats=ConfidenceStats(**stats["confidence_stats"]),
        by_category=stats["by_category"],  # type: ignore[arg-type]
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
    histogram_data = await DatasetLabelingService.get_confidence_histogram(
        db, dataset_id, buckets
    )
    return ConfidenceHistogramResponse(
        buckets=[ConfidenceHistogramBucket(**b) for b in histogram_data]
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
    try:
        content = await file.read()
        result = await DatasetProcessingService.import_from_zip(
            db=db,
            file_content=content,
            name=name,
            created_by_id=current_user.id,
            description=description,
        )
        return DatasetImportResponse(
            dataset_id=result["dataset_id"],
            images_imported=result["images_imported"],
            annotations_imported=result["annotations_imported"],
            warnings=result["warnings"],
            errors=result["errors"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
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
    dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        export_format = ExportFormat(request.format)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid export format: {request.format}"
        )

    job = await DatasetExportService.start_export(
        db=db,
        dataset=dataset,
        export_format=export_format,
        created_by_id=current_user.id,
        include_images=request.include_images,
        train_percent=request.split.train_percent if request.split else None,
        val_percent=request.split.val_percent if request.split else None,
        test_percent=request.split.test_percent if request.split else None,
        random_seed=request.split.random_seed if request.split else None,
        filters=request.filters.model_dump() if request.filters else None,
    )

    return DatasetExportJobResponse.model_validate(job)


@router.get("/{dataset_id}/export/{job_id}", response_model=DatasetExportJobResponse)
async def get_export_job(
    dataset_id: str,
    job_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_superuser_async),
) -> DatasetExportJobResponse:
    """Get export job status"""
    job = await TrainingDatasetRepository.get_export_job(db, dataset_id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    return DatasetExportJobResponse.model_validate(job)
