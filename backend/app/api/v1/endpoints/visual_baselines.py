"""
API endpoints for visual baseline management.

Provides REST API endpoints for:
- Creating baselines from uploads or screenshots
- Listing and retrieving baselines
- Updating baseline settings
- Version history and rollback
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.models.project import Project
from app.models.user import User
from app.models.visual_baseline import VisualBaseline
from app.schemas.visual_regression import (
    AutoCreateBaselinesRequest,
    AutoCreateBaselinesResponse,
    BaselineFromScreenshot,
    BaselineHistoryResponse,
    BaselineListResponse,
    BaselineResponse,
    BaselineRollback,
    BaselineUpdate,
)
from app.services.visual_testing import baseline_management_service
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

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


async def baseline_to_response(
    baseline: VisualBaseline, include_urls: bool = True
) -> BaselineResponse:
    """Convert VisualBaseline model to response schema."""
    response = BaselineResponse(
        id=baseline.id,
        project_id=baseline.project_id,
        state_name=baseline.state_name,
        workflow_id=baseline.workflow_id,
        width=baseline.width,
        height=baseline.height,
        file_size_bytes=baseline.file_size_bytes,
        perceptual_hash=baseline.perceptual_hash,
        version=baseline.version,
        is_active=baseline.is_active,
        approved_by_user_id=baseline.approved_by_user_id,
        approved_at=baseline.approved_at,
        approval_notes=baseline.approval_notes,
        comparison_settings=baseline.comparison_settings,
        source_test_run_id=baseline.source_test_run_id,
        source_screenshot_id=baseline.source_screenshot_id,
        created_at=baseline.created_at,
        updated_at=baseline.updated_at,
    )

    if include_urls:
        try:
            response.image_url = await baseline_management_service.get_baseline_url(
                baseline
            )
            response.thumbnail_url = (
                await baseline_management_service.get_thumbnail_url(baseline)
            )
        except Exception as e:
            logger.warning("failed_to_generate_baseline_urls", error=str(e))

    return response


# ============================================================================
# Baseline Endpoints
# ============================================================================


@router.post(
    "/baselines",
    response_model=BaselineResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create baseline from upload",
    description="Upload an image to create a new visual baseline for a state.",
)
async def create_baseline_from_upload(
    project_id: UUID = Form(..., description="Project ID"),
    state_name: str = Form(..., description="State name for baseline matching"),
    image: UploadFile = File(..., description="Baseline image file (PNG/JPEG)"),
    workflow_id: str | None = Form(None, description="Optional workflow ID"),
    algorithm: str = Form("ssim", description="Comparison algorithm"),
    threshold: float = Form(0.95, description="Similarity threshold"),
    approval_notes: str | None = Form(None, description="Approval notes"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new baseline from an uploaded image."""
    await verify_project_access(db, project_id, current_user.id)

    # Read image data
    try:
        image_bytes = await image.read()
        if len(image_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty image file",
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read image: {str(e)}",
        )

    comparison_settings = {
        "algorithm": algorithm,
        "threshold": threshold,
        "ignore_regions": [],
    }

    try:
        baseline = await baseline_management_service.create_from_upload(
            db=db,
            project_id=project_id,
            state_name=state_name,
            image_bytes=image_bytes,
            user_id=current_user.id,
            workflow_id=workflow_id,
            comparison_settings=comparison_settings,
            approval_notes=approval_notes,
        )

        await db.commit()

        logger.info(
            "baseline_created_via_upload",
            baseline_id=str(baseline.id),
            project_id=str(project_id),
            state_name=state_name,
            user_id=str(current_user.id),
        )

        return await baseline_to_response(baseline)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/baselines/from-screenshot",
    response_model=BaselineResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create baseline from screenshot",
    description="Create a new baseline from an existing test screenshot.",
)
async def create_baseline_from_screenshot(
    request: BaselineFromScreenshot,
    project_id: UUID = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new baseline from an existing test screenshot."""
    await verify_project_access(db, project_id, current_user.id)

    comparison_settings = None
    if request.comparison_settings:
        comparison_settings = {
            "algorithm": request.comparison_settings.algorithm,
            "threshold": request.comparison_settings.threshold,
            "ignore_regions": [
                r.model_dump() for r in request.comparison_settings.ignore_regions
            ],
        }

    try:
        baseline = await baseline_management_service.create_from_screenshot(
            db=db,
            project_id=project_id,
            state_name=request.state_name,
            screenshot_id=request.screenshot_id,
            user_id=current_user.id,
            workflow_id=request.workflow_id,
            comparison_settings=comparison_settings,
            approval_notes=request.approval_notes,
        )

        await db.commit()

        logger.info(
            "baseline_created_from_screenshot",
            baseline_id=str(baseline.id),
            project_id=str(project_id),
            state_name=request.state_name,
            screenshot_id=str(request.screenshot_id),
            user_id=str(current_user.id),
        )

        return await baseline_to_response(baseline)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/baselines",
    response_model=BaselineListResponse,
    summary="List baselines",
    description="List visual baselines for a project with optional filters.",
)
async def list_baselines(
    project_id: UUID = Query(..., description="Project ID"),
    state_name: str | None = Query(None, description="Filter by state name"),
    workflow_id: str | None = Query(None, description="Filter by workflow ID"),
    is_active: bool | None = Query(True, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """List baselines for a project."""
    await verify_project_access(db, project_id, current_user.id)

    baselines = await baseline_management_service.list_baselines(
        db=db,
        project_id=project_id,
        state_name=state_name,
        workflow_id=workflow_id,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )

    # Get total count
    conditions = [VisualBaseline.project_id == project_id]
    if state_name:
        conditions.append(VisualBaseline.state_name == state_name)
    if workflow_id:
        conditions.append(VisualBaseline.workflow_id == workflow_id)
    if is_active is not None:
        conditions.append(VisualBaseline.is_active == is_active)

    count_result = await db.execute(
        select(func.count(VisualBaseline.id)).where(and_(*conditions))
    )
    total = count_result.scalar() or 0

    items = [await baseline_to_response(b, include_urls=True) for b in baselines]

    return BaselineListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/baselines/{baseline_id}",
    response_model=BaselineResponse,
    summary="Get baseline",
    description="Get a visual baseline by ID with presigned URLs.",
)
async def get_baseline(
    baseline_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a baseline by ID."""
    baseline = await baseline_management_service.get_baseline_by_id(db, baseline_id)

    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Baseline not found",
        )

    await verify_project_access(db, baseline.project_id, current_user.id)

    return await baseline_to_response(baseline)


@router.put(
    "/baselines/{baseline_id}",
    response_model=BaselineResponse,
    summary="Update baseline settings",
    description="Update comparison settings for a baseline.",
)
async def update_baseline(
    baseline_id: UUID,
    request: BaselineUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update baseline settings."""
    baseline = await baseline_management_service.get_baseline_by_id(db, baseline_id)

    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Baseline not found",
        )

    await verify_project_access(db, baseline.project_id, current_user.id)

    comparison_settings = None
    if request.comparison_settings:
        comparison_settings = {
            "algorithm": request.comparison_settings.algorithm,
            "threshold": request.comparison_settings.threshold,
            "ignore_regions": [
                r.model_dump() for r in request.comparison_settings.ignore_regions
            ],
        }

    baseline = await baseline_management_service.update_baseline_settings(
        db=db,
        baseline_id=baseline_id,
        comparison_settings=comparison_settings,
        approval_notes=request.approval_notes,
    )

    await db.commit()

    return await baseline_to_response(baseline)


@router.delete(
    "/baselines/{baseline_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete baseline",
    description="Soft delete a baseline (deactivate it).",
)
async def delete_baseline(
    baseline_id: UUID,
    hard_delete: bool = Query(False, description="Permanently delete"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a baseline."""
    baseline = await baseline_management_service.get_baseline_by_id(db, baseline_id)

    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Baseline not found",
        )

    await verify_project_access(db, baseline.project_id, current_user.id)

    await baseline_management_service.delete_baseline(
        db=db,
        baseline_id=baseline_id,
        hard_delete=hard_delete,
    )

    await db.commit()


@router.get(
    "/baselines/{baseline_id}/history",
    response_model=BaselineHistoryResponse,
    summary="Get baseline history",
    description="Get version history for a state's baselines.",
)
async def get_baseline_history(
    baseline_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get baseline version history."""
    baseline = await baseline_management_service.get_baseline_by_id(db, baseline_id)

    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Baseline not found",
        )

    await verify_project_access(db, baseline.project_id, current_user.id)

    history = await baseline_management_service.get_baseline_history(
        db=db,
        project_id=baseline.project_id,
        state_name=baseline.state_name,
        workflow_id=baseline.workflow_id,
    )

    versions = [await baseline_to_response(b, include_urls=True) for b in history]

    return BaselineHistoryResponse(
        state_name=baseline.state_name,
        workflow_id=baseline.workflow_id,
        versions=versions,
    )


@router.post(
    "/baselines/{baseline_id}/rollback",
    response_model=BaselineResponse,
    summary="Rollback baseline",
    description="Rollback a baseline to a previous version.",
)
async def rollback_baseline(
    baseline_id: UUID,
    request: BaselineRollback,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Rollback baseline to a previous version."""
    baseline = await baseline_management_service.get_baseline_by_id(db, baseline_id)

    if not baseline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Baseline not found",
        )

    await verify_project_access(db, baseline.project_id, current_user.id)

    try:
        rolled_back = await baseline_management_service.rollback_baseline(
            db=db,
            baseline_id=baseline_id,
            target_version=request.target_version,
            user_id=current_user.id,
        )

        await db.commit()

        logger.info(
            "baseline_rolled_back",
            baseline_id=str(baseline_id),
            target_version=request.target_version,
            user_id=str(current_user.id),
        )

        return await baseline_to_response(rolled_back)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/baselines/auto-create",
    response_model=AutoCreateBaselinesResponse,
    summary="Auto-create baselines",
    description="Automatically create baselines from screenshots in a test run.",
)
async def auto_create_baselines(
    request: AutoCreateBaselinesRequest,
    project_id: UUID = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Auto-create baselines from a test run's screenshots."""
    await verify_project_access(db, project_id, current_user.id)

    # Get screenshots from the test run that have state names
    from app.models.software_test_run import SoftwareTestRun
    from app.models.test_screenshot import TestScreenshot

    # Verify test run belongs to this project
    run_result = await db.execute(
        select(SoftwareTestRun).where(SoftwareTestRun.id == request.test_run_id)
    )
    test_run = run_result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    if test_run.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Test run does not belong to this project",
        )

    # Get screenshots with state names
    conditions = [
        TestScreenshot.test_run_id == request.test_run_id,
        TestScreenshot.state_name.isnot(None),
    ]

    if request.state_filter:
        conditions.append(TestScreenshot.state_name == request.state_filter)

    screenshot_result = await db.execute(
        select(TestScreenshot).where(and_(*conditions))
    )
    screenshots = screenshot_result.scalars().all()

    # Group by state name (take first screenshot per state)
    state_screenshots = {}
    for screenshot in screenshots:
        if screenshot.state_name not in state_screenshots:
            state_screenshots[screenshot.state_name] = screenshot

    created_baselines = []
    skipped = 0
    errors = 0

    for state_name, screenshot in state_screenshots.items():
        # Skip if state_name is None
        if state_name is None:
            continue

        # Check if baseline already exists
        existing = await baseline_management_service.get_baseline_for_state(
            db, project_id, state_name, test_run.workflow_id
        )

        if existing and not request.overwrite_existing:
            skipped += 1
            continue

        try:
            baseline = await baseline_management_service.create_from_screenshot(
                db=db,
                project_id=project_id,
                state_name=state_name,
                screenshot_id=screenshot.id,
                user_id=current_user.id,
                workflow_id=test_run.workflow_id,
                approval_notes="Auto-created from test run",
            )
            created_baselines.append(baseline)
        except Exception as e:
            logger.error(
                "auto_create_baseline_failed",
                state_name=state_name,
                screenshot_id=str(screenshot.id),
                error=str(e),
            )
            errors += 1

    await db.commit()

    responses = [await baseline_to_response(b) for b in created_baselines]

    return AutoCreateBaselinesResponse(
        created=len(created_baselines),
        skipped=skipped,
        errors=errors,
        baselines=responses,
    )
