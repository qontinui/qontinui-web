"""
Repository for evaluation dataset and experiment database operations.

Handles query logic for evaluation datasets, dataset items, experiments,
and experiment results — encapsulating database access and providing
reusable methods for CRUD, listing, and aggregation.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_dataset import DatasetItem, EvaluationDataset
from app.models.evaluation_experiment import (
    EvaluationExperiment,
    ExperimentResult,
)

logger = structlog.get_logger(__name__)


def _compute_content_hash(input_data: dict) -> str:
    """Compute SHA256 hash of JSON-serialized input data."""
    serialized = json.dumps(input_data, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()


def _compute_dataset_hash(items_hashes: list[str]) -> str:
    """Compute aggregate hash from sorted item hashes."""
    combined = "".join(sorted(items_hashes))
    return hashlib.sha256(combined.encode()).hexdigest()


class EvaluationRepository:
    """Repository for evaluation dataset and experiment database operations."""

    # =========================================================================
    # Dataset Operations
    # =========================================================================

    @staticmethod
    async def create_dataset(
        db: AsyncSession,
        data: dict,
    ) -> EvaluationDataset:
        """
        Create a new evaluation dataset.

        Args:
            db: Database session
            data: Dictionary with dataset fields (name, description)

        Returns:
            Created EvaluationDataset instance
        """
        dataset = EvaluationDataset(**data)
        db.add(dataset)
        await db.commit()
        await db.refresh(dataset)

        logger.info(
            "evaluation_dataset_created",
            dataset_id=str(dataset.id),
            name=dataset.name,
        )

        return dataset

    @staticmethod
    async def get_dataset(
        db: AsyncSession,
        dataset_id: UUID,
    ) -> EvaluationDataset | None:
        """
        Get an evaluation dataset by ID.

        Args:
            db: Database session
            dataset_id: ID of the dataset

        Returns:
            EvaluationDataset or None if not found
        """
        query = select(EvaluationDataset).where(EvaluationDataset.id == dataset_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_datasets(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[EvaluationDataset], int]:
        """
        List evaluation datasets with pagination.

        Args:
            db: Database session
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            Tuple of (list of EvaluationDataset, total count)
        """
        query = select(EvaluationDataset)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by creation time, apply pagination
        query = query.order_by(EvaluationDataset.created_at.desc())
        query = query.offset(skip).limit(limit)

        result = await db.execute(query)
        datasets = list(result.scalars().all())

        logger.debug(
            "list_datasets_executed",
            total=total,
            skip=skip,
            limit=limit,
        )

        return datasets, total

    @staticmethod
    async def delete_dataset(
        db: AsyncSession,
        dataset_id: UUID,
    ) -> bool:
        """
        Delete an evaluation dataset by ID.

        Also deletes all associated dataset items.

        Args:
            db: Database session
            dataset_id: ID of the dataset to delete

        Returns:
            True if deleted, False if not found
        """
        dataset = await EvaluationRepository.get_dataset(db, dataset_id)
        if dataset is None:
            return False

        await db.delete(dataset)
        await db.commit()

        logger.info(
            "evaluation_dataset_deleted",
            dataset_id=str(dataset_id),
        )

        return True

    # =========================================================================
    # Dataset Item Operations
    # =========================================================================

    @staticmethod
    async def add_items(
        db: AsyncSession,
        dataset_id: UUID,
        items: list[dict],
    ) -> list[DatasetItem]:
        """
        Add items to an evaluation dataset.

        Computes content_hash for each item (SHA256 of JSON-serialized input),
        increments the dataset version, and updates the dataset content_hash.

        Args:
            db: Database session
            dataset_id: ID of the parent dataset
            items: List of dicts with input, expected_output, metadata_ fields

        Returns:
            List of created DatasetItem instances
        """
        created_items = []

        for item_data in items:
            content_hash = _compute_content_hash(item_data["input"])
            item = DatasetItem(
                dataset_id=dataset_id,
                input=item_data["input"],
                expected_output=item_data.get("expected_output"),
                metadata_=item_data.get("metadata_"),
                content_hash=content_hash,
            )
            db.add(item)
            created_items.append(item)

        # Flush to assign IDs
        await db.flush()

        # Get all item hashes for the dataset to compute aggregate hash
        hash_query = select(DatasetItem.content_hash).where(
            DatasetItem.dataset_id == dataset_id
        )
        hash_result = await db.execute(hash_query)
        all_hashes = [row[0] for row in hash_result.all()]

        dataset_hash = _compute_dataset_hash(all_hashes)

        # Increment version and update content_hash
        await db.execute(
            update(EvaluationDataset)
            .where(EvaluationDataset.id == dataset_id)
            .values(
                version=EvaluationDataset.version + 1,
                content_hash=dataset_hash,
                updated_at=datetime.now(timezone.utc),
            )
        )

        await db.commit()

        # Refresh all items to get server-generated fields
        for item in created_items:
            await db.refresh(item)

        logger.info(
            "dataset_items_added",
            dataset_id=str(dataset_id),
            count=len(created_items),
        )

        return created_items

    @staticmethod
    async def get_items(
        db: AsyncSession,
        dataset_id: UUID,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[DatasetItem], int]:
        """
        List items in a dataset with pagination.

        Args:
            db: Database session
            dataset_id: ID of the parent dataset
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            Tuple of (list of DatasetItem, total count)
        """
        query = select(DatasetItem).where(DatasetItem.dataset_id == dataset_id)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by creation time, apply pagination
        query = query.order_by(DatasetItem.created_at.desc())
        query = query.offset(skip).limit(limit)

        result = await db.execute(query)
        items = list(result.scalars().all())

        logger.debug(
            "get_items_executed",
            dataset_id=str(dataset_id),
            total=total,
        )

        return items, total

    @staticmethod
    async def delete_item(
        db: AsyncSession,
        item_id: UUID,
    ) -> bool:
        """
        Delete a dataset item by ID.

        Args:
            db: Database session
            item_id: ID of the item to delete

        Returns:
            True if deleted, False if not found
        """
        query = select(DatasetItem).where(DatasetItem.id == item_id)
        result = await db.execute(query)
        item = result.scalar_one_or_none()

        if item is None:
            return False

        dataset_id = item.dataset_id
        await db.delete(item)

        # Update dataset version and hash after item removal
        await db.flush()

        hash_query = select(DatasetItem.content_hash).where(
            DatasetItem.dataset_id == dataset_id
        )
        hash_result = await db.execute(hash_query)
        all_hashes = [row[0] for row in hash_result.all()]

        dataset_hash = _compute_dataset_hash(all_hashes) if all_hashes else None

        await db.execute(
            update(EvaluationDataset)
            .where(EvaluationDataset.id == dataset_id)
            .values(
                version=EvaluationDataset.version + 1,
                content_hash=dataset_hash,
                updated_at=datetime.now(timezone.utc),
            )
        )

        await db.commit()

        logger.info(
            "dataset_item_deleted",
            item_id=str(item_id),
            dataset_id=str(dataset_id),
        )

        return True

    # =========================================================================
    # Experiment Operations
    # =========================================================================

    @staticmethod
    async def create_experiment(
        db: AsyncSession,
        data: dict,
    ) -> EvaluationExperiment:
        """
        Create a new evaluation experiment.

        Args:
            db: Database session
            data: Dictionary with experiment fields

        Returns:
            Created EvaluationExperiment instance
        """
        experiment = EvaluationExperiment(**data)
        db.add(experiment)
        await db.commit()
        await db.refresh(experiment)

        logger.info(
            "evaluation_experiment_created",
            experiment_id=str(experiment.id),
            name=experiment.name,
            dataset_id=str(experiment.dataset_id),
        )

        return experiment

    @staticmethod
    async def get_experiment(
        db: AsyncSession,
        experiment_id: UUID,
    ) -> EvaluationExperiment | None:
        """
        Get an evaluation experiment by ID.

        Args:
            db: Database session
            experiment_id: ID of the experiment

        Returns:
            EvaluationExperiment or None if not found
        """
        query = select(EvaluationExperiment).where(
            EvaluationExperiment.id == experiment_id
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_experiments(
        db: AsyncSession,
        dataset_id: UUID | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[EvaluationExperiment], int]:
        """
        List evaluation experiments with optional dataset_id filter.

        Args:
            db: Database session
            dataset_id: Optional dataset ID to filter by
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            Tuple of (list of EvaluationExperiment, total count)
        """
        query = select(EvaluationExperiment)

        if dataset_id is not None:
            query = query.where(EvaluationExperiment.dataset_id == dataset_id)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by creation time, apply pagination
        query = query.order_by(EvaluationExperiment.created_at.desc())
        query = query.offset(skip).limit(limit)

        result = await db.execute(query)
        experiments = list(result.scalars().all())

        logger.debug(
            "list_experiments_executed",
            dataset_id=str(dataset_id) if dataset_id else None,
            total=total,
            skip=skip,
            limit=limit,
        )

        return experiments, total

    @staticmethod
    async def update_experiment_status(
        db: AsyncSession,
        experiment_id: UUID,
        status: str,
        metrics: dict[str, Any] | None = None,
    ) -> EvaluationExperiment | None:
        """
        Update an experiment's status and optionally its metrics.

        Args:
            db: Database session
            experiment_id: ID of the experiment
            status: New status value
            metrics: Optional aggregate metrics to set

        Returns:
            Updated EvaluationExperiment or None if not found
        """
        experiment = await EvaluationRepository.get_experiment(db, experiment_id)
        if experiment is None:
            return None

        values: dict[str, Any] = {"status": status}
        if metrics is not None:
            values["metrics"] = metrics
        if status in ("completed", "failed"):
            values["completed_at"] = datetime.now(timezone.utc)

        await db.execute(
            update(EvaluationExperiment)
            .where(EvaluationExperiment.id == experiment_id)
            .values(**values)
        )
        await db.commit()
        await db.refresh(experiment)

        logger.info(
            "evaluation_experiment_status_updated",
            experiment_id=str(experiment_id),
            status=status,
        )

        return experiment

    # =========================================================================
    # Experiment Result Operations
    # =========================================================================

    @staticmethod
    async def add_result(
        db: AsyncSession,
        data: dict,
    ) -> ExperimentResult:
        """
        Add a result to an experiment.

        Args:
            db: Database session
            data: Dictionary with result fields

        Returns:
            Created ExperimentResult instance
        """
        result_obj = ExperimentResult(**data)
        db.add(result_obj)
        await db.commit()
        await db.refresh(result_obj)

        logger.info(
            "experiment_result_added",
            result_id=str(result_obj.id),
            experiment_id=str(result_obj.experiment_id),
        )

        return result_obj

    @staticmethod
    async def get_results(
        db: AsyncSession,
        experiment_id: UUID,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[ExperimentResult], int]:
        """
        List results for an experiment with pagination.

        Args:
            db: Database session
            experiment_id: ID of the parent experiment
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            Tuple of (list of ExperimentResult, total count)
        """
        query = select(ExperimentResult).where(
            ExperimentResult.experiment_id == experiment_id
        )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by creation time, apply pagination
        query = query.order_by(ExperimentResult.created_at.desc())
        query = query.offset(skip).limit(limit)

        result = await db.execute(query)
        results = list(result.scalars().all())

        logger.debug(
            "get_results_executed",
            experiment_id=str(experiment_id),
            total=total,
        )

        return results, total

    @staticmethod
    async def get_experiment_summary(
        db: AsyncSession,
        experiment_id: UUID,
    ) -> dict:
        """
        Get aggregated summary of experiment results.

        Computes total results, average duration, total cost, total tokens,
        and average scores across all results for the experiment.

        Args:
            db: Database session
            experiment_id: ID of the experiment

        Returns:
            Dict with total_results, avg_duration_ms, total_cost_usd,
            total_tokens, avg_scores
        """
        # Aggregate numeric fields
        agg_query = select(
            func.count().label("total_results"),
            func.avg(ExperimentResult.duration_ms).label("avg_duration_ms"),
            func.sum(ExperimentResult.cost_usd).label("total_cost_usd"),
            func.sum(ExperimentResult.tokens_total).label("total_tokens"),
        ).where(ExperimentResult.experiment_id == experiment_id)

        agg_result = await db.execute(agg_query)
        row = agg_result.one()

        total_results = row.total_results or 0
        avg_duration_ms = (
            round(float(row.avg_duration_ms), 2)
            if row.avg_duration_ms is not None
            else None
        )
        total_cost_usd = (
            round(float(row.total_cost_usd), 6)
            if row.total_cost_usd is not None
            else None
        )
        total_tokens = int(row.total_tokens) if row.total_tokens is not None else None

        # Compute average scores across all results that have scores
        avg_scores: dict[str, float] | None = None
        if total_results > 0:
            scores_query = select(ExperimentResult.scores).where(
                ExperimentResult.experiment_id == experiment_id,
                ExperimentResult.scores.isnot(None),
            )
            scores_result = await db.execute(scores_query)
            all_scores = [row[0] for row in scores_result.all() if row[0]]

            if all_scores:
                score_sums: dict[str, float] = {}
                score_counts: dict[str, int] = {}
                for scores_dict in all_scores:
                    for key, value in scores_dict.items():
                        if not isinstance(value, (int, float)):
                            continue
                        score_sums[key] = score_sums.get(key, 0.0) + float(value)
                        score_counts[key] = score_counts.get(key, 0) + 1

                avg_scores = {
                    key: round(score_sums[key] / score_counts[key], 4)
                    for key in sorted(score_sums.keys())
                }

        summary = {
            "total_results": total_results,
            "avg_duration_ms": avg_duration_ms,
            "total_cost_usd": total_cost_usd,
            "total_tokens": total_tokens,
            "avg_scores": avg_scores,
        }

        logger.debug(
            "get_experiment_summary_executed",
            experiment_id=str(experiment_id),
            total_results=total_results,
        )

        return summary
