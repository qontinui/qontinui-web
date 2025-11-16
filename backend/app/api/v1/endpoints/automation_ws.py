"""
WebSocket endpoints for automation streaming.

Provides real-time automation monitoring, log streaming, and session management.
"""

import asyncio
from datetime import datetime
from typing import Any, Optional

import structlog
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ValidationError

from app.api.deps import get_async_db, get_current_user_from_ws
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)


# WebSocket message schemas
class WSMessage(BaseModel):
    """Base WebSocket message."""

    type: str
    data: dict = {}


@router.websocket("/ws/automation/runner")
async def websocket_runner_endpoint(
    websocket: WebSocket,
    token: str,
):
    """
    WebSocket endpoint for automation runner streaming.

    Connection URL:
        ws://localhost:8000/api/v1/ws/automation/runner?token=<jwt_token>

    Query Parameters:
        token: JWT access token for authentication

    Message Types (Client -> Server):
        - session_start: Start new automation session
          {"type": "session_start", "data": {"workflow_name": "LoginFlow"}}

        - log: Send automation log
          {"type": "log", "data": {"level": "info", "message": "Action completed"}}

        - screenshot: Send screenshot with metadata
          {"type": "screenshot", "data": {"image": "base64...", "metadata": {...}}}

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
    """
    await websocket.accept()

    logger.info("automation_ws_connection_attempt")

    db = None
    user = None
    session_started = False

    try:
        # Authenticate user
        try:
            user = await get_current_user_from_ws(token)
        except Exception as e:
            logger.error("automation_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication failed",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get database session
        async for db_session in get_async_db():
            db = db_session
            break

        if not db:
            logger.error("automation_ws_db_failed")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Database connection failed",
                }
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Refresh user to get latest settings
        await db.refresh(user)

        # Check if streaming is enabled for this user
        if not user.automation_streaming_enabled:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Automation streaming is not enabled for your account. Enable it in your account settings."
            )
            return

        # Check session limit (if applicable)
        if user.automation_sessions_limit is not None:
            # Check if we need to reset monthly limit
            if user.automation_sessions_reset_at and datetime.utcnow() > user.automation_sessions_reset_at:
                # Reset for new month
                user.automation_sessions_used = 0
                user.automation_sessions_reset_at = datetime.utcnow() + relativedelta(months=1)
                await db.commit()
                await db.refresh(user)

            # Check if limit reached
            if user.automation_sessions_used >= user.automation_sessions_limit:
                await websocket.close(
                    code=status.WS_1008_POLICY_VIOLATION,
                    reason=f"Monthly automation streaming limit reached ({user.automation_sessions_limit} sessions). Limit resets on the 1st of each month."
                )
                return

        logger.info(
            "automation_ws_connected",
            user_id=str(user.id),
            username=user.username,
            streaming_enabled=user.automation_streaming_enabled,
            sessions_limit=user.automation_sessions_limit,
            sessions_used=user.automation_sessions_used,
        )

        # Send connection acknowledgment
        await websocket.send_json(
            {
                "type": "connected",
                "user_id": str(user.id),
                "username": user.username,
                "sessions_remaining": (
                    user.automation_sessions_limit - user.automation_sessions_used
                    if user.automation_sessions_limit is not None
                    else None
                ),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

        # Main message loop
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)

                # Validate message
                try:
                    message = WSMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Invalid message format: {str(e)}",
                        }
                    )
                    continue

                # Handle message types
                message_type = message.type

                if message_type == "heartbeat":
                    # Acknowledge heartbeat
                    await websocket.send_json(
                        {
                            "type": "heartbeat_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "session_start":
                    # Start new session
                    if session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Session already started. End current session first.",
                            }
                        )
                        continue

                    # Increment sessions used if limit applies
                    if user.automation_sessions_limit is not None:
                        user.automation_sessions_used += 1
                        await db.commit()
                        await db.refresh(user)

                    session_started = True

                    workflow_name = message.data.get("workflow_name", "Unknown")

                    logger.info(
                        "automation_session_started",
                        user_id=str(user.id),
                        workflow_name=workflow_name,
                        sessions_used=user.automation_sessions_used,
                    )

                    await websocket.send_json(
                        {
                            "type": "session_started",
                            "workflow_name": workflow_name,
                            "sessions_used": user.automation_sessions_used,
                            "sessions_remaining": (
                                user.automation_sessions_limit - user.automation_sessions_used
                                if user.automation_sessions_limit is not None
                                else None
                            ),
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "session_end":
                    # End session
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session to end.",
                            }
                        )
                        continue

                    session_status = message.data.get("status", "completed")

                    logger.info(
                        "automation_session_ended",
                        user_id=str(user.id),
                        status=session_status,
                    )

                    await websocket.send_json(
                        {
                            "type": "session_ended",
                            "status": session_status,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                    session_started = False

                elif message_type == "log":
                    # Handle automation log
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    log_level = message.data.get("level", "info")
                    log_message = message.data.get("message", "")

                    logger.info(
                        "automation_log",
                        user_id=str(user.id),
                        level=log_level,
                        message=log_message,
                    )

                    # Here you would typically store the log in the database
                    # For now, just acknowledge receipt
                    await websocket.send_json(
                        {
                            "type": "log_received",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "screenshot":
                    # Handle screenshot
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    logger.info(
                        "automation_screenshot",
                        user_id=str(user.id),
                        metadata=message.data.get("metadata", {}),
                    )

                    # Here you would typically store the screenshot in S3
                    # For now, just acknowledge receipt
                    await websocket.send_json(
                        {
                            "type": "screenshot_received",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                else:
                    # Unknown message type
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message_type}",
                        }
                    )

            except asyncio.TimeoutError:
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
                    "automation_ws_client_disconnected",
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "automation_ws_message_error",
                    user_id=str(user.id) if user else None,
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
        # Cleanup on disconnect
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
            "automation_ws_cleanup_complete",
            user_id=str(user.id) if user else None,
        )
