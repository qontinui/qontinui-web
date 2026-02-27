"""WebSocket endpoints for real-time admin health monitoring."""

import asyncio

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from fastapi.exceptions import HTTPException

from app.api.deps import get_current_user_from_ws
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.services.health_service import health_service

router = APIRouter()
logger = structlog.get_logger(__name__)


async def require_admin_ws(
    websocket: WebSocket,
    token: str,
) -> User:
    """
    WebSocket dependency to verify admin access.

    Args:
        websocket: WebSocket connection
        token: JWT token from query parameters

    Returns:
        User object if authenticated and is admin

    Raises:
        WebSocketException if not authenticated or not admin
    """
    try:
        # Get user from token
        user = await get_current_user_from_ws(token)

        if not user.is_superuser:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION, reason="Admin access required"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
            )

        return user
    except Exception as e:
        logger.error("ws_admin_auth_failed", error=str(e))
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Authentication failed"
        )
        raise


@router.websocket("/ws/admin/health")
async def websocket_health_monitor(
    websocket: WebSocket,
    token: str,
    interval: int = 5,
):
    """
    WebSocket endpoint for real-time health monitoring.

    Streams health updates every `interval` seconds (default: 5).

    Connection URL:
        ws://localhost:8000/api/v1/admin/ws/admin/health?token=<jwt_token>&interval=5

    Query Parameters:
        token: JWT access token for authentication
        interval: Update interval in seconds (default: 5, min: 1, max: 60)

    Message Format:
        {
            "type": "health_update",
            "data": {
                "overall_status": "healthy",
                "timestamp": "2025-01-15T10:30:00.000Z",
                "redis": {...},
                "database": {...},
                "security": {...},
                "sessions": {...},
                "system": {...}
            }
        }

    Error Messages:
        {
            "type": "error",
            "message": "Error description"
        }

    Requires superuser authentication.
    """
    await websocket.accept()

    # Validate interval
    interval = max(1, min(60, interval))

    logger.info(
        "ws_health_monitor_connected",
        interval=interval,
    )

    try:
        # Verify admin access (will close connection if not admin)
        try:
            user = await require_admin_ws(websocket, token)
        except Exception:
            return  # Connection already closed by require_admin_ws

        logger.info(
            "ws_health_monitor_authenticated",
            user_id=str(user.id),
            user_email=user.email,
            interval=interval,
        )

        # Create a new database session for each health check iteration
        # to avoid connection pool exhaustion

        while True:
            try:
                # Use AsyncSessionLocal directly with context manager for proper cleanup
                async with AsyncSessionLocal() as db:
                    # Get health overview
                    overview = await health_service.get_health_overview(db)

                    # Send update to client
                    await websocket.send_json(
                        {
                            "type": "health_update",
                            "data": overview,
                        }
                    )

                    logger.debug(
                        "ws_health_update_sent",
                        user_id=str(user.id),
                        overall_status=overview.get("overall_status"),
                    )

                # Wait for next interval
                await asyncio.sleep(interval)

            except WebSocketDisconnect:
                logger.info(
                    "ws_health_monitor_disconnected",
                    user_id=str(user.id),
                )
                break

            except Exception as e:
                logger.error(
                    "ws_health_monitor_error",
                    user_id=str(user.id),
                    error=str(e),
                    error_type=type(e).__name__,
                )

                # Send error to client
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Health check error: {str(e)}",
                        }
                    )
                except Exception:
                    # Client disconnected or send failed
                    break

                # Wait before retrying
                await asyncio.sleep(interval)

    except Exception as e:
        logger.error(
            "ws_health_monitor_fatal_error",
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/admin/health/metrics")
async def websocket_specific_metrics(
    websocket: WebSocket,
    token: str,
    metrics: str = "redis,database,security",
    interval: int = 5,
):
    """
    WebSocket endpoint for monitoring specific health metrics.

    Allows clients to subscribe to specific metrics only (lighter weight).

    Connection URL:
        ws://localhost:8000/api/v1/admin/ws/admin/health/metrics?token=<jwt_token>&metrics=redis,security&interval=5

    Query Parameters:
        token: JWT access token for authentication
        metrics: Comma-separated list of metrics to monitor
                 Options: redis, database, security, sessions, blacklist, system
        interval: Update interval in seconds (default: 5, min: 1, max: 60)

    Message Format:
        {
            "type": "metrics_update",
            "data": {
                "timestamp": "2025-01-15T10:30:00.000Z",
                "metrics": {
                    "redis": {...},
                    "security": {...}
                }
            }
        }

    Requires superuser authentication.
    """
    await websocket.accept()

    # Validate interval
    interval = max(1, min(60, interval))

    # Parse requested metrics
    requested_metrics = [m.strip().lower() for m in metrics.split(",")]
    valid_metrics = ["redis", "database", "security", "sessions", "blacklist", "system"]
    requested_metrics = [m for m in requested_metrics if m in valid_metrics]

    if not requested_metrics:
        await websocket.send_json(
            {
                "type": "error",
                "message": "No valid metrics specified. Valid options: redis, database, security, sessions, blacklist, system",
            }
        )
        await websocket.close()
        return

    logger.info(
        "ws_metrics_monitor_connected",
        metrics=requested_metrics,
        interval=interval,
    )

    try:
        # Verify admin access
        try:
            user = await require_admin_ws(websocket, token)
        except Exception:
            return

        logger.info(
            "ws_metrics_monitor_authenticated",
            user_id=str(user.id),
            user_email=user.email,
            metrics=requested_metrics,
            interval=interval,
        )

        while True:
            try:
                # Use AsyncSessionLocal directly with context manager for proper cleanup
                async with AsyncSessionLocal() as db:
                    # Collect requested metrics
                    metrics_data = {}

                    if "redis" in requested_metrics:
                        metrics_data["redis"] = await health_service.get_redis_status()

                    if "database" in requested_metrics:
                        metrics_data[
                            "database"
                        ] = await health_service.get_database_health(db)

                    if "security" in requested_metrics:
                        metrics_data[
                            "security"
                        ] = await health_service.get_security_warnings(db)

                    if "sessions" in requested_metrics:
                        metrics_data[
                            "sessions"
                        ] = await health_service.get_session_stats(db)

                    if "blacklist" in requested_metrics:
                        metrics_data[
                            "blacklist"
                        ] = await health_service.get_token_blacklist_stats(db)

                    if "system" in requested_metrics:
                        metrics_data[
                            "system"
                        ] = await health_service.get_system_metrics()

                    # Send update
                    from datetime import datetime

                    await websocket.send_json(
                        {
                            "type": "metrics_update",
                            "data": {
                                "timestamp": datetime.utcnow().isoformat(),
                                "metrics": metrics_data,
                            },
                        }
                    )

                    logger.debug(
                        "ws_metrics_update_sent",
                        user_id=str(user.id),
                        metrics=list(metrics_data.keys()),
                    )

                await asyncio.sleep(interval)

            except WebSocketDisconnect:
                logger.info(
                    "ws_metrics_monitor_disconnected",
                    user_id=str(user.id),
                )
                break

            except Exception as e:
                logger.error(
                    "ws_metrics_monitor_error",
                    user_id=str(user.id),
                    error=str(e),
                    error_type=type(e).__name__,
                )

                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Metrics check error: {str(e)}",
                        }
                    )
                except Exception:
                    break

                await asyncio.sleep(interval)

    except Exception as e:
        logger.error(
            "ws_metrics_monitor_fatal_error",
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
