"""
Dataset labeling service for annotation and review workflow operations.

Handles annotation CRUD, review status updates, and bulk operations.
"""

from typing import Any
from uuid import UUID

import structlog
from app.models.training_dataset import (
    ElementType,
    ReviewStatus,
    TrainingDatasetAnnotation,
    TrainingDatasetImage,
)
from app.repositories.training_dataset import TrainingDatasetRepository
from app.schemas.training_dataset import DatasetAnnotationUpdate, DatasetImageUpdate
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class DatasetLabelingService:
    """Service for managing annotations and review workflow."""

    # ========================================================================
    # Image Review Operations
    # ========================================================================

    @staticmethod
    async def update_image_review(
        db: AsyncSession,
        image: TrainingDatasetImage,
        update_data: DatasetImageUpdate,
        reviewer_id: UUID,
    ) -> TrainingDatasetImage:
        """Update an image's review status."""
        if update_data.reviewed is not None:
            image.reviewed = update_data.reviewed  # type: ignore[assignment]
            if update_data.reviewed:
                image.reviewed_by_id = reviewer_id  # type: ignore[assignment]
                image.reviewed_at = utc_now()  # type: ignore[assignment]
            else:
                image.reviewed_by_id = None  # type: ignore[assignment]
                image.reviewed_at = None  # type: ignore[assignment]

        if update_data.reviewer_notes is not None:
            image.reviewer_notes = update_data.reviewer_notes  # type: ignore[assignment]

        await db.commit()
        await db.refresh(image)

        # Update dataset stats
        await TrainingDatasetRepository.update_stats(db, image.dataset_id)  # type: ignore[arg-type]
        await db.commit()

        return image

    # ========================================================================
    # Annotation Update Operations
    # ========================================================================

    @staticmethod
    async def update_annotation(
        db: AsyncSession,
        annotation: TrainingDatasetAnnotation,
        update_data: DatasetAnnotationUpdate,
        reviewer_id: UUID,
    ) -> TrainingDatasetAnnotation:
        """Update an annotation's properties."""
        # Update geometry
        if update_data.x is not None:
            annotation.x = update_data.x  # type: ignore[assignment]
        if update_data.y is not None:
            annotation.y = update_data.y  # type: ignore[assignment]
        if update_data.width is not None:
            annotation.width = update_data.width  # type: ignore[assignment]
        if update_data.height is not None:
            annotation.height = update_data.height  # type: ignore[assignment]

        # Update category
        if update_data.category_id is not None:
            annotation.category_id = update_data.category_id  # type: ignore[assignment]
        if update_data.category_name is not None:
            annotation.category_name = update_data.category_name  # type: ignore[assignment]

        # Update confidence
        if update_data.confidence is not None:
            annotation.confidence = update_data.confidence  # type: ignore[assignment]

        # Update element type
        if update_data.element_type is not None:
            annotation.element_type = ElementType(update_data.element_type)

        # Update verification
        if update_data.verified is not None:
            annotation.verified = update_data.verified  # type: ignore[assignment]

        # Update review status
        if update_data.review_status is not None:
            annotation.review_status = ReviewStatus(update_data.review_status)
            annotation.reviewed_by_id = reviewer_id  # type: ignore[assignment]
            annotation.reviewed_at = utc_now()  # type: ignore[assignment]

        # Update reviewer notes
        if update_data.reviewer_notes is not None:
            annotation.reviewer_notes = update_data.reviewer_notes  # type: ignore[assignment]

        await db.commit()
        await db.refresh(annotation)

        return annotation

    @staticmethod
    async def delete_annotation(
        db: AsyncSession,
        annotation: TrainingDatasetAnnotation,
    ) -> None:
        """Delete an annotation and update dataset stats."""
        dataset_id = annotation.dataset_id
        await TrainingDatasetRepository.delete_annotation(db, annotation)

        # Update dataset stats
        await TrainingDatasetRepository.update_stats(db, dataset_id)  # type: ignore[arg-type]
        await db.commit()

    # ========================================================================
    # Bulk Operations
    # ========================================================================

    @staticmethod
    async def bulk_update_annotations(
        db: AsyncSession,
        dataset_id: str,
        annotation_ids: list[str],
        update_data: DatasetAnnotationUpdate,
        reviewer_id: UUID,
    ) -> dict[str, Any]:
        """
        Bulk update annotations.

        Returns:
            Dictionary with updated_count, failed_count, and errors.
        """
        updated_count = 0
        failed_count = 0
        errors: list[dict[str, Any]] = []

        for annotation_id in annotation_ids:
            try:
                annotation = await TrainingDatasetRepository.get_annotation_by_id(
                    db, dataset_id, annotation_id
                )
                if not annotation:
                    errors.append(
                        {"annotation_id": annotation_id, "error": "Not found"}
                    )
                    failed_count += 1
                    continue

                # Apply updates
                if update_data.review_status is not None:
                    annotation.review_status = ReviewStatus(update_data.review_status)
                    annotation.reviewed_by_id = reviewer_id  # type: ignore[assignment]
                    annotation.reviewed_at = utc_now()  # type: ignore[assignment]
                if update_data.reviewer_notes is not None:
                    annotation.reviewer_notes = update_data.reviewer_notes  # type: ignore[assignment]
                if update_data.verified is not None:
                    annotation.verified = update_data.verified  # type: ignore[assignment]

                updated_count += 1

            except Exception as e:
                errors.append({"annotation_id": annotation_id, "error": str(e)})
                failed_count += 1

        await db.commit()

        return {
            "updated_count": updated_count,
            "failed_count": failed_count,
            "errors": errors,
        }

    # ========================================================================
    # Statistics Aggregation
    # ========================================================================

    @staticmethod
    async def get_dataset_statistics(
        db: AsyncSession,
        dataset_id: str,
    ) -> dict[str, Any]:
        """Get comprehensive statistics for a dataset."""
        # Get dataset for denormalized counts
        dataset = await TrainingDatasetRepository.get_by_id(db, dataset_id)
        if not dataset:
            raise ValueError("Dataset not found")

        total_images: int = dataset.total_images  # type: ignore[assignment]
        total_annotations: int = dataset.total_annotations  # type: ignore[assignment]
        reviewed_images: int = dataset.reviewed_count  # type: ignore[assignment]

        # Get additional statistics
        unique_images = await TrainingDatasetRepository.get_unique_image_count(
            db, dataset_id
        )
        reviewed_annotations = (
            await TrainingDatasetRepository.get_reviewed_annotations_count(
                db, dataset_id
            )
        )
        by_source = await TrainingDatasetRepository.get_annotations_by_source(
            db, dataset_id
        )
        by_element_type = (
            await TrainingDatasetRepository.get_annotations_by_element_type(
                db, dataset_id
            )
        )
        by_review_status = (
            await TrainingDatasetRepository.get_annotations_by_review_status(
                db, dataset_id
            )
        )
        confidence_stats = await TrainingDatasetRepository.get_confidence_stats(
            db, dataset_id, total_annotations
        )
        by_category = await TrainingDatasetRepository.get_annotations_by_category(
            db, dataset_id
        )

        return {
            "total_images": total_images,
            "unique_images": unique_images,
            "total_annotations": total_annotations,
            "reviewed_images": reviewed_images,
            "reviewed_annotations": reviewed_annotations,
            "by_source": by_source,
            "by_element_type": by_element_type,
            "by_review_status": by_review_status,
            "confidence_stats": confidence_stats,
            "by_category": by_category,
        }

    @staticmethod
    async def get_confidence_histogram(
        db: AsyncSession,
        dataset_id: str,
        buckets: int = 10,
    ) -> list[dict[str, Any]]:
        """Get confidence score histogram."""
        confidences = await TrainingDatasetRepository.get_confidence_values(
            db, dataset_id
        )

        if not confidences:
            return [
                {"min": i / buckets, "max": (i + 1) / buckets, "count": 0}
                for i in range(buckets)
            ]

        # Build histogram
        bucket_size = 1.0 / buckets
        histogram = [0] * buckets

        for conf in confidences:
            bucket_idx = min(int(conf / bucket_size), buckets - 1)
            histogram[bucket_idx] += 1

        return [
            {
                "min": i * bucket_size,
                "max": (i + 1) * bucket_size,
                "count": histogram[i],
            }
            for i in range(buckets)
        ]


# Singleton instance
dataset_labeling_service = DatasetLabelingService()
