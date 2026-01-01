"""
Repository for training dataset database operations.

Handles query logic for datasets, images, and annotations, encapsulating
database access and providing reusable methods for CRUD, filtering,
and aggregating dataset data.
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import String, and_, cast, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import ColumnElement

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

logger = structlog.get_logger(__name__)


class TrainingDatasetRepository:
    """Repository for training dataset database operations."""

    # ========================================================================
    # Dataset CRUD
    # ========================================================================

    @staticmethod
    async def list_datasets(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 100,
    ) -> list[TrainingDataset]:
        """List all training datasets with pagination."""
        result = await db.execute(
            select(TrainingDataset)
            .order_by(TrainingDataset.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> TrainingDataset | None:
        """Get a dataset by ID."""
        result = await db.execute(
            select(TrainingDataset).where(TrainingDataset.id == dataset_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def create(
        db: AsyncSession,
        name: str,
        created_by_id: UUID,
        description: str | None = None,
        source: DatasetSource = DatasetSource.MANUAL_UPLOAD,
    ) -> TrainingDataset:
        """Create a new dataset."""
        dataset = TrainingDataset(
            name=name,
            description=description,
            source=source,
            created_by_id=created_by_id,
        )
        db.add(dataset)
        await db.commit()
        await db.refresh(dataset)
        return dataset

    @staticmethod
    async def update(
        db: AsyncSession,
        dataset: TrainingDataset,
        name: str | None = None,
        description: str | None = None,
    ) -> TrainingDataset:
        """Update a dataset."""
        if name is not None:
            dataset.name = name  # type: ignore[assignment]
        if description is not None:
            dataset.description = description  # type: ignore[assignment]
        await db.commit()
        await db.refresh(dataset)
        return dataset

    @staticmethod
    async def delete(
        db: AsyncSession,
        dataset: TrainingDataset,
    ) -> None:
        """Delete a dataset."""
        await db.delete(dataset)
        await db.commit()

    # ========================================================================
    # Dataset Statistics
    # ========================================================================

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

    # ========================================================================
    # Image Operations
    # ========================================================================

    @staticmethod
    async def list_images(
        db: AsyncSession,
        dataset_id: str | UUID,
        page: int = 1,
        page_size: int = 50,
        review_status: list[str] | None = None,
        search: str | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> tuple[list[TrainingDatasetImage], int]:
        """List images with filtering and pagination."""
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
        images = list(result.scalars().all())

        return images, total

    @staticmethod
    async def get_annotation_counts_for_images(
        db: AsyncSession,
        image_ids: list[Any],
    ) -> dict[str, int]:
        """Get annotation counts for a list of images."""
        result = await db.execute(
            select(
                TrainingDatasetAnnotation.image_id,
                func.count().label("count"),
            )
            .where(TrainingDatasetAnnotation.image_id.in_(image_ids))
            .group_by(TrainingDatasetAnnotation.image_id)
        )
        return {str(row.image_id): row.count for row in result}  # type: ignore[misc]

    @staticmethod
    async def get_image_by_hash(
        db: AsyncSession,
        dataset_id: str | UUID,
        image_hash: str,
    ) -> TrainingDatasetImage | None:
        """Get an image by its hash within a dataset."""
        result = await db.execute(
            select(TrainingDatasetImage).where(
                and_(
                    TrainingDatasetImage.dataset_id == dataset_id,
                    TrainingDatasetImage.image_hash == image_hash,
                )
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_image_by_id(
        db: AsyncSession,
        dataset_id: str | UUID,
        image_id: str | UUID,
    ) -> TrainingDatasetImage | None:
        """Get an image by ID within a dataset."""
        result = await db.execute(
            select(TrainingDatasetImage).where(
                and_(
                    TrainingDatasetImage.dataset_id == dataset_id,
                    TrainingDatasetImage.id == image_id,
                )
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_all_images(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> list[TrainingDatasetImage]:
        """Get all images for a dataset."""
        result = await db.execute(
            select(TrainingDatasetImage).where(
                TrainingDatasetImage.dataset_id == dataset_id
            )
        )
        return list(result.scalars().all())

    # ========================================================================
    # Annotation Operations
    # ========================================================================

    @staticmethod
    async def list_annotations_for_image(
        db: AsyncSession,
        dataset_id: str | UUID,
        image_id: str | UUID,
    ) -> list[TrainingDatasetAnnotation]:
        """Get all annotations for a specific image."""
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
        return list(result.scalars().all())

    @staticmethod
    async def list_annotations(
        db: AsyncSession,
        dataset_id: str | UUID,
        page: int = 1,
        page_size: int = 50,
        source: list[str] | None = None,
        element_type: list[str] | None = None,
        confidence_min: float | None = None,
        confidence_max: float | None = None,
        review_status: list[str] | None = None,
        verified: bool | None = None,
        category_name: list[str] | None = None,
        search: str | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> tuple[list[TrainingDatasetAnnotation], int]:
        """List annotations with filtering and pagination."""
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
                ElementType(t)
                for t in element_type
                if t in [e.value for e in ElementType]
            ]
            if type_enums:
                query = query.where(
                    TrainingDatasetAnnotation.element_type.in_(type_enums)
                )

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
            query = query.where(
                TrainingDatasetAnnotation.category_name.in_(category_name)
            )

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
        annotations = list(result.scalars().all())

        return annotations, total

    @staticmethod
    async def get_annotation_by_id(
        db: AsyncSession,
        dataset_id: str | UUID,
        annotation_id: str | UUID,
    ) -> TrainingDatasetAnnotation | None:
        """Get an annotation by ID within a dataset."""
        result = await db.execute(
            select(TrainingDatasetAnnotation).where(
                and_(
                    TrainingDatasetAnnotation.dataset_id == dataset_id,
                    TrainingDatasetAnnotation.id == annotation_id,
                )
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def delete_annotation(
        db: AsyncSession,
        annotation: TrainingDatasetAnnotation,
    ) -> None:
        """Delete an annotation."""
        await db.delete(annotation)
        await db.commit()

    @staticmethod
    async def get_all_annotations(
        db: AsyncSession,
        dataset_id: str | UUID,
    ) -> list[TrainingDatasetAnnotation]:
        """Get all annotations for a dataset."""
        result = await db.execute(
            select(TrainingDatasetAnnotation).where(
                TrainingDatasetAnnotation.dataset_id == dataset_id
            )
        )
        return list(result.scalars().all())

    # ========================================================================
    # Export Job Operations
    # ========================================================================

    @staticmethod
    async def create_export_job(
        db: AsyncSession,
        dataset_id: UUID,
        export_format: ExportFormat,
        created_by_id: UUID,
        include_images: bool = True,
        train_percent: float | None = None,
        val_percent: float | None = None,
        test_percent: float | None = None,
        random_seed: int | None = None,
        filters: dict[str, Any] | None = None,
    ) -> TrainingDatasetExportJob:
        """Create an export job."""
        job = TrainingDatasetExportJob(
            dataset_id=dataset_id,
            format=export_format,
            include_images=include_images,
            train_percent=train_percent,
            val_percent=val_percent,
            test_percent=test_percent,
            random_seed=random_seed,
            filters=filters,
            status=ExportJobStatus.PENDING,
            created_by_id=created_by_id,
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        return job

    @staticmethod
    async def get_export_job(
        db: AsyncSession,
        dataset_id: str | UUID,
        job_id: str | UUID,
    ) -> TrainingDatasetExportJob | None:
        """Get an export job by ID."""
        result = await db.execute(
            select(TrainingDatasetExportJob).where(
                and_(
                    TrainingDatasetExportJob.dataset_id == dataset_id,
                    TrainingDatasetExportJob.id == job_id,
                )
            )
        )
        return result.scalar_one_or_none()


# Singleton instance for convenience
training_dataset_repository = TrainingDatasetRepository()
