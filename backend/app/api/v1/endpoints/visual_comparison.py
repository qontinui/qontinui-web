"""
API endpoints for visual comparison operations.

Provides REST API endpoints for:
- Running visual comparisons
- Managing comparison reviews
- Getting comparison statistics
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun
from app.models.user import User
from app.models.visual_comparison_result import ReviewDecision, VisualComparisonResult
from app.schemas.visual_regression import (
    ComparisonBatchResponse,
    ComparisonCreate,
    ComparisonDetailResponse,
    ComparisonListResponse,
    ComparisonResponse,
    ComparisonRunCreate,
    ComparisonStatsResponse,
    DiffRegionResponse,
    ProjectVisualStatsResponse,
    ReviewCreate,
)
from app.services.visual_comparison_service import visual_comparison_service

logger = structlog.get_logger(__name__)
router = APIRouter()


# ============================================================================
# Helper Functions
# ============================================================================


async def verify_project_access(
    db: AsyncSession, project_id: UUID, user_id: UUID
) -> Project:
    """Verify user has access to the project."""
    result = await db.execute(select(Project).filter(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this project",
        )

    return project


async def verify_test_run_access(
    db: AsyncSession, run_id: UUID, user_id: UUID
) -> SoftwareTestRun:
    """Verify user has access to the test run."""
    result = await db.execute(
        select(SoftwareTestRun).filter(SoftwareTestRun.id == run_id)
    )
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    await verify_project_access(db, test_run.project_id, user_id)

    return test_run


async def comparison_to_response(
    comparison: VisualComparisonResult, include_urls: bool = True
) -> ComparisonResponse:
    """Convert VisualComparisonResult model to response schema."""
    response = ComparisonResponse(
        id=comparison.id,
        test_run_id=comparison.test_run_id,
        baseline_id=comparison.baseline_id,
        screenshot_id=comparison.screenshot_id,
        transition_execution_id=comparison.transition_execution_id,
        state_name=comparison.state_name,
        comparison_algorithm=comparison.comparison_algorithm,
        similarity_score=comparison.similarity_score,
        threshold_used=comparison.threshold_used,
        status=(
            comparison.status.value
            if hasattr(comparison.status, "value")
            else comparison.status
        ),
        diff_region_count=comparison.diff_region_count,
        execution_time_ms=comparison.execution_time_ms,
        reviewed_by_user_id=comparison.reviewed_by_user_id,
        reviewed_at=comparison.reviewed_at,
        review_decision=(
            comparison.review_decision.value
            if comparison.review_decision
            and hasattr(comparison.review_decision, "value")
            else comparison.review_decision
        ),
        review_notes=comparison.review_notes,
        deficiency_id=comparison.deficiency_id,
        error_message=comparison.error_message,
        created_at=comparison.created_at,
    )

    if include_urls:
        try:
            response.diff_image_url = (
                await visual_comparison_service.get_diff_image_url(comparison)
            )
        except Exception as e:
            logger.warning("failed_to_generate_diff_url", error=str(e))

    return response


async def comparison_to_detail_response(
    comparison: VisualComparisonResult, include_urls: bool = True
) -> ComparisonDetailResponse:
    """Convert VisualComparisonResult model to detailed response schema."""
    base = await comparison_to_response(comparison, include_urls)

    diff_regions = []
    if comparison.diff_regions and isinstance(comparison.diff_regions, list):
        diff_regions = [
            DiffRegionResponse(
                x=r.get("x", 0),
                y=r.get("y", 0),
                width=r.get("width", 0),
                height=r.get("height", 0),
                change_percentage=r.get("change_percentage", 0.0),
                pixel_count=r.get("pixel_count"),
            )
            for r in comparison.diff_regions
        ]

    return ComparisonDetailResponse(
        **base.model_dump(),
        diff_regions=diff_regions,
    )


# ============================================================================
# Comparison Endpoints
# ============================================================================


@router.post(
    "/screenshots/{screenshot_id}/compare",
    response_model=ComparisonDetailResponse,
    summary="Compare screenshot",
    description="Compare a screenshot against its baseline.",
)
async def compare_screenshot(
    screenshot_id: UUID,
    request: ComparisonCreate | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Compare a single screenshot against its baseline."""
    # Get the screenshot to verify access
    from app.models.test_screenshot import TestScreenshot

    result = await db.execute(
        select(TestScreenshot).where(TestScreenshot.id == screenshot_id)
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found",
        )

    # Verify access via test run
    await verify_test_run_access(db, screenshot.test_run_id, current_user.id)

    try:
        comparison = await visual_comparison_service.compare_screenshot(
            db=db,
            screenshot_id=screenshot_id,
            baseline_id=request.baseline_id if request else None,
            algorithm=request.algorithm if request else None,
            threshold=request.threshold if request else None,
        )

        await db.commit()

        return await comparison_to_detail_response(comparison)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/runs/{run_id}/visual-compare",
    response_model=ComparisonBatchResponse,
    summary="Compare test run",
    description="Compare all screenshots in a test run against their baselines.",
)
async def compare_test_run(
    run_id: UUID,
    request: ComparisonRunCreate | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Compare all screenshots in a test run."""
    await verify_test_run_access(db, run_id, current_user.id)

    try:
        comparisons = await visual_comparison_service.compare_test_run(
            db=db,
            test_run_id=run_id,
            state_filter=request.state_filter if request else None,
        )

        await db.commit()

        # Calculate stats
        from app.models.visual_comparison_result import VisualComparisonStatus

        passed = sum(
            1 for c in comparisons if c.status == VisualComparisonStatus.PASSED
        )
        failed = sum(
            1 for c in comparisons if c.status == VisualComparisonStatus.FAILED
        )
        pending = sum(
            1 for c in comparisons if c.status == VisualComparisonStatus.PENDING_REVIEW
        )
        no_baseline = sum(
            1 for c in comparisons if c.status == VisualComparisonStatus.NO_BASELINE
        )

        responses = [await comparison_to_response(c) for c in comparisons]

        return ComparisonBatchResponse(
            comparisons=responses,
            total=len(comparisons),
            passed=passed,
            failed=failed,
            pending_review=pending,
            no_baseline=no_baseline,
        )

    except Exception as e:
        logger.error("batch_comparison_failed", run_id=str(run_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch comparison failed: {str(e)}",
        )


@router.get(
    "/visual-comparisons",
    response_model=ComparisonListResponse,
    summary="List comparisons",
    description="List visual comparison results with optional filters.",
)
async def list_comparisons(
    project_id: UUID = Query(..., description="Project ID"),
    test_run_id: UUID | None = Query(None, description="Filter by test run"),
    status_filter: str | None = Query(None, description="Filter by status"),
    state_name: str | None = Query(None, description="Filter by state name"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """List visual comparison results."""
    await verify_project_access(db, project_id, current_user.id)

    conditions = [SoftwareTestRun.project_id == project_id]

    if test_run_id:
        conditions.append(VisualComparisonResult.test_run_id == test_run_id)

    if status_filter:
        conditions.append(VisualComparisonResult.status == status_filter)

    if state_name:
        conditions.append(VisualComparisonResult.state_name == state_name)

    # Query with join to filter by project
    result = await db.execute(
        select(VisualComparisonResult)
        .join(SoftwareTestRun)
        .where(and_(*conditions))
        .order_by(VisualComparisonResult.created_at.desc())
        .offset(skip)
        .limit(limit)
    )

    comparisons = result.scalars().all()

    # Get total count
    count_result = await db.execute(
        select(func.count(VisualComparisonResult.id))
        .join(SoftwareTestRun)
        .where(and_(*conditions))
    )
    total = count_result.scalar() or 0

    items = [await comparison_to_response(c) for c in comparisons]

    return ComparisonListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/visual-comparisons/pending",
    response_model=ComparisonListResponse,
    summary="Get pending reviews",
    description="Get comparison results pending review for a project.",
)
async def get_pending_reviews(
    project_id: UUID = Query(..., description="Project ID"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get comparisons pending review."""
    await verify_project_access(db, project_id, current_user.id)

    comparisons = await visual_comparison_service.get_pending_reviews(
        db=db,
        project_id=project_id,
        skip=skip,
        limit=limit,
    )

    # Get total count of pending
    from app.models.visual_comparison_result import VisualComparisonStatus

    count_result = await db.execute(
        select(func.count(VisualComparisonResult.id))
        .join(SoftwareTestRun)
        .where(
            and_(
                SoftwareTestRun.project_id == project_id,
                VisualComparisonResult.status == VisualComparisonStatus.PENDING_REVIEW,
            )
        )
    )
    total = count_result.scalar() or 0

    items = [await comparison_to_response(c) for c in comparisons]

    return ComparisonListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/visual-comparisons/{comparison_id}",
    response_model=ComparisonDetailResponse,
    summary="Get comparison",
    description="Get a visual comparison result by ID with detailed diff regions.",
)
async def get_comparison(
    comparison_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a comparison by ID."""
    comparison = await visual_comparison_service.get_comparison_by_id(db, comparison_id)

    if not comparison:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comparison not found",
        )

    await verify_test_run_access(db, comparison.test_run_id, current_user.id)

    return await comparison_to_detail_response(comparison)


@router.post(
    "/visual-comparisons/{comparison_id}/review",
    response_model=ComparisonDetailResponse,
    summary="Review comparison",
    description="Submit a review decision for a comparison result.",
)
async def review_comparison(
    comparison_id: UUID,
    request: ReviewCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Review a comparison result."""
    comparison = await visual_comparison_service.get_comparison_by_id(db, comparison_id)

    if not comparison:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comparison not found",
        )

    await verify_test_run_access(db, comparison.test_run_id, current_user.id)

    # Validate decision
    try:
        decision = ReviewDecision(request.decision)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid decision. Must be one of: {[d.value for d in ReviewDecision]}",
        )

    try:
        comparison = await visual_comparison_service.review_comparison(
            db=db,
            comparison_id=comparison_id,
            decision=decision,
            user_id=current_user.id,
            notes=request.notes,
        )

        await db.commit()

        logger.info(
            "comparison_reviewed",
            comparison_id=str(comparison_id),
            decision=decision.value,
            user_id=str(current_user.id),
        )

        return await comparison_to_detail_response(comparison)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


# ============================================================================
# Statistics Endpoints
# ============================================================================


@router.get(
    "/runs/{run_id}/visual-stats",
    response_model=ComparisonStatsResponse,
    summary="Get run comparison stats",
    description="Get visual comparison statistics for a test run.",
)
async def get_run_comparison_stats(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get comparison statistics for a test run."""
    await verify_test_run_access(db, run_id, current_user.id)

    stats = await visual_comparison_service.get_run_comparison_stats(db, run_id)

    from app.models.visual_comparison_result import VisualComparisonStatus

    return ComparisonStatsResponse(
        total=stats.get("total", 0),
        passed=stats.get(VisualComparisonStatus.PASSED.value, 0),
        failed=stats.get(VisualComparisonStatus.FAILED.value, 0),
        pending_review=stats.get(VisualComparisonStatus.PENDING_REVIEW.value, 0),
        approved_as_new=stats.get(VisualComparisonStatus.APPROVED_AS_NEW.value, 0),
        no_baseline=stats.get(VisualComparisonStatus.NO_BASELINE.value, 0),
        pass_rate=stats.get("pass_rate", 0.0),
    )


@router.get(
    "/visual-stats/{project_id}",
    response_model=ProjectVisualStatsResponse,
    summary="Get project visual stats",
    description="Get visual regression statistics for a project.",
)
async def get_project_visual_stats(
    project_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get visual regression statistics for a project."""
    await verify_project_access(db, project_id, current_user.id)

    stats = await visual_comparison_service.get_project_comparison_stats(db, project_id)

    from app.models.visual_comparison_result import VisualComparisonStatus

    return ProjectVisualStatsResponse(
        total=stats.get("total", 0),
        passed=stats.get(VisualComparisonStatus.PASSED.value, 0),
        failed=stats.get(VisualComparisonStatus.FAILED.value, 0),
        pending_review=stats.get(VisualComparisonStatus.PENDING_REVIEW.value, 0),
        approved_as_new=stats.get(VisualComparisonStatus.APPROVED_AS_NEW.value, 0),
        no_baseline=stats.get(VisualComparisonStatus.NO_BASELINE.value, 0),
        pending_review_count=stats.get("pending_review_count", 0),
        active_baselines=stats.get("active_baselines", 0),
    )
