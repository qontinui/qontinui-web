"""Repository for training dataset statistics and aggregation operations.

Handles dataset statistics updates, annotation counts by various dimensions,
and confidence score analytics.
"""

from typing import Any
from uuid import UUID

from app.models.training_dataset import (
    ReviewStatus,
    TrainingDataset,
    TrainingDatasetAnnotation,
    TrainingDatasetImage,
)
from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession


class StatisticsRepository:
    """Repository for dataset statistics and aggregation operations."""

    @staticmethod
    async def update_stats(
        db: AsyncSession,
        dataset_id: UUID,
    ) -> None:
        """Update denormalized statistics for a dataset."""
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

    @staticmethod
    async def get_unique_image_count(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> int:
        """Get count of unique images by hash."""
        return (
            await db.scalar(
                select(func.count(distinct(TrainingDatasetImage.image_hash))).where(
                    TrainingDatasetImage.dataset_id == dataset_id
                )
            )
            or 0
        )

    @staticmethod
    async def get_reviewed_annotations_count(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> int:
        """Get count of reviewed annotations."""
        return (
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

    @staticmethod
    async def get_annotations_by_source(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> dict[str, int]:
        """Get annotation counts grouped by source."""
        result = await db.execute(
            select(
                TrainingDatasetAnnotation.source,
                func.count().label("count"),
            )
            .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
            .group_by(TrainingDatasetAnnotation.source)
        )
        return {row.source.value: row.count for row in result}  # type: ignore[misc]

    @staticmethod
    async def get_annotations_by_element_type(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> dict[str, int]:
        """Get annotation counts grouped by element type."""
        result = await db.execute(
            select(
                TrainingDatasetAnnotation.element_type,
                func.count().label("count"),
            )
            .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
            .group_by(TrainingDatasetAnnotation.element_type)
        )
        return {
            (row.element_type.value if row.element_type else "unknown"): row.count  # type: ignore[misc]
            for row in result
        }

    @staticmethod
    async def get_annotations_by_review_status(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> dict[str, int]:
        """Get annotation counts grouped by review status."""
        result = await db.execute(
            select(
                TrainingDatasetAnnotation.review_status,
                func.count().label("count"),
            )
            .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
            .group_by(TrainingDatasetAnnotation.review_status)
        )
        return {row.review_status.value: row.count for row in result}  # type: ignore[misc]

    @staticmethod
    async def get_confidence_stats(
        db: AsyncSession,
        dataset_id: str | UUID,
        total_annotations: int,
    ) -> dict[str, float]:
        """Get confidence statistics (min, max, mean, median)."""
        result = await db.execute(
            select(
                func.min(TrainingDatasetAnnotation.confidence).label("min"),
                func.max(TrainingDatasetAnnotation.confidence).label("max"),
                func.avg(TrainingDatasetAnnotation.confidence).label("mean"),
            ).where(TrainingDatasetAnnotation.dataset_id == dataset_id)
        )
        row = result.one_or_none()

        # Calculate median (approximation)
        median_result = await db.execute(
            select(TrainingDatasetAnnotation.confidence)
            .where(TrainingDatasetAnnotation.dataset_id == dataset_id)
            .order_by(TrainingDatasetAnnotation.confidence)
            .offset(total_annotations // 2)
            .limit(1)
        )
        median_row = median_result.scalar_one_or_none()

        return {
            "min": row.min if row and row.min is not None else 0.0,
            "max": row.max if row and row.max is not None else 1.0,
            "mean": float(row.mean) if row and row.mean is not None else 0.5,
            "median": median_row if median_row is not None else 0.5,
        }

    @staticmethod
    async def get_annotations_by_category(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> list[dict[str, Any]]:
        """Get annotation counts grouped by category."""
        result = await db.execute(
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
        return [
            {
                "category_id": row.category_id,
                "category_name": row.category_name,
                "count": row.count,
            }
            for row in result
        ]

    @staticmethod
    async def get_confidence_values(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> list[float]:
        """Get all confidence values for histogram generation."""
        result = await db.execute(
            select(TrainingDatasetAnnotation.confidence).where(
                TrainingDatasetAnnotation.dataset_id == dataset_id
            )
        )
        return [row[0] for row in result]
