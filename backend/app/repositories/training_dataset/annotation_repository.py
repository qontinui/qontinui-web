"""Repository for training dataset annotation query operations.

Handles annotation retrieval, filtering, pagination, and deletion.
"""

from typing import Any
from uuid import UUID

from app.models.training_dataset import (
    AnnotationSource,
    ElementType,
    ReviewStatus,
    TrainingDatasetAnnotation,
)
from sqlalchemy import String, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import ColumnElement


class AnnotationRepository:
    """Repository for dataset annotation operations."""

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
