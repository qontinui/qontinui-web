"""
Integration Testing API Endpoints

Endpoints for mock execution, video export, and integration testing features.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.services.pattern_auto_extraction import PatternAutoExtractor
from app.services.pdf_report import PDFReportOptions, generate_pdf_report
from app.services.video_export import (
    VideoExportOptions,
    VideoQuality,
    create_execution_video,
)

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


class VideoExportRequest(BaseModel):
    """Request for video export"""

    execution_data: dict[str, Any] = Field(..., description="Execution response data")
    frame_duration: float = Field(
        1.5, ge=0.5, le=5.0, description="Duration per frame in seconds"
    )
    quality: VideoQuality = Field(
        VideoQuality.MEDIUM, description="Video quality preset"
    )
    include_overlays: bool = Field(True, description="Include action overlays")
    include_timeline: bool = Field(True, description="Include timeline progress bar")
    include_text: bool = Field(True, description="Include text overlays")
    smooth_transitions: bool = Field(
        True, description="Smooth transitions between frames"
    )


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


@router.post("/export/video", status_code=status.HTTP_202_ACCEPTED)
async def export_execution_video(
    request: VideoExportRequest,
    background_tasks: BackgroundTasks,
) -> VideoExportResponse:
    """
    Export execution to MP4 video

    Initiates background video generation and returns a video_id for polling status.
    """
    try:
        # Generate video ID
        video_id = str(uuid4())

        # Initialize job status
        job_status = VideoStatusResponse(
            video_id=video_id,
            status="processing",
            progress=0.0,
        )
        _video_jobs[video_id] = job_status

        # Prepare video options
        options = VideoExportOptions(
            frame_duration=request.frame_duration,
            quality=request.quality,
            include_overlays=request.include_overlays,
            include_timeline=request.include_timeline,
            include_text=request.include_text,
            smooth_transitions=request.smooth_transitions,
        )

        # Schedule background task
        background_tasks.add_task(
            _generate_video_task,
            video_id=video_id,
            execution_data=request.execution_data,
            options=options,
        )

        logger.info(f"Video export initiated: {video_id}")

        return VideoExportResponse(
            video_id=video_id,
            status="processing",
            progress=0.0,
        )

    except Exception as e:
        logger.error(f"Failed to initiate video export: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initiate video export: {str(e)}",
        )


@router.get("/export/video/{video_id}/status", status_code=status.HTTP_200_OK)
async def get_video_export_status(video_id: str) -> VideoStatusResponse:
    """
    Get video export status

    Poll this endpoint to check video generation progress.
    """
    if video_id not in _video_jobs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video job not found: {video_id}",
        )

    return _video_jobs[video_id]


@router.get("/export/video/{video_id}/download", status_code=status.HTTP_200_OK)
async def download_video(video_id: str) -> FileResponse:
    """
    Download generated video file

    Returns the MP4 file when ready.
    """
    if video_id not in _video_jobs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video job not found: {video_id}",
        )

    job = _video_jobs[video_id]

    if job.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Video not ready. Current status: {job.status}",
        )

    if not job.video_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video file not found",
        )

    # Extract file path from URL
    # In production, this would handle proper URL to path conversion
    video_path = Path(
        job.video_url.replace("/api/integration-testing/export/video/", "")
    )

    if not video_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video file not found on disk",
        )

    return FileResponse(
        path=str(video_path),
        media_type="video/mp4",
        filename=f"execution_{video_id}.mp4",
    )


@router.delete("/export/video/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(video_id: str):
    """
    Delete video export job and file

    Cleanup after download.
    """
    if video_id not in _video_jobs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Video job not found: {video_id}",
        )

    job = _video_jobs[video_id]

    # Delete file if exists
    if job.video_url:
        try:
            video_path = Path(
                job.video_url.replace("/api/integration-testing/export/video/", "")
            )
            if video_path.exists():
                video_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete video file: {e}")

    # Remove job
    del _video_jobs[video_id]

    logger.info(f"Video job deleted: {video_id}")


# Background task
async def _generate_video_task(
    video_id: str,
    execution_data: dict[str, Any],
    options: VideoExportOptions,
):
    """
    Background task to generate video

    Updates job status as it progresses.
    """
    job = _video_jobs.get(video_id)
    if not job:
        logger.error(f"Job not found: {video_id}")
        return

    try:
        logger.info(f"Starting video generation: {video_id}")

        # Prepare paths
        # In production, use proper storage service
        output_dir = Path("/tmp/qontinui/videos")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{video_id}.mp4"

        # Get screenshot base path from execution data
        # This would come from the actual storage location
        process_id = execution_data.get("process_id", "")
        screenshot_base_path = f"/tmp/qontinui/screenshots/{process_id}"

        # Progress callback
        async def update_progress(current: int, total: int):
            job.progress = current / total if total > 0 else 0
            logger.debug(f"Video progress: {current}/{total} ({job.progress:.1%})")

        # Generate video
        metadata = await create_execution_video(
            execution_data=execution_data,
            screenshot_base_path=screenshot_base_path,
            output_path=str(output_path),
            options=options,
            progress_callback=update_progress,
        )

        # Update job status
        job.status = "completed"
        job.progress = 1.0
        job.video_url = f"/api/integration-testing/export/video/{video_id}/download"
        job.file_size = metadata.get("file_size")
        job.duration_seconds = metadata.get("duration_seconds")

        logger.info(f"Video generation completed: {video_id}")

    except Exception as e:
        logger.error(f"Video generation failed for {video_id}: {e}", exc_info=True)
        job.status = "failed"
        job.error = str(e)


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

    In production, this would:
    1. Generate the PDF
    2. Store it in object storage
    3. Update job status in database
    4. Send webhook/notification when complete
    """
    try:
        logger.info(f"Starting background PDF generation: {report_id}")

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

        # Save to temporary location (in production, use object storage)
        output_dir = Path("/tmp/qontinui/reports")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{report_id}.pdf"

        with open(output_path, "wb") as f:
            f.write(pdf_bytes)

        logger.info(
            f"Background PDF generation completed: {report_id}. "
            f"Size: {len(pdf_bytes)} bytes"
        )

        # TODO: Update job status in database
        # TODO: Store in object storage
        # TODO: Send webhook/notification

    except Exception as e:
        logger.error(
            f"Background PDF generation failed for {report_id}: {e}",
            exc_info=True,
        )
        # TODO: Update job status to failed in database


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


# Pattern Auto-Extraction Endpoints (EXPERIMENTAL)
@router.post("/patterns/auto-extract", status_code=status.HTTP_200_OK)
async def auto_extract_patterns(request: AutoExtractRequest) -> AutoExtractResponse:
    """
    Auto-extract UI patterns using computer vision (EXPERIMENTAL)

    This endpoint uses OpenCV-based computer vision to automatically detect
    UI patterns like buttons, input fields, and icons from screenshots.

    WARNING: This is an experimental feature. Detection accuracy may vary
    depending on screenshot quality and UI design.

    Args:
        request: Auto-extraction configuration including:
            - state_name: State name for pattern naming
            - snapshot_ids: List of snapshot run IDs to process
            - screenshot_paths: Alternative direct paths to screenshots
            - detect_buttons: Enable button detection
            - detect_inputs: Enable input field detection
            - detect_icons: Enable icon detection
            - min_confidence: Minimum confidence threshold (0.0-1.0)

    Returns:
        AutoExtractResponse with detected patterns and metadata

    Raises:
        HTTPException: If extraction fails or no screenshots found
    """
    try:
        logger.info(
            f"Starting auto-extraction for state '{request.state_name}' "
            f"with {len(request.snapshot_ids)} snapshots"
        )

        # Initialize extractor
        extractor = PatternAutoExtractor()

        # Collect screenshot paths
        screenshots = []

        # Option 1: Use direct screenshot paths
        if request.screenshot_paths:
            screenshots.extend(request.screenshot_paths)
            logger.info(
                f"Using {len(request.screenshot_paths)} direct screenshot paths"
            )

        # Option 2: Get screenshots from snapshot IDs
        # TODO: Implement snapshot database lookup when DB models are available
        # For now, this would require integration with the snapshot/action database
        if request.snapshot_ids:
            logger.warning(
                "Snapshot ID lookup not yet implemented. "
                "Use screenshot_paths parameter instead."
            )
            # Example implementation (when DB is available):
            # for snapshot_id in request.snapshot_ids:
            #     snapshot = db.query(SnapshotRun).filter_by(run_id=snapshot_id).first()
            #     if snapshot:
            #         for action in snapshot.actions:
            #             if request.state_name in action.active_states:
            #                 screenshots.append(action.screenshot_path)

        if not screenshots:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No screenshots provided. Use screenshot_paths or snapshot_ids.",
            )

        # Extract patterns
        detected = extractor.extract_patterns(
            screenshot_paths=screenshots,
            state_name=request.state_name,
            detect_buttons=request.detect_buttons,
            detect_inputs=request.detect_inputs,
            detect_icons=request.detect_icons,
            min_confidence=request.min_confidence,
        )

        # Convert to response format
        patterns = [
            DetectedPattern(
                region=p.region,
                confidence=p.confidence,
                pattern_type=p.pattern_type,
                suggested_name=p.suggested_name,
                image_data=p.image_data,
                source_screenshot=p.source_screenshot,
            )
            for p in detected
        ]

        logger.info(
            f"Auto-extraction completed: {len(patterns)} patterns detected "
            f"from {len(screenshots)} screenshots"
        )

        return AutoExtractResponse(
            patterns=patterns,
            total_screenshots=len(screenshots),
            total_detected=len(patterns),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pattern auto-extraction failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pattern auto-extraction failed: {str(e)}",
        )
