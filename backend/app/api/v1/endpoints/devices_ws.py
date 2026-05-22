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
from app.crud import device_connection as device_connection_crud
from app.crud import device_crud
from app.db.session import AsyncSessionLocal
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenInvalidError,
    coord_jwks_client,
)
from app.services.runner_websocket_manager import get_runner_websocket_manager

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
        await websocket.send_json(
            {"type": "error", "message": "Missing device-token bearer."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        claims = await coord_jwks_client.verify_token(token)
    except CoordJWKSUnavailableError as exc:
        # Cold-start failure: coord unreachable. Reject all handshakes
        # rather than silently falling back to "trust the token".
        logger.error("devices_ws_jwks_unavailable", error=str(exc))
        await websocket.send_json(
            {
                "type": "error",
                "message": "Device authentication temporarily unavailable.",
            }
        )
        # 1011 = internal error / service overload.
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return
    except CoordTokenInvalidError as exc:
        logger.warning("devices_ws_token_invalid", error=str(exc))
        await websocket.send_json(
            {"type": "error", "message": "Invalid or expired device token."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
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
        await websocket.send_json(
            {"type": "error", "message": "Device token missing required claims."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        token_device_id = UUID(str(raw_device_id))
        user_id = UUID(str(raw_user_id))
    except (ValueError, TypeError) as exc:
        logger.warning("devices_ws_token_claim_format_invalid", error=str(exc))
        await websocket.send_json(
            {"type": "error", "message": "Device token claim format invalid."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
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
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except Exception as e:
        logger.error(
            "devices_ws_runner_info_failed", user_id=str(user_id), error=str(e)
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    if not isinstance(info_msg, dict) or info_msg.get("type") != "runner_info":
        await websocket.send_json(
            {
                "type": "error",
                "message": "First message must be of type 'runner_info'.",
            }
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
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
        await websocket.send_json(
            {"type": "error", "message": "Internal error during registration."}
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

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

    # ------------------------------------------------------------------
    # 3. Main message loop.
    # ------------------------------------------------------------------
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)
            except TimeoutError:
                # Idle keepalive — let the underlying TCP stack handle it.
                try:
                    await websocket.send_json(
                        {"type": "ping", "timestamp": utc_now().isoformat()}
                    )
                except Exception:
                    break
                continue

            if not isinstance(data, dict):
                continue

            await _route_device_message(data, device_id, user_id, manager)

    except WebSocketDisconnect:
        logger.info("devices_ws_disconnected", device_id=str(device_id))
    except Exception as e:
        logger.error(
            "devices_ws_loop_error",
            device_id=str(device_id),
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        await _cleanup(device_id, connection_pk, user_id, manager)


async def _route_device_message(
    msg: dict[str, Any],
    device_id: Any,
    user_id: Any,
    manager: Any,
) -> None:
    """Dispatch a single inbound message from the device."""
    msg_type = msg.get("type")

    if msg_type == "ping":
        ws = manager.get_websocket(device_id)
        if ws:
            try:
                await ws.send_json({"type": "pong", "timestamp": utc_now().isoformat()})
            except Exception:
                pass
        return

    if msg_type == "heartbeat":
        await _handle_heartbeat(msg, device_id, manager)
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


async def _handle_heartbeat(msg: dict[str, Any], device_id: Any, manager: Any) -> None:
    """Persist a device heartbeat over WS and refresh Redis TTL."""
    ui_error = msg.get("ui_error")
    recent_crash = msg.get("recent_crash")
    derived_status = msg.get("derived_status")

    try:
        async with AsyncSessionLocal() as db:
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
    try:
        await manager.refresh_ttl(device_id)
    except Exception:
        pass


async def _cleanup(
    device_id: Any,
    connection_pk: int | None,
    user_id: Any,
    manager: Any,
) -> None:
    """Clear ws_session_id, close the connection row, unregister from manager."""
    try:
        await manager.unregister(device_id, user_id)
    except Exception as e:
        logger.error(
            "devices_ws_unregister_failed",
            device_id=str(device_id) if device_id else None,
            error=str(e),
        )

    try:
        async with AsyncSessionLocal() as db:
            row = await device_crud.get_device(db, device_id) if device_id else None
            if row is not None:
                row.ws_session_id = None
                row.ws_connected_at = None
                await db.commit()
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
