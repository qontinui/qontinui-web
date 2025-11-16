"""
WebSocket endpoints for automation streaming.

Provides real-time automation monitoring, log streaming, and session management.
"""

import asyncio
import base64
import io
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from uuid import UUID

import structlog
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from PIL import Image
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_user_from_ws
from app.models.automation import AutomationInputEvent
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.user import User
from app.services.object_storage import object_storage

router = APIRouter()
logger = structlog.get_logger(__name__)


# WebSocket message schemas
class WSMessage(BaseModel):
    """Base WebSocket message."""

    type: str
    data: dict = {}


async def link_screenshots_to_input(
    db: AsyncSession,
    input_event: AutomationInputEvent,
    session_id: UUID,
) -> None:
    """
    Link screenshots to an input event based on timestamp proximity.

    Finds screenshots within ±2.5 seconds of the input event and sets
    the before/after screenshot references on the input event.

    Args:
        db: Database session
        input_event: The input event to link screenshots to
        session_id: Session ID to filter screenshots
    """
    # Define time window (±2.5 seconds in seconds)
    time_window = 2.5

    # Calculate time range
    start_time = input_event.timestamp - timedelta(seconds=time_window)
    end_time = input_event.timestamp + timedelta(seconds=time_window)

    # Query screenshots in the time window
    query = select(AutomationScreenshot).where(
        AutomationScreenshot.session_id == session_id,
        AutomationScreenshot.timestamp >= start_time,
        AutomationScreenshot.timestamp <= end_time,
    ).order_by(AutomationScreenshot.timestamp)

    result = await db.execute(query)
    screenshots = result.scalars().all()

    # Link the closest before/after screenshots
    screenshot_before = None
    screenshot_after = None

    for screenshot in screenshots:
        # Calculate time delta in milliseconds
        time_delta = (screenshot.timestamp - input_event.timestamp).total_seconds() * 1000

        # Find closest screenshot before the input event
        if time_delta < -100:  # More than 100ms before
            if not screenshot_before or time_delta > (screenshot_before.timestamp - input_event.timestamp).total_seconds() * 1000:
                screenshot_before = screenshot
        # Find closest screenshot after the input event
        elif time_delta > 100:  # More than 100ms after
            if not screenshot_after or time_delta < (screenshot_after.timestamp - input_event.timestamp).total_seconds() * 1000:
                screenshot_after = screenshot

    # Set the before/after screenshot references
    if screenshot_before:
        input_event.screenshot_before_id = screenshot_before.id
    if screenshot_after:
        input_event.screenshot_after_id = screenshot_after.id

    await db.commit()


async def handle_input_event(
    message: Dict[str, Any],
    db: AsyncSession,
    session_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    """
    Handle input event message.

    Creates AutomationInputEvent record and links to nearby screenshots.

    Args:
        message: Message data containing input event details
        db: Database session
        session_id: Current automation session ID

    Returns:
        Response message
    """
    try:
        if not session_id:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }

        event_type = message.get("event_type")
        if not event_type:
            return {
                "type": "error",
                "message": "Missing required field: event_type",
            }

        # Parse timestamp
        timestamp_str = message.get("timestamp")
        if timestamp_str:
            try:
                event_timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                event_timestamp = datetime.utcnow()
        else:
            event_timestamp = datetime.utcnow()

        # Create input event record
        input_event = AutomationInputEvent(
            session_id=session_id,
            event_type=event_type,
            timestamp=event_timestamp,
        )

        # Handle mouse events
        if event_type in ["mouse.clicked", "mouse.moved"]:
            input_event.mouse_x = message.get("x")
            input_event.mouse_y = message.get("y")
            input_event.mouse_button = message.get("button")

        # Handle drag events
        elif event_type == "mouse.dragged":
            input_event.drag_from_x = message.get("from_x")
            input_event.drag_from_y = message.get("from_y")
            input_event.drag_to_x = message.get("to_x")
            input_event.drag_to_y = message.get("to_y")
            input_event.drag_duration = message.get("duration")
            input_event.drag_path_points = message.get("path_points")
            input_event.drag_avg_speed = message.get("avg_speed")
            input_event.drag_max_speed = message.get("max_speed")

        # Handle keyboard events
        elif event_type == "keyboard.text_typed":
            input_event.text_typed = message.get("text")
            input_event.character_count = len(message.get("text", ""))

        # Save to database
        db.add(input_event)
        await db.commit()
        await db.refresh(input_event)

        # Link screenshots to input event
        try:
            await link_screenshots_to_input(db, input_event, session_id)
        except Exception as e:
            logger.error(
                "screenshot_linking_failed",
                input_event_id=str(input_event.id),
                error=str(e),
                error_type=type(e).__name__,
            )

        logger.info(
            "input_event_stored",
            session_id=str(session_id),
            event_type=event_type,
            event_id=str(input_event.id),
        )

        return {
            "type": "input_event_received",
            "event_id": str(input_event.id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error("input_event_error", error=str(e), error_type=type(e).__name__)
        return {
            "type": "error",
            "message": f"Failed to process input event: {str(e)}",
        }


async def handle_log(
    message: Dict[str, Any],
    db: AsyncSession,
    session_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    """
    Handle automation log message.

    Creates AutomationLog record for automated execution logs.

    Args:
        message: Message data containing log details
        db: Database session
        session_id: Current automation session ID

    Returns:
        Response message
    """
    try:
        if not session_id:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }

        # Extract log fields
        log_level = message.get("level", "info")
        log_message = message.get("message", "")
        log_data = message.get("data", {})

        if not log_message:
            return {
                "type": "error",
                "message": "Missing required field: message",
            }

        # Parse timestamp
        timestamp_str = message.get("timestamp")
        if timestamp_str:
            try:
                log_timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                log_timestamp = datetime.utcnow()
        else:
            log_timestamp = datetime.utcnow()

        # Get next sequence number for this session
        query = select(AutomationLog).where(
            AutomationLog.session_id == session_id
        ).order_by(AutomationLog.sequence_number.desc()).limit(1)

        result = await db.execute(query)
        last_log = result.scalar_one_or_none()

        sequence_number = (last_log.sequence_number + 1) if last_log else 1

        # Create log record
        automation_log = AutomationLog(
            session_id=session_id,
            sequence_number=sequence_number,
            level=log_level,
            message=log_message,
            log_data=log_data,
            timestamp=log_timestamp,
        )

        # Save to database
        db.add(automation_log)
        await db.commit()
        await db.refresh(automation_log)

        logger.info(
            "automation_log_stored",
            session_id=str(session_id),
            level=log_level,
            sequence=sequence_number,
            log_id=str(automation_log.id),
        )

        return {
            "type": "log_received",
            "log_id": str(automation_log.id),
            "sequence_number": sequence_number,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error("automation_log_error", error=str(e), error_type=type(e).__name__)
        return {
            "type": "error",
            "message": f"Failed to process log: {str(e)}",
        }


async def handle_screenshot(
    message: Dict[str, Any],
    db: AsyncSession,
    user_id: UUID,
    session_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    """
    Handle screenshot upload and storage.

    Decodes base64 image, uploads to S3, creates AutomationScreenshot record,
    and optionally links to recent AutomationLog entries.

    Args:
        message: Message data containing screenshot details
        db: Database session
        user_id: User ID for storage path
        session_id: Current automation session ID

    Returns:
        Response message
    """
    try:
        if not session_id:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }

        # Extract screenshot fields
        image_data_b64 = message.get("image")
        screenshot_name = message.get("name", f"screenshot_{datetime.utcnow().timestamp()}")
        metadata = message.get("metadata", {})

        if not image_data_b64:
            return {
                "type": "error",
                "message": "Missing required field: image",
            }

        # Parse timestamp
        timestamp_str = message.get("timestamp")
        if timestamp_str:
            try:
                screenshot_timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                screenshot_timestamp = datetime.utcnow()
        else:
            screenshot_timestamp = datetime.utcnow()

        # Decode base64 image
        try:
            image_bytes = base64.b64decode(image_data_b64)
        except Exception as e:
            logger.error("screenshot_base64_decode_failed", error=str(e))
            return {
                "type": "error",
                "message": "Failed to decode base64 image data",
            }

        # Get image dimensions using PIL
        try:
            img = Image.open(io.BytesIO(image_bytes))
            width, height = img.size
            # Determine format and content type
            img_format = img.format.lower() if img.format else "png"
            content_type = f"image/{img_format}"
        except Exception as e:
            logger.error("screenshot_image_parse_failed", error=str(e))
            return {
                "type": "error",
                "message": "Failed to parse image data",
            }

        # Generate S3 key: screenshots/{user_id}/sessions/{session_id}/{timestamp}_{name}.{format}
        timestamp_str_safe = screenshot_timestamp.strftime("%Y%m%d_%H%M%S_%f")
        s3_key = f"screenshots/{user_id}/sessions/{session_id}/{timestamp_str_safe}_{screenshot_name}.{img_format}"

        # Upload to S3
        try:
            file_obj = io.BytesIO(image_bytes)
            object_storage.backend.upload_file(
                file_obj=file_obj,
                key=s3_key,
                content_type=content_type,
                metadata={
                    "user_id": str(user_id),
                    "session_id": str(session_id),
                    "screenshot_name": screenshot_name,
                    "timestamp": screenshot_timestamp.isoformat(),
                },
            )

            logger.info(
                "screenshot_uploaded_to_s3",
                user_id=str(user_id),
                session_id=str(session_id),
                s3_key=s3_key,
                file_size=len(image_bytes),
            )
        except Exception as e:
            logger.error(
                "screenshot_s3_upload_failed",
                user_id=str(user_id),
                session_id=str(session_id),
                error=str(e),
            )
            return {
                "type": "error",
                "message": f"Failed to upload screenshot: {str(e)}",
            }

        # Create AutomationScreenshot record
        try:
            screenshot = AutomationScreenshot(
                session_id=session_id,
                name=screenshot_name,
                storage_path=s3_key,
                width=width,
                height=height,
                content_type=content_type,
                automation_metadata=metadata,
                timestamp=screenshot_timestamp,
            )

            db.add(screenshot)
            await db.commit()
            await db.refresh(screenshot)

            logger.info(
                "screenshot_record_created",
                screenshot_id=str(screenshot.id),
                session_id=str(session_id),
                name=screenshot_name,
            )
        except Exception as e:
            logger.error(
                "screenshot_record_creation_failed",
                session_id=str(session_id),
                error=str(e),
            )
            # Try to clean up S3 upload
            try:
                object_storage.delete_file(s3_key)
            except Exception:
                pass
            return {
                "type": "error",
                "message": f"Failed to create screenshot record: {str(e)}",
            }

        # Link to recent AutomationLog entries (within ±5 seconds)
        try:
            time_window = timedelta(seconds=5)
            start_time = screenshot_timestamp - time_window
            end_time = screenshot_timestamp + time_window

            # Query recent logs
            query = select(AutomationLog).where(
                AutomationLog.session_id == session_id,
                AutomationLog.timestamp >= start_time,
                AutomationLog.timestamp <= end_time,
            ).order_by(AutomationLog.timestamp)

            result = await db.execute(query)
            recent_logs = result.scalars().all()

            # Create associations for logs that represent user inputs
            # (clicks, types, etc.)
            association_count = 0
            for log in recent_logs:
                # Check if log represents a user input action
                log_data = log.log_data or {}
                action_type = log_data.get("action_type", "").upper()

                # Link screenshots to action logs (CLICK, TYPE, etc.)
                if action_type in ["CLICK", "TYPE", "DOUBLE_CLICK", "RIGHT_CLICK", "DRAG", "SCROLL"]:
                    timestamp_diff_ms = int((screenshot.timestamp - log.timestamp).total_seconds() * 1000)

                    association = ScreenshotInputAssociation(
                        screenshot_id=screenshot.id,
                        log_id=log.id,
                        input_type=action_type.lower(),
                        input_data=log_data,
                        timestamp_diff_ms=timestamp_diff_ms,
                    )
                    db.add(association)
                    association_count += 1

            if association_count > 0:
                await db.commit()
                logger.info(
                    "screenshot_associations_created",
                    screenshot_id=str(screenshot.id),
                    association_count=association_count,
                )
        except Exception as e:
            logger.error(
                "screenshot_association_failed",
                screenshot_id=str(screenshot.id),
                error=str(e),
            )
            # Don't fail the screenshot upload if association fails

        return {
            "type": "screenshot_received",
            "screenshot_id": str(screenshot.id),
            "s3_key": s3_key,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error("screenshot_error", error=str(e), error_type=type(e).__name__)
        return {
            "type": "error",
            "message": f"Failed to process screenshot: {str(e)}",
        }


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

        - input_event: Send input event (mouse, keyboard)
          {"type": "input_event", "data": {"event_type": "mouse.clicked", "x": 100, "y": 200, ...}}

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
    current_session_id = None

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
                    current_session_id = UUID(message.data.get("session_id")) if message.data.get("session_id") else None

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
                    current_session_id = None

                elif message_type == "log":
                    # Handle automation log
                    response = await handle_log(
                        message.data,
                        db,
                        current_session_id,
                    )
                    await websocket.send_json(response)

                elif message_type == "screenshot":
                    # Handle screenshot
                    response = await handle_screenshot(
                        message.data,
                        db,
                        user.id,
                        current_session_id,
                    )
                    await websocket.send_json(response)

                elif message_type == "input_event":
                    # Handle input event
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    response = await handle_input_event(
                        message.data,
                        db,
                        current_session_id,
                    )
                    await websocket.send_json(response)

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
