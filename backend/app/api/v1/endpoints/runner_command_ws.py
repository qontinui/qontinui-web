"""
WebSocket endpoint for frontend-to-runner command communication.

Allows frontend clients to send commands to connected desktop runners
and receive real-time responses and events.
"""

import asyncio
from datetime import UTC, datetime

import structlog
from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.runner_connection import RunnerConnection
from app.models.user import User
from app.services.runner_connection_manager import \
    get_runner_connection_manager
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ValidationError
from sqlalchemy import select

router = APIRouter()
logger = structlog.get_logger(__name__)


class CommandMessage(BaseModel):
    """Message format for frontend-to-runner commands."""

    type: str
    command: str | None = None
    params: dict = {}


@router.websocket("/ws/runner/command/{connection_id}")
async def websocket_runner_command_endpoint(
    websocket: WebSocket,
    connection_id: int,
    token: str | None = None,
):
    """
    WebSocket endpoint for frontend to send commands to a connected runner.

    Connection URL:
        ws://localhost:8000/api/v1/automation/ws/runner/command/{connection_id}?token=<jwt>

    Path Parameters:
        connection_id: Runner connection ID (from the runner_connections table)

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - command: Send a command to the runner
          {"type": "command", "command": "start_web_extraction", "params": {...}}

        - ping: Keep connection alive
          {"type": "ping"}

    Message Types (Server -> Client):
        - connected: Connection established
          {"type": "connected", "connection_id": 123, "runner_connected": true}

        - command_sent: Command forwarded to runner
          {"type": "command_sent", "command": "...", "timestamp": "..."}

        - runner_response: Response from runner (any message type)
          {... runner response ...}

        - runner_disconnected: Runner has disconnected
          {"type": "runner_disconnected", "timestamp": "..."}

        - error: Error message
          {"type": "error", "message": "..."}

    Features:
        - JWT authentication required
        - Validates user owns the runner connection
        - Real-time bidirectional communication via Redis pub/sub
        - Automatic cleanup on disconnect
    """
    logger.info(
        "frontend_runner_command_ws_pre_accept",
        connection_id=connection_id,
        token_present=token is not None,
    )
    await websocket.accept()

    logger.info(
        "frontend_runner_command_ws_accepted",
        connection_id=connection_id,
    )

    user: User | None = None
    manager = None

    try:
        # Authenticate user
        auth_token: str | None = token
        if not auth_token:
            auth_token = websocket.cookies.get("access_token")

        if not auth_token:
            logger.error("frontend_runner_command_ws_no_token")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication required. Provide token query param or access_token cookie.",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("frontend_runner_command_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {"type": "error", "message": "Authentication failed"}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Verify connection exists and belongs to user using proper session management
        connection = None
        async with AsyncSessionLocal() as db:
            query = select(RunnerConnection).where(
                RunnerConnection.id == connection_id,
                RunnerConnection.user_id == user.id,
                RunnerConnection.disconnected_at.is_(None),  # Still connected
            )
            result = await db.execute(query)
            connection = result.scalar_one_or_none()

        if not connection:
            logger.warning(
                "frontend_runner_command_ws_connection_not_found",
                connection_id=connection_id,
                user_id=str(user.id),
            )
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Runner connection not found or not owned by you",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get runner connection manager
        redis_client = await get_redis()
        manager = await get_runner_connection_manager(redis_client)

        # Connect frontend to runner
        runner_connected = manager.is_runner_connected(connection_id)
        await manager.connect_frontend(connection_id, websocket, user.id)

        logger.info(
            "frontend_runner_command_ws_connected",
            connection_id=connection_id,
            user_id=str(user.id),
            runner_connected=runner_connected,
        )

        # Send connection acknowledgment
        await websocket.send_json(
            {
                "type": "connected",
                "connection_id": connection_id,
                "runner_connected": runner_connected,
                "timestamp": datetime.now(UTC).isoformat() + "Z",
            }
        )

        if not runner_connected:
            logger.warning(
                "frontend_runner_command_ws_runner_not_connected",
                connection_id=connection_id,
                user_id=str(user.id),
            )
            await websocket.send_json(
                {
                    "type": "warning",
                    "message": "Runner is not currently connected. Commands will be queued until runner reconnects.",
                }
            )

        # Main message loop
        logger.info(
            "frontend_runner_command_ws_entering_loop",
            connection_id=connection_id,
            user_id=str(user.id),
            runner_connected=runner_connected,
        )
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)

                try:
                    message = CommandMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {"type": "error", "message": f"Invalid message format: {e}"}
                    )
                    continue

                if message.type == "ping":
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": datetime.now(UTC).isoformat() + "Z",
                        }
                    )

                elif message.type == "command":
                    # Forward command to runner
                    command_msg = {
                        "type": "command",
                        "command": message.command,
                        "params": message.params,
                        "timestamp": datetime.now(UTC).isoformat() + "Z",
                    }

                    sent = await manager.send_command_to_runner(
                        connection_id, command_msg
                    )

                    if sent:
                        await websocket.send_json(
                            {
                                "type": "command_sent",
                                "command": message.command,
                                "timestamp": datetime.now(UTC).isoformat() + "Z",
                            }
                        )
                        logger.info(
                            "command_sent_to_runner",
                            connection_id=connection_id,
                            command=message.command,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot send command.",
                            }
                        )

                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message.type}",
                        }
                    )

            except TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": datetime.now(UTC).isoformat() + "Z",
                        }
                    )
                except Exception:
                    break

            except WebSocketDisconnect:
                logger.info(
                    "frontend_runner_command_ws_disconnected",
                    connection_id=connection_id,
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "frontend_runner_command_ws_error",
                    connection_id=connection_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {"type": "error", "message": f"Error: {e}"}
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "frontend_runner_command_ws_fatal",
            connection_id=connection_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cleanup
        logger.info(
            "frontend_runner_command_ws_cleanup_start",
            connection_id=connection_id,
            user_id=str(user.id) if user else None,
        )
        if manager:
            await manager.disconnect_frontend(connection_id, websocket)

        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "frontend_runner_command_ws_cleanup",
            connection_id=connection_id,
        )
