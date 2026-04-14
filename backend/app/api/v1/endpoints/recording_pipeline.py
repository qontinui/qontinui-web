"""
Recording Pipeline API endpoints.

Processes recording session exports from the UI Bridge SDK into
discovered state machines with states, transitions, and optionally
generated playbooks. Persists results to PostgreSQL.
"""

from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

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

    Takes a CooccurrenceExport JSON (from the UI Bridge SDK's
    RecordingSessionManager.stop()) and runs the full pipeline:
    state discovery, transition detection, and persistence.

    **Returns:**
    - Discovered states with confidence scores
    - Detected transitions with reliability metrics
    """
    from qontinui.state_machine import (RecordingPipeline,
                                        RecordingPipelineConfig)

    logger.info(
        "recording_pipeline_request",
        session_id=request.export_data.get("sessionId", "unknown"),
        fingerprint_count=len(request.export_data.get("allFingerprints", [])),
        transition_count=len(request.export_data.get("transitions", [])),
    )

    try:
        # Build config from request
        config = RecordingPipelineConfig()
        if request.config:
            for key, value in request.config.items():
                if hasattr(config, key):
                    setattr(config, key, value)
        # Don't persist via the API — let the caller decide
        config.persist = False

        pipeline = RecordingPipeline(persistence=None, config=config)
        result = pipeline.process_recording(request.export_data)

        # Build response
        states = []
        for s in result.states:
            states.append(
                DiscoveredStateResponse(
                    id=s.id,
                    name=s.name,
                    element_count=len(s.element_ids),
                    is_blocking=s.blocking,
                    is_global=s.metadata.get("is_global", False),
                    position_zone=s.metadata.get("position_zone"),
                    confidence=s.metadata.get("confidence", 0.0),
                )
            )

        transitions = []
        for t in result.transitions:
            transitions.append(
                DiscoveredTransitionResponse(
                    id=t.id,
                    name=t.name,
                    from_states=t.from_states,
                    activate_states=t.activate_states,
                    exit_states=t.exit_states,
                    confidence=t.metadata.get("confidence", 0.0),
                    observation_count=t.metadata.get("observation_count", 0),
                    is_bidirectional=t.metadata.get("is_bidirectional", False),
                )
            )

        # Persist to PostgreSQL if project_id is provided
        if request.project_id:
            await _persist_to_pg(
                db=db,
                project_id=request.project_id,
                config_name=request.config_name or f"recording-{result.session_id}",
                result=result,
                export_data=request.export_data,
            )
            await db.commit()

        logger.info(
            "recording_pipeline_success",
            session_id=result.session_id,
            state_count=result.state_count,
            transition_count=result.transition_count,
            persisted=request.project_id is not None,
        )

        return ProcessRecordingResponse(
            session_id=result.session_id,
            state_count=result.state_count,
            transition_count=result.transition_count,
            global_state_count=result.global_state_count,
            modal_state_count=result.modal_state_count,
            states=states,
            transitions=transitions,
        )

    except ValueError as e:
        logger.warning("recording_pipeline_invalid_input", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("recording_pipeline_error", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Recording pipeline failed: {e}",
        ) from e


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

    Same as /process but additionally generates a playbook markdown file
    from the discovered states, transitions, and extracted variables.
    """
    from qontinui.state_machine import (RecordingPipeline,
                                        RecordingPipelineConfig)
    from qontinui.state_machine.playbook_generator import generate_playbook

    logger.info(
        "recording_pipeline_with_playbook_request",
        session_id=request.export_data.get("sessionId", "unknown"),
        variable_count=len(request.variables),
    )

    try:
        config = RecordingPipelineConfig()
        if request.config:
            for key, value in request.config.items():
                if hasattr(config, key):
                    setattr(config, key, value)
        config.persist = False

        pipeline = RecordingPipeline(persistence=None, config=config)
        result = pipeline.process_recording(request.export_data)

        # Generate playbook
        playbook_content = generate_playbook(
            states=result.states,
            transitions=result.transitions,
            variables=request.variables,
            interactions=request.export_data.get("transitions", []),
            app_name=request.app_name,
            app_url=request.app_url,
        )

        # Build state/transition responses (same as /process)
        states = [
            DiscoveredStateResponse(
                id=s.id,
                name=s.name,
                element_count=len(s.element_ids),
                is_blocking=s.blocking,
                is_global=s.metadata.get("is_global", False),
                position_zone=s.metadata.get("position_zone"),
                confidence=s.metadata.get("confidence", 0.0),
            )
            for s in result.states
        ]

        transitions = [
            DiscoveredTransitionResponse(
                id=t.id,
                name=t.name,
                from_states=t.from_states,
                activate_states=t.activate_states,
                exit_states=t.exit_states,
                confidence=t.metadata.get("confidence", 0.0),
                observation_count=t.metadata.get("observation_count", 0),
                is_bidirectional=t.metadata.get("is_bidirectional", False),
            )
            for t in result.transitions
        ]

        # Persist to PostgreSQL if project_id is provided
        state_config_id = None
        if request.project_id:
            state_config_id = await _persist_to_pg(
                db=db,
                project_id=request.project_id,
                config_name=request.config_name or f"recording-{result.session_id}",
                result=result,
                export_data=request.export_data,
            )

        # Save as experience memory
        if request.project_id and request.save_experience:
            await _save_experience(
                db=db,
                project_id=request.project_id,
                result=result,
                export_data=request.export_data,
                variables=request.variables,
                app_name=request.app_name,
                app_url=request.app_url,
                playbook_content=playbook_content,
                state_config_id=state_config_id,
            )

        # Single commit for both persist + experience (atomic)
        if request.project_id:
            await db.commit()

        return ProcessWithPlaybookResponse(
            session_id=result.session_id,
            state_count=result.state_count,
            transition_count=result.transition_count,
            global_state_count=result.global_state_count,
            modal_state_count=result.modal_state_count,
            states=states,
            transitions=transitions,
            playbook_content=playbook_content,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error(
            "recording_pipeline_with_playbook_error", error=str(e), exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Recording pipeline with playbook failed: {e}",
        ) from e


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

    Matches new states to existing ones by fingerprint overlap, updates
    confidence scores, adds new transitions, and increases observation counts.
    The existing state config is updated in-place.
    """
    from app.models.ui_bridge_state import UIBridgeState as UIBridgeStateModel
    from app.models.ui_bridge_state import UIBridgeStateConfig
    from app.models.ui_bridge_transition import \
        UIBridgeTransition as UIBridgeTransitionModel
    from qontinui.state_machine import (RecordingPipeline,
                                        RecordingPipelineConfig)
    from qontinui.state_machine.ui_bridge_runtime import \
        UIBridgeState as UIBridgeStateInternal
    from qontinui.state_machine.ui_bridge_runtime import \
        UIBridgeTransition as UIBridgeTransitionInternal
    from sqlalchemy import select

    # Load existing config with states and transitions
    config_result = await db.execute(
        select(UIBridgeStateConfig).where(UIBridgeStateConfig.id == request.config_id)
    )
    state_config = config_result.scalar_one_or_none()
    if not state_config:
        raise HTTPException(status_code=404, detail="State config not found")

    states_result = await db.execute(
        select(UIBridgeStateModel).where(
            UIBridgeStateModel.config_id == request.config_id
        )
    )
    existing_state_rows = states_result.scalars().all()

    transitions_result = await db.execute(
        select(UIBridgeTransitionModel).where(
            UIBridgeTransitionModel.config_id == request.config_id
        )
    )
    existing_transition_rows = transitions_result.scalars().all()

    # Convert PG models to internal types
    existing_states = [
        UIBridgeStateInternal(
            id=row.state_id,
            name=row.name,
            element_ids=row.element_ids or [],
            blocking=(
                row.extra_metadata.get("blocking", False)
                if row.extra_metadata
                else False
            ),
            metadata={
                "confidence": row.confidence,
                "is_global": (
                    row.extra_metadata.get("is_global", False)
                    if row.extra_metadata
                    else False
                ),
                "position_zone": (
                    row.extra_metadata.get("position_zone")
                    if row.extra_metadata
                    else None
                ),
                **(row.extra_metadata or {}),
            },
        )
        for row in existing_state_rows
    ]

    existing_transitions = [
        UIBridgeTransitionInternal(
            id=row.transition_id,
            name=row.name,
            from_states=row.from_states or [],
            activate_states=row.activate_states or [],
            exit_states=row.exit_states or [],
            actions=row.actions or [],
            path_cost=row.path_cost,
            metadata=row.extra_metadata or {},
        )
        for row in existing_transition_rows
    ]

    # Run merge
    pipeline_config = RecordingPipelineConfig()
    if request.config:
        for key, value in request.config.items():
            if hasattr(pipeline_config, key):
                setattr(pipeline_config, key, value)
    pipeline_config.persist = False

    pipeline = RecordingPipeline(persistence=None, config=pipeline_config)
    result = pipeline.merge_recording(
        export_data=request.export_data,
        existing_states=existing_states,
        existing_transitions=existing_transitions,
    )

    # Update PG: delete old states/transitions, insert merged ones
    for row in existing_state_rows:
        await db.delete(row)
    for row in existing_transition_rows:
        await db.delete(row)

    for s in result.states:
        db.add(
            UIBridgeStateModel(
                config_id=request.config_id,
                state_id=s.id,
                name=s.name,
                element_ids=s.element_ids,
                confidence=s.metadata.get("confidence", 0.0),
                extra_metadata={
                    "blocking": s.blocking,
                    "is_global": s.metadata.get("is_global", False),
                    "position_zone": s.metadata.get("position_zone"),
                    "observation_count": s.metadata.get("observation_count", 1),
                    "source": "recording_merge",
                },
            )
        )

    for t in result.transitions:
        db.add(
            UIBridgeTransitionModel(
                config_id=request.config_id,
                transition_id=t.id,
                name=t.name,
                from_states=t.from_states,
                activate_states=t.activate_states,
                exit_states=t.exit_states,
                actions=t.actions,
                path_cost=t.path_cost,
                extra_metadata={
                    "confidence": t.metadata.get("confidence", 0.0),
                    "observation_count": t.metadata.get("observation_count", 1),
                    "source": "recording_merge",
                },
            )
        )

    await db.commit()

    # Build response
    states = [
        DiscoveredStateResponse(
            id=s.id,
            name=s.name,
            element_count=len(s.element_ids),
            is_blocking=s.blocking,
            is_global=s.metadata.get("is_global", False),
            position_zone=s.metadata.get("position_zone"),
            confidence=s.metadata.get("confidence", 0.0),
        )
        for s in result.states
    ]
    transitions = [
        DiscoveredTransitionResponse(
            id=t.id,
            name=t.name,
            from_states=t.from_states,
            activate_states=t.activate_states,
            exit_states=t.exit_states,
            confidence=t.metadata.get("confidence", 0.0),
            observation_count=t.metadata.get("observation_count", 0),
            is_bidirectional=t.metadata.get("is_bidirectional", False),
        )
        for t in result.transitions
    ]

    return ProcessRecordingResponse(
        session_id=result.session_id,
        state_count=result.state_count,
        transition_count=result.transition_count,
        global_state_count=result.global_state_count,
        modal_state_count=result.modal_state_count,
        states=states,
        transitions=transitions,
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
    from app.models.recording_session import RecordingSession
    from sqlalchemy import select

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
# PostgreSQL Persistence
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
    from app.models.ui_bridge_transition import \
        UIBridgeTransition as UIBridgeTransitionModel

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
