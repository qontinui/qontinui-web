"""
Unified runner API surface.

Consolidates the previously-split ``runners.py`` (runner-connection
history) and ``runners_fleet.py`` (server-mode fleet registry +
runner-token CRUD) into one canonical surface keyed by ``Runner.id``
(UUID). The runner-session audit log lives at ``/runners/sessions``.

The legacy HTTP register/heartbeat path was removed in Phase 5A — every
runner now connects via the unified ``WS /api/v1/runners/ws`` channel.
"""

from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from qontinui_schemas.common import utc_now
from qontinui_schemas.generated.per_type.runner import (
    Runner as RunnerWire,
)
from qontinui_schemas.generated.per_type.runner import (
    RunnerCrash,
    RunnerStatus,
    RunnerUiError,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
)
from app.config.redis_config import get_redis
from app.crud import runner_crud
from app.crud import runner_session as runner_session_crud
from app.models.runner import Runner
from app.models.user import User as UserModel
from app.schemas.runner import (
    DispatchRunnerRequest,
    DispatchRunnerResponse,
    RunnerSessionResponse,
)
from app.schemas.runner_token import (
    RunnerTokenCreate,
    RunnerTokenCreatedResponse,
    RunnerTokenResponse,
)
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# derived_status & runner-to-wire serialization
# ---------------------------------------------------------------------------

# Heartbeat freshness windows (kept aligned with workflow_dispatcher).
_HEALTHY_HEARTBEAT_WINDOW_SECONDS = 90
_DEGRADED_HEARTBEAT_WINDOW_SECONDS = 5 * 60


def _derive_status(runner: Runner) -> RunnerStatus:
    """Compute the canonical status for a runner row.

    Preference order:
      * ``ws_session_id`` set → ``healthy`` (definitive WS presence wins).
      * ``ui_error`` set → ``errored`` (overrides degraded but not healthy).
      * Heartbeat fresh (≤90s) → ``healthy``.
      * Heartbeat stale-ish (≤5min) → ``degraded``.
      * Otherwise → ``offline``, except when the runner has never
        heartbeated yet (``starting``).
    """
    if runner.ws_session_id is not None:
        return RunnerStatus.healthy

    if runner.ui_error is not None:
        return RunnerStatus.errored

    if runner.last_heartbeat is None:
        return RunnerStatus.starting

    age = utc_now() - runner.last_heartbeat
    if age <= timedelta(seconds=_HEALTHY_HEARTBEAT_WINDOW_SECONDS):
        return RunnerStatus.healthy
    if age <= timedelta(seconds=_DEGRADED_HEARTBEAT_WINDOW_SECONDS):
        return RunnerStatus.degraded
    return RunnerStatus.offline


def _ui_error_from(value: dict[str, Any] | None) -> RunnerUiError | None:
    if not value:
        return None
    try:
        return RunnerUiError.model_validate(value)
    except Exception:
        # Tolerate older/newer shapes — surface raw content where possible.
        return RunnerUiError(
            kind=str(value.get("kind", value.get("digest", "ui_error"))),
            message=str(value.get("message", "")),
            reportedAt=str(value.get("reported_at") or value.get("reportedAt") or ""),
            detail=value.get("stack") or value.get("detail"),
        )


def _recent_crash_from(value: dict[str, Any] | None) -> RunnerCrash | None:
    if not value:
        return None
    try:
        return RunnerCrash.model_validate(value)
    except Exception:
        return RunnerCrash(
            filePath=str(value.get("file_path", value.get("filePath", ""))),
            panicLocation=str(
                value.get("panic_location", value.get("panicLocation", ""))
            ),
            panicMessage=str(value.get("panic_message", value.get("panicMessage", ""))),
            reportedAt=str(value.get("reported_at", value.get("reportedAt", ""))),
            thread=str(value.get("thread", "")),
        )


def _runner_to_wire(runner: Runner) -> RunnerWire:
    """Convert a SQLAlchemy ``Runner`` row to the canonical wire shape."""
    return RunnerWire(
        id=str(runner.id),
        userId=str(runner.user_id),
        name=runner.name,
        hostname=runner.hostname,
        ipAddress=None,
        port=runner.port,
        os=runner.os,
        osVersion=runner.os_version,
        capabilities=list(runner.capabilities or []),
        derivedStatus=_derive_status(runner),
        lastHeartbeat=(
            runner.last_heartbeat.isoformat() if runner.last_heartbeat else None
        ),
        wsConnected=runner.ws_session_id is not None,
        uiError=_ui_error_from(runner.ui_error),
        recentCrash=_recent_crash_from(runner.recent_crash),
        createdAt=runner.created_at.isoformat(),
    )


def _ensure_owned(runner: Runner | None, user_id: UUID) -> Runner:
    if runner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Runner not found"
        )
    if runner.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Runner not found"
        )
    return runner


# ---------------------------------------------------------------------------
# User-authenticated endpoints — runner CRUD & dispatch
# ---------------------------------------------------------------------------


@router.get("", response_model=list[RunnerWire])
async def list_runners(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description=(
            "Comma-separated list of derived statuses to include "
            "(e.g. ``healthy,degraded``)."
        ),
    ),
) -> Any:
    """List all runners owned by ``current_user``.

    Optional ``?status=healthy,degraded`` filter narrows by derived
    status (computed server-side).
    """
    runners = await runner_crud.list_runners(db, current_user.id)
    wire_runners = [_runner_to_wire(r) for r in runners]

    if status_filter:
        allowed = {s.strip() for s in status_filter.split(",") if s.strip()}
        wire_runners = [r for r in wire_runners if r.derivedStatus.value in allowed]

    return wire_runners


@router.get("/sessions", response_model=list[RunnerSessionResponse])
async def list_sessions(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    runner_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Any:
    """Return the runner-session audit log (history) for the current user."""
    sessions, _total = await runner_session_crud.get_session_history(
        db,
        current_user.id,
        runner_id=runner_id,
        limit=limit,
        offset=offset,
    )
    return [RunnerSessionResponse.model_validate(s) for s in sessions]


# ---- Runner tokens (folded from runners_fleet.py) ------------------------


@router.post(
    "/tokens",
    response_model=RunnerTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    payload: RunnerTokenCreate,
) -> Any:
    """Mint a new runner bearer token for ``current_user``."""
    record, plain_token = await runner_crud.create_runner_token(
        db=db,
        user_id=current_user.id,
        name=payload.name,
        expires_in_days=payload.expires_in_days,
    )
    logger.info(
        "runner_token_created",
        user_id=str(current_user.id),
        token_id=str(record.id),
        name=record.name,
        expires_in_days=payload.expires_in_days,
    )
    return RunnerTokenCreatedResponse(
        token_record=RunnerTokenResponse.model_validate(record),
        plain_token=plain_token,
    )


@router.get("/tokens", response_model=list[RunnerTokenResponse])
async def list_tokens(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return ``current_user``'s runner tokens (hashes hidden)."""
    tokens = await runner_crud.list_runner_tokens(db, current_user.id)
    return [RunnerTokenResponse.model_validate(t) for t in tokens]


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_id: UUID,
) -> None:
    """Revoke a runner token owned by ``current_user``."""
    await runner_crud.revoke_runner_token(
        db=db, token_id=token_id, user_id=current_user.id
    )
    logger.info(
        "runner_token_revoked",
        user_id=str(current_user.id),
        token_id=str(token_id),
    )


# ---- Single-runner read / delete / dispatch -----------------------------


@router.get("/{runner_id}", response_model=RunnerWire)
async def get_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    runner_id: UUID,
) -> Any:
    """Fetch a single runner by id (must be owned by ``current_user``)."""
    record = await runner_crud.get_runner(db, runner_id)
    record = _ensure_owned(record, current_user.id)
    return _runner_to_wire(record)


@router.delete("/{runner_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deregister_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    runner_id: UUID,
) -> None:
    """Deregister (delete) a runner owned by ``current_user``."""
    await runner_crud.delete_runner(db, runner_id, current_user.id)
    logger.info(
        "runner_deregistered",
        user_id=str(current_user.id),
        runner_id=str(runner_id),
    )


@router.post(
    "/{runner_id}/dispatch",
    response_model=DispatchRunnerResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def dispatch_to_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    runner_id: UUID,
    payload: DispatchRunnerRequest,
) -> Any:
    """Dispatch a workflow to a connected runner.

    Sends a typed ``dispatch`` message over the runner's WebSocket if it
    is currently connected (``runner.ws_session_id IS NOT NULL``); 503
    otherwise. WS is the sole dispatch channel — the legacy HTTP
    ``dispatch_secret`` path was removed in Phase 5A.
    """
    record = await runner_crud.get_runner(db, runner_id)
    record = _ensure_owned(record, current_user.id)

    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)

    if record.ws_session_id is None or not manager.is_connected(record.id):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "runner_offline",
                "message": "Runner is not connected via WebSocket.",
            },
        )

    run_id = str(uuid4())
    sent = await manager.send_dispatch(
        record.id,
        {
            "run_id": run_id,
            "workflow_id": str(payload.workflow_id),
            "payload": payload.payload or {},
        },
    )
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "dispatch_failed",
                "message": "Could not relay dispatch over WebSocket.",
            },
        )

    return DispatchRunnerResponse(
        run_id=run_id,
        dispatched_at=utc_now(),
        transport="ws",
    )
