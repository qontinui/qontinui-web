"""
WebSocket endpoint for mobile-to-runner chat communication.

Allows mobile clients to send chat messages to connected desktop runners
and receive real-time chat responses.
"""

import asyncio
from datetime import datetime

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ValidationError
from sqlalchemy import select

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.runner_connection import RunnerConnection
from app.models.user import User
from app.services.runner_connection_manager import get_runner_connection_manager

router = APIRouter()
logger = structlog.get_logger(__name__)


class ChatMessage(BaseModel):
    """Message format for mobile-to-runner chat."""

    type: str
    content: str | None = None
    task_run_id: str | None = None
    params: dict = {}


@router.websocket("/ws/runner/chat/{connection_id}")
async def websocket_runner_chat_endpoint(
    websocket: WebSocket,
    connection_id: int,
    token: str | None = None,
):
    """
    WebSocket endpoint for mobile to send chat messages to a connected runner.

    Connection URL:
        ws://localhost:8000/api/v1/automation/ws/runner/chat/{connection_id}?token=<jwt>

    Path Parameters:
        connection_id: Runner connection ID (from the runner_connections table)

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - chat_message: Send a chat message to the runner
          {"type": "chat_message", "content": "Hello", "task_run_id": "..."}

        - chat_create: Create a new chat session on the runner
          {"type": "chat_create", "params": {"task_name": "My Chat"}}

        - chat_list_running: List running task runs on the runner
          {"type": "chat_list_running"}

        - chat_session_state: Request session state for a task run
          {"type": "chat_session_state", "params": {"task_run_id": "..."}}

        - ping: Keep connection alive
          {"type": "ping"}

    Message Types (Server -> Client):
        - connected: Connection established
          {"type": "connected", "connection_id": 123, "runner_connected": true}

        - chat_sent: Chat message forwarded to runner
          {"type": "chat_sent", "timestamp": "..."}

        - chat_response: Response from runner
          {... runner chat response ...}

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
        "mobile_runner_chat_ws_pre_accept",
        connection_id=connection_id,
        token_present=token is not None,
    )
    await websocket.accept()

    logger.info(
        "mobile_runner_chat_ws_accepted",
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
            logger.error("mobile_runner_chat_ws_no_token")
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
            logger.error("mobile_runner_chat_ws_auth_failed", error=str(e))
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
                "mobile_runner_chat_ws_connection_not_found",
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

        # Connect mobile chat to runner
        runner_connected = manager.is_runner_connected(connection_id)
        await manager.connect_mobile_chat(connection_id, websocket, user.id)

        logger.info(
            "mobile_runner_chat_ws_connected",
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
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

        if not runner_connected:
            logger.warning(
                "mobile_runner_chat_ws_runner_not_connected",
                connection_id=connection_id,
                user_id=str(user.id),
            )
            await websocket.send_json(
                {
                    "type": "warning",
                    "message": "Runner is not currently connected. Messages will be queued until runner reconnects.",
                }
            )

        # Main message loop
        logger.info(
            "mobile_runner_chat_ws_entering_loop",
            connection_id=connection_id,
            user_id=str(user.id),
            runner_connected=runner_connected,
        )
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)

                try:
                    message = ChatMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {"type": "error", "message": f"Invalid message format: {e}"}
                    )
                    continue

                if message.type == "ping":
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message.type == "chat_message":
                    # Forward chat message to runner
                    chat_msg = {
                        "type": "chat_message",
                        "task_run_id": message.task_run_id,
                        "content": message.content,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    }

                    sent = await manager.send_chat_to_runner(connection_id, chat_msg)

                    if sent:
                        await websocket.send_json(
                            {
                                "type": "chat_sent",
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            }
                        )
                        logger.info(
                            "chat_message_sent_to_runner",
                            connection_id=connection_id,
                            task_run_id=message.task_run_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot send chat message.",
                            }
                        )

                elif message.type == "chat_create":
                    # Create a new chat session on the runner
                    create_msg = {
                        "type": "chat_create",
                        "task_name": message.params.get("task_name", "Mobile Chat"),
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    }

                    sent = await manager.send_chat_to_runner(connection_id, create_msg)

                    if sent:
                        await websocket.send_json(
                            {
                                "type": "chat_create_sent",
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            }
                        )
                        logger.info(
                            "chat_create_sent_to_runner",
                            connection_id=connection_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot create chat session.",
                            }
                        )

                elif message.type == "chat_list_running":
                    # Request list of running task runs from runner
                    list_msg = {
                        "type": "chat_list_running",
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    }

                    sent = await manager.send_chat_to_runner(connection_id, list_msg)

                    if sent:
                        logger.info(
                            "chat_list_running_sent_to_runner",
                            connection_id=connection_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot list running tasks.",
                            }
                        )

                elif message.type == "chat_session_state":
                    # Request session state for a task run
                    state_msg = {
                        "type": "chat_session_state",
                        "task_run_id": message.params.get("task_run_id"),
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    }

                    sent = await manager.send_chat_to_runner(connection_id, state_msg)

                    if sent:
                        logger.info(
                            "chat_session_state_sent_to_runner",
                            connection_id=connection_id,
                            task_run_id=message.params.get("task_run_id"),
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot get session state.",
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
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                except Exception:
                    break

            except WebSocketDisconnect:
                logger.info(
                    "mobile_runner_chat_ws_disconnected",
                    connection_id=connection_id,
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "mobile_runner_chat_ws_error",
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
            "mobile_runner_chat_ws_fatal",
            connection_id=connection_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cleanup
        logger.info(
            "mobile_runner_chat_ws_cleanup_start",
            connection_id=connection_id,
            user_id=str(user.id) if user else None,
        )
        if manager:
            await manager.disconnect_mobile_chat(connection_id, websocket)

        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "mobile_runner_chat_ws_cleanup",
            connection_id=connection_id,
        )
