"""
ARQ tasks for recording processing and state discovery
"""

from typing import Any, Dict, List
import uuid
import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime

from app.db.session import AsyncSessionLocal
from app.models.recording import (
    Recording,
    RecordingFrame,
    RecordingInteraction,
    DiscoveredState,
    DiscoveredTransition,
    ProcessingLog,
    RecordingStatus,
    ProcessingPhase,
)
from app.services.frame_analysis_service import FrameAnalysisService
from app.services.state_discovery_service import StateDiscoveryService
from app.services.transition_discovery_service import TransitionDiscoveryService

logger = structlog.get_logger(__name__)


async def process_recording_task(
    ctx: Dict[str, Any],
    recording_id: str,
) -> Dict[str, Any]:
    """
    Process a recording to discover states and transitions

    Args:
        ctx: ARQ context
        recording_id: UUID of recording to process

    Returns:
        Dict with processing results
    """
    logger.info("starting_recording_processing", recording_id=recording_id)

    async with AsyncSessionLocal() as db:
        try:
            # Load recording
            result = await db.execute(
                select(Recording).where(Recording.id == recording_id)
            )
            recording = result.scalar_one_or_none()

            if not recording:
                raise ValueError(f"Recording {recording_id} not found")

            # Update status
            recording.status = RecordingStatus.PROCESSING
            recording.processing_started_at = datetime.utcnow()
            await db.commit()

            # Phase 1: Frame Analysis
            await _log_phase(db, recording_id, ProcessingPhase.FRAME_ANALYSIS, "Starting frame analysis")
            frames_data = await _phase_1_frame_analysis(db, recording_id)
            await _update_progress(db, recording_id, ProcessingPhase.FRAME_ANALYSIS, 0.2)

            # Phase 2: State Identification
            await _log_phase(db, recording_id, ProcessingPhase.STATE_IDENTIFICATION, "Identifying states from clusters")
            states = await _phase_2_state_identification(db, recording_id, frames_data)
            await _update_progress(db, recording_id, ProcessingPhase.STATE_IDENTIFICATION, 0.4)

            # Phase 3: Interaction Processing
            await _log_phase(db, recording_id, ProcessingPhase.INTERACTION_PROCESSING, "Processing interactions")
            interactions = await _phase_3_interaction_processing(db, recording_id)
            await _update_progress(db, recording_id, ProcessingPhase.INTERACTION_PROCESSING, 0.6)

            # Phase 4: Transition Discovery
            await _log_phase(db, recording_id, ProcessingPhase.TRANSITION_DISCOVERY, "Discovering transitions")
            transitions = await _phase_4_transition_discovery(db, recording_id, states, frames_data, interactions)
            await _update_progress(db, recording_id, ProcessingPhase.TRANSITION_DISCOVERY, 0.8)

            # Phase 5: State Machine Assembly & Optimization
            await _log_phase(db, recording_id, ProcessingPhase.STATE_MACHINE_ASSEMBLY, "Assembling state machine")
            await _phase_5_optimization(db, recording_id, states, transitions)
            await _update_progress(db, recording_id, ProcessingPhase.STATE_MACHINE_ASSEMBLY, 0.9)

            # Complete
            await _complete_processing(db, recording_id, states, transitions)
            await _update_progress(db, recording_id, ProcessingPhase.COMPLETED, 1.0)

            logger.info(
                "recording_processing_completed",
                recording_id=recording_id,
                states_found=len(states),
                transitions_found=len(transitions)
            )

            return {
                "status": "success",
                "recording_id": recording_id,
                "states_discovered": len(states),
                "transitions_discovered": len(transitions),
            }

        except Exception as e:
            logger.error(
                "recording_processing_failed",
                recording_id=recording_id,
                error=str(e),
                exc_info=True
            )

            # Update recording with error
            await db.execute(
                update(Recording)
                .where(Recording.id == recording_id)
                .values(
                    status=RecordingStatus.FAILED,
                    processing_error=str(e),
                    processing_completed_at=datetime.utcnow()
                )
            )
            await db.commit()

            return {
                "status": "error",
                "recording_id": recording_id,
                "error": str(e),
            }


async def _log_phase(
    db: AsyncSession,
    recording_id: str,
    phase: ProcessingPhase,
    message: str,
    level: str = "info",
    data: Dict[str, Any] = None
):
    """Log processing phase"""
    log_entry = ProcessingLog(
        id=str(uuid.uuid4()),
        recording_id=recording_id,
        timestamp=datetime.utcnow(),
        phase=phase,
        level=level,
        message=message,
        data=data or {},
    )
    db.add(log_entry)
    await db.commit()


async def _update_progress(
    db: AsyncSession,
    recording_id: str,
    phase: ProcessingPhase,
    progress: float
):
    """Update recording progress"""
    await db.execute(
        update(Recording)
        .where(Recording.id == recording_id)
        .values(
            processing_phase=phase,
            processing_progress=progress,
            updated_at=datetime.utcnow()
        )
    )
    await db.commit()


async def _phase_1_frame_analysis(
    db: AsyncSession,
    recording_id: str
) -> Dict[str, Any]:
    """
    Phase 1: Analyze frames and cluster by similarity

    Returns:
        Dict with frame data and clusters
    """
    logger.info("phase_1_frame_analysis", recording_id=recording_id)

    # Load all frames
    result = await db.execute(
        select(RecordingFrame)
        .where(RecordingFrame.recording_id == recording_id)
        .order_by(RecordingFrame.frame_number)
    )
    frames = result.scalars().all()

    if not frames:
        raise ValueError("No frames found for recording")

    frame_analysis = FrameAnalysisService()

    # Compute perceptual hashes for all frames
    perceptual_hashes = []
    frame_data = []

    for frame in frames:
        try:
            # Download and analyze frame
            image = await frame_analysis.download_frame(frame.s3_key)

            if image:
                # Compute hash
                phash = frame_analysis.compute_perceptual_hash(image)
                frame.perceptual_hash = phash
                frame.phash_computed = True

                # Compute quality metrics
                quality = frame_analysis.calculate_frame_quality(image)
                frame.sharpness = quality["sharpness"]
                frame.brightness = quality["brightness"]
                frame.contrast = quality["contrast"]

                perceptual_hashes.append(phash)

                frame_data.append({
                    "id": str(frame.id),
                    "frame_number": frame.frame_number,
                    "timestamp": frame.timestamp,
                    "relative_time_ms": frame.relative_time_ms,
                    "s3_key": frame.s3_key,
                    "perceptual_hash": phash,
                    "window_title": frame.window_title,
                    "url": frame.url,
                })

        except Exception as e:
            logger.warning(f"Failed to process frame {frame.frame_number}", error=str(e))
            continue

    await db.commit()

    # Cluster frames by similarity
    logger.info("clustering_frames", total_frames=len(perceptual_hashes))

    cluster_labels = frame_analysis.cluster_frames_by_similarity(
        perceptual_hashes,
        similarity_threshold=0.95
    )

    # Update frames with cluster assignment
    for i, frame in enumerate(frames):
        if i < len(cluster_labels):
            frame.cluster_id = int(cluster_labels[i])

    await db.commit()

    # Group frames by cluster
    frames_by_cluster = {}
    for i, frame_dict in enumerate(frame_data):
        if i < len(cluster_labels):
            cluster_id = int(cluster_labels[i])
            if cluster_id not in frames_by_cluster:
                frames_by_cluster[cluster_id] = []
            frames_by_cluster[cluster_id].append(frame_dict)

    await _log_phase(
        db, recording_id, ProcessingPhase.FRAME_ANALYSIS,
        f"Clustered {len(frame_data)} frames into {len(frames_by_cluster)} clusters",
        data={"clusters": len(frames_by_cluster), "frames": len(frame_data)}
    )

    return {
        "frames": frame_data,
        "frames_by_cluster": frames_by_cluster,
        "cluster_count": len(frames_by_cluster),
    }


async def _phase_2_state_identification(
    db: AsyncSession,
    recording_id: str,
    frames_data: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Phase 2: Identify states from frame clusters

    Returns:
        List of discovered states
    """
    logger.info("phase_2_state_identification", recording_id=recording_id)

    state_discovery = StateDiscoveryService()

    # Discover states from clusters
    discovered_states = await state_discovery.identify_states_from_clusters(
        frames_data["frames_by_cluster"],
        frames_data["frames"]
    )

    # Merge similar states
    deduplicated_states = state_discovery.merge_similar_states(
        discovered_states,
        similarity_threshold=0.90
    )

    # Save discovered states to database
    for state in deduplicated_states:
        db_state = DiscoveredState(
            id=state["id"],
            recording_id=recording_id,
            name=state["name"],
            description=state["description"],
            cluster_id=state.get("cluster_id"),
            state_images=state.get("state_images", []),
            regions=state.get("regions", []),
            locations=state.get("locations", []),
            strings=state.get("strings", []),
            frame_ids=state.get("frame_ids", []),
            frame_count=state.get("frame_count", 0),
            is_initial=state.get("is_initial", False),
            is_error_state=state.get("is_error_state", False),
            is_transient=state.get("is_transient", False),
            confidence=state.get("confidence"),
            uniqueness_score=state.get("uniqueness_score"),
            stability_score=state.get("stability_score"),
            distinctiveness_score=state.get("distinctiveness_score"),
            window_context=state.get("window_context"),
            url_context=state.get("url_context"),
            created_at=datetime.utcnow(),
        )
        db.add(db_state)

    # Update frames with state assignments
    for state in deduplicated_states:
        for frame_id in state.get("frame_ids", []):
            await db.execute(
                update(RecordingFrame)
                .where(RecordingFrame.id == frame_id)
                .values(state_id=state["id"])
            )

    await db.commit()

    await _log_phase(
        db, recording_id, ProcessingPhase.STATE_IDENTIFICATION,
        f"Identified {len(deduplicated_states)} states",
        data={"states": len(deduplicated_states)}
    )

    return deduplicated_states


async def _phase_3_interaction_processing(
    db: AsyncSession,
    recording_id: str
) -> List[Dict[str, Any]]:
    """
    Phase 3: Load and process interactions

    Returns:
        List of interaction data
    """
    logger.info("phase_3_interaction_processing", recording_id=recording_id)

    # Load interactions
    result = await db.execute(
        select(RecordingInteraction)
        .where(RecordingInteraction.recording_id == recording_id)
        .order_by(RecordingInteraction.relative_time_ms)
    )
    interactions = result.scalars().all()

    # Convert to dicts
    interaction_data = []
    for interaction in interactions:
        interaction_data.append({
            "id": str(interaction.id),
            "timestamp": interaction.timestamp,
            "relative_time_ms": interaction.relative_time_ms,
            "frame_number": interaction.frame_number,
            "interaction_type": interaction.interaction_type,
            "action": interaction.action,
            "x": interaction.x,
            "y": interaction.y,
            "button": interaction.button,
            "click_count": interaction.click_count,
            "start_x": interaction.start_x,
            "start_y": interaction.start_y,
            "end_x": interaction.end_x,
            "end_y": interaction.end_y,
            "key": interaction.key,
            "text": interaction.text,
            "modifiers": interaction.modifiers or [],
            "target_element": interaction.target_element or {},
        })

    await _log_phase(
        db, recording_id, ProcessingPhase.INTERACTION_PROCESSING,
        f"Processed {len(interaction_data)} interactions",
        data={"interactions": len(interaction_data)}
    )

    return interaction_data


async def _phase_4_transition_discovery(
    db: AsyncSession,
    recording_id: str,
    states: List[Dict[str, Any]],
    frames_data: Dict[str, Any],
    interactions: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Phase 4: Discover transitions between states

    Returns:
        List of discovered transitions
    """
    logger.info("phase_4_transition_discovery", recording_id=recording_id)

    transition_discovery = TransitionDiscoveryService()

    # Discover transitions
    discovered_transitions = transition_discovery.discover_transitions(
        states,
        frames_data["frames"],
        interactions
    )

    # Deduplicate
    deduplicated_transitions = transition_discovery.deduplicate_transitions(
        discovered_transitions
    )

    # Save to database
    for transition in deduplicated_transitions:
        db_transition = DiscoveredTransition(
            id=transition["id"],
            recording_id=recording_id,
            from_state_id=transition["from_state_id"],
            to_state_id=transition.get("to_state_id"),
            activate_state_ids=transition.get("activate_state_ids", []),
            deactivate_state_ids=transition.get("deactivate_state_ids", []),
            stays_visible=transition.get("stays_visible", False),
            trigger_interaction_id=transition.get("trigger_interaction_id"),
            trigger_type=transition.get("trigger_type"),
            trigger_description=transition.get("trigger_description"),
            latency_ms=transition.get("latency_ms"),
            recommended_timeout_ms=transition.get("recommended_timeout_ms"),
            recommended_retry_count=transition.get("recommended_retry_count", 3),
            workflow=transition.get("workflow"),
            workflow_name=transition.get("workflow_name"),
            confidence=transition.get("confidence"),
            clarity_score=transition.get("clarity_score"),
            consistency_score=transition.get("consistency_score"),
            completeness_score=transition.get("completeness_score"),
            created_at=datetime.utcnow(),
        )
        db.add(db_transition)

    await db.commit()

    await _log_phase(
        db, recording_id, ProcessingPhase.TRANSITION_DISCOVERY,
        f"Discovered {len(deduplicated_transitions)} transitions",
        data={"transitions": len(deduplicated_transitions)}
    )

    return deduplicated_transitions


async def _phase_5_optimization(
    db: AsyncSession,
    recording_id: str,
    states: List[Dict[str, Any]],
    transitions: List[Dict[str, Any]]
):
    """
    Phase 5: Optimize state machine (remove transient states, calculate layout)

    This is a simplified version - in production would do more optimization
    """
    logger.info("phase_5_optimization", recording_id=recording_id)

    # Calculate canvas positions using simple layout
    for i, state in enumerate(states):
        # Simple grid layout
        row = i // 3
        col = i % 3

        position_x = col * 300.0
        position_y = row * 200.0

        await db.execute(
            update(DiscoveredState)
            .where(DiscoveredState.id == state["id"])
            .values(
                position_x=position_x,
                position_y=position_y
            )
        )

    await db.commit()

    await _log_phase(
        db, recording_id, ProcessingPhase.OPTIMIZATION,
        "Optimized state machine layout"
    )


async def _complete_processing(
    db: AsyncSession,
    recording_id: str,
    states: List[Dict[str, Any]],
    transitions: List[Dict[str, Any]]
):
    """Mark processing as completed and update stats"""
    # Calculate average confidence
    state_confidences = [s.get("confidence", 0.0) for s in states if s.get("confidence")]
    avg_confidence = sum(state_confidences) / len(state_confidences) if state_confidences else None

    await db.execute(
        update(Recording)
        .where(Recording.id == recording_id)
        .values(
            status=RecordingStatus.COMPLETED,
            processing_phase=ProcessingPhase.COMPLETED,
            processing_progress=1.0,
            processing_completed_at=datetime.utcnow(),
            discovered_states_count=len(states),
            discovered_transitions_count=len(transitions),
            discovered_workflows_count=len(transitions),  # One workflow per transition
            discovery_confidence=avg_confidence,
        )
    )
    await db.commit()

    await _log_phase(
        db, recording_id, ProcessingPhase.COMPLETED,
        f"Processing completed: {len(states)} states, {len(transitions)} transitions",
        data={
            "states": len(states),
            "transitions": len(transitions),
            "confidence": avg_confidence
        }
    )
