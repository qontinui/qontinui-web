"""
WebSocket endpoint for real-time runner connection status updates.

Provides WebSocket connection for frontend to receive real-time notifications
when runners connect or disconnect, eliminating the need for polling.
"""

import asyncio
import json

import structlog
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from redis import asyncio as aioredis
from starlette.websockets import WebSocketState

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.crud import runner as runner_crud

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.websocket("/ws/runner/status")
async def websocket_runner_status(
    websocket: WebSocket,
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    WebSocket endpoint for real-time runner connection status updates.

    Authentication:
        Expects 'token' query parameter with JWT access token

    Messages sent to client:
        - {"type": "initial_state", "connections": [...]}
        - {"type": "runner_connected", "connection": {...}}
        - {"type": "runner_disconnected", "connection_id": 123, "timestamp": "..."}

    Query params:
        token: JWT access token for authentication

    Raises:
        WebSocketDisconnect: When client disconnects
    """
    await websocket.accept()

    # Extract token from query params
    token = websocket.query_params.get("token")
    if not token:
        await websocket.send_json(
            {"type": "error", "error": "Missing authentication token"}
        )
        await websocket.close(code=1008, reason="Missing authentication token")
        return

    # Authenticate user
    try:
        user = await get_current_user_from_ws(token)
        logger.info(
            "runner_status_ws_authenticated",
            user_id=str(user.id),
            username=user.email,
        )
    except Exception as e:
        logger.error(
            "runner_status_ws_auth_failed",
            error=str(e),
        )
        await websocket.send_json({"type": "error", "error": "Authentication failed"})
        await websocket.close(code=1008, reason="Authentication failed")
        return

    # Import here to avoid circular dependency
    from app.db.session import AsyncSessionLocal
    from app.services.runner_connection_manager import get_runner_connection_manager

    # Send initial state
    try:
        async with AsyncSessionLocal() as db:
            active_connections = await runner_crud.get_active_connections(
                db=db, user_id=user.id
            )

            # Get WebSocket connection status from runner connection manager
            runner_manager = await get_runner_connection_manager(redis)
            ws_connected_ids = set(
                await runner_manager.get_all_connected_runner_ids_redis()
            )

            # Convert to response format
            connections_data = [
                {
                    "id": conn.id,
                    "runner_token_id": (
                        str(conn.runner_token_id) if conn.runner_token_id else None
                    ),
                    "runner_name": conn.runner_name,
                    "connected_at": conn.connected_at.isoformat(),
                    "disconnected_at": (
                        conn.disconnected_at.isoformat()
                        if conn.disconnected_at
                        else None
                    ),
                    "duration_seconds": conn.duration_seconds,
                    "ip_address": conn.ip_address,
                    "project_id": str(conn.project_id) if conn.project_id else None,
                    "ws_connected": conn.id in ws_connected_ids,
                }
                for conn in active_connections
            ]

            await websocket.send_json(
                {
                    "type": "initial_state",
                    "connections": connections_data,
                }
            )
            logger.info(
                "runner_status_ws_initial_state_sent",
                user_id=str(user.id),
                connection_count=len(connections_data),
            )
    except Exception as e:
        logger.error(
            "runner_status_ws_initial_state_failed",
            error=str(e),
            user_id=str(user.id),
        )
        await websocket.send_json(
            {"type": "error", "error": "Failed to load initial state"}
        )

    # Subscribe to Redis pub/sub for status updates
    pubsub = redis.pubsub()
    channel = f"runner:status:updates:{user.id}"

    try:
        await pubsub.subscribe(channel)
        logger.info(
            "runner_status_ws_subscribed",
            user_id=str(user.id),
            channel=channel,
        )

        # Listen for messages from Redis
        async for message in pubsub.listen():
            # Check if WebSocket is still connected before processing
            if websocket.client_state != WebSocketState.CONNECTED:
                logger.info(
                    "runner_status_ws_client_disconnected",
                    user_id=str(user.id),
                    state=str(websocket.client_state),
                )
                break

            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    # Double-check connection state before send
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json(data)
                        logger.info(
                            "runner_status_ws_message_forwarded",
                            user_id=str(user.id),
                            message_type=data.get("type"),
                            connection_id=data.get("connection_id")
                            or data.get("connection", {}).get("id"),
                        )
                    else:
                        logger.warning(
                            "runner_status_ws_send_skipped",
                            user_id=str(user.id),
                            message_type=data.get("type"),
                            state=str(websocket.client_state),
                        )
                        break
                except json.JSONDecodeError as e:
                    logger.error(
                        "runner_status_ws_invalid_message",
                        error=str(e),
                        user_id=str(user.id),
                    )
                except WebSocketDisconnect:
                    logger.info(
                        "runner_status_ws_disconnected_during_send",
                        user_id=str(user.id),
                    )
                    break
                except Exception as e:
                    # Log the error but check if we should continue
                    error_type = type(e).__name__
                    logger.error(
                        "runner_status_ws_send_failed",
                        error=str(e),
                        error_type=error_type,
                        user_id=str(user.id),
                    )
                    # Check if the WebSocket is still connected
                    if websocket.client_state != WebSocketState.CONNECTED:
                        logger.info(
                            "runner_status_ws_closing_after_error",
                            user_id=str(user.id),
                            state=str(websocket.client_state),
                        )
                        break
                    # For other errors, wait briefly and continue
                    await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        logger.info(
            "runner_status_ws_disconnected",
            user_id=str(user.id),
        )
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
        logger.info(
            "runner_status_ws_closed",
            user_id=str(user.id),
        )
