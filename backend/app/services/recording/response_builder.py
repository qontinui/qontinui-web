"""
Recording response builder service.

Builds API response schemas from database models.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from app.models.recording import Recording, RecordingFrame
from app.schemas.recording import (
    DiscoveredStateResponse,
    DiscoveredTransitionResponse,
    FrameResponse,
    ProcessingJobStatus,
    RecordingResponse,
    RecordingStats,
)


class RecordingResponseBuilder:
    """Builds response schemas from Recording models."""

    @classmethod
    def build_recording_response(cls, recording: Recording) -> RecordingResponse:
        """
        Build RecordingResponse from database model.

        Args:
            recording: Recording database model

        Returns:
            RecordingResponse schema
        """
        stats = RecordingStats(
            total_frames=recording.total_frames,  # type: ignore[arg-type]
            total_interactions=recording.total_interactions,  # type: ignore[arg-type]
            total_context_events=recording.total_context_events,  # type: ignore[arg-type]
            duration_seconds=recording.duration_seconds,
            frame_rate=recording.frame_rate,  # type: ignore[arg-type]
            discovered_states=recording.discovered_states_count,  # type: ignore[arg-type]
            discovered_transitions=recording.discovered_transitions_count,  # type: ignore[arg-type]
            discovered_workflows=recording.discovered_workflows_count,  # type: ignore[arg-type]
        )

        return RecordingResponse(
            id=str(recording.id),
            project_id=str(recording.project_id),
            created_by_id=str(recording.created_by_id),
            name=recording.name,  # type: ignore[arg-type]
            description=recording.description,  # type: ignore[arg-type]
            tags=recording.tags or [],  # type: ignore[arg-type]
            status=recording.status,  # type: ignore[arg-type]
            processing_phase=recording.processing_phase,  # type: ignore[arg-type]
            processing_progress=recording.processing_progress,  # type: ignore[arg-type]
            created_at=recording.created_at,  # type: ignore[arg-type]
            updated_at=recording.updated_at,  # type: ignore[arg-type]
            recording_start_time=recording.recording_start_time,  # type: ignore[arg-type]
            recording_end_time=recording.recording_end_time,  # type: ignore[arg-type]
            stats=stats,
            validation_errors=recording.validation_errors or [],  # type: ignore[arg-type]
            validation_warnings=recording.validation_warnings or [],  # type: ignore[arg-type]
            confidence=recording.discovery_confidence,  # type: ignore[arg-type]
        )

    @classmethod
    def build_frame_response(cls, frame: RecordingFrame) -> FrameResponse:
        """
        Build FrameResponse from database model.

        Args:
            frame: RecordingFrame database model

        Returns:
            FrameResponse schema
        """
        return FrameResponse(
            id=str(frame.id),
            recording_id=str(frame.recording_id),
            frame_number=frame.frame_number,  # type: ignore[arg-type]
            timestamp=frame.timestamp,  # type: ignore[arg-type]
            relative_time_ms=frame.relative_time_ms,  # type: ignore[arg-type]
            image_url=frame.image_url,  # type: ignore[arg-type]
            width=frame.width,  # type: ignore[arg-type]
            height=frame.height,  # type: ignore[arg-type]
            perceptual_hash=frame.perceptual_hash,  # type: ignore[arg-type]
            cluster_id=frame.cluster_id,  # type: ignore[arg-type]
            state_id=str(frame.state_id) if frame.state_id else None,
            window_title=frame.window_title,  # type: ignore[arg-type]
            url=frame.url,  # type: ignore[arg-type]
        )

    @classmethod
    def build_processing_status(cls, recording: Recording) -> ProcessingJobStatus:
        """
        Build ProcessingJobStatus from database model.

        Args:
            recording: Recording database model

        Returns:
            ProcessingJobStatus schema
        """
        estimated_completion = None
        if recording.processing_started_at and recording.processing_progress > 0:
            elapsed = (
                datetime.now(UTC) - recording.processing_started_at
            ).total_seconds()
            estimated_total = elapsed / recording.processing_progress
            estimated_completion = recording.processing_started_at + timedelta(
                seconds=estimated_total
            )

        return ProcessingJobStatus(
            recording_id=str(recording.id),
            status=recording.status,  # type: ignore[arg-type]
            phase=recording.processing_phase,  # type: ignore[arg-type]
            progress=recording.processing_progress,  # type: ignore[arg-type]
            started_at=recording.processing_started_at,  # type: ignore[arg-type]
            estimated_completion=estimated_completion,  # type: ignore[arg-type]
            error=recording.processing_error,  # type: ignore[arg-type]
        )

    @classmethod
    def build_state_response(cls, state: Any) -> DiscoveredStateResponse:
        """
        Build DiscoveredStateResponse from database model.

        Args:
            state: DiscoveredState database model

        Returns:
            DiscoveredStateResponse schema
        """
        return DiscoveredStateResponse(
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
            converted_to_state_id=(
                str(state.converted_to_state_id)
                if state.converted_to_state_id
                else None
            ),
        )

    @classmethod
    def build_transition_response(cls, transition: Any) -> DiscoveredTransitionResponse:
        """
        Build DiscoveredTransitionResponse from database model.

        Args:
            transition: DiscoveredTransition database model

        Returns:
            DiscoveredTransitionResponse schema
        """
        return DiscoveredTransitionResponse(
            id=str(transition.id),
            recording_id=str(transition.recording_id),
            from_state_id=str(transition.from_state_id),
            to_state_id=str(transition.to_state_id) if transition.to_state_id else None,
            activate_state_ids=[
                str(sid) for sid in (transition.activate_state_ids or [])
            ],
            deactivate_state_ids=[
                str(sid) for sid in (transition.deactivate_state_ids or [])
            ],
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
            converted_to_transition_id=(
                str(transition.converted_to_transition_id)
                if transition.converted_to_transition_id
                else None
            ),
        )
