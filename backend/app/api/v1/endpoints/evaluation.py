"""
Evaluation Dataset and Experiment API endpoints.

This module provides REST API endpoints for the evaluation system,
supporting dataset management (CRUD + items) and experiment tracking
(create, status updates, results, summaries) for the Opik integration.

Endpoints:
- POST /evaluation/datasets — create dataset
- GET /evaluation/datasets — list datasets (paginated)
- GET /evaluation/datasets/{dataset_id} — get single dataset
- DELETE /evaluation/datasets/{dataset_id} — delete dataset
- POST /evaluation/datasets/{dataset_id}/items — add items
- GET /evaluation/datasets/{dataset_id}/items — list items (paginated)
- DELETE /evaluation/datasets/items/{item_id} — delete item
- POST /evaluation/experiments — create experiment
- GET /evaluation/experiments — list experiments (optional dataset_id filter)
- GET /evaluation/experiments/{experiment_id} — get experiment with summary
- PATCH /evaluation/experiments/{experiment_id}/status — update status
- POST /evaluation/experiments/{experiment_id}/results — add result
- GET /evaluation/experiments/{experiment_id}/results — list results (paginated)
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.repositories.evaluation import EvaluationRepository
from fastapi import APIRouter, Depends, HTTPException, Query, status
from qontinui_schemas.api.evaluation import (
    DatasetItemCreate,
    DatasetItemListResponse,
    DatasetItemResponse,
    EvaluationDatasetCreate,
    EvaluationDatasetListResponse,
    EvaluationDatasetResponse,
    EvaluationExperimentCreate,
    EvaluationExperimentListResponse,
    EvaluationExperimentResponse,
    ExperimentResultCreate,
    ExperimentResultListResponse,
    ExperimentResultResponse,
    ExperimentStatusUpdate,
    ExperimentSummary,
)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


# =============================================================================
# Helpers
# =============================================================================


def _dataset_to_response(dataset, item_count: int = 0) -> EvaluationDatasetResponse:
    """Convert an EvaluationDataset model to a response schema."""
    return EvaluationDatasetResponse(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        version=dataset.version,
        item_count=item_count,
        content_hash=dataset.content_hash,
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
    )


def _item_to_response(item) -> DatasetItemResponse:
    """Convert a DatasetItem model to a response schema."""
    return DatasetItemResponse(
        id=item.id,
        dataset_id=item.dataset_id,
        input=item.input,
        expected_output=item.expected_output,
        metadata=item.metadata_,
        content_hash=item.content_hash,
        created_at=item.created_at,
    )


def _experiment_to_response(
    experiment, item_count: int = 0, completed_count: int = 0
) -> EvaluationExperimentResponse:
    """Convert an EvaluationExperiment model to a response schema."""
    return EvaluationExperimentResponse(
        id=experiment.id,
        name=experiment.name,
        dataset_id=experiment.dataset_id,
        dataset_version=experiment.dataset_version,
        prompt_variant_id=experiment.prompt_variant_id,
        description=experiment.description,
        status=experiment.status,
        metrics=experiment.metrics,
        item_count=item_count,
        completed_count=completed_count,
        created_at=experiment.created_at,
        completed_at=experiment.completed_at,
    )


def _result_to_response(result) -> ExperimentResultResponse:
    """Convert an ExperimentResult model to a response schema."""
    return ExperimentResultResponse(
        id=result.id,
        experiment_id=result.experiment_id,
        dataset_item_id=result.dataset_item_id,
        output=result.output,
        scores=result.scores,
        duration_ms=result.duration_ms,
        cost_usd=result.cost_usd,
        tokens_total=result.tokens_total,
        created_at=result.created_at,
    )


# =============================================================================
# Dataset Endpoints
# =============================================================================


@router.post(
    "/datasets",
    response_model=EvaluationDatasetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an evaluation dataset",
    description="Create a new evaluation dataset for storing test cases.",
)
async def create_dataset(
    dataset_data: EvaluationDatasetCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationDatasetResponse:
    """Create a new evaluation dataset."""
    data = {
        "name": dataset_data.name,
        "description": dataset_data.description,
    }

    dataset = await EvaluationRepository.create_dataset(db, data)

    logger.info(
        "Created evaluation dataset",
        dataset_id=str(dataset.id),
        name=dataset.name,
        user_id=str(current_user.id),
    )

    return _dataset_to_response(dataset, item_count=0)


@router.get(
    "/datasets",
    response_model=EvaluationDatasetListResponse,
    summary="List evaluation datasets",
    description="List all evaluation datasets with pagination.",
)
async def list_datasets(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=200, description="Max records to return"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationDatasetListResponse:
    """List evaluation datasets."""
    datasets, total = await EvaluationRepository.list_datasets(db, skip, limit)

    # Batch count items for all datasets in a single query
    dataset_ids = [dataset.id for dataset in datasets]
    item_counts = await EvaluationRepository.count_items_by_dataset_ids(db, dataset_ids)

    items = [
        _dataset_to_response(dataset, item_count=item_counts.get(dataset.id, 0))
        for dataset in datasets
    ]

    return EvaluationDatasetListResponse(items=items, total=total)


@router.get(
    "/datasets/{dataset_id}",
    response_model=EvaluationDatasetResponse,
    summary="Get an evaluation dataset",
    description="Get a single evaluation dataset by ID.",
)
async def get_dataset(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationDatasetResponse:
    """Get a single evaluation dataset."""
    dataset = await EvaluationRepository.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation dataset {dataset_id} not found",
        )

    item_count = await EvaluationRepository.count_items(db, dataset_id)

    return _dataset_to_response(dataset, item_count=item_count)


@router.delete(
    "/datasets/{dataset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an evaluation dataset",
    description="Delete an evaluation dataset and all its items.",
)
async def delete_dataset(
    dataset_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Delete an evaluation dataset."""
    deleted = await EvaluationRepository.delete_dataset(db, dataset_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation dataset {dataset_id} not found",
        )

    logger.info(
        "Deleted evaluation dataset",
        dataset_id=str(dataset_id),
        user_id=str(current_user.id),
    )


# =============================================================================
# Dataset Item Endpoints
# =============================================================================


@router.post(
    "/datasets/{dataset_id}/items",
    response_model=list[DatasetItemResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Add items to a dataset",
    description="Add one or more items to an evaluation dataset.",
)
async def add_dataset_items(
    dataset_id: UUID,
    items_data: list[DatasetItemCreate],
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> list[DatasetItemResponse]:
    """Add items to an evaluation dataset."""
    # Verify dataset exists
    dataset = await EvaluationRepository.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation dataset {dataset_id} not found",
        )

    # Convert schemas to dicts for repository
    items_dicts = [
        {
            "input": item.input,
            "expected_output": item.expected_output,
            "metadata_": item.metadata,
        }
        for item in items_data
    ]

    created_items = await EvaluationRepository.add_items(db, dataset_id, items_dicts)

    logger.info(
        "Added items to evaluation dataset",
        dataset_id=str(dataset_id),
        count=len(created_items),
        user_id=str(current_user.id),
    )

    return [_item_to_response(item) for item in created_items]


@router.get(
    "/datasets/{dataset_id}/items",
    response_model=DatasetItemListResponse,
    summary="List dataset items",
    description="List items in an evaluation dataset with pagination.",
)
async def list_dataset_items(
    dataset_id: UUID,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=200, description="Max records to return"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DatasetItemListResponse:
    """List items in an evaluation dataset."""
    # Verify dataset exists
    dataset = await EvaluationRepository.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation dataset {dataset_id} not found",
        )

    items, total = await EvaluationRepository.get_items(db, dataset_id, skip, limit)

    return DatasetItemListResponse(
        items=[_item_to_response(item) for item in items],
        total=total,
    )


@router.delete(
    "/datasets/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a dataset item",
    description="Delete a single item from an evaluation dataset.",
)
async def delete_dataset_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Delete a dataset item."""
    deleted = await EvaluationRepository.delete_item(db, item_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset item {item_id} not found",
        )

    logger.info(
        "Deleted dataset item",
        item_id=str(item_id),
        user_id=str(current_user.id),
    )


# =============================================================================
# Experiment Endpoints
# =============================================================================


@router.post(
    "/experiments",
    response_model=EvaluationExperimentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an evaluation experiment",
    description="Create a new evaluation experiment against a dataset.",
)
async def create_experiment(
    experiment_data: EvaluationExperimentCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationExperimentResponse:
    """Create a new evaluation experiment."""
    # Verify dataset exists and get current version
    dataset = await EvaluationRepository.get_dataset(db, experiment_data.dataset_id)
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation dataset {experiment_data.dataset_id} not found",
        )

    data = {
        "name": experiment_data.name,
        "dataset_id": experiment_data.dataset_id,
        "dataset_version": (
            experiment_data.dataset_version
            if experiment_data.dataset_version is not None
            else dataset.version
        ),
        "prompt_variant_id": experiment_data.prompt_variant_id,
        "description": experiment_data.description,
    }

    experiment = await EvaluationRepository.create_experiment(db, data)

    # Get item count from the dataset
    item_count = await EvaluationRepository.count_items(db, experiment.dataset_id)

    logger.info(
        "Created evaluation experiment",
        experiment_id=str(experiment.id),
        name=experiment.name,
        dataset_id=str(experiment.dataset_id),
        user_id=str(current_user.id),
    )

    return _experiment_to_response(experiment, item_count=item_count, completed_count=0)


@router.get(
    "/experiments",
    response_model=EvaluationExperimentListResponse,
    summary="List evaluation experiments",
    description="List evaluation experiments with optional dataset_id filter.",
)
async def list_experiments(
    dataset_id: UUID | None = Query(
        None, description="Optional dataset ID to filter by"
    ),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=200, description="Max records to return"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationExperimentListResponse:
    """List evaluation experiments."""
    experiments, total = await EvaluationRepository.list_experiments(
        db, dataset_id, skip, limit
    )

    # Batch count items and results in two queries instead of 2N
    exp_dataset_ids = list({exp.dataset_id for exp in experiments})
    exp_ids = [exp.id for exp in experiments]
    item_counts = await EvaluationRepository.count_items_by_dataset_ids(
        db, exp_dataset_ids
    )
    result_counts = await EvaluationRepository.count_results_by_experiment_ids(
        db, exp_ids
    )

    items = [
        _experiment_to_response(
            experiment,
            item_count=item_counts.get(experiment.dataset_id, 0),
            completed_count=result_counts.get(experiment.id, 0),
        )
        for experiment in experiments
    ]

    return EvaluationExperimentListResponse(items=items, total=total)


@router.get(
    "/experiments/{experiment_id}",
    response_model=EvaluationExperimentResponse,
    summary="Get an evaluation experiment",
    description="Get a single evaluation experiment by ID, including summary.",
)
async def get_experiment(
    experiment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationExperimentResponse:
    """Get a single evaluation experiment with summary."""
    experiment = await EvaluationRepository.get_experiment(db, experiment_id)
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation experiment {experiment_id} not found",
        )

    # Get item count and completed result count with dedicated count queries
    item_count = await EvaluationRepository.count_items(db, experiment.dataset_id)
    completed_count = await EvaluationRepository.count_results(db, experiment.id)

    return _experiment_to_response(
        experiment,
        item_count=item_count,
        completed_count=completed_count,
    )


@router.patch(
    "/experiments/{experiment_id}/status",
    response_model=EvaluationExperimentResponse,
    summary="Update experiment status",
    description="Update the status of an evaluation experiment.",
)
async def update_experiment_status(
    experiment_id: UUID,
    status_data: ExperimentStatusUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> EvaluationExperimentResponse:
    """Update the status of an evaluation experiment."""
    experiment = await EvaluationRepository.update_experiment_status(
        db,
        experiment_id,
        status_data.status,
        metrics=status_data.metrics,
    )
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation experiment {experiment_id} not found",
        )

    # Get item count and completed result count with dedicated count queries
    item_count = await EvaluationRepository.count_items(db, experiment.dataset_id)
    completed_count = await EvaluationRepository.count_results(db, experiment.id)

    logger.info(
        "Updated experiment status",
        experiment_id=str(experiment_id),
        status=status_data.status,
        user_id=str(current_user.id),
    )

    return _experiment_to_response(
        experiment,
        item_count=item_count,
        completed_count=completed_count,
    )


# =============================================================================
# Experiment Result Endpoints
# =============================================================================


@router.post(
    "/experiments/{experiment_id}/results",
    response_model=ExperimentResultResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add an experiment result",
    description="Add a result for a dataset item within an experiment.",
)
async def add_experiment_result(
    experiment_id: UUID,
    result_data: ExperimentResultCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExperimentResultResponse:
    """Add a result to an evaluation experiment."""
    # Verify experiment exists
    experiment = await EvaluationRepository.get_experiment(db, experiment_id)
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation experiment {experiment_id} not found",
        )

    # Ensure the experiment_id in the path matches the body
    if result_data.experiment_id != experiment_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="experiment_id in body must match the path parameter",
        )

    data = {
        "experiment_id": result_data.experiment_id,
        "dataset_item_id": result_data.dataset_item_id,
        "output": result_data.output,
        "scores": result_data.scores,
        "duration_ms": result_data.duration_ms,
        "cost_usd": result_data.cost_usd,
        "tokens_total": result_data.tokens_total,
    }

    result_obj = await EvaluationRepository.add_result(db, data)

    logger.info(
        "Added experiment result",
        result_id=str(result_obj.id),
        experiment_id=str(experiment_id),
        user_id=str(current_user.id),
    )

    return _result_to_response(result_obj)


@router.get(
    "/experiments/{experiment_id}/results",
    response_model=ExperimentResultListResponse,
    summary="List experiment results",
    description="List results for an evaluation experiment with pagination.",
)
async def list_experiment_results(
    experiment_id: UUID,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=200, description="Max records to return"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExperimentResultListResponse:
    """List results for an evaluation experiment."""
    # Verify experiment exists
    experiment = await EvaluationRepository.get_experiment(db, experiment_id)
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation experiment {experiment_id} not found",
        )

    results, total = await EvaluationRepository.get_results(
        db, experiment_id, skip, limit
    )

    return ExperimentResultListResponse(
        items=[_result_to_response(r) for r in results],
        total=total,
    )


@router.get(
    "/experiments/{experiment_id}/summary",
    response_model=ExperimentSummary,
    summary="Get experiment summary",
    description="Get aggregated summary of scores, duration, and cost for an experiment.",
)
async def get_experiment_summary(
    experiment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExperimentSummary:
    """Get aggregated summary for an evaluation experiment."""
    # Verify experiment exists
    experiment = await EvaluationRepository.get_experiment(db, experiment_id)
    if experiment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation experiment {experiment_id} not found",
        )

    summary = await EvaluationRepository.get_experiment_summary(db, experiment_id)

    return ExperimentSummary(**summary)
