"""
Task Runs API endpoints.

This module provides REST API endpoints for unified task run management:
- Task Runs: Create, query, update, and delete task runs
- Sessions: Record and query Claude session data
- Findings: Sync, query, and update detected findings
- Automations: Track GUI automation executions

Used by:
- qontinui-runner: Syncing task data to web backend
- qontinui-web frontend: Viewing task history and findings

Migrated from ai_tasks.py - renamed for unified architecture.
"""

from datetime import date
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from qontinui_schemas.execution.verification_result import (
    VerificationResultResponse,
    VerificationResultsBatchRequest,
    VerificationResultsListResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.services.task_run import TaskRunVerificationService
from app.services.task_run_service import (
    StepProgressResponse,
    TaskRunAutomationCreate,
    TaskRunAutomationResponse,
    TaskRunAutomationUpdate,
    TaskRunCreate,
    TaskRunDetail,
    TaskRunFindingResponse,
    TaskRunFindingsBatch,
    TaskRunFindingsListResponse,
    TaskRunFindingUpdate,
    TaskRunListResponse,
    TaskRunResponse,
    TaskRunService,
    TaskRunSessionCreate,
    TaskRunSessionResponse,
    TaskRunSessionUpdate,
    TaskRunUpdate,
)

logger = structlog.get_logger(__name__)
router = APIRouter()


# =============================================================================
# Service Factory Function
# =============================================================================


def get_task_run_service() -> TaskRunService:
    """Get TaskRunService instance."""
    return TaskRunService()


def get_verification_service() -> TaskRunVerificationService:
    """Get TaskRunVerificationService instance."""
    return TaskRunVerificationService()


# =============================================================================
# Task Runs Endpoints
# =============================================================================


@router.post(
    "",
    response_model=TaskRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new task run",
    description="Create a new task run. Called by runner when starting a task.",
)
async def create_task_run(
    task_data: TaskRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunResponse:
    """Create a new task run."""
    return await service.create_task_run(db, task_data, current_user.id)


@router.get(
    "",
    response_model=TaskRunListResponse,
    summary="List task runs",
    description="List task runs with optional filtering by project, user, status, type, and date range.",
)
async def list_task_runs(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    status: str | None = Query(None, description="Filter by status"),
    task_type: str | None = Query(None, description="Filter by task type"),
    start_date: date | None = Query(None, description="Filter by start date (from)"),
    end_date: date | None = Query(None, description="Filter by end date (to)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=100, description="Pagination limit"),
) -> TaskRunListResponse:
    """List task runs for the current user."""
    return await service.list_task_runs(
        db,
        project_id=project_id,
        user_id=current_user.id,  # Filter to current user's tasks
        status=status,
        task_type=task_type,
        start_date=start_date,
        end_date=end_date,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/findings-summary",
    summary="Get findings summary across all runs",
    description="Get aggregated findings summary across all task runs for the current user.",
)
async def get_findings_summary(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> dict:
    """Get aggregated findings summary across all task runs."""
    return await service.get_findings_summary(db, current_user.id)


@router.get(
    "/{task_run_id}",
    response_model=TaskRunDetail,
    summary="Get task run detail",
    description="Get detailed task run information including sessions, findings, and automations.",
)
async def get_task_run_detail(
    task_run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunDetail:
    """Get task run detail with sessions, findings, and automations."""
    task_run = await service.get_task_run_detail(db, task_run_id)
    if not task_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    # Verify ownership
    if task_run.created_by_user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this task run",
        )
    return task_run


@router.put(
    "/{task_run_id}",
    response_model=TaskRunResponse,
    summary="Update task run",
    description="Update a task run's status, output, or other fields.",
)
async def update_task_run(
    task_run_id: UUID,
    update_data: TaskRunUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunResponse:
    """Update a task run."""
    # First check if task exists and user has access
    existing = await service.get_task_run(db, task_run_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    if existing.created_by_user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this task run",
        )

    result = await service.update_task_run(db, task_run_id, update_data)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    return result


@router.delete(
    "/{task_run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete task run",
    description="Delete a task run and all associated data.",
)
async def delete_task_run(
    task_run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> None:
    """Delete a task run."""
    # First check if task exists and user has access
    existing = await service.get_task_run(db, task_run_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    if existing.created_by_user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this task run",
        )

    deleted = await service.delete_task_run(db, task_run_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )


# =============================================================================
# Sessions Endpoints
# =============================================================================


@router.post(
    "/{task_run_id}/sessions",
    response_model=TaskRunSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record session start",
    description="Record the start of a Claude session within a task run.",
)
async def create_session(
    task_run_id: UUID,
    session_data: TaskRunSessionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunSessionResponse:
    """Record a session start."""
    result = await service.create_session(db, task_run_id, session_data)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    return result


@router.put(
    "/{task_run_id}/sessions/{session_number}",
    response_model=TaskRunSessionResponse,
    summary="Record session end",
    description="Record the end of a Claude session with duration and output summary.",
)
async def update_session(
    task_run_id: UUID,
    session_number: int,
    update_data: TaskRunSessionUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunSessionResponse:
    """Record a session end."""
    result = await service.update_session(db, task_run_id, session_number, update_data)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_number} for task run {task_run_id} not found",
        )
    return result


@router.get(
    "/{task_run_id}/sessions",
    response_model=list[TaskRunSessionResponse],
    summary="List sessions for task run",
    description="Get all sessions for a task run.",
)
async def get_sessions(
    task_run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> list[TaskRunSessionResponse]:
    """Get all sessions for a task run."""
    return await service.get_sessions(db, task_run_id)


# =============================================================================
# Findings Endpoints
# =============================================================================


@router.post(
    "/{task_run_id}/findings",
    response_model=list[TaskRunFindingResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Sync findings",
    description="Sync a batch of findings. Creates new or updates existing based on signature_hash.",
)
async def sync_findings(
    task_run_id: UUID,
    batch: TaskRunFindingsBatch,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> list[TaskRunFindingResponse]:
    """Sync findings for a task run."""
    return await service.sync_findings(db, task_run_id, batch)


@router.get(
    "/{task_run_id}/findings",
    response_model=TaskRunFindingsListResponse,
    summary="List findings for task run",
    description="Get all findings for a task run with optional filtering.",
)
async def get_findings(
    task_run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
    category: str | None = Query(None, description="Filter by category"),
    severity: str | None = Query(None, description="Filter by severity"),
    status: str | None = Query(None, description="Filter by status"),
) -> TaskRunFindingsListResponse:
    """Get findings for a task run."""
    return await service.get_findings(
        db,
        task_run_id,
        category=category,
        severity=severity,
        status=status,
    )


@router.put(
    "/{task_run_id}/findings/{finding_id}",
    response_model=TaskRunFindingResponse,
    summary="Update finding",
    description="Update a finding's status, resolution, or other fields.",
)
async def update_finding(
    task_run_id: UUID,
    finding_id: UUID,
    update_data: TaskRunFindingUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunFindingResponse:
    """Update a finding."""
    result = await service.update_finding(db, task_run_id, finding_id, update_data)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding {finding_id} not found in task run {task_run_id}",
        )
    return result


class FindingResponseSubmit(BaseModel):
    """Request to submit a user response to a finding."""

    response: str


@router.post(
    "/{task_run_id}/findings/{finding_id}/response",
    response_model=TaskRunFindingResponse,
    summary="Submit finding response",
    description="Submit a user response to a finding that needs input.",
)
async def submit_finding_response(
    task_run_id: UUID,
    finding_id: UUID,
    body: FindingResponseSubmit,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunFindingResponse:
    """Submit a user response to a finding."""
    result = await service.submit_finding_response(
        db, task_run_id, finding_id, body.response
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Finding {finding_id} not found in task run {task_run_id}",
        )
    return result


# =============================================================================
# Automations Endpoints
# =============================================================================


@router.post(
    "/{task_run_id}/automations",
    response_model=TaskRunAutomationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create automation record",
    description="Record the start of a GUI automation execution within a task run.",
)
async def create_automation(
    task_run_id: UUID,
    automation_data: TaskRunAutomationCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunAutomationResponse:
    """Create an automation record."""
    result = await service.create_automation(db, task_run_id, automation_data)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    return result


@router.put(
    "/{task_run_id}/automations/{automation_id}",
    response_model=TaskRunAutomationResponse,
    summary="Update automation record",
    description="Update an automation record with completion status and metrics.",
)
async def update_automation(
    task_run_id: UUID,
    automation_id: UUID,
    update_data: TaskRunAutomationUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> TaskRunAutomationResponse:
    """Update an automation record."""
    result = await service.update_automation(
        db, task_run_id, automation_id, update_data
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Automation {automation_id} not found in task run {task_run_id}",
        )
    return result


@router.get(
    "/{task_run_id}/automations",
    response_model=list[TaskRunAutomationResponse],
    summary="List automations for task run",
    description="Get all automation records for a task run.",
)
async def get_automations(
    task_run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> list[TaskRunAutomationResponse]:
    """Get all automation records for a task run."""
    return await service.get_automations(db, task_run_id)


# =============================================================================
# Step Progress Endpoints
# =============================================================================


@router.get(
    "/{task_run_id}/steps/{checkpoint_id}/progress",
    response_model=StepProgressResponse,
    summary="Get step execution progress",
    description="Get real-time progress information for a specific execution step.",
)
async def get_step_progress(
    task_run_id: UUID,
    checkpoint_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunService = Depends(get_task_run_service),
) -> StepProgressResponse:
    """
    Get real-time progress for a specific execution step.

    Returns progress information including:
    - Current phase (e.g., "image_matching", "action_execution")
    - Phase description
    - Substep information
    - Progress percentage (if available)
    - Elapsed time
    - Error information (if failed)

    Used by the frontend to display progress indicators during step execution.
    """
    result = await service.get_step_progress(db, task_run_id, checkpoint_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Step progress not found for task run {task_run_id}, checkpoint {checkpoint_id}",
        )
    return result


# =============================================================================
# Verification Results Endpoints
# =============================================================================


@router.post(
    "/{task_run_id}/verification-results",
    response_model=list[VerificationResultResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Batch upsert verification results",
    description="Batch upsert verification phase results. Called by runner after each verification phase.",
)
async def upsert_verification_results(
    task_run_id: UUID,
    batch: VerificationResultsBatchRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunVerificationService = Depends(get_verification_service),
) -> list[VerificationResultResponse]:
    """Batch upsert verification results for a task run."""
    # Verify task exists and user has access
    task_run_service = get_task_run_service()
    existing = await task_run_service.get_task_run(db, task_run_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    if existing.created_by_user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this task run",
        )
    return await service.batch_upsert_verification_results(db, task_run_id, batch)


@router.get(
    "/{task_run_id}/verification-results",
    response_model=VerificationResultsListResponse,
    summary="List verification results",
    description="Get all verification phase results for a task run.",
)
async def list_verification_results(
    task_run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: TaskRunVerificationService = Depends(get_verification_service),
) -> VerificationResultsListResponse:
    """List verification results for a task run."""
    task_run_service = get_task_run_service()
    existing = await task_run_service.get_task_run(db, task_run_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task run {task_run_id} not found",
        )
    if existing.created_by_user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this task run",
        )
    return await service.list_verification_results(db, task_run_id)
