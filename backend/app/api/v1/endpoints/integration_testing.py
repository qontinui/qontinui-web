"""
Integration Testing API Endpoints

Endpoints for mock execution, video export, and integration testing features.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from redis import asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_db
from app.models.snapshot import SnapshotRun
from app.services.object_storage import object_storage

# DEPRECATED: CV-heavy services removed - functionality moved to qontinui library
# from app.services.pattern_auto_extraction import PatternAutoExtractor
# from app.services.video_export import (
#     VideoExportOptions,
#     VideoQuality,
#     create_execution_video,
# )
from app.services.pdf_report import PDFReportOptions, generate_pdf_report

# Redis key prefix for PDF report jobs
PDF_JOB_KEY_PREFIX = "pdf_report:job:"
PDF_JOB_TTL = 86400  # 24 hours

logger = logging.getLogger(__name__)

router = APIRouter()


# Request/Response Models
class MockExecutionRequest(BaseModel):
    """Request for mock execution"""

    process_id: str
    process_name: str
    snapshot_run_ids: list[str] = Field(default_factory=list)
    snapshot_run_id: str | None = None  # Deprecated
    initial_states: list[str] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)


# DEPRECATED: Video export functionality removed - moved to qontinui library
# class VideoExportRequest(BaseModel):
#     """Request for video export"""
#
#     execution_data: dict[str, Any] = Field(..., description="Execution response data")
#     frame_duration: float = Field(
#         1.5, ge=0.5, le=5.0, description="Duration per frame in seconds"
#     )
#     quality: VideoQuality = Field(
#         VideoQuality.MEDIUM, description="Video quality preset"
#     )
#     include_overlays: bool = Field(True, description="Include action overlays")
#     include_timeline: bool = Field(True, description="Include timeline progress bar")
#     include_text: bool = Field(True, description="Include text overlays")
#     smooth_transitions: bool = Field(
#         True, description="Smooth transitions between frames"
#     )


class VideoExportResponse(BaseModel):
    """Response for video export"""

    video_id: str
    status: str  # "processing" | "completed" | "failed"
    progress: float = 0.0  # 0.0 to 1.0
    video_url: str | None = None
    file_size: int | None = None
    duration_seconds: float | None = None
    error: str | None = None


class VideoStatusResponse(BaseModel):
    """Response for video status check"""

    video_id: str
    status: str
    progress: float = 0.0
    video_url: str | None = None
    file_size: int | None = None
    duration_seconds: float | None = None
    error: str | None = None


class PDFReportRequest(BaseModel):
    """Request for PDF report generation"""

    execution_result: dict[str, Any] = Field(
        ..., description="Full execution result from integration test"
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


class AutoExtractRequest(BaseModel):
    """Request for automatic pattern extraction (EXPERIMENTAL)"""

    state_name: str = Field(..., description="State name for pattern naming")
    snapshot_ids: list[str] = Field(
        default_factory=list, description="Snapshot run IDs"
    )
    screenshot_paths: list[str] = Field(
        default_factory=list,
        description="Direct screenshot paths (alternative to snapshot_ids)",
    )
    detect_buttons: bool = Field(default=True, description="Detect button-like regions")
    detect_inputs: bool = Field(default=True, description="Detect input field regions")
    detect_icons: bool = Field(default=True, description="Detect icon-like regions")
    min_confidence: float = Field(
        default=0.7, ge=0.0, le=1.0, description="Minimum confidence threshold"
    )


class DetectedPattern(BaseModel):
    """Detected pattern response model"""

    region: dict[str, int] = Field(..., description="Region coordinates {x, y, w, h}")
    confidence: float = Field(..., description="Detection confidence (0.0-1.0)")
    pattern_type: str = Field(
        ..., description="Pattern type: button, input, icon, text"
    )
    suggested_name: str = Field(..., description="Suggested pattern name")
    image_data: str = Field(..., description="Base64 encoded pattern image")
    source_screenshot: str = Field(..., description="Source screenshot path")


class AutoExtractResponse(BaseModel):
    """Response for automatic pattern extraction"""

    patterns: list[DetectedPattern] = Field(..., description="Detected patterns")
    total_screenshots: int = Field(..., description="Number of screenshots processed")
    total_detected: int = Field(..., description="Total patterns detected")


# In-memory storage for video export jobs (replace with Redis/DB in production)
_video_jobs: dict[str, VideoStatusResponse] = {}

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
        "updated_at": datetime.utcnow().isoformat(),
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


@router.post("/execute", status_code=status.HTTP_200_OK)
async def execute_mock_process(request: MockExecutionRequest) -> dict[str, Any]:
    """
    Execute a mock process (placeholder endpoint)

    This is a placeholder that returns mock data.
    Replace with actual integration testing execution logic.
    """
    # This would integrate with the actual execution engine
    # For now, return mock data structure

    mock_response = {
        "process_id": request.process_id,
        "process_name": request.process_name,
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


@router.post("/export/video", status_code=status.HTTP_410_GONE)
async def export_execution_video():
    """
    DEPRECATED: Video export functionality has been removed.

    This endpoint has been deprecated and removed. Video export functionality
    should be implemented in the qontinui library for local execution.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Video export functionality has been removed. Use qontinui library for local execution.",
    )


@router.get("/export/video/{video_id}/status", status_code=status.HTTP_410_GONE)
async def get_video_export_status(video_id: str):
    """
    DEPRECATED: Video export functionality has been removed.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Video export functionality has been removed. Use qontinui library for local execution.",
    )


@router.get("/export/video/{video_id}/download", status_code=status.HTTP_410_GONE)
async def download_video(video_id: str):
    """
    DEPRECATED: Video export functionality has been removed.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Video export functionality has been removed. Use qontinui library for local execution.",
    )


@router.delete("/export/video/{video_id}", status_code=status.HTTP_410_GONE)
async def delete_video(video_id: str):
    """
    DEPRECATED: Video export functionality has been removed.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Video export functionality has been removed. Use qontinui library for local execution.",
    )


# DEPRECATED: Video generation removed - moved to qontinui library
# async def _generate_video_task(
#     video_id: str,
#     execution_data: dict[str, Any],
#     options: VideoExportOptions,
# ):
#     """
#     Background task to generate video
#
#     Updates job status as it progresses.
#     """
#     pass


# PDF Report Generation Endpoints
@router.post("/reports/pdf", status_code=status.HTTP_200_OK)
async def generate_pdf_report_endpoint(
    request: PDFReportRequest,
) -> StreamingResponse:
    """
    Generate PDF report for integration test execution results

    This endpoint accepts execution results and generates a comprehensive PDF report
    including executive summary, coverage analysis, action timeline, and recommendations.

    The PDF is streamed directly for immediate download.
    """
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
        process_name = execution_result.get("process_name", "integration_test")
        logger.info(f"Generating PDF report for process: {process_name}")

        pdf_bytes = generate_pdf_report(execution_result, screenshots_dir, options)

        # Prepare filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{process_name}_report_{timestamp}.pdf"

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
) -> PDFReportResponse:
    """
    Generate PDF report asynchronously for large reports

    This endpoint queues PDF generation as a background task and returns immediately.
    Use the returned report_id to check status and download when ready.
    """
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
):
    """
    Background task for PDF generation

    1. Generates the PDF
    2. Stores it in object storage
    3. Updates job status in Redis
    4. Sends webhook/notification when complete
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

        # Send webhook notification if configured
        # Note: Webhook URL would typically come from project settings
        # For now, just log completion
        logger.info(f"PDF report {report_id} ready for download at {storage_url}")

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


# Placeholder endpoints for screenshots (to be implemented)
@router.get("/snapshots/{run_id}/screenshots")
async def get_state_screenshots(
    run_id: str,
    active_states: str | None = Query(None),
) -> dict[str, Any]:
    """
    Get screenshots for a snapshot run

    Placeholder endpoint.
    """
    return {
        "screenshots": [],
        "total": 0,
        "unique_state_combinations": 0,
    }


@router.get("/snapshots/{run_id}/screenshot/{screenshot_path:path}")
async def get_screenshot(run_id: str, screenshot_path: str) -> FileResponse:
    """
    Get a specific screenshot file

    Placeholder endpoint.
    """
    # In production, retrieve from storage service
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
    screenshot_paths = []

    for snapshot_id in snapshot_ids:
        # Query snapshot run with screenshots
        result = await db.execute(
            select(SnapshotRun)
            .options(selectinload(SnapshotRun.screenshots))
            .where(SnapshotRun.run_id == snapshot_id)
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


# Pattern Auto-Extraction Endpoints (EXPERIMENTAL) - DEPRECATED
@router.post("/patterns/auto-extract", status_code=status.HTTP_410_GONE)
async def auto_extract_patterns():
    """
    DEPRECATED: Pattern auto-extraction functionality has been removed.

    This endpoint has been deprecated and removed. Pattern extraction should be
    implemented in the qontinui library for local execution.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Pattern auto-extraction functionality has been removed. Use qontinui library for local execution.",
    )
