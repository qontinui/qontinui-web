"""
WebSocket endpoint for real-time runner status updates.

The frontend opens this WS to receive a snapshot of the user's runners
plus a stream of status events (``runner_connected``,
``runner_disconnected``, ``runner.woke``, ``runner_name_updated``, ...).

URL: ``ws://localhost:8000/api/v1/runners/status?token=<jwt>``

Authentication: JWT access token via the ``token`` query parameter (web
browsers cannot set Authorization headers on WebSocket handshakes).

Response format:
- ``initial_state``: ``{ "type": "initial_state", "runners": [Runner] }``
  using the canonical wire shape from ``qontinui_schemas``.
- All subsequent messages are forwarded verbatim from the per-user Redis
  pub/sub channel ``runner:status:updates:{user_id}``.
"""

import asyncio
import json

import structlog
from fastapi import APIRouter, Depends, WebSocket, status
from redis import asyncio as aioredis
from starlette.websockets import WebSocketState

from app.api.deps import get_current_user_from_ws
from app.api.v1.endpoints.devices import _device_to_wire as _runner_to_wire
from app.config.redis_config import get_redis
from app.core.config import settings
from app.crud import runner_crud
from app.websockets.safe_send import (
    BENIGN_SEND_EXCEPTIONS,
    safe_close,
    safe_send_json,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.websocket("/runners/status")
async def websocket_runner_status(
    websocket: WebSocket,
    redis: aioredis.Redis = Depends(get_redis),
) -> None:
    """Stream runner status updates to one user."""
    # Short-circuit when Redis is disabled (e.g. CI without a Redis service
    # container). Without this guard the handler keeps trying to subscribe to
    # a non-existent localhost:6379 and floods logs with ConnectionRefusedError.
    # Mirrors the precedent in device_bridge_ws.py.
    if not settings.REDIS_ENABLED:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Runner status stream requires Redis.",
        )
        return

    await websocket.accept()

    token = websocket.query_params.get("token")
    if not token:
        await safe_send_json(
            websocket, {"type": "error", "error": "Missing authentication token"}
        )
        await safe_close(websocket, 1008)
        return

    try:
        user = await get_current_user_from_ws(token)
    except Exception as e:
        logger.error("runner_status_ws_auth_failed", error=str(e))
        await safe_send_json(
            websocket, {"type": "error", "error": "Authentication failed"}
        )
        await safe_close(websocket, 1008)
        return

    # Send the initial snapshot using the canonical Runner wire shape.
    from app.db.session import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            runners = await runner_crud.list_runners(db, user.id)
            wire_runners = [_runner_to_wire(r).model_dump(mode="json") for r in runners]

            await websocket.send_json(
                {
                    "type": "initial_state",
                    "runners": wire_runners,
                }
            )
    except Exception as e:
        logger.error(
            "runner_status_ws_initial_state_failed",
            error=str(e),
            user_id=str(user.id),
        )
        await safe_send_json(
            websocket, {"type": "error", "error": "Failed to load initial state"}
        )

    pubsub = redis.pubsub()
    channel = f"runner:status:updates:{user.id}"

    try:
        await pubsub.subscribe(channel)
        async for message in pubsub.listen():
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json(data)
                    else:
                        break
                except json.JSONDecodeError as e:
                    logger.error(
                        "runner_status_ws_invalid_message",
                        error=str(e),
                        user_id=str(user.id),
                    )
                except BENIGN_SEND_EXCEPTIONS:
                    break
                except Exception as e:
                    logger.error(
                        "runner_status_ws_send_failed",
                        error=str(e),
                        error_type=type(e).__name__,
                        user_id=str(user.id),
                    )
                    if websocket.client_state != WebSocketState.CONNECTED:
                        break
                    await asyncio.sleep(0.1)
    except BENIGN_SEND_EXCEPTIONS:
        pass
    except Exception as e:
        logger.error(
            "runner_status_ws_error",
            error=str(e),
            error_type=type(e).__name__,
            user_id=str(user.id),
        )
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
