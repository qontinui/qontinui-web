"""WebSocket endpoint for automation runner integration."""

import asyncio
import base64
import io
from datetime import datetime
from typing import Any, Dict
from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from fastapi.exceptions import HTTPException
from PIL import Image
from sqlalchemy import select

from app.api.deps import get_async_db, get_current_user_from_ws
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.project import Project
from app.models.user import User
from app.schemas.automation import (
    MonitoringEvent,
    MonitoringLogEvent,
    MonitoringScreenshotEvent,
)
from app.services.object_storage import object_storage
from app.services.input_association_service import input_association_service

router = APIRouter()
logger = structlog.get_logger(__name__)


# Placeholder models - these should be defined in app/models/automation.py
# For now, we'll define minimal classes to support the endpoint
class AutomationSession:
    """Automation session model placeholder."""

    def __init__(self, **kwargs):
        self.id = kwargs.get("id")
        self.project_id = kwargs.get("project_id")
        self.user_id = kwargs.get("user_id")
        self.runner_version = kwargs.get("runner_version")
        self.runner_os = kwargs.get("runner_os")
        self.runner_hostname = kwargs.get("runner_hostname")
        self.configuration_snapshot = kwargs.get("configuration_snapshot")
        self.status = kwargs.get("status", "running")
        self.started_at = kwargs.get("started_at", datetime.utcnow())
        self.ended_at = kwargs.get("ended_at")
        self.error_message = kwargs.get("error_message")


class AutomationScreenshot:
    """Automation screenshot model placeholder."""

    def __init__(self, **kwargs):
        self.id = kwargs.get("id")
        self.session_id = kwargs.get("session_id")
        self.s3_key = kwargs.get("s3_key")
        self.s3_url = kwargs.get("s3_url")
        self.name = kwargs.get("name")
        self.width = kwargs.get("width")
        self.height = kwargs.get("height")
        self.file_size = kwargs.get("file_size")
        self.content_type = kwargs.get("content_type")
        self.automation_metadata = kwargs.get("automation_metadata")
        self.captured_at = kwargs.get("captured_at", datetime.utcnow())


class AutomationLog:
    """Automation log model placeholder."""

    def __init__(self, **kwargs):
        self.id = kwargs.get("id")
        self.session_id = kwargs.get("session_id")
        self.level = kwargs.get("level")
        self.message = kwargs.get("message")
        self.log_data = kwargs.get("log_data")
        self.sequence_number = kwargs.get("sequence_number")
        self.screenshot_id = kwargs.get("screenshot_id")
        self.created_at = kwargs.get("created_at", datetime.utcnow())


async def require_authenticated_ws(
    websocket: WebSocket,
    token: str,
) -> User:
    """
    WebSocket dependency to verify authentication.

    Args:
        websocket: WebSocket connection
        token: JWT token from query parameters

    Returns:
        User object if authenticated

    Raises:
        WebSocketException if not authenticated
    """
    try:
        # Get user from token
        user = await get_current_user_from_ws(token)

        if not user.is_active:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION, reason="User is not active"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="User is not active"
            )

        return user
    except Exception as e:
        logger.error("ws_runner_auth_failed", error=str(e))
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Authentication failed"
        )
        raise


def create_response(
    success: bool,
    message: str,
    data: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Create standardized response message.

    Args:
        success: Whether operation was successful
        message: Response message
        data: Optional data payload

    Returns:
        Formatted response dictionary
    """
    return {
        "type": "response",
        "success": success,
        "message": message,
        "data": data or {},
        "timestamp": datetime.utcnow().isoformat(),
    }


def create_error(
    error: str,
    details: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Create standardized error message.

    Args:
        error: Error message
        details: Optional error details

    Returns:
        Formatted error dictionary
    """
    return {
        "type": "error",
        "error": error,
        "details": details or {},
        "timestamp": datetime.utcnow().isoformat(),
    }


async def handle_session_start(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle session_start message.

    Creates a new AutomationSession record in the database.

    Args:
        message: Message data from runner
        user: Authenticated user
        db: Database session

    Returns:
        Response message with session_id
    """
    try:
        # Extract required fields
        project_id = message.get("project_id")
        if not project_id:
            return create_error("Missing required field: project_id")

        # Validate project_id is a valid integer
        try:
            project_id_int = int(project_id)
        except (ValueError, TypeError):
            return create_error("Invalid project_id format (must be integer)")

        # TODO: Verify user has access to this project
        # For now, we'll just create the session

        # Create session record
        session = AutomationSession(
            project_id=project_id_int,
            user_id=user.id,
            runner_version=message.get("runner_version", "unknown"),
            runner_os=message.get("runner_os", "unknown"),
            runner_hostname=message.get("runner_hostname", "unknown"),
            configuration_snapshot=message.get("configuration_snapshot", {}),
            status="running",
        )

        # Add to database
        db.add(session)
        await db.commit()
        await db.refresh(session)

        logger.info(
            "automation_session_started",
            session_id=str(session.id) if session.id else "temp",
            project_id=project_id_int,
            user_id=str(user.id),
        )

        return create_response(
            success=True,
            message="Session started successfully",
            data={"session_id": str(session.id) if session.id else "temp-session-id"},
        )

    except Exception as e:
        logger.error("session_start_error", error=str(e), error_type=type(e).__name__)
        return create_error(
            "Failed to start session",
            details={"error": str(e)},
        )


async def handle_session_end(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle session_end message.

    Updates the AutomationSession status and end time.

    Args:
        message: Message data from runner
        user: Authenticated user
        db: Database session

    Returns:
        Response message
    """
    try:
        session_id = message.get("session_id")
        if not session_id:
            return create_error("Missing required field: session_id")

        session_status = message.get("status", "completed")
        error_message = message.get("error_message")

        # Fetch session from database and update
        session = await db.get(AutomationSession, UUID(session_id))
        if not session:
            return create_error("Session not found")

        if session.user_id != user.id:
            return create_error("Unauthorized")

        session.status = session_status
        session.ended_at = datetime.utcnow()
        if error_message:
            # Store error message in configuration_snapshot if needed
            # (model doesn't have error_message field, can add it later or store in metadata)
            pass
        await db.commit()

        logger.info(
            "automation_session_ended",
            session_id=session_id,
            status=session_status,
            user_id=str(user.id),
        )

        return create_response(
            success=True,
            message="Session ended successfully",
        )

    except Exception as e:
        logger.error("session_end_error", error=str(e), error_type=type(e).__name__)
        return create_error(
            "Failed to end session",
            details={"error": str(e)},
        )


async def handle_screenshot(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle screenshot message.

    Decodes base64 image, uploads to storage, and creates AutomationScreenshot record.

    Args:
        message: Message data from runner
        user: Authenticated user
        db: Database session

    Returns:
        Response message with screenshot_id and presigned_url
    """
    try:
        session_id = message.get("session_id")
        if not session_id:
            return create_error("Missing required field: session_id")

        screenshot_data = message.get("screenshot_data")
        if not screenshot_data:
            return create_error("Missing required field: screenshot_data")

        # Decode base64 image
        try:
            image_bytes = base64.b64decode(screenshot_data)
        except Exception as e:
            return create_error(
                "Invalid base64 data",
                details={"error": str(e)},
            )

        # Verify it's a valid image
        try:
            image = Image.open(io.BytesIO(image_bytes))
            width, height = image.size
            file_size = len(image_bytes)
        except Exception as e:
            return create_error(
                "Invalid image data",
                details={"error": str(e)},
            )

        # Extract metadata
        name = message.get("name", f"screenshot_{datetime.utcnow().timestamp()}")
        content_type = message.get("content_type", "image/png")
        automation_metadata = message.get("automation_metadata", {})

        # TODO: Get project_id from session
        # For now, we'll use a placeholder
        project_id = "00000000-0000-0000-0000-000000000000"

        # Upload to object storage
        try:
            file_obj = io.BytesIO(image_bytes)
            s3_key, presigned_url, uploaded_size = object_storage.upload_image(
                file_obj=file_obj,
                user_id=str(user.id),
                project_id=project_id,
                filename=f"{name}.png",
                metadata={
                    "session_id": session_id,
                    "name": name,
                    **automation_metadata,
                },
            )
        except Exception as e:
            logger.error("screenshot_upload_failed", error=str(e))
            return create_error(
                "Failed to upload screenshot",
                details={"error": str(e)},
            )

        # Create screenshot record
        screenshot = AutomationScreenshot(
            session_id=UUID(session_id),
            storage_path=s3_key,
            presigned_url=presigned_url,
            name=name,
            width=width,
            height=height,
            content_type=content_type,
            automation_metadata=automation_metadata,
            timestamp=datetime.fromisoformat(message.get("timestamp")) if message.get("timestamp") else datetime.utcnow(),
        )

        # Add to database
        db.add(screenshot)
        await db.commit()
        await db.refresh(screenshot)

        logger.info(
            "screenshot_uploaded",
            session_id=session_id,
            screenshot_id=str(screenshot.id) if screenshot.id else "temp",
            s3_key=s3_key,
            file_size=file_size,
        )

        return create_response(
            success=True,
            message="Screenshot uploaded successfully",
            data={
                "screenshot_id": str(screenshot.id) if screenshot.id else "temp-screenshot-id",
                "presigned_url": presigned_url,
            },
        )

    except Exception as e:
        logger.error("screenshot_error", error=str(e), error_type=type(e).__name__)
        return create_error(
            "Failed to process screenshot",
            details={"error": str(e)},
        )


async def handle_log(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle log message.

    Creates AutomationLog record and triggers input association logic.

    Args:
        message: Message data from runner
        user: Authenticated user
        db: Database session

    Returns:
        Response message
    """
    try:
        session_id = message.get("session_id")
        if not session_id:
            return create_error("Missing required field: session_id")

        level = message.get("level", "info")
        log_message = message.get("message", "")
        log_data = message.get("log_data", {})
        sequence_number = message.get("sequence_number", 0)

        # Create log record
        log = AutomationLog(
            session_id=UUID(session_id),
            level=level,
            message=log_message,
            log_data=log_data,
            sequence_number=sequence_number,
            timestamp=datetime.fromisoformat(message.get("timestamp")) if message.get("timestamp") else datetime.utcnow(),
        )

        # Add to database
        db.add(log)
        await db.commit()
        await db.refresh(log)

        # Trigger input association logic for input events
        # This automatically associates text_typed, mouse_clicked, and mouse_dragged events
        # with their corresponding screenshots based on timing
        try:
            association = await input_association_service.process_log_for_input_events(
                log_entry=log,
                db=db
            )
            if association:
                logger.debug(
                    "input_event_associated",
                    log_id=str(log.id),
                    screenshot_id=str(association.screenshot_id),
                    input_type=association.input_type,
                    timestamp_diff_ms=association.timestamp_diff_ms,
                )
        except Exception as e:
            # Don't fail the entire request if association fails
            logger.warning(
                "input_association_failed",
                log_id=str(log.id),
                error=str(e),
            )

        logger.debug(
            "automation_log_received",
            session_id=session_id,
            level=level,
            sequence=sequence_number,
        )

        return create_response(
            success=True,
            message="Log entry created",
            data={"log_id": str(log.id) if log.id else "temp-log-id"},
        )

    except Exception as e:
        logger.error("log_error", error=str(e), error_type=type(e).__name__)
        return create_error(
            "Failed to process log",
            details={"error": str(e)},
        )


async def handle_heartbeat(
    message: Dict[str, Any],
    user: User,
    db,
) -> Dict[str, Any]:
    """
    Handle heartbeat message.

    Simple acknowledgment to keep connection alive.

    Args:
        message: Message data from runner
        user: Authenticated user
        db: Database session

    Returns:
        Response message
    """
    session_id = message.get("session_id")

    logger.debug(
        "heartbeat_received",
        session_id=session_id,
        user_id=str(user.id),
    )

    return create_response(
        success=True,
        message="Heartbeat received",
    )


@router.websocket("/ws/runner")
async def websocket_automation_runner(
    websocket: WebSocket,
    token: str,
):
    """
    WebSocket endpoint for automation runner integration.

    Accepts connections from qontinui-runner and handles real-time communication
    for automation sessions, screenshots, and logs.

    Connection URL:
        ws://localhost:8001/api/v1/automation/ws/runner?token=<jwt_token>

    Query Parameters:
        token: JWT access token for authentication

    Message Types:
        - session_start: Create new automation session
        - session_end: Update session status
        - screenshot: Upload screenshot to storage
        - log: Create log entry
        - heartbeat: Keep-alive ping

    Response Format:
        {
            "type": "response",
            "success": true,
            "message": "Operation completed",
            "data": {},
            "timestamp": "2024-11-14T12:00:00.000000"
        }

    Error Format:
        {
            "type": "error",
            "error": "Error message",
            "details": {},
            "timestamp": "2024-11-14T12:00:00.000000"
        }

    Requires active user authentication via JWT token.
    """
    await websocket.accept()

    logger.info("ws_runner_connected")

    try:
        # Verify authentication
        try:
            user = await require_authenticated_ws(websocket, token)
        except Exception:
            return  # Connection already closed by require_authenticated_ws

        logger.info(
            "ws_runner_authenticated",
            user_id=str(user.id),
            user_email=user.email,
        )

        # Message handling loop
        while True:
            try:
                # Receive message from runner
                message = await websocket.receive_json()

                message_type = message.get("type")
                if not message_type:
                    await websocket.send_json(
                        create_error("Missing message type")
                    )
                    continue

                logger.debug(
                    "ws_runner_message_received",
                    type=message_type,
                    user_id=str(user.id),
                )

                # Get database session for this message
                async for db in get_async_db():
                    try:
                        # Route message to appropriate handler
                        if message_type == "session_start":
                            response = await handle_session_start(message, user, db)
                        elif message_type == "session_end":
                            response = await handle_session_end(message, user, db)
                        elif message_type == "screenshot":
                            response = await handle_screenshot(message, user, db)
                        elif message_type == "log":
                            response = await handle_log(message, user, db)
                        elif message_type == "heartbeat":
                            response = await handle_heartbeat(message, user, db)
                        else:
                            response = create_error(
                                f"Unknown message type: {message_type}"
                            )

                        # Send response
                        await websocket.send_json(response)

                        logger.debug(
                            "ws_runner_response_sent",
                            type=message_type,
                            success=response.get("success", False),
                        )

                    finally:
                        # Close the database session
                        await db.close()

                    # Only process one db session, then break
                    break

            except WebSocketDisconnect:
                logger.info(
                    "ws_runner_disconnected",
                    user_id=str(user.id),
                )
                break

            except Exception as e:
                logger.error(
                    "ws_runner_message_error",
                    user_id=str(user.id),
                    error=str(e),
                    error_type=type(e).__name__,
                )

                # Send error to client
                try:
                    await websocket.send_json(
                        create_error(
                            "Message processing error",
                            details={"error": str(e)},
                        )
                    )
                except Exception:
                    # Client disconnected or send failed
                    break

    except Exception as e:
        logger.error(
            "ws_runner_fatal_error",
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/sessions/{session_id}/monitor")
async def websocket_session_monitor(
    websocket: WebSocket,
    session_id: str,
    token: str,
):
    """
    WebSocket endpoint for real-time monitoring of an active automation session.

    Allows authenticated users to monitor live logs and screenshots from an
    active automation session. Uses polling-based approach to detect new events.

    Connection URL:
        ws://localhost:8001/api/v1/automation/sessions/{session_id}/monitor?token=<jwt_token>

    Path Parameters:
        session_id: UUID of the automation session to monitor

    Query Parameters:
        token: JWT access token for authentication

    Event Format (Log):
        {
            "type": "log",
            "data": {
                "id": "uuid",
                "sequence_number": 42,
                "level": "info",
                "message": "Action completed",
                "log_data": {},
                "timestamp": "ISO8601"
            },
            "timestamp": "ISO8601"
        }

    Event Format (Screenshot):
        {
            "type": "screenshot",
            "data": {
                "id": "uuid",
                "name": "screenshot_001",
                "presigned_url": "https://...",
                "width": 1920,
                "height": 1080,
                "automation_metadata": {},
                "timestamp": "ISO8601"
            },
            "timestamp": "ISO8601"
        }

    Heartbeat Format:
        {
            "type": "heartbeat",
            "timestamp": "ISO8601"
        }

    Error Format:
        {
            "type": "error",
            "error": "Error message",
            "details": {},
            "timestamp": "ISO8601"
        }

    Requires active user authentication via JWT token.
    User must have access to the session's project (if project_id is set).
    """
    await websocket.accept()

    logger.info("ws_monitor_connected", session_id=session_id)

    try:
        # Verify authentication
        try:
            user = await require_authenticated_ws(websocket, token)
        except Exception:
            return  # Connection already closed by require_authenticated_ws

        # Validate session_id format
        try:
            session_uuid = UUID(session_id)
        except ValueError:
            await websocket.send_json(
                create_error("Invalid session_id format", details={"session_id": session_id})
            )
            await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA)
            return

        # Get database session to verify access
        async for db in get_async_db():
            try:
                # Fetch the session
                result = await db.execute(
                    select(AutomationSession).where(AutomationSession.id == session_uuid)
                )
                session = result.scalar_one_or_none()

                if not session:
                    await websocket.send_json(
                        create_error("Session not found", details={"session_id": session_id})
                    )
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return

                # Verify user has access to the project (if project_id is set)
                if session.project_id:
                    project_result = await db.execute(
                        select(Project).where(Project.id == session.project_id)
                    )
                    project = project_result.scalar_one_or_none()

                    if not project:
                        await websocket.send_json(
                            create_error("Project not found", details={"project_id": str(session.project_id)})
                        )
                        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                        return

                    # Check if user owns the project
                    if project.owner_id != user.id:
                        await websocket.send_json(
                            create_error(
                                "Unauthorized: You don't have access to this session",
                                details={"session_id": session_id}
                            )
                        )
                        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                        return

                logger.info(
                    "ws_monitor_authenticated",
                    session_id=session_id,
                    user_id=str(user.id),
                    user_email=user.email,
                )

            finally:
                await db.close()
            break

        # Track last seen sequence numbers and timestamps
        last_log_sequence = 0
        last_screenshot_timestamp = datetime.min
        heartbeat_counter = 0
        poll_interval = 1.5  # Poll every 1.5 seconds

        # Monitoring loop
        while True:
            try:
                # Get new logs and screenshots from database
                async for db in get_async_db():
                    try:
                        # Fetch new logs (after last_log_sequence)
                        logs_result = await db.execute(
                            select(AutomationLog)
                            .where(AutomationLog.session_id == session_uuid)
                            .where(AutomationLog.sequence_number > last_log_sequence)
                            .order_by(AutomationLog.sequence_number.asc())
                        )
                        new_logs = logs_result.scalars().all()

                        # Fetch new screenshots (after last_screenshot_timestamp)
                        screenshots_result = await db.execute(
                            select(AutomationScreenshot)
                            .where(AutomationScreenshot.session_id == session_uuid)
                            .where(AutomationScreenshot.timestamp > last_screenshot_timestamp)
                            .order_by(AutomationScreenshot.timestamp.asc())
                        )
                        new_screenshots = screenshots_result.scalars().all()

                        # Send new log events
                        for log in new_logs:
                            log_event = MonitoringLogEvent(
                                id=log.id,
                                sequence_number=log.sequence_number,
                                level=log.level,
                                message=log.message,
                                log_data=log.log_data,
                                timestamp=log.timestamp,
                            )

                            monitoring_event = MonitoringEvent(
                                type="log",
                                data=log_event,
                                timestamp=datetime.utcnow(),
                            )

                            await websocket.send_json(monitoring_event.model_dump(mode='json'))

                            # Update last seen sequence
                            last_log_sequence = log.sequence_number

                        # Send new screenshot events
                        for screenshot in new_screenshots:
                            # Generate presigned URL for the screenshot
                            presigned_url = object_storage.generate_presigned_url(
                                screenshot.storage_path, expiration=3600
                            )

                            screenshot_event = MonitoringScreenshotEvent(
                                id=screenshot.id,
                                name=screenshot.name,
                                presigned_url=presigned_url,
                                width=screenshot.width,
                                height=screenshot.height,
                                automation_metadata=screenshot.automation_metadata,
                                timestamp=screenshot.timestamp,
                            )

                            monitoring_event = MonitoringEvent(
                                type="screenshot",
                                data=screenshot_event,
                                timestamp=datetime.utcnow(),
                            )

                            await websocket.send_json(monitoring_event.model_dump(mode='json'))

                            # Update last seen timestamp
                            last_screenshot_timestamp = screenshot.timestamp

                    finally:
                        await db.close()
                    break

                # Send heartbeat every 10 polls (every ~15 seconds)
                heartbeat_counter += 1
                if heartbeat_counter >= 10:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                    heartbeat_counter = 0
                    logger.debug("ws_monitor_heartbeat_sent", session_id=session_id)

                # Sleep before next poll
                await asyncio.sleep(poll_interval)

            except WebSocketDisconnect:
                logger.info(
                    "ws_monitor_disconnected",
                    session_id=session_id,
                    user_id=str(user.id),
                )
                break

            except Exception as e:
                logger.error(
                    "ws_monitor_poll_error",
                    session_id=session_id,
                    user_id=str(user.id),
                    error=str(e),
                    error_type=type(e).__name__,
                )

                # Send error to client
                try:
                    await websocket.send_json(
                        create_error(
                            "Monitoring error occurred",
                            details={"error": str(e)},
                        )
                    )
                except Exception:
                    # Client disconnected or send failed
                    break

                # Continue monitoring despite errors
                await asyncio.sleep(poll_interval)

    except Exception as e:
        logger.error(
            "ws_monitor_fatal_error",
            session_id=session_id,
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
