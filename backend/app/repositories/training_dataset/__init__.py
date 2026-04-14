"""Training dataset repository package.

Provides focused sub-repositories for training dataset operations,
split by domain concern: dataset CRUD, images, annotations, statistics,
and export jobs.

For backward compatibility, TrainingDatasetRepository is a facade that
re-exports all methods from the sub-repositories, so existing code using
``from app.repositories.training_dataset import TrainingDatasetRepository``
continues to work unchanged.
"""

from app.repositories.training_dataset.annotation_repository import \
    AnnotationRepository
from app.repositories.training_dataset.dataset_repository import \
    DatasetRepository
from app.repositories.training_dataset.export_job_repository import \
    ExportJobRepository
from app.repositories.training_dataset.image_repository import ImageRepository
from app.repositories.training_dataset.statistics_repository import \
    StatisticsRepository


class TrainingDatasetRepository(
    DatasetRepository,
    ImageRepository,
    AnnotationRepository,
    StatisticsRepository,
    ExportJobRepository,
):
    """Unified facade that combines all training dataset sub-repositories.

    Inherits all static methods from the focused sub-repositories so that
    callers can continue using ``TrainingDatasetRepository.method_name(...)``
    without changes.
    """


# Singleton instance for convenience
training_dataset_repository = TrainingDatasetRepository()

__all__ = [
    "AnnotationRepository",
    "DatasetRepository",
    "ExportJobRepository",
    "ImageRepository",
    "StatisticsRepository",
    "TrainingDatasetRepository",
    "training_dataset_repository",
]
