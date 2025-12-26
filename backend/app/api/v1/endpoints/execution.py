"""
Unified Execution API endpoints.

This module provides REST API endpoints for the unified execution system:
- Execution Runs: Create, query, complete, and cancel execution runs
- Action Executions: Report and query action execution data
- Screenshots: Upload and query execution screenshots
- Issues: Report and manage execution issues
- Analytics: Execution trends and reliability statistics

Used by:
- qontinui-runner: Reporting execution data
- qontinui-web frontend: Viewing execution history and analytics
"""

import io
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from PIL import Image

# Import schemas from qontinui-schemas
from qontinui_schemas.api.execution import (
    ActionExecutionBatch,
    ActionExecutionBatchResponse,
    ActionExecutionListResponse,
    ActionExecutionResponse,
    ActionReliabilityStats,
    ActionStatus,
    ActionType,
    ExecutionIssueBatch,
    ExecutionIssueBatchResponse,
    ExecutionIssueDetail,
    ExecutionIssueListResponse,
    ExecutionIssueResponse,
    ExecutionIssueUpdate,
    ExecutionRunComplete,
    ExecutionRunCompleteResponse,
    ExecutionRunCreate,
    ExecutionRunDetail,
    ExecutionRunListResponse,
    ExecutionRunResponse,
    ExecutionScreenshotResponse,
    ExecutionStats,
    ExecutionTrendDataPoint,
    ExecutionTrendResponse,
    ExecutionWorkflowMetadata,
    IssueSeverity,
    IssueSource,
    IssueStatus,
    IssueType,
    Pagination,
    RunnerMetadata,
    RunStatus,
    RunType,
    ScreenshotType,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_active_user, get_async_db
from app.models.action_execution import (
    ActionExecution,
    ActionExecutionStatus,
    ActionExecutionType,
)
from app.models.execution_issue import (
    ExecutionIssue,
    ExecutionIssueSeverity,
    ExecutionIssueSource,
    ExecutionIssueStatus,
    ExecutionIssueType,
)
from app.models.execution_run import ExecutionRun, ExecutionRunStatus, ExecutionRunType
from app.models.execution_screenshot import ExecutionScreenshot, ExecutionScreenshotType
from app.models.user import User
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)
router = APIRouter()


# =============================================================================
# Helper Functions
# =============================================================================


def _map_run_type_to_model(run_type: RunType) -> ExecutionRunType:
    """Map schema RunType to model ExecutionRunType."""
    mapping = {
        RunType.QA_TEST: ExecutionRunType.QA_TEST,
        RunType.INTEGRATION_TEST: ExecutionRunType.INTEGRATION_TEST,
        RunType.LIVE_AUTOMATION: ExecutionRunType.LIVE_AUTOMATION,
        RunType.RECORDING: ExecutionRunType.RECORDING,
        RunType.DEBUG: ExecutionRunType.DEBUG,
    }
    return mapping.get(run_type, ExecutionRunType.LIVE_AUTOMATION)


def _map_run_status_to_model(run_status: RunStatus) -> ExecutionRunStatus:
    """Map schema RunStatus to model ExecutionRunStatus."""
    mapping = {
        RunStatus.PENDING: ExecutionRunStatus.PENDING,
        RunStatus.RUNNING: ExecutionRunStatus.RUNNING,
        RunStatus.COMPLETED: ExecutionRunStatus.COMPLETED,
        RunStatus.FAILED: ExecutionRunStatus.FAILED,
        RunStatus.TIMEOUT: ExecutionRunStatus.TIMEOUT,
        RunStatus.CANCELLED: ExecutionRunStatus.CANCELLED,
        RunStatus.PAUSED: ExecutionRunStatus.PAUSED,
    }
    return mapping.get(run_status, ExecutionRunStatus.RUNNING)


def _map_action_type_to_model(action_type: ActionType) -> ActionExecutionType:
    """Map schema ActionType to model ActionExecutionType."""
    mapping = {
        ActionType.FIND: ActionExecutionType.FIND,
        ActionType.CLICK: ActionExecutionType.CLICK,
        ActionType.DOUBLE_CLICK: ActionExecutionType.DOUBLE_CLICK,
        ActionType.RIGHT_CLICK: ActionExecutionType.RIGHT_CLICK,
        ActionType.TYPE: ActionExecutionType.TYPE,
        ActionType.KEY_PRESS: ActionExecutionType.KEY_PRESS,
        ActionType.SCROLL: ActionExecutionType.SCROLL,
        ActionType.DRAG: ActionExecutionType.DRAG,
        ActionType.WAIT: ActionExecutionType.WAIT,
        ActionType.GO_TO_STATE: ActionExecutionType.GO_TO_STATE,
        ActionType.CUSTOM: ActionExecutionType.CUSTOM,
    }
    return mapping.get(action_type, ActionExecutionType.CUSTOM)


def _map_action_status_to_model(action_status: ActionStatus) -> ActionExecutionStatus:
    """Map schema ActionStatus to model ActionExecutionStatus."""
    mapping = {
        ActionStatus.SUCCESS: ActionExecutionStatus.SUCCESS,
        ActionStatus.FAILED: ActionExecutionStatus.FAILED,
        ActionStatus.TIMEOUT: ActionExecutionStatus.TIMEOUT,
        ActionStatus.SKIPPED: ActionExecutionStatus.SKIPPED,
        ActionStatus.ERROR: ActionExecutionStatus.ERROR,
        ActionStatus.PENDING: ActionExecutionStatus.PENDING,
    }
    return mapping.get(action_status, ActionExecutionStatus.PENDING)


def _map_screenshot_type_to_model(
    screenshot_type: ScreenshotType,
) -> ExecutionScreenshotType:
    """Map schema ScreenshotType to model ExecutionScreenshotType."""
    mapping = {
        ScreenshotType.BEFORE_ACTION: ExecutionScreenshotType.BEFORE_ACTION,
        ScreenshotType.AFTER_ACTION: ExecutionScreenshotType.AFTER_ACTION,
        ScreenshotType.ON_ERROR: ExecutionScreenshotType.ON_ERROR,
        ScreenshotType.ON_SUCCESS: ExecutionScreenshotType.ON_SUCCESS,
        ScreenshotType.STATE_VERIFICATION: ExecutionScreenshotType.STATE_CAPTURE,
        ScreenshotType.MANUAL: ExecutionScreenshotType.MANUAL,
    }
    return mapping.get(screenshot_type, ExecutionScreenshotType.MANUAL)


def _map_issue_type_to_model(issue_type: IssueType) -> ExecutionIssueType:
    """Map schema IssueType to model ExecutionIssueType."""
    mapping = {
        IssueType.VISUAL: ExecutionIssueType.VISUAL_REGRESSION,
        IssueType.ELEMENT_NOT_FOUND: ExecutionIssueType.ELEMENT_NOT_FOUND,
        IssueType.STATE_MISMATCH: ExecutionIssueType.STATE_MISMATCH,
        IssueType.TIMEOUT: ExecutionIssueType.TIMEOUT,
        IssueType.ASSERTION: ExecutionIssueType.ASSERTION_FAILED,
        IssueType.CRASH: ExecutionIssueType.SCRIPT_ERROR,
        IssueType.PERFORMANCE: ExecutionIssueType.PERFORMANCE,
        IssueType.OTHER: ExecutionIssueType.OTHER,
    }
    return mapping.get(issue_type, ExecutionIssueType.OTHER)


def _map_issue_severity_to_model(severity: IssueSeverity) -> ExecutionIssueSeverity:
    """Map schema IssueSeverity to model ExecutionIssueSeverity."""
    mapping = {
        IssueSeverity.CRITICAL: ExecutionIssueSeverity.CRITICAL,
        IssueSeverity.HIGH: ExecutionIssueSeverity.HIGH,
        IssueSeverity.MEDIUM: ExecutionIssueSeverity.MEDIUM,
        IssueSeverity.LOW: ExecutionIssueSeverity.LOW,
        IssueSeverity.INFO: ExecutionIssueSeverity.INFO,
    }
    return mapping.get(severity, ExecutionIssueSeverity.MEDIUM)


def _map_issue_source_to_model(source: IssueSource) -> ExecutionIssueSource:
    """Map schema IssueSource to model ExecutionIssueSource."""
    mapping = {
        IssueSource.AUTOMATION: ExecutionIssueSource.AUTOMATION,
        IssueSource.AI_ANALYSIS: ExecutionIssueSource.AI_ANALYSIS,
        IssueSource.VISUAL_REGRESSION: ExecutionIssueSource.VISUAL_REGRESSION,
        IssueSource.USER_REPORTED: ExecutionIssueSource.USER_REPORTED,
    }
    return mapping.get(source, ExecutionIssueSource.AUTOMATION)


def _model_to_run_response(run: ExecutionRun) -> ExecutionRunResponse:
    """Convert ExecutionRun model to ExecutionRunResponse schema."""
    return ExecutionRunResponse(
        id=run.id,
        project_id=run.project_id,
        run_type=RunType(
            run.run_type.value if hasattr(run.run_type, "value") else run.run_type
        ),
        run_name=run.run_name,
        status=RunStatus(
            run.status.value if hasattr(run.status, "value") else run.status
        ),
        started_at=run.started_at,
        ended_at=run.ended_at,
        duration_seconds=run.duration_seconds,
        runner_metadata=(
            RunnerMetadata(**run.runner_metadata)
            if run.runner_metadata
            else RunnerMetadata(
                runner_version="unknown", os="unknown", hostname="unknown"
            )
        ),
        workflow_metadata=(
            ExecutionWorkflowMetadata(**run.workflow_metadata)
            if run.workflow_metadata
            else None
        ),
        created_at=run.created_at,
    )


def _model_to_action_response(action: ActionExecution) -> ActionExecutionResponse:
    """Convert ActionExecution model to ActionExecutionResponse schema."""
    return ActionExecutionResponse(
        id=action.id,
        run_id=action.run_id,
        sequence_number=action.sequence_number,
        action_type=ActionType(
            action.action_type.value
            if hasattr(action.action_type, "value")
            else action.action_type
        ),
        action_name=action.action_name,
        status=ActionStatus(
            action.status.value if hasattr(action.status, "value") else action.status
        ),
        started_at=action.started_at,
        completed_at=action.completed_at,
        duration_ms=action.duration_ms,
        from_state=action.from_state,
        to_state=action.to_state,
        error_message=action.error_message,
    )


def _model_to_screenshot_response(
    screenshot: ExecutionScreenshot,
) -> ExecutionScreenshotResponse:
    """Convert ExecutionScreenshot model to ExecutionScreenshotResponse schema."""
    return ExecutionScreenshotResponse(
        id=screenshot.id,
        run_id=screenshot.run_id,
        sequence_number=screenshot.sequence_number,
        screenshot_type=ScreenshotType(
            screenshot.screenshot_type.value
            if hasattr(screenshot.screenshot_type, "value")
            else screenshot.screenshot_type
        ),
        image_url=screenshot.image_url,
        thumbnail_url=screenshot.thumbnail_url,
        state_name=screenshot.state_name,
        captured_at=screenshot.captured_at,
        file_size_bytes=screenshot.file_size_bytes,
        visual_comparison=None,
    )


def _model_to_issue_response(issue: ExecutionIssue) -> ExecutionIssueResponse:
    """Convert ExecutionIssue model to ExecutionIssueResponse schema."""
    screenshot_ids = (
        issue.screenshot_ids if isinstance(issue.screenshot_ids, list) else []
    )
    return ExecutionIssueResponse(
        id=issue.id,
        run_id=issue.run_id,
        issue_type=IssueType(
            issue.issue_type.value
            if hasattr(issue.issue_type, "value")
            else issue.issue_type
        ),
        severity=IssueSeverity(
            issue.severity.value if hasattr(issue.severity, "value") else issue.severity
        ),
        status=IssueStatus(
            issue.status.value if hasattr(issue.status, "value") else issue.status
        ),
        source=IssueSource(
            issue.source.value if hasattr(issue.source, "value") else issue.source
        ),
        title=issue.title,
        description=issue.description,
        state_name=issue.state_name,
        screenshot_count=len(screenshot_ids),
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


# =============================================================================
# Execution Runs Endpoints
# =============================================================================


@router.post(
    "/runs",
    response_model=ExecutionRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new execution run",
    description="Create a new execution run. Called by runner at the start of execution.",
)
async def create_run(
    run_data: ExecutionRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionRunResponse:
    """Create a new execution run."""
    now = datetime.utcnow()

    # Create the execution run model
    run = ExecutionRun(
        project_id=run_data.project_id,
        created_by_user_id=current_user.id,
        run_type=_map_run_type_to_model(run_data.run_type),
        run_name=run_data.run_name,
        description=run_data.description,
        status=ExecutionRunStatus.RUNNING,
        started_at=now,
        runner_metadata=run_data.runner_metadata.model_dump(),
        workflow_metadata=(
            run_data.workflow_metadata.model_dump()
            if run_data.workflow_metadata
            else None
        ),
        configuration=run_data.configuration or {},
        max_duration_seconds=run_data.max_duration_seconds,
    )

    db.add(run)
    await db.commit()
    await db.refresh(run)

    logger.info(
        "Created execution run",
        run_id=str(run.id),
        run_name=run_data.run_name,
        run_type=run_data.run_type.value,
        project_id=str(run_data.project_id),
        user_id=str(current_user.id),
    )

    return _model_to_run_response(run)


@router.get(
    "/runs",
    response_model=ExecutionRunListResponse,
    summary="List execution runs",
    description="List execution runs with optional filtering by project, type, status, and date range.",
)
async def list_runs(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    run_type: RunType | None = Query(None, description="Filter by run type"),
    status_filter: RunStatus | None = Query(
        None, alias="status", description="Filter by status"
    ),
    start_date: date | None = Query(None, description="Filter by start date (from)"),
    end_date: date | None = Query(None, description="Filter by start date (to)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=100, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionRunListResponse:
    """List execution runs with filtering."""
    # Build query
    query = select(ExecutionRun)

    # Apply filters
    if project_id:
        query = query.where(ExecutionRun.project_id == project_id)
    if run_type:
        query = query.where(ExecutionRun.run_type == _map_run_type_to_model(run_type))
    if status_filter:
        query = query.where(
            ExecutionRun.status == _map_run_status_to_model(status_filter)
        )
    if start_date:
        query = query.where(func.date(ExecutionRun.started_at) >= start_date)
    if end_date:
        query = query.where(func.date(ExecutionRun.started_at) <= end_date)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply ordering and pagination
    query = query.order_by(ExecutionRun.started_at.desc()).offset(offset).limit(limit)

    # Execute query
    result = await db.execute(query)
    runs = result.scalars().all()

    logger.info(
        "Listed execution runs",
        total=total,
        returned=len(runs),
        user_id=str(current_user.id),
    )

    return ExecutionRunListResponse(
        runs=[_model_to_run_response(r) for r in runs],
        pagination=Pagination(
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + limit < total,
        ),
    )


@router.get(
    "/runs/{run_id}",
    response_model=ExecutionRunDetail,
    summary="Get execution run details",
    description="Get detailed information about a specific execution run.",
)
async def get_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionRunDetail:
    """Get detailed execution run information."""
    # Get run with related data
    query = (
        select(ExecutionRun)
        .where(ExecutionRun.id == run_id)
        .options(
            selectinload(ExecutionRun.action_executions),
            selectinload(ExecutionRun.screenshots),
            selectinload(ExecutionRun.issues),
        )
    )
    result = await db.execute(query)
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Calculate stats from actions
    actions = run.action_executions
    screenshots = run.screenshots
    issues = run.issues

    stats = ExecutionStats(
        total_actions=len(actions),
        successful_actions=sum(
            1 for a in actions if a.status == ActionExecutionStatus.SUCCESS
        ),
        failed_actions=sum(
            1 for a in actions if a.status == ActionExecutionStatus.FAILED
        ),
        skipped_actions=sum(
            1 for a in actions if a.status == ActionExecutionStatus.SKIPPED
        ),
        timeout_actions=sum(
            1 for a in actions if a.status == ActionExecutionStatus.TIMEOUT
        ),
        total_screenshots=len(screenshots),
        total_issues=len(issues),
        unique_states_visited=len({a.from_state for a in actions if a.from_state}),
        unique_actions_executed=len({a.action_type for a in actions}),
    )

    return ExecutionRunDetail(
        id=run.id,
        project_id=run.project_id,
        run_type=RunType(
            run.run_type.value if hasattr(run.run_type, "value") else run.run_type
        ),
        run_name=run.run_name,
        status=RunStatus(
            run.status.value if hasattr(run.status, "value") else run.status
        ),
        started_at=run.started_at,
        ended_at=run.ended_at,
        duration_seconds=run.duration_seconds,
        runner_metadata=(
            RunnerMetadata(**run.runner_metadata)
            if run.runner_metadata
            else RunnerMetadata(
                runner_version="unknown", os="unknown", hostname="unknown"
            )
        ),
        workflow_metadata=(
            ExecutionWorkflowMetadata(**run.workflow_metadata)
            if run.workflow_metadata
            else None
        ),
        created_at=run.created_at,
        description=run.description,
        configuration=run.configuration or {},
        stats=stats,
        coverage=run.coverage_data,
        updated_at=run.updated_at,
    )


@router.put(
    "/runs/{run_id}/complete",
    response_model=ExecutionRunCompleteResponse,
    summary="Complete an execution run",
    description="Mark an execution run as completed with final status and statistics.",
)
async def complete_run(
    run_id: UUID,
    complete_data: ExecutionRunComplete,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionRunCompleteResponse:
    """Complete an execution run."""
    # Get run
    query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    result = await db.execute(query)
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Calculate duration
    duration_seconds = int((complete_data.ended_at - run.started_at).total_seconds())

    # Update run
    run.status = _map_run_status_to_model(complete_data.status)
    run.ended_at = complete_data.ended_at
    run.duration_seconds = duration_seconds
    run.stats = complete_data.stats.model_dump()
    run.coverage_data = (
        complete_data.coverage.model_dump() if complete_data.coverage else None
    )
    run.error_message = complete_data.error_message
    run.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(run)

    logger.info(
        "Completed execution run",
        run_id=str(run_id),
        status=complete_data.status.value,
        duration_seconds=duration_seconds,
        user_id=str(current_user.id),
    )

    return ExecutionRunCompleteResponse(
        id=run_id,
        status=complete_data.status,
        started_at=run.started_at,
        ended_at=complete_data.ended_at,
        duration_seconds=duration_seconds,
        stats=complete_data.stats,
    )


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancel or delete an execution run",
    description="Cancel a running execution or delete a completed run.",
)
async def delete_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Cancel or delete an execution run."""
    # Get run
    query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    result = await db.execute(query)
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # If running, mark as cancelled
    if run.status == ExecutionRunStatus.RUNNING:
        run.status = ExecutionRunStatus.CANCELLED
        run.ended_at = datetime.utcnow()
        run.duration_seconds = int((run.ended_at - run.started_at).total_seconds())
        await db.commit()
        logger.info(
            "Cancelled execution run", run_id=str(run_id), user_id=str(current_user.id)
        )
    else:
        # Delete completed run (cascade deletes related records)
        await db.delete(run)
        await db.commit()
        logger.info(
            "Deleted execution run", run_id=str(run_id), user_id=str(current_user.id)
        )


# =============================================================================
# Action Executions Endpoints
# =============================================================================


@router.post(
    "/runs/{run_id}/actions",
    response_model=ActionExecutionBatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report batch of action executions",
    description="Report a batch of action executions for a run.",
)
async def report_actions(
    run_id: UUID,
    batch: ActionExecutionBatch,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ActionExecutionBatchResponse:
    """Report a batch of action executions."""
    # Verify run exists
    query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    result = await db.execute(query)
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    action_ids: list[UUID] = []

    for action_data in batch.actions:
        action = ActionExecution(
            run_id=run_id,
            sequence_number=action_data.sequence_number,
            action_type=_map_action_type_to_model(action_data.action_type),
            action_name=action_data.action_name,
            status=_map_action_status_to_model(action_data.status),
            started_at=action_data.started_at,
            completed_at=action_data.completed_at,
            duration_ms=action_data.duration_ms,
            from_state=action_data.from_state,
            to_state=action_data.to_state,
            actual_state=action_data.actual_state,
            input_data=action_data.input_data or {},
            output_data=action_data.output_data or {},
            error_message=action_data.error_message,
            error_type=action_data.error_type,
            extra_metadata=action_data.metadata or {},
        )
        db.add(action)
        await db.flush()  # Get the ID
        action_ids.append(action.id)

    await db.commit()

    logger.info(
        "Reported action executions",
        run_id=str(run_id),
        action_count=len(batch.actions),
        user_id=str(current_user.id),
    )

    return ActionExecutionBatchResponse(
        run_id=run_id,
        actions_recorded=len(batch.actions),
        action_ids=action_ids,
    )


@router.get(
    "/runs/{run_id}/actions",
    response_model=ActionExecutionListResponse,
    summary="List actions for a run",
    description="List all action executions for a specific run.",
)
async def list_run_actions(
    run_id: UUID,
    action_type: ActionType | None = Query(None, description="Filter by action type"),
    status_filter: ActionStatus | None = Query(
        None, alias="status", description="Filter by status"
    ),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ActionExecutionListResponse:
    """List action executions for a run."""
    # Verify run exists
    run_query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    run_result = await db.execute(run_query)
    run = run_result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Build query
    query = select(ActionExecution).where(ActionExecution.run_id == run_id)

    if action_type:
        query = query.where(
            ActionExecution.action_type == _map_action_type_to_model(action_type)
        )
    if status_filter:
        query = query.where(
            ActionExecution.status == _map_action_status_to_model(status_filter)
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply ordering and pagination
    query = query.order_by(ActionExecution.sequence_number).offset(offset).limit(limit)

    result = await db.execute(query)
    actions = result.scalars().all()

    return ActionExecutionListResponse(
        actions=[_model_to_action_response(a) for a in actions],
        pagination=Pagination(
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + limit < total,
        ),
    )


# =============================================================================
# Screenshots Endpoints
# =============================================================================


@router.post(
    "/runs/{run_id}/screenshots",
    response_model=ExecutionScreenshotResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload execution screenshot",
    description="Upload a screenshot captured during execution.",
)
async def upload_screenshot(
    run_id: UUID,
    screenshot_id: UUID = Query(..., description="Client-generated screenshot ID"),
    sequence_number: int = Query(..., description="Sequence number", ge=1),
    screenshot_type: ScreenshotType = Query(..., description="Screenshot type"),
    captured_at: datetime = Query(..., description="Capture timestamp"),
    width: int = Query(..., description="Image width", ge=1),
    height: int = Query(..., description="Image height", ge=1),
    file: UploadFile = File(..., description="Screenshot image file"),
    action_sequence_number: int | None = Query(None, description="Associated action"),
    state_name: str | None = Query(None, description="State name", max_length=255),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionScreenshotResponse:
    """Upload a screenshot for an execution run."""
    # Verify run exists
    run_query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    run_result = await db.execute(run_query)
    run = run_result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Upload to S3/MinIO storage
    storage_prefix = f"execution/{run_id}/screenshots"
    storage_path = f"{storage_prefix}/{screenshot_id}.png"

    try:
        # Upload full image
        file_obj = io.BytesIO(content)
        image_url = object_storage.backend.upload_file(
            file_obj, storage_path, content_type="image/png"
        )

        # Generate and upload thumbnail (200px max)
        thumbnail_url = None
        try:
            img = Image.open(io.BytesIO(content))
            thumb = img.copy()
            thumb.thumbnail((200, 200), Image.Resampling.LANCZOS)
            thumb_buffer = io.BytesIO()
            thumb.save(thumb_buffer, format="PNG")
            thumb_buffer.seek(0)
            thumbnail_path = f"{storage_prefix}/{screenshot_id}_thumb.png"
            thumbnail_url = object_storage.backend.upload_file(
                thumb_buffer, thumbnail_path, content_type="image/png"
            )
        except Exception as e:
            logger.warning("thumbnail_generation_failed", error=str(e))

    except Exception as e:
        logger.error("screenshot_upload_failed", error=str(e), run_id=str(run_id))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload screenshot: {str(e)}",
        )

    # Get associated action if specified
    action_execution_id = None
    if action_sequence_number is not None:
        action_query = select(ActionExecution).where(
            ActionExecution.run_id == run_id,
            ActionExecution.sequence_number == action_sequence_number,
        )
        action_result = await db.execute(action_query)
        action = action_result.scalar_one_or_none()
        if action:
            action_execution_id = action.id

    screenshot = ExecutionScreenshot(
        id=screenshot_id,
        run_id=run_id,
        action_execution_id=action_execution_id,
        sequence_number=sequence_number,
        screenshot_type=_map_screenshot_type_to_model(screenshot_type),
        storage_path=storage_path,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        width=width,
        height=height,
        file_size_bytes=file_size,
        state_name=state_name,
        captured_at=captured_at,
        extra_metadata={},
    )

    db.add(screenshot)
    await db.commit()
    await db.refresh(screenshot)

    logger.info(
        "Uploaded execution screenshot",
        run_id=str(run_id),
        screenshot_id=str(screenshot_id),
        screenshot_type=screenshot_type.value,
        file_size=file_size,
        user_id=str(current_user.id),
    )

    return _model_to_screenshot_response(screenshot)


@router.get(
    "/runs/{run_id}/screenshots",
    response_model=list[ExecutionScreenshotResponse],
    summary="List screenshots for a run",
    description="List all screenshots captured during an execution run.",
)
async def list_run_screenshots(
    run_id: UUID,
    screenshot_type: ScreenshotType | None = Query(None, description="Filter by type"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> list[ExecutionScreenshotResponse]:
    """List screenshots for a run."""
    # Verify run exists
    run_query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    run_result = await db.execute(run_query)
    run = run_result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Build query
    query = select(ExecutionScreenshot).where(ExecutionScreenshot.run_id == run_id)

    if screenshot_type:
        query = query.where(
            ExecutionScreenshot.screenshot_type
            == _map_screenshot_type_to_model(screenshot_type)
        )

    query = query.order_by(ExecutionScreenshot.sequence_number)

    result = await db.execute(query)
    screenshots = result.scalars().all()

    return [_model_to_screenshot_response(s) for s in screenshots]


# =============================================================================
# Issues Endpoints
# =============================================================================


@router.post(
    "/runs/{run_id}/issues",
    response_model=ExecutionIssueBatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report batch of issues",
    description="Report a batch of issues detected during execution.",
)
async def report_issues(
    run_id: UUID,
    batch: ExecutionIssueBatch,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionIssueBatchResponse:
    """Report a batch of issues for a run."""
    # Verify run exists
    run_query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    run_result = await db.execute(run_query)
    run = run_result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    issue_ids: list[UUID] = []

    for issue_data in batch.issues:
        # Get associated action if specified
        action_execution_id = None
        if issue_data.action_sequence_number is not None:
            action_query = select(ActionExecution).where(
                ActionExecution.run_id == run_id,
                ActionExecution.sequence_number == issue_data.action_sequence_number,
            )
            action_result = await db.execute(action_query)
            action = action_result.scalar_one_or_none()
            if action:
                action_execution_id = action.id

        issue = ExecutionIssue(
            run_id=run_id,
            action_execution_id=action_execution_id,
            issue_type=_map_issue_type_to_model(issue_data.issue_type),
            severity=_map_issue_severity_to_model(issue_data.severity),
            status=ExecutionIssueStatus.OPEN,
            source=_map_issue_source_to_model(issue_data.source),
            title=issue_data.title,
            description=issue_data.description,
            state_name=issue_data.state_name,
            screenshot_ids=[str(sid) for sid in (issue_data.screenshot_ids or [])],
            reproduction_steps=issue_data.reproduction_steps or [],
            error_details=issue_data.error_details or {},
            extra_metadata=issue_data.metadata or {},
        )
        db.add(issue)
        await db.flush()
        issue_ids.append(issue.id)

    await db.commit()

    logger.info(
        "Reported execution issues",
        run_id=str(run_id),
        issue_count=len(batch.issues),
        user_id=str(current_user.id),
    )

    return ExecutionIssueBatchResponse(
        run_id=run_id,
        issues_recorded=len(batch.issues),
        issue_ids=issue_ids,
    )


@router.get(
    "/runs/{run_id}/issues",
    response_model=ExecutionIssueListResponse,
    summary="List issues for a run",
    description="List all issues detected during an execution run.",
)
async def list_run_issues(
    run_id: UUID,
    severity: IssueSeverity | None = Query(None, description="Filter by severity"),
    issue_type: IssueType | None = Query(
        None, alias="type", description="Filter by type"
    ),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=100, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionIssueListResponse:
    """List issues for a run."""
    # Verify run exists
    run_query = select(ExecutionRun).where(ExecutionRun.id == run_id)
    run_result = await db.execute(run_query)
    run = run_result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Build query
    query = select(ExecutionIssue).where(ExecutionIssue.run_id == run_id)

    if severity:
        query = query.where(
            ExecutionIssue.severity == _map_issue_severity_to_model(severity)
        )
    if issue_type:
        query = query.where(
            ExecutionIssue.issue_type == _map_issue_type_to_model(issue_type)
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply ordering and pagination
    query = query.order_by(ExecutionIssue.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    issues = result.scalars().all()

    # Calculate summary for all issues in this run
    all_issues_query = select(ExecutionIssue).where(ExecutionIssue.run_id == run_id)
    all_issues_result = await db.execute(all_issues_query)
    all_issues = all_issues_result.scalars().all()

    summary: dict[str, Any] = {"by_severity": {}, "by_status": {}, "by_type": {}}
    for sev in ExecutionIssueSeverity:
        summary["by_severity"][sev.value] = sum(
            1 for i in all_issues if i.severity == sev
        )
    for stat in ExecutionIssueStatus:
        summary["by_status"][stat.value] = sum(
            1 for i in all_issues if i.status == stat
        )
    for typ in ExecutionIssueType:
        summary["by_type"][typ.value] = sum(
            1 for i in all_issues if i.issue_type == typ
        )

    return ExecutionIssueListResponse(
        issues=[_model_to_issue_response(i) for i in issues],
        pagination=Pagination(
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + limit < total,
        ),
        summary=summary,
    )


@router.get(
    "/issues",
    response_model=ExecutionIssueListResponse,
    summary="List all issues",
    description="List all issues across runs with optional filtering.",
)
async def list_all_issues(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    run_id: UUID | None = Query(None, description="Filter by run ID"),
    severity: IssueSeverity | None = Query(None, description="Filter by severity"),
    status_filter: IssueStatus | None = Query(
        None, alias="status", description="Filter by status"
    ),
    issue_type: IssueType | None = Query(
        None, alias="type", description="Filter by type"
    ),
    source: IssueSource | None = Query(None, description="Filter by detection source"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=100, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionIssueListResponse:
    """List all issues with filtering."""
    # Build query with join to get project_id
    query = select(ExecutionIssue).join(ExecutionRun)

    if project_id:
        query = query.where(ExecutionRun.project_id == project_id)
    if run_id:
        query = query.where(ExecutionIssue.run_id == run_id)
    if severity:
        query = query.where(
            ExecutionIssue.severity == _map_issue_severity_to_model(severity)
        )
    if status_filter:
        # Map IssueStatus to ExecutionIssueStatus
        status_mapping = {
            IssueStatus.NEW: ExecutionIssueStatus.OPEN,
            IssueStatus.OPEN: ExecutionIssueStatus.OPEN,
            IssueStatus.IN_PROGRESS: ExecutionIssueStatus.IN_PROGRESS,
            IssueStatus.RESOLVED: ExecutionIssueStatus.RESOLVED,
            IssueStatus.CLOSED: ExecutionIssueStatus.RESOLVED,
            IssueStatus.WONT_FIX: ExecutionIssueStatus.WONT_FIX,
        }
        model_status = status_mapping.get(status_filter, ExecutionIssueStatus.OPEN)
        query = query.where(ExecutionIssue.status == model_status)
    if issue_type:
        query = query.where(
            ExecutionIssue.issue_type == _map_issue_type_to_model(issue_type)
        )
    if source:
        query = query.where(ExecutionIssue.source == _map_issue_source_to_model(source))

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply ordering and pagination
    query = query.order_by(ExecutionIssue.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    issues = result.scalars().all()

    # Calculate summary
    summary: dict[str, Any] = {"by_severity": {}, "by_status": {}, "by_type": {}}
    for sev in ExecutionIssueSeverity:
        summary["by_severity"][sev.value] = 0
    for stat in ExecutionIssueStatus:
        summary["by_status"][stat.value] = 0
    for typ in ExecutionIssueType:
        summary["by_type"][typ.value] = 0

    for issue in issues:
        if hasattr(issue.severity, "value"):
            summary["by_severity"][issue.severity.value] = (
                summary["by_severity"].get(issue.severity.value, 0) + 1
            )
        if hasattr(issue.status, "value"):
            summary["by_status"][issue.status.value] = (
                summary["by_status"].get(issue.status.value, 0) + 1
            )
        if hasattr(issue.issue_type, "value"):
            summary["by_type"][issue.issue_type.value] = (
                summary["by_type"].get(issue.issue_type.value, 0) + 1
            )

    return ExecutionIssueListResponse(
        issues=[_model_to_issue_response(i) for i in issues],
        pagination=Pagination(
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + limit < total,
        ),
        summary=summary,
    )


@router.get(
    "/issues/{issue_id}",
    response_model=ExecutionIssueDetail,
    summary="Get issue details",
    description="Get detailed information about a specific issue.",
)
async def get_issue(
    issue_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionIssueDetail:
    """Get detailed issue information."""
    query = select(ExecutionIssue).where(ExecutionIssue.id == issue_id)
    result = await db.execute(query)
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {issue_id} not found",
        )

    # Get associated screenshots
    screenshot_ids = (
        issue.screenshot_ids if isinstance(issue.screenshot_ids, list) else []
    )
    screenshot_uuids = []
    for sid in screenshot_ids:
        try:
            screenshot_uuids.append(UUID(str(sid)))
        except (ValueError, TypeError):
            pass

    screenshots = []
    if screenshot_uuids:
        screenshot_query = select(ExecutionScreenshot).where(
            ExecutionScreenshot.id.in_(screenshot_uuids)
        )
        screenshot_result = await db.execute(screenshot_query)
        screenshots = [
            _model_to_screenshot_response(s) for s in screenshot_result.scalars().all()
        ]

    return ExecutionIssueDetail(
        id=issue.id,
        run_id=issue.run_id,
        issue_type=IssueType(
            issue.issue_type.value
            if hasattr(issue.issue_type, "value")
            else issue.issue_type
        ),
        severity=IssueSeverity(
            issue.severity.value if hasattr(issue.severity, "value") else issue.severity
        ),
        status=IssueStatus(
            issue.status.value if hasattr(issue.status, "value") else issue.status
        ),
        source=IssueSource(
            issue.source.value if hasattr(issue.source, "value") else issue.source
        ),
        title=issue.title,
        description=issue.description,
        state_name=issue.state_name,
        screenshot_count=len(screenshots),
        created_at=issue.created_at,
        updated_at=issue.updated_at,
        action_sequence_number=None,  # Would need to query action
        reproduction_steps=(
            issue.reproduction_steps
            if isinstance(issue.reproduction_steps, list)
            else []
        ),
        screenshots=screenshots,
        error_details=(
            issue.error_details if isinstance(issue.error_details, dict) else {}
        ),
        metadata=issue.extra_metadata if isinstance(issue.extra_metadata, dict) else {},
        assigned_to=None,  # Would need to query user
        resolution_notes=issue.resolution_notes,
    )


@router.put(
    "/issues/{issue_id}",
    response_model=ExecutionIssueResponse,
    summary="Update an issue",
    description="Update issue status, severity, assignment, or resolution notes.",
)
async def update_issue(
    issue_id: UUID,
    update_data: ExecutionIssueUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionIssueResponse:
    """Update an issue."""
    query = select(ExecutionIssue).where(ExecutionIssue.id == issue_id)
    result = await db.execute(query)
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {issue_id} not found",
        )

    # Apply updates
    if update_data.status is not None:
        # Map IssueStatus to ExecutionIssueStatus
        status_mapping = {
            IssueStatus.NEW: ExecutionIssueStatus.OPEN,
            IssueStatus.OPEN: ExecutionIssueStatus.OPEN,
            IssueStatus.IN_PROGRESS: ExecutionIssueStatus.IN_PROGRESS,
            IssueStatus.RESOLVED: ExecutionIssueStatus.RESOLVED,
            IssueStatus.CLOSED: ExecutionIssueStatus.RESOLVED,
            IssueStatus.WONT_FIX: ExecutionIssueStatus.WONT_FIX,
        }
        issue.status = status_mapping.get(update_data.status, ExecutionIssueStatus.OPEN)
    if update_data.severity is not None:
        issue.severity = _map_issue_severity_to_model(update_data.severity)
    if update_data.assigned_to_user_id is not None:
        issue.assigned_to_user_id = update_data.assigned_to_user_id
    if update_data.resolution_notes is not None:
        issue.resolution_notes = update_data.resolution_notes

    issue.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(issue)

    logger.info(
        "Updated execution issue",
        issue_id=str(issue_id),
        status=issue.status.value if hasattr(issue.status, "value") else issue.status,
        user_id=str(current_user.id),
    )

    return _model_to_issue_response(issue)


# =============================================================================
# Analytics Endpoints
# =============================================================================


@router.get(
    "/analytics/trends",
    response_model=ExecutionTrendResponse,
    summary="Get execution trends",
    description="Get execution trend data over time for analytics dashboards.",
)
async def get_execution_trends(
    project_id: UUID = Query(..., description="Project ID"),
    run_type: RunType | None = Query(None, description="Filter by run type"),
    start_date: date = Query(..., description="Start date"),
    end_date: date = Query(..., description="End date"),
    granularity: str = Query(
        "daily", description="Granularity: daily, weekly, monthly"
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> ExecutionTrendResponse:
    """Get execution trend data."""
    # Build query
    query = select(ExecutionRun).where(
        ExecutionRun.project_id == project_id,
        func.date(ExecutionRun.started_at) >= start_date,
        func.date(ExecutionRun.started_at) <= end_date,
    )

    if run_type:
        query = query.where(ExecutionRun.run_type == _map_run_type_to_model(run_type))

    result = await db.execute(query)
    runs = result.scalars().all()

    # Group by date
    daily_data: dict[str, list[ExecutionRun]] = defaultdict(list)
    for r in runs:
        day = r.started_at.date().isoformat()
        daily_data[day].append(r)

    # Build data points
    data_points: list[ExecutionTrendDataPoint] = []
    for day_str, day_runs in sorted(daily_data.items()):
        completed = [
            r
            for r in day_runs
            if r.status in [ExecutionRunStatus.COMPLETED, ExecutionRunStatus.FAILED]
        ]
        successful = [r for r in completed if r.status == ExecutionRunStatus.COMPLETED]
        success_rate = len(successful) / len(completed) * 100 if completed else 0

        # Get action and issue counts for these runs
        run_ids = [r.id for r in day_runs]
        action_count_query = select(func.count()).where(
            ActionExecution.run_id.in_(run_ids)
        )
        action_count_result = await db.execute(action_count_query)
        total_actions = action_count_result.scalar() or 0

        issue_count_query = select(func.count()).where(
            ExecutionIssue.run_id.in_(run_ids)
        )
        issue_count_result = await db.execute(issue_count_query)
        total_issues = issue_count_result.scalar() or 0

        durations = [r.duration_seconds for r in day_runs if r.duration_seconds]
        avg_duration = sum(durations) // len(durations) if durations else 0

        data_points.append(
            ExecutionTrendDataPoint(
                date=day_str,
                runs_count=len(day_runs),
                success_rate=round(success_rate, 2),
                avg_duration_seconds=avg_duration,
                total_actions=total_actions,
                issues_count=total_issues,
            )
        )

    # Overall stats
    all_completed = [
        r
        for r in runs
        if r.status in [ExecutionRunStatus.COMPLETED, ExecutionRunStatus.FAILED]
    ]
    all_successful = [
        r for r in all_completed if r.status == ExecutionRunStatus.COMPLETED
    ]
    overall_success_rate = (
        len(all_successful) / len(all_completed) * 100 if all_completed else 0
    )

    overall_stats = {
        "total_runs": len(runs),
        "successful_runs": len(all_successful),
        "failed_runs": len(all_completed) - len(all_successful),
        "success_rate": round(overall_success_rate, 2),
        "avg_success_rate": round(overall_success_rate, 2),
        "total_actions": sum(len(getattr(r, "action_executions", [])) for r in runs),
        "total_issues": sum(len(getattr(r, "issues", [])) for r in runs),
    }

    return ExecutionTrendResponse(
        project_id=project_id,
        run_type=run_type,
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        granularity=granularity,
        data_points=data_points,
        overall_stats=overall_stats,
    )


@router.get(
    "/analytics/reliability",
    response_model=list[ActionReliabilityStats],
    summary="Get action reliability stats",
    description="Get reliability statistics for actions to identify flaky tests.",
)
async def get_reliability_stats(
    project_id: UUID = Query(..., description="Project ID"),
    run_type: RunType | None = Query(None, description="Filter by run type"),
    days: int = Query(30, ge=1, le=90, description="Number of days to analyze"),
    limit: int = Query(20, ge=1, le=100, description="Number of actions to return"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> list[ActionReliabilityStats]:
    """Get action reliability statistics."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Get runs in time range
    run_query = select(ExecutionRun.id).where(
        ExecutionRun.project_id == project_id,
        ExecutionRun.started_at >= cutoff,
    )
    if run_type:
        run_query = run_query.where(
            ExecutionRun.run_type == _map_run_type_to_model(run_type)
        )

    run_result = await db.execute(run_query)
    run_ids = list(run_result.scalars().all())

    if not run_ids:
        return []

    # Get all actions for these runs
    action_query = select(ActionExecution).where(ActionExecution.run_id.in_(run_ids))
    action_result = await db.execute(action_query)
    actions = action_result.scalars().all()

    # Aggregate stats by action name
    action_stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "action_name": "",
            "action_type": None,
            "total": 0,
            "successful": 0,
            "failed": 0,
            "durations": [],
            "errors": defaultdict(int),
        }
    )

    for action in actions:
        key = action.action_name
        stats = action_stats[key]
        stats["action_name"] = action.action_name
        stats["action_type"] = action.action_type
        stats["total"] += 1
        if action.duration_ms:
            stats["durations"].append(action.duration_ms)

        if action.status == ActionExecutionStatus.SUCCESS:
            stats["successful"] += 1
        elif action.status in [
            ActionExecutionStatus.FAILED,
            ActionExecutionStatus.ERROR,
        ]:
            stats["failed"] += 1
            if action.error_message:
                stats["errors"][action.error_message[:100]] += 1

    # Build response
    result_list: list[ActionReliabilityStats] = []
    for _key, stats in action_stats.items():
        if stats["total"] == 0:
            continue

        durations = sorted(stats["durations"]) if stats["durations"] else [0]
        p50_idx = len(durations) // 2
        p95_idx = int(len(durations) * 0.95)

        common_errors = [
            {
                "error_type": err,
                "count": count,
                "percentage": (
                    round(count / stats["failed"] * 100, 2)
                    if stats["failed"] > 0
                    else 0
                ),
            }
            for err, count in sorted(stats["errors"].items(), key=lambda x: -x[1])[:5]
        ]

        action_type_value = stats["action_type"]
        if hasattr(action_type_value, "value"):
            action_type_value = action_type_value.value

        result_list.append(
            ActionReliabilityStats(
                action_name=stats["action_name"],
                action_type=(
                    ActionType(action_type_value)
                    if action_type_value
                    else ActionType.CUSTOM
                ),
                total_executions=stats["total"],
                successful_executions=stats["successful"],
                failed_executions=stats["failed"],
                success_rate=round(stats["successful"] / stats["total"] * 100, 2),
                avg_duration_ms=sum(durations) // len(durations) if durations else 0,
                p50_duration_ms=(
                    durations[p50_idx] if durations and p50_idx < len(durations) else 0
                ),
                p95_duration_ms=(
                    durations[p95_idx]
                    if durations and p95_idx < len(durations)
                    else (durations[-1] if durations else 0)
                ),
                common_errors=common_errors,
            )
        )

    # Sort by failure rate descending
    result_list.sort(key=lambda x: x.success_rate)
    return result_list[:limit]
