"""
Device Bridge endpoints — **TWO DISJOINT MECHANISMS LIVE IN THIS ONE FILE.**

They share a URL prefix and nothing else: different peers, different
registries, different failure modes. Confusing them is the recurring cost of
their co-location, so read this before debugging anything here.

Mechanism 1 — the PHONE bridge (this file owns both ends)
---------------------------------------------------------
A physical mobile device makes its UI Bridge reachable from the cloud.

  - ``/ws/device-bridge/device``      — the **phone** registers here
  - ``/ws/device-bridge/tunnel/{id}`` — a client opens a relay tunnel here
  - ``/available-mobile-devices``     — REST list of connected **phones**
    (alias: ``/available-devices``, the historical name)

  Registry: **Redis**, written by
  ``app/services/device_bridge_service.py::register_device``. Redis pub/sub
  channels decouple the two WebSocket sides, so the tunnel works across
  horizontally-scaled backend instances.

Mechanism 2 — the RUNNER proxy relay (this file owns only the caller end)
-------------------------------------------------------------------------
A mobile client reaches a **runner** it shares no LAN with.

  - ``/runner-proxy/{path}`` — see :func:`runner_proxy`. With an
    ``X-Qontinui-Device-Id`` header it relays HTTP-over-WebSocket through the
    runner's own outbound connection; without one it proxies to a co-located
    runner on ``127.0.0.1``, for platform admins only. The relay itself is
    ``app/services/runner_relay.py`` (:func:`~app.services.runner_relay.relay_http`),
    which the saved-session-lists capture calls too; this file reads the
    request into it and renders the typed outcome it returns.

  Registry: **``coord.devices.ws_session_id``**, which this file only ever
  READS (via ``app/services/coord_device.py`` → coord's
  ``GET /coord/devices/{id}/routing``). The **write** happens in a different
  file entirely — ``app/api/v1/endpoints/devices_ws.py``, when the runner's
  WebSocket registers at ``/api/v1/devices/ws``.

Consequences worth stating outright
-----------------------------------
* ``/available-mobile-devices`` lists **phones, not runners**. It is NOT a
  relay diagnostic: a runner can be perfectly registered while that list is
  empty, and vice versa.
* A ``503`` from ``/runner-proxy/*`` means ``coord.devices.ws_session_id IS
  NULL`` — the *runner* never registered with *this* backend. Redis, the
  phone bridge, and this file's WebSocket code are all uninvolved. Check the
  runner's ``GET http://127.0.0.1:9876/web-integration/status``, not the
  phone. See ``knowledge-base/qontinui-specific/mobile-app.md``. Every such
  503 emits a ``runner_proxy_relay_not_connected`` structured log carrying
  ``device_id``/``user_id``/``path``/``request_id``/``ws_connected_at``/
  ``last_seen_at``, and the same ``request_id`` is echoed in the response
  body — grep the log for the id the client shows. That id is the one
  ``RequestIDMiddleware`` bound for the whole request (and returned in the
  ``X-Request-ID`` header), so the grep also finds every other line the
  request emitted, not just this one.
* The neighbouring **404** ("device not found or not owned by caller") logs
  ``runner_proxy_relay_device_not_owned`` and carries the same
  ``request_id``, so the relay has no silent arm left.
* ``ws_connected_at`` vs ``last_seen_at`` in that body are **two different
  clocks** and are named separately on purpose — see
  ``runner_relay._device_liveness``. ``ws_connected_at`` is the one that
  separates "never registered" from "flapping right now".
* Those two keys are **absent, not null, when coord could not be read**.
  ``null`` means the column is NULL — the runner has never registered — so
  it is a claim a failed lookup is not entitled to make. Absent is the wire
  spelling of "unknown"; the adjacent
  ``runner_proxy_relay_liveness_lookup_failed`` line names why.
* A coord-side fault is **not** a 503 from here: ``coord_device`` maps a
  coord 5xx to ``502 upstream_error`` precisely so the two cannot be
  confused (503 is reserved for ``ws_session_id IS NULL``).
"""

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, assert_never
from uuid import UUID

import httpx
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
from app.core.refusal import (
    REFUSAL_KEY,
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    build_refusal,
    refusal_payload,
)
from app.models.user import User
from app.services import coord_device, runner_relay
from app.services.device_bridge_service import DeviceBridgeService

# Shared with the relay arm, which lives in ``app/services/runner_relay.py``:
# the co-located hop drops the same ambient credentials and browser
# provenance headers, and guards its path with the same SSRF check. Their
# reasons are documented there.
from app.services.runner_relay import (
    AMBIENT_CREDENTIAL_REQUEST_HEADERS as _AMBIENT_CREDENTIAL_REQUEST_HEADERS,
)
from app.services.runner_relay import (
    is_browser_provenance_header as _is_browser_provenance_header,
)
from app.services.runner_relay import relay_request_id, validate_proxy_path
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

# Relay dispatch timeout bounds (milliseconds) for the remote-runner path.
_RELAY_TIMEOUT_MS_MIN = 1000
_RELAY_TIMEOUT_MS_MAX = 120000
_RELAY_TIMEOUT_MS_DEFAULT = 30000

# Timeout (seconds) for the co-located legacy proxy hop to 127.0.0.1:<port>.
_LOCAL_PROXY_TIMEOUT_S = 30.0

# Request headers dropped on the co-located legacy proxy path — the caller's
# values, only. Beyond the hop-by-hop set, the caller's ``accept-encoding`` is
# dropped because this hop is loopback and compressing it buys nothing.
#
# Dropping it is NOT, on its own, enough to make the runner answer
# uncompressed, and the comment here used to claim it was. ``httpx`` MERGES
# its own client defaults into whatever ``headers=`` you pass, and one of
# those defaults is ``accept-encoding: gzip, deflate`` — so removing the key
# just hands the runner httpx's default instead of the caller's. The request
# is sent with ``_LOCAL_PROXY_FORCED_REQUEST_HEADERS`` below to actually
# negotiate identity; see :func:`runner_proxy`.
#
# Browser provenance headers (:func:`_is_browser_provenance_header`, above) are
# dropped here too, at the filter site, for the same reason as on the relay arm.
_LOCAL_PROXY_EXCLUDED_REQUEST_HEADERS = (
    frozenset(
        {
            "host",
            "connection",
            "transfer-encoding",
            "content-length",
            "accept-encoding",
        }
    )
    # The same ambient credentials the relay drops: the co-located runner is
    # no more entitled to the user's bearer or session cookie than a remote one.
    | _AMBIENT_CREDENTIAL_REQUEST_HEADERS
)

# Request headers this path SETS rather than forwards. ``identity`` overrides
# httpx's merged-in default (see above) so the loopback hop is uncompressed.
# The response-side ``content-encoding`` strip stays regardless: a runner is
# free to ignore the negotiation, and httpx would decode the body anyway.
_LOCAL_PROXY_FORCED_REQUEST_HEADERS = {"accept-encoding": "identity"}

# Response headers stripped on the co-located legacy proxy path. Beyond the
# hop-by-hop set, ``content-encoding`` MUST go: httpx transparently decodes
# the body, so echoing the runner's ``content-encoding: gzip`` alongside the
# already-decoded bytes would hand the caller an undecodable response.
_LOCAL_PROXY_EXCLUDED_RESPONSE_HEADERS = frozenset(
    {
        "transfer-encoding",
        "connection",
        "keep-alive",
        "content-length",
        "content-encoding",
    }
)


def _validate_runner_port(port: int) -> None:
    """Raise ValueError if port is outside the allowed runner port range."""
    if not (_RUNNER_PORT_MIN <= port <= _RUNNER_PORT_MAX):
        raise ValueError(
            f"Runner port {port} is outside the allowed range "
            f"{_RUNNER_PORT_MIN}–{_RUNNER_PORT_MAX}"
        )


def _redis_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": "Device bridge requires Redis, which is currently disabled."
        },
    )


#: The header that selects the relay arm of :func:`runner_proxy`. It is also
#: the ``next_action.target`` of the co-located arm's refusal, because adding
#: it is how a caller who is not a platform admin reaches its own runner.
_DEVICE_ID_HEADER = "X-Qontinui-Device-Id"

#: Why the co-located arm refused a caller who is not a platform admin.
_CO_LOCATED_ADMIN_ONLY_SENTENCE = (
    "the co-located runner proxy (a request without X-Qontinui-Device-Id) is "
    "limited to platform administrators, because it reaches the runner on this "
    "backend's own host with full local trust; send X-Qontinui-Device-Id naming "
    "your own runner to reach it through the relay"
)


def _co_located_admin_only_refusal(
    request: Request, path: str, user_id: str
) -> JSONResponse:
    """The 403 for a caller who is not a platform admin on the co-located arm.

    Logged at ``warning`` like the relay arm's refusals, so an attempt to drive
    the host's runner is visible server-side and joins its request by
    ``request_id``. The body follows the relay arm's shape: ``detail``, the
    ``request_id`` and the typed ``refusal`` envelope.
    """
    request_id = relay_request_id(request)
    logger.warning(
        "runner_proxy_co_located_refused",
        user_id=user_id,
        path=path,
        method=request.method,
        request_id=request_id,
    )
    refusal = build_refusal(
        RefusalCode.permission_denied,
        NextActionKind.fix_request,
        _CO_LOCATED_ADMIN_ONLY_SENTENCE,
        discriminator="co_located_proxy_admin_only",
        target=_DEVICE_ID_HEADER,
        glossary_terms=[GlossaryTerm.runner, GlossaryTerm.device],
    )
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={
            "detail": _CO_LOCATED_ADMIN_ONLY_SENTENCE,
            "request_id": request_id,
            REFUSAL_KEY: refusal_payload(refusal),
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
# C. REST endpoint — list available MOBILE devices for the authenticated user
# ---------------------------------------------------------------------------


@router.get("/available-mobile-devices")
@router.get("/available-devices", deprecated=True)
async def list_available_mobile_devices(
    user: Annotated[User, Depends(current_active_user)],
) -> JSONResponse:
    """
    List **mobile devices** (phones) with active bridge connections.

    This reads the Redis phone registry — mechanism 1 in the module docstring.
    It lists **phones, not runners**, so it is NOT a diagnostic for a
    ``/runner-proxy/*`` 503: that failure lives in
    ``coord.devices.ws_session_id`` and this list is unrelated to it.

    ``/available-devices`` is the historical path, kept as a deprecated alias
    so existing clients keep working; ``/available-mobile-devices`` is the
    name that says which registry it reads.

    Returns:
        200: List of connected mobile device records.
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
      async httpx path below. Used by the demo box where the runner is
      on the same host as the backend. **Platform admins only**: the hop
      reaches whichever runner listens on this host, with full local trust,
      so any other caller is refused 403 before a port is looked up or a
      byte is forwarded.
    * **Remote relay** — when ``X-Qontinui-Device-Id`` is PRESENT, the request
      is relayed HTTP-over-WebSocket through the runner's existing outbound
      ``/devices/ws`` connection. This lets a mobile client on a *different*
      network reach a runner it doesn't share a LAN with.
    """
    user_id = str(user.id)

    # --- Remote relay path (mobile on a different network) ---------------
    device_id_hdr = request.headers.get(_DEVICE_ID_HEADER)
    if device_id_hdr is not None:
        return await _runner_proxy_relay(request, path, user_id, device_id_hdr)

    # --- Co-located path: platform admins only ---------------------------
    # This hop reaches whichever runner listens on THIS host's loopback, with
    # the caller's Origin and Fetch Metadata stripped, so the runner's origin
    # guard classes it NonBrowser: full local trust, every route
    # (qontinui-runner ``src-tauri/src/mcp/origin_guard.rs``). Nothing here
    # ties that runner to the caller — the port lookup below names the
    # caller's most recent runner wherever it runs, and falls back to 9876 —
    # so without this gate any signed-in user could drive a co-located
    # runner. That includes ``PATCH /apps/{app_id}`` and ``POST /apps``, which
    # write the shared ``project.apps`` build and start commands the auto-fresh
    # engine executes on fleet machines: the same write ``fleet_targets.py``
    # gates on ``require_admin`` (coord finding
    # ``b27adf71-4de5-49bc-ad89-7a8acd372035``). The relay arm above stays
    # open to every user: it reaches only a runner the caller owns, and only
    # the routes that runner relays (``relay_path_policy.rs``).
    if not user.is_superuser:
        return _co_located_admin_only_refusal(request, path, user_id)

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
        validate_proxy_path(path)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    target_url = f"http://127.0.0.1:{runner_port}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    try:
        body = await request.body()
        # A LIST of pairs, not a dict: Starlette's ``Headers.items()`` yields
        # every raw pair, repeats included, and a dict comprehension keeps
        # only the last value of a repeated name — the request-side twin of
        # the ``multi_items()`` point on the response below. httpx accepts a
        # pair sequence and sends each pair, so the lossless form costs
        # nothing here.
        headers = [
            (k, v)
            for k, v in request.headers.items()
            if k.lower() not in _LOCAL_PROXY_EXCLUDED_REQUEST_HEADERS
            and not _is_browser_provenance_header(k)
        ]
        # Set, not forwarded — httpx merges its own ``accept-encoding`` default
        # into ``headers=``, so dropping the caller's key above does not by
        # itself ask the runner for identity. This does (httpx's merge lets an
        # explicit pair override the client default).
        headers.extend(_LOCAL_PROXY_FORCED_REQUEST_HEADERS.items())
        # ``httpx.AsyncClient`` rather than ``urllib.request.urlopen``: the
        # latter is a SYNCHRONOUS call on the event loop, so a slow or hung
        # runner stalled EVERY other request served by this worker for up to
        # the full timeout. ``follow_redirects`` stays at its ``False``
        # default deliberately — a proxy passes a redirect back to its caller,
        # and following one would let the runner's reply escape the
        # ``_validate_runner_port`` host/port guard above.
        async with httpx.AsyncClient(
            timeout=_LOCAL_PROXY_TIMEOUT_S,
            follow_redirects=False,
        ) as client:
            resp = await client.request(
                request.method,
                target_url,
                content=body if body else None,
                headers=headers,
            )
        # Non-2xx is a normal response for httpx (no ``HTTPError`` raise), so
        # the former ``urllib.error.HTTPError`` arm — which passed the runner's
        # status and body straight through — is subsumed here.
        #
        # ``multi_items()``, NOT ``items()``: httpx's ``Headers.items()`` emits
        # each name once and joins repeats with ", ". That is lossless for the
        # comma-list headers of RFC 7230 §3.2.2 but NOT for ``Set-Cookie``,
        # which is exempt precisely because its value may itself contain a
        # comma (``Expires=Wed, 09 Jun 2027 …``). Two cookies collapsed that way
        # reach the caller as one unparseable header, and the cookie is silently
        # lost. Building the response from ``raw_headers`` is what preserves a
        # repeated name — Starlette's ``headers=`` argument takes a Mapping and
        # would collapse it right back.
        response = Response(content=resp.content, status_code=resp.status_code)
        for name, value in resp.headers.multi_items():
            if name.lower() in _LOCAL_PROXY_EXCLUDED_RESPONSE_HEADERS:
                continue
            response.raw_headers.append(
                (name.lower().encode("latin-1"), value.encode("latin-1"))
            )
        return response
    except httpx.HTTPError:
        # Transport-level failure (connect refused, DNS, timeout, protocol
        # error) — the ``urllib.error.URLError`` equivalent.
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
    is present. The runner need not be co-located with this backend. The
    relay itself is :func:`app.services.runner_relay.relay_http`: this
    function reads the request into it, renders the typed outcome it returns,
    and owns the two warning lines a device refusal emits here
    (``runner_proxy_relay_device_not_owned``,
    ``runner_proxy_relay_not_connected``), because those name this route's
    path and method.
    """
    # 1. Validate the device id before anything is read or relayed.
    try:
        device_uuid = UUID(device_id_hdr)
    except (ValueError, AttributeError, TypeError):
        return JSONResponse(
            status_code=400,
            content={"detail": "X-Qontinui-Device-Id is not a valid UUID"},
        )

    # 2. Relay. Ownership, connectivity, the SSRF path guard, the body cap and
    #    the header strip all happen inside, in that order. The body is passed
    #    as its reader, so a request refused before the cap is never buffered.
    outcome = await runner_relay.relay_http(
        device_uuid,
        user_id=user_id,
        bearer=coord_device.extract_bearer(request),
        method=request.method,
        path=path,
        query=request.url.query,
        headers=request.headers.items(),
        body=request.body,
        timeout_s=_resolve_relay_timeout_s(request),
        caller="runner_proxy",
    )

    # 3. Render the outcome.
    match outcome:
        case runner_relay.Reply():
            return Response(
                content=outcome.body,
                status_code=outcome.status,
                headers=outcome.headers,
            )
        case (
            runner_relay.NotOwned()
            | runner_relay.NotConnected()
            | runner_relay.LookupFailed()
        ):
            request_id = relay_request_id(request)
            _log_device_refusal(outcome, request, path, user_id, request_id)
            return runner_relay.relay_refusal_response(outcome, request_id=request_id)
        case runner_relay.InvalidRequest():
            return JSONResponse(
                status_code=outcome.status_code, content={"detail": outcome.detail}
            )
        case runner_relay.Timeout():
            return JSONResponse(
                status_code=504,
                content={"detail": "runner did not respond in time"},
            )
        case runner_relay.UndecodableReply():
            return JSONResponse(
                status_code=502,
                content={"detail": "runner returned an undecodable body"},
            )
        case runner_relay.ReplyTooLarge():
            return JSONResponse(
                status_code=413,
                content={"detail": "runner response exceeds relay size cap"},
            )
        case _:
            assert_never(outcome)


def _log_device_refusal(
    outcome: runner_relay.DeviceRefusal,
    request: Request,
    path: str,
    user_id: str,
    request_id: str,
) -> None:
    """The relay's two device-refusal arms are never silent.

    Each logs at ``warning`` with the ``request_id`` its body carries, so one
    grep finds both and joins the line to the client's report. A device
    lookup failure was already logged with its traceback where it happened
    (``runner_proxy_relay_device_lookup_failed``, in the relay service).
    """
    if isinstance(outcome, runner_relay.NotOwned):
        # The relay's OTHER silent arm, historically: a caller relaying against
        # a device this user does not own — a stale device id on the phone, a
        # re-paired runner — was indistinguishable server-side from a device
        # that was never asked for.
        logger.warning(
            "runner_proxy_relay_device_not_owned",
            device_id=str(outcome.device_id),
            user_id=str(user_id),
            path=path,
            method=request.method,
            request_id=request_id,
        )
    elif isinstance(outcome, runner_relay.NotConnected):
        # This is the relay's single most common failure AND, historically,
        # its most silent one: it emitted no log line at all, so the
        # commonest cloud-relay outage was invisible server-side. W-A/W-B of
        # the mobile-cloud-relay remediation loop. The liveness fields are the
        # SAME value the 503 body spreads (``runner_relay.liveness_fields``),
        # so the two surfaces cannot drift about what was known.
        logger.warning(
            "runner_proxy_relay_not_connected",
            device_id=str(outcome.device_id),
            user_id=str(user_id),
            path=path,
            method=request.method,
            request_id=request_id,
            # Names which population a row is in without the absence of the
            # two clocks having to be noticed.
            liveness_known=outcome.liveness.known,
            **runner_relay.liveness_fields(outcome.liveness),
        )
