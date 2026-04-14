"""
Runner -> Backend endpoints for reporting test results.

These endpoints are called by the Qontinui Runner to report:
- Test run creation and completion
- Transition execution results
- Deficiency reports
- Coverage updates
- Screenshot evidence
"""

import json
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db
from app.models.user import User
from app.schemas.testing import (CoverageUpdate, CoverageUpdateResponse,
                                 DeficiencyBatchCreate,
                                 DeficiencyBatchResponse, ScreenshotMetadata,
                                 ScreenshotUploadResponse, TestRunComplete,
                                 TestRunCompleteResponse, TestRunCreate,
                                 TestRunResponse, TransitionBatchCreate,
                                 TransitionBatchResponse)
from app.services.screenshot_upload_service import (InvalidImageError,
                                                    ScreenshotUploadError,
                                                    screenshot_upload_service)
from app.services.test_run_service import TestRunService
from fastapi import (APIRouter, Depends, File, Form, HTTPException, UploadFile,
                     status)
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import (ProjectAccessDeniedError, ProjectNotFoundError,
                   TestRunNotFoundError, get_runner_user, get_test_run_service,
                   handle_project_access_denied, handle_project_not_found,
                   handle_test_run_not_found)

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.post(
    "/runs", response_model=TestRunResponse, status_code=status.HTTP_201_CREATED
)
async def create_test_run(
    *,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_runner_user),
    service: TestRunService = Depends(get_test_run_service),
    run_in: TestRunCreate,
) -> Any:
    """Start a new test run session."""
    try:
        test_run = await service.create_test_run(db, run_in, user.id)
        return TestRunResponse(**service.build_test_run_response_data(test_run))
    except ProjectNotFoundError:
        raise handle_project_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


@router.post(
    "/runs/{run_id}/transitions",
    response_model=TransitionBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_transitions(
    *,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_runner_user),
    service: TestRunService = Depends(get_test_run_service),
    run_id: UUID,
    batch_in: TransitionBatchCreate,
) -> Any:
    """Report transition execution results (batch operation)."""
    try:
        transition_ids, _, _, test_run = await service.report_transitions(
            db, run_id, batch_in, user.id
        )

        return TransitionBatchResponse(
            run_id=run_id,
            transitions_recorded=len(transition_ids),
            transition_ids=transition_ids,
            coverage_updated={
                "total_transitions_executed": test_run.total_transitions,
                "unique_transitions_covered": test_run.unique_paths_found,
                "coverage_percentage": float(test_run.coverage_percentage),
            },
        )
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


@router.post(
    "/runs/{run_id}/deficiencies",
    response_model=DeficiencyBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_deficiencies(
    *,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_runner_user),
    service: TestRunService = Depends(get_test_run_service),
    run_id: UUID,
    batch_in: DeficiencyBatchCreate,
) -> Any:
    """Report bugs/issues found during testing (batch operation)."""
    try:
        deficiency_ids = await service.report_deficiencies(
            db, run_id, batch_in, user.id
        )

        return DeficiencyBatchResponse(
            run_id=run_id,
            deficiencies_recorded=len(deficiency_ids),
            deficiency_ids=deficiency_ids,
        )
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


@router.put("/runs/{run_id}/coverage", response_model=CoverageUpdateResponse)
async def update_coverage(
    *,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_runner_user),
    service: TestRunService = Depends(get_test_run_service),
    run_id: UUID,
    coverage_in: CoverageUpdate,
) -> Any:
    """Update coverage metrics for the test run."""
    try:
        await service.update_coverage(db, run_id, coverage_in, user.id)

        return CoverageUpdateResponse(
            run_id=run_id,
            coverage_updated=True,
            coverage_percentage=coverage_in.coverage_percentage,
            unique_transitions_covered=coverage_in.unique_transitions_covered,
        )
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


@router.put("/runs/{run_id}/complete", response_model=TestRunCompleteResponse)
async def complete_test_run(
    *,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_runner_user),
    service: TestRunService = Depends(get_test_run_service),
    run_id: UUID,
    complete_in: TestRunComplete,
) -> Any:
    """Mark test run as completed and record final metrics."""
    try:
        test_run, duration_seconds = await service.complete_test_run(
            db, run_id, complete_in, user.id
        )

        return TestRunCompleteResponse(
            run_id=test_run.id,
            status=test_run.status,
            started_at=test_run.started_at,
            ended_at=complete_in.ended_at,
            duration_seconds=duration_seconds,
            final_metrics=complete_in.final_metrics,
        )
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()


@router.post(
    "/runs/{run_id}/screenshots",
    response_model=ScreenshotUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_runner_user),
    service: TestRunService = Depends(get_test_run_service),
    run_id: UUID,
    metadata: str = Form(..., description="JSON metadata for screenshot"),
    image: UploadFile = File(..., description="Screenshot image file (PNG/JPEG)"),
) -> Any:
    """Upload screenshot evidence with metadata."""
    # Validate content type
    try:
        screenshot_upload_service.validate_content_type(image.content_type)
    except InvalidImageError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # Parse metadata JSON
    try:
        metadata_dict = json.loads(metadata)
        screenshot_meta = ScreenshotMetadata(**metadata_dict)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid JSON metadata: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid metadata format: {str(e)}",
        )

    # Verify access
    try:
        await service.get_test_run_with_access(db, run_id, user.id)
    except TestRunNotFoundError:
        raise handle_test_run_not_found()
    except ProjectAccessDeniedError:
        raise handle_project_access_denied()

    # Read and upload
    image_data = await image.read()

    try:
        result = await screenshot_upload_service.upload_screenshot(
            db=db,
            run_id=run_id,
            metadata=screenshot_meta,
            image_data=image_data,
            original_filename=image.filename,
            content_type=image.content_type,
        )

        return ScreenshotUploadResponse(**result)
    except ScreenshotUploadError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
