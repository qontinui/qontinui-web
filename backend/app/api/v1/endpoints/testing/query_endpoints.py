"""
Web Frontend -> Backend endpoints for querying test data.

These endpoints are called by the web frontend to:
- List and view test runs
- Get coverage trends over time
- Get transition reliability statistics
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.repositories import TestRunRepository
from app.repositories.deps import get_test_run_repository
from app.schemas.testing import (CoverageTrendDataPoint, CoverageTrendResponse,
                                 ReliabilityResponse, TestRunDetail,
                                 TestRunListResponse, TestRunResponse,
                                 TransitionReliabilityStats)
from app.services.test_run_service import TestRunService
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import (get_test_run_service, handle_test_run_not_found,
                   verify_project_access_or_raise,
                   verify_test_run_access_or_raise)

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.get("/runs", response_model=TestRunListResponse)
async def list_test_runs(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: TestRunRepository = Depends(get_test_run_repository),
    service: TestRunService = Depends(get_test_run_service),
    project_id: UUID = Query(..., description="Filter by project ID"),
    run_status: str | None = Query(None, description="Filter by status"),
    runner_hostname: str | None = Query(None, description="Filter by runner hostname"),
    start_date: datetime | None = Query(None, description="Filter runs started after"),
    end_date: datetime | None = Query(None, description="Filter runs started before"),
    limit: int = Query(50, ge=1, le=200, description="Page size (max 200)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    sort_by: str = Query("started_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order (asc/desc)"),
) -> Any:
    """List all test runs for a project with filtering and pagination."""
    await verify_project_access_or_raise(service, db, project_id, current_user.id)

    runs, total = await repo.list_runs(
        db,
        project_id=project_id,
        status=run_status,
        runner_hostname=runner_hostname,
        start_date=start_date,
        end_date=end_date,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )

    run_responses = [
        TestRunResponse(**service.build_test_run_response_data(run)) for run in runs
    ]

    return TestRunListResponse(
        runs=run_responses,
        pagination={
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        },
    )


@router.get("/runs/{run_id}", response_model=TestRunDetail)
async def get_test_run(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: TestRunRepository = Depends(get_test_run_repository),
    service: TestRunService = Depends(get_test_run_service),
    run_id: UUID,
    include_transitions: bool = Query(False, description="Include transition list"),
    include_deficiencies: bool = Query(False, description="Include deficiency list"),
    include_screenshots: bool = Query(False, description="Include screenshot list"),
) -> Any:
    """Get detailed information about a specific test run."""
    await verify_test_run_access_or_raise(service, db, run_id, current_user.id)

    run_detail, transitions, deficiencies, screenshots = await repo.get_run_detail(
        db,
        run_id=run_id,
        include_transitions=include_transitions,
        include_deficiencies=include_deficiencies,
        include_screenshots=include_screenshots,
    )

    if not run_detail:
        raise handle_test_run_not_found()

    return TestRunRepository.build_run_detail_response(
        run_detail, transitions, deficiencies, screenshots
    )


@router.get("/coverage-trends", response_model=CoverageTrendResponse)
async def get_coverage_trends(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: TestRunRepository = Depends(get_test_run_repository),
    service: TestRunService = Depends(get_test_run_service),
    project_id: UUID = Query(..., description="Project identifier"),
    start_date: datetime | None = Query(None, description="Start of date range"),
    end_date: datetime | None = Query(None, description="End of date range"),
    granularity: str = Query("daily", description="Granularity (daily/weekly/monthly)"),
    workflow_id: str | None = Query(None, description="Filter by specific workflow"),
) -> Any:
    """Get coverage trends over time for historical analysis."""
    if granularity not in ["daily", "weekly", "monthly"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Granularity must be one of: daily, weekly, monthly",
        )

    await verify_project_access_or_raise(service, db, project_id, current_user.id)

    trend_data = await repo.get_coverage_trends(
        db,
        project_id=project_id,
        workflow_id=workflow_id,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )

    data_points = [CoverageTrendDataPoint(**dp) for dp in trend_data["data_points"]]

    return CoverageTrendResponse(
        project_id=project_id,
        start_date=(
            start_date.strftime("%Y-%m-%d") if start_date else trend_data["start_date"]
        ),
        end_date=(
            end_date.strftime("%Y-%m-%d") if end_date else trend_data["end_date"]
        ),
        granularity=granularity,
        data_points=data_points,
        overall_stats=trend_data["overall_stats"],
    )


@router.get("/reliability-stats", response_model=ReliabilityResponse)
async def get_reliability_stats(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    repo: TestRunRepository = Depends(get_test_run_repository),
    service: TestRunService = Depends(get_test_run_service),
    project_id: UUID = Query(..., description="Project identifier"),
    workflow_id: str | None = Query(None, description="Filter by specific workflow"),
    start_date: datetime | None = Query(None, description="Start of date range"),
    end_date: datetime | None = Query(None, description="End of date range"),
    min_executions: int = Query(5, ge=1, description="Minimum executions to include"),
) -> Any:
    """Get transition reliability statistics."""
    await verify_project_access_or_raise(service, db, project_id, current_user.id)

    stats_data = await repo.get_reliability_stats(
        db,
        project_id=project_id,
        workflow_id=workflow_id,
        start_date=start_date,
        end_date=end_date,
        min_executions=min_executions,
    )

    transition_stats = [
        TransitionReliabilityStats(**ts) for ts in stats_data["transition_stats"]
    ]

    return ReliabilityResponse(
        workflow_id=workflow_id or "",
        workflow_name=None,
        project_id=project_id,
        date_range=stats_data["date_range"],
        transition_stats=transition_stats,
        overall_reliability=stats_data["overall_reliability"],
    )
