"""Repository for training dataset export job operations.

Handles creation and retrieval of dataset export jobs.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training_dataset import (
    ExportFormat,
    ExportJobStatus,
    TrainingDatasetExportJob,
)


class ExportJobRepository:
    """Repository for dataset export job operations."""

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
