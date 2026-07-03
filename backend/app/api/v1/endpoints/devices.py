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

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
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
    DeviceTokenContext,
    get_async_db,
    get_authenticated_device,
    get_current_active_user_async,
)
from app.config.redis_config import get_redis
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.crud import device_machine_credential_crud as dmk_crud
from app.models.devenv import DeviceMachineCredential
from app.models.device import Device
from app.models.user import User as UserModel
from app.schemas.device import (
    DeviceConnectionResponse,
    DeviceIdentityResponse,
    DeviceMachineCredentialExchangeResponse,
    DeviceMachineCredentialMintResponse,
    DispatchDeviceRequest,
    DispatchDeviceResponse,
    PairCliRequest,
    PairCliResponse,
    PairConfirmRequest,
    PairConfirmResponse,
)
from app.services import coord_device
from app.services.coord_identity import get_coord_identity
from app.services.coord_proxy import post_to_coord
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.services.strategy import StrategyDisabledError, strategy_client
from app.services.workflow_dispatcher import HEALTHY_HEARTBEAT_WINDOW_SECONDS

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
# Device-machine-key (`dmk_`) authentication dependency — 4b cold-start
#
# Mirrors ``devenv_agent.get_authenticated_machine`` (the ``mk_`` header dep)
# for a **device**-bound key sent as ``X-Device-Machine-Key: dmk_<token>``.
# Resolves the credential from its sha256 hash with NO user JWT — the key is
# the credential. The endpoint additionally asserts the credential's
# ``device_id`` matches the path (anti-forgery); this dep only proves the key
# itself is valid, non-revoked, and unexpired.
# ---------------------------------------------------------------------------


async def get_authenticated_device_credential(
    x_device_machine_key: str = Header(alias="X-Device-Machine-Key"),
    db: AsyncSession = Depends(get_async_db),
) -> DeviceMachineCredential:
    """Resolve + authenticate a device from its ``X-Device-Machine-Key``.

    * Rejects keys without the ``dmk_`` prefix => 401.
    * Looks up by sha256 hash; unknown => 401.
    * Rejects a revoked credential => 403.
    * Rejects an expired credential => 403.

    The caller's device identity is whatever owns the matched credential; no
    user session is required (this is the >30-day-offline recovery path).
    """
    if not x_device_machine_key or not x_device_machine_key.startswith(
        dmk_crud.DEVICE_MACHINE_KEY_PREFIX
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_device_machine_key",
                "message": "Missing or malformed device machine key.",
            },
        )
    cred = await dmk_crud.get_by_key(db, x_device_machine_key)
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_device_machine_key",
                "message": "Device machine key not recognized.",
            },
        )
    if cred.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_machine_key_revoked",
                "message": "This device machine key has been revoked.",
            },
        )
    if not dmk_crud.is_usable(cred):
        # Not revoked (handled above) => the only remaining unusable state is
        # an expired credential.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_machine_key_expired",
                "message": "This device machine key has expired.",
            },
        )
    return cred


# ---------------------------------------------------------------------------
# device-to-wire serialization
# ---------------------------------------------------------------------------


def _heartbeat_is_fresh(last_heartbeat: datetime | None) -> bool:
    """True when ``last_heartbeat`` is within the dispatch health window.

    Shares ``HEALTHY_HEARTBEAT_WINDOW_SECONDS`` with the workflow
    dispatcher so "shows healthy" and "is dispatchable" can't disagree.
    """
    if last_heartbeat is None:
        return False
    if last_heartbeat.tzinfo is None:
        last_heartbeat = last_heartbeat.replace(tzinfo=UTC)
    age = utc_now() - last_heartbeat
    return age <= timedelta(seconds=HEALTHY_HEARTBEAT_WINDOW_SECONDS)


#: stored ``derived_status`` values that CLAIM liveness and therefore need a
#: fresh heartbeat to be believed. ``errored`` is deliberately absent — an
#: error report is sticky diagnostic state, not a liveness claim.
_LIVENESS_CLAIMS = ("healthy", "degraded", "starting")


def _derive_status(device: Device) -> RunnerStatus:
    """Compute the canonical status for a device row.

    Preference order:
      * ``ws_session_id`` set → ``healthy`` (definitive WS presence wins; the
        connection-cleanup sweep owns clearing stale sessions).
      * ``ui_error`` set → ``errored`` (overrides degraded but not healthy).
      * Otherwise → fall back to the stored ``derived_status`` column;
        unknown values map to ``offline``.

    Staleness gate: the stored column is write-once-per-event (registration,
    heartbeat, runner status messages) and nothing decays it when a device
    dies without a clean disconnect — a row can claim ``healthy`` days after
    its last heartbeat. Liveness-claiming values are therefore only believed
    while the heartbeat is fresh; stale ones report ``offline``.
    """
    if device.ws_session_id is not None:
        return RunnerStatus.healthy
    if device.ui_error is not None:
        return RunnerStatus.errored
    raw = (device.derived_status or "offline").lower()
    if raw in _LIVENESS_CLAIMS and not _heartbeat_is_fresh(device.last_heartbeat):
        return RunnerStatus.offline
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


# ---------------------------------------------------------------------------
# coord-JSON-row variants (Phase 3 of
# ``2026-05-30-web-coord-schema-boundary-decoupling.md``)
#
# The device reads now come over coord's HTTP API as full ``coord.devices``
# JSON rows (snake_case keys from coord's ``to_jsonb``) instead of ORM
# ``Device`` objects. These dict-consuming twins of ``_derive_status`` /
# ``_device_to_wire`` read the same columns from the coord row. Date columns
# (``last_heartbeat``, ``created_at``) arrive as ISO strings already, so they
# pass through verbatim (no ``.isoformat()``).
# ---------------------------------------------------------------------------


def _heartbeat_is_fresh_iso(value: Any) -> bool:
    """ISO-string twin of :func:`_heartbeat_is_fresh` for coord JSON rows.

    Missing → stale (registration always stamps ``last_heartbeat``, so an
    absent value means an ancient/foreign row, not a young one). An
    unparseable value fails OPEN (treated as fresh) so a coord timestamp
    format drift degrades back to the old optimistic behavior instead of
    flipping the whole fleet to offline; the warn log is the tripwire.
    """
    if value is None or value == "":
        return False
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        logger.warning("device_last_heartbeat_unparseable", value=str(value)[:64])
        return True
    return _heartbeat_is_fresh(parsed)


def _derive_status_from_row(row: dict[str, Any]) -> RunnerStatus:
    """Compute the canonical status from a coord ``coord.devices`` JSON row.

    Same preference order as :func:`_derive_status` (the ORM twin): WS
    presence (``ws_session_id``) wins, then ``ui_error``, then the stored
    ``derived_status`` column — with the same staleness gate: a stored
    liveness claim (healthy/degraded/starting) is only believed while
    ``last_heartbeat`` is fresh.
    """
    if row.get("ws_session_id") is not None:
        return RunnerStatus.healthy
    if row.get("ui_error") is not None:
        return RunnerStatus.errored
    raw = str(row.get("derived_status") or "offline").lower()
    if raw in _LIVENESS_CLAIMS and not _heartbeat_is_fresh_iso(
        row.get("last_heartbeat")
    ):
        return RunnerStatus.offline
    if raw == "healthy":
        return RunnerStatus.healthy
    if raw == "degraded":
        return RunnerStatus.degraded
    if raw == "starting":
        return RunnerStatus.starting
    if raw == "errored":
        return RunnerStatus.errored
    return RunnerStatus.offline


def _device_row_to_wire(row: dict[str, Any]) -> RunnerWire:
    """Convert a coord ``coord.devices`` JSON row to the canonical wire shape.

    Dict-consuming twin of :func:`_device_to_wire`. The row carries every
    ``coord.devices`` column via coord's ``to_jsonb`` (snake_case keys);
    ``last_heartbeat`` / ``created_at`` are already ISO strings.
    """
    user_id = row.get("user_id")
    return RunnerWire(
        id=str(row.get("device_id")),
        userId=str(user_id) if user_id else "",
        name=str(row.get("name") or ""),
        hostname=row.get("hostname"),
        ipAddress=None,
        port=row.get("port") or 0,
        os=row.get("os"),
        osVersion=row.get("os_version"),
        capabilities=list(row.get("capabilities") or []),
        derivedStatus=_derive_status_from_row(row),
        lastHeartbeat=row.get("last_heartbeat"),
        wsConnected=row.get("ws_session_id") is not None,
        uiError=_ui_error_from(row.get("ui_error")),
        recentCrash=_recent_crash_from(row.get("recent_crash")),
        createdAt=str(row.get("created_at") or ""),
    )


# ---------------------------------------------------------------------------
# User-authenticated endpoints — device CRUD & dispatch
# ---------------------------------------------------------------------------


@router.get("", response_model=list[RunnerWire])
async def list_devices_endpoint(
    *,
    request: Request,
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

    Sourced over coord's HTTP boundary (``GET /coord/devices/by-user``,
    scoped by the ``x-qontinui-user-id`` header + forwarded bearer) — Phase
    3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md``. Replaces
    the former direct ``coord.devices`` ORM read; coord owns its table.
    """
    rows = await coord_device.list_devices_for_user(request, str(current_user.id))
    wire = [_device_row_to_wire(r) for r in rows]

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
# Device-authenticated identity — the disjoint device principal path
# ---------------------------------------------------------------------------


@router.get("/me", response_model=DeviceIdentityResponse)
async def get_device_identity(
    *,
    device_ctx: DeviceTokenContext = Depends(get_authenticated_device),
) -> Any:
    """Resolve the device principal for a coord-issued device-token JWT.

    The relay's ``_auth.ts`` forwards the device-token JWT as a bearer to
    this route to resolve the caller into a ``(device_id, user_id,
    tenant_id)`` principal. This is the disjoint device path: the
    Cognito-only ``/api/v1/auth/users/me`` rejects a device-JWT.

    Declared before ``GET /{device_id}`` so ``me`` is never captured as a
    device-id path parameter.
    """
    raw_tenant = device_ctx.claims.get("tenant_id")
    if not raw_tenant:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device token missing tenant_id claim",
        )

    return DeviceIdentityResponse(
        device_id=str(device_ctx.device_id),
        user_id=str(device_ctx.user_id),
        tenant_id=str(raw_tenant),
    )


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
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
    payload: PairConfirmRequest,
) -> Any:
    """Complete an OAuth-loopback pairing flow.

    Forwards ``(state, user_id)`` to coord's ``POST
    /coord/devices/pair-complete``; returns the issued device-token JWT
    and ``device_id`` so the browser can redirect the runner's localhost
    callback handler.

    Coord resolves the tenant from the pair-start flow it stored, so web
    does not compute or forward a tenant_id here. We still gate the route
    on a linked operator by calling coord's ``/admin/coord/me`` (it 403s
    an unlinked caller — the same fail-closed posture the old resolver
    gate provided, now sourced over the HTTP boundary).
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

    # Authz gate BEFORE the outbound call: coord's `/admin/coord/me` 403s
    # an operator that isn't a linked tenant member, so the 403
    # `tenant_not_resolved` propagates as-is. The resolved value is unused
    # (coord resolves tenant from the pair-start flow it stored); the call
    # is kept purely as the linked-operator gate.
    await get_coord_identity(request)

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

    # post_to_coord retries never-reached-coord failures (connect errors,
    # gateway 502/503/504 — the rolling-deploy window) and raises an
    # honest 503 + Retry-After when coord stays unavailable.
    resp = await post_to_coord(
        "/coord/devices/pair-complete",
        headers=headers,
        json_body=body,
        log_event="pair_confirm",
        user_id=str(current_user.id),
    )

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
    db: AsyncSession = Depends(get_async_db),
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

    # See pair_confirm: retries deploy-window transport failures, 503 +
    # Retry-After when coord stays unavailable.
    resp = await post_to_coord(
        "/coord/devices/pair-cli",
        headers=headers,
        json_body=body,
        log_event="pair_cli",
        user_id=str(current_user.id),
    )

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

    # Auto-mint a device machine key (``dmk_``) for this device+owner so
    # every paired runner receives one out-of-box (zero extra setup) and can
    # recover a device JWT after a >30-day outage with no user session (4b).
    # Best-effort: a mint failure must NEVER fail the pairing — the runner
    # simply won't have the cold-start credential and falls back to the
    # interactive re-login path. Additive field; existing consumers ignore it.
    device_machine_key: str | None = None
    try:
        tenant_raw = coord_body.get("tenant_id")
        tenant_id = UUID(str(tenant_raw)) if tenant_raw else None
        device_machine_key, _cred = await dmk_crud.mint(
            db,
            device_id=device_uuid,
            owner_user_id=current_user.id,
            tenant_id=tenant_id,
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001 — never break pairing on mint
        device_machine_key = None
        logger.warning(
            "pair_cli_dmk_automint_failed",
            user_id=str(current_user.id),
            device_id=str(device_uuid),
            error=str(exc),
        )

    logger.info(
        "pair_cli_completed",
        user_id=str(current_user.id),
        device_id=str(device_uuid),
        dmk_minted=device_machine_key is not None,
    )
    return PairCliResponse(
        device_id=device_uuid,
        token=str(coord_token),
        user_id=current_user.id,
        device_machine_key=device_machine_key,
    )


# ---------------------------------------------------------------------------
# Single-device read / delete / dispatch
# ---------------------------------------------------------------------------


@router.get("/{device_id}", response_model=RunnerWire)
async def get_device_endpoint(
    *,
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
    device_id: UUID,
) -> Any:
    """Fetch a single device by id (must be owned by ``current_user``).

    Sourced over coord's HTTP boundary (``GET /coord/devices/:id/owned``) —
    Phase 3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md``.
    Coord's ownership check (404 if not owned by the caller) replaces the
    web-side ``_ensure_owned``.
    """
    row = await coord_device.get_owned_device(request, device_id, str(current_user.id))
    return _device_row_to_wire(row)


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
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
    device_id: UUID,
    payload: DispatchDeviceRequest,
) -> Any:
    """Dispatch a workflow to a connected device.

    Sends a typed ``dispatch`` message over the device's WebSocket if it
    is currently connected (``ws_session_id IS NOT NULL``); 503 otherwise.
    WS is the sole dispatch channel.

    The ownership read is sourced over coord's HTTP boundary
    (``GET /coord/devices/:id/owned``) — Phase 3 of
    ``2026-05-30-web-coord-schema-boundary-decoupling.md`` — replacing the
    former ``device_crud.get_device`` + ``_ensure_owned``. The dispatch
    itself still goes over the local WS manager.
    """
    record = await coord_device.get_owned_device(
        request, device_id, str(current_user.id)
    )

    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)

    # Gate on the CROSS-PROCESS Redis connection state, not the in-process
    # ``manager.is_connected`` (memory-only). On the multi-replica prod
    # backend the dispatch HTTP request may land on a replica that does not
    # hold the runner's WS — the in-process check there would falsely 503 even
    # though the socket is alive on another replica. ``is_connected_redis``
    # reflects the connection across all replicas; the dispatch itself then
    # publishes via Redis pub/sub (require_local_connection=False), which
    # reaches whichever replica owns the socket.
    if record.get("ws_session_id") is None or not (
        await manager.is_connected_redis(device_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "device_offline",
                "message": "Device is not connected via WebSocket.",
            },
        )

    run_id = str(uuid4())
    sent = await manager.send_dispatch(
        device_id,
        {
            "run_id": run_id,
            "workflow_id": str(payload.workflow_id),
            "payload": payload.payload or {},
        },
        require_local_connection=False,
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


# ---------------------------------------------------------------------------
# Device machine key (`dmk_`) — mint (user bearer) + exchange (dmk_ auth)
#
# The >30-day-offline cold-start recovery path (4b): a long-lived,
# device-bound machine key the runner exchanges for a device JWT with NO user
# session. Mint is user-authenticated (owner mints/rotates their device's
# key); exchange is authenticated by the key itself and rides web's trusted
# service token to coord's service-mint.
# ---------------------------------------------------------------------------


@router.post(
    "/{device_id}/machine-credential/mint",
    response_model=DeviceMachineCredentialMintResponse,
    status_code=status.HTTP_201_CREATED,
)
async def mint_device_machine_credential(
    *,
    request: Request,
    device_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Mint (or rotate) the calling user's device machine key for a device.

    **User-bearer authenticated.** The caller MUST own ``device_id`` — this is
    verified over coord's ownership boundary (``GET /coord/devices/:id/owned``,
    the same check the single-device reads use); a non-owner gets 403. The
    device's ``tenant_id`` is resolved server-side from the owned coord row
    (never client-asserted). Returns the plaintext ``dmk_`` ONCE.
    """
    try:
        row = await coord_device.get_owned_device(
            request, device_id, str(current_user.id)
        )
    except HTTPException as exc:
        # coord returns 404 for a device the caller doesn't own; surface it as
        # a 403 (the caller is authenticated, just not the owner). Transport
        # errors (502/504) propagate unchanged.
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "device_not_owned",
                    "message": "You do not own this device.",
                },
            ) from exc
        raise

    tenant_raw = row.get("tenant_id")
    tenant_id = UUID(str(tenant_raw)) if tenant_raw else None

    plaintext, cred = await dmk_crud.mint(
        db,
        device_id=device_id,
        owner_user_id=current_user.id,
        tenant_id=tenant_id,
    )
    await db.commit()

    logger.info(
        "device_machine_credential_minted",
        user_id=str(current_user.id),
        device_id=str(device_id),
        dmk_prefix=cred.dmk_prefix,
    )
    return DeviceMachineCredentialMintResponse(
        device_id=device_id,
        device_machine_key=plaintext,
        prefix=cred.dmk_prefix,
        expires_at=cred.expires_at,
    )


@router.post(
    "/{device_id}/machine-credential/exchange",
    response_model=DeviceMachineCredentialExchangeResponse,
    status_code=status.HTTP_200_OK,
)
async def exchange_device_machine_credential(
    *,
    device_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    cred: DeviceMachineCredential = Depends(get_authenticated_device_credential),
) -> Any:
    """Exchange a valid ``dmk_`` for a fresh device JWT — no user session.

    Authenticated by the ``X-Device-Machine-Key`` header (the
    :func:`get_authenticated_device_credential` dep already rejected an
    unknown / revoked / expired key). The credential's ``device_id`` MUST
    match the path (anti-forgery — a key for device A cannot mint a JWT for
    device B => 403). On success ``last_used_at`` is bumped and the TTL slid
    forward (sliding session), then web calls coord's service-mint with its
    trusted service token; coord resolves the device's owner/tenant itself.

    503 when the coord service bridge is disabled (``COORD_ADMIN_SECRET``
    unset). A coord 4xx propagates as the matching client error.
    """
    if cred.device_id != device_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_mismatch",
                "message": "Device machine key does not match this device.",
            },
        )

    # Fail fast + honest 503 before doing any work when coord is disabled.
    if not strategy_client.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Coord integration disabled (COORD_ADMIN_SECRET unset); "
                "device machine-key exchange unavailable."
            ),
        )

    # Bump usage + slide the TTL (an actively-recovering runner never lapses).
    await dmk_crud.bump_last_used(db, cred)
    await db.commit()

    acting_user_id = str(cred.owner_user_id) if cred.owner_user_id else str(device_id)
    try:
        coord_status, coord_body = await strategy_client.mint_device_token(
            acting_user_id, str(device_id)
        )
    except StrategyDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Coord integration disabled (COORD_ADMIN_SECRET unset); "
                "device machine-key exchange unavailable."
            ),
        ) from exc

    if coord_status not in (200, 201):
        logger.warning(
            "device_machine_credential_exchange_coord_rejected",
            device_id=str(device_id),
            status=coord_status,
        )
        # Propagate a coord client error (4xx) verbatim; treat everything
        # else (5xx / transport) as a bad-gateway upstream failure.
        if 400 <= coord_status < 500:
            raise HTTPException(
                status_code=coord_status,
                detail={
                    "code": "coord_mint_rejected",
                    "message": "Coord rejected the device-token mint.",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"coord_status": coord_status},
        )

    token = coord_body.get("token") if isinstance(coord_body, dict) else None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord service-mint response missing token.",
        )

    logger.info(
        "device_machine_credential_exchanged",
        device_id=str(device_id),
        dmk_prefix=cred.dmk_prefix,
    )
    return DeviceMachineCredentialExchangeResponse(token=str(token))
