"""API endpoints for ML training job management."""

import uuid
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.models.annotation import AnnotationSet
from app.models.project import Project
from app.models.training_job import TrainingJob, TrainingJobStatus
from app.models.user import User
from app.schemas.training_job import (
    TrainingConfig,
    TrainingEstimate,
    TrainingJobCreate,
    TrainingJobListResponse,
    TrainingJobResponse,
    TrainingJobUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/jobs", response_model=TrainingJobResponse, status_code=status.HTTP_201_CREATED
)
async def create_training_job(
    data: TrainingJobCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """
    Create a new training job.

    This creates a job with status "pending" that can later be started
    to begin the actual training process.
    """
    logger.info(
        "create_training_job",
        user_id=str(current_user.id),
        project_id=data.project_id,
        annotation_set_id=data.annotation_set_id,
    )

    # Validate project exists and user has access
    try:
        project_uuid = uuid.UUID(data.project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project ID format",
        )

    result = await db.execute(select(Project).where(Project.id == project_uuid))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check user has access to project
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Validate annotation set if provided
    annotation_set_uuid = None
    if data.annotation_set_id:
        try:
            annotation_set_uuid = uuid.UUID(data.annotation_set_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid annotation set ID format",
            )

        result = await db.execute(
            select(AnnotationSet).where(AnnotationSet.id == annotation_set_uuid)
        )
        annotation_set = result.scalar_one_or_none()

        if not annotation_set:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation set not found",
            )

    # Create training job
    training_job = TrainingJob(
        id=uuid.uuid4(),
        project_id=project_uuid,
        user_id=current_user.id,
        annotation_set_id=annotation_set_uuid,
        name=data.name,
        description=data.description,
        model_type=data.config.model_type.value,
        config=data.config.model_dump(),
        status=TrainingJobStatus.PENDING.value,
        progress=0,
        total_epochs=data.config.epochs,
    )

    db.add(training_job)
    await db.commit()
    await db.refresh(training_job)

    logger.info(
        "training_job_created",
        job_id=str(training_job.id),
        project_id=data.project_id,
        model_type=data.config.model_type.value,
    )

    return training_job


@router.get("/jobs", response_model=TrainingJobListResponse)
async def list_training_jobs(
    project_id: str | None = Query(None, description="Filter by project ID"),
    status_filter: str | None = Query(
        None, alias="status", description="Filter by status"
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """
    List training jobs for the current user.

    Optionally filter by project_id and/or status.
    """
    # Build base query - only show jobs for the current user (or all for superuser)
    query = select(TrainingJob)

    if not current_user.is_superuser:
        query = query.where(TrainingJob.user_id == current_user.id)

    # Apply filters
    if project_id:
        try:
            project_uuid = uuid.UUID(project_id)
            query = query.where(TrainingJob.project_id == project_uuid)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid project ID format",
            )

    if status_filter:
        query = query.where(TrainingJob.status == status_filter)

    # Count total before pagination
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Apply ordering and pagination
    query = query.order_by(desc(TrainingJob.created_at))
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    jobs = list(result.scalars().all())

    return TrainingJobListResponse(
        jobs=[TrainingJobResponse.model_validate(job) for job in jobs],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/jobs/{job_id}", response_model=TrainingJobResponse)
async def get_training_job(
    job_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Get details of a specific training job including status, progress, and logs."""
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid job ID format",
        )

    result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training job not found",
        )

    # Check access
    if job.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    return job


@router.post("/jobs/{job_id}/start", response_model=TrainingJobResponse)
async def start_training_job(
    job_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """
    Start/queue a pending training job.

    In a real implementation, this would trigger the ML training pipeline.
    For now, it just updates the status to "queued".
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid job ID format",
        )

    result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training job not found",
        )

    # Check access
    if job.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Can only start pending jobs
    if job.status != TrainingJobStatus.PENDING.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot start job with status '{job.status}'. Only pending jobs can be started.",
        )

    # Update status to queued
    job.status = TrainingJobStatus.QUEUED.value  # type: ignore[assignment]
    job.started_at = datetime.utcnow()  # type: ignore[assignment]

    await db.commit()
    await db.refresh(job)

    logger.info(
        "training_job_queued",
        job_id=str(job.id),
        user_id=str(current_user.id),
    )

    # TODO: In a real implementation, trigger the actual training pipeline here
    # This could be:
    # - Sending a message to a job queue (Redis, RabbitMQ, etc.)
    # - Calling an external ML service API
    # - Spawning a background task

    return job


@router.patch("/jobs/{job_id}", response_model=TrainingJobResponse)
async def update_training_job(
    job_id: str,
    data: TrainingJobUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """
    Update a training job (e.g., progress, logs, status).

    This endpoint is typically called by the training pipeline to report progress.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid job ID format",
        )

    result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training job not found",
        )

    # Check access
    if job.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Apply updates
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "status" and value:
            value = value.value if hasattr(value, "value") else value
            # Update completed_at timestamp if completing
            if value in [
                TrainingJobStatus.COMPLETED.value,
                TrainingJobStatus.FAILED.value,
            ]:
                job.completed_at = datetime.utcnow()  # type: ignore[assignment]
        setattr(job, field, value)

    await db.commit()
    await db.refresh(job)

    return job


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_training_job(
    job_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> None:
    """
    Cancel and delete a training job.

    Running jobs will be cancelled before deletion.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid job ID format",
        )

    result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training job not found",
        )

    # Check access
    if job.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # TODO: If job is running, cancel it in the training pipeline first

    await db.delete(job)
    await db.commit()

    logger.info(
        "training_job_deleted",
        job_id=job_id,
        user_id=str(current_user.id),
    )


@router.post("/jobs/{job_id}/cancel", response_model=TrainingJobResponse)
async def cancel_training_job(
    job_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """Cancel a running or queued training job."""
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid job ID format",
        )

    result = await db.execute(select(TrainingJob).where(TrainingJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Training job not found",
        )

    # Check access
    if job.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )

    # Can only cancel pending, queued, or running jobs
    cancellable_statuses = [
        TrainingJobStatus.PENDING.value,
        TrainingJobStatus.QUEUED.value,
        TrainingJobStatus.RUNNING.value,
    ]
    if job.status not in cancellable_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel job with status '{job.status}'",
        )

    # Update status
    job.status = TrainingJobStatus.CANCELLED.value  # type: ignore[assignment]
    job.completed_at = datetime.utcnow()  # type: ignore[assignment]

    await db.commit()
    await db.refresh(job)

    logger.info(
        "training_job_cancelled",
        job_id=str(job.id),
        user_id=str(current_user.id),
    )

    # TODO: If job is running in the pipeline, send cancellation signal

    return job


@router.post("/estimate", response_model=TrainingEstimate)
async def estimate_training(
    config: TrainingConfig,
    annotation_count: int = Query(100, ge=1, description="Number of annotations"),
    current_user: User = Depends(deps.current_active_user),
) -> Any:
    """
    Get an estimate for training time and cost based on configuration.

    This is a rough estimate based on typical training benchmarks.
    """
    # Base time estimates (minutes per 100 annotations per epoch)
    base_time_per_epoch = {
        "detection": 2.0,
        "classification": 0.5,
        "segmentation": 3.0,
    }

    model_type = config.model_type.value
    base_time = base_time_per_epoch.get(model_type, 2.0)

    # Calculate estimated time
    # Scale by number of annotations
    annotation_factor = annotation_count / 100.0

    # Scale by batch size (smaller batches = more iterations = more time)
    batch_factor = 16.0 / config.batch_size

    # Augmentation adds ~30% time
    augmentation_factor = 1.3 if config.augmentation else 1.0

    estimated_minutes = int(
        base_time
        * config.epochs
        * annotation_factor
        * batch_factor
        * augmentation_factor
    )

    # Minimum 5 minutes
    estimated_minutes = max(5, estimated_minutes)

    # Cost estimate (assuming T4 GPU at ~$0.35/hour)
    gpu_cost_per_hour = 0.35
    estimated_cost = (estimated_minutes / 60.0) * gpu_cost_per_hour

    notes = None
    if estimated_minutes > 60:
        notes = (
            "Long training job. Consider using a more powerful GPU for faster results."
        )
    elif annotation_count < 50:
        notes = "Low annotation count. Consider adding more training data for better results."

    return TrainingEstimate(
        estimated_time_minutes=estimated_minutes,
        estimated_cost_usd=round(estimated_cost, 2),
        gpu_type="T4",
        notes=notes,
    )
