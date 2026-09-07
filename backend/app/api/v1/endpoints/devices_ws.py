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

Outbound messages (sent by other components via the manager):
  - ``connected``    — handshake ack with the resolved ``device_id``.
  - ``dispatch``     — workflow dispatch from web/mobile.
  - ``command`` / ``chat_*`` / ``terminal_*`` — relays from web/mobile.
  - ``error``        — handshake / per-message errors.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from qontinui_schemas.common import utc_now

from app.config.redis_config import get_redis
from app.core.config import coord_device_setting_name
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.db.session import AsyncSessionLocal
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenForeignIssuerError,
    CoordTokenInvalidError,
    coord_jwks_client,
    describe_token_rejection,
    identity_mismatch_remedy_fields,
)
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
        # setting name is right for one configuration only.
        logger.error(
            "devices_ws_jwks_unavailable",
            error=str(exc),
            failure=type(exc).__name__,
            cause=type(exc.__cause__).__name__ if exc.__cause__ else None,
            coord_url=coord_jwks_client.coord_url,
            coord_url_setting=coord_device_setting_name(),
        )
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
    port = int(info_msg.get("port", 9876))
    os_name = info_msg.get("os")
    os_version = info_msg.get("os_version") or info_msg.get("osVersion")
    capabilities = info_msg.get("capabilities") or []

    client_ip = websocket.client.host if websocket.client else None

    device_id: UUID | None = None
    connection_pk: int | None = None
    try:
        async with AsyncSessionLocal() as db:
            # Key the upsert on the JWT-asserted ``token_device_id``
            # (coord's identity authority) rather than ``(user_id, name)``.
            # This honors the unified-devices contract: one
            # ``coord.devices`` row per physical device, identified by
            # the machine.json UUID coord assigned at pair time. Prior
            # to this change the upsert was keyed on ``(user_id, name)``
            # and ``register_device`` ignored the JWT's ``device_id``
            # entirely, so every temp runner spawn / re-named pair flow
            # created a fresh row with a web-generated UUID — orphaning
            # coord's pair-time row.
            device_row = await device_crud.register_device(
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

            connection_record = await device_connection_crud.create_connection_record(
                db,
                device_id=device_row.device_id,
                user_id=user_id,
                ip_address=client_ip,
            )

            # Mark the device as WS-connected by pointing at the open
            # connection.
            device_row.ws_session_id = connection_record.id
            device_row.ws_connected_at = connection_record.connected_at
            await db.commit()

            device_id = device_row.device_id
            connection_pk = connection_record.id
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
    manager: Any = None
    try:
        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)
        await manager.register(
            runner_id=device_id,
            websocket=websocket,
            user_id=user_id,
            runner_name=name,
            ip_address=client_ip,
            connected_at=utc_now().isoformat(),
        )

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
        # Tear down any manager-side registration. ``register`` rolls back its
        # OWN partial state, but if it fully succeeded and the subsequent
        # ``publish_runner_connected`` raised, the relay listeners are already
        # running and each holds a dedicated Redis pubsub connection. Without
        # this unregister those listeners (and their connections) would leak —
        # the same pool-exhaustion class as the register failure itself.
        # ``unregister`` is idempotent and tolerates an unknown/never-registered
        # device_id, so it is safe to call regardless of where the failure hit.
        if manager is not None:
            try:
                await manager.unregister(device_id, user_id)
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
                "timestamp": utc_now().isoformat(),
            }
        )

        logger.info(
            "devices_ws_connected",
            device_id=str(device_id),
            user_id=str(user_id),
            name=name,
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

            await _route_device_message(
                data, device_id, user_id, manager, connection_pk, websocket
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
        await _cleanup(device_id, connection_pk, user_id, manager, websocket)


async def _route_device_message(
    msg: dict[str, Any],
    device_id: Any,
    user_id: Any,
    manager: Any,
    connection_pk: int | None = None,
    websocket: Any = None,
) -> None:
    """Dispatch a single inbound message from the device.

    ``connection_pk`` identifies the ``coord.device_connections`` row for
    THIS socket; the heartbeat handler uses it to re-assert the device's
    WS-presence pointer (see :func:`_handle_heartbeat`). It is optional so
    existing callers/tests that only route non-heartbeat traffic keep
    working unchanged.
    """
    msg_type = msg.get("type")

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

    logger.debug(
        "devices_ws_unhandled_message",
        device_id=str(device_id),
        msg_type=msg_type,
    )


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

    # One session for both writes. This is the hottest path in the file —
    # every device, every ~30s — and registration failures here have already
    # been observed as connection-pool exhaustion, so it must not take two
    # sessions to do two UPDATEs on the same row.
    async with AsyncSessionLocal() as db:
        try:
            await device_crud.heartbeat_device(
                db,
                device_id=device_id,
                restate_healthy=bool(msg.get("restate_healthy", False)),
                status_value=str(msg.get("status", "healthy")),
                derived_status=derived_status,
                ui_error=ui_error,
                recent_crash=recent_crash,
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


async def _cleanup(
    device_id: Any,
    connection_pk: int | None,
    user_id: Any,
    manager: Any,
    websocket: Any = None,
) -> None:
    """Tear down THIS connection's traces — and only this connection's.

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
    still_ours = websocket is None or manager.get_websocket(device_id) is websocket

    if still_ours:
        try:
            await manager.unregister(device_id, user_id)
        except Exception as e:
            logger.error(
                "devices_ws_unregister_failed",
                device_id=str(device_id) if device_id else None,
                error=str(e),
            )
    else:
        logger.info(
            "devices_ws_skip_unregister_superseded",
            device_id=str(device_id) if device_id else None,
            our_connection_pk=connection_pk,
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
    if still_ours:
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
