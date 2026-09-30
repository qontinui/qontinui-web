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
  device_id)`` to coord's ``POST /coord/devices/pair-complete`` under the
  web service token + ``X-Qontinui-User-Id`` (coord's arm B: it verifies
  the token's subject and scope and reads the user from the header, then
  proves that user's membership in the flow's tenant BY SSO SUBJECT) and
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
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from qontinui_schemas.common import utc_now
from qontinui_schemas.generated.per_type.runner import (
    Runner as RunnerWire,
)
from qontinui_schemas.generated.per_type.runner import (
    RunnerCrash,
    RunnerInstance,
    RunnerInstanceRole,
    RunnerStatus,
    RunnerUiError,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    DeviceTokenContext,
    get_async_db,
    get_authenticated_device,
    get_current_active_user_async,
    get_paired_device,
)
from app.config.redis_config import get_redis
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud, pair_code_crud
from app.crud import device_machine_credential_crud as dmk_crud
from app.models.devenv import DeviceMachineCredential
from app.models.device import Device
from app.models.device_connection import DeviceConnection
from app.models.user import User as UserModel
from app.schemas.device import (
    AuthorizeRedeemResponse,
    DeviceConnectionResponse,
    DeviceCredentialOverviewResponse,
    DeviceCredentialOverviewRow,
    DeviceCredentialRevokeResponse,
    DeviceIdentityResponse,
    DeviceMachineCredentialExchangeResponse,
    DeviceMachineCredentialMintResponse,
    DeviceMachineKeyPosture,
    DeviceResponse,
    DeviceTenantBinding,
    DispatchDeviceRequest,
    DispatchDeviceResponse,
    PairCliRequest,
    PairCliResponse,
    PairConfirmRequest,
    PairConfirmResponse,
    PairConfirmTenantResult,
    PendingRedeemPosture,
    PendingRedeemResponse,
)
from app.services import coord_device
from app.services.coord_identity import get_coord_identity
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenExpiredError,
    CoordTokenInvalidError,
    coord_jwks_client,
    jwks_failure_log_fields,
)
from app.services.coord_proxy import post_to_coord
from app.services.coord_service_account import (
    CoordServiceAccountDisabledError,
    coord_service_account,
)
from app.services.device_credential_deny import refuse_if_credential_revoked
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.services.workflow_dispatcher import HEALTHY_HEARTBEAT_WINDOW_SECONDS

logger = structlog.get_logger(__name__)

router = APIRouter()

# The nil UUID is a "no tenant" placeholder runner UI sign-in sends on first
# pairing; ``pair_cli`` treats it as absent rather than forwarding it.
_NIL_UUID = UUID(int=0)

#: ``/self-mint`` renews a key only when it is absent, expired, or expires
#: within this window; a key usable for longer is refused with a 409 rather
#: than rotated (see :func:`self_mint_device_machine_credential`). The
#: ``pair-cli`` auto-mint uses the same window, so a re-pair never rotates a
#: key the runner can still use (coord finding ``414676cf``).
SELF_MINT_RENEWAL_WINDOW = timedelta(days=7)

#: How long past its ``exp`` a coord-signed device JWT still proves which box
#: is polling ``/pending-redeem`` (plan
#: ``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web``
#: Phase 2, "the anchor").
PENDING_REDEEM_EXPIRED_GRACE = timedelta(days=30)

#: The only ``mint_provenance`` a pending-redeem token may carry: coord's
#: ``issue_device`` (pairing, device refresh, service-mint) stamps it. ABSENT is
#: also admitted, but only for the exact ``issue_device`` claim shape — a token
#: minted before provenance existed (2026-09-17) and still inside the 30-day
#: grace. "Not bootstrap" is NOT the test: coord's own ``Claims`` docs name it
#: the laundering path (a pre-provenance push token is ``sub_type=device`` too).
_PAIRED_MINT_PROVENANCE = "paired"

_DEVICE_SUB_TYPE = "device"

# Non-auto-erroring so a missing bearer answers the typed 401 below rather
# than HTTPBearer's untyped 403.
_poll_bearer_scheme = HTTPBearer(auto_error=False)


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
      * Fresh heartbeat but NO ``ws_session_id`` → ``degraded``; see the
        relay-unroutable note below.
      * Otherwise → fall back to the stored ``derived_status`` column;
        unknown values map to ``offline``.

    Staleness gate: the stored column is write-once-per-event (registration,
    heartbeat, runner status messages) and nothing decays it when a device
    dies without a clean disconnect — a row can claim ``healthy`` days after
    its last heartbeat. Liveness-claiming values are therefore only believed
    while the heartbeat is fresh; stale ones report ``offline``.

    Relay-unroutable gate: a fresh heartbeat beside a NULL ``ws_session_id``
    is *self-contradictory*, and it is the exact shape of a real outage —
    every heartbeat arrives over the device WebSocket, so a heartbeat 30s old
    proves a socket was live, while ``_runner_proxy_relay`` gates the mobile
    cloud relay on ``ws_session_id IS NOT NULL`` and 503s "runner not
    connected". Reporting that row as ``healthy`` (which is what the stored
    column says, and what this function used to return) hid a ~2h prod relay
    outage from operators on 2026-08-27: ``GET /api/v1/devices`` served
    ``derivedStatus: healthy`` beside ``wsConnected: false``. The device is
    demonstrably NOT fully serviceable, so it reports ``degraded`` — an
    honest state the wire enum already has.

    (The precise state this deserves is a dedicated ``relay_unroutable``
    value. ``RunnerStatus`` is a GENERATED type — canonical Rust enum in
    qontinui-schemas, regenerated by a binary that lives in qontinui-runner,
    with committed OpenAPI snapshots and hand-written exhaustive frontend
    maps — so adding a value is a three-repo change. Deliberately not done
    here: it would put a cross-repo dependency chain in front of the P0 relay
    fix this change ships with. ``degraded`` surfaces the contradiction today
    at zero schema cost; the named state is a follow-up.)
    """
    if device.ws_session_id is not None:
        return RunnerStatus.healthy
    if device.ui_error is not None:
        return RunnerStatus.errored
    raw = (device.derived_status or "offline").lower()
    if raw in _LIVENESS_CLAIMS and not _heartbeat_is_fresh(device.last_heartbeat):
        return RunnerStatus.offline
    if raw == "healthy":
        # Fresh heartbeat, no WS presence pointer — relay-unroutable.
        # Only ``healthy`` is demoted: ``degraded`` already reports the
        # weaker state honestly, and ``starting`` legitimately has no WS
        # pointer yet, so demoting either would erase information rather
        # than add it.
        return RunnerStatus.degraded
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


# ---------------------------------------------------------------------------
# Runner instances (plan
# ``2026-09-20-runner-selector-drives-a-transport-not-a-target`` Phase 6)
#
# Every runner instance on a machine shares the machine's ``device_id`` and so
# its ONE ``coord.devices`` row; ``Runner.instances`` lists the live ones, one
# per ``coord.device_connections`` row, so a consumer can address ``:9876`` and
# ``:9877`` on one box separately.
# ---------------------------------------------------------------------------


def _connection_to_instance(conn: DeviceConnection) -> RunnerInstance:
    """One live connection row → one wire ``RunnerInstance``.

    A row with no ``instance_key`` came from a runner that predates the field
    (or was written before the column existed); it is keyed
    ``connection:<pk>`` — a namespace no runner can spell, so it can never
    collide with a real key — rather than being given one it did not report.
    A NULL role exists only on pre-migration rows, which were all registered
    as the device's (primary) socket.
    """
    role = (
        RunnerInstanceRole.secondary
        if conn.instance_role == device_connection_crud.INSTANCE_ROLE_SECONDARY
        else RunnerInstanceRole.primary
    )
    return RunnerInstance(
        instanceKey=conn.instance_key or f"connection:{conn.id}",
        instanceRole=role,
        port=conn.port,
        connectedAt=conn.connected_at.isoformat(),
    )


def _instance_sort_key(inst: RunnerInstance) -> tuple[int, int, int, str, str]:
    """Primary first, then by port (unknown port last), then connect time."""
    return (
        0 if inst.instanceRole == RunnerInstanceRole.primary else 1,
        0 if inst.port is not None else 1,
        inst.port if inst.port is not None else 0,
        inst.connectedAt,
        inst.instanceKey,
    )


def _live_instances(
    rows: list[DeviceConnection], ws_session_id: int | None
) -> list[RunnerInstance]:
    """Which of a device's open connection rows are live instances.

    * A SECONDARY row arrives already freshness-filtered
      (:func:`device_connection_crud.list_live_instance_rows`).
    * A PRIMARY / legacy row is live only if it IS the device's
      ``ws_session_id`` pointer. Only a primary socket ever holds the pointer,
      so the pointer names the one live primary; any other open primary row is
      the orphan of an unclean close (a backend restart, a ``finally`` that
      never ran) and listing it would advertise a dead instance.
    """
    instances = [
        _connection_to_instance(r)
        for r in rows
        if r.instance_role == device_connection_crud.INSTANCE_ROLE_SECONDARY
        or (ws_session_id is not None and r.id == ws_session_id)
    ]
    return sorted(instances, key=_instance_sort_key)


async def load_live_instances(
    db: AsyncSession, pointers: dict[UUID, int | None]
) -> dict[UUID, list[RunnerInstance]]:
    """``Runner.instances`` for many devices from ONE connections query.

    ``pointers`` maps each device to its ``ws_session_id`` (the list and
    snapshot paths already hold it on the device row), so this costs one
    query per response regardless of how many devices it lists.
    """
    rows = await device_connection_crud.list_live_instance_rows(db, list(pointers))
    return {
        device_id: _live_instances(rows.get(device_id, []), pointer)
        for device_id, pointer in pointers.items()
    }


async def devices_to_wire(db: AsyncSession, devices: list[Device]) -> list[RunnerWire]:
    """Batch :func:`_device_to_wire` — every ORM-sourced Runner list goes here."""
    instances = await load_live_instances(
        db, {d.device_id: d.ws_session_id for d in devices}
    )
    return [
        _device_to_wire(d, instances=instances.get(d.device_id, [])) for d in devices
    ]


def _device_to_wire(device: Device, *, instances: list[RunnerInstance]) -> RunnerWire:
    """Convert a SQLAlchemy ``Device`` row to the canonical wire shape.

    Phase 7 of the plan renames the wire type ``Runner`` → ``Device``;
    until that ships, the response continues to use the legacy
    ``Runner`` Pydantic schema for frontend compat.

    ``instances`` is keyword-REQUIRED so no caller can forget it and ship an
    empty list that reads as "no instance connected"; list callers use
    :func:`devices_to_wire`, which batch-loads them.
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
        instances=instances,
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
    ``derived_status`` column — with the same staleness gate (a stored
    liveness claim (healthy/degraded/starting) is only believed while
    ``last_heartbeat`` is fresh) and the same relay-unroutable gate (a
    ``healthy`` claim with a fresh heartbeat but no ``ws_session_id`` is
    self-contradictory and reports ``degraded``). Keep the two in step —
    they serve the same wire field from two different row shapes, and an
    operator comparing the ORM-served and coord-served views of one device
    must not see them disagree.
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
        # Fresh heartbeat, no WS presence pointer — relay-unroutable.
        return RunnerStatus.degraded
    if raw == "degraded":
        return RunnerStatus.degraded
    if raw == "starting":
        return RunnerStatus.starting
    if raw == "errored":
        return RunnerStatus.errored
    return RunnerStatus.offline


def _tenant_bindings_from(value: Any) -> list[DeviceTenantBinding] | None:
    """Map coord's per-device ``tenant_bindings`` array, keeping it tri-state.

    ``None`` (the key absent, or coord sending ``null``) is UNKNOWN and stays
    ``None``; ``[]`` is a measured zero and stays ``[]``. Anything that is not
    a list is a contract violation and is reported as UNKNOWN rather than as
    an empty set. Elements that are not objects carrying a ``tenant_id`` are
    dropped — they name no tenant.
    """
    if not isinstance(value, list):
        return None
    bindings: list[DeviceTenantBinding] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        tenant_id = item.get("tenant_id")
        if not tenant_id:
            continue
        slug = item.get("tenant_slug")
        last_active = item.get("last_active_at")
        bindings.append(
            DeviceTenantBinding(
                tenant_id=str(tenant_id),
                tenant_slug=str(slug) if slug else None,
                last_active_at=str(last_active) if last_active else None,
            )
        )
    return bindings


def _ws_session_id_from_row(row: dict[str, Any]) -> int | None:
    """The coord row's relay pointer as an int, or ``None`` when absent/garbled."""
    value = row.get("ws_session_id")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _device_row_to_wire(
    row: dict[str, Any], *, instances: list[RunnerInstance]
) -> DeviceResponse:
    """Convert a coord ``coord.devices`` JSON row to the canonical wire shape.

    Dict-consuming twin of :func:`_device_to_wire`. The row carries every
    ``coord.devices`` column via coord's ``to_jsonb`` (snake_case keys);
    ``last_heartbeat`` / ``created_at`` are already ISO strings. The row's
    ``tenant_bindings`` (coord's per-device tenant set) passes through with
    its tri-state intact — see :class:`DeviceResponse`.
    """
    user_id = row.get("user_id")
    return DeviceResponse(
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
        tenant_bindings=_tenant_bindings_from(row.get("tenant_bindings")),
        instances=instances,
    )


async def device_rows_to_wire(
    db: AsyncSession, rows: list[dict[str, Any]]
) -> list[DeviceResponse]:
    """Batch :func:`_device_row_to_wire` for coord-sourced rows (one query)."""
    pointers: dict[UUID, int | None] = {}
    for row in rows:
        try:
            pointers[UUID(str(row.get("device_id")))] = _ws_session_id_from_row(row)
        except ValueError:
            continue
    instances = await load_live_instances(db, pointers)
    wire: list[DeviceResponse] = []
    for row in rows:
        try:
            device_id: UUID | None = UUID(str(row.get("device_id")))
        except ValueError:
            device_id = None
        wire.append(
            _device_row_to_wire(
                row,
                instances=instances.get(device_id, []) if device_id else [],
            )
        )
    return wire


# ---------------------------------------------------------------------------
# User-authenticated endpoints — device CRUD & dispatch
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DeviceResponse])
async def list_devices_endpoint(
    *,
    request: Request,
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

    Sourced over coord's HTTP boundary (``GET /coord/devices/by-user``,
    scoped by the ``x-qontinui-user-id`` header + forwarded bearer) — Phase
    3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md``. Replaces
    the former direct ``coord.devices`` ORM read; coord owns its table.
    """
    rows = await coord_device.list_devices_for_user(request, str(current_user.id))
    # ``instances`` come from ``coord.device_connections``, which only this
    # backend writes; one batched query for the whole list, never one per row.
    wire = await device_rows_to_wire(db, rows)

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


def _coord_refusal_detail(resp: Any) -> dict[str, Any]:
    """The 502 ``detail`` relaying a non-2xx coord pairing answer.

    Coord's pairing refusals are ``{error, code, hint?}`` (plus a token-free
    per-tenant ``results`` list on a collect-mode batch refusal). ``code``,
    ``hint`` and the distinct per-tenant ``skipped_reason`` values ride as
    their own fields, parsed from the FULL body:
    ``coord_body`` is truncated, and a multi-tenant refusal routinely runs
    past 500 chars, so a client cannot reliably parse it to tell "not a
    member" from a retryable coord-side failure or a burned pairing nonce.
    """
    detail: dict[str, Any] = {
        "coord_status": resp.status_code,
        "coord_body": resp.text[:500],
    }
    try:
        refusal = resp.json()
    except ValueError:
        refusal = None
    if isinstance(refusal, dict):
        for field in ("code", "hint"):
            value = refusal.get(field)
            if isinstance(value, str) and value:
                detail[f"coord_{field}"] = value
        # A batch refusal's top-level code (`no_tenant_authorized`) does not
        # say WHY; the per-tenant reasons do. Relay only the distinct reason
        # strings — never the entries themselves.
        results = refusal.get("results")
        if isinstance(results, list):
            reasons = sorted(
                {
                    entry["skipped_reason"]
                    for entry in results
                    if isinstance(entry, dict)
                    and isinstance(entry.get("skipped_reason"), str)
                    and entry["skipped_reason"]
                }
            )
            if reasons:
                detail["coord_skip_reasons"] = reasons
    return detail


@router.post(
    "/pair-confirm",
    response_model=PairConfirmResponse,
    status_code=status.HTTP_201_CREATED,
)
async def pair_confirm(
    *,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    payload: PairConfirmRequest,
) -> Any:
    """Complete an OAuth-loopback pairing flow.

    Forwards ``(state, device_id)`` to coord's ``POST
    /coord/devices/pair-complete``; returns the issued device-token JWT
    and ``device_id`` so the browser can redirect the runner's localhost
    callback handler.

    The user is NOT in the body. Coord reads it from ``X-Qontinui-User-Id``
    and trusts that header only because it arrives under the web service
    token (``sub = service:qontinui-web-strategy``, ``strategy_admin``) —
    coord's pairing arm B (``qontinui-coord`` ``pairing_auth``). Coord then
    resolves the tenant from the pair-start flow it stored and REFUSES the
    pairing (403 ``tenant_membership_required``) unless this user's
    coord operator — matched by Cognito subject, never by email — holds
    membership in that tenant. So web does not compute or forward a
    tenant_id here. We still gate the route on a linked operator by
    calling coord's ``/admin/coord/me`` (it 403s an unlinked caller —
    the same fail-closed posture the old resolver gate provided, now
    sourced over the HTTP boundary) so an unlinked caller is refused
    before any outbound call.
    """
    if not coord_service_account.enabled:
        # Reuse the CoordServiceAccountClient's service-token plumbing for the
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

    # A device an operator revoked is re-armed only by authorize-redeem —
    # never by re-pairing it. Enforced here rather than trusted to coord.
    confirm_device = _as_uuid(payload.device_id)
    if confirm_device is not None:
        await refuse_if_credential_revoked(db, confirm_device, door="pair_confirm")

    # The credential coord verifies is in the HEADERS: the web service
    # token + `X-Qontinui-User-Id` (arm B). The body carries no identity —
    # coord's PairCompleteRequest is exactly `{state, device_id}`; the
    # former `web_session_token` sentinel and `user_id` were never
    # verified by anything and are gone.
    headers = await coord_service_account._headers(str(current_user.id))  # noqa: SLF001
    body: dict[str, Any] = {
        "state": payload.state,
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
            detail=_coord_refusal_detail(resp),
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
    # Collect mode (multi-tenant flow): coord minted one token per tenant and
    # holds them for the runner's pair-collect. The browser gets only the
    # per-tenant outcomes, so a token is not required here — and the page
    # never puts one in the callback URL.
    raw_collect = coord_body.get("collect")
    if raw_collect is None:
        # Absent and an explicit null both mean the legacy single-tenant flow.
        raw_collect = False
    if not isinstance(raw_collect, bool):
        # A non-boolean flag must never fall through to the legacy branch,
        # which would put coord's token in the response and callback URL.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-complete returned a malformed collect flag.",
        )
    collect = raw_collect
    if not coord_device_id or (not collect and not coord_token):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-complete response missing device_id/token.",
        )

    results: list[PairConfirmTenantResult] | None = None
    if collect:
        raw_results = coord_body.get("results")
        # Collect mode always carries at least one per-tenant outcome; coord
        # answers 403 (not an empty list) when nothing was minted.
        if not isinstance(raw_results, list) or not raw_results:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Coord pair-complete returned malformed results.",
            )
        try:
            # Rebuild each entry from the three named fields only, so a token
            # coord might ever add to an entry cannot reach the browser.
            results = [
                PairConfirmTenantResult(
                    tenant_id=entry.get("tenant_id"),
                    status=entry.get("status"),
                    skipped_reason=entry.get("skipped_reason"),
                )
                for entry in raw_results
            ]
        except (ValidationError, AttributeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Coord pair-complete returned malformed results.",
            ) from exc

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
        collect=collect,
        tenants=len(results) if results is not None else None,
    )
    return PairConfirmResponse(
        device_id=device_uuid,
        # Collect mode: the browser never needs a token (the runner collects all
        # of them over pair-collect), so none is returned to it at all.
        token=None if collect else str(coord_token),
        state=payload.state,
        collect=collect,
        results=results,
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
    from that bearer. The ``X-Qontinui-User-Id`` header is still sent;
    coord cross-checks it against the operator's OWN ``auth.users`` row
    (matched by Cognito subject) and refuses ``user_mismatch`` if it names
    anyone else — it is an assertion coord verifies, not an identity coord
    trusts.

    Tenant: web never RESOLVES a tenant, but it FORWARDS a real
    caller-supplied ``tenant_id``. Coord validates it
    (``authorize_pairing_tenant``) and derives the tenant from the operator
    bearer (``principal.home_tenant()``) only when the body names none.
    Plan ``2026-05-30-coord-operator-resolver-removal`` (follow-up #1)
    stopped forwarding ``tenant_id`` altogether; plan
    ``2026-09-17-device-jwt-refresh-drops-the-requested-tenant-and-coord-mints-the-home-tenant``
    restores forwarding of a real one, because a runner's device-JWT
    refresh after expiry otherwise gets the user's HOME tenant minted —
    and coord records that pairing, silently re-pointing the device.

    The nil UUID is treated as absent and is NOT forwarded: runner UI
    sign-in sends ``tenant_id = 00000000-…`` as a placeholder on every
    first pairing, and forwarding it would 403 at coord's membership check
    (surfacing here as a 502) and break every sign-in.
    """
    if not coord_service_account.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Coord integration disabled (COORD_ADMIN_SECRET unset); "
                "device pairing unavailable."
            ),
        )

    # A device an operator revoked is re-armed only by authorize-redeem —
    # never by re-pairing it. Enforced here rather than trusted to coord.
    await refuse_if_credential_revoked(db, payload.device_id, door="pair_cli")

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
    # Forward a real tenant hint only; absent or nil → coord derives it.
    if payload.tenant_id is not None and payload.tenant_id != _NIL_UUID:
        body["tenant_id"] = str(payload.tenant_id)

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
            detail=_coord_refusal_detail(resp),
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
    #
    # It mints ONLY when the device has no key, or its key is expired or
    # within :data:`SELF_MINT_RENEWAL_WINDOW` of expiry (coord finding
    # ``414676cf``). ``dmk_crud.mint`` keeps one row per device, so rotating
    # a still-usable key on every call invalidated the runner's stored key
    # whenever the runner failed to persist the new one. A usable key is kept
    # and ``device_machine_key`` is ``None`` — the runner keeps the key it
    # has. A revoked key, or a device whose credentials an operator revoked,
    # is never re-armed here: only an operator's ``authorize-redeem`` does.
    device_machine_key: str | None = None
    dmk_outcome = "minted"
    try:
        if await device_crud.get_credential_revoked_at(db, device_uuid) is not None:
            dmk_outcome = "device_credential_revoked"
        else:
            tenant_raw = coord_body.get("tenant_id")
            tenant_id = UUID(str(tenant_raw)) if tenant_raw else None
            device_machine_key, _cred = await dmk_crud.mint(
                db,
                device_id=device_uuid,
                owner_user_id=current_user.id,
                tenant_id=tenant_id,
                refuse_if_revoked=True,
                refuse_if_usable_beyond=SELF_MINT_RENEWAL_WINDOW,
            )
            await db.commit()
    except dmk_crud.DeviceMachineKeyStillUsableError:
        device_machine_key = None
        dmk_outcome = "kept_usable_key"
    except dmk_crud.DeviceMachineKeyRevokedError:
        device_machine_key = None
        dmk_outcome = "machine_key_revoked"
    except Exception as exc:  # noqa: BLE001 — never break pairing on mint
        device_machine_key = None
        dmk_outcome = "failed"
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
        dmk_outcome=dmk_outcome,
    )
    return PairCliResponse(
        device_id=device_uuid,
        token=str(coord_token),
        user_id=current_user.id,
        device_machine_key=device_machine_key,
    )


# ---------------------------------------------------------------------------
# Operator credential controls — plan
# ``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web``
#
# * ``GET  /credential-overview`` — the caller's devices with web's own
#   credential facts (machine key, device deny, pending authorization).
# * ``POST /{device_id}/authorize-redeem`` — an operator authorizes ONE device
#   to re-pair itself: mints a pair code bound to it (never returned here).
# * ``GET  /{device_id}/pending-redeem`` — the credential-dark runner collects
#   that code with its own EXPIRED-but-coord-signed device JWT.
# * ``POST /{device_id}/machine-credential/revoke`` — fail-closed revoke.
#
# ``/credential-overview`` is declared before ``GET /{device_id}`` so the
# literal segment is never parsed as a device id.
# ---------------------------------------------------------------------------


def _as_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


async def _operator_tenant_device(
    request: Request, current_user: UserModel, device_id: UUID
) -> UUID:
    """Resolve ``device_id`` for an operator control and return its tenant.

    The caller is a Cognito-authenticated user (the route's
    ``get_current_active_user_async`` — a device JWT never resolves there),
    linked to a coord operator (``/admin/coord/me``, which 403s an unlinked
    caller). The device is read over coord's ownership boundary
    (``/coord/devices/:id/owned``); a device the caller does not own is 404
    ``device_not_found``. Its ``tenant_id`` must be one of the caller's
    coord tenant memberships, else 403 ``device_not_in_tenant``.
    """
    identity = await get_coord_identity(request)
    try:
        row = await coord_device.get_owned_device(
            request, device_id, str(current_user.id)
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "device_not_found",
                    "message": "No such device among yours.",
                },
            ) from exc
        raise
    if _as_uuid(row.get("device_id")) != device_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "coord_device_state_malformed",
                "message": "Coord answered for a different device.",
            },
        )
    tenant_id = _as_uuid(row.get("tenant_id"))
    if tenant_id is None or tenant_id not in identity.tenant_ids():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_not_in_tenant",
                "message": "This device is not in any of your tenants.",
            },
        )
    return tenant_id


@router.get("/credential-overview", response_model=DeviceCredentialOverviewResponse)
async def credential_overview(
    *,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """The caller's devices, in the caller's tenants, with web's credential
    facts: machine key (presence / expiry / revocation), the device-scoped
    deny, and any operator authorization still awaiting the runner.

    Same auth and device set as ``GET /api/v1/devices`` (coord
    ``/coord/devices/by-user``), narrowed to devices whose ``tenant_id`` is
    one of the caller's coord tenant memberships. The deny is read from this
    backend's own database — web authors and writes the column, so its value
    is authoritative here — never defaulted from a coord JSON row that might
    omit it.
    Credential POSTURE is coord's ``GET /coord/status`` and is joined on
    ``device_id`` by the client, not served here.
    """
    identity = await get_coord_identity(request)
    tenants = set(identity.tenant_ids())
    rows = await coord_device.list_devices_for_user(request, str(current_user.id))

    in_tenant: list[tuple[UUID, dict[str, Any]]] = []
    for row in rows:
        device_id = _as_uuid(row.get("device_id"))
        if device_id is None or _as_uuid(row.get("tenant_id")) not in tenants:
            continue
        in_tenant.append((device_id, row))

    device_ids = [device_id for device_id, _ in in_tenant]
    keys = await dmk_crud.list_for_devices(db, device_ids)
    pending = await pair_code_crud.pending_for_devices(db, device_ids)
    denies = await device_crud.credential_revoked_at_for_devices(db, device_ids)

    devices: list[DeviceCredentialOverviewRow] = []
    for device_id, row in in_tenant:
        cred = keys.get(device_id)
        code = pending.get(device_id)
        devices.append(
            DeviceCredentialOverviewRow(
                device_id=device_id,
                hostname=row.get("hostname"),
                machine_key=DeviceMachineKeyPosture(
                    present=cred is not None,
                    expires_at=cred.expires_at if cred else None,
                    revoked_at=cred.revoked_at if cred else None,
                ),
                credential_revoked_at=denies.get(device_id),
                pending_redeem=(
                    PendingRedeemPosture(
                        expires_at=code.expires_at, delivered_at=code.delivered_at
                    )
                    if code
                    else None
                ),
            )
        )
    return DeviceCredentialOverviewResponse(devices=devices)


@router.post(
    "/{device_id}/authorize-redeem",
    response_model=AuthorizeRedeemResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def authorize_redeem(
    *,
    request: Request,
    device_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Authorize ONE device to re-pair itself, headless.

    **Operator SSO only.** ``get_current_active_user_async`` verifies a
    Cognito token (a coord device JWT, or any other bearer, is a 401), and
    :func:`_operator_tenant_device` requires a linked coord operator whose
    tenant holds the device. The target is the PATH ``device_id``; the route
    declares no body, so nothing a caller sends can redirect it.

    Effect, one transaction:

    * mints an ordinary pair code through ``pair_code_crud`` BOUND to this
      device, in the device's tenant, with
      :data:`~app.crud.pair_code_crud.BOUND_PAIR_CODE_TTL` (30 min — the
      runner polls every 300 s), and expires any earlier pending code for the
      device (the newest authorization supersedes);
    * clears ``coord.devices.credential_revoked_at`` — re-arming is this
      explicit act, never a side effect;
    * deletes a REVOKED machine-key row so the runner's ``/self-mint`` can
      enrol a fresh key (a usable key is left alone).

    202 ``{device_id, expires_at}`` — the code itself is NEVER returned; only
    the device collects it, through ``/pending-redeem``.
    """
    tenant_id = await _operator_tenant_device(request, current_user, device_id)

    # Serialise concurrent authorizations (and a concurrent revoke) of this
    # device on its row, so the supersede sweep below sees every older code.
    if not await device_crud.lock_device_row(db, device_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "device_not_found",
                "message": "No device row to authorize; nothing was changed.",
            },
        )

    # Mint first so ``except_code`` below can name the new code. Its collision
    # retry uses a SAVEPOINT, so the row lock above survives it.
    code_row = await pair_code_crud.mint_pair_code(
        db,
        tenant_id=tenant_id,
        issued_by_user_id=current_user.id,
        bound_device_id=device_id,
        ttl=pair_code_crud.BOUND_PAIR_CODE_TTL,
    )
    superseded = await pair_code_crud.cancel_pending_for_device(
        db, device_id, except_code=code_row.code
    )
    await device_crud.set_credential_revoked_at(db, device_id, None)
    revoked_key_deleted = await dmk_crud.delete_if_revoked(db, device_id)
    await db.commit()

    logger.info(
        "device_redeem_authorized",
        user_id=str(current_user.id),
        device_id=str(device_id),
        tenant_id=str(tenant_id),
        code_prefix=code_row.code[:2],
        superseded=superseded,
        revoked_key_deleted=revoked_key_deleted,
        expires_at=code_row.expires_at.isoformat(),
    )
    return AuthorizeRedeemResponse(device_id=device_id, expires_at=code_row.expires_at)


def _poll_refusal(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"code": code, "message": message}
    )


async def _verify_poll_token(
    credentials: HTTPAuthorizationCredentials | None, device_id: UUID
) -> dict[str, Any]:
    """The ``/pending-redeem`` trust anchor: a coord-signed DEVICE JWT for
    THIS device, expired by no more than :data:`PENDING_REDEEM_EXPIRED_GRACE`.

    * no bearer → 401 ``device_token_missing``
    * JWKS unreachable → 503 ``device_auth_unavailable``
    * past ``exp`` + 30 days → 401 ``device_token_expired_beyond_grace``
    * bad signature / foreign issuer / malformed / no ``exp`` → 401
      ``device_token_invalid``
    * ``sub_type`` not ``device`` (agent, service, capability grant) → 403
      ``not_a_device_principal``
    * ``mint_provenance`` present and not ``paired`` → 403
      ``device_token_provenance_refused``
    * not the ``issue_device`` shape (``sub != "device:<path id>"`` or no
      ``user_id`` — e.g. a push token) → 403 ``device_token_shape_refused``
    * ``device_id`` claim missing/malformed → 401 ``device_token_invalid``;
      not the path → 403 ``device_mismatch``
    """
    if credentials is None or not credentials.credentials:
        raise _poll_refusal(
            status.HTTP_401_UNAUTHORIZED,
            "device_token_missing",
            "A device token (Authorization: Bearer) is required.",
        )
    try:
        claims = await coord_jwks_client.verify_token(
            credentials.credentials,
            expired_grace_s=int(PENDING_REDEEM_EXPIRED_GRACE.total_seconds()),
        )
    except CoordJWKSUnavailableError as exc:
        logger.error("pending_redeem_jwks_unavailable", **jwks_failure_log_fields(exc))
        raise _poll_refusal(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "device_auth_unavailable",
            "Device authentication temporarily unavailable.",
        ) from exc
    except CoordTokenExpiredError as exc:
        raise _poll_refusal(
            status.HTTP_401_UNAUTHORIZED,
            "device_token_expired_beyond_grace",
            "The device token expired too long ago to prove this device; "
            "re-pair it with a pair code.",
        ) from exc
    except CoordTokenInvalidError as exc:
        logger.warning(
            "pending_redeem_token_rejected",
            device_id=str(device_id),
            failure=type(exc).__name__,
            error=str(exc),
        )
        raise _poll_refusal(
            status.HTTP_401_UNAUTHORIZED,
            "device_token_invalid",
            "The device token did not verify.",
        ) from exc

    if claims.get("sub_type") != _DEVICE_SUB_TYPE:
        raise _poll_refusal(
            status.HTTP_403_FORBIDDEN,
            "not_a_device_principal",
            "This route accepts only a device token.",
        )
    provenance = claims.get("mint_provenance")
    if provenance is not None and provenance != _PAIRED_MINT_PROVENANCE:
        raise _poll_refusal(
            status.HTTP_403_FORBIDDEN,
            "device_token_provenance_refused",
            "Only a pairing-issued device token proves a device.",
        )
    token_device = _as_uuid(claims.get("device_id"))
    if token_device is None:
        raise _poll_refusal(
            status.HTTP_401_UNAUTHORIZED,
            "device_token_invalid",
            "The device token carries no usable device_id claim.",
        )
    if token_device != device_id:
        raise _poll_refusal(
            status.HTTP_403_FORBIDDEN,
            "device_mismatch",
            "The device token does not match this device.",
        )
    # The exact shape coord's ``issue_device`` mints (qontinui-coord
    # ``jwt.rs``): ``sub = "device:<device_id>"`` and a user. A push token
    # (``sub = "push:<session>"``, no user) or any other device-typed token
    # without that shape proves no paired device, whatever its provenance.
    if (
        claims.get("sub") != f"device:{device_id}"
        or _as_uuid(claims.get("user_id")) is None
    ):
        raise _poll_refusal(
            status.HTTP_403_FORBIDDEN,
            "device_token_shape_refused",
            "Only a pairing-issued device token (device subject with a user) "
            "proves a device.",
        )
    return claims


@router.get(
    "/{device_id}/pending-redeem",
    response_model=PendingRedeemResponse,
    responses={204: {"description": "Nothing is pending for this device."}},
)
async def pending_redeem(
    *,
    device_id: UUID,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_poll_bearer_scheme),
) -> Any:
    """Hand a credential-dark runner the pair code an operator authorized
    for it — AT MOST ONCE.

    Authenticated by the device's own coord-signed device JWT with expiry
    TOLERATED up to 30 days (:func:`_verify_poll_token`): a third party that
    knows only a ``device_id`` cannot forge one, and a stolen expired token
    yields a code only after an operator authorized exactly this device. A
    device whose credentials are revoked is refused (403
    ``device_credential_revoked``; a failed read is a 503, never a pass).

    200 ``{code, expires_at}`` exactly once per authorization (the code is
    stamped delivered); 204 when nothing is pending. The runner then redeems
    the code through the ordinary ``/pair-codes/{code}/redeem``.
    """
    await _verify_poll_token(credentials, device_id)
    await refuse_if_credential_revoked(db, device_id, door="pending_redeem")

    row = await pair_code_crud.claim_undelivered_for_device(db, device_id)
    if row is None:
        return Response(
            status_code=status.HTTP_204_NO_CONTENT,
            headers={"Cache-Control": "no-store"},
        )
    await db.commit()
    # The body is a one-time credential: no cache may keep it.
    response.headers["Cache-Control"] = "no-store"
    logger.info(
        "pending_redeem_delivered",
        device_id=str(device_id),
        code_prefix=row.code[:2],
    )
    return PendingRedeemResponse(code=row.code, expires_at=row.expires_at)


@router.post(
    "/{device_id}/machine-credential/revoke",
    response_model=DeviceCredentialRevokeResponse,
    status_code=status.HTTP_200_OK,
)
async def revoke_device_credentials(
    *,
    request: Request,
    device_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Revoke a device's credentials, fail-closed. Operator SSO, tenant-scoped
    (same gate as :func:`authorize_redeem`).

    One transaction: revokes the machine key (``dmk_crud.revoke`` — hash
    cleared, so ``/exchange`` can never match it), sets
    ``coord.devices.credential_revoked_at`` (every web door that issues this
    device a credential, and coord's refresh/service-mint, refuse while it is
    set), and expires any pending authorization. Only a later
    ``authorize-redeem`` clears it. 404 ``device_not_found`` when there is no
    ``coord.devices`` row to deny — nothing is committed then.
    """
    await _operator_tenant_device(request, current_user, device_id)

    if not await device_crud.lock_device_row(db, device_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "device_not_found",
                "message": "No device row to revoke; nothing was changed.",
            },
        )
    revoked_at = datetime.now(UTC)
    await dmk_crud.revoke(db, device_id)
    if not await device_crud.set_credential_revoked_at(db, device_id, revoked_at):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "device_not_found",
                "message": "No device row to revoke; nothing was changed.",
            },
        )
    cancelled = await pair_code_crud.cancel_pending_for_device(db, device_id)
    await db.commit()

    logger.info(
        "device_credentials_revoked",
        user_id=str(current_user.id),
        device_id=str(device_id),
        pending_codes_cancelled=cancelled,
    )
    return DeviceCredentialRevokeResponse(device_id=device_id, revoked_at=revoked_at)


# ---------------------------------------------------------------------------
# Single-device read / delete / dispatch
# ---------------------------------------------------------------------------


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device_endpoint(
    *,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
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
    (wire,) = await device_rows_to_wire(db, [row])
    return wire


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
# Device machine key (`dmk_`) — mint (user bearer), self-mint (live device
# JWT) + exchange (dmk_ auth)
#
# The >30-day-offline cold-start recovery path (4b): a long-lived,
# device-bound machine key the runner exchanges for a device JWT with NO user
# session. Mint is user-authenticated (owner mints/rotates their device's
# key); self-mint lets a device holding a live paired JWT enrol its own key
# before an outage can strand it; exchange is authenticated by the key itself and rides web's trusted
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

    Refused (403 ``device_credential_revoked``) while an operator's revoke
    stands — this mint rotates over a revoked key, so without the check it
    would silently undo the revocation.
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

    await refuse_if_credential_revoked(db, device_id, door="mint")

    # ``refuse_if_revoked`` closes the race with a concurrent revoke: the revoke
    # commits the key revocation and the device deny together, and
    # ``dmk_crud.mint`` re-reads the key under ``FOR UPDATE``, so a mint that
    # passed the deny check above still cannot rotate over a revoked key.
    try:
        return await _mint_machine_credential(
            db,
            device_id=device_id,
            owner_user_id=current_user.id,
            tenant_id=tenant_id,
            via="user_bearer",
            refuse_if_revoked=True,
        )
    except dmk_crud.DeviceMachineKeyRevokedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_credential_revoked",
                "message": (
                    "This device's credentials were revoked. Only an "
                    "operator's Authenticate (authorize-redeem) re-arms it."
                ),
            },
        ) from exc


@router.post(
    "/{device_id}/machine-credential/self-mint",
    response_model=DeviceMachineCredentialMintResponse,
    status_code=status.HTTP_201_CREATED,
)
async def self_mint_device_machine_credential(
    *,
    device_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    device_ctx: DeviceTokenContext = Depends(get_paired_device),
) -> Any:
    """Mint (or rotate) a device's OWN machine key, authenticated by its live
    device JWT — no user session.

    Plan ``2026-09-24-runner-coord-credential-stranded-after-outage`` Phase 3.
    The ``dmk_`` is the only credential that re-derives a device JWT after the
    JWT has expired (``/exchange``), but until now it was issued only by
    pairing and by the user-bearer :func:`mint_device_machine_credential`. A
    runner paired before the auto-mint, or one that lost its key, therefore
    had no way to acquire one unattended, and an outage longer than its
    JWT's remaining life stranded it until an operator re-paired. The runner
    calls this while it still holds a valid device JWT and its stored key is
    absent or near expiry.

    **Authentication** (:func:`~app.api.deps.get_paired_device`): only an
    UNEXPIRED coord-signed device JWT with ``sub_type=device`` and
    ``mint_provenance=paired``. No bearer / expired / invalid → 401; an agent
    credential (including the anonymous bootstrap mint), a capability grant,
    or a ``bootstrap``/``unknown`` provenance → 403.

    **Authorization**, all server-side, nothing read from a body:

    * the token's ``device_id`` claim MUST equal the path → else 403
      ``device_mismatch``. A device mints only its own key.
    * coord must know the device: ``GET /coord/devices/{id}/state``,
      forwarding the caller's verified device JWT (5 s budget). A 404 → 403
      ``device_not_owned``; a row naming a different ``device_id`` → 403
      ``device_mismatch``; coord refusing the forwarded token (401/403 or
      any other non-404 4xx except 429) → 403 ``coord_refused_device_token``;
      coord unreachable, timed out, any other transport failure, a 5xx, or a
      429 rate limit → **503** ``coord_device_lookup_unavailable``; any
      status below 400 other than 200, a 200 that is not a JSON object, or a
      row whose ``tenant_id`` is missing, null or unparseable → **502**
      ``coord_device_state_malformed``. In every
      one of these nothing is minted — an unanswered or unreadable lookup is
      UNKNOWN, never a licence to mint.
    * a device whose credentials an operator revoked
      (``coord.devices.credential_revoked_at``) → 403
      ``device_credential_revoked`` (a failed read → 503).
    * an existing key that an operator REVOKED is not re-minted → 403
      ``device_machine_key_revoked``. ``dmk_crud.mint`` clears ``revoked_at``
      on rotation, so without this a device could undo its own revocation;
      re-enrolment after a revocation stays with the owner's user-bearer mint.
    * an existing unrevoked key still usable for more than
      :data:`SELF_MINT_RENEWAL_WINDOW` (7 days) is NOT rotated → 409
      ``machine_key_still_usable``.

    Both key-state checks run inside ``dmk_crud.mint``, after its
    ``SELECT ... FOR UPDATE`` of the row, so a concurrent revoke cannot be
    undone and two concurrent self-mints cannot both rotate (the second sees
    the first's fresh key and gets the 409).

    **Owner**: the verified device JWT's ``user_id`` claim. The read
    boundary forbids web reading ``coord.devices`` directly, and no coord
    read route that accepts a device JWT returns the owner. How coord sets
    that claim (qontinui-coord ``origin/main`` ``9774f4e43``):

    * pairing — ``post_pair_complete`` and ``post_pair_cli``
      (``routes_phase3.rs:2431``/``:2461`` and ``:2585``/``:2615``) write the
      paired user to ``coord.devices.user_id`` via ``record_pairing``
      (``:2254``, UPSERT ``user_id = $4``) and mint the JWT for that SAME
      user in the same request;
    * ``service-mint`` reads ``user_id`` from the ``coord.devices`` row
      (``tokens.rs:623``, minted at ``:670``);
    * refresh does NOT re-read it: ``authorize_device_refresh`` copies the
      presented claim (``tokens.rs:222-224``, minted at ``:455-458``) and
      checks only ``capability_user_paired`` (``:383``) and the tenant
      binding.

    So the claim equals ``coord.devices.user_id`` at pairing, but after the
    device is RE-PAIRED to another user, the previous user's token keeps its
    ``user_id`` for as long as it keeps being refreshed — not merely until it
    expires. Such a token can enrol (within the 7-day rule below) a key whose
    ``owner_user_id`` names the previous user. That field is a label: the key
    is still bound to this device only, and web's ``/exchange`` sends coord
    ``service-mint`` only the path ``device_id`` (the ``X-Qontinui-User-Id``
    header it also sends is never read: ``post_service_mint_device`` takes no
    headers, ``tokens.rs:586-589``), and service-mint
    resolves both owner and tenant from ``coord.devices`` (``tokens.rs:623``
    → ``:670``). The JWT a key yields is therefore always the CURRENT
    owner's; the stale label grants nothing.

    **Tenant**: the ``tenant_id`` of coord's ``/state`` row — the same
    ``coord.devices.tenant_id`` column the user-bearer route reads through
    ``/owned`` (which accepts only an operator bearer). The token's own
    ``tenant_id`` claim is deliberately NOT used: on a multi-tenant device it
    names whichever tenant slot the token was minted for. The stored tenant
    is a label on the key; ``/exchange`` does not read it.

    **When it mints**: only when the device has no key, or its key is expired
    or within 7 days of expiry. The new key gets the normal
    ``DEVICE_MACHINE_KEY_TTL_DAYS`` expiry and replaces the old one, whose
    plaintext stops working. Replacing a lost-but-still-valid key is the
    owner's job, through the user-bearer ``/mint``.

    **The bound on what this adds.** The caller already holds an unexpired
    device JWT for this device, which can self-refresh at coord indefinitely
    while it stays unexpired. The ``dmk_`` it receives is bound to the same
    device, exchanges only for a device JWT for that device (``/exchange``
    403s any other), is owner-attributed, expires, and cannot be re-minted
    here once revoked. So a leaked live device JWT (or a JWT that a leaked
    ``dmk_`` derived via ``/exchange``) gains exactly this: it can obtain a
    ``dmk_`` for this device ONLY while the device has no key usable for more
    than 7 days. It cannot rotate, and so cannot silently invalidate, the
    real runner's usable recovery key. Inside the final 7 days, or with no
    key at all, it can win the renewal race; the real runner then finds its
    own key refused at ``/exchange``.

    Response: the same :class:`DeviceMachineCredentialMintResponse` as
    ``/mint`` (plaintext ``dmk_`` returned ONCE), status 201.
    """
    if device_ctx.device_id != device_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_mismatch",
                "message": "Device token does not match this device.",
            },
        )

    await refuse_if_credential_revoked(db, device_id, door="self_mint")

    tenant_id = await _self_mint_device_tenant(device_ctx, device_id)

    try:
        return await _mint_machine_credential(
            db,
            device_id=device_id,
            owner_user_id=device_ctx.user_id,
            tenant_id=tenant_id,
            via="device_jwt",
            refuse_if_revoked=True,
            refuse_if_usable_beyond=SELF_MINT_RENEWAL_WINDOW,
        )
    except dmk_crud.DeviceMachineKeyRevokedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_machine_key_revoked",
                "message": (
                    "This device's machine key was revoked; re-mint it with "
                    "the owner's session."
                ),
            },
        ) from exc
    except dmk_crud.DeviceMachineKeyStillUsableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "machine_key_still_usable",
                "message": (
                    "This device already holds a machine key usable for more "
                    "than 7 days; self-mint renews only an absent, expired or "
                    "expiring key. Replace a lost key with the owner's /mint."
                ),
            },
        ) from exc


async def _self_mint_device_tenant(
    device_ctx: DeviceTokenContext, device_id: UUID
) -> UUID:
    """Ask coord for the device's ``tenant_id`` (``GET /coord/devices/:id/state``)
    on the caller's own verified device JWT, mapping every non-answer to a
    refusal. See :func:`self_mint_device_machine_credential` for the table.
    """
    if not device_ctx.token:
        # get_paired_device always sets it; a context without one is a wiring
        # bug, and minting on an unverifiable lookup is not an option.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Device token unavailable for the coord lookup.",
        )
    try:
        row = await coord_device.get_device_state(
            device_id,
            device_bearer=device_ctx.token,
            user_id=str(device_ctx.user_id),
        )
    except coord_device.CoordDeviceStateUnavailableError as exc:
        logger.warning(
            "device_machine_credential_self_mint_coord_unavailable",
            device_id=str(device_id),
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "coord_device_lookup_unavailable",
                "message": (
                    "Coord could not confirm this device; nothing was minted. "
                    "Retry later."
                ),
            },
        ) from exc
    except coord_device.CoordDeviceStateRefusedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "coord_refused_device_token",
                "message": f"Coord refused this device token ({exc.status_code}).",
            },
        ) from exc
    except coord_device.CoordDeviceStateMalformedError as exc:
        raise _coord_state_malformed(str(exc)) from exc

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_not_owned",
                "message": "Coord does not know this device.",
            },
        )
    if str(row.get("device_id")) != str(device_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_mismatch",
                "message": "Coord answered for a different device.",
            },
        )
    raw_tenant = row.get("tenant_id")
    if raw_tenant is None:
        raise _coord_state_malformed("coord device state carried no tenant_id")
    try:
        return UUID(str(raw_tenant))
    except (TypeError, ValueError) as exc:
        raise _coord_state_malformed(
            "coord device state carried an unparseable tenant_id"
        ) from exc


def _coord_state_malformed(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={"code": "coord_device_state_malformed", "message": message},
    )


async def _mint_machine_credential(
    db: AsyncSession,
    *,
    device_id: UUID,
    owner_user_id: UUID,
    tenant_id: UUID | None,
    via: str,
    refuse_if_revoked: bool = False,
    refuse_if_usable_beyond: timedelta | None = None,
) -> DeviceMachineCredentialMintResponse:
    """Mint (or rotate) ``device_id``'s ``dmk_`` and build the one-shot
    response — the logic shared by ``/mint`` and ``/self-mint``.

    Authorization is the caller's job; this only mints with the normal
    ``DEVICE_MACHINE_KEY_TTL_DAYS`` TTL, commits, and logs. ``via`` names the
    authenticating arm in the log line. The ``refuse_*`` guards pass through
    to ``dmk_crud.mint``, which evaluates them under its row lock and raises
    its typed errors (the caller maps them to HTTP).
    """
    plaintext, cred = await dmk_crud.mint(
        db,
        device_id=device_id,
        owner_user_id=owner_user_id,
        tenant_id=tenant_id,
        refuse_if_revoked=refuse_if_revoked,
        refuse_if_usable_beyond=refuse_if_usable_beyond,
    )
    await db.commit()

    logger.info(
        "device_machine_credential_minted",
        user_id=str(owner_user_id),
        device_id=str(device_id),
        dmk_prefix=cred.dmk_prefix,
        via=via,
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

    403 ``device_credential_revoked`` while an operator's device-scoped revoke
    stands (a failed read → 503). 503 when the coord service bridge is
    disabled (``COORD_ADMIN_SECRET`` unset). A coord 4xx propagates as the
    matching client error.
    """
    if cred.device_id != device_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "device_mismatch",
                "message": "Device machine key does not match this device.",
            },
        )

    await refuse_if_credential_revoked(db, device_id, door="exchange")

    # Fail fast + honest 503 before doing any work when coord is disabled.
    if not coord_service_account.enabled:
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
        coord_status, coord_body = await coord_service_account.mint_device_token(
            acting_user_id, str(device_id)
        )
    except CoordServiceAccountDisabledError as exc:
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
