"""
WebSocket endpoints for live test streaming.

Provides real-time test result streaming between runners and dashboard clients.
Runners connect to stream test results, dashboard clients connect to receive updates.
"""

import time
from collections import defaultdict
from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from qontinui_schemas.common import utc_now
from sqlalchemy import select

from app.api.deps import get_async_db, get_current_user_from_ws
from app.config.redis_config import get_redis
from app.models.project import Project
from app.models.user import User
from app.services.websocket_manager import get_websocket_manager

router = APIRouter()
logger = structlog.get_logger(__name__)

# Rate limiting state (in-memory for WebSocket connections)
_connection_attempts: dict[str, list[float]] = defaultdict(list)


def check_connection_rate_limit(
    ip_address: str, limit: int = 10, window: int = 60
) -> bool:
    """
    Check if an IP address has exceeded the connection rate limit.

    Args:
        ip_address: Client IP address
        limit: Maximum connections allowed within the window
        window: Time window in seconds

    Returns:
        True if within limit, False if limit exceeded
    """
    current_time = time.time()
    cutoff_time = current_time - window

    # Clean old attempts
    _connection_attempts[ip_address] = [
        t for t in _connection_attempts[ip_address] if t > cutoff_time
    ]

    # Check if limit exceeded
    if len(_connection_attempts[ip_address]) >= limit:
        return False

    # Record this attempt
    _connection_attempts[ip_address].append(current_time)
    return True


@router.websocket("/ws/runner/{runner_id}")
async def websocket_runner_endpoint(
    websocket: WebSocket,
    runner_id: str,
    token: str | None = None,
):
    """
    WebSocket endpoint for runners to stream test results.

    Runners connect to this endpoint to send real-time test execution updates
    which are broadcast to dashboard clients via Redis pub/sub.

    Connection URL:
        ws://localhost:8000/api/v1/ws/runner/{runner_id}?token=<token>

    Path Parameters:
        runner_id: Unique identifier for the runner instance

    Query Parameters:
        token: Runner token or JWT access token for authentication

    Message Flow:
        Runner -> This endpoint -> Redis pub/sub -> Dashboard clients

    Message Format:
        {
            "type": "test_update" | "test_complete" | "test_error",
            "data": {...},
            "timestamp": "2024-01-15T10:30:00Z"
        }

    Features:
        - Authentication via runner token or JWT
        - Real-time broadcasting to dashboard clients
        - Rate limiting: 10 connections/min per IP
        - Automatic reconnection support
    """
    # Check connection rate limit
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_connection_rate_limit(client_ip, limit=10, window=60):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Connection rate limit exceeded. Maximum 10 connections per minute.",
        )
        logger.warning(
            "ws_runner_connection_rate_limited",
            client_ip=client_ip,
            runner_id=runner_id,
        )
        return

    await websocket.accept()

    logger.info(
        "ws_runner_connection_attempt",
        client_ip=client_ip,
        runner_id=runner_id,
    )

    user = None
    ws_manager = None

    try:
        # Authenticate user (JWT)
        auth_token: str | None = token
        if not auth_token:
            auth_token = websocket.cookies.get("access_token")

        if not auth_token:
            logger.error("ws_runner_no_token", runner_id=runner_id)
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication required. Provide token query param or access_token cookie.",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error(
                "ws_runner_auth_failed",
                runner_id=runner_id,
                error=str(e),
            )
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication failed",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        logger.info(
            "ws_runner_connected",
            user_id=str(user.id),
            runner_id=runner_id,
            auth_method="jwt",
        )

        # Send connection acknowledgment
        await websocket.send_json(
            {
                "type": "connected",
                "runner_id": runner_id,
                "user_id": str(user.id),
                "timestamp": utc_now().isoformat() + "Z",
            }
        )

        # Get WebSocket manager for broadcasting
        redis_client = await get_redis()
        ws_manager = await get_websocket_manager(redis_client)

        # Register runner connection with WebSocket manager
        # Use runner_id as the session_id for broadcasting
        await ws_manager.connect(runner_id, websocket)

        # Main message loop - receive from runner and broadcast
        while True:
            try:
                # Receive message from runner
                data = await websocket.receive_json()

                # Add timestamp if not present
                if "timestamp" not in data:
                    data["timestamp"] = utc_now().isoformat() + "Z"

                # Validate message has required fields
                if "type" not in data:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Message must have 'type' field",
                            "timestamp": utc_now().isoformat() + "Z",
                        }
                    )
                    continue

                # Broadcast to dashboard clients via Redis
                # The broadcast will be received by all backend instances
                await ws_manager.broadcast(runner_id, data)

                logger.debug(
                    "ws_runner_message_broadcast",
                    runner_id=runner_id,
                    message_type=data.get("type"),
                )

                # Send acknowledgment
                await websocket.send_json(
                    {
                        "type": "ack",
                        "timestamp": utc_now().isoformat() + "Z",
                    }
                )

            except WebSocketDisconnect:
                logger.info(
                    "ws_runner_client_disconnected",
                    runner_id=runner_id,
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "ws_runner_message_error",
                    runner_id=runner_id,
                    user_id=str(user.id) if user else None,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Message processing error: {str(e)}",
                            "timestamp": utc_now().isoformat() + "Z",
                        }
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "ws_runner_fatal_error",
            runner_id=runner_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Disconnect from WebSocket manager
        if ws_manager:
            await ws_manager.disconnect(runner_id, websocket)

        # Close websocket
        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "ws_runner_cleanup_complete",
            runner_id=runner_id,
            user_id=str(user.id) if user else None,
        )


@router.websocket("/ws/dashboard/{project_id}")
async def websocket_dashboard_endpoint(
    websocket: WebSocket,
    project_id: str,
    token: str | None = None,
):
    """
    WebSocket endpoint for dashboard clients to receive test updates.

    Dashboard clients connect to this endpoint to receive real-time test
    execution updates from runners via Redis pub/sub.

    Connection URL:
        ws://localhost:8000/api/v1/ws/dashboard/{project_id}?token=<token>

    Path Parameters:
        project_id: Project ID to receive updates for

    Query Parameters:
        token: JWT access token for authentication

    Message Flow:
        Runner -> Redis pub/sub -> This endpoint -> Dashboard client

    Message Format:
        {
            "type": "test_update" | "test_complete" | "test_error",
            "data": {...},
            "timestamp": "2024-01-15T10:30:00Z"
        }

    Features:
        - Authentication via JWT
        - Real-time updates from runners
        - Rate limiting: 10 connections/min per IP
        - Project-level access control
    """
    # Check connection rate limit
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_connection_rate_limit(client_ip, limit=10, window=60):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Connection rate limit exceeded. Maximum 10 connections per minute.",
        )
        logger.warning(
            "ws_dashboard_connection_rate_limited",
            client_ip=client_ip,
            project_id=project_id,
        )
        return

    await websocket.accept()

    logger.info(
        "ws_dashboard_connection_attempt",
        client_ip=client_ip,
        project_id=project_id,
    )

    db = None
    user = None
    ws_manager = None

    try:
        # Authenticate user (JWT only for dashboard)
        auth_token: str | None = token
        if not auth_token:
            auth_token = websocket.cookies.get("access_token")

        if not auth_token:
            logger.error("ws_dashboard_no_token", project_id=project_id)
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication required. Provide token query param or access_token cookie.",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error(
                "ws_dashboard_auth_failed",
                project_id=project_id,
                error=str(e),
            )
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication failed",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Verify project access
        async for db_session in get_async_db():
            db = db_session
            break

        if not db:
            logger.error("ws_dashboard_db_failed", project_id=project_id)
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Database connection failed",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Parse project_id
        try:
            project_uuid = UUID(project_id)
        except ValueError:
            logger.error(
                "ws_dashboard_invalid_project_id",
                project_id=project_id,
            )
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Invalid project ID format",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Verify project exists and user has access
        from sqlalchemy.sql import Select

        user_org_subquery: Select = select(User.personal_org_id).where(
            User.id == user.id
        )  # type: ignore[arg-type]
        project_query = select(Project).where(
            Project.id == project_uuid,
            Project.organization_id.in_(user_org_subquery),
        )
        project_result = await db.execute(project_query)
        project = project_result.scalar_one_or_none()

        if not project:
            logger.error(
                "ws_dashboard_project_access_denied",
                project_id=project_id,
                user_id=str(user.id),
            )
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Project not found or access denied",
                    "timestamp": utc_now().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        logger.info(
            "ws_dashboard_connected",
            user_id=str(user.id),
            project_id=project_id,
        )

        # Send connection acknowledgment
        await websocket.send_json(
            {
                "type": "connected",
                "project_id": project_id,
                "timestamp": utc_now().isoformat() + "Z",
            }
        )

        # Get WebSocket manager for receiving broadcasts
        redis_client = await get_redis()
        ws_manager = await get_websocket_manager(redis_client)

        # Register dashboard connection with WebSocket manager
        # Use project_id as the session_id for receiving broadcasts
        await ws_manager.connect(project_id, websocket)

        # Main message loop - keep connection alive and handle incoming messages
        # The actual test updates come from Redis via ws_manager listener
        while True:
            try:
                # Wait for client messages (heartbeat, etc.)
                data = await websocket.receive_json()

                message_type = data.get("type")

                if message_type == "heartbeat":
                    await websocket.send_json(
                        {
                            "type": "heartbeat_ack",
                            "timestamp": utc_now().isoformat() + "Z",
                        }
                    )
                else:
                    # Dashboard clients should not send other message types
                    logger.warning(
                        "ws_dashboard_unexpected_message",
                        project_id=project_id,
                        user_id=str(user.id),
                        message_type=message_type,
                    )

            except WebSocketDisconnect:
                logger.info(
                    "ws_dashboard_client_disconnected",
                    project_id=project_id,
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "ws_dashboard_message_error",
                    project_id=project_id,
                    user_id=str(user.id) if user else None,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                break

    except Exception as e:
        logger.error(
            "ws_dashboard_fatal_error",
            project_id=project_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Disconnect from WebSocket manager
        if ws_manager:
            await ws_manager.disconnect(project_id, websocket)

        # Cleanup database session
        if db:
            try:
                await db.close()
            except Exception:
                pass

        # Close websocket
        try:
            await websocket.close()
        except Exception:
            pass

        logger.info(
            "ws_dashboard_cleanup_complete",
            project_id=project_id,
            user_id=str(user.id) if user else None,
        )
