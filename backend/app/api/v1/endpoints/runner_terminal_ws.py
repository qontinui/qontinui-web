"""
WebSocket endpoint for mobile-to-runner terminal communication.

Allows mobile clients to send terminal I/O to connected desktop runners
and receive real-time terminal output.
"""

import structlog
from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.runner_connection import RunnerConnection
from app.models.user import User
from app.services.runner_connection_manager import \
    get_runner_connection_manager
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, ValidationError
from qontinui_schemas.common import utc_now
from sqlalchemy import select

router = APIRouter()
logger = structlog.get_logger(__name__)


class TerminalMessage(BaseModel):
    """Message format for mobile-to-runner terminal communication."""

    type: str
    terminal_id: str | None = None
    data: str | None = None  # base64 encoded terminal input
    cols: int | None = None
    rows: int | None = None
    title: str | None = None
    working_dir: str | None = None
    request_id: str | None = None
    params: dict = Field(default_factory=dict)


@router.websocket("/ws/runner/terminal/{connection_id}")
async def websocket_runner_terminal_endpoint(
    websocket: WebSocket,
    connection_id: int,
    token: str | None = None,
):
    """
    WebSocket endpoint for mobile to send terminal I/O to a connected runner.

    Connection URL:
        ws://localhost:8000/api/v1/automation/ws/runner/terminal/{connection_id}?token=<jwt>

    Path Parameters:
        connection_id: Runner connection ID (from the runner_connections table)

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - terminal_input: Send keyboard input to a terminal session
          {"type": "terminal_input", "terminal_id": "...", "data": "<base64>"}

        - terminal_resize: Resize a terminal session
          {"type": "terminal_resize", "terminal_id": "...", "cols": 80, "rows": 24}

        - terminal_create: Create a new terminal session
          {"type": "terminal_create", "title": "...", "working_dir": "...", "cols": 80, "rows": 24, "request_id": "..."}

        - terminal_list: List all terminal sessions
          {"type": "terminal_list", "request_id": "..."}

        - terminal_close: Close a terminal session
          {"type": "terminal_close", "terminal_id": "...", "request_id": "..."}

        - terminal_buffer: Request terminal buffer/history
          {"type": "terminal_buffer", "terminal_id": "...", "request_id": "..."}

        - ping: Keep connection alive
          {"type": "ping"}

    Message Types (Server -> Client):
        - connected: Connection established
          {"type": "connected", "connection_id": 123, "runner_connected": true}

        - terminal_output: Terminal output data from runner
          {"type": "terminal_output", "terminal_id": "...", "data": "<base64>"}

        - terminal_created: New terminal session created
          {"type": "terminal_created", "terminal": {...}, "request_id": "..."}

        - terminal_sessions: List of terminal sessions
          {"type": "terminal_sessions", "terminals": [...], "request_id": "..."}

        - terminal_closed: Terminal session closed
          {"type": "terminal_closed", "terminal_id": "...", "request_id": "..."}

        - terminal_exit: Terminal process exited
          {"type": "terminal_exit", "terminal_id": "..."}

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
        "mobile_runner_terminal_ws_pre_accept",
        connection_id=connection_id,
        token_present=token is not None,
    )
    await websocket.accept()

    logger.info(
        "mobile_runner_terminal_ws_accepted",
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
            logger.error("mobile_runner_terminal_ws_no_token")
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
            logger.error("mobile_runner_terminal_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {"type": "error", "message": "Authentication failed"}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Verify connection exists and belongs to user
        connection = None
        async with AsyncSessionLocal() as db:
            query = select(RunnerConnection).where(
                RunnerConnection.id == connection_id,
                RunnerConnection.user_id == user.id,
                RunnerConnection.disconnected_at.is_(None),
            )
            result = await db.execute(query)
            connection = result.scalar_one_or_none()

        if not connection:
            logger.warning(
                "mobile_runner_terminal_ws_connection_not_found",
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

        # Connect mobile terminal to runner
        runner_connected = await manager.connect_mobile_terminal(
            connection_id, websocket, user.id
        )

        logger.info(
            "mobile_runner_terminal_ws_connected",
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
                "timestamp": utc_now().isoformat(),
            }
        )

        if not runner_connected:
            logger.warning(
                "mobile_runner_terminal_ws_runner_not_connected",
                connection_id=connection_id,
                user_id=str(user.id),
            )
            await websocket.send_json(
                {
                    "type": "warning",
                    "message": "Runner is not currently connected. Terminal commands cannot be delivered until the runner reconnects.",
                }
            )

        # Main message loop
        logger.info(
            "mobile_runner_terminal_ws_entering_loop",
            connection_id=connection_id,
            user_id=str(user.id),
            runner_connected=runner_connected,
        )
        while True:
            try:
                data = await websocket.receive_json()

                try:
                    message = TerminalMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {"type": "error", "message": f"Invalid message format: {e}"}
                    )
                    continue

                if message.type == "ping":
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": utc_now().isoformat(),
                        }
                    )

                elif message.type == "terminal_input":
                    if not message.terminal_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"terminal_id is required for {message.type}",
                            }
                        )
                        continue

                    # Forward terminal input to runner (fire-and-forget, no ack)
                    input_msg = {
                        "type": "terminal_input",
                        "terminal_id": message.terminal_id,
                        "data": message.data,
                        "timestamp": utc_now().isoformat(),
                    }

                    sent = await manager.send_terminal_to_runner(
                        connection_id, input_msg
                    )

                    if not sent:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot send terminal input.",
                            }
                        )

                elif message.type == "terminal_resize":
                    if not message.terminal_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"terminal_id is required for {message.type}",
                            }
                        )
                        continue

                    # Forward resize to runner (fire-and-forget, no ack)
                    resize_msg = {
                        "type": "terminal_resize",
                        "terminal_id": message.terminal_id,
                        "cols": message.cols,
                        "rows": message.rows,
                        "timestamp": utc_now().isoformat(),
                    }

                    sent = await manager.send_terminal_to_runner(
                        connection_id, resize_msg
                    )

                    if not sent:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot resize terminal.",
                            }
                        )

                elif message.type == "terminal_create":
                    # Create a new terminal session on the runner
                    create_msg = {
                        "type": "terminal_create",
                        "title": message.title,
                        "working_dir": message.working_dir,
                        "cols": message.cols if message.cols is not None else 80,
                        "rows": message.rows if message.rows is not None else 24,
                        "request_id": message.request_id,
                        "timestamp": utc_now().isoformat(),
                    }

                    sent = await manager.send_terminal_to_runner(
                        connection_id, create_msg
                    )

                    if sent:
                        logger.info(
                            "terminal_create_sent_to_runner",
                            connection_id=connection_id,
                            request_id=message.request_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot create terminal.",
                                "request_id": message.request_id,
                            }
                        )

                elif message.type == "terminal_list":
                    # Request list of terminal sessions from runner
                    list_msg = {
                        "type": "terminal_list",
                        "request_id": message.request_id,
                        "timestamp": utc_now().isoformat(),
                    }

                    sent = await manager.send_terminal_to_runner(
                        connection_id, list_msg
                    )

                    if sent:
                        logger.info(
                            "terminal_list_sent_to_runner",
                            connection_id=connection_id,
                            request_id=message.request_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot list terminals.",
                                "request_id": message.request_id,
                            }
                        )

                elif message.type == "terminal_close":
                    if not message.terminal_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"terminal_id is required for {message.type}",
                            }
                        )
                        continue

                    # Close a terminal session on the runner
                    close_msg = {
                        "type": "terminal_close",
                        "terminal_id": message.terminal_id,
                        "request_id": message.request_id,
                        "timestamp": utc_now().isoformat(),
                    }

                    sent = await manager.send_terminal_to_runner(
                        connection_id, close_msg
                    )

                    if sent:
                        logger.info(
                            "terminal_close_sent_to_runner",
                            connection_id=connection_id,
                            terminal_id=message.terminal_id,
                            request_id=message.request_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot close terminal.",
                                "request_id": message.request_id,
                            }
                        )

                elif message.type == "terminal_buffer":
                    if not message.terminal_id:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"terminal_id is required for {message.type}",
                            }
                        )
                        continue

                    # Request terminal buffer/history from runner
                    buffer_msg = {
                        "type": "terminal_buffer",
                        "terminal_id": message.terminal_id,
                        "request_id": message.request_id,
                        "timestamp": utc_now().isoformat(),
                    }

                    sent = await manager.send_terminal_to_runner(
                        connection_id, buffer_msg
                    )

                    if sent:
                        logger.info(
                            "terminal_buffer_sent_to_runner",
                            connection_id=connection_id,
                            terminal_id=message.terminal_id,
                            request_id=message.request_id,
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot get terminal buffer.",
                                "request_id": message.request_id,
                            }
                        )

                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message.type}",
                        }
                    )

            except WebSocketDisconnect:
                logger.info(
                    "mobile_runner_terminal_ws_disconnected",
                    connection_id=connection_id,
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "mobile_runner_terminal_ws_error",
                    connection_id=connection_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Internal server error processing terminal message",
                        }
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "mobile_runner_terminal_ws_fatal",
            connection_id=connection_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cleanup
        logger.info(
            "mobile_runner_terminal_ws_cleanup_start",
            connection_id=connection_id,
            user_id=str(user.id) if user else None,
        )
        if manager:
            await manager.disconnect_mobile_terminal(connection_id, websocket)

        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "mobile_runner_terminal_ws_cleanup",
            connection_id=connection_id,
        )
