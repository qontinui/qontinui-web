"""
API endpoints for recording management and automated state discovery.

Handles recording uploads, processing status, and state structure discovery.
"""

import json

import structlog
from app.api import deps
from app.models.project import Project
from app.models.recording import RecordingStatus
from app.models.user import User
from app.repositories.recording import recording_repository
from app.schemas.recording import (DiscoveredStateStructure, FrameResponse,
                                   ProcessingJobStatus, RecordingListResponse,
                                   RecordingResponse, UploadResponse)
from app.services.recording_service import recording_service
from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form,
                     HTTPException, UploadFile)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)
router = APIRouter()


# ============================================================================
# Upload Endpoints
# ============================================================================


@router.post("/upload", response_model=UploadResponse)
async def upload_recording(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    description: str | None = Form(None),
    tags: str | None = Form(None),  # JSON string
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> UploadResponse:
    """
    Upload a recording (ZIP format or JSON).

    Supports two formats:
    1. ZIP archive with frames/, metadata.json, interactions.json, context.json
    2. JSON file with embedded recording data

    Returns:
        UploadResponse with recording details and status
    """
    logger.info(
        "recording_upload_request",
        user_id=str(current_user.id),
        project_id=project_id,
        filename=file.filename,
    )

    try:
        # Verify project exists and user has access
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Parse tags if provided
        tag_list: list[str] = []
        if tags:
            try:
                tag_list = json.loads(tags)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse tags: {tags}")

        # Process based on file type
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        if file.filename.endswith(".zip"):
            recording, metadata = await recording_service.extract_zip_recording(
                file, project_id, str(current_user.id), db
            )
        elif file.filename.endswith(".json"):
            recording, metadata = await recording_service.extract_json_recording(
                file, project_id, str(current_user.id), db
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file format. Please upload a ZIP or JSON file.",
            )

        # Update description and tags if provided
        if description:
            recording.description = description  # type: ignore[assignment]
        if tag_list:
            recording.tags = tag_list  # type: ignore[assignment]

        await db.commit()

        logger.info(
            "recording_upload_complete",
            user_id=str(current_user.id),
            project_id=project_id,
            recording_id=str(recording.id),
        )

        return UploadResponse(
            success=True,
            recording_id=str(recording.id),
            uploaded_at=recording.created_at,  # type: ignore[arg-type]
            size_bytes=recording.upload_size_bytes,  # type: ignore[arg-type]
            frame_count=recording.total_frames,  # type: ignore[arg-type]
            interaction_count=recording.total_interactions,  # type: ignore[arg-type]
            status=recording.status,  # type: ignore[arg-type]
            validation_errors=recording.validation_errors or [],  # type: ignore[arg-type]
            validation_warnings=recording.validation_warnings or [],  # type: ignore[arg-type]
            message="Recording uploaded successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading recording: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to upload recording: {str(e)}"
        )


# ============================================================================
# List/Get Endpoints
# ============================================================================


@router.get("", response_model=RecordingListResponse)
async def list_recordings(
    project_id: str | None = None,
    status: RecordingStatus | None = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> RecordingListResponse:
    """
    List recordings with optional filtering.

    Supports filtering by project_id and status, with pagination.

    Returns:
        RecordingListResponse with paginated recording list
    """
    logger.info(
        "list_recordings_request",
        user_id=str(current_user.id),
        project_id=project_id,
        status=status.value if status else None,
    )

    recordings, total = await recording_repository.list_recordings(
        db, project_id=project_id, status=status, skip=skip, limit=limit
    )

    # Build response
    recording_responses = [
        recording_service.build_recording_response(rec) for rec in recordings
    ]

    logger.info(
        "list_recordings_complete",
        user_id=str(current_user.id),
        total=total,
        returned=len(recording_responses),
    )

    return RecordingListResponse(
        recordings=recording_responses,
        total=total,
        page=skip // limit,
        page_size=limit,
    )


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> RecordingResponse:
    """
    Get recording details.

    Returns:
        RecordingResponse with full recording details
    """
    logger.info(
        "get_recording_request",
        user_id=str(current_user.id),
        recording_id=recording_id,
    )

    recording = await recording_repository.get_by_id(db, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    return recording_service.build_recording_response(recording)


# ============================================================================
# Processing Endpoints
# ============================================================================


@router.post("/{recording_id}/process")
async def start_processing(
    recording_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
):
    """
    Start processing a recording to discover states.

    NOTE: This endpoint is deprecated. Recording processing has been moved to the
    qontinui library. Use the qontinui API for state discovery operations.
    """
    raise HTTPException(
        status_code=501,
        detail="Recording processing has been moved to qontinui library. "
        "This endpoint is deprecated and will be removed in a future version.",
    )


@router.get("/{recording_id}/status", response_model=ProcessingJobStatus)
async def get_processing_status(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> ProcessingJobStatus:
    """
    Get processing status for a recording.

    Returns:
        ProcessingJobStatus with current processing state
    """
    logger.info(
        "get_processing_status_request",
        user_id=str(current_user.id),
        recording_id=recording_id,
    )

    recording = await recording_repository.get_by_id(db, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    return recording_service.build_processing_status(recording)


# ============================================================================
# Frame Endpoints
# ============================================================================


@router.get("/{recording_id}/frames", response_model=list[FrameResponse])
async def get_recording_frames(
    recording_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> list[FrameResponse]:
    """
    Get frames for a recording.

    Supports pagination. Presigned URLs are regenerated if expired.

    Returns:
        List of FrameResponse with frame details and presigned URLs
    """
    logger.info(
        "get_recording_frames_request",
        user_id=str(current_user.id),
        recording_id=recording_id,
    )

    # Verify recording exists
    recording = await recording_repository.get_by_id(db, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Get frames
    frames = await recording_repository.get_frames(db, recording_id, skip, limit)

    # Regenerate presigned URLs if expired
    await recording_repository.refresh_frame_urls(db, frames)

    # Build response
    frame_responses = [
        recording_service.build_frame_response(frame) for frame in frames
    ]

    logger.info(
        "get_recording_frames_complete",
        user_id=str(current_user.id),
        recording_id=recording_id,
        frame_count=len(frame_responses),
    )

    return frame_responses


# ============================================================================
# State Structure Endpoints
# ============================================================================


@router.get("/{recording_id}/state-structure", response_model=DiscoveredStateStructure)
async def get_discovered_state_structure(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> DiscoveredStateStructure:
    """
    Get discovered state structure for a recording.

    Only available for completed recordings. Returns discovered states,
    transitions, and statistics.

    Returns:
        DiscoveredStateStructure with states, transitions, and stats
    """
    logger.info(
        "get_state_structure_request",
        user_id=str(current_user.id),
        recording_id=recording_id,
    )

    # Verify recording exists
    recording = await recording_repository.get_by_id(db, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if not recording.is_completed:
        raise HTTPException(
            status_code=400, detail="Recording processing not completed"
        )

    # Get discovered states and transitions
    states = await recording_repository.get_discovered_states(db, recording_id)
    transitions = await recording_repository.get_discovered_transitions(
        db, recording_id
    )

    # Build response
    state_responses = [recording_service.build_state_response(s) for s in states]
    transition_responses = [
        recording_service.build_transition_response(t) for t in transitions
    ]

    # Build stats
    stats = {
        "total_states": len(states),
        "total_transitions": len(transitions),
        "high_confidence_states": sum(
            1 for s in states if s.confidence and s.confidence > 0.8
        ),
        "medium_confidence_states": sum(
            1 for s in states if s.confidence and 0.5 <= s.confidence <= 0.8
        ),
        "low_confidence_states": sum(
            1 for s in states if s.confidence and s.confidence < 0.5
        ),
        "approved_states": sum(1 for s in states if s.user_approved),
        "approved_transitions": sum(1 for t in transitions if t.user_approved),
    }

    logger.info(
        "get_state_structure_complete",
        user_id=str(current_user.id),
        recording_id=recording_id,
        state_count=len(states),
        transition_count=len(transitions),
    )

    return DiscoveredStateStructure(
        recording_id=str(recording.id),
        states=state_responses,
        transitions=transition_responses,
        stats=stats,
        confidence=recording.discovery_confidence,  # type: ignore[arg-type]
    )


# ============================================================================
# Delete Endpoints
# ============================================================================


@router.delete("/{recording_id}")
async def delete_recording(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
):
    """
    Delete a recording and all associated data.

    Deletes S3 files and database records (cascades to frames, interactions, etc.).

    Returns:
        Success message
    """
    logger.info(
        "delete_recording_request",
        user_id=str(current_user.id),
        recording_id=recording_id,
    )

    recording = await recording_repository.get_by_id(db, recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Delete S3 files
    deleted_count = recording_service.delete_recording_files(recording)
    logger.info(
        "recording_files_deleted",
        recording_id=recording_id,
        deleted_count=deleted_count,
    )

    # Delete database record (cascades to all related records)
    await recording_repository.delete_recording(db, recording)

    logger.info(
        "delete_recording_complete",
        user_id=str(current_user.id),
        recording_id=recording_id,
    )

    return {"success": True, "message": "Recording deleted successfully"}
