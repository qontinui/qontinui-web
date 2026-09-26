"""Unified device-side WebSocket endpoint (Phase 5 — Unified Devices Registry).

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
renamed ``WS /api/v1/runners/ws`` to ``WS /api/v1/devices/ws`` with no
deprecation alias and retired the runner-token bearer auth
(``qontinui_runner_<random>`` + Argon2) in favour of the coord-issued
device-token JWT verified against coord's JWKS.

The device opens *one* persistent connection to ``WS /api/v1/devices/ws``
and uses it for registration, heartbeats, dispatch, command relay, and
status updates. Authentication is via the ``Authorization: Bearer
<device-jwt>`` header (or ``?token=`` query string for browser-style
clients).

Inbound messages handled (unchanged from the legacy endpoint):
  - ``runner_info``  — first message after connect; identifies the
                       device and triggers a registration-or-update on
                       ``coord.devices``.
  - ``heartbeat``    — refreshes ``last_heartbeat``, may carry
                       ``ui_error`` / ``recent_crash`` updates.
  - ``ping``         — replies with ``pong``.
  - ``phase_completed`` / ``ui_error`` / ``recent_crash`` /
    ``dispatch_ack`` / ``command_response`` / ``chat_response`` /
    ``terminal_response`` — relayed to subscribed frontends/mobiles.
  - ``remote_terminal_*`` — the device is the SOURCE of a remote-terminal
                       attach (D6) or create; brokered by
                       ``services.runner.remote_terminal_relay``.
  - ``terminal_attached`` — the device is the TARGET answering one; routed
                       to the attached source only, never to mobiles.

Outbound messages (sent by other components via the manager):
  - ``connected``    — handshake ack with the resolved ``device_id``.
  - ``dispatch``     — workflow dispatch from web/mobile.
  - ``command`` / ``chat_*`` / ``terminal_*`` — relays from web/mobile.
  - ``error``        — handshake / per-message errors.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from qontinui_schemas.common import utc_now
from sqlalchemy.exc import IntegrityError
from starlette.websockets import WebSocketState

from app.config.redis_config import get_redis
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.db.session import AsyncSessionLocal
from app.schemas.dev_dashboard import RunnerUiThread
from app.services import devenv_auto_enroll
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenForeignIssuerError,
    CoordTokenInvalidError,
    coord_jwks_client,
    describe_token_rejection,
    identity_mismatch_remedy_fields,
    jwks_failure_log_fields,
)
from app.services.runner import remote_terminal_relay
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.websockets.safe_send import (
    BENIGN_SEND_EXCEPTIONS,
    reject,
    safe_close,
)

logger = structlog.get_logger(__name__)

# Max per-mobile terminal_output frame payload (chars). Runaway lines (e.g. a
# binary dumped to a tty) are truncated with a marker so a single frame can't
# blow the per-mobile memory budget. See plan Risks / feedback_memory_pressure.
_TERMINAL_FRAME_LIMIT = 65536

router = APIRouter()

# ---------------------------------------------------------------------------
# Runner-instance identity (plan
# 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 6).
#
# Every runner instance on a machine — the primary on :9876 and each
# supervisor-spawned secondary on :9877-9899 — authenticates with the SAME
# machine device JWT, so they all land on ONE ``coord.devices`` row. That row's
# ``port`` and relay pointer (``ws_session_id``), and the runner WS manager's
# registration (keyed on ``device_id`` alone), describe ONE socket: the
# POINTER OWNER's. Before this, whichever instance connected last took all
# three over, so a temp runner silently stole the device's relay socket.
#
# The rule now. Every socket records its own ``coord.device_connections`` row
# (key, role, port, ``last_seen_at``). The pointer — ``Device.port`` /
# ``ws_session_id`` / ``ws_connected_at`` plus the manager registration and
# device-level heartbeat state — belongs to ONE owner:
#   * a primary (or a legacy runner that predates the fields) ALWAYS takes it
#     on connect, from a secondary too;
#   * a secondary takes it only when no live connection holds it (so a lone
#     secondary does not leave the device relay-less), and gives it up simply
#     by no longer being what the manager and the pointer name once a primary
#     arrives;
#   * a secondary never displaces a live holder.
# ---------------------------------------------------------------------------

_ROLE_PRIMARY = device_connection_crud.INSTANCE_ROLE_PRIMARY
_ROLE_SECONDARY = device_connection_crud.INSTANCE_ROLE_SECONDARY
_MAX_INSTANCE_KEY_LEN = 256
_LIVE_KEY_INDEX = "uq_device_connections_live_instance_key"

# Close codes for handshake refusals this file owns. qontinui-runner does not
# interpret close codes at all: ANY close before the ``connected`` ack is
# recorded verbatim as ``last_error`` (``code=…, reason=…``) and treated as a
# registration rejection — it kicks the device-JWT refresher for the first
# ``REGISTRATION_KICK_LIMIT`` (3) consecutive rejections, a no-op unless the
# token is near expiry, and reconnects on its 2s→max exponential backoff
# (qontinui-runner ``src-tauri/src/mcp/backend_relay.rs``: close handling
# ~:1975-1998, kick/backoff ~:1168-1259, ``REGISTRATION_KICK_LIMIT`` ~:76-87).
# So no code buys a different client behaviour; what an application code buys
# is an honest ``last_error``: 1008 reads, to the runner's own comments and to
# an operator, as "stale token", which a duplicate instance is not.
_CLOSE_INVALID_RUNNER_INFO = 4400
_CLOSE_DUPLICATE_INSTANCE = 4409

# How long a held socket gets to answer the liveness probe.
_PROBE_TIMEOUT_S = 5.0
# The probe is an ``http_request`` relay frame for a path the runner's relay
# allowlist refuses by construction (``mcp::relay_path_policy``): the runner
# answers it SYNCHRONOUSLY in its read loop with a 403 ``command_response``
# echoing ``request_id`` (``handle_http_request`` → ``http_relay_error``) and
# performs no local I/O. So an answer proves the runner process behind that
# socket is alive and reading it; silence proves nothing is.
_PROBE_PATH = "/__qontinui_backend_liveness_probe"

# Sockets open on THIS process, by connection pk. The duplicate-key check can
# only PROBE a socket it holds; an open row this process does not hold may be
# alive on another replica or orphaned by a restart, and the two cannot be told
# apart from here. See :func:`_resolve_instance_key_conflict`.
_LIVE_SOCKETS: dict[int, Any] = {}

# Outstanding liveness probes, by request_id. Resolved by whichever receive
# loop owns the probed socket (:func:`_consume_probe_reply`).
_PROBES: dict[str, asyncio.Future[None]] = {}

# Fire-and-forget closes of superseded sockets, kept referenced until done.
_BACKGROUND_CLOSES: set[asyncio.Task[None]] = set()


def _consume_probe_reply(msg: dict[str, Any]) -> bool:
    """If ``msg`` answers one of our liveness probes, resolve it and say so."""
    if msg.get("type") != "command_response":
        return False
    request_id = msg.get("request_id")
    if not isinstance(request_id, str):
        return False
    fut = _PROBES.get(request_id)
    if fut is None:
        return False
    if not fut.done():
        fut.set_result(None)
    return True


def _socket_is_open(ws: Any) -> bool:
    return (
        getattr(ws, "application_state", None) == WebSocketState.CONNECTED
        and getattr(ws, "client_state", WebSocketState.CONNECTED)
        == WebSocketState.CONNECTED
    )


async def _probe_send_lock(device_id: UUID, ws: Any) -> Any:
    """The manager's per-device send lock if ``ws`` is its registered socket.

    Routing the probe through it keeps the probe frame from interleaving with
    a relayed frame the manager's inbound listener is writing to the same
    socket. A socket the manager does not hold (a non-owner secondary) has no
    other writer to race, and a manager that cannot be resolved costs only
    that ordering guarantee, so both fall back to a plain send.
    """
    try:
        manager = await get_runner_websocket_manager(await get_redis())
        return manager.send_lock_for(device_id, ws)
    except Exception:
        return None


async def _probe_socket(ws: Any, device_id: UUID) -> bool:
    """Ask a held runner socket to prove it is alive. ``True`` iff it answered.

    Only meaningful for a socket whose receive loop runs in THIS process —
    that loop is what sees the reply and resolves the future.

    The SEND is inside the same ``_PROBE_TIMEOUT_S`` budget as the wait: a
    half-open socket with a full send buffer blocks ``send_json`` itself
    (for as long as TCP retransmission takes), and a probe stuck there would
    hold this handshake — and its ``_PENDING_KEYS`` entry — for minutes. A
    send that does not complete in time is "not alive".
    """
    if not _socket_is_open(ws):
        return False
    request_id = f"liveness-probe-{uuid4()}"
    fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
    _PROBES[request_id] = fut
    frame = {
        "type": "http_request",
        "request_id": request_id,
        "method": "GET",
        "path": _PROBE_PATH,
    }

    async def _send_and_wait() -> None:
        lock = await _probe_send_lock(device_id, ws)
        if lock is not None:
            async with lock:
                await ws.send_json(frame)
        else:
            await ws.send_json(frame)
        await fut

    try:
        await asyncio.wait_for(_send_and_wait(), timeout=_PROBE_TIMEOUT_S)
        return True
    except Exception:
        # TimeoutError (send or reply too slow) or a send failure alike.
        return False
    finally:
        _PROBES.pop(request_id, None)


def _close_in_background(ws: Any, *, device_id: UUID, connection_pk: int) -> None:
    """Close a superseded socket without holding the handshake up on it."""

    async def _run() -> None:
        try:
            await safe_close(
                ws,
                status.WS_1012_SERVICE_RESTART,
                reason="superseded by a newer connection with the same instanceKey",
            )
        except Exception as e:
            logger.error(
                "devices_ws_superseded_socket_close_failed",
                device_id=str(device_id),
                connection_pk=connection_pk,
                error=str(e),
                error_type=type(e).__name__,
            )

    task = asyncio.create_task(_run())
    _BACKGROUND_CLOSES.add(task)
    task.add_done_callback(_BACKGROUND_CLOSES.discard)


# ``(device_id, instance_key)`` pairs whose handshake is between the duplicate
# check and the moment its socket lands in ``_LIVE_SOCKETS``. Without it, a
# second same-key handshake on this process that ran its check inside that
# window would find the first's freshly committed row, see it absent from
# ``_LIVE_SOCKETS``, and close it as an orphan.
_PENDING_KEYS: set[tuple[UUID, str]] = set()


class InstanceClaimError(ValueError):
    """``runner_info`` carried a malformed ``instanceKey`` / ``instanceRole``."""


@dataclass(frozen=True)
class InstanceClaim:
    """Which runner instance on the machine a socket belongs to.

    ``key`` is the runner's namespaced ``instanceKey`` (``primary`` /
    ``runner:<id>`` / ``name:<name>`` / ``port:<port>``), or ``None`` for a
    runner predating the field. ``role`` is the EFFECTIVE role the socket is
    registered under, and is what every write gate below reads.
    """

    key: str | None
    role: str
    legacy: bool

    @property
    def is_primary(self) -> bool:
        return self.role == _ROLE_PRIMARY


def parse_instance_claim(
    info_msg: dict[str, Any], devenv_hint: dict[str, Any] | None
) -> InstanceClaim:
    """Read the top-level ``instanceKey`` / ``instanceRole`` from ``runner_info``.

    * Both present — used verbatim (role must be ``primary`` | ``secondary``,
      key a non-empty string of at most 256 chars).
    * Both absent — a runner predating per-instance identity (legacy). It is
      registered as the PRIMARY with a NULL key, i.e. exactly as before —
      UNLESS its ``devenv.instance_role`` block says ``secondary``. That block
      is older than the top-level fields and is set by the same runner
      predicate (``owns_shared_root_state``); honouring it is safe under this
      file's standing asymmetry for client hints — a hint may freely DEMOTE
      the sender on its own behalf, never name anything — and it stops an
      older temp runner from still taking over the relay socket.
    * Exactly one present — a contract violation (qontinui-runner always sends
      both), refused rather than guessed at.
    * Inconsistent — ``instanceKey == "primary"`` if and only if
      ``instanceRole == "primary"`` (qontinui-runner
      ``RunnerInstanceIdentity::resolve``: a primary keys as ``primary`` and a
      secondary can never produce that key). A primary with any other key or a
      secondary claiming ``primary`` is refused rather than trusted either way.

    Raises :class:`InstanceClaimError` with a message fit for the close frame.
    """
    raw_key = info_msg.get("instanceKey")
    raw_role = info_msg.get("instanceRole")

    if raw_key is None and raw_role is None:
        hinted = devenv_hint.get("instance_role") if devenv_hint else None
        role = _ROLE_SECONDARY if hinted == _ROLE_SECONDARY else _ROLE_PRIMARY
        return InstanceClaim(key=None, role=role, legacy=True)

    if raw_key is None or raw_role is None:
        raise InstanceClaimError(
            "runner_info must carry instanceKey and instanceRole together"
        )
    if raw_role not in (_ROLE_PRIMARY, _ROLE_SECONDARY):
        raise InstanceClaimError("instanceRole must be 'primary' or 'secondary'")
    if (
        not isinstance(raw_key, str)
        or not raw_key
        or len(raw_key) > _MAX_INSTANCE_KEY_LEN
    ):
        raise InstanceClaimError(
            f"instanceKey must be a non-empty string of at most "
            f"{_MAX_INSTANCE_KEY_LEN} characters"
        )
    if (raw_key == _ROLE_PRIMARY) != (raw_role == _ROLE_PRIMARY):
        raise InstanceClaimError(
            "instanceKey 'primary' is reserved for, and required of, "
            "instanceRole 'primary'"
        )
    return InstanceClaim(key=raw_key, role=raw_role, legacy=False)


class InstanceKeyConflict(Exception):
    """A LIVE socket on this device already holds the newcomer's instance key."""

    def __init__(self, holder_pk: int | None, *, race: bool) -> None:
        super().__init__(holder_pk)
        self.holder_pk = holder_pk
        self.race = race


async def _resolve_instance_key_conflict(
    db: Any, *, device_id: UUID, claim: InstanceClaim
) -> None:
    """Refuse or clear the way for a newcomer whose key an OPEN row already holds.

    Two LIVE sockets on one device reporting the same non-null key are a
    conflict — the runner documents that two processes that each believe
    themselves primary both report ``primary`` — and must never resolve as a
    silent overwrite. No time window can decide it: a genuinely live duplicate
    heartbeats every 30s, while the runner's own reconnect over a half-open
    socket can arrive with that socket's last frame as young as ~25s. So the
    holder is PROBED:

    * **Held by this process and answers the probe → refuse the newcomer**
      (:class:`InstanceKeyConflict`, close ``4409``). The incumbent keeps its
      row, pointer and relay socket; a second impostor retrying just keeps
      being refused — loud and stable, instead of two processes flapping the
      relay socket between them.
    * **Silent within ``_PROBE_TIMEOUT_S``, already closed, or not held by
      this process → close the holder's row and admit the newcomer.** A held
      socket that cannot answer is the runner's own abandoned connection; an
      open row this process does not hold is an orphan of a restart or an
      unclean close (the common case after every deploy) or lives on another
      replica, which cannot be probed from here. Refusing on an unprovable
      claim would lock runners out of their own reconnects; admitting is what
      the backend did before, now with a structured
      ``devices_ws_instance_key_superseded`` record. A held superseded socket
      is closed in the background.

    The DB transaction is ended before probing, so no pooled connection is
    held across the probe's wait.

    Legacy (NULL-key) sockets are outside this check, as they are outside the
    partial unique index that backs it.
    """
    if claim.key is None:
        return
    rows = await device_connection_crud.get_open_connections_with_key(
        db, device_id=device_id, instance_key=claim.key
    )
    # Plain values, read BEFORE the rollback below expires the ORM rows.
    holders = [(r.id, r.port, r.connected_at.isoformat()) for r in rows]
    await db.rollback()  # release the pooled connection before any probe wait
    if not holders:
        return

    for holder_pk, holder_port, holder_connected_at in holders:
        held = _LIVE_SOCKETS.get(holder_pk)
        if held is not None and await _probe_socket(held, device_id):
            logger.warning(
                "devices_ws_instance_key_conflict",
                device_id=str(device_id),
                instance_key=claim.key,
                instance_role=claim.role,
                holder_connection_pk=holder_pk,
                holder_port=holder_port,
                holder_connected_at=holder_connected_at,
                decision="refuse_newcomer",
                evidence="holder answered liveness probe",
                race=False,
            )
            raise InstanceKeyConflict(holder_pk, race=False)

    stale_pks = [pk for pk, _, _ in holders]
    closed = await device_connection_crud.close_connection_records(db, stale_pks)
    if not claim.is_primary:
        # A primary newcomer re-points the pointer in its own registration;
        # clearing it first would only open a window in which the device reads
        # relay-unroutable. A secondary newcomer may not (it claims only an
        # unheld pointer), so a pointer left on the superseded row must go.
        for pk in stale_pks:
            await device_crud.clear_ws_session_if_current(
                db, device_id=device_id, connection_pk=pk
            )
    held_closed: list[int] = []
    for pk in stale_pks:
        held = _LIVE_SOCKETS.pop(pk, None)
        if held is not None:
            held_closed.append(pk)
            _close_in_background(held, device_id=device_id, connection_pk=pk)
    logger.warning(
        "devices_ws_instance_key_superseded",
        device_id=str(device_id),
        instance_key=claim.key,
        instance_role=claim.role,
        superseded_connection_pks=stale_pks,
        closed_connection_pks=closed,
        held_sockets_closed=held_closed,
        decision="close_unverifiable_holder",
        reason=(
            "holder did not answer the liveness probe, or is not held by this "
            "process (orphaned, or on another replica)"
        ),
    )


async def _register_socket(
    db: Any,
    *,
    token_device_id: UUID,
    user_id: UUID,
    claim: InstanceClaim,
    name: str,
    hostname: str,
    port: int,
    capabilities: list[Any],
    os_name: str | None,
    os_version: str | None,
    client_ip: str | None,
    websocket: Any,
) -> tuple[UUID, int, bool]:
    """Upsert the device row, open this socket's connection row, settle the pointer.

    Returns ``(device_id, connection_pk, owns_pointer)``.

    * A PRIMARY always takes the device's relay pointer — ``ws_session_id``,
      ``ws_connected_at`` and the device row's runner fields including
      ``port`` — even from a secondary that held it.
    * A SECONDARY takes the pointer (and ``port``) ONLY when no live
      connection holds it (:func:`device_crud.claim_ws_session_if_unheld`), so
      a lone secondary does not leave the device relay-less and never
      displaces a live primary. It never rewrites ``name`` or the other
      primary fields.

    The caller registers the socket with the manager iff ``owns_pointer``.
    Raises :class:`InstanceKeyConflict` on a duplicate live key. On success
    the socket is in ``_LIVE_SOCKETS`` under the returned pk, and the caller
    owns removing it.
    """
    pending = (token_device_id, claim.key) if claim.key is not None else None
    if pending is not None and pending in _PENDING_KEYS:
        logger.warning(
            "devices_ws_instance_key_conflict",
            device_id=str(token_device_id),
            instance_key=claim.key,
            instance_role=claim.role,
            holder_connection_pk=None,
            decision="refuse_newcomer",
            race=True,
        )
        raise InstanceKeyConflict(None, race=True)
    if pending is not None:
        _PENDING_KEYS.add(pending)
    try:
        return await _register_socket_unguarded(
            db,
            token_device_id=token_device_id,
            user_id=user_id,
            claim=claim,
            name=name,
            hostname=hostname,
            port=port,
            capabilities=capabilities,
            os_name=os_name,
            os_version=os_version,
            client_ip=client_ip,
            websocket=websocket,
        )
    finally:
        if pending is not None:
            _PENDING_KEYS.discard(pending)


async def _register_socket_unguarded(
    db: Any,
    *,
    token_device_id: UUID,
    user_id: UUID,
    claim: InstanceClaim,
    name: str,
    hostname: str,
    port: int,
    capabilities: list[Any],
    os_name: str | None,
    os_version: str | None,
    client_ip: str | None,
    websocket: Any,
) -> tuple[UUID, int, bool]:
    """Body of :func:`_register_socket`, run under its pending-key guard."""
    await _resolve_instance_key_conflict(db, device_id=token_device_id, claim=claim)

    async def _upsert_primary_fields() -> Any:
        # Key the upsert on the JWT-asserted ``token_device_id`` (coord's
        # identity authority) rather than ``(user_id, name)``. This honors
        # the unified-devices contract: one ``coord.devices`` row per
        # physical device, identified by the machine.json UUID coord
        # assigned at pair time.
        return await device_crud.register_device(
            db,
            device_id=token_device_id,
            user_id=user_id,
            name=name,
            hostname=hostname,
            port=port,
            capabilities=list(capabilities),
            restate_enabled=False,
            restate_healthy=False,
            os=os_name,
            os_version=os_version,
        )

    # ORDER MATTERS: the connection row is inserted BEFORE a primary writes
    # the device row's runner fields, so the live-key index decides a
    # duplicate race first and a refused primary has written nothing. Only a
    # device row that does not exist yet (the FK parent) is created up front,
    # and creating it overwrites nothing.
    device_row = await device_crud.get_device(db, token_device_id)
    if device_row is None and claim.is_primary:
        device_row = await _upsert_primary_fields()
    elif device_row is None:
        device_row = await device_crud.ensure_device_for_secondary(
            db,
            device_id=token_device_id,
            user_id=user_id,
            name=name,
            hostname=hostname,
            capabilities=list(capabilities),
            os=os_name,
            os_version=os_version,
        )

    try:
        connection_record = await device_connection_crud.create_connection_record(
            db,
            device_id=device_row.device_id,
            user_id=user_id,
            ip_address=client_ip,
            instance_key=claim.key,
            instance_role=claim.role,
            port=port,
        )
    except IntegrityError as exc:
        # The partial unique index lost us a race: a concurrent handshake with
        # the same key committed between the check above and this insert. It
        # is live by construction (it just registered), so refuse. Any OTHER
        # integrity failure is not a duplicate and must not be reported as one.
        await db.rollback()
        if _LIVE_KEY_INDEX not in str(exc.orig if exc.orig is not None else exc):
            raise
        logger.warning(
            "devices_ws_instance_key_conflict",
            device_id=str(token_device_id),
            instance_key=claim.key,
            instance_role=claim.role,
            holder_connection_pk=None,
            decision="refuse_newcomer",
            race=True,
            error=str(exc.orig) if exc.orig is not None else str(exc),
        )
        raise InstanceKeyConflict(None, race=True) from exc

    # Plain values: the claim below may roll the session back, which expires
    # every ORM instance it holds.
    resolved_device_id: UUID = device_row.device_id
    resolved_pk: int = connection_record.id
    _LIVE_SOCKETS[resolved_pk] = websocket
    try:
        if claim.is_primary:
            connected_at = connection_record.connected_at
            await _upsert_primary_fields()
            # Mark the device as WS-connected by pointing at the open
            # connection. A primary always takes it — from a secondary too.
            # ``port`` is written AGAIN in this same statement: a secondary's
            # heartbeat claim can commit between the upsert above and this
            # write (the pointer was still unheld then), and it writes its own
            # port with its pointer. Writing the pair together means whichever
            # commits last leaves port and pointer describing the same socket.
            await device_crud.take_ws_session(
                db,
                device_id=resolved_device_id,
                connection_pk=resolved_pk,
                connected_at=connected_at,
                port=port,
            )
            owns = True
        else:
            owns = await device_crud.claim_ws_session_if_unheld(
                db,
                device_id=resolved_device_id,
                connection_pk=resolved_pk,
            )
    except BaseException:
        _LIVE_SOCKETS.pop(resolved_pk, None)
        raise

    return resolved_device_id, resolved_pk, owns


@router.websocket("/ws")
async def websocket_device_unified_endpoint(websocket: WebSocket) -> None:
    """Unified device-side WebSocket endpoint.

    URL: ``wss://{backend}/api/v1/devices/ws``
    Auth: ``Authorization: Bearer <coord-device-jwt>`` HEADER.
    """
    await websocket.accept()

    # ------------------------------------------------------------------
    # 1. Authenticate via coord-issued device-token JWT verified locally
    #    against coord's JWKS (1h cache).
    # ------------------------------------------------------------------
    auth_header = websocket.headers.get("authorization") or websocket.headers.get(
        "Authorization"
    )
    if not auth_header or not auth_header.lower().startswith("bearer "):
        # Fallback to ``?token=`` query string for browser-side WS clients.
        token = websocket.query_params.get("token")
    else:
        token = auth_header.split(" ", 1)[1].strip()

    if not token:
        await reject(websocket, "Missing device-token bearer.")
        return

    try:
        claims = await coord_jwks_client.verify_token(token)
    except CoordJWKSUnavailableError as exc:
        # Cold-start failure: coord unreachable. Reject all handshakes
        # rather than silently falling back to "trust the token".
        #
        # The runner records the close reason below as its `last_error`, and
        # that reason is deliberately vague, so THIS log line is the whole
        # diagnostic surface. Name the coord URL we actually dialled and the
        # concrete exception class of the underlying transport fault: a
        # ConnectTimeout to the wrong device coord and a ReadTimeout from a
        # genuinely slow coord are different incidents with different fixes,
        # and `error=str(exc)` alone has repeatedly failed to separate them.
        #
        # Name the SETTING too, derived rather than written out. This comment
        # used to say "the wrong COORD_DEVICE_URL", which is true on a split
        # box and false everywhere else — on a single-coord deployment the URL
        # dialled comes from COORD_URL and COORD_DEVICE_URL is unset, so a
        # reader sent to it would find nothing to correct. That is the same
        # drift the identity alarm below was repaired for; a hard-coded
        # setting name is right for one configuration only. The shared field
        # set carries it (``coord_url_setting``).
        logger.error("devices_ws_jwks_unavailable", **jwks_failure_log_fields(exc))
        # 1011 = internal error / service overload.
        await reject(
            websocket,
            "Device authentication temporarily unavailable.",
            code=status.WS_1011_INTERNAL_ERROR,
        )
        return
    except CoordTokenInvalidError as exc:
        # The message is what the runner records as `last_error`, so it is
        # the whole diagnostic surface for an operator reading runner logs.
        # Say which failure it actually was rather than the historical
        # catch-all, which claimed "invalid or expired" even for a token
        # that was neither.
        #
        # NOTE: `reject`'s second positional is `message`, not `reason`;
        # it becomes the close reason via `reject`'s own default. Passing
        # this as `reason=` instead would blank the error frame.
        message = describe_token_rejection(exc)
        logger.warning(
            "devices_ws_token_invalid",
            error=str(exc),
            failure=type(exc).__name__,
        )
        # A device WS handshake is terminal: nothing downstream reinterprets
        # this rejection, so a foreign-issuer arm here really is a
        # deployment-wiring bug and earns its own alarm. (The same arm is a
        # routine non-event in `memory`, which uses a rejection merely to
        # discriminate Cognito bearers — which is why this alarm lives at
        # the terminal callers and not inside `verify_token`.)
        if isinstance(exc, CoordTokenForeignIssuerError):
            logger.warning(
                "coord_identity_mismatch",
                coord_url=exc.coord_url,
                token_kid=exc.token_kid,
                served_kids=exc.served_kids,
                note=(
                    "runner presented a token minted by a different coord "
                    "than this backend verifies against"
                ),
                **identity_mismatch_remedy_fields(),
            )
        await reject(websocket, message)
        return

    # Coord-issued device-token claims:
    #   { sub: "device:<uuid>", device_id, user_id, scopes, jti, exp }
    raw_device_id = claims.get("device_id")
    raw_user_id = claims.get("user_id")
    if not raw_device_id or not raw_user_id:
        logger.warning(
            "devices_ws_token_missing_claims",
            has_device_id=bool(raw_device_id),
            has_user_id=bool(raw_user_id),
        )
        await reject(websocket, "Device token missing required claims.")
        return

    try:
        token_device_id = UUID(str(raw_device_id))
        user_id = UUID(str(raw_user_id))
    except (ValueError, TypeError) as exc:
        logger.warning("devices_ws_token_claim_format_invalid", error=str(exc))
        await reject(websocket, "Device token claim format invalid.")
        return

    # ------------------------------------------------------------------
    # 2. Wait for the runner_info message, upsert the coord.devices row,
    #    create a DeviceConnection, set ws_session_id, register with
    #    manager, publish ``runner_connected`` event.
    # ------------------------------------------------------------------
    try:
        info_msg = await asyncio.wait_for(websocket.receive_json(), timeout=15.0)
    except (TimeoutError, WebSocketDisconnect):
        logger.warning("devices_ws_runner_info_timeout", user_id=str(user_id))
        await safe_close(websocket, status.WS_1008_POLICY_VIOLATION)
        return
    except Exception as e:
        logger.error(
            "devices_ws_runner_info_failed", user_id=str(user_id), error=str(e)
        )
        await safe_close(websocket, status.WS_1011_INTERNAL_ERROR)
        return

    if not isinstance(info_msg, dict) or info_msg.get("type") != "runner_info":
        await reject(websocket, "First message must be of type 'runner_info'.")
        return

    name = info_msg.get("name") or info_msg.get("runner_name") or "Unnamed Device"
    hostname = info_msg.get("hostname") or "localhost"
    try:
        port = int(info_msg.get("port", 9876))
    except (TypeError, ValueError):
        port = -1
    if not 0 <= port <= 65535:
        logger.warning(
            "devices_ws_runner_info_port_invalid",
            device_id=str(token_device_id),
            port=str(info_msg.get("port"))[:32],
        )
        await reject(
            websocket,
            "Invalid runner_info: port must be 0-65535",
            code=_CLOSE_INVALID_RUNNER_INFO,
        )
        return
    os_name = info_msg.get("os")
    os_version = info_msg.get("os_version") or info_msg.get("osVersion")
    capabilities = info_msg.get("capabilities") or []

    # Client-asserted devenv block (plan 2026-08-05, decision 2):
    # ``{enrolled, machine_id, environment_id, instance_role}``. Parsed here and
    # handed, unmodified, to the auto-enrollment engine below — which is the
    # only reader, and which decides what (if anything) a hint may cause.
    #
    # The asymmetry this block lives under, stated once so it is not
    # re-litigated at the call site: a client hint may freely SUPPRESS
    # enrollment on its own behalf (``instance_role: "secondary"``, a local
    # kill switch), but may NEVER name the machine row, the environment or the
    # owner — those come from the verified JWT claims and the server's own
    # tables. It is kept as a plain dict rather than being unpacked into
    # trusted locals precisely so no later code can mistake it for a fact.
    raw_devenv_hint = info_msg.get("devenv")
    devenv_hint: dict[str, Any] | None = (
        raw_devenv_hint if isinstance(raw_devenv_hint, dict) else None
    )

    try:
        claim = parse_instance_claim(info_msg, devenv_hint)
    except InstanceClaimError as exc:
        logger.warning(
            "devices_ws_instance_claim_invalid",
            device_id=str(token_device_id),
            user_id=str(user_id),
            error=str(exc),
        )
        await reject(
            websocket, f"Invalid runner_info: {exc}", code=_CLOSE_INVALID_RUNNER_INFO
        )
        return

    client_ip = websocket.client.host if websocket.client else None

    device_id: UUID | None = None
    connection_pk: int | None = None
    try:
        async with AsyncSessionLocal() as db:
            device_id, connection_pk, owns = await _register_socket(
                db,
                token_device_id=token_device_id,
                user_id=user_id,
                claim=claim,
                name=name,
                hostname=hostname,
                port=port,
                capabilities=list(capabilities),
                os_name=os_name,
                os_version=os_version,
                client_ip=client_ip,
                websocket=websocket,
            )
    except InstanceKeyConflict as conflict:
        holder = (
            f"connection {conflict.holder_pk}"
            if conflict.holder_pk is not None
            else "a concurrent connection"
        )
        await reject(
            websocket,
            (
                f"Duplicate runner instance: instanceKey {claim.key!r} is already "
                f"connected on this device ({holder}). Two runner processes are "
                "reporting the same instance identity; stop one of them."
            ),
            code=_CLOSE_DUPLICATE_INSTANCE,
            reason="duplicate runner instanceKey already connected on this device",
        )
        return
    except Exception as e:
        logger.error(
            "devices_ws_register_failed",
            user_id=str(user_id),
            error=str(e),
            error_type=type(e).__name__,
        )
        await reject(
            websocket,
            "Internal error during registration.",
            code=status.WS_1011_INTERNAL_ERROR,
        )
        return

    # ------------------------------------------------------------------
    # 2b. Register with the Redis-backed runner WS manager and announce the
    #     connection. This block talks to Redis (``get_redis`` /
    #     ``get_runner_websocket_manager`` / ``manager.register`` /
    #     ``manager.publish_runner_connected``) and so can raise when Redis
    #     is unavailable or misconfigured (observed on prod api.qontinui.io).
    #     If we let that escape the handler the ASGI worker drops the socket
    #     abnormally (close code 1006, no frame), the ``connected`` ack is
    #     never sent, and the runner's /web-integration/status never flips
    #     to ws_connected:true. Mirror the graceful 1011 close used by the
    #     device-row registration block above, and — since the device row
    #     was already committed as WS-connected (ws_session_id /
    #     ws_connected_at) above — roll that marking back so a failed
    #     registration does not leave the device falsely reported connected.
    # ------------------------------------------------------------------
    # ``manager`` is pre-bound so the except-path rollback can reference it
    # safely even when ``get_redis()`` itself raises (Redis unavailable) before
    # the manager is resolved.
    #
    #     Only the POINTER OWNER registers and announces: the manager is keyed
    #     on ``device_id`` alone, so registering a non-owner secondary would
    #     replace the owner's relay socket, and ``runner_connected`` for it
    #     would announce a device that did not connect. A non-owner still
    #     resolves the manager, because it may claim an unheld pointer later
    #     (see :func:`_handle_non_owner_heartbeat`).
    # ------------------------------------------------------------------
    manager: Any = None
    try:
        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)
        if owns and not claim.is_primary:
            # A secondary's claim was a DB write; the manager registration is
            # a second step a primary may win in between. Register only if no
            # other socket holds the device and the pointer still names us —
            # both re-checked under the manager's per-device lock — and hand
            # the claim back otherwise.
            owns = await _register_claimed_secondary(
                manager,
                device_id=device_id,
                user_id=user_id,
                connection_pk=connection_pk,
                websocket=websocket,
                runner_name=name,
                ip_address=client_ip,
            )
        elif owns:
            await manager.register(
                runner_id=device_id,
                websocket=websocket,
                user_id=user_id,
                runner_name=name,
                ip_address=client_ip,
                connected_at=utc_now().isoformat(),
            )
        if owns:
            await manager.publish_runner_connected(
                runner_id=device_id,
                user_id=user_id,
                runner_name=name,
                connected_at=utc_now().isoformat(),
                ip_address=client_ip,
            )
    except Exception as e:
        logger.error(
            "devices_ws_register_failed",
            device_id=str(device_id) if device_id else None,
            user_id=str(user_id),
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )
        _LIVE_SOCKETS.pop(connection_pk, None)
        # Tear down any manager-side registration. ``register`` rolls back its
        # OWN partial state, but if it fully succeeded and the subsequent
        # ``publish_runner_connected`` raised, the relay listeners are already
        # running and each holds a dedicated Redis pubsub connection. Without
        # this unregister those listeners (and their connections) would leak —
        # the same pool-exhaustion class as the register failure itself.
        # ``unregister`` is idempotent and tolerates an unknown/never-registered
        # device_id, so it is safe to call regardless of where the failure hit.
        if manager is not None and owns:
            try:
                await manager.unregister_if_current(device_id, websocket, user_id)
            except Exception as unregister_err:
                logger.error(
                    "devices_ws_register_failed_unregister_failed",
                    device_id=str(device_id) if device_id else None,
                    error=str(unregister_err),
                )
        # Roll back the WS-connected marking committed above so consumers of
        # GET /api/v1/devices don't see a false wsConnected:true for a device
        # whose registration never completed. Only clear if the row still
        # points at OUR connection (mirror _cleanup's superseded-session
        # guard), and close the connection record. The compare lives in the
        # UPDATE's WHERE clause so a reconnect that registered while we were
        # failing cannot have its live pointer stomped by our rollback.
        try:
            if device_id is not None and connection_pk is not None:
                async with AsyncSessionLocal() as db:
                    await device_crud.clear_ws_session_if_current(
                        db, device_id=device_id, connection_pk=connection_pk
                    )
        except Exception as rollback_err:
            logger.error(
                "devices_ws_register_failed_rollback_failed",
                device_id=str(device_id) if device_id else None,
                error=str(rollback_err),
            )
        if connection_pk is not None:
            try:
                async with AsyncSessionLocal() as db:
                    await device_connection_crud.close_connection_record(
                        db, connection_pk
                    )
            except Exception as close_err:
                logger.error(
                    "devices_ws_register_failed_close_connection_failed",
                    connection_pk=connection_pk,
                    error=str(close_err),
                )
        await reject(
            websocket,
            "Internal error during registration.",
            code=status.WS_1011_INTERNAL_ERROR,
        )
        return

    # ------------------------------------------------------------------
    # 3. Send the ``connected`` ack, then run the main message loop.
    #
    #    The ack is a raw ``send_json`` (NOT routed through
    #    ``_safe_send_json``) because a failed handshake ack is a real error
    #    worth surfacing rather than swallowing — silently proceeding into
    #    ``receive_json`` on a dead socket would only defer the failure.
    #    Critically, the ack lives INSIDE this ``try`` so its
    #    ``finally: _cleanup`` owns it: registration has already committed
    #    above (``manager.register`` ran, holding relay pubsub connections;
    #    ``connection_pk`` / ``ws_session_id`` are written). If a runner
    #    disconnects in the window between that commit and this ack, the send
    #    raises ``WebSocketDisconnect`` (caught below → ``_cleanup``) or
    #    ``RuntimeError`` (caught by the generic handler → logged loudly →
    #    ``_cleanup``). Either way cleanup runs, so the manager registration,
    #    its three relay listeners (each holding a dedicated pooled Redis
    #    connection), and the device row's ``ws_session_id`` are reclaimed
    #    instead of leaking with a false ``wsConnected: true``.
    # ------------------------------------------------------------------
    try:
        await websocket.send_json(
            {
                "type": "connected",
                "device_id": str(device_id),
                "user_id": str(user_id),
                "instance_key": claim.key,
                "instance_role": claim.role,
                "timestamp": utc_now().isoformat(),
            }
        )

        logger.info(
            "devices_ws_connected",
            device_id=str(device_id),
            user_id=str(user_id),
            name=name,
            instance_key=claim.key,
            instance_role=claim.role,
            port=port,
            connection_pk=connection_pk,
            owns_pointer=owns,
        )

        # ----------------------------------------------------------------
        # Auto-enrollment decision engine (plan 2026-08-05, Phase 4).
        #
        # Scheduled AFTER the ``connected`` ack is on the wire and never
        # awaited: the handshake must not wait on a DB round trip, and the
        # engine's own wrapper swallows every failure. Deliberately NOT the
        # rollback-and-close posture of the Redis block above — a device that
        # could not be auto-enrolled has lost a convenience; a device whose
        # socket was dropped has lost its connection to the fleet.
        #
        # It is flagged off by default (``DEVENV_AUTO_ENROLL_ENABLED``), in
        # which case this costs one attribute read inside the task.
        # ----------------------------------------------------------------
        # Primary only: the machine is the primary's to enroll.
        if claim.is_primary:
            devenv_auto_enroll.schedule_auto_enroll(
                device_id, user_id, devenv_hint, manager
            )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)
            except TimeoutError:
                # Idle keepalive — let the underlying TCP stack handle it.
                try:
                    await websocket.send_json(
                        {"type": "ping", "timestamp": utc_now().isoformat()}
                    )
                except BENIGN_SEND_EXCEPTIONS:
                    break
                continue

            if not isinstance(data, dict):
                continue

            if _consume_probe_reply(data):
                continue
            await _route_device_message(
                data,
                device_id,
                user_id,
                manager,
                connection_pk,
                websocket,
                instance_role=claim.role,
            )

    except BENIGN_SEND_EXCEPTIONS:
        logger.info("devices_ws_disconnected", device_id=str(device_id))
    except Exception as e:
        logger.error(
            "devices_ws_loop_error",
            device_id=str(device_id),
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        await _cleanup(
            device_id,
            connection_pk,
            user_id,
            manager,
            websocket,
            instance_role=claim.role,
        )


async def _route_device_message(
    msg: dict[str, Any],
    device_id: Any,
    user_id: Any,
    manager: Any,
    connection_pk: int | None = None,
    websocket: Any = None,
    *,
    instance_role: str = _ROLE_PRIMARY,
) -> None:
    """Dispatch a single inbound message from the device.

    ``connection_pk`` identifies the ``coord.device_connections`` row for
    THIS socket; the heartbeat handler uses it to re-assert the device's
    WS-presence pointer (see :func:`_handle_heartbeat`). It is optional so
    existing callers/tests that only route non-heartbeat traffic keep
    working unchanged.

    ``instance_role`` is the role the socket was REGISTERED under (see
    :class:`InstanceClaim`). A SECONDARY that does not currently own the
    device's relay pointer (the manager holds another socket, or none) is not
    the device's relay socket, so only its heartbeat and ping arms run; every
    other frame is dropped rather than relayed as the device's, because every
    consumer below addresses the device — i.e. its pointer owner — and would
    misattribute a non-owner's status or replies. A secondary that DOES own
    the pointer (it claimed an unheld one) is the device's relay socket and is
    routed like a primary.
    """
    msg_type = msg.get("type")

    owns_pointer = (
        manager is not None
        and websocket is not None
        and manager.get_websocket(device_id) is websocket
    )
    if instance_role == _ROLE_SECONDARY and not owns_pointer:
        if msg_type == "heartbeat":
            await _handle_non_owner_heartbeat(
                device_id, user_id, manager, connection_pk, websocket
            )
        elif msg_type == "ping" and websocket is not None:
            try:
                await websocket.send_json(
                    {"type": "pong", "timestamp": utc_now().isoformat()}
                )
            except BENIGN_SEND_EXCEPTIONS:
                pass
        else:
            logger.debug(
                "devices_ws_secondary_frame_dropped",
                device_id=str(device_id),
                connection_pk=connection_pk,
                msg_type=msg_type,
            )
        return

    if msg_type == "ping":
        ws = manager.get_websocket(device_id)
        if ws:
            try:
                await ws.send_json({"type": "pong", "timestamp": utc_now().isoformat()})
            except BENIGN_SEND_EXCEPTIONS:
                pass
        return

    if msg_type == "heartbeat":
        await _handle_heartbeat(msg, device_id, manager, connection_pk, websocket)
        return

    # Remote-terminal origination door (plan 2026-08-31-remote-session-tabs-
    # in-runner-terminal, Phase 3b / D6). This device is the SOURCE: it
    # presents a coord-minted attach grant and the relay — after verifying it
    # against the same JWKS that admitted this socket — forwards to the TARGET
    # device with a ``remote`` block. Refusals are typed ``error`` frames and
    # forward nothing. Every other frame on this socket is untouched.
    # The relay answers every failure it knows about as a typed ``error``
    # on this socket; this guard is for the ones it does not, because an
    # exception here would end the loop above and tear the SOURCE device's
    # whole socket down over one remote frame.
    if remote_terminal_relay.is_source_frame(msg_type):
        try:
            await remote_terminal_relay.handle_source_frame(
                msg, device_id, manager, websocket
            )
        except Exception as e:
            logger.error(
                "devices_ws_remote_terminal_source_frame_failed",
                device_id=str(device_id),
                msg_type=msg_type,
                error=str(e),
                error_type=type(e).__name__,
            )
        return

    # This device is a TARGET answering a remote attach: ``terminal_attached``
    # (new with D6), refusals correlated by ``remote`` / ``grant_jti`` rather
    # than ``request_id``, and refusals the target typed
    # ``remote_terminal_error``. Only the remote path consumes these, so they
    # ride a remote-only channel and the mobile watchers below see exactly the
    # frames they saw before.
    #
    # That third kind is the one this arm used to miss, and missing it was
    # silent: qontinui-runner's ``AttachRefusal::SessionNotLocal`` spells its
    # refusal ``remote_terminal_error`` where every other target refusal
    # spells it ``error``, so the frame matched no arm here — not the source
    # arm above, not this one, not the mobile terminal-RPC arm below — and
    # died at ``devices_ws_unhandled_message``. One refusal class, unreachable
    # by the source under any conditions. It is a LATENT gap and no observed
    # attach failure is attributed to it; see ``TARGET_REFUSAL_FRAME_TYPES``,
    # which owns which types those are. This arm must not grow a second,
    # drifting copy of that list.
    #
    # Publishing it is NOT forwarding it: the relay rebuilds every refusal
    # payload and namespaces the target's ``code``, so a target typing its
    # frame ``remote_terminal_error`` buys no authority to spell a RELAY code.
    if remote_terminal_relay.is_remote_only_target_frame(msg):
        try:
            await remote_terminal_relay.publish_target_frame(device_id, msg)
        except Exception as e:
            logger.error(
                "devices_ws_remote_terminal_publish_failed",
                device_id=str(device_id),
                msg_type=msg_type,
                error=str(e),
                error_type=type(e).__name__,
            )
        return

    if msg_type in {
        "phase_completed",
        "ui_error",
        "recent_crash",
        "dispatch_ack",
    }:
        # Status-style events go to subscribed frontends.
        await manager.send_response_to_frontends(device_id, msg)
        return

    if msg_type == "command_response":
        await manager.send_response_to_frontends(device_id, msg)
        return

    if msg_type == "chat_response":
        await manager.send_chat_response_to_mobiles(device_id, msg)
        return

    if msg_type == "terminal_response":
        await manager.send_terminal_response_to_mobiles(device_id, msg)
        return

    if msg_type in {"terminal_output", "terminal_exit"}:
        if msg_type == "terminal_output":
            data = msg.get("data")
            if isinstance(data, str) and len(data) > _TERMINAL_FRAME_LIMIT:
                dropped = len(data) - _TERMINAL_FRAME_LIMIT
                truncated = (
                    data[:_TERMINAL_FRAME_LIMIT]
                    + f"\n[...truncated {dropped} bytes...]"
                )
                msg = {**msg, "data": truncated}
        await manager.send_terminal_response_to_mobiles(device_id, msg)
        return

    # Runner-emitted reply types for mobile terminal request/response RPCs.
    # The runner's `mcp/backend_relay.rs::handle_terminal_*` handlers produce
    # these in reply to `terminal_list` / `terminal_create` / `terminal_close`
    # / `terminal_buffer` over the device WS. Without this branch the responses
    # fell through to `devices_ws_unhandled_message` and were silently dropped,
    # so the mobile `RemoteTerminalClient.sendRequest` always timed out — the
    # exact bug the iter-3 mobile WS URL rename surfaced. Errors that carry a
    # `request_id` are correlated terminal-RPC failures (e.g. unknown
    # terminal_id) and must reach the mobile so `pendingRequests` can reject
    # promptly rather than spinning until the 10s timeout.
    if msg_type in {
        "terminal_sessions",
        "terminal_created",
        "terminal_closed",
        "terminal_buffer_response",
    } or (msg_type == "error" and msg.get("request_id") is not None):
        await manager.send_terminal_response_to_mobiles(device_id, msg)
        return

    # Reply to a ``devenv_enroll`` directive sent down this socket
    # (``runner_websocket_manager.send_devenv_enroll``). The runner's
    # ``mcp/backend_relay.rs::handle_relay_command`` produces it and the relay
    # writes it straight back here.
    #
    # This arm MUST stay above the fall-through below. That fall-through is a
    # closed set: an unrecognised type is logged at DEBUG and discarded, which
    # is the exact failure the terminal-RPC comment above records shipping
    # once already. For devenv enrollment the consequence is worse than a
    # dropped log line — the ack is the ONLY evidence that an enroll directive
    # reached the box, so without this arm an auto-enrollment feature whose
    # entire purpose is to stop failures from being silent would itself fail
    # silently. Logged at INFO, not DEBUG, for the same reason.
    if msg_type == "devenv_enroll_ack":
        ok = msg.get("ok")
        logger.info(
            "devices_ws_devenv_enroll_ack",
            device_id=str(device_id),
            machine_id=msg.get("machine_id"),
            ok=ok,
            # Only present on the failure arm; the runner never panics the
            # relay, it reports the reason instead.
            reason=msg.get("reason") if ok is not True else None,
        )
        return

    logger.debug(
        "devices_ws_unhandled_message",
        device_id=str(device_id),
        msg_type=msg_type,
    )


def _validated_ui_thread(raw: Any, device_id: UUID) -> dict[str, Any] | None:
    """The heartbeat's ``ui_thread`` block, normalised for storage, or None."""
    if raw is None:
        return None
    try:
        return RunnerUiThread.model_validate(raw).model_dump(mode="json")
    except ValidationError as e:
        logger.warning(
            "devices_ws_heartbeat_ui_thread_invalid",
            device_id=str(device_id),
            error_count=e.error_count(),
        )
        return None


async def _handle_heartbeat(
    msg: dict[str, Any],
    device_id: Any,
    manager: Any,
    connection_pk: int | None = None,
    websocket: Any = None,
) -> None:
    """Persist a device heartbeat over WS, heal WS presence, refresh Redis TTL.

    The heartbeat is the system's only *recurring* proof that this socket is
    open, which makes it the only place a lost WS-presence pointer can heal.
    Registration is otherwise the sole writer of ``ws_session_id``, so a
    pointer NULLed while the socket stayed up stuck that way forever: the
    runner kept heartbeating, ``last_heartbeat`` stayed fresh, and
    ``_runner_proxy_relay`` — which gates the mobile cloud relay on
    ``ws_session_id IS NOT NULL`` — kept returning 503 "runner not
    connected". Re-asserting the pointer here bounds that outage to one
    heartbeat interval (~30s) no matter what wiped it: the teardown race
    closed by :func:`device_crud.clear_ws_session_if_current`, the scheduled
    ``connection_cleanup`` sweep firing on a momentary Redis presence miss, a
    backend restart or failover, or an unclean close whose ``finally`` never
    ran.

    The claim is skipped when ``connection_pk`` is unknown, and is a no-op
    write-wise in the steady state (see
    :func:`device_crud.claim_ws_session`), so the common path costs one
    UPDATE that matches no rows.

    **The heal is gated on the manager still holding THIS socket**, and that
    gate is load-bearing rather than defensive. ``ws_session_id`` is the ONLY
    thing ``_runner_proxy_relay`` consults — it is the sole 503 emitter on
    that path, because ``dispatch_and_wait(require_local_connection=False)``
    publishes over Redis pub/sub and cannot itself detect a missing runner.
    So a pointer asserted for a device the manager has forgotten does not
    restore the relay; it removes the fast, accurate
    ``503 "runner not connected"`` and replaces it with a full-timeout hang,
    while ``_derive_status`` goes back to reporting ``healthy`` and the
    relay-unroutable signal stops firing. Healing a pointer we cannot
    actually route through would trade an honest failure for a slow silent
    one. ``manager.get_websocket`` is an in-process registry lookup, which is
    exactly the right scope: the socket lives on one replica, and this
    handler runs on that replica.
    """
    ui_error = msg.get("ui_error")
    recent_crash = msg.get("recent_crash")
    derived_status = msg.get("derived_status")
    # Native UI-thread liveness (plan
    # ``2026-09-09-the-runner-ui-thread-liveness-block-is-emitted-to-three-sinks-and-read-by-none``).
    # Read by its snake_case name like the three keys above, and stored only
    # after it validates as ``RunnerUiThread`` — which also applies that
    # model's bounds on untrusted extras — so the column never holds a block
    # the fleet read cannot parse. Anything else stores None (UNKNOWN).
    ui_thread = _validated_ui_thread(msg.get("ui_thread"), device_id)

    # One session for every write. This is the hottest path in the file —
    # every device, every ~30s — and registration failures here have already
    # been observed as connection-pool exhaustion, so it must not take two
    # sessions to do its UPDATEs.
    async with AsyncSessionLocal() as db:
        # This socket's own row first. If it was closed under a socket that is
        # still heartbeating (the sweep, a supersede on another replica), this
        # socket is no longer a registered connection: it must write no
        # device state and heal no pointer onto a closed row — it is closed so
        # the runner reconnects and registers a fresh row.
        if connection_pk is not None and not await _touch_own_row(
            db, device_id, connection_pk
        ):
            await _close_rowless_socket(websocket, device_id, connection_pk)
            return
        try:
            await device_crud.heartbeat_device(
                db,
                device_id=device_id,
                restate_healthy=bool(msg.get("restate_healthy", False)),
                status_value=str(msg.get("status", "healthy")),
                derived_status=derived_status,
                ui_error=ui_error,
                recent_crash=recent_crash,
                ui_thread=ui_thread,
            )
        except Exception as e:
            logger.error(
                "devices_ws_heartbeat_persist_failed",
                device_id=str(device_id),
                error=str(e),
            )
            # Leave the session usable for the heal below.
            try:
                await db.rollback()
            except Exception:
                pass

        # Heal the WS-presence pointer. Separate try so a failure here does
        # not cost us the heartbeat persisted above, and vice versa.
        if (
            device_id is not None
            and connection_pk is not None
            and websocket is not None
            and manager.get_websocket(device_id) is websocket
        ):
            try:
                healed = await device_crud.claim_ws_session(
                    db, device_id=device_id, connection_pk=connection_pk
                )
                if healed:
                    logger.warning(
                        "devices_ws_heartbeat_healed_ws_session_id",
                        device_id=str(device_id),
                        connection_pk=connection_pk,
                    )
            except Exception as e:
                logger.error(
                    "devices_ws_heartbeat_heal_ws_session_failed",
                    device_id=str(device_id),
                    connection_pk=connection_pk,
                    error=str(e),
                )

    try:
        # A False here means the manager's Redis presence keys are GONE (they
        # carry a TTL and ``expire`` cannot recreate a deleted key), i.e. this
        # replica's registration has been swept out from under a socket that
        # is still open. Log it: that state makes the device unroutable in a
        # way only a reconnect fixes, and it was invisible before.
        if not await manager.refresh_ttl(device_id) and websocket is not None:
            logger.warning(
                "devices_ws_heartbeat_presence_keys_missing",
                device_id=str(device_id),
                connection_pk=connection_pk,
            )
    except Exception:
        pass


async def _touch_own_row(db: Any, device_id: Any, connection_pk: int) -> bool:
    """Stamp this socket's row. ``False`` only when it is measurably closed.

    A failed write is UNKNOWN, not "closed", and returns ``True`` — closing a
    live socket over a transient DB error would be worse than one missed stamp.
    """
    try:
        return await device_connection_crud.touch_connection(db, connection_pk)
    except Exception as e:
        logger.error(
            "devices_ws_heartbeat_touch_failed",
            device_id=str(device_id),
            connection_pk=connection_pk,
            error=str(e),
        )
        try:
            await db.rollback()
        except Exception:
            pass
        return True


async def _close_rowless_socket(
    websocket: Any, device_id: Any, connection_pk: int | None
) -> None:
    """Close a socket whose connection row was closed under it (it reconnects)."""
    logger.warning(
        "devices_ws_row_closed_under_live_socket",
        device_id=str(device_id),
        connection_pk=connection_pk,
    )
    if websocket is not None:
        await safe_close(
            websocket,
            status.WS_1012_SERVICE_RESTART,
            reason="connection row closed; reconnect",
        )


async def _register_claimed_secondary(
    manager: Any,
    *,
    device_id: Any,
    user_id: Any,
    connection_pk: int,
    websocket: Any,
    runner_name: str | None = None,
    ip_address: str | None = None,
) -> bool:
    """Register a secondary that just claimed the DB pointer — only if it still may.

    ``manager.register_if_unowned`` refuses under its per-device lock when a
    different socket is registered, and re-reads the DB pointer (must still
    name ``connection_pk``) before registering. A primary that registered in
    between therefore wins in BOTH stores. On refusal the claim is handed
    back with the atomic compare-and-clear, which is a no-op if a primary has
    already re-pointed it. Returns ``True`` iff registered.
    """

    async def _still_entitled() -> bool:
        async with AsyncSessionLocal() as db:
            return await device_crud.pointer_names(
                db, device_id=device_id, connection_pk=connection_pk
            )

    registered = bool(
        await manager.register_if_unowned(
            runner_id=device_id,
            websocket=websocket,
            user_id=user_id,
            still_entitled=_still_entitled,
            runner_name=runner_name,
            ip_address=ip_address,
            connected_at=utc_now().isoformat(),
        )
    )
    if not registered:
        logger.info(
            "devices_ws_secondary_claim_yielded",
            device_id=str(device_id),
            connection_pk=connection_pk,
            reason="another socket registered, or the pointer moved, first",
        )
        async with AsyncSessionLocal() as db:
            await device_crud.clear_ws_session_if_current(
                db, device_id=device_id, connection_pk=connection_pk
            )
    return registered


async def _handle_non_owner_heartbeat(
    device_id: Any,
    user_id: Any,
    manager: Any,
    connection_pk: int | None,
    websocket: Any,
) -> None:
    """Heartbeat from a SECONDARY that does not own the device's relay pointer.

    Deliberately NOT :func:`_handle_heartbeat`: that writes the DEVICE row's
    ``last_heartbeat`` / ``derived_status`` / ``ui_error`` / ``recent_crash``
    — the pointer owner's state — and its heal claims the pointer when it is
    NULL *or older*, which a secondary (usually newer than the primary) would
    use to displace a live primary.

    It stamps its own row (closing the socket if the row was closed under it),
    then claims the pointer ONLY if nobody live holds it
    (:func:`device_crud.claim_ws_session_if_unheld`) — the recovery path for a
    lone secondary whose device lost its owner — and on a claim registers with
    the manager, becoming the device's relay socket.
    """
    if connection_pk is None:
        return
    claimed = False
    async with AsyncSessionLocal() as db:
        if not await _touch_own_row(db, device_id, connection_pk):
            await _close_rowless_socket(websocket, device_id, connection_pk)
            return
        if manager is None or websocket is None:
            return
        try:
            claimed = await device_crud.claim_ws_session_if_unheld(
                db, device_id=device_id, connection_pk=connection_pk
            )
        except Exception as e:
            logger.error(
                "devices_ws_secondary_claim_failed",
                device_id=str(device_id),
                connection_pk=connection_pk,
                error=str(e),
            )
            return
    if not claimed:
        return
    logger.warning(
        "devices_ws_secondary_claimed_unheld_pointer",
        device_id=str(device_id),
        connection_pk=connection_pk,
    )
    try:
        if not await _register_claimed_secondary(
            manager,
            device_id=device_id,
            user_id=user_id,
            connection_pk=connection_pk,
            websocket=websocket,
        ):
            return
        await manager.publish_runner_connected(
            runner_id=device_id,
            user_id=user_id,
            runner_name=None,
            connected_at=utc_now().isoformat(),
        )
    except Exception as e:
        logger.error(
            "devices_ws_secondary_claim_register_failed",
            device_id=str(device_id),
            connection_pk=connection_pk,
            error=str(e),
        )
        try:
            async with AsyncSessionLocal() as db:
                await device_crud.clear_ws_session_if_current(
                    db, device_id=device_id, connection_pk=connection_pk
                )
        except Exception:
            pass


async def _cleanup(
    device_id: Any,
    connection_pk: int | None,
    user_id: Any,
    manager: Any,
    websocket: Any = None,
    *,
    instance_role: str = _ROLE_PRIMARY,
) -> None:
    """Tear down THIS connection's traces — and only this connection's.

    Role-agnostic on purpose: what a socket tears down is decided by what it
    OWNS at teardown time, not by its role. A secondary that never owned the
    pointer finds itself not registered and not pointed at, so every guarded
    step below is a no-op for it and only its own row is closed; a secondary
    that claimed an unheld pointer tears down exactly like the owner it is.
    ``instance_role`` is only logged.

    A device's WS presence lives in TWO stores, and a superseded teardown can
    corrupt either: the ``coord.devices.ws_session_id`` pointer (guarded by
    the atomic compare in :func:`device_crud.clear_ws_session_if_current`
    below) and the runner WS manager's registration. ``manager.unregister``
    is keyed on ``device_id`` ALONE — it cannot tell one connection from
    another — and it cancels the shared inbound pub/sub listener. So in the
    A-connects / B-reconnects / A-tears-down interleave, an unguarded
    unregister here destroys the listener belonging to B's LIVE socket.

    Guarding only the database half would have produced a subtler outage than
    the one being fixed: the pointer would correctly stay on B, the relay
    gate (which reads only that pointer) would pass, and the dispatch would
    then publish to a channel with no subscriber and hang until timeout —
    while ``GET /api/v1/devices`` reported ``healthy``. So both stores get
    the same "is it still ours?" predicate, from one identity check.
    """
    if connection_pk is not None:
        _LIVE_SOCKETS.pop(connection_pk, None)

    # Remote-terminal attachments this socket originated (SOURCE role) are
    # keyed on the socket object, so this is per-connection by construction:
    # detach on every target, drop the Redis registry rows, cancel the return-
    # route listeners (each holds a pooled pubsub connection — the same leak
    # class the unregister below guards). A socket that never attached is a
    # no-op here.
    if websocket is not None:
        try:
            await remote_terminal_relay.release_source(websocket)
        except Exception as e:
            logger.error(
                "devices_ws_remote_terminal_release_failed",
                device_id=str(device_id) if device_id else None,
                error=str(e),
            )

    # "Is it still ours?" is decided INSIDE the manager, under its per-device
    # registration lock, together with the teardown itself
    # (``unregister_if_current``). Deciding it here and then awaiting — the
    # release above, or unregister's own Redis round trips — let a newer
    # socket register in between and be torn down by this older socket's
    # teardown: its registry entry and inbound listener gone while its row
    # and pointer said "connected".
    unregistered = False
    if manager is not None:
        try:
            if websocket is None:
                await manager.unregister(device_id, user_id)
                unregistered = True
            else:
                unregistered = await manager.unregister_if_current(
                    device_id, websocket, user_id
                )
        except Exception as e:
            logger.error(
                "devices_ws_unregister_failed",
                device_id=str(device_id) if device_id else None,
                error=str(e),
            )
        if not unregistered:
            logger.info(
                "devices_ws_skip_unregister_superseded",
                device_id=str(device_id) if device_id else None,
                our_connection_pk=connection_pk,
                instance_role=instance_role,
            )

    try:
        # Only clear ws_session_id if it still points at OUR connection, and
        # do the comparing INSIDE the UPDATE so the database serializes it
        # against a concurrent registration.
        #
        # If the runner reconnected (creating a newer DeviceConnection row and
        # overwriting ws_session_id) before this handler ran, blindly setting
        # it to None here stomps the live session and gives every consumer of
        # GET /api/v1/devices a false `wsConnected: false` until the runner's
        # next reconnect cycle — observed 2026-05-22 as a runner/backend
        # wsConnected mismatch with fresh heartbeats arriving from a session
        # whose ws_session_id pointer had been wiped by an older finally block.
        #
        # The guard used to be a read-modify-write in Python: `get_device`,
        # compare in the interpreter, assign None, commit. That is a
        # lost-update race, not a guard — under READ COMMITTED connection A
        # can read the row while the pointer is still A's, connection B can
        # then commit its registration (pointer -> B), and A then commits the
        # NULL it decided on from data that is no longer true. B's socket is
        # live and nothing re-points at it, so the device is permanently
        # unroutable for the mobile cloud relay. Observed 2026-08-27 on prod
        # as a ~2h `wsConnected:false` + 30s-fresh-heartbeat contradiction.
        if device_id is not None and connection_pk is not None:
            async with AsyncSessionLocal() as db:
                cleared = await device_crud.clear_ws_session_if_current(
                    db, device_id=device_id, connection_pk=connection_pk
                )
                if not cleared:
                    # Read back WHO holds it. On a live incident that field is
                    # the whole diagnostic, and this branch is cold — it only
                    # runs when the pointer was already NULL or superseded.
                    row = await device_crud.get_device(db, device_id)
                    logger.info(
                        "devices_ws_skip_clear_session_id_superseded",
                        device_id=str(device_id),
                        our_connection_pk=connection_pk,
                        current_session_id=(
                            row.ws_session_id if row is not None else None
                        ),
                        device_row_missing=row is None,
                    )
    except Exception as e:
        logger.error(
            "devices_ws_clear_session_id_failed",
            device_id=str(device_id) if device_id else None,
            error=str(e),
        )

    if connection_pk is not None:
        try:
            async with AsyncSessionLocal() as db:
                await device_connection_crud.close_connection_record(db, connection_pk)
        except Exception as e:
            logger.error(
                "devices_ws_close_connection_failed",
                connection_pk=connection_pk,
                error=str(e),
            )

    # Same predicate as the unregister above: announcing "runner disconnected"
    # for a device whose replacement socket is already live would tell every
    # mobile and frontend client the device is gone while it is serving.
    #
    # Re-checked with NO await between the check and the publish's first
    # step: a replacement that registered after our unregister must not be
    # announced as gone.
    if (
        unregistered
        and manager is not None
        and manager.get_websocket(device_id) is None
    ):
        try:
            await manager.publish_runner_disconnected(device_id, user_id)
        except Exception as e:
            logger.error(
                "devices_ws_publish_disconnect_failed",
                device_id=str(device_id) if device_id else None,
                error=str(e),
            )

    # `json` import-loaded for symmetry with future relay paths
    _ = json
