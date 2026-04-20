"""Repository for training dataset image query operations.

Handles image retrieval, filtering, pagination, and annotation count lookups.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.expression import ColumnElement

from app.models.training_dataset import TrainingDatasetAnnotation, TrainingDatasetImage


class ImageRepository:
    """Repository for dataset image operations."""

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
