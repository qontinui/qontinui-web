"""
Recording Pipeline API endpoints.

Processes recording session exports from the UI Bridge SDK into
discovered state machines with states, transitions, and optionally
generated playbooks. The pipeline runs minutes for non-trivial
recordings; this surface is **async-with-progress** via the runner WS
bridge:

- ``POST /process`` / ``/process-with-playbook`` / ``/merge`` dispatch the
  work to the user's connected runner over the WS bridge (commands
  ``recording_pipeline.process`` / ``..with_playbook`` / ``..merge``),
  insert a ``project.recording_pipeline_runs`` row in status ``queued``,
  spawn a background subscriber task, and return ``202`` immediately
  with ``{run_id, status}``.
- The background task awaits the runner's terminal
  ``recording_pipeline_result`` frame (via the existing
  ``CommandRelayService.dispatch_and_wait`` with a 30-min timeout),
  updates the PG row to ``completed`` / ``failed``, and on success
  persists the discovered states + transitions to
  ``project.ui_bridge_state_configs`` via :func:`_persist_to_pg`.
- ``GET /runs/{run_id}`` returns the row for clients polling for
  completion.
- ``GET /experiences`` is the legacy read-only experience-memory lookup
  and remains unchanged.

Phase 4 of plan
``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``. Per the user
directive in §"Risks (c)", backward-compat for the response shape is
NOT a factor — callers update to the new ``{run_id, status}`` shape
and poll the run row.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from qontinui_schemas.commands.recording_pipeline import (
    MergeRecordingRequest as MergeRecordingCommand,
)
from qontinui_schemas.commands.recording_pipeline import (
    ProcessRecordingRequest as ProcessRecordingCommand,
)
from qontinui_schemas.commands.recording_pipeline import (
    ProcessRecordingWithPlaybookRequest as ProcessRecordingWithPlaybookCommand,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.recording_pipeline_run import RecordingPipelineRun
from app.models.user import User
from app.services.recording_pipeline_subscriber import (
    spawn_recording_pipeline_subscriber,
)
from app.services.runner import (
    pick_active_runner_for_user,
    runner_bridge_503_no_runner,
)
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


# ============================================================================
# Request models
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


class MergeRecordingRequest(BaseModel):
    """Request to merge a new recording into an existing state config."""

    export_data: dict[str, Any] = Field(
        ..., description="New recording's CooccurrenceExport JSON"
    )
    config_id: UUID = Field(
        ..., description="Existing UIBridgeStateConfig UUID to merge into"
    )
    config: dict[str, Any] | None = Field(None)


# ============================================================================
# Response models
# ============================================================================


class RecordingPipelineRunAccepted(BaseModel):
    """Response returned by the three dispatch endpoints (202)."""

    run_id: UUID
    status: str = Field(
        default="queued",
        description="Initial status; clients poll /runs/{run_id} for updates.",
    )


class RecordingPipelineRunStatusResponse(BaseModel):
    """Response returned by GET /runs/{run_id}."""

    run_id: UUID
    status: str
    command_type: str
    progress: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created_at: str
    updated_at: str


# ============================================================================
# Async dispatch endpoints
# ============================================================================


_PROCESS_ENDPOINT = "/api/v1/recording-pipeline/process"
_PROCESS_WITH_PLAYBOOK_ENDPOINT = "/api/v1/recording-pipeline/process-with-playbook"
_MERGE_ENDPOINT = "/api/v1/recording-pipeline/merge"


async def _resolve_runner(
    *,
    current_user: User,
    db: AsyncSession,
    endpoint: str,
):
    """Pick the user's connected runner or raise 503."""
    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)
    runner = await pick_active_runner_for_user(current_user.id, db, manager.registry)
    if runner is None:
        raise runner_bridge_503_no_runner(endpoint)
    return runner, manager


@router.post(
    "/process",
    response_model=RecordingPipelineRunAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def process_recording(
    request: ProcessRecordingRequest,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> RecordingPipelineRunAccepted:
    """Dispatch a recording-pipeline run; return 202 + ``run_id``.

    The runner-side compute runs minutes. The HTTP response is
    immediate (``202 Accepted``); poll ``GET /runs/{run_id}`` for
    progress + the final result.
    """
    runner, manager = await _resolve_runner(
        current_user=current_user, db=db, endpoint=_PROCESS_ENDPOINT
    )

    run_id = uuid4()
    request_id = uuid4()

    row = RecordingPipelineRun(
        run_id=run_id,
        project_id=request.project_id,
        user_id=current_user.id,
        runner_id=runner.id,
        command_type="recording_pipeline.process",
        status="queued",
    )
    db.add(row)
    await db.commit()

    cmd = ProcessRecordingCommand(
        request_id=request_id,
        run_id=run_id,
        project_id=request.project_id,
        config_name=request.config_name,
        recording_export=request.export_data,
        config=request.config or {},
    ).model_dump(mode="json")

    logger.info(
        "recording_pipeline_process_dispatch",
        runner_id=str(runner.id),
        run_id=str(run_id),
        request_id=str(request_id),
    )

    spawn_recording_pipeline_subscriber(
        run_id=run_id,
        runner_id=str(runner.id),
        request_id=str(request_id),
        command=cmd,
        relay=manager.relay,
        project_id=request.project_id,
        config_name=request.config_name,
        export_data=request.export_data,
        save_experience=False,
        variables=[],
        app_name=None,
        app_url=None,
        merge_config_id=None,
    )

    return RecordingPipelineRunAccepted(run_id=run_id, status="queued")


@router.post(
    "/process-with-playbook",
    response_model=RecordingPipelineRunAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def process_recording_with_playbook(
    request: ProcessWithPlaybookRequest,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> RecordingPipelineRunAccepted:
    """Dispatch a recording-pipeline run + playbook generation; return 202 + ``run_id``."""
    runner, manager = await _resolve_runner(
        current_user=current_user, db=db, endpoint=_PROCESS_WITH_PLAYBOOK_ENDPOINT
    )

    run_id = uuid4()
    request_id = uuid4()

    row = RecordingPipelineRun(
        run_id=run_id,
        project_id=request.project_id,
        user_id=current_user.id,
        runner_id=runner.id,
        command_type="recording_pipeline.process_with_playbook",
        status="queued",
    )
    db.add(row)
    await db.commit()

    cmd = ProcessRecordingWithPlaybookCommand(
        request_id=request_id,
        run_id=run_id,
        project_id=request.project_id,
        config_name=request.config_name,
        recording_export=request.export_data,
        config=request.config or {},
        variables=request.variables,
        app_name=request.app_name,
        app_url=request.app_url,
        save_experience=request.save_experience,
    ).model_dump(mode="json")

    logger.info(
        "recording_pipeline_process_with_playbook_dispatch",
        runner_id=str(runner.id),
        run_id=str(run_id),
        request_id=str(request_id),
    )

    spawn_recording_pipeline_subscriber(
        run_id=run_id,
        runner_id=str(runner.id),
        request_id=str(request_id),
        command=cmd,
        relay=manager.relay,
        project_id=request.project_id,
        config_name=request.config_name,
        export_data=request.export_data,
        save_experience=request.save_experience,
        variables=request.variables,
        app_name=request.app_name,
        app_url=request.app_url,
        merge_config_id=None,
    )

    return RecordingPipelineRunAccepted(run_id=run_id, status="queued")


@router.post(
    "/merge",
    response_model=RecordingPipelineRunAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def merge_recording(
    request: MergeRecordingRequest,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> RecordingPipelineRunAccepted:
    """Dispatch a recording-pipeline merge; return 202 + ``run_id``.

    Fetches the existing state config's states + transitions from PG
    and forwards them to the runner so the runner stays stateless
    w.r.t. persistence.
    """
    from app.models.ui_bridge_state import (
        UIBridgeState as UIBridgeStateModel,
    )
    from app.models.ui_bridge_state import UIBridgeStateConfig
    from app.models.ui_bridge_transition import (
        UIBridgeTransition as UIBridgeTransitionModel,
    )

    # Validate the target config exists and belongs to a project the
    # user can access. (Project ownership is enforced by the existing
    # /projects/{project_id} routes; here we surface a 404 for a
    # config the user can't see.)
    config_row = (
        await db.execute(
            select(UIBridgeStateConfig).where(UIBridgeStateConfig.id == request.config_id)
        )
    ).scalar_one_or_none()
    if config_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "config_not_found", "config_id": str(request.config_id)},
        )

    existing_states = (
        await db.execute(
            select(UIBridgeStateModel).where(
                UIBridgeStateModel.config_id == request.config_id
            )
        )
    ).scalars().all()
    existing_transitions = (
        await db.execute(
            select(UIBridgeTransitionModel).where(
                UIBridgeTransitionModel.config_id == request.config_id
            )
        )
    ).scalars().all()

    runner, manager = await _resolve_runner(
        current_user=current_user, db=db, endpoint=_MERGE_ENDPOINT
    )

    run_id = uuid4()
    request_id = uuid4()

    row = RecordingPipelineRun(
        run_id=run_id,
        project_id=config_row.project_id,
        user_id=current_user.id,
        runner_id=runner.id,
        command_type="recording_pipeline.merge",
        status="queued",
    )
    db.add(row)
    await db.commit()

    cmd = MergeRecordingCommand(
        request_id=request_id,
        run_id=run_id,
        project_id=config_row.project_id,
        config_id=request.config_id,
        recording_export=request.export_data,
        existing_states=[_state_row_to_wire(s) for s in existing_states],
        existing_transitions=[_transition_row_to_wire(t) for t in existing_transitions],
        config=request.config or {},
    ).model_dump(mode="json")

    logger.info(
        "recording_pipeline_merge_dispatch",
        runner_id=str(runner.id),
        run_id=str(run_id),
        request_id=str(request_id),
        config_id=str(request.config_id),
        existing_state_count=len(existing_states),
        existing_transition_count=len(existing_transitions),
    )

    spawn_recording_pipeline_subscriber(
        run_id=run_id,
        runner_id=str(runner.id),
        request_id=str(request_id),
        command=cmd,
        relay=manager.relay,
        project_id=config_row.project_id,
        config_name=None,
        export_data=request.export_data,
        save_experience=False,
        variables=[],
        app_name=None,
        app_url=None,
        merge_config_id=request.config_id,
    )

    return RecordingPipelineRunAccepted(run_id=run_id, status="queued")


# ============================================================================
# GET /runs/{run_id}
# ============================================================================


@router.get(
    "/runs/{run_id}",
    response_model=RecordingPipelineRunStatusResponse,
)
async def get_recording_pipeline_run(
    run_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> RecordingPipelineRunStatusResponse:
    """Return the current status of a recording-pipeline run.

    Clients should poll this endpoint after a ``202`` from one of the
    dispatch routes until ``status in ("completed", "failed", "timed_out")``.
    """
    row = await db.get(RecordingPipelineRun, run_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "run_not_found", "run_id": str(run_id)},
        )

    return RecordingPipelineRunStatusResponse(
        run_id=row.run_id,
        status=row.status,
        command_type=row.command_type,
        progress={
            "stage": row.progress_stage,
            "pct": row.progress_pct,
            "message": row.progress_message,
        },
        result=row.result_json,
        error=row.error_json,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


# ============================================================================
# Wire serialisers (PG row -> runner-side payload dict)
# ============================================================================


def _state_row_to_wire(row: Any) -> dict[str, Any]:
    """Serialise a ``UIBridgeStateModel`` PG row to the runner wire shape.

    Mirrors the dataclass fields expected by
    ``handlers.recording_pipeline._dict_to_ui_state``.
    """
    extra = row.extra_metadata or {}
    return {
        "id": row.state_id,
        "name": row.name,
        "element_ids": list(row.element_ids or []),
        "blocking": bool(extra.get("blocking", False)),
        "blocks": list(extra.get("blocks", [])),
        "group": extra.get("group"),
        "path_cost": float(extra.get("path_cost", 1.0)),
        "metadata": {
            "confidence": row.confidence,
            **extra,
        },
    }


def _transition_row_to_wire(row: Any) -> dict[str, Any]:
    """Serialise a ``UIBridgeTransitionModel`` PG row to the runner wire shape.

    Mirrors the dataclass fields expected by
    ``handlers.recording_pipeline._dict_to_ui_transition``.
    """
    extra = row.extra_metadata or {}
    return {
        "id": row.transition_id,
        "name": row.name,
        "from_states": list(row.from_states or []),
        "activate_states": list(row.activate_states or []),
        "exit_states": list(row.exit_states or []),
        "actions": list(row.actions or []),
        "activate_groups": list(extra.get("activate_groups", [])),
        "exit_groups": list(extra.get("exit_groups", [])),
        "path_cost": float(row.path_cost) if row.path_cost is not None else 1.0,
        "stays_visible": bool(row.stays_visible) if row.stays_visible is not None else False,
        "metadata": extra,
    }


# ============================================================================
# Experience Memory Retrieval (unchanged from pre-#136)
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
# PostgreSQL Persistence (helpers retained from pre-#136 — used by the
# subscriber service after a successful runner run)
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


async def _persist_result_to_pg(
    db: AsyncSession,
    project_id: UUID,
    config_name: str,
    result_payload: dict[str, Any],
    export_data: dict[str, Any],
) -> UUID | None:
    """Persist a runner-produced ``RecordingPipelineResult`` payload to PG.

    Creates a :class:`UIBridgeStateConfig` with child :class:`UIBridgeState`
    and :class:`UIBridgeTransition` rows. The caller is responsible for
    committing (to allow batching with :func:`_save_experience_from_payload`).
    """
    from app.models.ui_bridge_state import UIBridgeState as UIBridgeStateModel
    from app.models.ui_bridge_state import UIBridgeStateConfig
    from app.models.ui_bridge_transition import (
        UIBridgeTransition as UIBridgeTransitionModel,
    )

    state_config = UIBridgeStateConfig(
        project_id=project_id,
        name=config_name,
        description=(
            f"Auto-discovered from recording session "
            f"{result_payload.get('session_id', 'unknown')}"
        ),
        render_count=len(export_data.get("presenceMatrix", [])),
        element_count=len(export_data.get("allFingerprints", [])),
        discovery_result={
            "source": "recording_pipeline",
            "session_id": result_payload.get("session_id"),
            "state_count": result_payload.get("state_count", 0),
            "transition_count": result_payload.get("transition_count", 0),
            "global_state_count": result_payload.get("global_state_count", 0),
            "modal_state_count": result_payload.get("modal_state_count", 0),
        },
    )
    db.add(state_config)
    await db.flush()  # Get the generated UUID

    for s in result_payload.get("states", []):
        s_meta = s.get("metadata", {}) or {}
        state_row = UIBridgeStateModel(
            config_id=state_config.id,
            state_id=s["id"],
            name=s.get("name", s["id"]),
            element_ids=list(s.get("element_ids", [])),
            confidence=float(s_meta.get("confidence", 0.0)),
            extra_metadata={
                "blocking": bool(s.get("blocking", False)),
                "is_global": bool(s_meta.get("is_global", False)),
                "position_zone": s_meta.get("position_zone"),
                "source": "recording",
            },
        )
        db.add(state_row)

    for t in result_payload.get("transitions", []):
        t_meta = t.get("metadata", {}) or {}
        transition_row = UIBridgeTransitionModel(
            config_id=state_config.id,
            transition_id=t["id"],
            name=t.get("name", t["id"]),
            from_states=list(t.get("from_states", [])),
            activate_states=list(t.get("activate_states", [])),
            exit_states=list(t.get("exit_states", [])),
            actions=list(t.get("actions", [])),
            path_cost=float(t.get("path_cost", 1.0)),
            stays_visible=bool(t.get("stays_visible", False)),
            extra_metadata={
                "confidence": float(t_meta.get("confidence", 0.0)),
                "observation_count": int(t_meta.get("observation_count", 0)),
                "is_bidirectional": bool(t_meta.get("is_bidirectional", False)),
                "source": "recording",
            },
        )
        db.add(transition_row)

    await db.flush()
    logger.info(
        "recording_pipeline_persisted",
        config_id=str(state_config.id),
        project_id=str(project_id),
        state_count=len(result_payload.get("states", [])),
        transition_count=len(result_payload.get("transitions", [])),
    )
    return state_config.id


async def _save_experience_from_payload(
    db: AsyncSession,
    project_id: UUID,
    result_payload: dict[str, Any],
    export_data: dict[str, Any],
    variables: list[dict[str, Any]],
    app_name: str | None = None,
    app_url: str | None = None,
    playbook_content: str | None = None,
    state_config_id: UUID | None = None,
) -> None:
    """Save a completed recording session as experience memory.

    Mirrors the pre-#136 ``_save_experience`` helper but consumes the
    serialised runner payload dict instead of a Python
    ``RecordingPipelineResult`` object.
    """
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
        (t.get("metadata", {}) or {}).get("confidence", 0.0)
        for t in result_payload.get("transitions", [])
    ]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    session = RecordingSession(
        project_id=project_id,
        session_id=result_payload.get("session_id", ""),
        app_name=app_name,
        app_url=app_url,
        app_domain=app_domain,
        duration_ms=_compute_duration_ms(export_data),
        interaction_count=len(export_data.get("transitions", [])),
        capture_count=len(export_data.get("presenceMatrix", [])),
        state_count=result_payload.get("state_count", 0),
        transition_count=result_payload.get("transition_count", 0),
        variable_count=len(variables),
        avg_confidence=avg_confidence,
        export_data=export_data,
        variables=variables,
        playbook_content=playbook_content,
        state_config_id=state_config_id,
    )
    db.add(session)
    await db.flush()

    logger.info(
        "recording_experience_saved",
        session_id=result_payload.get("session_id"),
        app_domain=app_domain,
        state_count=result_payload.get("state_count", 0),
    )


# Re-export the helpers for the subscriber service.
__all__ = [
    "router",
    "_compute_duration_ms",
    "_persist_result_to_pg",
    "_save_experience_from_payload",
]


# Silence "imported but unused" for asyncio (kept available for hot-patches).
_ = asyncio
