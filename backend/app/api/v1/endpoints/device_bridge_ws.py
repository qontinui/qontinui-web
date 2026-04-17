"""
Device Bridge WebSocket endpoints.

Provides cloud relay for physical mobile device UI Bridge connections:
  - /ws/device-bridge/device        — mobile device registers here
  - /ws/device-bridge/tunnel/{id}   — runner opens relay tunnel here
  - /device-bridge/available-devices — REST list of connected devices

Redis pub/sub channels decouple the two WebSocket sides so the relay
works across horizontally-scaled backend instances.
"""

import asyncio
import json
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import (
    APIRouter,
    Depends,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import JSONResponse

from app.api.deps import current_active_user, get_current_user_from_ws
from app.config.redis_config import get_redis
from app.core.config import settings
from app.models.user import User
from app.services.device_bridge_service import DeviceBridgeService

router = APIRouter()
logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(UTC).isoformat() + "Z"


def _redis_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": "Device bridge requires Redis, which is currently disabled."
        },
    )


# ---------------------------------------------------------------------------
# A. Device WebSocket — mobile device connects here
# ---------------------------------------------------------------------------


@router.websocket("/ws/device-bridge/device")
async def device_bridge_device_endpoint(
    websocket: WebSocket,
    token: str | None = None,
) -> None:
    """
    Mobile device connects here to register availability for tunnel relay.

    Connection URL:
        ws://<host>/api/v1/device-bridge/ws/device-bridge/device?token=<jwt>

    Expected first message (device_register):
        {
          "type": "device_register",
          "device_id": "...",
          "app_id": "...",
          "platform": "android|ios",
          "display_name": "...",
          "ui_bridge_version": "..."
        }

    After registration the device enters a relay loop, forwarding any
    tunnel_response messages it receives to the paired runner via Redis pub/sub.
    """
    if not settings.REDIS_ENABLED:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Device bridge requires Redis.",
        )
        return

    await websocket.accept()

    user = None
    device_id: str | None = None
    service: DeviceBridgeService | None = None
    pubsub = None
    listen_task: asyncio.Task | None = None

    try:
        # --- Auth ---
        if not token:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication required (token query param).",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(token)
        except Exception as e:
            logger.error("device_bridge_device_auth_failed", error=str(e))
            await websocket.send_json(
                {"type": "error", "message": "Authentication failed."}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        user_id = str(user.id)
        redis_client = await get_redis()
        service = DeviceBridgeService(redis_client)
        ws_id = str(uuid.uuid4())

        # --- Wait for device_register ---
        try:
            reg_data = await websocket.receive_json()
        except WebSocketDisconnect:
            return

        if reg_data.get("type") != "device_register":
            await websocket.send_json(
                {
                    "type": "error",
                    "message": (
                        f"Expected device_register as first message, "
                        f"got: {reg_data.get('type')!r}"
                    ),
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        device_id = reg_data.get("device_id")
        if not device_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "device_id is required in device_register.",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # --- Register in Redis ---
        session_id = await service.register_device(
            user_id,
            device_id,
            {
                "display_name": reg_data.get("display_name", ""),
                "platform": reg_data.get("platform", ""),
                "app_id": reg_data.get("app_id", ""),
                "ui_bridge_version": reg_data.get("ui_bridge_version", ""),
                "ws_id": ws_id,
            },
        )

        await websocket.send_json(
            {
                "type": "device_registered",
                "session_id": session_id,
                "device_id": device_id,
                "timestamp": _now_iso(),
            }
        )

        logger.info(
            "device_bridge_device_connected",
            user_id=user_id,
            device_id=device_id,
            session_id=session_id,
            platform=reg_data.get("platform"),
        )

        # --- Subscribe to runner→device pub/sub channel ---
        pubsub = redis_client.pubsub()
        device_ch = service.device_channel(user_id, device_id)
        await pubsub.subscribe(device_ch)

        # Background task: forward Redis messages to the device WebSocket
        async def _forward_to_device() -> None:
            try:
                async for msg in pubsub.listen():
                    if msg["type"] != "message":
                        continue
                    try:
                        payload = json.loads(msg["data"])
                        await websocket.send_json(payload)
                    except Exception as fwd_err:
                        logger.error(
                            "device_bridge_device_forward_error",
                            user_id=user_id,
                            device_id=device_id,
                            error=str(fwd_err),
                        )
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(
                    "device_bridge_device_listener_error",
                    user_id=user_id,
                    device_id=device_id,
                    error=str(e),
                )

        listen_task = asyncio.create_task(_forward_to_device())

        # --- Main receive loop (device → runner via pub/sub) ---
        while True:
            try:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if msg_type == "tunnel_response":
                    # Forward response from device to the runner's channel
                    await service.relay_to_runner(user_id, device_id, data)

                elif msg_type == "heartbeat":
                    # Refresh TTL and ack
                    if service and device_id:
                        device_info = await service.get_device(user_id, device_id)
                        if device_info:
                            await service.register_device(
                                user_id, device_id, device_info
                            )
                    await websocket.send_json(
                        {"type": "heartbeat_ack", "timestamp": _now_iso()}
                    )

                else:
                    logger.debug(
                        "device_bridge_device_unknown_message",
                        user_id=user_id,
                        device_id=device_id,
                        msg_type=msg_type,
                    )

            except WebSocketDisconnect:
                logger.info(
                    "device_bridge_device_disconnected",
                    user_id=user_id,
                    device_id=device_id,
                )
                break

            except Exception as e:
                logger.error(
                    "device_bridge_device_message_error",
                    user_id=user_id,
                    device_id=device_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {"type": "error", "message": f"Message processing error: {e}"}
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "device_bridge_device_fatal_error",
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cancel the pub/sub listener task
        if listen_task and not listen_task.done():
            listen_task.cancel()
            try:
                await listen_task
            except asyncio.CancelledError:
                pass

        # Unsubscribe pub/sub
        if pubsub:
            try:
                await pubsub.unsubscribe()
                await pubsub.close()
            except Exception:
                pass

        # Remove device from Redis
        if service and user and device_id:
            try:
                await service.unregister_device(str(user.id), device_id)
            except Exception as cleanup_err:
                logger.error(
                    "device_bridge_device_cleanup_error",
                    error=str(cleanup_err),
                )

        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# B. Tunnel WebSocket — runner connects here to relay to a specific device
# ---------------------------------------------------------------------------


@router.websocket("/ws/device-bridge/tunnel/{device_id}")
async def device_bridge_tunnel_endpoint(
    websocket: WebSocket,
    device_id: str,
    token: str | None = None,
) -> None:
    """
    Runner connects here to open a relay tunnel to a mobile device.

    Connection URL:
        ws://<host>/api/v1/device-bridge/ws/device-bridge/tunnel/{device_id}?token=<jwt>

    The runner sends tunnel_request messages; the device receives them via
    the device_channel pub/sub and responds with tunnel_response messages
    which the runner receives via the runner_channel pub/sub.

    Errors:
        - 1008 Policy Violation: auth failure or device not connected.
    """
    if not settings.REDIS_ENABLED:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Device bridge requires Redis.",
        )
        return

    await websocket.accept()

    user = None
    service: DeviceBridgeService | None = None
    pubsub = None
    listen_task: asyncio.Task | None = None
    tunnel_id = str(uuid.uuid4())

    try:
        # --- Auth ---
        if not token:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication required (token query param).",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(token)
        except Exception as e:
            logger.error("device_bridge_tunnel_auth_failed", error=str(e))
            await websocket.send_json(
                {"type": "error", "message": "Authentication failed."}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        user_id = str(user.id)
        redis_client = await get_redis()
        service = DeviceBridgeService(redis_client)

        # --- Verify device belongs to this user and is online ---
        device_info = await service.get_device(user_id, device_id)
        if device_info is None:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": (
                        f"Device '{device_id}' is not connected or does not belong to your account."
                    ),
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # --- Register tunnel ---
        await service.register_tunnel(user_id, device_id, tunnel_id)

        await websocket.send_json(
            {
                "type": "tunnel_connected",
                "tunnel_id": tunnel_id,
                "device_id": device_id,
                "device_display_name": device_info.get("display_name", ""),
                "platform": device_info.get("platform", ""),
                "timestamp": _now_iso(),
            }
        )

        logger.info(
            "device_bridge_tunnel_connected",
            user_id=user_id,
            device_id=device_id,
            tunnel_id=tunnel_id,
        )

        # --- Subscribe to device→runner pub/sub channel ---
        pubsub = redis_client.pubsub()
        runner_ch = service.runner_channel(user_id, device_id)
        await pubsub.subscribe(runner_ch)

        # Background task: forward device responses to the runner WebSocket
        async def _forward_to_runner() -> None:
            try:
                async for msg in pubsub.listen():
                    if msg["type"] != "message":
                        continue
                    try:
                        payload = json.loads(msg["data"])
                        await websocket.send_json(payload)
                    except Exception as fwd_err:
                        logger.error(
                            "device_bridge_tunnel_forward_error",
                            user_id=user_id,
                            device_id=device_id,
                            tunnel_id=tunnel_id,
                            error=str(fwd_err),
                        )
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(
                    "device_bridge_tunnel_listener_error",
                    user_id=user_id,
                    device_id=device_id,
                    tunnel_id=tunnel_id,
                    error=str(e),
                )

        listen_task = asyncio.create_task(_forward_to_runner())

        # --- Main receive loop (runner → device via pub/sub) ---
        while True:
            try:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if msg_type == "tunnel_request":
                    # Forward HTTP request from runner to the device channel
                    await service.relay_to_device(user_id, device_id, data)

                elif msg_type == "heartbeat":
                    await websocket.send_json(
                        {"type": "heartbeat_ack", "timestamp": _now_iso()}
                    )

                else:
                    logger.debug(
                        "device_bridge_tunnel_unknown_message",
                        user_id=user_id,
                        device_id=device_id,
                        tunnel_id=tunnel_id,
                        msg_type=msg_type,
                    )

            except WebSocketDisconnect:
                logger.info(
                    "device_bridge_tunnel_disconnected",
                    user_id=user_id,
                    device_id=device_id,
                    tunnel_id=tunnel_id,
                )
                break

            except Exception as e:
                logger.error(
                    "device_bridge_tunnel_message_error",
                    user_id=user_id,
                    device_id=device_id,
                    tunnel_id=tunnel_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {"type": "error", "message": f"Message processing error: {e}"}
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "device_bridge_tunnel_fatal_error",
            device_id=device_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cancel the pub/sub listener task
        if listen_task and not listen_task.done():
            listen_task.cancel()
            try:
                await listen_task
            except asyncio.CancelledError:
                pass

        # Unsubscribe pub/sub
        if pubsub:
            try:
                await pubsub.unsubscribe()
                await pubsub.close()
            except Exception:
                pass

        # Remove tunnel entry from Redis
        if service and user:
            try:
                await service.unregister_tunnel(str(user.id), device_id)
            except Exception as cleanup_err:
                logger.error(
                    "device_bridge_tunnel_cleanup_error",
                    error=str(cleanup_err),
                )

        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# C. REST endpoint — list available devices for the authenticated user
# ---------------------------------------------------------------------------


@router.get("/available-devices")
async def list_available_devices(
    user: Annotated[User, Depends(current_active_user)],
) -> JSONResponse:
    """
    List mobile devices with active bridge connections for the current user.

    Returns:
        200: List of connected device records.
        503: Redis is disabled.
    """
    if not settings.REDIS_ENABLED:
        return _redis_unavailable_response()

    redis_client = await get_redis()
    service = DeviceBridgeService(redis_client)
    user_id = str(user.id)

    raw_devices = await service.list_devices(user_id)

    devices = [
        {
            "device_id": d.get("device_id", ""),
            "display_name": d.get("display_name", ""),
            "platform": d.get("platform", ""),
            "app_id": d.get("app_id", ""),
            "connected_since": d.get("connected_at", ""),
            "relay_session_id": d.get("session_id", ""),
        }
        for d in raw_devices
    ]

    logger.info(
        "device_bridge_list_devices",
        user_id=user_id,
        count=len(devices),
    )

    return JSONResponse(content={"devices": devices, "count": len(devices)})


# ---------------------------------------------------------------------------
# E. Runner proxy — lets remote phones reach the runner through the backend
# ---------------------------------------------------------------------------


@router.api_route(
    "/runner-proxy/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def runner_proxy(
    request: Request,
    path: str,
    user: Annotated[User, Depends(current_active_user)],
) -> Response:
    """
    Proxy HTTP requests to the runner for remote mobile devices.

    The phone can't reach the runner directly (it's on a different network).
    This endpoint forwards requests through the backend which IS co-located
    with the runner.

    URL mapping:
        GET /api/v1/device-bridge/runner-proxy/health
          -> GET http://127.0.0.1:9876/health

    The runner port is looked up from the user's most recent active connection.
    Falls back to port 9876 (default runner port).
    """
    user_id = str(user.id)

    # Find the runner port from active connections
    runner_port = 9876  # default
    try:
        from sqlalchemy import text

        from app.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                text(
                    "SELECT runner_port FROM runner_connections "
                    "WHERE user_id = :uid AND disconnected_at IS NULL "
                    "ORDER BY connected_at DESC LIMIT 1"
                ),
                {"uid": user_id},
            )
            row = result.fetchone()
            if row and row[0]:
                runner_port = row[0]
    except Exception as e:
        logger.debug("runner_proxy_port_lookup_failed", error=str(e))

    target_url = f"http://127.0.0.1:{runner_port}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    try:
        body = await request.body()
        headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower()
            not in ("host", "connection", "transfer-encoding", "content-length")
        }
        req = urllib.request.Request(
            target_url,
            data=body if body else None,
            headers=headers,
            method=request.method,
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read()
            resp_headers = dict(resp.getheaders())
            # Remove hop-by-hop headers
            for hdr in ("transfer-encoding", "connection", "keep-alive"):
                resp_headers.pop(hdr, None)
            return Response(
                content=resp_body,
                status_code=resp.status,
                headers=resp_headers,
            )
    except urllib.error.HTTPError as e:
        body_bytes = e.read() if hasattr(e, "read") else b""
        return Response(content=body_bytes, status_code=e.code)
    except urllib.error.URLError:
        return JSONResponse(
            status_code=502,
            content={"detail": f"Runner not reachable at port {runner_port}"},
        )
    except Exception as e:
        logger.error("runner_proxy_error", error=str(e), path=path)
        return JSONResponse(
            status_code=502,
            content={"detail": f"Proxy error: {str(e)}"},
        )
