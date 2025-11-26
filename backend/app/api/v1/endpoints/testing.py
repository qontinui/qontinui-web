"""
API endpoints for software testing results.

This module provides REST API endpoints for:
- Runner → Backend: Reporting test results (test runs, transitions, deficiencies, screenshots)
- Web Frontend → Backend: Querying test history and analytics
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import runner as runner_crud
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
)
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
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

# TYPE_CHECKING imports - models are being created by another agent
if TYPE_CHECKING:
    from app.models.test_deficiency import TestDeficiency
    from app.models.test_run import TestRun
    from app.models.test_screenshot import TestScreenshot
    from app.models.test_transition import TestTransition

logger = structlog.get_logger(__name__)
router = APIRouter()

# HTTP Bearer scheme for runner token authentication
security = HTTPBearer()


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
    result = await db.execute(select(User).where(User.id == runner_token.user_id))
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

    # TODO: Check user has access to project
    # TODO: Implement when TestRun model is available
    # For now, return a placeholder response
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestRun model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Implement when TestTransition model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestTransition model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Implement when TestDeficiency model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestDeficiency model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Implement when TestRun model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestRun model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Implement when TestRun model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestRun model not yet implemented. This endpoint will be available once models are created.",
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

    **Returns:** Screenshot URLs (full image + thumbnail)
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
    import json

    try:
        metadata_dict = json.loads(metadata)
        screenshot_metadata = ScreenshotMetadata(**metadata_dict)
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

    # TODO: Implement screenshot upload to S3/MinIO
    # TODO: Implement thumbnail generation
    # TODO: Implement when TestScreenshot model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestScreenshot model not yet implemented. This endpoint will be available once models are created.",
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
    status: str | None = Query(None, description="Filter by status"),
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
    - `status`: Filter by run status (running, completed, failed, timeout, aborted)
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
        status=status,
        limit=limit,
        offset=offset,
    )

    # TODO: Check user has access to project
    # TODO: Implement when TestRun model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestRun model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Check user has access to project
    # TODO: Implement when TestRun model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestRun model not yet implemented. This endpoint will be available once models are created.",
    )


@router.get("/deficiencies", response_model=DeficiencyListResponse)
async def list_deficiencies(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID = Query(..., description="Filter by project ID"),
    status: str | None = Query(None, description="Filter by status"),
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
    - `status`: Filter by status (open, in_progress, resolved, closed, wont_fix)
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
        status=status,
        severity=severity,
    )

    # TODO: Check user has access to project
    # TODO: Implement when TestDeficiency model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestDeficiency model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Check user has access to project
    # TODO: Implement when TestDeficiency model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestDeficiency model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Check user has access to project
    # TODO: Implement when TestDeficiency model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="TestDeficiency model not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Check user has access to project
    # TODO: Implement when TestRun model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Coverage trends not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Check user has access to project
    # TODO: Implement when TestTransition model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Reliability statistics not yet implemented. This endpoint will be available once models are created.",
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

    # TODO: Check user has access to project
    # TODO: Implement when DeficiencyComment model is available
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Deficiency comments not yet implemented. This endpoint will be available once models are created.",
    )
