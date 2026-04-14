"""
Config Testing API Endpoints

Endpoints for mock execution and PDF report generation used by the
Config Testing feature (workflow validation with historical data).

Note: This was previously named integration_testing.py but renamed to
config_testing.py to align with Qontinui terminology:
- Config Testing = Mock mode testing with historical data
- QA Testing = Real test runs from the runner (see testing.py)
"""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.api.deps import current_active_user, get_async_db
from app.models.project import Project
from app.models.snapshot import SnapshotRun
from app.models.user import User
from app.services.object_storage import object_storage
from app.services.reports import PDFReportOptions, generate_pdf_report
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from redis import asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

# Redis key prefix for PDF report jobs
PDF_JOB_KEY_PREFIX = "pdf_report:job:"
PDF_JOB_TTL = 86400  # 24 hours

logger = logging.getLogger(__name__)

router = APIRouter()


# Request/Response Models
class MockExecutionRequest(BaseModel):
    """Request for mock execution"""

    project_id: str
    workflow_id: str
    workflow_name: str
    snapshot_run_ids: list[str] = Field(default_factory=list)
    initial_states: list[str] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)


class PDFReportRequest(BaseModel):
    """Request for PDF report generation"""

    execution_result: dict[str, Any] = Field(
        ..., description="Full execution result from config test"
    )
    screenshots_dir: str = Field(..., description="Path to screenshots directory")
    include_screenshots: bool = Field(
        default=True, description="Include screenshot thumbnails"
    )
    include_coverage: bool = Field(
        default=True, description="Include coverage analysis"
    )
    include_timeline: bool = Field(default=True, description="Include action timeline")
    include_recommendations: bool = Field(
        default=True, description="Include recommendations"
    )
    include_appendices: bool = Field(
        default=True, description="Include full screenshots appendix"
    )
    screenshot_quality: str = Field(
        default="medium", description="Screenshot quality: low, medium, high"
    )
    logo_path: str | None = Field(default=None, description="Path to custom logo")
    page_size: str = Field(default="letter", description="Page size: letter or a4")
    title: str | None = Field(default=None, description="Custom report title")


class PDFReportResponse(BaseModel):
    """Response for PDF report generation"""

    status: str
    message: str
    file_size: int | None = None
    generated_at: str


# Global Redis client (set during app startup)
_redis_client: aioredis.Redis | None = None


def set_redis_client(client: aioredis.Redis) -> None:
    """Set the Redis client for job tracking."""
    global _redis_client
    _redis_client = client


async def _update_pdf_job_status(
    report_id: str,
    status: str,
    storage_url: str | None = None,
    file_size: int | None = None,
    error: str | None = None,
) -> None:
    """Update PDF report job status in Redis."""
    if not _redis_client:
        logger.warning("Redis client not configured for PDF job status tracking")
        return

    job_data = {
        "report_id": report_id,
        "status": status,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if storage_url:
        job_data["storage_url"] = storage_url
    if file_size:
        job_data["file_size"] = str(file_size)
    if error:
        job_data["error"] = error

    try:
        await _redis_client.set(
            f"{PDF_JOB_KEY_PREFIX}{report_id}",
            json.dumps(job_data),
            ex=PDF_JOB_TTL,
        )
    except Exception as e:
        logger.error(f"Failed to update PDF job status: {e}")


async def get_pdf_job_status(report_id: str) -> dict[str, Any] | None:
    """Get PDF report job status from Redis."""
    if not _redis_client:
        return None

    try:
        data = await _redis_client.get(f"{PDF_JOB_KEY_PREFIX}{report_id}")
        if data:
            return json.loads(data)  # type: ignore[no-any-return]
    except Exception as e:
        logger.error(f"Failed to get PDF job status: {e}")
    return None


async def verify_project_access(
    db: AsyncSession, project_id: str, user_id: Any
) -> Project:
    """Verify user has access to the project."""
    from uuid import UUID

    try:
        pid = UUID(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project ID format",
        )

    result = await db.execute(select(Project).filter(Project.id == pid))
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


@router.post("/execute", status_code=status.HTTP_200_OK)
async def execute_mock_workflow(
    request: MockExecutionRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> dict[str, Any]:
    """
    Execute a mock workflow using historical data (placeholder endpoint).

    **Authentication:** JWT token required

    This endpoint returns mock execution data for UI visualization.
    Actual config testing execution happens in qontinui-runner using
    the HistoricalDataClient to fetch historical results.

    Note: This is a placeholder that returns simulated data.
    """
    # Verify project access
    await verify_project_access(db, request.project_id, current_user.id)

    logger.info(
        f"Mock execution requested for workflow {request.workflow_name} "
        f"by user {current_user.id}"
    )

    # Return mock data structure for UI visualization
    mock_response = {
        "workflow_id": request.workflow_id,
        "workflow_name": request.workflow_name,
        "start_time": datetime.now().isoformat(),
        "end_time": datetime.now().isoformat(),
        "total_duration_ms": 1500,
        "initial_states": request.initial_states,
        "final_states": request.initial_states,
        "actions": [
            {
                "action_type": action.get("type", "UNKNOWN"),
                "screenshot_path": f"screenshot_{i}.png",
                "action_location": [100, 100],
                "success": True,
                "active_states": request.initial_states,
                "timestamp": datetime.now().isoformat(),
                "duration_ms": 100,
            }
            for i, action in enumerate(request.actions)
        ],
        "success": True,
        "success_rate": 1.0,
        "total_actions": len(request.actions),
        "successful_actions": len(request.actions),
    }

    return mock_response


# PDF Report Generation Endpoints
@router.post("/reports/pdf", status_code=status.HTTP_200_OK)
async def generate_pdf_report_endpoint(
    request: PDFReportRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> StreamingResponse:
    """
    Generate PDF report for config test execution results.

    **Authentication:** JWT token required

    This endpoint accepts execution results and generates a comprehensive PDF report
    including executive summary, coverage analysis, action timeline, and recommendations.

    The PDF is streamed directly for immediate download.
    """
    logger.info(f"PDF report generation requested by user {current_user.id}")

    try:
        # Validate execution result
        execution_result = request.execution_result
        if not execution_result:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Execution result is required",
            )

        # Validate screenshots directory
        screenshots_dir = Path(request.screenshots_dir)
        if not screenshots_dir.exists():
            logger.warning(
                f"Screenshots directory does not exist: {screenshots_dir}. "
                "Report will be generated without screenshots."
            )
            # Create empty directory to avoid errors
            screenshots_dir.mkdir(parents=True, exist_ok=True)

        # Create options
        options = PDFReportOptions(
            include_screenshots=request.include_screenshots,
            include_coverage=request.include_coverage,
            include_timeline=request.include_timeline,
            include_recommendations=request.include_recommendations,
            include_appendices=request.include_appendices,
            screenshot_quality=request.screenshot_quality,
            logo_path=request.logo_path,
            page_size=request.page_size,
            title=request.title,
        )

        # Generate PDF
        workflow_name = execution_result.get("workflow_name", "config_test")
        logger.info(f"Generating PDF report for workflow: {workflow_name}")

        pdf_bytes = generate_pdf_report(execution_result, screenshots_dir, options)

        # Prepare filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{workflow_name}_report_{timestamp}.pdf"

        # Log success
        logger.info(f"PDF report generated successfully. Size: {len(pdf_bytes)} bytes")

        # Return as streaming response for download
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes)),
            },
        )

    except Exception as e:
        logger.error(f"Failed to generate PDF report: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate PDF report: {str(e)}",
        )


@router.post("/reports/pdf/async", status_code=status.HTTP_202_ACCEPTED)
async def generate_pdf_report_async(
    request: PDFReportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PDFReportResponse:
    """
    Generate PDF report asynchronously for large reports.

    **Authentication:** JWT token required

    This endpoint queues PDF generation as a background task and returns immediately.
    Use the returned report_id to check status and download when ready.
    """
    logger.info(f"Async PDF report generation requested by user {current_user.id}")

    try:
        # Generate unique report ID
        report_id = str(uuid4())

        # Queue background task
        background_tasks.add_task(
            _generate_pdf_background,
            report_id=report_id,
            request=request,
        )

        logger.info(f"PDF report generation queued: {report_id}")

        return PDFReportResponse(
            status="queued",
            message=f"PDF report generation queued. Report ID: {report_id}",
            generated_at=datetime.now().isoformat(),
        )

    except Exception as e:
        logger.error(f"Failed to queue PDF report generation: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue PDF report generation: {str(e)}",
        )


async def _generate_pdf_background(
    report_id: str,
    request: PDFReportRequest,
) -> None:
    """
    Background task for PDF generation.

    1. Generates the PDF
    2. Stores it in object storage
    3. Updates job status in Redis
    """
    import asyncio

    try:
        logger.info(f"Starting background PDF generation: {report_id}")

        # Update status to processing
        asyncio.create_task(_update_pdf_job_status(report_id, "processing"))

        # Validate screenshots directory
        screenshots_dir = Path(request.screenshots_dir)
        if not screenshots_dir.exists():
            logger.warning(f"Screenshots directory not found: {screenshots_dir}")
            screenshots_dir.mkdir(parents=True, exist_ok=True)

        # Create options
        options = PDFReportOptions(
            include_screenshots=request.include_screenshots,
            include_coverage=request.include_coverage,
            include_timeline=request.include_timeline,
            include_recommendations=request.include_recommendations,
            include_appendices=request.include_appendices,
            screenshot_quality=request.screenshot_quality,
            logo_path=request.logo_path,
            page_size=request.page_size,
            title=request.title,
        )

        # Generate PDF
        pdf_bytes = generate_pdf_report(
            request.execution_result, screenshots_dir, options
        )

        # Store in object storage
        storage_url: str
        try:
            import io

            file_obj = io.BytesIO(pdf_bytes)
            _key, storage_url = object_storage.upload_file(
                file_obj,
                "reports/pdf",
                f"{report_id}.pdf",
                content_type="application/pdf",
            )
            logger.info(f"PDF uploaded to storage: {storage_url}")
        except Exception as upload_error:
            logger.warning(f"Object storage upload failed: {upload_error}")
            # Fall back to local storage
            output_dir = Path("/tmp/qontinui/reports")
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / f"{report_id}.pdf"
            with open(output_path, "wb") as f:
                f.write(pdf_bytes)
            storage_url = str(output_path)

        logger.info(
            f"Background PDF generation completed: {report_id}. "
            f"Size: {len(pdf_bytes)} bytes"
        )

        # Update job status to completed
        asyncio.create_task(
            _update_pdf_job_status(
                report_id,
                "completed",
                storage_url=storage_url,
                file_size=len(pdf_bytes),
            )
        )

    except Exception as e:
        logger.error(
            f"Background PDF generation failed for {report_id}: {e}",
            exc_info=True,
        )
        # Update job status to failed
        asyncio.create_task(
            _update_pdf_job_status(
                report_id,
                "failed",
                error=str(e),
            )
        )


# Snapshot Screenshots Endpoints
@router.get("/snapshots/{run_id}/screenshots")
async def get_state_screenshots(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    active_states: str | None = Query(None),
) -> dict[str, Any]:
    """
    Get screenshots for a snapshot run.

    **Authentication:** JWT token required

    Returns screenshots from a snapshot run, optionally filtered by active states.
    """
    logger.info(f"Get screenshots requested for run {run_id} by user {current_user.id}")

    # Get snapshot run and verify ownership
    from uuid import UUID

    try:
        rid = UUID(run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid run ID format",
        )

    result = await db.execute(
        select(SnapshotRun)
        .options(selectinload(SnapshotRun.screenshots))
        .where(SnapshotRun.run_id == rid)
    )
    snapshot_run = result.scalar_one_or_none()

    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot run not found",
        )

    # Verify project access
    await verify_project_access(db, str(snapshot_run.project_id), current_user.id)

    # Filter screenshots by active states if specified
    screenshots = []
    states_filter = active_states.split(",") if active_states else None

    for screenshot in snapshot_run.screenshots:
        if states_filter:
            if any(state in screenshot.active_states for state in states_filter):
                screenshots.append(
                    {
                        "id": str(screenshot.id),
                        "path": screenshot.screenshot_path,
                        "active_states": screenshot.active_states,
                        "timestamp": (
                            screenshot.timestamp.isoformat()
                            if screenshot.timestamp
                            else None
                        ),
                    }
                )
        else:
            screenshots.append(
                {
                    "id": str(screenshot.id),
                    "path": screenshot.screenshot_path,
                    "active_states": screenshot.active_states,
                    "timestamp": (
                        screenshot.timestamp.isoformat()
                        if screenshot.timestamp
                        else None
                    ),
                }
            )

    # Get unique state combinations
    unique_states = set()
    for s in snapshot_run.screenshots:
        unique_states.add(tuple(sorted(s.active_states)))

    return {
        "screenshots": screenshots,
        "total": len(screenshots),
        "unique_state_combinations": len(unique_states),
    }


@router.get(
    "/snapshots/{run_id}/screenshot/{screenshot_path:path}", response_model=None
)
async def get_screenshot(
    run_id: str,
    screenshot_path: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FileResponse | RedirectResponse:
    """
    Get a specific screenshot file.

    **Authentication:** JWT token required

    Returns the screenshot image file from object storage.
    """
    logger.info(
        f"Get screenshot {screenshot_path} requested for run {run_id} "
        f"by user {current_user.id}"
    )

    # Get snapshot run and verify ownership
    from uuid import UUID

    try:
        rid = UUID(run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid run ID format",
        )

    result = await db.execute(select(SnapshotRun).where(SnapshotRun.run_id == rid))
    snapshot_run = result.scalar_one_or_none()

    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot run not found",
        )

    # Verify project access
    await verify_project_access(db, str(snapshot_run.project_id), current_user.id)

    # Try to get from object storage
    try:
        # Generate presigned URL or download file
        url = object_storage.generate_presigned_url(screenshot_path)
        if url:
            # Redirect to presigned URL
            return RedirectResponse(url=url)
    except Exception as e:
        logger.warning(f"Failed to get screenshot from storage: {e}")

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Screenshot not found",
    )


# Helper function for snapshot lookup
async def _get_screenshots_from_snapshot_ids(
    db: AsyncSession,
    snapshot_ids: list[str],
    state_name: str | None = None,
) -> list[str]:
    """
    Get screenshot paths from snapshot run IDs.

    Args:
        db: Database session
        snapshot_ids: List of snapshot run IDs
        state_name: Optional state name to filter by

    Returns:
        List of screenshot paths
    """
    from uuid import UUID

    screenshot_paths = []

    for snapshot_id in snapshot_ids:
        try:
            sid = UUID(snapshot_id)
        except ValueError:
            logger.warning(f"Invalid snapshot ID: {snapshot_id}")
            continue

        # Query snapshot run with screenshots
        result = await db.execute(
            select(SnapshotRun)
            .options(selectinload(SnapshotRun.screenshots))
            .where(SnapshotRun.run_id == sid)
        )
        snapshot_run = result.scalar_one_or_none()

        if not snapshot_run:
            logger.warning(f"Snapshot run not found: {snapshot_id}")
            continue

        for screenshot in snapshot_run.screenshots:
            # If state_name is specified, filter by active states
            if state_name:
                if state_name in screenshot.active_states:
                    screenshot_paths.append(screenshot.screenshot_path)
            else:
                screenshot_paths.append(screenshot.screenshot_path)

    return screenshot_paths
