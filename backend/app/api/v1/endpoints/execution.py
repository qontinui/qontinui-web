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

from datetime import date, datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

# Import schemas from qontinui-schemas
from qontinui_schemas.api.execution import (
    ActionExecutionBatch,
    ActionExecutionBatchResponse,
    ActionExecutionListResponse,
    ActionReliabilityStats,
    ActionStatus,
    ActionType,
    CostTrendResponse,
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
    ExecutionTrendResponse,
    IssueSeverity,
    IssueSource,
    IssueStatus,
    IssueType,
    LLMCostSummary,
    RunStatus,
    RunType,
    ScreenshotType,
)
from qontinui_schemas.events import ExecutionTreeResponse, TreeEventListResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.repositories import (
    ActionExecutionRepository,
    ExecutionIssueRepository,
    ExecutionRunRepository,
    ExecutionScreenshotRepository,
    ExecutionTreeEventRepository,
)
from app.repositories.deps import (
    get_action_execution_repository,
    get_execution_issue_repository,
    get_execution_run_repository,
    get_execution_screenshot_repository,
    get_execution_tree_event_repository,
)
from app.services.execution_issue_service import ExecutionIssueService
from app.services.execution_run_service import ExecutionRunService
from app.services.execution_screenshot_service import (
    ExecutionScreenshotService,
    model_to_screenshot_response,
)
from app.services.execution_tree_service import ExecutionTreeService

logger = structlog.get_logger(__name__)
router = APIRouter()


# =============================================================================
# Service Factory Functions
# =============================================================================


def get_run_service(
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
    action_repo: ActionExecutionRepository = Depends(get_action_execution_repository),
) -> ExecutionRunService:
    """Get ExecutionRunService with injected repositories."""
    return ExecutionRunService(run_repo, action_repo)


def get_screenshot_service(
    screenshot_repo: ExecutionScreenshotRepository = Depends(
        get_execution_screenshot_repository
    ),
    action_repo: ActionExecutionRepository = Depends(get_action_execution_repository),
) -> ExecutionScreenshotService:
    """Get ExecutionScreenshotService with injected repositories."""
    return ExecutionScreenshotService(screenshot_repo, action_repo)


def get_issue_service(
    issue_repo: ExecutionIssueRepository = Depends(get_execution_issue_repository),
    action_repo: ActionExecutionRepository = Depends(get_action_execution_repository),
    screenshot_repo: ExecutionScreenshotRepository = Depends(
        get_execution_screenshot_repository
    ),
) -> ExecutionIssueService:
    """Get ExecutionIssueService with injected repositories."""
    return ExecutionIssueService(issue_repo, action_repo, screenshot_repo)


def get_tree_service(
    tree_repo: ExecutionTreeEventRepository = Depends(
        get_execution_tree_event_repository
    ),
    action_repo: ActionExecutionRepository = Depends(get_action_execution_repository),
) -> ExecutionTreeService:
    """Get ExecutionTreeService with injected repositories."""
    return ExecutionTreeService(tree_repo, action_repo)


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
    service: ExecutionRunService = Depends(get_run_service),
) -> ExecutionRunResponse:
    """Create a new execution run."""
    return await service.create_run(db, run_data, current_user.id)


@router.get(
    "/runs",
    response_model=ExecutionRunListResponse,
    summary="List execution runs",
    description="List execution runs with optional filtering.",
)
async def list_runs(
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    run_type: RunType | None = Query(None, description="Filter by run type"),
    status_filter: RunStatus | None = Query(
        None, alias="status", description="Filter by status"
    ),
    workflow_name: str | None = Query(
        None, description="Filter by workflow name from workflow_metadata"
    ),
    start_date: date | None = Query(None, description="Filter by start date (from)"),
    end_date: date | None = Query(None, description="Filter by start date (to)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=100, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: ExecutionRunService = Depends(get_run_service),
) -> ExecutionRunListResponse:
    """List execution runs with filtering."""
    result = await service.list_runs(
        db,
        project_id=project_id,
        run_type=run_type,
        status_filter=status_filter,
        workflow_name=workflow_name,
        start_date=start_date,
        end_date=end_date,
        offset=offset,
        limit=limit,
    )
    logger.info(
        "Listed execution runs",
        total=result.pagination.total,
        returned=len(result.runs),
        user_id=str(current_user.id),
    )
    return result


@router.get(
    "/runs/workflows",
    response_model=list[dict[str, Any]],
    summary="List unique workflows from execution runs",
    description="Get unique workflows with run counts.",
)
async def list_workflows(
    project_id: UUID = Query(..., description="Project ID to filter by"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: ExecutionRunService = Depends(get_run_service),
) -> list[dict[str, Any]]:
    """List unique workflows from execution runs."""
    workflows = await service.list_workflows(db, project_id)
    logger.info(
        "Listed unique workflows",
        project_id=str(project_id),
        workflow_count=len(workflows),
        user_id=str(current_user.id),
    )
    return workflows


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
    service: ExecutionRunService = Depends(get_run_service),
) -> ExecutionRunDetail:
    """Get detailed execution run information."""
    result = await service.get_run_detail(db, run_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    return result


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
    service: ExecutionRunService = Depends(get_run_service),
) -> ExecutionRunCompleteResponse:
    """Complete an execution run."""
    result = await service.complete_run(db, run_id, complete_data, current_user.id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    return result


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
    service: ExecutionRunService = Depends(get_run_service),
) -> None:
    """Cancel or delete an execution run."""
    found = await service.cancel_or_delete_run(db, run_id, current_user.id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )


@router.get(
    "/runs/{run_id}/cost-summary",
    response_model=LLMCostSummary,
    summary="Get LLM cost summary for a run",
    description="Get per-model cost breakdown and totals for all LLM actions in a run.",
)
async def get_run_cost_summary(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: ExecutionRunService = Depends(get_run_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> LLMCostSummary:
    """Get LLM cost summary for a single execution run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    result = await service.compute_llm_cost_summary(db, run_id)
    logger.info(
        "Retrieved LLM cost summary",
        run_id=str(run_id),
        llm_action_count=result.llm_action_count,
        total_cost_usd=result.total_cost_usd,
        user_id=str(current_user.id),
    )
    return result


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
    service: ExecutionRunService = Depends(get_run_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> ActionExecutionBatchResponse:
    """Report a batch of action executions."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    result = await service.report_actions(db, run_id, batch)
    logger.info(
        "Reported action executions",
        run_id=str(run_id),
        action_count=len(batch.actions),
        user_id=str(current_user.id),
    )
    return result


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
    service: ExecutionRunService = Depends(get_run_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> ActionExecutionListResponse:
    """List action executions for a run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    return await service.list_actions(
        db,
        run_id=run_id,
        action_type=action_type,
        status_filter=status_filter,
        offset=offset,
        limit=limit,
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
    service: ExecutionScreenshotService = Depends(get_screenshot_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> ExecutionScreenshotResponse:
    """Upload a screenshot for an execution run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    # Read file content
    content = await file.read()

    try:
        screenshot = await service.upload_screenshot(
            db=db,
            run_id=run_id,
            screenshot_id=screenshot_id,
            sequence_number=sequence_number,
            screenshot_type=screenshot_type,
            captured_at=captured_at,
            width=width,
            height=height,
            content=content,
            action_sequence_number=action_sequence_number,
            state_name=state_name,
        )
        logger.info(
            "Uploaded execution screenshot",
            run_id=str(run_id),
            screenshot_id=str(screenshot_id),
            screenshot_type=screenshot_type.value,
            file_size=len(content),
            user_id=str(current_user.id),
        )
        return model_to_screenshot_response(screenshot)
    except Exception as e:
        logger.error("screenshot_upload_failed", error=str(e), run_id=str(run_id))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload screenshot: {str(e)}",
        )


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
    service: ExecutionScreenshotService = Depends(get_screenshot_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> list[ExecutionScreenshotResponse]:
    """List screenshots for a run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    return await service.list_for_run(db, run_id, screenshot_type)


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
    service: ExecutionIssueService = Depends(get_issue_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> ExecutionIssueBatchResponse:
    """Report a batch of issues for a run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    result = await service.report_issues(db, run_id, batch)
    logger.info(
        "Reported execution issues",
        run_id=str(run_id),
        issue_count=len(batch.issues),
        user_id=str(current_user.id),
    )
    return result


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
    service: ExecutionIssueService = Depends(get_issue_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> ExecutionIssueListResponse:
    """List issues for a run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    return await service.list_for_run(
        db, run_id, severity=severity, issue_type=issue_type, offset=offset, limit=limit
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
    service: ExecutionIssueService = Depends(get_issue_service),
) -> ExecutionIssueListResponse:
    """List all issues with filtering."""
    return await service.list_all(
        db,
        project_id=project_id,
        run_id=run_id,
        severity=severity,
        status_filter=status_filter,
        issue_type=issue_type,
        source=source,
        offset=offset,
        limit=limit,
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
    service: ExecutionIssueService = Depends(get_issue_service),
) -> ExecutionIssueDetail:
    """Get detailed issue information."""
    result = await service.get_detail(db, issue_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {issue_id} not found",
        )
    return result


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
    service: ExecutionIssueService = Depends(get_issue_service),
) -> ExecutionIssueResponse:
    """Update an issue."""
    result = await service.update_issue(db, issue_id, update_data)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {issue_id} not found",
        )
    logger.info(
        "Updated execution issue",
        issue_id=str(issue_id),
        user_id=str(current_user.id),
    )
    return result


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
    service: ExecutionRunService = Depends(get_run_service),
) -> ExecutionTrendResponse:
    """Get execution trend data."""
    return await service.get_execution_trends(
        db,
        project_id=project_id,
        run_type=run_type,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
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
    service: ExecutionRunService = Depends(get_run_service),
) -> list[ActionReliabilityStats]:
    """Get action reliability statistics."""
    return await service.get_reliability_stats(
        db,
        project_id=project_id,
        run_type=run_type,
        days=days,
        limit=limit,
    )


@router.get(
    "/analytics/cost-trends",
    response_model=CostTrendResponse,
    summary="Get LLM cost trends",
    description="Get LLM cost trend data over time for analytics dashboards.",
)
async def get_cost_trends(
    project_id: UUID = Query(..., description="Project ID"),
    start_date: date = Query(..., description="Start date"),
    end_date: date = Query(..., description="End date"),
    granularity: str = Query(
        "daily", description="Granularity: daily, weekly"
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: ExecutionRunService = Depends(get_run_service),
) -> CostTrendResponse:
    """Get LLM cost trend data."""
    return await service.get_cost_trends(
        db,
        project_id=project_id,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )


# =============================================================================
# Tree Events Endpoints
# =============================================================================


@router.get(
    "/runs/{run_id}/tree-events",
    response_model=TreeEventListResponse,
    summary="List tree events for a run",
    description="List all tree events for a specific execution run, ordered by sequence.",
)
async def list_tree_events(
    run_id: UUID,
    event_type: str | None = Query(None, description="Filter by event type"),
    node_type: str | None = Query(None, description="Filter by node type"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(500, ge=1, le=1000, description="Pagination limit"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: ExecutionTreeService = Depends(get_tree_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> TreeEventListResponse:
    """List tree events for an execution run."""
    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )
    return await service.list_tree_events(
        db,
        run_id,
        event_type=event_type,
        node_type=node_type,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/runs/{run_id}/tree",
    response_model=ExecutionTreeResponse,
    summary="Get execution tree structure",
    description="Get the full reconstructed execution tree for a run.",
)
async def get_execution_tree(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: ExecutionTreeService = Depends(get_tree_service),
    run_repo: ExecutionRunRepository = Depends(get_execution_run_repository),
) -> ExecutionTreeResponse:
    """Get the reconstructed execution tree for a run."""
    logger.debug(
        "get_execution_tree_entry",
        run_id=str(run_id),
        user_id=str(current_user.id),
    )

    # Verify run exists
    run = await run_repo.get_by_id(db, run_id)
    if not run:
        logger.warning("Execution run not found", run_id=str(run_id))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution run {run_id} not found",
        )

    return await service.get_execution_tree(db, run_id, run)
