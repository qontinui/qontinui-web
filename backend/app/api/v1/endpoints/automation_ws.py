"""WebSocket endpoints for automation streaming.

Provides real-time automation monitoring, log streaming, and session management.

This module provides the WebSocket route definitions and delegates business logic
to specialized handler modules in app.websockets.automation.
"""

import asyncio
from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.automation_session import AutomationSession
from app.services.websocket_manager import get_websocket_manager
from app.websockets.automation import ConnectionHandler, MessageRouter, make_timestamp
from app.websockets.rate_limiter import RateLimiter

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.websocket("/ws/automation/runner")
async def websocket_runner_endpoint(
    websocket: WebSocket,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for automation runner streaming.

    Connection URL:
        ws://localhost:8000/api/v1/automation/ws/automation/runner?token=<jwt_token>

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - session_start: Start new automation session
          {"type": "session_start", "data": {"workflow_name": "LoginFlow"}}

        - log: Send automation log
          {"type": "log", "data": {"level": "info", "message": "Action completed"}}

        - screenshot: Send screenshot with metadata
          {"type": "screenshot", "data": {"image": "base64...", "metadata": {...}}}

        - input_event: Send input event (mouse, keyboard)
          {"type": "input_event", "data": {"event_type": "mouse.clicked", ...}}

        - session_end: End automation session
          {"type": "session_end", "data": {"status": "success"}}

        - heartbeat: Keep connection alive
          {"type": "heartbeat"}

    Message Types (Server -> Client):
        - session_started: Session created successfully
        - session_ended: Session completed
        - error: Error message
        - heartbeat_ack: Heartbeat acknowledgment
        - policy_violation: Streaming not enabled or limit reached

    Features:
        - Authentication and authorization
        - User streaming settings enforcement
        - Monthly session limit tracking
        - Automatic heartbeat/ping-pong
        - Graceful disconnect handling
        - Rate limiting: 5 connections per minute per IP, 60 messages per minute
    """
    # Create connection handler
    connection = ConnectionHandler(websocket, token)

    # Check connection rate limit
    if not await connection.check_rate_limit():
        return

    # Accept the connection
    await connection.accept_connection()

    try:
        # Authenticate user
        if not await connection.authenticate():
            return

        # Set up database session
        if not await connection.setup_database():
            return

        # Check streaming permissions
        if not await connection.check_streaming_permissions():
            return

        # Check session limits
        if not await connection.check_session_limits():
            return

        # Register runner with connection manager
        await connection.register_runner()

        # Send connection acknowledgment
        await connection.send_connected_ack()

        # Create session manager and message router
        assert connection.session_manager is not None
        router_handler = MessageRouter(connection, connection.session_manager)

        # Main message loop
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=120.0,
                )

                # Check message rate limit
                if not RateLimiter.check_message_rate_limit(
                    connection.session_key,
                    limit=60,
                    window=60,
                ):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": (
                                "Message rate limit exceeded. "
                                "Maximum 60 messages per minute."
                            ),
                        }
                    )
                    logger.warning(
                        "websocket_message_rate_limited",
                        user_id=str(connection.user.id) if connection.user else None,
                        session_key=connection.session_key,
                        limit=60,
                    )
                    continue

                # Route message to appropriate handler
                response = await router_handler.route_message(data)

                # Send response if one was returned
                if response is not None:
                    await websocket.send_json(response)

            except TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": make_timestamp(),
                        }
                    )
                except Exception:
                    break

            except WebSocketDisconnect:
                logger.info(
                    "automation_ws_client_disconnected",
                    user_id=str(connection.user.id) if connection.user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "automation_ws_message_error",
                    user_id=str(connection.user.id) if connection.user else None,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Message processing error: {str(e)}",
                        }
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "automation_ws_fatal_error",
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        await connection.cleanup()


@router.websocket("/ws/automation/monitor/{session_id}")
async def websocket_monitor_endpoint(
    websocket: WebSocket,
    session_id: str,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for monitoring automation sessions in real-time.

    This endpoint demonstrates the Redis Pub/Sub scalability feature.
    Multiple backend instances can broadcast events, and all connected
    clients receive them through Redis channels.

    Connection URL:
        ws://localhost:8000/api/v1/ws/automation/monitor/{session_id}?token=<jwt>

    Query Parameters:
        token: JWT access token for authentication

    Path Parameters:
        session_id: Automation session ID to monitor

    Message Types (Server -> Client):
        - session_event: Real-time events from automation session
          {"type": "session_event", "event": {...}, "timestamp": "..."}

        - connection_info: Connection status and statistics
          {"type": "connection_info", "session_id": "...", "connections": 2, ...}

        - error: Error message
          {"type": "error", "message": "..."}

    Message Types (Client -> Server):
        - ping: Keep connection alive
          {"type": "ping"}

        - request_status: Request session status
          {"type": "request_status"}

    Features:
        - Redis Pub/Sub for horizontal scaling
        - Real-time event broadcasting across instances
        - Automatic connection management
        - Graceful disconnect handling
        - Rate limiting: 5 connections per minute per IP, 60 messages per minute
    """
    # Check connection rate limit
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not RateLimiter.check_connection_rate_limit(client_ip, limit=5, window=60):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Connection rate limit exceeded. Maximum 5 connections per minute.",
        )
        logger.warning(
            "websocket_monitor_connection_rate_limited",
            client_ip=client_ip,
            session_id=session_id,
            limit=5,
            window=60,
        )
        return

    await websocket.accept()

    logger.info(
        "automation_monitor_ws_connection_attempt",
        session_id=session_id,
    )

    db = None
    user = None
    ws_manager = None
    session_key = f"ws_monitor_{id(websocket)}"

    try:
        # Authenticate user
        auth_token = token or websocket.cookies.get("access_token")

        if auth_token:
            logger.info("automation_monitor_ws_using_cookie_auth")

        if not auth_token:
            logger.error(
                "automation_monitor_ws_no_token",
                error="No token in query param or cookies",
            )
            await websocket.send_json(
                {
                    "type": "error",
                    "message": (
                        "Authentication required. "
                        "Provide token query param or access_token cookie."
                    ),
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("automation_monitor_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication failed",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get database session - use AsyncSessionLocal directly to avoid generator lifecycle issues
        try:
            db = AsyncSessionLocal()
        except Exception as e:
            logger.error("automation_monitor_ws_db_create_failed", error=str(e))
            db = None

        if not db:
            logger.error("automation_monitor_ws_db_failed")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Database connection failed",
                }
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Verify session exists
        session_query = select(AutomationSession).where(
            AutomationSession.id == UUID(session_id)
        )
        session_result = await db.execute(session_query)
        session = session_result.scalar_one_or_none()

        if not session:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Automation session '{session_id}' not found",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get Redis client and WebSocket manager
        redis_client = await get_redis()
        ws_manager = await get_websocket_manager(redis_client)

        # Register connection with WebSocket manager
        await ws_manager.connect(session_id, websocket)

        logger.info(
            "automation_monitor_ws_connected",
            user_id=str(user.id),
            username=user.username,
            session_id=session_id,
            total_connections=ws_manager.get_connection_count(session_id),
        )

        # Send connection acknowledgment
        await websocket.send_json(
            {
                "type": "connected",
                "session_id": session_id,
                "user_id": str(user.id),
                "username": user.username,
                "local_connections": ws_manager.get_connection_count(session_id),
                "timestamp": make_timestamp(),
            }
        )

        # Broadcast connection event
        await ws_manager.broadcast(
            session_id,
            {
                "type": "connection_info",
                "action": "user_joined",
                "user_id": str(user.id),
                "username": user.username,
                "timestamp": make_timestamp(),
            },
        )

        # Main message loop
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=120.0,
                )

                # Check message rate limit
                if not RateLimiter.check_message_rate_limit(
                    session_key,
                    limit=60,
                    window=60,
                ):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": (
                                "Message rate limit exceeded. "
                                "Maximum 60 messages per minute."
                            ),
                        }
                    )
                    logger.warning(
                        "websocket_monitor_message_rate_limited",
                        user_id=str(user.id) if user else None,
                        session_id=session_id,
                        session_key=session_key,
                        limit=60,
                    )
                    continue

                message_type = data.get("type")

                if message_type == "ping":
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": make_timestamp(),
                        }
                    )

                elif message_type == "request_status":
                    await websocket.send_json(
                        {
                            "type": "status",
                            "session_id": session_id,
                            "local_connections": ws_manager.get_connection_count(
                                session_id
                            ),
                            "total_sessions": len(ws_manager.get_active_sessions()),
                            "timestamp": make_timestamp(),
                        }
                    )

                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message_type}",
                        }
                    )

            except TimeoutError:
                try:
                    await websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": make_timestamp(),
                        }
                    )
                except Exception:
                    break

            except WebSocketDisconnect:
                logger.info(
                    "automation_monitor_ws_client_disconnected",
                    user_id=str(user.id) if user else None,
                    session_id=session_id,
                )
                break

            except Exception as e:
                logger.error(
                    "automation_monitor_ws_message_error",
                    user_id=str(user.id) if user else None,
                    session_id=session_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Message processing error: {str(e)}",
                        }
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "automation_monitor_ws_fatal_error",
            session_id=session_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Clean up rate limiting state
        RateLimiter.cleanup_session(session_key)

        # Disconnect from WebSocket manager
        if ws_manager:
            try:
                await ws_manager.disconnect(session_id, websocket)

                # Broadcast disconnection event
                await ws_manager.broadcast(
                    session_id,
                    {
                        "type": "connection_info",
                        "action": "user_left",
                        "user_id": str(user.id) if user else "unknown",
                        "username": user.username if user else "unknown",
                        "timestamp": make_timestamp(),
                    },
                )

                logger.info(
                    "automation_monitor_ws_disconnected",
                    user_id=str(user.id) if user else None,
                    session_id=session_id,
                )
            except Exception as e:
                logger.error(
                    "automation_monitor_ws_disconnect_failed",
                    session_id=session_id,
                    error=str(e),
                )

        # Cleanup
        if db:
            try:
                await db.close()
            except Exception:
                pass

        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "automation_monitor_ws_cleanup_complete",
            user_id=str(user.id) if user else None,
            session_id=session_id,
        )
