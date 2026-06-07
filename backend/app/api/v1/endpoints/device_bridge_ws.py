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
import base64
import binascii
import json
import re
import time
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
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
from app.services import coord_device
from app.services.device_bridge_service import DeviceBridgeService
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS, reject, safe_close

router = APIRouter()
logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(UTC).isoformat() + "Z"


# Allowed port range for runner instances (primary + temp runners)
_RUNNER_PORT_MIN = 9876
_RUNNER_PORT_MAX = 9899

# Pattern for safe proxy path segments — allows alphanumeric, hyphens, underscores,
# dots, and forward slashes only. Rejects characters that could rewrite the URL
# (e.g., '@', ':', '?', '#') even if FastAPI strips some of them first.
_SAFE_PATH_RE = re.compile(r"^[a-zA-Z0-9/_\-\.]*$")

# Maximum request/response body size relayed over the WS bridge. Guards both
# the inbound request body and the base64-decoded response body against
# oversized payloads that would strain Redis pub/sub. 8 MiB.
RELAY_MAX_BODY_BYTES = 8 * 1024 * 1024

# Relay dispatch timeout bounds (milliseconds) for the remote-runner path.
_RELAY_TIMEOUT_MS_MIN = 1000
_RELAY_TIMEOUT_MS_MAX = 120000
_RELAY_TIMEOUT_MS_DEFAULT = 30000

# Request headers never forwarded to the runner over the relay. ``authorization``
# is excluded deliberately: the runner trusts its outbound WS connection, NOT
# the end user's bearer token, so the token must never cross the relay.
_RELAY_EXCLUDED_REQUEST_HEADERS = frozenset(
    {"host", "connection", "transfer-encoding", "content-length", "authorization"}
)

# Hop-by-hop response headers stripped before returning the runner's reply.
_RELAY_EXCLUDED_RESPONSE_HEADERS = frozenset(
    {"transfer-encoding", "connection", "keep-alive", "content-length"}
)


def _validate_runner_port(port: int) -> None:
    """Raise ValueError if port is outside the allowed runner port range."""
    if not (_RUNNER_PORT_MIN <= port <= _RUNNER_PORT_MAX):
        raise ValueError(
            f"Runner port {port} is outside the allowed range "
            f"{_RUNNER_PORT_MIN}–{_RUNNER_PORT_MAX}"
        )


def _validate_proxy_path(path: str) -> None:
    """Raise ValueError if path contains characters that could redirect the URL."""
    if not _SAFE_PATH_RE.match(path):
        raise ValueError(f"Proxy path contains disallowed characters: {path!r}")


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
        # safe_close also covers the pre-accept (CONNECTING) state — a client
        # that vanishes during this rejection close must not raise out of the
        # handler (same tolerant contract as the post-accept rejects).
        await safe_close(
            websocket,
            status.WS_1008_POLICY_VIOLATION,
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
            await reject(websocket, "Authentication required (token query param).")
            return

        try:
            user = await get_current_user_from_ws(token)
        except Exception as e:
            logger.error("device_bridge_device_auth_failed", error=str(e))
            await reject(websocket, "Authentication failed.")
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
            await reject(
                websocket,
                f"Expected device_register as first message, "
                f"got: {reg_data.get('type')!r}",
            )
            return

        device_id = reg_data.get("device_id")
        if not device_id:
            await reject(websocket, "device_id is required in device_register.")
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
                    except BENIGN_SEND_EXCEPTIONS as fwd_err:
                        # Client gone / our close already sent — stop forwarding;
                        # the main loop's teardown + finally returns the pubsub.
                        logger.info(
                            "device_bridge_device_forward_disconnected",
                            user_id=user_id,
                            device_id=device_id,
                            error=str(fwd_err),
                        )
                        break
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
        # safe_close also covers the pre-accept (CONNECTING) state — a client
        # that vanishes during this rejection close must not raise out of the
        # handler (same tolerant contract as the post-accept rejects).
        await safe_close(
            websocket,
            status.WS_1008_POLICY_VIOLATION,
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
            await reject(websocket, "Authentication required (token query param).")
            return

        try:
            user = await get_current_user_from_ws(token)
        except Exception as e:
            logger.error("device_bridge_tunnel_auth_failed", error=str(e))
            await reject(websocket, "Authentication failed.")
            return

        user_id = str(user.id)
        redis_client = await get_redis()
        service = DeviceBridgeService(redis_client)

        # --- Verify device belongs to this user and is online ---
        device_info = await service.get_device(user_id, device_id)
        if device_info is None:
            await reject(
                websocket,
                f"Device '{device_id}' is not connected or does not belong "
                f"to your account.",
            )
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
                    except BENIGN_SEND_EXCEPTIONS as fwd_err:
                        # Client gone / our close already sent — stop forwarding;
                        # the main loop's teardown + finally returns the pubsub.
                        logger.info(
                            "device_bridge_tunnel_forward_disconnected",
                            user_id=user_id,
                            device_id=device_id,
                            tunnel_id=tunnel_id,
                            error=str(fwd_err),
                        )
                        break
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

    Two modes:

    * **Co-located (legacy)** — when the ``X-Qontinui-Device-Id`` header is
      ABSENT, the request is forwarded to ``http://127.0.0.1:{port}`` via the
      synchronous urllib path below. Used by the demo box where the runner is
      on the same host as the backend.
    * **Remote relay** — when ``X-Qontinui-Device-Id`` is PRESENT, the request
      is relayed HTTP-over-WebSocket through the runner's existing outbound
      ``/devices/ws`` connection. This lets a mobile client on a *different*
      network reach a runner it doesn't share a LAN with.
    """
    user_id = str(user.id)

    # --- Remote relay path (mobile on a different network) ---------------
    device_id_hdr = request.headers.get("X-Qontinui-Device-Id")
    if device_id_hdr is not None:
        return await _runner_proxy_relay(request, path, user_id, device_id_hdr)

    # Find the runner port over coord's HTTP boundary (Phase 3 of
    # ``2026-05-30-web-coord-schema-boundary-decoupling.md``). Replaces the
    # former direct ``SELECT port FROM coord.devices WHERE user_id=:uid AND
    # capability_user_paired AND ws_session_id IS NOT NULL ORDER BY
    # ws_connected_at DESC LIMIT 1`` — coord now owns that read behind
    # ``GET /coord/devices/routing/active`` (scoped by the
    # ``x-qontinui-user-id`` header). We forward the caller's bearer.
    # A null/error result falls back to the default 9876, preserving the
    # prior behavior. Transport failures (502/504) propagate as HTTP errors.
    runner_port = 9876  # default
    try:
        active_port = await coord_device.get_active_routing_port(
            bearer=coord_device.extract_bearer(request),
            user_id=user_id,
        )
        if active_port:
            runner_port = active_port
    except Exception as e:
        logger.debug("runner_proxy_port_lookup_failed", error=str(e))

    # Validate port and path before constructing the URL to prevent SSRF.
    # The port must be in the known runner port range; the path must contain
    # only safe characters so it cannot redirect the request to a different host.
    try:
        _validate_runner_port(runner_port)
        _validate_proxy_path(path)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

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


def _resolve_relay_timeout_s(request: Request) -> float:
    """Resolve the relay dispatch timeout (seconds) from the request headers.

    Reads ``X-Qontinui-Timeout-Ms`` if present and parseable as an int,
    clamps it to ``[_RELAY_TIMEOUT_MS_MIN, _RELAY_TIMEOUT_MS_MAX]``, and
    defaults to ``_RELAY_TIMEOUT_MS_DEFAULT`` otherwise.
    """
    raw = request.headers.get("X-Qontinui-Timeout-Ms")
    ms = _RELAY_TIMEOUT_MS_DEFAULT
    if raw is not None:
        try:
            ms = int(raw)
        except (TypeError, ValueError):
            ms = _RELAY_TIMEOUT_MS_DEFAULT
    ms = max(_RELAY_TIMEOUT_MS_MIN, min(_RELAY_TIMEOUT_MS_MAX, ms))
    return ms / 1000.0


async def _runner_proxy_relay(
    request: Request,
    path: str,
    user_id: str,
    device_id_hdr: str,
) -> Response:
    """Relay an HTTP request to a remote runner over its outbound WS bridge.

    Reached from :func:`runner_proxy` when the ``X-Qontinui-Device-Id`` header
    is present. The runner need not be co-located with this backend: the
    request is published as an ``http_request`` envelope on the runner's Redis
    command channel and the matching ``command_response`` is awaited, so the
    relay works across horizontally-scaled backend replicas.
    """
    # Lazy imports keep the module import graph light for the legacy path.
    from app.services.runner import (
        RunnerCommandTimeoutError,
        RunnerNotConnectedError,
    )
    from app.services.runner_websocket_manager import (
        get_runner_websocket_manager,
    )

    # 1. Validate + resolve the device (UUID, ownership, connected).
    try:
        device_uuid = UUID(device_id_hdr)
    except (ValueError, AttributeError, TypeError):
        return JSONResponse(
            status_code=400,
            content={"detail": "X-Qontinui-Device-Id is not a valid UUID"},
        )

    # Resolve the device routing over coord's HTTP boundary (Phase 3 of
    # ``2026-05-30-web-coord-schema-boundary-decoupling.md``). Replaces the
    # former direct ``SELECT device_id, ws_session_id FROM coord.devices
    # WHERE device_id=:id AND user_id=:uid AND capability_user_paired`` —
    # coord now owns that ownership-checked read behind
    # ``GET /coord/devices/:id/routing`` (scoped by ``x-qontinui-user-id``).
    # Coord's 404 (device not owned) maps to ``row is None``, the same
    # signal the prior query carried. Coord transport faults surface as the
    # 502/504 ``HTTPException`` from the client; any other unexpected error
    # preserves the prior 500-on-lookup-error posture (a real fault, not a
    # relay-connectivity problem).
    try:
        row = await coord_device.get_device_routing(
            device_uuid,
            bearer=coord_device.extract_bearer(request),
            user_id=user_id,
        )
    except HTTPException:
        # 502/504 transport mapping from the coord client — re-raise so
        # FastAPI renders the gateway error verbatim.
        raise
    except Exception:
        logger.exception(
            "runner_proxy_relay_device_lookup_failed",
            device_id=str(device_uuid),
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "device lookup failed"},
        )

    if row is None:
        return JSONResponse(
            status_code=404,
            content={"detail": "device not found or not owned by caller"},
        )
    if row.get("ws_session_id") is None:  # ws_session_id IS NULL
        return JSONResponse(
            status_code=503,
            content={"detail": "runner not connected"},
        )

    # 2. Validate path with the existing SSRF guard.
    try:
        _validate_proxy_path(path)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    # 3. Resolve the dispatch timeout.
    timeout_s = _resolve_relay_timeout_s(request)

    # 4. Read + size-cap the request body.
    body = await request.body()
    if len(body) > RELAY_MAX_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": "request body exceeds relay size cap"},
        )

    # 5. Build the filtered request headers (lowercased keys, drop hop-by-hop
    #    + authorization — never forward the user's bearer to the runner).
    fwd_headers = {
        k.lower(): v
        for k, v in request.headers.items()
        if k.lower() not in _RELAY_EXCLUDED_REQUEST_HEADERS
    }

    # 6. Build the http_request envelope (top-level type — see wire contract).
    body_b64 = base64.b64encode(body).decode("ascii") if body else ""
    envelope: dict[str, str | dict[str, str]] = {
        "type": "http_request",
        "method": request.method,
        "path": path,
        "query": request.url.query,
        "headers": fwd_headers,
        "body_b64": body_b64,
    }

    request_id = str(uuid4())
    redis_client = await get_redis()
    manager = await get_runner_websocket_manager(redis_client)

    started = time.monotonic()
    logger.info(
        "runner_proxy_relay_dispatch",
        device_id=str(device_uuid),
        request_id=request_id,
        method=request.method,
        path=path,
        timeout_s=timeout_s,
        body_bytes=len(body),
    )

    # 7. Dispatch over the WS bridge and await the matching response.
    try:
        reply = await manager.relay.dispatch_and_wait(
            str(device_uuid),
            envelope,
            request_id=request_id,
            timeout_s=timeout_s,
            require_local_connection=False,
        )
    except RunnerNotConnectedError:
        logger.warning(
            "runner_proxy_relay_runner_disconnected",
            device_id=str(device_uuid),
            request_id=request_id,
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "runner not connected"},
        )
    except RunnerCommandTimeoutError:
        elapsed_ms = (time.monotonic() - started) * 1000.0
        logger.error(
            "runner_proxy_relay_timeout",
            device_id=str(device_uuid),
            request_id=request_id,
            path=path,
            elapsed_ms=round(elapsed_ms, 1),
        )
        return JSONResponse(
            status_code=504,
            content={"detail": "runner did not respond in time"},
        )

    # 8. Translate the command_response reply into a FastAPI Response.
    status_code = reply.get("status", 200)
    try:
        status_code = int(status_code)
    except (TypeError, ValueError):
        status_code = 200

    reply_body_b64 = reply.get("body_b64", "") or ""
    try:
        resp_content = base64.b64decode(reply_body_b64) if reply_body_b64 else b""
    except (binascii.Error, ValueError):
        logger.error(
            "runner_proxy_relay_bad_response_b64",
            device_id=str(device_uuid),
            request_id=request_id,
        )
        return JSONResponse(
            status_code=502,
            content={"detail": "runner returned an undecodable body"},
        )

    if len(resp_content) > RELAY_MAX_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": "runner response exceeds relay size cap"},
        )

    reply_headers = reply.get("headers") or {}
    resp_headers = {
        k: v
        for k, v in reply_headers.items()
        if k.lower() not in _RELAY_EXCLUDED_RESPONSE_HEADERS
    }

    elapsed_ms = (time.monotonic() - started) * 1000.0
    logger.info(
        "runner_proxy_relay",
        device_id=str(device_uuid),
        request_id=request_id,
        method=request.method,
        path=path,
        status=status_code,
        elapsed_ms=round(elapsed_ms, 1),
    )

    return Response(
        content=resp_content,
        status_code=status_code,
        headers=resp_headers,
    )
