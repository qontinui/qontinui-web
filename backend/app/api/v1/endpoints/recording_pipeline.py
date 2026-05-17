"""
Recording Pipeline API endpoints.

Processes recording session exports from the UI Bridge SDK into
discovered state machines with states, transitions, and optionally
generated playbooks. Persists results to PostgreSQL.

NOTE: As of plan-2026-05-17-web-image-slim, the pipeline-execution endpoints
(/process, /process-with-playbook, /merge) return 503. The qontinui
state-machine library that powered them now lives on the runner; the
web - runner WebSocket bridge is tracked under
plan-2026-05-17-ws-bridge-for-violating-routers. The /experiences
read-only endpoint and the PG persistence helpers below remain functional
because they only touch app.models.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db

logger = structlog.get_logger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class ProcessRecordingRequest(BaseModel):
    """Request to process a recording session export."""

    export_data: dict[str, Any] = Field(
        ...,
        description="CooccurrenceExport JSON from the SDK's RecordingSessionManager.stop()",
    )
    config: dict[str, Any] | None = Field(
        None,
        description="Optional RecordingPipelineConfig overrides",
    )
    project_id: UUID | None = Field(
        None,
        description="Project UUID for persisting results to PostgreSQL",
    )
    config_name: str | None = Field(
        None,
        description="Name for the state config (defaults to 'recording-{session_id}')",
    )


class DiscoveredStateResponse(BaseModel):
    """A discovered state in the response."""

    id: str
    name: str
    element_count: int
    is_blocking: bool = False
    is_global: bool = False
    position_zone: str | None = None
    confidence: float = 0.0


class DiscoveredTransitionResponse(BaseModel):
    """A discovered transition in the response."""

    id: str
    name: str
    from_states: list[str]
    activate_states: list[str]
    exit_states: list[str]
    confidence: float = 0.0
    observation_count: int = 0
    is_bidirectional: bool = False


class ProcessRecordingResponse(BaseModel):
    """Response from processing a recording session."""

    session_id: str
    state_count: int
    transition_count: int
    global_state_count: int = 0
    modal_state_count: int = 0
    states: list[DiscoveredStateResponse]
    transitions: list[DiscoveredTransitionResponse]


class ProcessWithPlaybookRequest(ProcessRecordingRequest):
    """Request to process recording and generate a playbook."""

    variables: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Variable candidates from the recording session",
    )
    app_name: str | None = Field(None, description="Application name for triggers")
    app_url: str | None = Field(None, description="Application URL for triggers")
    save_experience: bool = Field(
        True,
        description="Whether to save this session as experience memory for future retrieval",
    )


class ProcessWithPlaybookResponse(ProcessRecordingResponse):
    """Response with generated playbook content."""

    playbook_content: str = Field("", description="Generated playbook markdown content")


# ============================================================================
# 503 helper
# ============================================================================


def _runner_bridge_503(endpoint: str, runner_module: str) -> HTTPException:
    """Build the structured 503 envelope for endpoints that depend on
    qontinui runtime functionality (now living on the runner)."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "endpoint_requires_runner_bridge",
            "message": (
                "This endpoint depends on qontinui runtime functionality that lives on "
                "the runner. The web - runner WebSocket bridge for this functionality is "
                "not yet implemented. See architectural-decisions.md "
                "'Web - runner WebSocket boundary'."
            ),
            "runner_module": runner_module,
            "endpoint": endpoint,
            "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
        },
    )


# ============================================================================
# Endpoints
# ============================================================================


@router.post(
    "/process",
    response_model=ProcessRecordingResponse,
    status_code=status.HTTP_200_OK,
)
async def process_recording(
    request: ProcessRecordingRequest,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Process a recording session export into a state machine.

    Returns 503 until the runner-bridge ships — qontinui.state_machine
    no longer lives in the web image.
    """
    raise _runner_bridge_503(
        "/api/v1/recording-pipeline/process",
        "qontinui.state_machine",
    )


@router.post(
    "/process-with-playbook",
    response_model=ProcessWithPlaybookResponse,
    status_code=status.HTTP_200_OK,
)
async def process_recording_with_playbook(
    request: ProcessWithPlaybookRequest,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Process a recording session and generate a playbook.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503(
        "/api/v1/recording-pipeline/process-with-playbook",
        "qontinui.state_machine",
    )


# ============================================================================
# Incremental Merge
# ============================================================================


class MergeRecordingRequest(BaseModel):
    """Request to merge a new recording into an existing state config."""

    export_data: dict[str, Any] = Field(
        ..., description="New recording's CooccurrenceExport JSON"
    )
    config_id: UUID = Field(
        ..., description="Existing UIBridgeStateConfig UUID to merge into"
    )
    config: dict[str, Any] | None = Field(None)


@router.post(
    "/merge",
    response_model=ProcessRecordingResponse,
    status_code=status.HTTP_200_OK,
)
async def merge_recording(
    request: MergeRecordingRequest,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Merge a new recording session into an existing state machine.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503(
        "/api/v1/recording-pipeline/merge",
        "qontinui.state_machine",
    )


# ============================================================================
# Experience Memory Retrieval
# ============================================================================


class ExperienceSessionResponse(BaseModel):
    """A past recording session for experience retrieval."""

    session_id: str
    app_name: str | None = None
    app_domain: str | None = None
    state_count: int = 0
    transition_count: int = 0
    avg_confidence: float = 0.0
    recorded_at: str
    duration_ms: int = 0


@router.get(
    "/experiences",
    response_model=list[ExperienceSessionResponse],
    status_code=status.HTTP_200_OK,
)
async def get_past_experiences(
    project_id: UUID,
    app_domain: str | None = None,
    app_name: str | None = None,
    limit: int = 10,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Retrieve past recording sessions for experience-informed state discovery.

    Filters by project and optionally by app domain or name for similarity matching.
    """
    from sqlalchemy import select

    from app.models.recording_session import RecordingSession

    query = select(RecordingSession).where(
        RecordingSession.project_id == project_id,
    )

    if app_domain:
        query = query.where(RecordingSession.app_domain == app_domain)
    elif app_name:
        query = query.where(RecordingSession.app_name == app_name)

    query = query.order_by(RecordingSession.recorded_at.desc()).limit(limit)

    result = await db.execute(query)
    sessions = result.scalars().all()

    return [
        ExperienceSessionResponse(
            session_id=s.session_id,
            app_name=s.app_name,
            app_domain=s.app_domain,
            state_count=s.state_count,
            transition_count=s.transition_count,
            avg_confidence=s.avg_confidence,
            recorded_at=s.recorded_at.isoformat(),
            duration_ms=s.duration_ms,
        )
        for s in sessions
    ]


# ============================================================================
# PostgreSQL Persistence (helpers retained for the future runner-bridge —
# they only touch app.models, no qontinui dep)
# ============================================================================


def _compute_duration_ms(export_data: dict[str, Any]) -> int:
    """Compute recording duration from transition timestamps."""
    transitions = export_data.get("transitions", [])
    if transitions:
        timestamps: list[int] = [
            t.get("timestamp", 0) for t in transitions if t.get("timestamp")
        ]
        if len(timestamps) >= 2:
            return max(timestamps) - min(timestamps)
    # Fallback: use fingerprint stats first/last seen
    stats = export_data.get("fingerprintStats", {})
    if stats:
        all_first: list[int] = [
            s.get("firstSeen", 0) for s in stats.values() if s.get("firstSeen")
        ]
        all_last: list[int] = [
            s.get("lastSeen", 0) for s in stats.values() if s.get("lastSeen")
        ]
        if all_first and all_last:
            return max(all_last) - min(all_first)
    return 0


async def _persist_to_pg(
    db: AsyncSession,
    project_id: UUID,
    config_name: str,
    result: Any,  # RecordingPipelineResult
    export_data: dict[str, Any],
) -> UUID | None:
    """Persist discovered states and transitions to PostgreSQL.

    Creates a UIBridgeStateConfig with child UIBridgeState and UIBridgeTransition rows.
    """
    from app.models.ui_bridge_state import UIBridgeState as UIBridgeStateModel
    from app.models.ui_bridge_state import UIBridgeStateConfig
    from app.models.ui_bridge_transition import (
        UIBridgeTransition as UIBridgeTransitionModel,
    )

    # Create a state config
    state_config = UIBridgeStateConfig(
        project_id=project_id,
        name=config_name,
        description=f"Auto-discovered from recording session {result.session_id}",
        render_count=len(export_data.get("presenceMatrix", [])),
        element_count=len(export_data.get("allFingerprints", [])),
        discovery_result={
            "source": "recording_pipeline",
            "session_id": result.session_id,
            "state_count": result.state_count,
            "transition_count": result.transition_count,
            "global_state_count": result.global_state_count,
            "modal_state_count": result.modal_state_count,
        },
    )
    db.add(state_config)
    await db.flush()  # Get the generated UUID

    # Create state rows
    for s in result.states:
        state_row = UIBridgeStateModel(
            config_id=state_config.id,
            state_id=s.id,
            name=s.name,
            element_ids=s.element_ids,
            confidence=s.metadata.get("confidence", 0.0),
            extra_metadata={
                "blocking": s.blocking,
                "is_global": s.metadata.get("is_global", False),
                "position_zone": s.metadata.get("position_zone"),
                "source": "recording",
            },
        )
        db.add(state_row)

    # Create transition rows
    for t in result.transitions:
        transition_row = UIBridgeTransitionModel(
            config_id=state_config.id,
            transition_id=t.id,
            name=t.name,
            from_states=t.from_states,
            activate_states=t.activate_states,
            exit_states=t.exit_states,
            actions=t.actions,
            path_cost=t.path_cost,
            stays_visible=t.metadata.get("stays_visible", False),
            extra_metadata={
                "confidence": t.metadata.get("confidence", 0.0),
                "observation_count": t.metadata.get("observation_count", 0),
                "is_bidirectional": t.metadata.get("is_bidirectional", False),
                "source": "recording",
            },
        )
        db.add(transition_row)

    # NOTE: caller is responsible for committing (to allow batching with _save_experience)
    await db.flush()
    logger.info(
        "recording_pipeline_persisted",
        config_id=str(state_config.id),
        project_id=str(project_id),
        state_count=len(result.states),
        transition_count=len(result.transitions),
    )
    return state_config.id


async def _save_experience(
    db: AsyncSession,
    project_id: UUID,
    result: Any,  # RecordingPipelineResult
    export_data: dict[str, Any],
    variables: list[dict[str, Any]],
    app_name: str | None = None,
    app_url: str | None = None,
    playbook_content: str | None = None,
    state_config_id: UUID | None = None,
) -> None:
    """Save a completed recording session as experience memory."""
    from urllib.parse import urlparse

    from app.models.recording_session import RecordingSession

    # Extract domain from URL
    app_domain = None
    if app_url:
        try:
            app_domain = urlparse(app_url).hostname
        except Exception:
            pass

    # Compute average confidence
    confidences = [
        t.metadata.get("confidence", 0.0) for t in result.transitions if t.metadata
    ]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    session = RecordingSession(
        project_id=project_id,
        session_id=result.session_id,
        app_name=app_name,
        app_url=app_url,
        app_domain=app_domain,
        duration_ms=_compute_duration_ms(export_data),
        interaction_count=len(export_data.get("transitions", [])),
        capture_count=len(export_data.get("presenceMatrix", [])),
        state_count=result.state_count,
        transition_count=result.transition_count,
        variable_count=len(variables),
        avg_confidence=avg_confidence,
        export_data=export_data,
        variables=variables,
        playbook_content=playbook_content,
        state_config_id=state_config_id,
    )
    db.add(session)
    # NOTE: caller is responsible for committing
    await db.flush()

    logger.info(
        "recording_experience_saved",
        session_id=result.session_id,
        app_domain=app_domain,
        state_count=result.state_count,
    )
