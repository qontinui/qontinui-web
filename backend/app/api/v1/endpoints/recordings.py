"""
API endpoints for recording management and automated state discovery
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, select, func
from sqlalchemy.orm import selectinload
import json
import uuid
import zipfile
import io
import mimetypes
from datetime import datetime, timedelta

from app.api import deps
from app.models.user import User
from app.models.project import Project
from app.models.recording import (
    Recording,
    RecordingFrame,
    RecordingInteraction,
    RecordingContext,
    DiscoveredState,
    DiscoveredTransition,
    ProcessingLog,
    RecordingStatus,
    ProcessingPhase,
)
from app.schemas.recording import (
    RecordingResponse,
    RecordingListResponse,
    RecordingCreate,
    RecordingUpdate,
    RecordingStats,
    UploadResponse,
    RecordingError,
    ProcessingJobStatus,
    ProcessingLogEntry,
    DiscoveredStateResponse,
    DiscoveredTransitionResponse,
    DiscoveredStateStructure,
    AcceptanceRequest,
    AcceptanceResponse,
    FrameResponse,
    RecordingUploadRequest,
    RecordingMetadata,
)
from app.services.object_storage import object_storage
import structlog

logger = structlog.get_logger(__name__)
router = APIRouter()


def validate_recording_metadata(metadata: dict) -> tuple[bool, List[str], List[str]]:
    """
    Validate recording metadata
    Returns: (is_valid, errors, warnings)
    """
    errors = []
    warnings = []

    # Required fields
    required_fields = ['recordingId', 'version', 'recordingStartTime', 'recordingEndTime',
                      'duration', 'frameRate', 'totalFrames']
    for field in required_fields:
        if field not in metadata:
            errors.append(f"Missing required field: {field}")

    # Version check
    if metadata.get('version') != '1.0':
        warnings.append(f"Unsupported version: {metadata.get('version')}. Expected 1.0")

    # Time validation
    try:
        start = datetime.fromisoformat(metadata.get('recordingStartTime', '').replace('Z', '+00:00'))
        end = datetime.fromisoformat(metadata.get('recordingEndTime', '').replace('Z', '+00:00'))
        if end <= start:
            errors.append("recordingEndTime must be after recordingStartTime")
    except (ValueError, AttributeError):
        errors.append("Invalid datetime format for recording times")

    # Frame rate validation
    if metadata.get('frameRate', 0) <= 0:
        errors.append("frameRate must be positive")

    # Total frames validation
    if metadata.get('totalFrames', 0) <= 0:
        errors.append("totalFrames must be positive")

    return len(errors) == 0, errors, warnings


async def extract_zip_recording(
    zip_file: UploadFile,
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> tuple[Recording, dict]:
    """
    Extract and process ZIP format recording
    Returns: (Recording object, metadata dict)
    """
    storage = object_storage

    # Read ZIP file
    zip_content = await zip_file.read()
    zip_buffer = io.BytesIO(zip_content)

    with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
        # Read metadata.json
        if 'metadata.json' not in zip_ref.namelist():
            raise HTTPException(status_code=400, detail="metadata.json not found in ZIP")

        metadata_content = zip_ref.read('metadata.json')
        metadata = json.loads(metadata_content.decode('utf-8'))

        # Validate metadata
        is_valid, errors, warnings = validate_recording_metadata(metadata)
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Invalid metadata: {', '.join(errors)}")

        # Read interactions.json
        interactions = []
        if 'interactions.json' in zip_ref.namelist():
            interactions_content = zip_ref.read('interactions.json')
            interactions_data = json.loads(interactions_content.decode('utf-8'))
            interactions = interactions_data.get('interactions', [])

        # Read context.json
        context_events = []
        if 'context.json' in zip_ref.namelist():
            context_content = zip_ref.read('context.json')
            context_data = json.loads(context_content.decode('utf-8'))
            context_events = context_data.get('contextEvents', [])

        # Create recording object
        recording_id = str(uuid.uuid4())
        s3_prefix = f"recordings/{project_id}/{recording_id}"

        # Parse times
        start_time = datetime.fromisoformat(metadata['recordingStartTime'].replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(metadata['recordingEndTime'].replace('Z', '+00:00'))

        recording = Recording(
            id=recording_id,
            project_id=project_id,
            created_by_id=user_id,
            name=metadata.get('annotations', {}).get('description', f"Recording {recording_id[:8]}"),
            description=metadata.get('annotations', {}).get('description'),
            tags=metadata.get('annotations', {}).get('tags', []),
            recording_start_time=start_time,
            recording_end_time=end_time,
            duration_ms=metadata['duration'],
            recorder_name=metadata['recorder']['name'],
            recorder_version=metadata['recorder'].get('version'),
            recorder_platform=metadata['recorder']['platform'],
            screen_width=metadata['system']['screenResolution']['width'],
            screen_height=metadata['system']['screenResolution']['height'],
            screen_dpi=metadata['system'].get('dpi'),
            os_name=metadata['system'].get('os'),
            os_version=metadata['system'].get('osVersion'),
            locale=metadata['system'].get('locale'),
            app_name=metadata['targetApplication']['name'],
            app_version=metadata['targetApplication'].get('version'),
            app_type=metadata['targetApplication']['type'],
            app_url=metadata['targetApplication'].get('url'),
            frame_rate=metadata['frameRate'],
            total_frames=metadata['totalFrames'],
            total_interactions=len(interactions),
            total_context_events=len(context_events),
            s3_bucket=storage.bucket_name,
            s3_prefix=s3_prefix,
            upload_size_bytes=len(zip_content),
            status=RecordingStatus.UPLOADED,
            validation_warnings=warnings,
        )

        db.add(recording)

        # Upload frames to S3 and create frame records
        frame_files = [f for f in zip_ref.namelist() if f.startswith('frames/') and f.endswith(('.png', '.jpg', '.jpeg', '.webp'))]

        for frame_file in frame_files:
            # Extract frame number from filename (e.g., "frames/frame_0042.png" -> 42)
            filename = frame_file.split('/')[-1]
            frame_num_str = filename.replace('frame_', '').split('.')[0]
            try:
                frame_number = int(frame_num_str)
            except ValueError:
                logger.warning(f"Could not parse frame number from {filename}")
                continue

            # Read frame data
            frame_data = zip_ref.read(frame_file)
            frame_key = f"{s3_prefix}/frames/{filename}"

            # Upload to S3
            storage.upload_file(
                io.BytesIO(frame_data),
                frame_key,
                content_type=mimetypes.guess_type(filename)[0] or 'image/png',
            )

            # Generate presigned URL
            presigned_url = storage.generate_presigned_url(frame_key, expiration=3600*24*7)  # 7 days

            # Calculate relative time
            relative_time_ms = int((frame_number / metadata['frameRate']) * 1000)
            timestamp = start_time + timedelta(milliseconds=relative_time_ms)

            # Create frame record
            frame = RecordingFrame(
                id=str(uuid.uuid4()),
                recording_id=recording_id,
                frame_number=frame_number,
                timestamp=timestamp,
                relative_time_ms=relative_time_ms,
                s3_key=frame_key,
                image_url=presigned_url,
                url_expires_at=datetime.utcnow() + timedelta(days=7),
                width=recording.screen_width,
                height=recording.screen_height,
                size_bytes=len(frame_data),
                format=filename.split('.')[-1],
            )
            db.add(frame)

        # Create interaction records
        for interaction_data in interactions:
            timestamp = datetime.fromisoformat(interaction_data['timestamp'].replace('Z', '+00:00'))

            interaction = RecordingInteraction(
                id=str(uuid.uuid4()),
                recording_id=recording_id,
                timestamp=timestamp,
                relative_time_ms=interaction_data['relativeTime'],
                frame_number=interaction_data.get('frameNumber'),
                interaction_type=interaction_data['type'],
                action=interaction_data.get('action'),
                x=interaction_data.get('coordinates', {}).get('x'),
                y=interaction_data.get('coordinates', {}).get('y'),
                button=interaction_data.get('button'),
                click_count=interaction_data.get('clickCount', 1),
                start_x=interaction_data.get('startCoordinates', {}).get('x'),
                start_y=interaction_data.get('startCoordinates', {}).get('y'),
                end_x=interaction_data.get('endCoordinates', {}).get('x'),
                end_y=interaction_data.get('endCoordinates', {}).get('y'),
                drag_path=interaction_data.get('path'),
                key=interaction_data.get('key'),
                key_code=interaction_data.get('keyCode'),
                char=interaction_data.get('char'),
                text=interaction_data.get('text'),
                modifiers=interaction_data.get('metadata', {}).get('modifiers', []),
                is_combo=interaction_data.get('metadata', {}).get('isCombo', False),
                scroll_delta_x=interaction_data.get('delta', {}).get('x'),
                scroll_delta_y=interaction_data.get('delta', {}).get('y'),
                scroll_direction=interaction_data.get('direction'),
                hover_duration_ms=interaction_data.get('hoverDuration'),
                hover_triggered=interaction_data.get('hoverTriggered'),
                target_element=interaction_data.get('targetElement'),
                duration_ms=interaction_data.get('metadata', {}).get('duration'),
                metadata=interaction_data.get('metadata'),
            )
            db.add(interaction)

        # Create context event records
        for context_data in context_events:
            timestamp = datetime.fromisoformat(context_data['timestamp'].replace('Z', '+00:00'))

            context = RecordingContext(
                id=str(uuid.uuid4()),
                recording_id=recording_id,
                timestamp=timestamp,
                relative_time_ms=context_data['relativeTime'],
                frame_number=context_data.get('frameNumber'),
                event_type=context_data['eventType'],
                window_title=context_data.get('windowInfo', {}).get('title'),
                process_name=context_data.get('windowInfo', {}).get('processName'),
                process_id=context_data.get('windowInfo', {}).get('processId'),
                window_bounds=context_data.get('windowInfo', {}).get('bounds'),
                window_state=context_data.get('windowInfo', {}).get('state'),
                window_z_index=context_data.get('windowInfo', {}).get('zIndex'),
                is_modal=context_data.get('windowInfo', {}).get('isModal'),
                previous_window=context_data.get('previousWindow'),
                url=context_data.get('webContext', {}).get('url'),
                previous_url=context_data.get('webContext', {}).get('previousUrl'),
                page_title=context_data.get('webContext', {}).get('title'),
                domain=context_data.get('webContext', {}).get('domain'),
                pathname=context_data.get('webContext', {}).get('pathname'),
                navigation_type=context_data.get('webContext', {}).get('navigation'),
                load_time_ms=context_data.get('webContext', {}).get('loadTime'),
                load_complete=context_data.get('webContext', {}).get('loadComplete'),
                focused_element=context_data.get('focusedElement'),
                previous_focus=context_data.get('previousFocus'),
                app_state=context_data.get('appState'),
                cpu_usage=context_data.get('performance', {}).get('cpuUsage'),
                memory_usage=context_data.get('performance', {}).get('memoryUsage'),
                network_activity=context_data.get('performance', {}).get('networkActivity'),
                is_loading=context_data.get('performance', {}).get('isLoading'),
                metadata=context_data.get('metadata'),
                description=context_data.get('description'),
            )
            db.add(context)

        await db.commit()
        await db.refresh(recording)

        return recording, metadata


@router.post("/upload", response_model=UploadResponse)
async def upload_recording(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),  # JSON string
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> UploadResponse:
    """
    Upload a recording (ZIP format or JSON)

    Supports two formats:
    1. ZIP archive with frames/, metadata.json, interactions.json, context.json
    2. JSON file with embedded recording data
    """
    try:
        # Verify project exists and user has access
        project_result = await db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Parse tags if provided
        tag_list = []
        if tags:
            try:
                tag_list = json.loads(tags)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse tags: {tags}")

        # Process based on file type
        if file.filename.endswith('.zip'):
            recording, metadata = await extract_zip_recording(
                file, project_id, str(current_user.id), db
            )
        elif file.filename.endswith('.json'):
            # TODO: Implement JSON format support
            raise HTTPException(
                status_code=400,
                detail="JSON format not yet implemented. Please use ZIP format."
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file format. Please upload a ZIP or JSON file."
            )

        # Update description and tags if provided
        if description:
            recording.description = description
        if tag_list:
            recording.tags = tag_list

        await db.commit()

        return UploadResponse(
            success=True,
            recording_id=recording.id,
            uploaded_at=recording.created_at,
            size_bytes=recording.upload_size_bytes,
            frame_count=recording.total_frames,
            interaction_count=recording.total_interactions,
            status=recording.status,
            validation_errors=recording.validation_errors or [],
            validation_warnings=recording.validation_warnings or [],
            message="Recording uploaded successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading recording: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload recording: {str(e)}"
        )


@router.get("", response_model=RecordingListResponse)
async def list_recordings(
    project_id: Optional[str] = None,
    status: Optional[RecordingStatus] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> RecordingListResponse:
    """List recordings with optional filtering"""
    query = select(Recording).order_by(desc(Recording.created_at))

    # Apply filters
    if project_id:
        query = query.where(Recording.project_id == project_id)
    if status:
        query = query.where(Recording.status == status)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Get paginated results
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    recordings = result.scalars().all()

    # Convert to response models
    recording_responses = []
    for recording in recordings:
        stats = RecordingStats(
            total_frames=recording.total_frames,
            total_interactions=recording.total_interactions,
            total_context_events=recording.total_context_events,
            duration_seconds=recording.duration_seconds,
            frame_rate=recording.frame_rate,
            discovered_states=recording.discovered_states_count,
            discovered_transitions=recording.discovered_transitions_count,
            discovered_workflows=recording.discovered_workflows_count,
        )

        recording_response = RecordingResponse(
            id=str(recording.id),
            project_id=str(recording.project_id),
            created_by_id=str(recording.created_by_id),
            name=recording.name,
            description=recording.description,
            tags=recording.tags or [],
            status=recording.status,
            processing_phase=recording.processing_phase,
            processing_progress=recording.processing_progress,
            created_at=recording.created_at,
            updated_at=recording.updated_at,
            recording_start_time=recording.recording_start_time,
            recording_end_time=recording.recording_end_time,
            stats=stats,
            validation_errors=recording.validation_errors or [],
            validation_warnings=recording.validation_warnings or [],
            confidence=recording.discovery_confidence,
        )
        recording_responses.append(recording_response)

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
    """Get recording details"""
    result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    stats = RecordingStats(
        total_frames=recording.total_frames,
        total_interactions=recording.total_interactions,
        total_context_events=recording.total_context_events,
        duration_seconds=recording.duration_seconds,
        frame_rate=recording.frame_rate,
        discovered_states=recording.discovered_states_count,
        discovered_transitions=recording.discovered_transitions_count,
        discovered_workflows=recording.discovered_workflows_count,
    )

    return RecordingResponse(
        id=str(recording.id),
        project_id=str(recording.project_id),
        created_by_id=str(recording.created_by_id),
        name=recording.name,
        description=recording.description,
        tags=recording.tags or [],
        status=recording.status,
        processing_phase=recording.processing_phase,
        processing_progress=recording.processing_progress,
        created_at=recording.created_at,
        updated_at=recording.updated_at,
        recording_start_time=recording.recording_start_time,
        recording_end_time=recording.recording_end_time,
        stats=stats,
        validation_errors=recording.validation_errors or [],
        validation_warnings=recording.validation_warnings or [],
        confidence=recording.discovery_confidence,
    )


@router.post("/{recording_id}/process")
async def start_processing(
    recording_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
):
    """Start processing a recording to discover states"""
    result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if recording.is_processing:
        raise HTTPException(status_code=400, detail="Recording is already being processed")

    if recording.is_completed:
        raise HTTPException(status_code=400, detail="Recording has already been processed")

    # Update status
    recording.status = RecordingStatus.PROCESSING
    recording.processing_phase = ProcessingPhase.FRAME_ANALYSIS
    recording.processing_progress = 0.0
    recording.processing_started_at = datetime.utcnow()

    await db.commit()

    # Queue ARQ task for processing
    try:
        from app.worker.queue import get_arq_pool
        pool = await get_arq_pool()
        job = await pool.enqueue_job(
            "process_recording_task",
            recording_id
        )
        logger.info(f"Queued processing task for recording {recording_id}", job_id=job.job_id if job else None)
    except Exception as e:
        logger.error(f"Failed to queue processing task: {str(e)}", exc_info=True)
        # Revert status
        recording.status = RecordingStatus.UPLOADED
        recording.processing_phase = None
        recording.processing_progress = 0.0
        recording.processing_started_at = None
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to start processing: {str(e)}")

    return {
        "success": True,
        "message": "Processing started",
        "recording_id": recording_id,
        "status": recording.status,
    }


@router.get("/{recording_id}/status", response_model=ProcessingJobStatus)
async def get_processing_status(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> ProcessingJobStatus:
    """Get processing status for a recording"""
    result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    estimated_completion = None
    if recording.processing_started_at and recording.processing_progress > 0:
        elapsed = (datetime.utcnow() - recording.processing_started_at).total_seconds()
        estimated_total = elapsed / recording.processing_progress
        estimated_completion = recording.processing_started_at + timedelta(seconds=estimated_total)

    return ProcessingJobStatus(
        recording_id=str(recording.id),
        status=recording.status,
        phase=recording.processing_phase,
        progress=recording.processing_progress,
        started_at=recording.processing_started_at,
        estimated_completion=estimated_completion,
        error=recording.processing_error,
    )


@router.get("/{recording_id}/frames", response_model=List[FrameResponse])
async def get_recording_frames(
    recording_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> List[FrameResponse]:
    """Get frames for a recording"""
    # Verify recording exists
    recording_result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = recording_result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Get frames
    result = await db.execute(
        select(RecordingFrame)
        .where(RecordingFrame.recording_id == recording_id)
        .order_by(RecordingFrame.frame_number)
        .offset(skip)
        .limit(limit)
    )
    frames = result.scalars().all()

    # Regenerate presigned URLs if expired
    storage = object_storage
    for frame in frames:
        if not frame.image_url or frame.url_expires_at < datetime.utcnow():
            frame.image_url = storage.generate_presigned_url(frame.s3_key, expiration=3600*24*7)
            frame.url_expires_at = datetime.utcnow() + timedelta(days=7)

    await db.commit()

    return [
        FrameResponse(
            id=str(frame.id),
            recording_id=str(frame.recording_id),
            frame_number=frame.frame_number,
            timestamp=frame.timestamp,
            relative_time_ms=frame.relative_time_ms,
            image_url=frame.image_url,
            width=frame.width,
            height=frame.height,
            perceptual_hash=frame.perceptual_hash,
            cluster_id=frame.cluster_id,
            state_id=str(frame.state_id) if frame.state_id else None,
            window_title=frame.window_title,
            url=frame.url,
        )
        for frame in frames
    ]


@router.get("/{recording_id}/state-structure", response_model=DiscoveredStateStructure)
async def get_discovered_state_structure(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
) -> DiscoveredStateStructure:
    """Get discovered state structure for a recording"""
    # Verify recording exists
    recording_result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = recording_result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if not recording.is_completed:
        raise HTTPException(status_code=400, detail="Recording processing not completed")

    # Get discovered states
    states_result = await db.execute(
        select(DiscoveredState)
        .where(DiscoveredState.recording_id == recording_id)
        .order_by(DiscoveredState.confidence.desc())
    )
    states = states_result.scalars().all()

    # Get discovered transitions
    transitions_result = await db.execute(
        select(DiscoveredTransition)
        .where(DiscoveredTransition.recording_id == recording_id)
        .order_by(DiscoveredTransition.confidence.desc())
    )
    transitions = transitions_result.scalars().all()

    # Convert to response models
    state_responses = [
        DiscoveredStateResponse(
            id=str(state.id),
            recording_id=str(state.recording_id),
            name=state.name,
            description=state.description,
            cluster_id=state.cluster_id,
            state_images=state.state_images or [],
            regions=state.regions or [],
            locations=state.locations or [],
            strings=state.strings or [],
            frame_count=state.frame_count,
            position_x=state.position_x,
            position_y=state.position_y,
            is_initial=state.is_initial,
            is_error_state=state.is_error_state,
            confidence=state.confidence,
            user_edited=state.user_edited,
            user_approved=state.user_approved,
            converted_to_state_id=str(state.converted_to_state_id) if state.converted_to_state_id else None,
        )
        for state in states
    ]

    transition_responses = [
        DiscoveredTransitionResponse(
            id=str(transition.id),
            recording_id=str(transition.recording_id),
            from_state_id=str(transition.from_state_id),
            to_state_id=str(transition.to_state_id) if transition.to_state_id else None,
            activate_state_ids=[str(sid) for sid in (transition.activate_state_ids or [])],
            deactivate_state_ids=[str(sid) for sid in (transition.deactivate_state_ids or [])],
            stays_visible=transition.stays_visible,
            trigger_type=transition.trigger_type,
            trigger_description=transition.trigger_description,
            latency_ms=transition.latency_ms,
            recommended_timeout_ms=transition.recommended_timeout_ms,
            workflow=transition.workflow,
            workflow_name=transition.workflow_name,
            confidence=transition.confidence,
            user_edited=transition.user_edited,
            user_approved=transition.user_approved,
            converted_to_transition_id=str(transition.converted_to_transition_id) if transition.converted_to_transition_id else None,
        )
        for transition in transitions
    ]

    stats = {
        "total_states": len(states),
        "total_transitions": len(transitions),
        "high_confidence_states": sum(1 for s in states if s.confidence and s.confidence > 0.8),
        "medium_confidence_states": sum(1 for s in states if s.confidence and 0.5 <= s.confidence <= 0.8),
        "low_confidence_states": sum(1 for s in states if s.confidence and s.confidence < 0.5),
        "approved_states": sum(1 for s in states if s.user_approved),
        "approved_transitions": sum(1 for t in transitions if t.user_approved),
    }

    return DiscoveredStateStructure(
        recording_id=str(recording.id),
        states=state_responses,
        transitions=transition_responses,
        stats=stats,
        confidence=recording.discovery_confidence,
    )


@router.delete("/{recording_id}")
async def delete_recording(
    recording_id: str,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_user_async),
):
    """Delete a recording and all associated data"""
    result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Delete S3 files
    # TODO: Implement S3 cleanup

    # Delete database record (cascades to all related records)
    await db.delete(recording)
    await db.commit()

    return {"success": True, "message": "Recording deleted successfully"}
