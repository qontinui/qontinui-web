"""
API endpoints for software testing results.

This module provides REST API endpoints for:
- Runner → Backend: Reporting test results (test runs, transitions, deficiencies, screenshots)
- Web Frontend → Backend: Querying test history and analytics
"""

import io
import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

import structlog
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
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import runner as runner_crud
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.test_screenshot import TestScreenshot, TestScreenshotType
from app.models.transition_execution import (
    TransitionExecution,
    TransitionExecutionStatus,
)
from app.models.user import User
from app.schemas.testing import (
    CoverageTrendResponse,
    CoverageUpdate,
    CoverageUpdateResponse,
    DeficiencyBatchCreate,
    DeficiencyBatchResponse,
    DeficiencyCommentCreate,
    DeficiencyCommentResponse,
    DeficiencyDetail,
    DeficiencyListResponse,
    DeficiencyResponse,
    DeficiencyUpdate,
    ReliabilityResponse,
    ScreenshotMetadata,
    ScreenshotUploadResponse,
    TestRunComplete,
    TestRunCompleteResponse,
    TestRunCreate,
    TestRunDetail,
    TestRunListResponse,
    TestRunResponse,
    TransitionBatchCreate,
    TransitionBatchResponse,
    VisualComparisonSummary,
)
from app.services.object_storage import object_storage
from app.services.visual_comparison_service import VisualComparisonService

# TYPE_CHECKING imports - models are being created by another agent
if TYPE_CHECKING:
    pass

logger = structlog.get_logger(__name__)
router = APIRouter()

# HTTP Bearer scheme for runner token authentication
security = HTTPBearer()


# ============================================================================
# Helper Functions
# ============================================================================


async def verify_project_access(
    db: AsyncSession, project_id: UUID, user_id: UUID
) -> Project:
    """
    Verify user has access to the project.

    Args:
        db: Database session
        project_id: Project ID to check
        user_id: User ID to verify

    Returns:
        Project if access is granted

    Raises:
        HTTPException(404): Project not found
        HTTPException(403): User not authorized
    """
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


async def get_test_run_with_access(
    db: AsyncSession, run_id: UUID, user_id: UUID
) -> SoftwareTestRun:
    """
    Get test run and verify user has access.

    Args:
        db: Database session
        run_id: Test run ID
        user_id: User ID to verify

    Returns:
        SoftwareTestRun if access is granted

    Raises:
        HTTPException(404): Test run not found
        HTTPException(403): User not authorized
    """
    result = await db.execute(
        select(SoftwareTestRun).filter(SoftwareTestRun.id == run_id)
    )
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    # Verify project access
    await verify_project_access(db, test_run.project_id, user_id)

    return test_run


# ============================================================================
# Authentication Dependencies
# ============================================================================


async def get_runner_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_async_db),
) -> tuple[User, Any]:
    """
    Validate runner token and return associated user.

    This dependency is used for runner endpoints (desktop → backend).
    It validates the bearer token as a runner token.

    Args:
        credentials: HTTP Authorization credentials
        db: Database session

    Returns:
        Tuple of (User, RunnerToken)

    Raises:
        HTTPException(401): Invalid/expired/revoked token
    """
    token = credentials.credentials

    # Validate runner token
    runner_token = await runner_crud.validate_runner_token(db, token)

    if not runner_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired runner token",
        )

    # Update last_used_at
    runner_token.last_used_at = datetime.utcnow()
    await db.commit()

    # Get user from runner token
    result = await db.execute(
        select(User).where(User.id == runner_token.user_id)  # type: ignore[arg-type]
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
        )

    logger.info(
        "runner_authenticated",
        user_id=str(user.id),
        runner_token_id=str(runner_token.id),
        token_name=runner_token.name,
    )

    return user, runner_token


# ============================================================================
# Runner → Backend Endpoints (Reporting)
# ============================================================================


@router.post(
    "/runs", response_model=TestRunResponse, status_code=status.HTTP_201_CREATED
)
async def create_test_run(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_auth: tuple[User, Any] = Depends(get_runner_user),
    run_in: TestRunCreate,
) -> Any:
    """
    Start a new test run session.

    **Authentication:** Runner token required

    Creates a new test run record with initial metadata. The runner should then
    report transitions, deficiencies, and screenshots as the test progresses.

    **Example Request:**
    ```json
    {
      "project_id": 123,
      "run_name": "Nightly Regression - 2025-11-23",
      "description": "Full workflow testing",
      "runner_metadata": {
        "runner_version": "0.1.0",
        "os": "Windows 11",
        "hostname": "test-machine-01"
      },
      "workflow_metadata": {
        "workflow_id": "workflow-uuid-456",
        "workflow_name": "E-commerce Checkout Flow",
        "total_states": 12,
        "total_transitions": 24
      },
      "configuration_snapshot": {
        "strategy": "random_walk",
        "max_duration_seconds": 3600
      }
    }
    ```

    **Returns:** Created test run with assigned ID
    """
    user, runner_token = runner_auth

    logger.info(
        "create_test_run_requested",
        user_id=str(user.id),
        project_id=run_in.project_id,
        run_name=run_in.run_name,
    )

    # Check user has access to project
    await verify_project_access(db, run_in.project_id, user.id)

    # Create test run record
    test_run = SoftwareTestRun(
        project_id=run_in.project_id,
        runner_connection_id=getattr(runner_token, "runner_connection_id", None),
        workflow_id=run_in.workflow_metadata.get("workflow_id"),
        status=TestRunStatus.RUNNING,
        started_at=datetime.utcnow(),
        runner_metadata=run_in.runner_metadata,
        configuration_snapshot={
            **run_in.configuration_snapshot,
            "workflow_metadata": run_in.workflow_metadata,
            "run_name": run_in.run_name,
            "description": run_in.description,
        },
        test_mode=run_in.configuration_snapshot.get("strategy"),
        max_duration_seconds=run_in.configuration_snapshot.get(
            "max_duration_seconds", 3600
        ),
        tags=run_in.workflow_metadata.get("tags", []),
    )
    db.add(test_run)
    await db.commit()
    await db.refresh(test_run)

    logger.info(
        "test_run_created",
        run_id=str(test_run.id),
        project_id=str(test_run.project_id),
        user_id=str(user.id),
    )

    return TestRunResponse(
        run_id=test_run.id,
        project_id=test_run.project_id,
        run_name=run_in.run_name,
        status=test_run.status,
        started_at=test_run.started_at,
        ended_at=test_run.completed_at,
        duration_seconds=None,
        runner_metadata=test_run.runner_metadata,
        created_at=test_run.created_at,
    )


@router.post(
    "/runs/{run_id}/transitions",
    response_model=TransitionBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_transitions(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_auth: tuple[User, Any] = Depends(get_runner_user),
    run_id: UUID,
    batch_in: TransitionBatchCreate,
) -> Any:
    """
    Report transition execution results (batch operation).

    **Authentication:** Runner token required

    Reports one or more transition executions. Supports batching for efficiency
    (recommended: 5-10 transitions per batch, max: 50).

    **Idempotency:** If the same sequence_number is sent twice for a run,
    the existing record will be updated (not duplicated).

    **Example Request:**
    ```json
    {
      "transitions": [
        {
          "sequence_number": 1,
          "from_state": "login_page",
          "to_state": "dashboard",
          "transition_name": "successful_login",
          "status": "success",
          "started_at": "2025-11-23T10:30:05Z",
          "completed_at": "2025-11-23T10:30:08Z",
          "duration_ms": 3200,
          "metadata": {
            "actions_executed": 3,
            "confidence_score": 0.95
          }
        }
      ]
    }
    ```

    **Returns:** Created transition IDs and updated coverage metrics
    """
    user, runner_token = runner_auth

    logger.info(
        "report_transitions_requested",
        user_id=str(user.id),
        run_id=str(run_id),
        transition_count=len(batch_in.transitions),
    )

    # Get test run and verify access
    test_run = await get_test_run_with_access(db, run_id, user.id)

    # Map status strings to enum
    status_map = {
        "success": TransitionExecutionStatus.SUCCESS,
        "failed": TransitionExecutionStatus.FAILED,
        "timeout": TransitionExecutionStatus.TIMEOUT,
        "skipped": TransitionExecutionStatus.SKIPPED,
    }

    transition_ids = []
    successful_count = 0
    failed_count = 0

    for t in batch_in.transitions:
        # Check for existing transition with same sequence number (for idempotency)
        result = await db.execute(
            select(TransitionExecution).filter(
                and_(
                    TransitionExecution.test_run_id == run_id,
                    TransitionExecution.sequence_number == t.sequence_number,
                )
            )
        )
        existing = result.scalar_one_or_none()

        execution_status = status_map.get(t.status, TransitionExecutionStatus.ERROR)

        if existing:
            # Update existing transition
            existing.status = execution_status
            existing.started_at = t.started_at
            existing.completed_at = t.completed_at
            existing.execution_time_ms = t.duration_ms
            existing.error_message = t.error_message
            existing.error_type = t.error_type
            existing.source_state = t.from_state
            existing.target_state = t.to_state
            existing.execution_metadata = t.metadata
            transition_ids.append(existing.id)
        else:
            # Create new transition
            transition = TransitionExecution(
                test_run_id=run_id,
                transition_id=f"{t.from_state}->{t.to_state}",
                transition_name=t.transition_name,
                sequence_number=t.sequence_number,
                status=execution_status,
                started_at=t.started_at,
                completed_at=t.completed_at,
                execution_time_ms=t.duration_ms,
                error_type=t.error_type,
                error_message=t.error_message,
                source_state=t.from_state,
                target_state=t.to_state,
                execution_metadata=t.metadata,
                action_count=t.metadata.get("actions_executed", 0),
                retry_count=t.metadata.get("retry_count", 0),
            )
            db.add(transition)
            await db.flush()
            transition_ids.append(transition.id)

        # Track statistics
        if execution_status == TransitionExecutionStatus.SUCCESS:
            successful_count += 1
        else:
            failed_count += 1

    # Update test run aggregate statistics
    test_run.total_transitions += len(batch_in.transitions)
    test_run.successful_transitions += successful_count
    test_run.failed_transitions += failed_count

    await db.commit()

    logger.info(
        "transitions_recorded",
        run_id=str(run_id),
        count=len(transition_ids),
        successful=successful_count,
        failed=failed_count,
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


@router.post(
    "/runs/{run_id}/deficiencies",
    response_model=DeficiencyBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_deficiencies(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_auth: tuple[User, Any] = Depends(get_runner_user),
    run_id: UUID,
    batch_in: DeficiencyBatchCreate,
) -> Any:
    """
    Report bugs/issues found during testing (batch operation).

    **Authentication:** Runner token required

    Reports one or more deficiencies discovered during testing. Deficiencies
    are automatically assigned status="open" on creation.

    **Example Request:**
    ```json
    {
      "deficiencies": [
        {
          "title": "Login button not responding on first click",
          "description": "User must click login button twice...",
          "severity": "medium",
          "deficiency_type": "functional_bug",
          "transition_sequence_number": 1,
          "state": "login_page",
          "screenshot_ids": ["screenshot-uuid-123"],
          "reproduction_steps": [
            "Navigate to login page",
            "Enter valid credentials",
            "Click login button once"
          ]
        }
      ]
    }
    ```

    **Returns:** Created deficiency IDs
    """
    user, runner_token = runner_auth

    logger.info(
        "report_deficiencies_requested",
        user_id=str(user.id),
        run_id=str(run_id),
        deficiency_count=len(batch_in.deficiencies),
    )

    # Get test run and verify access
    test_run = await get_test_run_with_access(db, run_id, user.id)

    # Map severity strings to enum
    severity_map = {
        "critical": DeficiencySeverity.CRITICAL,
        "high": DeficiencySeverity.HIGH,
        "medium": DeficiencySeverity.MEDIUM,
        "low": DeficiencySeverity.LOW,
        "informational": DeficiencySeverity.INFO,
    }

    # Map deficiency type strings to enum
    type_map = {
        "functional_bug": DeficiencyType.FUNCTIONAL,
        "ui_issue": DeficiencyType.VISUAL,
        "performance": DeficiencyType.PERFORMANCE,
        "crash": DeficiencyType.CRASH,
        "security": DeficiencyType.SECURITY,
        "accessibility": DeficiencyType.ACCESSIBILITY,
        "other": DeficiencyType.DATA,
    }

    deficiency_ids = []

    for d in batch_in.deficiencies:
        # Find related transition if sequence number provided
        transition_execution_id = None
        if d.transition_sequence_number:
            result = await db.execute(
                select(TransitionExecution).filter(
                    and_(
                        TransitionExecution.test_run_id == run_id,
                        TransitionExecution.sequence_number
                        == d.transition_sequence_number,
                    )
                )
            )
            transition = result.scalar_one_or_none()
            if transition:
                transition_execution_id = transition.id

        deficiency = TestDeficiency(
            test_run_id=run_id,
            transition_execution_id=transition_execution_id,
            severity=severity_map.get(d.severity, DeficiencySeverity.MEDIUM),
            deficiency_type=type_map.get(d.deficiency_type, DeficiencyType.FUNCTIONAL),
            title=d.title,
            description=d.description,
            screenshot_urls=[str(sid) for sid in d.screenshot_ids],
            reproduction_steps=d.reproduction_steps,
            status=DeficiencyStatus.NEW,
            environment_info=d.metadata.get("environment", {}),
            custom_fields=d.metadata,
            first_seen_at=datetime.utcnow(),
            last_seen_at=datetime.utcnow(),
        )
        db.add(deficiency)
        await db.flush()
        deficiency_ids.append(deficiency.id)

    # Update test run deficiency count
    test_run.deficiencies_found += len(batch_in.deficiencies)

    await db.commit()

    logger.info(
        "deficiencies_recorded",
        run_id=str(run_id),
        count=len(deficiency_ids),
    )

    return DeficiencyBatchResponse(
        run_id=run_id,
        deficiencies_recorded=len(deficiency_ids),
        deficiency_ids=deficiency_ids,
    )


@router.put("/runs/{run_id}/coverage", response_model=CoverageUpdateResponse)
async def update_coverage(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_auth: tuple[User, Any] = Depends(get_runner_user),
    run_id: UUID,
    coverage_in: CoverageUpdate,
) -> Any:
    """
    Update coverage metrics for the test run.

    **Authentication:** Runner token required

    Updates the coverage data for a test run. This endpoint is typically called
    periodically during the run (every 10-20 transitions) and at completion.

    **Example Request:**
    ```json
    {
      "total_transitions_executed": 42,
      "unique_transitions_covered": 18,
      "coverage_percentage": 75.0,
      "transition_coverage_map": {
        "login_page->dashboard": 5,
        "dashboard->profile_page": 3
      },
      "state_coverage_map": {
        "login_page": 5,
        "dashboard": 12
      },
      "uncovered_transitions": [
        "dashboard->admin_panel"
      ]
    }
    ```

    **Returns:** Confirmation with current coverage percentage
    """
    user, runner_token = runner_auth

    logger.info(
        "update_coverage_requested",
        user_id=str(user.id),
        run_id=str(run_id),
        coverage_percentage=coverage_in.coverage_percentage,
    )

    # Get test run and verify access
    test_run = await get_test_run_with_access(db, run_id, user.id)

    # Update coverage metrics
    test_run.coverage_percentage = Decimal(str(coverage_in.coverage_percentage))
    test_run.total_transitions = coverage_in.total_transitions_executed
    test_run.unique_paths_found = coverage_in.unique_transitions_covered
    test_run.unique_states_visited = len(coverage_in.state_coverage_map)

    # Store detailed coverage data in configuration_snapshot
    test_run.configuration_snapshot = {
        **test_run.configuration_snapshot,
        "coverage_data": {
            "transition_coverage_map": coverage_in.transition_coverage_map,
            "state_coverage_map": coverage_in.state_coverage_map,
            "uncovered_transitions": coverage_in.uncovered_transitions,
        },
    }

    await db.commit()

    logger.info(
        "coverage_updated",
        run_id=str(run_id),
        coverage_percentage=coverage_in.coverage_percentage,
    )

    return CoverageUpdateResponse(
        run_id=run_id,
        coverage_updated=True,
        coverage_percentage=coverage_in.coverage_percentage,
        unique_transitions_covered=coverage_in.unique_transitions_covered,
    )


@router.put("/runs/{run_id}/complete", response_model=TestRunCompleteResponse)
async def complete_test_run(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_auth: tuple[User, Any] = Depends(get_runner_user),
    run_id: UUID,
    complete_in: TestRunComplete,
) -> Any:
    """
    Mark test run as completed and record final metrics.

    **Authentication:** Runner token required

    Finalizes a test run by setting its status and recording final metrics.
    After this call, no further transitions/deficiencies can be reported.

    **Status Values:**
    - `completed`: Normal successful completion
    - `failed`: Run ended due to error
    - `timeout`: Run exceeded max duration
    - `aborted`: User manually stopped the run
    - `crashed`: Runner crashed/disconnected

    **Example Request:**
    ```json
    {
      "status": "completed",
      "ended_at": "2025-11-23T11:30:00Z",
      "final_metrics": {
        "total_transitions_executed": 42,
        "successful_transitions": 38,
        "failed_transitions": 4,
        "coverage_percentage": 75.0,
        "total_deficiencies_found": 2
      },
      "summary": "Completed 42 transitions with 4 failures."
    }
    ```

    **Returns:** Final test run status with duration
    """
    user, runner_token = runner_auth

    logger.info(
        "complete_test_run_requested",
        user_id=str(user.id),
        run_id=str(run_id),
        final_status=complete_in.status,
    )

    # Get test run and verify access
    test_run = await get_test_run_with_access(db, run_id, user.id)

    # Map status strings to enum
    status_map = {
        "completed": TestRunStatus.COMPLETED,
        "failed": TestRunStatus.FAILED,
        "timeout": TestRunStatus.TIMEOUT,
        "aborted": TestRunStatus.CANCELLED,
        "crashed": TestRunStatus.FAILED,
    }

    # Update test run with final status
    test_run.status = status_map.get(complete_in.status, TestRunStatus.COMPLETED)
    test_run.completed_at = complete_in.ended_at

    # Update metrics from final_metrics
    metrics = complete_in.final_metrics
    test_run.total_transitions = metrics.get(
        "total_transitions_executed", test_run.total_transitions
    )
    test_run.successful_transitions = metrics.get(
        "successful_transitions", test_run.successful_transitions
    )
    test_run.failed_transitions = metrics.get(
        "failed_transitions", test_run.failed_transitions
    )
    test_run.coverage_percentage = Decimal(
        str(metrics.get("coverage_percentage", float(test_run.coverage_percentage)))
    )
    test_run.deficiencies_found = metrics.get(
        "total_deficiencies_found", test_run.deficiencies_found
    )
    test_run.error_summary = complete_in.summary

    # Store final metrics in configuration_snapshot
    test_run.configuration_snapshot = {
        **test_run.configuration_snapshot,
        "final_metrics": complete_in.final_metrics,
    }

    await db.commit()

    # Calculate duration
    duration_seconds = 0
    if test_run.started_at and test_run.completed_at:
        duration_seconds = int(
            (test_run.completed_at - test_run.started_at).total_seconds()
        )

    logger.info(
        "test_run_completed",
        run_id=str(run_id),
        status=test_run.status,
        duration_seconds=duration_seconds,
    )

    return TestRunCompleteResponse(
        run_id=test_run.id,
        status=test_run.status,
        started_at=test_run.started_at,
        ended_at=test_run.completed_at,
        duration_seconds=duration_seconds,
        final_metrics=complete_in.final_metrics,
    )


@router.post(
    "/runs/{run_id}/screenshots",
    response_model=ScreenshotUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_screenshot(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_auth: tuple[User, Any] = Depends(get_runner_user),
    run_id: UUID,
    metadata: str = Form(..., description="JSON metadata for screenshot"),
    image: UploadFile = File(..., description="Screenshot image file (PNG/JPEG)"),
) -> Any:
    """
    Upload screenshot evidence with metadata.

    **Authentication:** Runner token required

    Uploads a screenshot image to object storage (S3/MinIO) and creates a
    database record with metadata. Generates a thumbnail automatically.

    **Visual Regression:** If a `state` is provided in metadata and a baseline
    exists for that state, a visual comparison is automatically performed and
    the result is returned in the response.

    **Content-Type:** multipart/form-data

    **Form Fields:**
    - `metadata`: JSON string with ScreenshotMetadata fields
    - `image`: Binary image file (PNG or JPEG, max 10MB)

    **Screenshot Types:**
    - `error`: Captured on failure
    - `success`: Captured on successful transition
    - `manual`: User-triggered screenshot
    - `periodic`: Automatic periodic capture

    **Example Metadata:**
    ```json
    {
      "screenshot_id": "screenshot-uuid-123",
      "sequence_number": 5,
      "transition_sequence_number": 2,
      "state": "profile_page",
      "screenshot_type": "error",
      "timestamp": "2025-11-23T10:30:15Z",
      "width": 1920,
      "height": 1080
    }
    ```

    **Returns:** Screenshot URLs (full image + thumbnail), plus visual comparison
    result if baseline exists
    """
    user, runner_token = runner_auth

    logger.info(
        "upload_screenshot_requested",
        user_id=str(user.id),
        run_id=str(run_id),
        filename=image.filename,
        content_type=image.content_type,
    )

    # Validate content type
    if image.content_type not in ["image/png", "image/jpeg", "image/jpg"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image type: {image.content_type}. Only PNG and JPEG are allowed.",
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

    # Get test run and verify access
    test_run = await get_test_run_with_access(db, run_id, user.id)

    # Read image data
    image_data = await image.read()
    file_size = len(image_data)

    # Upload to S3/MinIO
    screenshot_key = f"testing/{run_id}/screenshots/{screenshot_meta.sequence_number}_{screenshot_meta.screenshot_id}.png"

    try:
        # Upload main image
        image_file = io.BytesIO(image_data)
        object_storage.backend.upload_file(
            image_file,
            screenshot_key,
            content_type=image.content_type or "image/png",
        )

        # Generate thumbnail
        thumbnail_url = None
        try:
            pil_image = Image.open(io.BytesIO(image_data))
            thumbnail = pil_image.copy()
            thumbnail.thumbnail((200, 200), Image.Resampling.LANCZOS)

            thumb_buffer = io.BytesIO()
            thumbnail.save(thumb_buffer, format="PNG")
            thumb_buffer.seek(0)

            thumbnail_key = f"testing/{run_id}/thumbnails/{screenshot_meta.sequence_number}_{screenshot_meta.screenshot_id}_thumb.png"
            object_storage.backend.upload_file(
                thumb_buffer,
                thumbnail_key,
                content_type="image/png",
            )
            thumbnail_url = object_storage.generate_presigned_url(
                thumbnail_key, expiration=7 * 24 * 3600
            )
        except Exception as thumb_error:
            logger.warning(
                "thumbnail_generation_failed",
                run_id=str(run_id),
                screenshot_id=str(screenshot_meta.screenshot_id),
                error=str(thumb_error),
            )

        # Generate presigned URL for main image
        image_url = object_storage.generate_presigned_url(
            screenshot_key, expiration=7 * 24 * 3600
        )

        # Map screenshot type string to enum
        screenshot_type_map = {
            "state_verification": TestScreenshotType.STATE_VERIFICATION,
            "action_result": TestScreenshotType.ACTION_RESULT,
            "failure": TestScreenshotType.FAILURE,
            "error": TestScreenshotType.FAILURE,
            "before_action": TestScreenshotType.BEFORE_ACTION,
            "after_action": TestScreenshotType.AFTER_ACTION,
            "success": TestScreenshotType.ACTION_RESULT,
            "manual": TestScreenshotType.STATE_VERIFICATION,
            "periodic": TestScreenshotType.STATE_VERIFICATION,
        }
        db_screenshot_type = screenshot_type_map.get(
            screenshot_meta.screenshot_type, TestScreenshotType.STATE_VERIFICATION
        )

        # Find associated transition execution if provided
        transition_execution_id = None
        if screenshot_meta.transition_sequence_number:
            result = await db.execute(
                select(TransitionExecution).filter(
                    and_(
                        TransitionExecution.test_run_id == run_id,
                        TransitionExecution.sequence_number
                        == screenshot_meta.transition_sequence_number,
                    )
                )
            )
            transition = result.scalar_one_or_none()
            if transition:
                transition_execution_id = transition.id

        # Create TestScreenshot database record
        test_screenshot = TestScreenshot(
            id=screenshot_meta.screenshot_id,
            test_run_id=run_id,
            transition_execution_id=transition_execution_id,
            screenshot_type=db_screenshot_type,
            storage_path=screenshot_key,
            width=screenshot_meta.width,
            height=screenshot_meta.height,
            captured_at=screenshot_meta.timestamp,
            screenshot_metadata={
                "sequence_number": screenshot_meta.sequence_number,
                "original_filename": image.filename,
                "content_type": image.content_type,
                "file_size_bytes": file_size,
                "thumbnail_url": thumbnail_url,
                **screenshot_meta.metadata,
            },
            state_name=screenshot_meta.state,  # For visual regression baseline matching
        )
        db.add(test_screenshot)
        await db.flush()

        logger.info(
            "screenshot_uploaded",
            run_id=str(run_id),
            screenshot_id=str(screenshot_meta.screenshot_id),
            file_size=file_size,
            state_name=screenshot_meta.state,
        )

        # Perform visual comparison if state is provided
        visual_comparison_result = None
        if screenshot_meta.state:
            try:
                comparison_service = VisualComparisonService()
                comparison = await comparison_service.compare_screenshot(
                    db=db,
                    screenshot_id=test_screenshot.id,
                    # baseline_id will be auto-detected based on state_name
                )

                if comparison:
                    # Get presigned URL for diff image if available
                    diff_url = None
                    if comparison.diff_image_path:
                        try:
                            diff_url = object_storage.generate_presigned_url(
                                comparison.diff_image_path
                            )
                        except Exception:
                            pass

                    visual_comparison_result = VisualComparisonSummary(
                        comparison_id=comparison.id,
                        baseline_id=comparison.baseline_id,
                        similarity_score=comparison.similarity_score,
                        threshold=comparison.threshold_used,
                        passed=comparison.status == "passed",
                        status=comparison.status,
                        diff_image_url=diff_url,
                        diff_region_count=comparison.diff_region_count,
                    )

                    logger.info(
                        "visual_comparison_completed",
                        run_id=str(run_id),
                        screenshot_id=str(screenshot_meta.screenshot_id),
                        state_name=screenshot_meta.state,
                        similarity_score=comparison.similarity_score,
                        status=comparison.status,
                    )
            except Exception as comparison_error:
                # Don't fail the upload if comparison fails
                logger.warning(
                    "visual_comparison_failed",
                    run_id=str(run_id),
                    screenshot_id=str(screenshot_meta.screenshot_id),
                    state_name=screenshot_meta.state,
                    error=str(comparison_error),
                )

        await db.commit()

        return ScreenshotUploadResponse(
            screenshot_id=screenshot_meta.screenshot_id,
            run_id=run_id,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            uploaded_at=datetime.utcnow(),
            file_size_bytes=file_size,
            state_name=screenshot_meta.state,
            visual_comparison=visual_comparison_result,
        )

    except Exception as e:
        logger.error(
            "screenshot_upload_failed",
            run_id=str(run_id),
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload screenshot: {str(e)}",
        )


# ============================================================================
# Web Frontend → Backend Endpoints (Querying)
# ============================================================================


@router.get("/runs", response_model=TestRunListResponse)
async def list_test_runs(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID = Query(..., description="Filter by project ID"),
    run_status: str | None = Query(None, description="Filter by status"),
    runner_hostname: str | None = Query(None, description="Filter by runner hostname"),
    start_date: datetime | None = Query(
        None, description="Filter runs started after this date"
    ),
    end_date: datetime | None = Query(
        None, description="Filter runs started before this date"
    ),
    limit: int = Query(50, ge=1, le=200, description="Page size (max 200)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    sort_by: str = Query("started_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order (asc/desc)"),
) -> Any:
    """
    List all test runs for a project with filtering and pagination.

    **Authentication:** JWT token required

    Returns a paginated list of test runs with basic statistics. Users can only
    see runs for projects they have access to.

    **Query Parameters:**
    - `project_id` (required): Project to filter by
    - `run_status`: Filter by run status (running, completed, failed, timeout, aborted)
    - `runner_hostname`: Filter by runner machine hostname
    - `start_date`: Filter runs started after this date (ISO 8601)
    - `end_date`: Filter runs started before this date (ISO 8601)
    - `limit`: Number of results per page (default: 50, max: 200)
    - `offset`: Number of results to skip (default: 0)
    - `sort_by`: Field to sort by (started_at, ended_at, coverage_percentage)
    - `sort_order`: Sort direction (asc or desc)

    **Returns:** Paginated list of test runs with statistics
    """
    logger.info(
        "list_test_runs_requested",
        user_id=str(current_user.id),
        project_id=project_id,
        status=run_status,
        limit=limit,
        offset=offset,
    )

    # Check user has access to project
    await verify_project_access(db, project_id, current_user.id)

    # Build query with filters
    query = select(SoftwareTestRun).filter(SoftwareTestRun.project_id == project_id)

    # Apply optional filters
    if run_status:
        status_map = {
            "running": TestRunStatus.RUNNING,
            "completed": TestRunStatus.COMPLETED,
            "failed": TestRunStatus.FAILED,
            "timeout": TestRunStatus.TIMEOUT,
            "aborted": TestRunStatus.CANCELLED,
        }
        if run_status in status_map:
            query = query.filter(SoftwareTestRun.status == status_map[run_status])

    if runner_hostname:
        query = query.filter(
            SoftwareTestRun.runner_metadata["hostname"].astext == runner_hostname
        )

    if start_date:
        query = query.filter(SoftwareTestRun.started_at >= start_date)

    if end_date:
        query = query.filter(SoftwareTestRun.started_at <= end_date)

    # Apply sorting
    sort_column = getattr(SoftwareTestRun, sort_by, SoftwareTestRun.started_at)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Get total count
    count_result = await db.execute(
        select(func.count(SoftwareTestRun.id)).filter(
            SoftwareTestRun.project_id == project_id
        )
    )
    total = count_result.scalar() or 0

    # Apply pagination
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    runs = result.scalars().all()

    # Build response
    run_responses = []
    for run in runs:
        duration_seconds = None
        if run.started_at and run.completed_at:
            duration_seconds = int((run.completed_at - run.started_at).total_seconds())

        run_responses.append(
            TestRunResponse(
                run_id=run.id,
                project_id=run.project_id,
                run_name=run.configuration_snapshot.get("run_name", f"Run {run.id}"),
                status=run.status,
                started_at=run.started_at,
                ended_at=run.completed_at,
                duration_seconds=duration_seconds,
                runner_metadata=run.runner_metadata,
                created_at=run.created_at,
            )
        )

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
    run_id: UUID,
    include_transitions: bool = Query(False, description="Include transition list"),
    include_deficiencies: bool = Query(False, description="Include deficiency list"),
    include_screenshots: bool = Query(False, description="Include screenshot list"),
) -> Any:
    """
    Get detailed information about a specific test run.

    **Authentication:** JWT token required

    Returns comprehensive test run details including optional related data
    (transitions, deficiencies, screenshots) based on query parameters.

    **Query Parameters:**
    - `include_transitions`: Include full list of transitions (default: false)
    - `include_deficiencies`: Include full list of deficiencies (default: false)
    - `include_screenshots`: Include full list of screenshots (default: false)

    **Returns:** Detailed test run information
    """
    logger.info(
        "get_test_run_requested",
        user_id=str(current_user.id),
        run_id=str(run_id),
        include_transitions=include_transitions,
        include_deficiencies=include_deficiencies,
    )

    # Get test run with access check
    test_run = await get_test_run_with_access(db, run_id, current_user.id)

    # Calculate duration
    duration_seconds = None
    if test_run.started_at and test_run.completed_at:
        duration_seconds = int(
            (test_run.completed_at - test_run.started_at).total_seconds()
        )

    # Prepare optional data
    transitions_list = None
    deficiencies_list = None
    screenshots_list = None

    if include_transitions:
        result = await db.execute(
            select(TransitionExecution)
            .filter(TransitionExecution.test_run_id == run_id)
            .order_by(TransitionExecution.sequence_number)
        )
        transitions = result.scalars().all()
        transitions_list = [
            {
                "transition_id": str(t.id),
                "sequence_number": t.sequence_number,
                "from_state": t.source_state,
                "to_state": t.target_state,
                "transition_name": t.transition_name,
                "status": t.status,
                "duration_ms": t.execution_time_ms,
                "started_at": t.started_at.isoformat() if t.started_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "error_message": t.error_message,
            }
            for t in transitions
        ]

    if include_deficiencies:
        result = await db.execute(
            select(TestDeficiency)
            .filter(TestDeficiency.test_run_id == run_id)
            .order_by(TestDeficiency.created_at.desc())
        )
        deficiencies = result.scalars().all()
        deficiencies_list = [
            {
                "deficiency_id": str(d.id),
                "title": d.title,
                "severity": d.severity,
                "status": d.status,
                "deficiency_type": d.deficiency_type,
                "created_at": d.created_at.isoformat(),
            }
            for d in deficiencies
        ]

    return TestRunDetail(
        run_id=test_run.id,
        project_id=test_run.project_id,
        run_name=test_run.configuration_snapshot.get("run_name", f"Run {test_run.id}"),
        description=test_run.configuration_snapshot.get("description"),
        status=test_run.status,
        started_at=test_run.started_at,
        ended_at=test_run.completed_at,
        duration_seconds=duration_seconds,
        runner_metadata=test_run.runner_metadata,
        workflow_metadata=test_run.configuration_snapshot.get("workflow_metadata", {}),
        configuration_snapshot=test_run.configuration_snapshot,
        created_by=None,
        final_metrics={
            "total_transitions_executed": test_run.total_transitions,
            "successful_transitions": test_run.successful_transitions,
            "failed_transitions": test_run.failed_transitions,
            "coverage_percentage": float(test_run.coverage_percentage),
            "deficiencies_found": test_run.deficiencies_found,
        },
        coverage_data={
            "percentage": float(test_run.coverage_percentage),
            "unique_paths": test_run.unique_paths_found,
            "unique_states": test_run.unique_states_visited,
        },
        created_at=test_run.created_at,
        updated_at=test_run.updated_at,
        transitions=transitions_list,
        deficiencies=deficiencies_list,
        screenshots=screenshots_list,
    )


@router.get("/deficiencies", response_model=DeficiencyListResponse)
async def list_deficiencies(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID = Query(..., description="Filter by project ID"),
    deficiency_status: str | None = Query(None, description="Filter by status"),
    severity: str | None = Query(None, description="Filter by severity"),
    deficiency_type: str | None = Query(None, description="Filter by type"),
    run_id: UUID | None = Query(None, description="Filter by specific test run"),
    search: str | None = Query(None, description="Search in title/description"),
    limit: int = Query(50, ge=1, le=200, description="Page size (max 200)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order (asc/desc)"),
) -> Any:
    """
    List all deficiencies across test runs with filtering.

    **Authentication:** JWT token required

    Returns a paginated list of deficiencies with summary statistics. Users can
    filter by various criteria to focus on specific issues.

    **Query Parameters:**
    - `project_id` (required): Project to filter by
    - `deficiency_status`: Filter by status (open, in_progress, resolved, closed, wont_fix)
    - `severity`: Filter by severity (critical, high, medium, low, informational)
    - `deficiency_type`: Filter by type (functional_bug, ui_issue, performance, etc.)
    - `run_id`: Filter by specific test run UUID
    - `search`: Search text in title/description
    - `limit`: Number of results per page (default: 50, max: 200)
    - `offset`: Number of results to skip (default: 0)
    - `sort_by`: Field to sort by (created_at, severity, status)
    - `sort_order`: Sort direction (asc or desc)

    **Returns:** Paginated list of deficiencies with summary statistics
    """
    logger.info(
        "list_deficiencies_requested",
        user_id=str(current_user.id),
        project_id=project_id,
        status=deficiency_status,
        severity=severity,
    )

    # Check user has access to project
    await verify_project_access(db, project_id, current_user.id)

    # Build subquery for test runs in this project
    project_runs = select(SoftwareTestRun.id).filter(
        SoftwareTestRun.project_id == project_id
    )

    # Build query
    query = select(TestDeficiency).filter(TestDeficiency.test_run_id.in_(project_runs))

    # Apply filters
    if deficiency_status:
        status_map = {
            "open": DeficiencyStatus.NEW,
            "new": DeficiencyStatus.NEW,
            "in_progress": DeficiencyStatus.IN_PROGRESS,
            "resolved": DeficiencyStatus.RESOLVED,
            "closed": DeficiencyStatus.CLOSED,
            "wont_fix": DeficiencyStatus.WONT_FIX,
        }
        if deficiency_status in status_map:
            query = query.filter(TestDeficiency.status == status_map[deficiency_status])

    if severity:
        severity_map = {
            "critical": DeficiencySeverity.CRITICAL,
            "high": DeficiencySeverity.HIGH,
            "medium": DeficiencySeverity.MEDIUM,
            "low": DeficiencySeverity.LOW,
            "informational": DeficiencySeverity.INFO,
        }
        if severity in severity_map:
            query = query.filter(TestDeficiency.severity == severity_map[severity])

    if deficiency_type:
        type_map = {
            "functional_bug": DeficiencyType.FUNCTIONAL,
            "ui_issue": DeficiencyType.VISUAL,
            "performance": DeficiencyType.PERFORMANCE,
            "crash": DeficiencyType.CRASH,
            "security": DeficiencyType.SECURITY,
            "accessibility": DeficiencyType.ACCESSIBILITY,
        }
        if deficiency_type in type_map:
            query = query.filter(
                TestDeficiency.deficiency_type == type_map[deficiency_type]
            )

    if run_id:
        query = query.filter(TestDeficiency.test_run_id == run_id)

    if search:
        query = query.filter(
            or_(
                TestDeficiency.title.ilike(f"%{search}%"),
                TestDeficiency.description.ilike(f"%{search}%"),
            )
        )

    # Get total count
    count_query = select(func.count(TestDeficiency.id)).filter(
        TestDeficiency.test_run_id.in_(project_runs)
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Apply sorting
    sort_column = getattr(TestDeficiency, sort_by, TestDeficiency.created_at)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Apply pagination
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    deficiencies = result.scalars().all()

    # Build response
    deficiency_responses = [
        DeficiencyResponse(
            deficiency_id=d.id,
            run_id=d.test_run_id,
            title=d.title,
            description=d.description,
            severity=d.severity,
            status=d.status,
            deficiency_type=d.deficiency_type,
            state=None,
            transition_sequence_number=None,
            screenshot_count=len(d.screenshot_urls) if d.screenshot_urls else 0,
            created_at=d.created_at,
            updated_at=d.updated_at,
            run_info=None,
        )
        for d in deficiencies
    ]

    # Calculate summary statistics
    summary_result = await db.execute(
        select(
            TestDeficiency.status,
            TestDeficiency.severity,
            func.count(TestDeficiency.id),
        )
        .filter(TestDeficiency.test_run_id.in_(project_runs))
        .group_by(TestDeficiency.status, TestDeficiency.severity)
    )
    summary_rows = summary_result.all()

    by_status: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for row in summary_rows:
        status_val = row[0] if row[0] else "unknown"
        severity_val = row[1] if row[1] else "unknown"
        count = row[2]
        by_status[status_val] = by_status.get(status_val, 0) + count
        by_severity[severity_val] = by_severity.get(severity_val, 0) + count

    return DeficiencyListResponse(
        deficiencies=deficiency_responses,
        pagination={
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        },
        summary={
            "total_deficiencies": total,
            "by_status": by_status,
            "by_severity": by_severity,
        },
    )


@router.get("/deficiencies/{deficiency_id}", response_model=DeficiencyDetail)
async def get_deficiency(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    deficiency_id: UUID,
) -> Any:
    """
    Get detailed information about a specific deficiency.

    **Authentication:** JWT token required

    Returns comprehensive deficiency details including screenshots, reproduction
    steps, comments, and assignment information.

    **Returns:** Detailed deficiency information
    """
    logger.info(
        "get_deficiency_requested",
        user_id=str(current_user.id),
        deficiency_id=str(deficiency_id),
    )

    # Get deficiency
    result = await db.execute(
        select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
    )
    deficiency = result.scalar_one_or_none()

    if not deficiency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Deficiency not found",
        )

    # Get test run to verify project access
    await get_test_run_with_access(db, deficiency.test_run_id, current_user.id)

    # Get assigned user info if assigned
    assigned_to_info = None
    if deficiency.assigned_to_user_id:
        user_result = await db.execute(
            select(User).filter(User.id == deficiency.assigned_to_user_id)  # type: ignore[arg-type]
        )
        assigned_user = user_result.scalar_one_or_none()
        if assigned_user:
            assigned_to_info = {
                "user_id": str(assigned_user.id),
                "email": assigned_user.email,
            }

    return DeficiencyDetail(
        deficiency_id=deficiency.id,
        run_id=deficiency.test_run_id,
        title=deficiency.title,
        description=deficiency.description,
        severity=deficiency.severity,
        status=deficiency.status,
        deficiency_type=deficiency.deficiency_type,
        state=None,
        transition_sequence_number=None,
        screenshot_count=(
            len(deficiency.screenshot_urls) if deficiency.screenshot_urls else 0
        ),
        created_at=deficiency.created_at,
        updated_at=deficiency.updated_at,
        reproduction_steps=deficiency.reproduction_steps,
        screenshots=deficiency.screenshot_urls,
        metadata=deficiency.custom_fields,
        assigned_to=assigned_to_info,
        resolution_notes=deficiency.resolution,
        run_info=None,
        comments=[],
    )


@router.patch("/deficiencies/{deficiency_id}", response_model=DeficiencyDetail)
async def update_deficiency(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    deficiency_id: UUID,
    update_in: DeficiencyUpdate,
) -> Any:
    """
    Update deficiency status, severity, or assignment.

    **Authentication:** JWT token required

    Allows updating deficiency metadata such as status, severity, assignment,
    and resolution notes. All changes are audited with user ID and timestamp.

    **Example Request:**
    ```json
    {
      "status": "in_progress",
      "severity": "high",
      "assigned_to_user_id": "user-uuid-789",
      "resolution_notes": "Fixed in commit abc123. Waiting for deployment."
    }
    ```

    **Returns:** Updated deficiency information
    """
    logger.info(
        "update_deficiency_requested",
        user_id=str(current_user.id),
        deficiency_id=str(deficiency_id),
        updates=update_in.model_dump(exclude_unset=True),
    )

    # Get deficiency
    result = await db.execute(
        select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
    )
    deficiency = result.scalar_one_or_none()

    if not deficiency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Deficiency not found",
        )

    # Verify project access
    await get_test_run_with_access(db, deficiency.test_run_id, current_user.id)

    # Status map
    status_map = {
        "open": DeficiencyStatus.NEW,
        "new": DeficiencyStatus.NEW,
        "in_progress": DeficiencyStatus.IN_PROGRESS,
        "resolved": DeficiencyStatus.RESOLVED,
        "closed": DeficiencyStatus.CLOSED,
        "wont_fix": DeficiencyStatus.WONT_FIX,
    }

    # Severity map
    severity_map = {
        "critical": DeficiencySeverity.CRITICAL,
        "high": DeficiencySeverity.HIGH,
        "medium": DeficiencySeverity.MEDIUM,
        "low": DeficiencySeverity.LOW,
        "informational": DeficiencySeverity.INFO,
    }

    # Apply updates
    if update_in.status is not None and update_in.status in status_map:
        deficiency.status = status_map[update_in.status]
        if update_in.status == "resolved":
            deficiency.resolved_at = datetime.utcnow()

    if update_in.severity is not None and update_in.severity in severity_map:
        deficiency.severity = severity_map[update_in.severity]

    if update_in.assigned_to_user_id is not None:
        deficiency.assigned_to_user_id = update_in.assigned_to_user_id
        deficiency.assigned_at = datetime.utcnow()

    if update_in.resolution_notes is not None:
        deficiency.resolution = update_in.resolution_notes

    deficiency.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(deficiency)

    # Get assigned user info if assigned
    assigned_to_info = None
    if deficiency.assigned_to_user_id:
        user_result = await db.execute(
            select(User).filter(User.id == deficiency.assigned_to_user_id)  # type: ignore[arg-type]
        )
        assigned_user = user_result.scalar_one_or_none()
        if assigned_user:
            assigned_to_info = {
                "user_id": str(assigned_user.id),
                "email": assigned_user.email,
            }

    return DeficiencyDetail(
        deficiency_id=deficiency.id,
        run_id=deficiency.test_run_id,
        title=deficiency.title,
        description=deficiency.description,
        severity=deficiency.severity,
        status=deficiency.status,
        deficiency_type=deficiency.deficiency_type,
        state=None,
        transition_sequence_number=None,
        screenshot_count=(
            len(deficiency.screenshot_urls) if deficiency.screenshot_urls else 0
        ),
        created_at=deficiency.created_at,
        updated_at=deficiency.updated_at,
        reproduction_steps=deficiency.reproduction_steps,
        screenshots=deficiency.screenshot_urls,
        metadata=deficiency.custom_fields,
        assigned_to=assigned_to_info,
        resolution_notes=deficiency.resolution,
        run_info=None,
        comments=[],
    )


@router.get("/coverage-trends/{project_id}", response_model=CoverageTrendResponse)
async def get_coverage_trends(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID,
    start_date: datetime | None = Query(None, description="Start of date range"),
    end_date: datetime | None = Query(None, description="End of date range"),
    granularity: str = Query(
        "daily", description="Granularity (daily, weekly, monthly)"
    ),
    workflow_id: str | None = Query(None, description="Filter by specific workflow"),
) -> Any:
    """
    Get coverage trends over time for historical analysis.

    **Authentication:** JWT token required

    Returns time-series data showing how test coverage has evolved over time.
    Useful for tracking quality improvements and identifying trends.

    **Query Parameters:**
    - `start_date`: Start of date range (ISO 8601)
    - `end_date`: End of date range (ISO 8601)
    - `granularity`: Data aggregation level (daily, weekly, monthly)
    - `workflow_id`: Filter by specific workflow UUID

    **Returns:** Time-series coverage data with trend analysis
    """
    logger.info(
        "get_coverage_trends_requested",
        user_id=str(current_user.id),
        project_id=project_id,
        granularity=granularity,
    )

    # Validate granularity
    if granularity not in ["daily", "weekly", "monthly"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Granularity must be one of: daily, weekly, monthly",
        )

    # Check user has access to project
    await verify_project_access(db, project_id, current_user.id)

    # Build query for test runs
    query = select(SoftwareTestRun).filter(
        SoftwareTestRun.project_id == project_id,
        SoftwareTestRun.status == TestRunStatus.COMPLETED,
    )

    if workflow_id:
        query = query.filter(SoftwareTestRun.workflow_id == workflow_id)

    if start_date:
        query = query.filter(SoftwareTestRun.started_at >= start_date)

    if end_date:
        query = query.filter(SoftwareTestRun.started_at <= end_date)

    query = query.order_by(SoftwareTestRun.started_at.asc())

    result = await db.execute(query)
    runs = result.scalars().all()

    # Build data points by grouping runs by date
    from collections import defaultdict

    data_by_date: dict[str, list[SoftwareTestRun]] = defaultdict(list)
    for run in runs:
        if granularity == "daily":
            date_key = run.started_at.strftime("%Y-%m-%d")
        elif granularity == "weekly":
            # Get start of week
            week_start = run.started_at - timedelta(days=run.started_at.weekday())
            date_key = week_start.strftime("%Y-%m-%d")
        else:  # monthly
            date_key = run.started_at.strftime("%Y-%m-01")
        data_by_date[date_key].append(run)

    # Build data points
    from app.schemas.testing import CoverageTrendDataPoint

    data_points = []
    for date_key, date_runs in sorted(data_by_date.items()):
        coverages = [float(r.coverage_percentage) for r in date_runs]
        transitions = sum(r.total_transitions for r in date_runs)
        unique_transitions = sum(r.unique_paths_found for r in date_runs)

        data_points.append(
            CoverageTrendDataPoint(
                date=date_key,
                runs_count=len(date_runs),
                avg_coverage_percentage=(
                    sum(coverages) / len(coverages) if coverages else 0
                ),
                max_coverage_percentage=max(coverages) if coverages else 0,
                min_coverage_percentage=min(coverages) if coverages else 0,
                total_transitions_executed=transitions,
                unique_transitions_covered=unique_transitions,
            )
        )

    # Calculate overall stats
    all_coverages = [float(r.coverage_percentage) for r in runs]
    trend = "stable"
    if len(data_points) >= 2:
        first_avg = data_points[0].avg_coverage_percentage
        last_avg = data_points[-1].avg_coverage_percentage
        if last_avg > first_avg + 5:
            trend = "increasing"
        elif last_avg < first_avg - 5:
            trend = "decreasing"

    return CoverageTrendResponse(
        project_id=project_id,
        start_date=(
            start_date.strftime("%Y-%m-%d")
            if start_date
            else (runs[0].started_at.strftime("%Y-%m-%d") if runs else "")
        ),
        end_date=(
            end_date.strftime("%Y-%m-%d")
            if end_date
            else (runs[-1].started_at.strftime("%Y-%m-%d") if runs else "")
        ),
        granularity=granularity,
        data_points=data_points,
        overall_stats={
            "total_runs": len(runs),
            "avg_coverage_percentage": (
                sum(all_coverages) / len(all_coverages) if all_coverages else 0
            ),
            "coverage_trend": trend,
            "total_unique_transitions": sum(r.unique_paths_found for r in runs),
        },
    )


@router.get("/reliability/{workflow_id}", response_model=ReliabilityResponse)
async def get_transition_reliability(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    workflow_id: str,
    project_id: UUID = Query(..., description="Project identifier"),
    start_date: datetime | None = Query(None, description="Start of date range"),
    end_date: datetime | None = Query(None, description="End of date range"),
    min_executions: int = Query(5, ge=1, description="Minimum executions to include"),
) -> Any:
    """
    Get transition reliability statistics for a workflow.

    **Authentication:** JWT token required

    Returns detailed reliability statistics for each transition in a workflow,
    including success rates, failure modes, and performance metrics.

    **Query Parameters:**
    - `project_id` (required): Project identifier
    - `start_date`: Start of date range (ISO 8601)
    - `end_date`: End of date range (ISO 8601)
    - `min_executions`: Only show transitions executed at least N times (default: 5)

    **Returns:** Per-transition reliability statistics and overall metrics
    """
    logger.info(
        "get_transition_reliability_requested",
        user_id=str(current_user.id),
        workflow_id=workflow_id,
        project_id=project_id,
    )

    # Check user has access to project
    await verify_project_access(db, project_id, current_user.id)

    # Get test runs for this workflow and project
    runs_query = select(SoftwareTestRun.id).filter(
        SoftwareTestRun.project_id == project_id,
        SoftwareTestRun.workflow_id == workflow_id,
    )

    if start_date:
        runs_query = runs_query.filter(SoftwareTestRun.started_at >= start_date)

    if end_date:
        runs_query = runs_query.filter(SoftwareTestRun.started_at <= end_date)

    # Get all transitions for these runs
    result = await db.execute(
        select(TransitionExecution).filter(
            TransitionExecution.test_run_id.in_(runs_query)
        )
    )
    transitions = result.scalars().all()

    # Group transitions by transition_id
    from collections import defaultdict

    transition_groups: dict[str, list[TransitionExecution]] = defaultdict(list)
    for t in transitions:
        transition_groups[t.transition_id].append(t)

    # Build statistics
    from app.schemas.testing import TransitionReliabilityStats

    transition_stats = []
    total_success_rate: float = 0.0
    most_reliable = None
    least_reliable = None
    max_success_rate: float = -1.0
    min_success_rate: float = 101.0

    for transition_id, group in transition_groups.items():
        if len(group) < min_executions:
            continue

        successful = sum(
            1 for t in group if t.status == TransitionExecutionStatus.SUCCESS
        )
        failed = len(group) - successful
        success_rate = (successful / len(group)) * 100 if group else 0

        durations = [
            t.execution_time_ms for t in group if t.execution_time_ms is not None
        ]
        avg_duration = sum(durations) // len(durations) if durations else 0
        sorted_durations = sorted(durations)
        median_duration = (
            sorted_durations[len(sorted_durations) // 2] if sorted_durations else 0
        )
        p95_duration = (
            sorted_durations[int(len(sorted_durations) * 0.95)]
            if sorted_durations
            else 0
        )

        # Get failure modes
        failure_counts: dict[str, int] = defaultdict(int)
        for t in group:
            if t.status != TransitionExecutionStatus.SUCCESS and t.error_type:
                failure_counts[t.error_type] += 1

        failure_modes = [
            {
                "error_type": error_type,
                "count": count,
                "percentage": (count / failed * 100) if failed > 0 else 0,
            }
            for error_type, count in failure_counts.items()
        ]

        # Get from/to state from first transition
        first_t = group[0]
        stats = TransitionReliabilityStats(
            transition_name=first_t.transition_name or transition_id,
            from_state=first_t.source_state or "",
            to_state=first_t.target_state or "",
            total_executions=len(group),
            successful_executions=successful,
            failed_executions=failed,
            success_rate=success_rate,
            avg_duration_ms=avg_duration,
            median_duration_ms=median_duration,
            p95_duration_ms=p95_duration,
            failure_modes=failure_modes,
        )
        transition_stats.append(stats)
        total_success_rate += success_rate

        if success_rate > max_success_rate:
            max_success_rate = success_rate
            most_reliable = stats.transition_name
        if success_rate < min_success_rate:
            min_success_rate = success_rate
            least_reliable = stats.transition_name

    avg_success_rate = (
        total_success_rate / len(transition_stats) if transition_stats else 0
    )

    return ReliabilityResponse(
        workflow_id=workflow_id,
        workflow_name=None,
        project_id=project_id,
        date_range={
            "start": start_date.strftime("%Y-%m-%d") if start_date else "",
            "end": end_date.strftime("%Y-%m-%d") if end_date else "",
        },
        transition_stats=transition_stats,
        overall_reliability={
            "total_transitions_analyzed": len(transition_stats),
            "avg_success_rate": avg_success_rate,
            "most_reliable_transition": most_reliable,
            "least_reliable_transition": least_reliable,
        },
    )


@router.post(
    "/deficiencies/{deficiency_id}/comments",
    response_model=DeficiencyCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_deficiency_comment(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    deficiency_id: UUID,
    comment_in: DeficiencyCommentCreate,
) -> Any:
    """
    Add a comment to a deficiency for team collaboration.

    **Authentication:** JWT token required

    Allows team members to discuss deficiencies, share insights, and coordinate
    resolution efforts. Comments support @mentions and attachments.

    **Example Request:**
    ```json
    {
      "comment": "I can reproduce this consistently on Windows. Adding to sprint backlog.",
      "metadata": {
        "mentioned_users": ["user-uuid-123"],
        "attached_file_url": "https://..."
      }
    }
    ```

    **Returns:** Created comment with user information
    """
    logger.info(
        "add_deficiency_comment_requested",
        user_id=str(current_user.id),
        deficiency_id=str(deficiency_id),
    )

    # Get deficiency and verify access
    result = await db.execute(
        select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
    )
    deficiency = result.scalar_one_or_none()
    if not deficiency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Deficiency not found"
        )

    # Verify user has access to the project through the test run
    await get_test_run_with_access(db, deficiency.test_run_id, current_user.id)

    # Generate unique comment ID
    comment_id = uuid4()

    # Create comment structure
    new_comment = {
        "id": str(comment_id),
        "user_id": str(current_user.id),
        "user_email": current_user.email,
        "user_full_name": getattr(current_user, "full_name", None),
        "comment": comment_in.comment,
        "metadata": comment_in.metadata,
        "created_at": datetime.utcnow().isoformat(),
    }

    # Store comments in custom_fields under "comments" key
    custom_fields = dict(deficiency.custom_fields) if deficiency.custom_fields else {}
    comments = custom_fields.get("comments", [])
    comments.append(new_comment)
    custom_fields["comments"] = comments

    # Update the deficiency
    deficiency.custom_fields = custom_fields
    deficiency.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(deficiency)

    logger.info(
        "deficiency_comment_added",
        user_id=str(current_user.id),
        deficiency_id=str(deficiency_id),
        comment_id=str(comment_id),
    )

    return DeficiencyCommentResponse(
        comment_id=comment_id,
        deficiency_id=deficiency_id,
        user={
            "user_id": str(current_user.id),
            "email": current_user.email,
            "full_name": getattr(current_user, "full_name", None),
        },
        comment=comment_in.comment,
        created_at=datetime.utcnow(),
    )
