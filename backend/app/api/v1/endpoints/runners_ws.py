"""
Unified runner-side WebSocket endpoint (Phase 2B).

The runner opens *one* persistent connection to ``WS /api/v1/runners/ws``
and uses it for registration, heartbeats, dispatch, command relay, and
status updates. Authentication is via the ``Authorization: Bearer
qontinui_runner_xxx`` header (runner-token auth).

The pre-existing ``WS /automation/ws/automation/runner`` (JWT-keyed)
remains mounted until Phase 5 cleanup. This module is the new code path
that Phase 3 will switch the runner to.

Inbound messages handled:
  - ``runner_info``  — first message after connect; identifies the runner
                       and triggers a registration-or-update.
  - ``heartbeat``    — refreshes ``last_heartbeat``, may carry
                       ``ui_error`` / ``recent_crash`` updates.
  - ``ping``         — replies with ``pong``.
  - ``phase_completed`` / ``ui_error`` / ``recent_crash`` /
    ``dispatch_ack`` / ``command_response`` / ``chat_response`` /
    ``terminal_response`` — relayed to subscribed frontends/mobiles.

Outbound messages (sent by other components via the manager):
  - ``connected``    — handshake ack with the resolved ``runner_id``.
  - ``dispatch``     — workflow dispatch from web/mobile.
  - ``command`` / ``chat_*`` / ``terminal_*`` — relays from web/mobile.
  - ``error``        — handshake / per-message errors.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from qontinui_schemas.common import utc_now

from app.config.redis_config import get_redis
from app.crud import runner_crud
from app.crud import runner_session as runner_session_crud
from app.crud.runner_crud import validate_runner_token
from app.db.session import AsyncSessionLocal
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_runner_unified_endpoint(websocket: WebSocket) -> None:
    """Unified runner-side WebSocket endpoint.

    URL: ``wss://{backend}/api/v1/runners/ws``
    Auth: ``Authorization: Bearer qontinui_runner_xxx`` HEADER.
    """
    await websocket.accept()

    # ------------------------------------------------------------------
    # 1. Authenticate via runner-token header.
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
            {"type": "error", "message": "Missing runner-token bearer."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with AsyncSessionLocal() as auth_db:
        runner_token = await validate_runner_token(auth_db, token)

    if runner_token is None:
        await websocket.send_json(
            {"type": "error", "message": "Invalid or expired runner token."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = runner_token.user_id
    runner_token_id = runner_token.id

    # ------------------------------------------------------------------
    # 2. Wait for the runner_info message, upsert the Runner row, create
    #    a RunnerSession, set ws_session_id, register with manager,
    #    publish ``runner_connected`` event.
    # ------------------------------------------------------------------
    try:
        info_msg = await asyncio.wait_for(websocket.receive_json(), timeout=15.0)
    except (TimeoutError, WebSocketDisconnect):
        logger.warning("runners_ws_runner_info_timeout", user_id=str(user_id))
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except Exception as e:
        logger.error(
            "runners_ws_runner_info_failed", user_id=str(user_id), error=str(e)
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

    name = info_msg.get("name") or info_msg.get("runner_name") or "Unnamed Runner"
    hostname = info_msg.get("hostname") or "localhost"
    port = int(info_msg.get("port", 9876))
    os_name = info_msg.get("os")
    os_version = info_msg.get("os_version") or info_msg.get("osVersion")
    capabilities = info_msg.get("capabilities") or []

    client_ip = websocket.client.host if websocket.client else None

    runner_id = None
    session_pk = None
    try:
        async with AsyncSessionLocal() as db:
            runner_row = await runner_crud.register_runner(
                db,
                user_id=user_id,
                name=name,
                hostname=hostname,
                port=port,
                capabilities=list(capabilities),
                restate_enabled=False,
                restate_healthy=False,
                runner_token_id=runner_token_id,
            )

            # Phase 2A added these columns; refresh them as part of the
            # WS-handshake upsert.
            runner_row.os = os_name
            runner_row.os_version = os_version
            await db.commit()
            await db.refresh(runner_row)

            session_record = await runner_session_crud.create_session_record(
                db,
                runner_id=runner_row.id,
                user_id=user_id,
                ip_address=client_ip,
            )

            # Mark the runner as WS-connected by pointing at the open session.
            runner_row.ws_session_id = session_record.id
            runner_row.ws_connected_at = session_record.connected_at
            await db.commit()

            runner_id = runner_row.id
            session_pk = session_record.id
    except Exception as e:
        logger.error(
            "runners_ws_register_failed",
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
        runner_id=runner_id,
        websocket=websocket,
        user_id=user_id,
        runner_name=name,
        ip_address=client_ip,
        connected_at=utc_now().isoformat(),
    )

    await manager.publish_runner_connected(
        runner_id=runner_id,
        user_id=user_id,
        runner_name=name,
        connected_at=utc_now().isoformat(),
        ip_address=client_ip,
    )

    await websocket.send_json(
        {
            "type": "connected",
            "runner_id": str(runner_id),
            "user_id": str(user_id),
            "timestamp": utc_now().isoformat(),
        }
    )

    logger.info(
        "runners_ws_connected",
        runner_id=str(runner_id),
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

            await _route_runner_message(data, runner_id, user_id, manager)

    except WebSocketDisconnect:
        logger.info("runners_ws_disconnected", runner_id=str(runner_id))
    except Exception as e:
        logger.error(
            "runners_ws_loop_error",
            runner_id=str(runner_id),
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        await _cleanup(runner_id, session_pk, user_id, manager)


async def _route_runner_message(
    msg: dict[str, Any],
    runner_id: Any,
    user_id: Any,
    manager: Any,
) -> None:
    """Dispatch a single inbound message from the runner."""
    msg_type = msg.get("type")

    if msg_type == "ping":
        ws = manager.get_websocket(runner_id)
        if ws:
            try:
                await ws.send_json({"type": "pong", "timestamp": utc_now().isoformat()})
            except Exception:
                pass
        return

    if msg_type == "heartbeat":
        await _handle_heartbeat(msg, runner_id, manager)
        return

    if msg_type in {
        "phase_completed",
        "ui_error",
        "recent_crash",
        "dispatch_ack",
    }:
        # Status-style events go to subscribed frontends.
        await manager.send_response_to_frontends(runner_id, msg)
        return

    if msg_type == "command_response":
        await manager.send_response_to_frontends(runner_id, msg)
        return

    if msg_type == "chat_response":
        await manager.send_chat_response_to_mobiles(runner_id, msg)
        return

    if msg_type == "terminal_response":
        await manager.send_terminal_response_to_mobiles(runner_id, msg)
        return

    logger.debug(
        "runners_ws_unhandled_message",
        runner_id=str(runner_id),
        msg_type=msg_type,
    )


async def _handle_heartbeat(msg: dict[str, Any], runner_id: Any, manager: Any) -> None:
    """Persist a runner heartbeat over WS and refresh Redis TTL."""
    ui_error = msg.get("ui_error")
    recent_crash = msg.get("recent_crash")
    derived_status = msg.get("derived_status")

    try:
        async with AsyncSessionLocal() as db:
            await runner_crud.heartbeat_runner(
                db,
                runner_id=runner_id,
                restate_healthy=bool(msg.get("restate_healthy", False)),
                status_value=str(msg.get("status", "healthy")),
                derived_status=derived_status,
                ui_error=ui_error,
                recent_crash=recent_crash,
            )
    except Exception as e:
        logger.error(
            "runners_ws_heartbeat_persist_failed",
            runner_id=str(runner_id),
            error=str(e),
        )
    try:
        await manager.refresh_ttl(runner_id)
    except Exception:
        pass


async def _cleanup(
    runner_id: Any,
    session_pk: int | None,
    user_id: Any,
    manager: Any,
) -> None:
    """Clear ws_session_id, close the session row, unregister from manager."""
    try:
        await manager.unregister(runner_id, user_id)
    except Exception as e:
        logger.error(
            "runners_ws_unregister_failed",
            runner_id=str(runner_id) if runner_id else None,
            error=str(e),
        )

    try:
        async with AsyncSessionLocal() as db:
            row = await runner_crud.get_runner(db, runner_id) if runner_id else None
            if row is not None:
                row.ws_session_id = None
                row.ws_connected_at = None
                await db.commit()
    except Exception as e:
        logger.error(
            "runners_ws_clear_session_id_failed",
            runner_id=str(runner_id) if runner_id else None,
            error=str(e),
        )

    if session_pk is not None:
        try:
            async with AsyncSessionLocal() as db:
                await runner_session_crud.close_session_record(db, session_pk)
        except Exception as e:
            logger.error(
                "runners_ws_close_session_failed",
                session_pk=session_pk,
                error=str(e),
            )

    try:
        await manager.publish_runner_disconnected(runner_id, user_id)
    except Exception as e:
        logger.error(
            "runners_ws_publish_disconnect_failed",
            runner_id=str(runner_id) if runner_id else None,
            error=str(e),
        )

    # `json` import-loaded for symmetry with future relay paths
    _ = json
