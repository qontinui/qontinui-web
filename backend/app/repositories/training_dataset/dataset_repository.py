"""Repository for training dataset CRUD operations.

Handles creation, retrieval, update, and deletion of training datasets.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training_dataset import DatasetSource, TrainingDataset


class DatasetRepository:
    """Repository for dataset CRUD operations."""

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
