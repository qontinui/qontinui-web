"""Unified device API surface — Phase 5 of the Unified Devices Registry plan.

Replaces the legacy ``runners.py`` (``POST/GET/DELETE /api/v1/runners/*``).
Phase 5 of plan ``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``:

* **Retired:** ``POST /api/v1/runners/tokens`` +
  ``DELETE /api/v1/runners/tokens/{id}`` (no replacement — coord-issued
  device-token JWTs replace runner-bearer tokens).
* **Retained (re-pointed):** ``GET /api/v1/devices`` lists devices owned
  by the authenticated user from ``coord.devices`` directly (since the
  canonical Postgres is shared between web + coord).
* **New:** ``POST /api/v1/devices/pair-confirm`` is the web-backend
  proxy for the OAuth-loopback pairing flow — forwards ``(state,
  user_id)`` to coord's ``POST /coord/devices/pair-complete`` and
  returns the resulting device-token JWT + device_id to the browser.
* **Renamed:** ``/runners/sessions`` → ``/devices/connections``,
  ``/runners/{id}/dispatch`` → ``/devices/{id}/dispatch``.

The schemas-crate ``Runner*`` types continue to back the response
payload until Phase 7 renames them to ``Device*``.
"""

from typing import Any
from uuid import UUID, uuid4

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
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
from app.core.config import settings
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.models.device import Device
from app.models.user import User as UserModel
from app.schemas.device import (
    DeviceConnectionResponse,
    DispatchDeviceRequest,
    DispatchDeviceResponse,
    PairCliRequest,
    PairCliResponse,
    PairConfirmRequest,
    PairConfirmResponse,
)
from app.services.coord_operator_resolver import resolve_tenant_for_user
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.services.strategy import strategy_client

logger = structlog.get_logger(__name__)

router = APIRouter()


def _extract_caller_token(request: Request) -> str | None:
    """Pull the caller's bearer token from the ``access_token`` cookie or
    the ``Authorization`` header — the same two sources the backend's own
    ``CookieOrBearerScheme`` reads (mirrors
    :func:`app.api.v1.endpoints.operations._extract_caller_token`; replicated
    here rather than imported to avoid an ``operations`` <-> ``devices``
    circular import). A Cognito-authenticated session carries a Cognito token
    here, which coord's ``resolve_operator_optional`` middleware uses to derive
    the operator/tenant."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


# ---------------------------------------------------------------------------
# device-to-wire serialization
# ---------------------------------------------------------------------------


def _derive_status(device: Device) -> RunnerStatus:
    """Compute the canonical status for a device row.

    Preference order:
      * ``ws_session_id`` set → ``healthy`` (definitive WS presence wins).
      * ``ui_error`` set → ``errored`` (overrides degraded but not healthy).
      * Otherwise → fall back to the stored ``derived_status`` column;
        unknown values map to ``offline``.
    """
    if device.ws_session_id is not None:
        return RunnerStatus.healthy
    if device.ui_error is not None:
        return RunnerStatus.errored
    raw = (device.derived_status or "offline").lower()
    if raw == "healthy":
        return RunnerStatus.healthy
    if raw == "degraded":
        return RunnerStatus.degraded
    if raw == "starting":
        return RunnerStatus.starting
    if raw == "errored":
        return RunnerStatus.errored
    return RunnerStatus.offline


def _ui_error_from(value: dict[str, Any] | None) -> RunnerUiError | None:
    if not value:
        return None
    try:
        return RunnerUiError.model_validate(value)
    except Exception:
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


def _device_to_wire(device: Device) -> RunnerWire:
    """Convert a SQLAlchemy ``Device`` row to the canonical wire shape.

    Phase 7 of the plan renames the wire type ``Runner`` → ``Device``;
    until that ships, the response continues to use the legacy
    ``Runner`` Pydantic schema for frontend compat.
    """
    return RunnerWire(
        id=str(device.device_id),
        userId=str(device.user_id) if device.user_id else "",
        name=device.name,
        hostname=device.hostname,
        ipAddress=None,
        port=device.port or 0,
        os=device.os,
        osVersion=device.os_version,
        capabilities=list(device.capabilities or []),
        derivedStatus=_derive_status(device),
        lastHeartbeat=(
            device.last_heartbeat.isoformat() if device.last_heartbeat else None
        ),
        wsConnected=device.ws_session_id is not None,
        uiError=_ui_error_from(device.ui_error),
        recentCrash=_recent_crash_from(device.recent_crash),
        createdAt=device.created_at.isoformat(),
    )


def _ensure_owned(device: Device | None, user_id: UUID) -> Device:
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        )
    if device.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        )
    return device


# ---------------------------------------------------------------------------
# User-authenticated endpoints — device CRUD & dispatch
# ---------------------------------------------------------------------------


@router.get("", response_model=list[RunnerWire])
async def list_devices_endpoint(
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
    """List all user-paired devices for ``current_user``.

    Reads ``coord.devices`` directly. The data is the same set that
    coord's ``GET /coord/fleet/state`` would return scoped to this user;
    we read locally because canonical PG is shared.
    """
    devices = await device_crud.list_devices(db, current_user.id)
    wire = [_device_to_wire(d) for d in devices]

    if status_filter:
        allowed = {s.strip() for s in status_filter.split(",") if s.strip()}
        wire = [r for r in wire if r.derivedStatus.value in allowed]

    return wire


@router.get("/connections", response_model=list[DeviceConnectionResponse])
async def list_connections(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    device_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Any:
    """Return the device-connection audit log for the current user."""
    connections, _total = await device_connection_crud.get_connection_history(
        db,
        current_user.id,
        device_id=device_id,
        limit=limit,
        offset=offset,
    )
    return [DeviceConnectionResponse.model_validate(c) for c in connections]


# ---------------------------------------------------------------------------
# Pairing — web-backend proxy for coord's OAuth-loopback flow
# ---------------------------------------------------------------------------


@router.post(
    "/pair-confirm",
    response_model=PairConfirmResponse,
    status_code=status.HTTP_201_CREATED,
)
async def pair_confirm(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    payload: PairConfirmRequest,
) -> Any:
    """Complete an OAuth-loopback pairing flow.

    Forwards ``(state, user_id, tenant_id)`` to coord's ``POST
    /coord/devices/pair-complete``; returns the issued device-token JWT
    and ``device_id`` so the browser can redirect the runner's localhost
    callback handler.

    Phase 2 of the default-tenant-propagation plan
    (``D:/qontinui-root/plans/2026-05-20-default-tenant-propagation.md``):
    resolves the calling user's tenant_id via
    :func:`resolve_tenant_for_user` BEFORE the outbound POST and
    forwards it to coord. The 403 ``tenant_not_resolved`` raised by the
    resolver propagates as-is.
    """
    if not strategy_client.enabled:
        # Reuse the StrategyClient's service-token plumbing for the
        # outbound call to coord (it's already the established pattern
        # for web→coord HTTP; see
        # qontinui-dev-notes/project-strategy/architectural-decisions.md
        # §"Web ↔ runner WebSocket boundary").
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Coord integration disabled (COORD_ADMIN_SECRET unset); "
                "device pairing unavailable."
            ),
        )

    # Resolve tenant_id BEFORE the outbound call; let 403
    # `tenant_not_resolved` propagate. This is the same resolver the
    # `/api/v1/operations/*` proxy uses (PR #66 / readiness Wave 3c).
    # The result is unused here (coord resolves tenant from the pairing
    # flow stored at pair-start), but the call is kept as an authz gate.
    _tenant_id = await resolve_tenant_for_user(current_user, db)

    coord_url = settings.COORD_URL.rstrip("/")
    headers = await strategy_client._headers(str(current_user.id))  # noqa: SLF001
    # coord's PairCompleteRequest requires exactly:
    #   state: String, web_session_token: String (non-empty),
    #   user_id: Uuid, device_id: Uuid
    # `web_session_token` proves to coord the user is authenticated;
    # the web backend has already validated the session so we forward a
    # sentinel value identifying the browser-flow proxy path.
    body: dict[str, Any] = {
        "state": payload.state,
        "web_session_token": "browser-flow-session",
        "user_id": str(current_user.id),
        "device_id": payload.device_id,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{coord_url}/coord/devices/pair-complete",
                headers=headers,
                json=body,
            )
    except httpx.HTTPError as exc:
        logger.error(
            "pair_confirm_coord_transport_failed",
            user_id=str(current_user.id),
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord unreachable.",
        ) from exc

    if resp.status_code not in (200, 201):
        logger.warning(
            "pair_confirm_coord_rejected",
            user_id=str(current_user.id),
            status=resp.status_code,
            body=resp.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"coord_status": resp.status_code, "coord_body": resp.text[:500]},
        )

    try:
        coord_body = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-complete returned non-JSON.",
        ) from exc

    coord_device_id = coord_body.get("device_id")
    coord_token = coord_body.get("token")
    if not coord_device_id or not coord_token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-complete response missing device_id/token.",
        )

    try:
        device_uuid = UUID(str(coord_device_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-complete returned malformed device_id.",
        ) from exc

    logger.info(
        "pair_confirm_completed",
        user_id=str(current_user.id),
        device_id=str(device_uuid),
    )
    return PairConfirmResponse(
        device_id=device_uuid,
        token=str(coord_token),
        state=payload.state,
    )


@router.post(
    "/pair-cli",
    response_model=PairCliResponse,
    status_code=status.HTTP_201_CREATED,
)
async def pair_cli(
    *,
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
    payload: PairCliRequest,
) -> Any:
    """Headless analogue of :func:`pair_confirm`.

    The runner POSTs here with its existing user access-token in
    ``Authorization: Bearer …`` (the same token it just exchanged via
    ``/api/v1/auth/jwt/login``) and the ``(device_id, hostname, name)``
    triple it already knows.

    The backend forwards the caller's **Cognito operator bearer** (cookie
    ``access_token`` or ``Authorization: Bearer``) straight through to
    coord's ``POST /coord/devices/pair-cli``. Coord's mounted
    ``resolve_operator_optional`` middleware builds an ``OperatorContext``
    from that bearer and DERIVES ``tenant_id`` itself when the body omits
    it — so web no longer resolves or sends a ``tenant_id``. The
    ``X-Qontinui-User-Id`` header is still sent for user attribution.

    See follow-up #1 of plan
    ``D:/qontinui-root/plans/2026-05-30-coord-operator-resolver-removal.md``.
    Coord already accepts the optional ``tenant_id`` + derives it from the
    operator bearer (``routes_phase3.rs::post_pair_cli``); this change just
    forwards the right credential.
    """
    if not strategy_client.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Coord integration disabled (COORD_ADMIN_SECRET unset); "
                "device pairing unavailable."
            ),
        )

    caller_token = _extract_caller_token(request)
    if not caller_token:
        logger.warning(
            "pair_cli_missing_caller_bearer",
            user_id=str(current_user.id),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Missing operator bearer token; coord cannot derive the device tenant."
            ),
        )

    coord_url = settings.COORD_URL.rstrip("/")
    headers: dict[str, str] = {
        "Authorization": f"Bearer {caller_token}",
        "X-Qontinui-User-Id": str(current_user.id),
    }
    body: dict[str, Any] = {
        "device_id": str(payload.device_id),
        "hostname": payload.hostname,
        "name": payload.name or payload.hostname,
        "user_id": str(current_user.id),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{coord_url}/coord/devices/pair-cli",
                headers=headers,
                json=body,
            )
    except httpx.HTTPError as exc:
        logger.error(
            "pair_cli_coord_transport_failed",
            user_id=str(current_user.id),
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord unreachable.",
        ) from exc

    if resp.status_code not in (200, 201):
        logger.warning(
            "pair_cli_coord_rejected",
            user_id=str(current_user.id),
            status=resp.status_code,
            body=resp.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"coord_status": resp.status_code, "coord_body": resp.text[:500]},
        )

    try:
        coord_body = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-cli returned non-JSON.",
        ) from exc

    coord_device_id = coord_body.get("device_id")
    coord_token = coord_body.get("token")
    if not coord_device_id or not coord_token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-cli response missing device_id/token.",
        )

    try:
        device_uuid = UUID(str(coord_device_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-cli returned malformed device_id.",
        ) from exc

    logger.info(
        "pair_cli_completed",
        user_id=str(current_user.id),
        device_id=str(device_uuid),
    )
    return PairCliResponse(
        device_id=device_uuid,
        token=str(coord_token),
        user_id=current_user.id,
    )


# ---------------------------------------------------------------------------
# Single-device read / delete / dispatch
# ---------------------------------------------------------------------------


@router.get("/{device_id}", response_model=RunnerWire)
async def get_device_endpoint(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    device_id: UUID,
) -> Any:
    """Fetch a single device by id (must be owned by ``current_user``)."""
    record = await device_crud.get_device(db, device_id)
    record = _ensure_owned(record, current_user.id)
    return _device_to_wire(record)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deregister_device_endpoint(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    device_id: UUID,
) -> None:
    """Deregister (delete) a device owned by ``current_user``."""
    await device_crud.delete_device(db, device_id, current_user.id)
    logger.info(
        "device_deregistered",
        user_id=str(current_user.id),
        device_id=str(device_id),
    )


@router.post(
    "/{device_id}/dispatch",
    response_model=DispatchDeviceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def dispatch_to_device(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    device_id: UUID,
    payload: DispatchDeviceRequest,
) -> Any:
    """Dispatch a workflow to a connected device.

    Sends a typed ``dispatch`` message over the device's WebSocket if it
    is currently connected (``device.ws_session_id IS NOT NULL``); 503
    otherwise. WS is the sole dispatch channel.
    """
    record = await device_crud.get_device(db, device_id)
    record = _ensure_owned(record, current_user.id)

    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)

    if record.ws_session_id is None or not manager.is_connected(record.device_id):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "device_offline",
                "message": "Device is not connected via WebSocket.",
            },
        )

    run_id = str(uuid4())
    sent = await manager.send_dispatch(
        record.device_id,
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

    return DispatchDeviceResponse(
        run_id=run_id,
        dispatched_at=utc_now(),
        transport="ws",
    )
