"""
WebSocket endpoints for automation streaming.

Provides real-time automation monitoring, log streaming, and session management.
"""

import asyncio
import base64
import io
import json
import time
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from dateutil.relativedelta import relativedelta  # type: ignore
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from PIL import Image
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_user_from_ws
from app.api.v1.endpoints.images import (
    validate_image_magic_bytes,
    validate_image_mime_type,
)
from app.config.redis_config import get_redis
from app.crud import detected_issue as issue_crud
from app.crud import runner as runner_crud
from app.models.automation import AutomationInputEvent, InputEventType
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.execution_tree_event import ExecutionTreeEvent
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.user import User
from app.schemas.detected_issue import IssueSource, IssueSyncItem
from app.services.object_storage import object_storage
from app.services.runner_connection_manager import get_runner_connection_manager
from app.services.websocket_manager import get_websocket_manager

router = APIRouter()
logger = structlog.get_logger(__name__)

# Rate limiting state (in-memory for WebSocket connections)
# For production, consider using Redis for distributed rate limiting
_connection_attempts: dict[str, list[float]] = defaultdict(list)
_message_counts: dict[str, list[float]] = defaultdict(list)


def check_connection_rate_limit(
    ip_address: str, limit: int = 5, window: int = 60
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


def check_message_rate_limit(
    session_key: str, limit: int = 60, window: int = 60
) -> bool:
    """
    Check if a session has exceeded the message rate limit.

    Args:
        session_key: Unique session identifier (e.g., websocket connection ID)
        limit: Maximum messages allowed within the window
        window: Time window in seconds

    Returns:
        True if within limit, False if limit exceeded
    """
    current_time = time.time()
    cutoff_time = current_time - window

    # Clean old messages
    _message_counts[session_key] = [
        t for t in _message_counts[session_key] if t > cutoff_time
    ]

    # Check if limit exceeded
    if len(_message_counts[session_key]) >= limit:
        return False

    # Record this message
    _message_counts[session_key].append(current_time)
    return True


def cleanup_rate_limit_session(session_key: str) -> None:
    """
    Clean up rate limiting state for a session.

    Args:
        session_key: Session identifier to clean up
    """
    if session_key in _message_counts:
        del _message_counts[session_key]


async def store_tree_event(
    db: AsyncSession,
    event_data: dict[str, Any],
) -> ExecutionTreeEvent | None:
    """
    Store a tree event from the runner in the database.

    Args:
        db: Database session
        event_data: The tree event data from the runner

    Returns:
        The created ExecutionTreeEvent or None if failed
    """
    try:
        # Extract run_id - can be in root or in data
        run_id_str = event_data.get("run_id") or event_data.get("data", {}).get(
            "run_id"
        )
        if not run_id_str:
            logger.warning("tree_event_missing_run_id", event_data=event_data)
            return None

        run_id = UUID(run_id_str) if isinstance(run_id_str, str) else run_id_str

        # Extract node data
        node = event_data.get("node", {})
        node_metadata = node.get("metadata", {})

        # Extract state context
        state_context = node_metadata.get("state_context", {})

        tree_event = ExecutionTreeEvent(
            run_id=run_id,
            event_type=event_data.get("event_type", "unknown"),
            node_id=node.get("id", str(uuid.uuid4())),
            node_type=node.get("node_type", "action"),
            node_name=node.get("name", "Unknown"),
            parent_node_id=node.get("parent_id"),
            path=event_data.get("path"),
            sequence=event_data.get("sequence", 0),
            event_timestamp=event_data.get("timestamp", time.time()),
            node_start_timestamp=node.get("timestamp"),
            node_end_timestamp=node.get("end_timestamp"),
            duration_ms=(
                (node.get("end_timestamp", 0) - node.get("timestamp", 0)) * 1000
                if node.get("end_timestamp") and node.get("timestamp")
                else node.get("duration", 0) * 1000 if node.get("duration") else None
            ),
            status=node.get("status", "pending"),
            error_message=node.get("error"),
            active_states_before=state_context.get("active_before", []),
            active_states_after=state_context.get("active_after", []),
            states_changed=state_context.get("changed", False),
            node_metadata=node_metadata,
        )

        db.add(tree_event)
        await db.commit()
        await db.refresh(tree_event)

        logger.debug(
            "tree_event_stored",
            run_id=str(run_id),
            event_type=tree_event.event_type,
            node_name=tree_event.node_name,
            event_id=str(tree_event.id),
        )

        return tree_event

    except Exception as e:
        logger.error(
            "tree_event_storage_failed",
            error=str(e),
            event_data=event_data,
        )
        await db.rollback()
        return None


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

    Finds screenshots within ±2.5 seconds of the input event and creates associations.

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
    query = (
        select(AutomationScreenshot)
        .where(
            AutomationScreenshot.session_id == session_id,
            AutomationScreenshot.timestamp >= start_time,
            AutomationScreenshot.timestamp <= end_time,
        )
        .order_by(AutomationScreenshot.timestamp)
    )

    result = await db.execute(query)
    screenshots = result.scalars().all()

    # Create associations
    for screenshot in screenshots:
        # Calculate time delta in milliseconds
        time_delta = (
            screenshot.timestamp - input_event.timestamp
        ).total_seconds() * 1000

        # Determine association type
        if time_delta < -100:  # More than 100ms before
            association_type = "before"
        elif time_delta > 100:  # More than 100ms after
            association_type = "after"
        else:  # Within 100ms
            association_type = "during"

        # Create association
        association = ScreenshotInputAssociation(
            screenshot_id=screenshot.id,
            input_event_id=input_event.id,
            association_type=association_type,
            time_delta_ms=int(time_delta),
        )
        db.add(association)

        # Also update direct references if appropriate
        if association_type == "before" and not input_event.screenshot_before_id:
            input_event.screenshot_before_id = screenshot.id  # type: ignore
        elif association_type == "after" and not input_event.screenshot_after_id:
            input_event.screenshot_after_id = screenshot.id  # type: ignore

    await db.commit()


async def handle_input_event(
    message: dict[str, Any],
    db: AsyncSession,
    session_id: UUID | None = None,
) -> dict[str, Any]:
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

        # Validate event_type against enum
        try:
            event_type_enum = InputEventType(event_type)
        except ValueError:
            valid_types = [e.value for e in InputEventType]
            return {
                "type": "error",
                "message": f"Invalid event_type: '{event_type}'. Valid types are: {', '.join(valid_types)}",
            }

        # Parse timestamp
        timestamp_str = message.get("timestamp")
        if timestamp_str:
            try:
                event_timestamp = datetime.fromisoformat(
                    timestamp_str.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                event_timestamp = datetime.utcnow()
        else:
            event_timestamp = datetime.utcnow()

        # Create input event record
        input_event = AutomationInputEvent(
            session_id=session_id,
            event_type=event_type_enum,
            timestamp=event_timestamp,
        )

        # Handle mouse events
        if event_type_enum in [
            InputEventType.MOUSE_CLICKED,
            InputEventType.MOUSE_MOVED,
        ]:
            input_event.mouse_x = message.get("x")  # type: ignore
            input_event.mouse_y = message.get("y")  # type: ignore
            input_event.mouse_button = message.get("button")  # type: ignore

        # Handle drag events
        elif event_type_enum == InputEventType.MOUSE_DRAGGED:
            input_event.drag_from_x = message.get("from_x")  # type: ignore
            input_event.drag_from_y = message.get("from_y")  # type: ignore
            input_event.drag_to_x = message.get("to_x")  # type: ignore
            input_event.drag_to_y = message.get("to_y")  # type: ignore
            input_event.drag_duration = message.get("duration")  # type: ignore
            input_event.drag_path_points = message.get("path_points")  # type: ignore
            input_event.drag_avg_speed = message.get("avg_speed")  # type: ignore
            input_event.drag_max_speed = message.get("max_speed")  # type: ignore

        # Handle keyboard events
        elif event_type_enum == InputEventType.KEYBOARD_TEXT_TYPED:
            input_event.text_typed = message.get("text")  # type: ignore
            input_event.character_count = len(message.get("text", ""))  # type: ignore

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


async def handle_screenshot(
    message: dict[str, Any],
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID | None = None,
) -> dict[str, Any]:
    """
    Handle screenshot message with full S3 upload and database storage.

    Steps:
    1. Decode base64 image from message.data["image"]
    2. Validate image (MIME type, magic bytes, file size)
    3. Extract image dimensions using PIL
    4. Generate S3 key: automation/{user_id}/{session_id}/{uuid}.png
    5. Upload to S3
    6. Create AutomationScreenshot record in database
    7. Generate presigned URL (7 days)
    8. Return success response

    Args:
        message: Message data containing screenshot image and metadata
        db: Database session
        user_id: User ID for S3 path organization
        session_id: Current automation session ID

    Returns:
        Response message with screenshot_id and presigned_url
    """
    try:
        if not session_id:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }

        # Step 1: Extract and validate base64 image data
        image_data_b64 = message.get("image")
        if not image_data_b64:
            return {
                "type": "error",
                "message": "Missing required field: image",
            }

        # Decode base64 image
        try:
            image_bytes = base64.b64decode(image_data_b64)
        except Exception as e:
            logger.error(
                "screenshot_decode_failed",
                session_id=str(session_id),
                error=str(e),
            )
            return {
                "type": "error",
                "message": f"Failed to decode base64 image: {str(e)}",
            }

        # Step 2: Validate image MIME type (assume PNG, but can be extracted from metadata)
        metadata = message.get("metadata", {})
        content_type = metadata.get("content_type", "image/png")

        try:
            content_type = validate_image_mime_type(content_type)
        except HTTPException as e:
            logger.error(
                "screenshot_mime_validation_failed",
                session_id=str(session_id),
                content_type=content_type,
            )
            return {
                "type": "error",
                "message": e.detail,
            }

        # Step 3: Validate file size
        file_size = len(image_bytes)
        if file_size > 10 * 1024 * 1024:  # 10MB limit
            logger.error(
                "screenshot_too_large",
                session_id=str(session_id),
                file_size=file_size,
            )
            return {
                "type": "error",
                "message": "Screenshot too large. Maximum size: 10.0MB",
            }

        # Step 4: Validate magic bytes
        try:
            validate_image_magic_bytes(image_bytes, content_type)
        except HTTPException as e:
            logger.error(
                "screenshot_magic_bytes_validation_failed",
                session_id=str(session_id),
                content_type=content_type,
            )
            return {
                "type": "error",
                "message": e.detail,
            }

        # Step 5: Extract image dimensions using PIL
        try:
            image_file = io.BytesIO(image_bytes)
            with Image.open(image_file) as img:
                width, height = img.size
        except Exception as e:
            logger.error(
                "screenshot_dimension_extraction_failed",
                session_id=str(session_id),
                error=str(e),
            )
            return {
                "type": "error",
                "message": f"Failed to extract image dimensions: {str(e)}",
            }

        # Step 6: Generate unique screenshot ID and S3 key
        screenshot_id = uuid.uuid4()
        # S3 key format: automation/{user_id}/{session_id}/{uuid}.png
        file_extension = content_type.split("/")[-1]  # png, jpeg, etc.
        s3_key = f"automation/{user_id}/{session_id}/{screenshot_id}.{file_extension}"

        # Step 7: Upload to S3
        try:
            image_file = io.BytesIO(image_bytes)
            object_storage.backend.upload_file(
                file_obj=image_file,
                key=s3_key,
                content_type=content_type,
                metadata={
                    "user_id": str(user_id),
                    "session_id": str(session_id),
                    "screenshot_id": str(screenshot_id),
                    "width": str(width),
                    "height": str(height),
                },
            )

            logger.info(
                "screenshot_uploaded_to_s3",
                user_id=str(user_id),
                session_id=str(session_id),
                screenshot_id=str(screenshot_id),
                s3_key=s3_key,
                file_size=file_size,
                width=width,
                height=height,
            )
        except Exception as e:
            logger.error(
                "screenshot_s3_upload_failed",
                user_id=str(user_id),
                session_id=str(session_id),
                screenshot_id=str(screenshot_id),
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "type": "error",
                "message": f"Failed to upload screenshot to storage: {str(e)}",
            }

        # Step 8: Parse timestamp from metadata
        timestamp_str = metadata.get("timestamp")
        if timestamp_str:
            try:
                screenshot_timestamp = datetime.fromisoformat(
                    timestamp_str.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                screenshot_timestamp = datetime.utcnow()
        else:
            screenshot_timestamp = datetime.utcnow()

        # Step 9: Create AutomationScreenshot record
        screenshot_name = metadata.get(
            "name", f"Screenshot {screenshot_timestamp.strftime('%Y-%m-%d %H:%M:%S')}"
        )

        screenshot_record = AutomationScreenshot(
            id=screenshot_id,
            session_id=session_id,
            name=screenshot_name,
            storage_path=s3_key,
            width=width,
            height=height,
            content_type=content_type,
            timestamp=screenshot_timestamp,
            automation_metadata=metadata,
        )

        db.add(screenshot_record)
        await db.commit()
        await db.refresh(screenshot_record)

        logger.info(
            "screenshot_record_created",
            screenshot_id=str(screenshot_id),
            session_id=str(session_id),
            name=screenshot_name,
        )

        # Step 10: Return success response
        # Note: Presigned URLs are now generated on-demand via GET /screenshots/{id}/url
        # This avoids storing potentially expired URLs in the database
        return {
            "type": "screenshot_stored",
            "screenshot_id": str(screenshot_id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error(
            "screenshot_handler_error",
            session_id=str(session_id) if session_id else None,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to process screenshot: {str(e)}",
        }


@router.websocket("/ws/automation/runner")
async def websocket_runner_endpoint(
    websocket: WebSocket,
    token: str | None = None,
):
    """
    WebSocket endpoint for automation runner streaming.

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
        - Rate limiting: 5 connections per minute per IP, 60 messages per minute per session
    """
    # DEBUG: Log ALL incoming WebSocket requests immediately
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(
        "automation_ws_runner_incoming_request",
        client_ip=client_ip,
        query_params=dict(websocket.query_params),
        path=str(websocket.url.path),
    )

    # Check connection rate limit (5 per minute per IP)
    if not check_connection_rate_limit(client_ip, limit=5, window=60):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Connection rate limit exceeded. Maximum 5 connections per minute.",
        )
        logger.warning(
            "websocket_connection_rate_limited",
            client_ip=client_ip,
            limit=5,
            window=60,
        )
        return

    await websocket.accept()

    logger.info("automation_ws_connection_attempt")

    db = None
    user = None
    connection_record = None
    runner_manager = None
    session_started = False
    current_session_id = None
    session_key = f"ws_runner_{id(websocket)}"  # Unique session key for rate limiting

    try:
        # Authenticate user (supports JWT token, runner tokens, and cookies)
        # Try to get token from query param, then from cookies
        auth_token: str | None = token
        if not auth_token:
            # Try to read from cookies (for HttpOnly cookie auth)
            auth_token = websocket.cookies.get("access_token")

        if auth_token:
            logger.info("automation_ws_using_cookie_auth")

        if not auth_token:
            logger.error(
                "automation_ws_no_token", error="No token in query param or cookies"
            )
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

        # Re-fetch user in this session (the user object from get_current_user_from_ws
        # was in a different session that's now closed)
        user_result = await db.execute(select(User).filter(User.id == user.id))  # type: ignore
        user = user_result.scalar_one_or_none()

        if not user:
            logger.error("automation_ws_user_not_found")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "User not found",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Check if streaming is enabled for this user
        if not user.automation_streaming_enabled:
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Automation streaming is not enabled for your account. Enable it in your account settings.",
            )
            return

        # Check session limit (if applicable)
        if user.automation_sessions_limit is not None:
            # Check if we need to reset monthly limit
            if (
                user.automation_sessions_reset_at
                and datetime.now(UTC) > user.automation_sessions_reset_at
            ):
                # Reset for new month
                user.automation_sessions_used = 0
                user.automation_sessions_reset_at = datetime.now(UTC) + relativedelta(
                    months=1
                )
                await db.commit()
                await db.refresh(user)

            # Check if limit reached
            if user.automation_sessions_used >= user.automation_sessions_limit:
                await websocket.close(
                    code=status.WS_1008_POLICY_VIOLATION,
                    reason=f"Monthly automation streaming limit reached ({user.automation_sessions_limit} sessions). Limit resets on the 1st of each month.",
                )
                return

        # Log connection for all auth methods (runner token or JWT)
        try:
            # Extract IP and user agent from WebSocket
            client_host = websocket.client.host if websocket.client else None
            # Note: WebSocket doesn't easily expose user agent, would need custom header
            connection_record = await runner_crud.create_connection_record(
                db=db,
                user_id=user.id,
                ip_address=client_host,
            )

            # Clean up any orphaned connections (from previous disconnects that weren't properly closed)
            closed_connection_ids = await runner_crud.close_orphaned_connections(
                db=db,
                user_id=user.id,
                exclude_connection_id=connection_record.id,
            )
            if closed_connection_ids:
                logger.info(
                    "orphaned_connections_closed",
                    count=len(closed_connection_ids),
                    connection_ids=closed_connection_ids,
                    user_id=str(user.id),
                )
                # Send disconnect notifications for orphaned connections so frontend removes them
                redis_client = await get_redis()
                runner_manager = await get_runner_connection_manager(redis_client)
                for closed_id in closed_connection_ids:
                    await runner_manager.unregister_runner(closed_id, user.id)

            logger.info(
                "runner_connection_logged",
                connection_id=connection_record.id,
                auth_method="jwt",
            )

            # Register runner with connection manager for frontend command relay
            redis_client = await get_redis()
            runner_manager = await get_runner_connection_manager(redis_client)
            await runner_manager.register_runner(
                connection_id=connection_record.id,
                websocket=websocket,
                user_id=user.id,
                runner_name=connection_record.runner_name,
                ip_address=client_host,
                connected_at=connection_record.connected_at,
                project_id=connection_record.project_id,
            )
        except Exception as e:
            logger.error(
                "runner_connection_log_failed",
                error=str(e),
                error_type=type(e).__name__,
            )

        logger.info(
            "automation_ws_connected",
            user_id=str(user.id),
            username=user.username,
            auth_method="jwt",
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
                "auth_method": "jwt",
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

                # Check message rate limit (60 messages per minute)
                if not check_message_rate_limit(session_key, limit=60, window=60):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Message rate limit exceeded. Maximum 60 messages per minute.",
                        }
                    )
                    logger.warning(
                        "websocket_message_rate_limited",
                        user_id=str(user.id) if user else None,
                        session_key=session_key,
                        limit=60,
                    )
                    continue

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
                    # Refresh Redis TTL on heartbeat
                    if connection_record and runner_manager:
                        await runner_manager.refresh_connection_ttl(
                            connection_record.id
                        )

                    # Acknowledge heartbeat
                    await websocket.send_json(
                        {
                            "type": "heartbeat_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "runner_info":
                    # Update connection record with runner info (sent immediately after connection)
                    runner_name = message.data.get("runner_name")
                    if runner_name and connection_record:
                        try:
                            await runner_crud.update_connection_runner_name(
                                db=db,
                                connection_id=connection_record.id,
                                runner_name=runner_name,
                            )
                            # Also update Redis metadata with runner_name for real-time frontend updates
                            if runner_manager:
                                metadata = await runner_manager.get_connection_metadata(
                                    connection_record.id
                                )
                                if metadata:
                                    metadata["runner_name"] = runner_name
                                    metadata_key = f"runner:connection:{connection_record.id}:metadata"
                                    await redis_client.set(
                                        metadata_key, json.dumps(metadata), ex=300
                                    )  # 5 minute TTL
                                # Publish runner_name_updated event to frontend
                                # (moved outside `if metadata:` block to ensure event is always sent)
                                await runner_manager.publish_runner_name_update(
                                    connection_id=connection_record.id,
                                    runner_name=runner_name,
                                    user_id=user.id,
                                )
                            logger.info(
                                "runner_info_received",
                                connection_id=connection_record.id,
                                runner_name=runner_name,
                                runner_hostname=message.data.get("runner_hostname"),
                                runner_os=message.data.get("runner_os"),
                                runner_version=message.data.get("runner_version"),
                            )
                        except Exception as e:
                            logger.error(
                                "runner_info_update_failed",
                                connection_id=connection_record.id,
                                error=str(e),
                            )

                    await websocket.send_json(
                        {
                            "type": "runner_info_ack",
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
                    current_session_id = (
                        UUID(message.data.get("session_id"))
                        if message.data.get("session_id")
                        else None
                    )

                    workflow_name = message.data.get("workflow_name", "Unknown")

                    # Extract runner_name from session_start message and update connection record
                    runner_name = message.data.get("runner_name")
                    if runner_name and connection_record:
                        try:
                            await runner_crud.update_connection_runner_name(
                                db=db,
                                connection_id=connection_record.id,
                                runner_name=runner_name,
                            )
                            # Also update Redis metadata with runner_name
                            if runner_manager:
                                metadata = await runner_manager.get_connection_metadata(
                                    connection_record.id
                                )
                                if metadata:
                                    metadata["runner_name"] = runner_name
                                    metadata_key = f"runner:connection:{connection_record.id}:metadata"
                                    await redis_client.set(
                                        metadata_key, json.dumps(metadata), ex=300
                                    )  # 5 minute TTL
                            logger.info(
                                "runner_name_updated",
                                connection_id=connection_record.id,
                                runner_name=runner_name,
                            )
                        except Exception as e:
                            logger.error(
                                "runner_name_update_failed",
                                connection_id=connection_record.id,
                                error=str(e),
                            )

                    logger.info(
                        "automation_session_started",
                        user_id=str(user.id),
                        workflow_name=workflow_name,
                        runner_name=runner_name,
                        sessions_used=user.automation_sessions_used,
                    )

                    # Echo request_id if provided for request-response correlation
                    # Note: request_id is at root level of JSON, not in message.data
                    incoming_request_id = data.get("request_id")
                    logger.info(
                        "session_start_request_id_check",
                        incoming_request_id=incoming_request_id,
                        data_keys=list(data.keys()) if data else None,
                    )
                    response_data = {
                        "type": "session_started",
                        "success": True,  # Add success field for compatibility
                        "workflow_name": workflow_name,
                        "sessions_used": user.automation_sessions_used,
                        "sessions_remaining": (
                            user.automation_sessions_limit
                            - user.automation_sessions_used
                            if user.automation_sessions_limit is not None
                            else None
                        ),
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "data": {
                            "session_id": (
                                str(current_session_id) if current_session_id else None
                            )
                        },
                    }
                    # Check for request_id in the raw data (not message.data)
                    if incoming_request_id:
                        response_data["request_id"] = incoming_request_id
                    logger.info(
                        "session_start_response",
                        response_has_request_id="request_id" in response_data,
                        response_request_id=response_data.get("request_id"),
                    )
                    await websocket.send_json(response_data)

                    # Broadcast session_start event to status channel for frontend monitoring
                    if runner_manager and redis_client:
                        session_start_event = {
                            "type": "session_start",
                            "session_id": (
                                str(current_session_id)
                                if current_session_id
                                else str(uuid.uuid4())
                            ),
                            "project_id": (
                                str(message.data.get("project_id"))
                                if message.data.get("project_id")
                                else None
                            ),
                            "runner_version": message.data.get("runner_version"),
                            "runner_os": message.data.get("runner_os"),
                            "runner_hostname": message.data.get("runner_hostname"),
                            "workflow_name": workflow_name,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                        channel = f"runner:status:updates:{user.id}"
                        try:
                            await redis_client.publish(
                                channel, json.dumps(session_start_event)
                            )
                            logger.info(
                                "session_start_broadcast",
                                user_id=str(user.id),
                                channel=channel,
                            )
                        except Exception as e:
                            logger.error("session_start_broadcast_failed", error=str(e))

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

                    # Broadcast session_end event to status channel for frontend monitoring
                    if runner_manager and redis_client:
                        session_end_event = {
                            "type": "session_end",
                            "session_id": (
                                str(current_session_id) if current_session_id else None
                            ),
                            "status": session_status,
                            "error_message": message.data.get("error_message"),
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                        channel = f"runner:status:updates:{user.id}"
                        try:
                            await redis_client.publish(
                                channel, json.dumps(session_end_event)
                            )
                            logger.info(
                                "session_end_broadcast",
                                user_id=str(user.id),
                                channel=channel,
                            )
                        except Exception as e:
                            logger.error("session_end_broadcast_failed", error=str(e))

                    session_started = False
                    current_session_id = None

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

                    # Broadcast log event to status channel for frontend monitoring
                    if runner_manager and redis_client:
                        log_event = {
                            "type": "log",
                            "log_id": str(uuid.uuid4()),
                            "session_id": (
                                str(current_session_id) if current_session_id else None
                            ),
                            "level": log_level,
                            "message": log_message,
                            "log_data": message.data.get("data"),
                            "sequence_number": message.data.get("sequence_number", 0),
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                        channel = f"runner:status:updates:{user.id}"
                        try:
                            await redis_client.publish(channel, json.dumps(log_event))
                        except Exception as e:
                            logger.error("log_broadcast_failed", error=str(e))

                elif message_type == "screenshot":
                    # Handle screenshot with full S3 upload and database storage
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    response = await handle_screenshot(
                        message.data,
                        db,
                        user.id,
                        current_session_id,
                    )
                    await websocket.send_json(response)

                    # Broadcast screenshot event to status channel for frontend monitoring
                    if (
                        response.get("type") == "screenshot_stored"
                        and runner_manager
                        and redis_client
                    ):
                        # Generate presigned URL for the screenshot
                        screenshot_id = response.get("screenshot_id")
                        metadata = message.data.get("metadata", {})

                        # Get presigned URL from object storage
                        try:
                            from app.services.storage.object_storage import (
                                object_storage,
                            )

                            s3_key = f"automation/{user.id}/{current_session_id}/{screenshot_id}.png"
                            presigned_url = (
                                object_storage.backend.generate_presigned_url(
                                    key=s3_key,
                                    expiration=3600 * 24 * 7,  # 7 days
                                )
                            )
                        except Exception as e:
                            logger.error(
                                "screenshot_presigned_url_failed", error=str(e)
                            )
                            presigned_url = None

                        # Extract dimensions from metadata or use defaults
                        width = metadata.get("width", 0)
                        height = metadata.get("height", 0)

                        screenshot_event = {
                            "type": "screenshot",
                            "screenshot_id": screenshot_id,
                            "session_id": (
                                str(current_session_id) if current_session_id else None
                            ),
                            "name": metadata.get(
                                "name",
                                f"Screenshot {datetime.utcnow().strftime('%H:%M:%S')}",
                            ),
                            "width": width,
                            "height": height,
                            "presigned_url": presigned_url,
                            "automation_metadata": metadata,
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                        channel = f"runner:status:updates:{user.id}"
                        try:
                            await redis_client.publish(
                                channel, json.dumps(screenshot_event)
                            )
                            logger.info(
                                "screenshot_broadcast",
                                user_id=str(user.id),
                                screenshot_id=screenshot_id,
                            )
                        except Exception as e:
                            logger.error("screenshot_broadcast_failed", error=str(e))

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

                elif message_type == "command_response":
                    # Relay command response from runner to frontend(s)
                    # This is the response to a command sent from the frontend
                    if connection_record and runner_manager:
                        await runner_manager.send_response_to_frontends(
                            connection_record.id,
                            {
                                "type": "command_response",
                                "data": message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                        logger.info(
                            "command_response_relayed_to_frontends",
                            connection_id=connection_record.id,
                            response_type=message.data.get("response_type"),
                        )
                    await websocket.send_json(
                        {
                            "type": "command_response_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type.startswith("extraction_"):
                    # Relay web extraction events from runner to frontend(s)
                    # These include: extraction_started, extraction_progress,
                    # extraction_state_detected, extraction_element_detected,
                    # extraction_complete, extraction_error
                    if connection_record and runner_manager:
                        await runner_manager.send_response_to_frontends(
                            connection_record.id,
                            {
                                "type": message_type,
                                **message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                        logger.info(
                            "extraction_event_relayed_to_frontends",
                            connection_id=connection_record.id,
                            event_type=message_type,
                        )
                    await websocket.send_json(
                        {
                            "type": f"{message_type}_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "tree_event":
                    # Tree events are stored in database AND relayed to frontends
                    # Store the tree event for historical analysis
                    await store_tree_event(db, message.data)

                    # Relay to frontends for real-time display
                    if connection_record and runner_manager:
                        await runner_manager.send_response_to_frontends(
                            connection_record.id,
                            {
                                "type": message_type,
                                **message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                        logger.debug(
                            "tree_event_stored_and_relayed",
                            connection_id=connection_record.id,
                            event_type=message.data.get("event_type"),
                        )
                    # Acknowledge receipt
                    await websocket.send_json(
                        {
                            "type": "tree_event_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type in (
                    "image_recognition",
                    "action_execution",
                    "execution_started",
                    "execution_completed",
                    "state_changed",
                    "progress",
                    "error",
                ):
                    # Relay execution events from runner to frontend(s)
                    # These are real-time events during automation execution
                    if connection_record and runner_manager:
                        await runner_manager.send_response_to_frontends(
                            connection_record.id,
                            {
                                "type": message_type,
                                **message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                        logger.debug(
                            "execution_event_relayed_to_frontends",
                            connection_id=connection_record.id,
                            event_type=message_type,
                        )
                    # Acknowledge receipt
                    await websocket.send_json(
                        {
                            "type": f"{message_type}_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "issue_detected":
                    # Handle detected issue from runner
                    # Store in database and relay to frontends
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    try:
                        payload = message.data.get("payload", {})
                        # Parse source as IssueSource
                        source_data = payload.get("source", {})
                        source = IssueSource(
                            type=source_data.get("type", "other"),
                            path=source_data.get("path"),
                            line_range=(
                                tuple(source_data["line_range"])
                                if source_data.get("line_range")
                                else None
                            ),
                            description=source_data.get("description"),
                        )

                        # Create issue sync item
                        issue_item = IssueSyncItem(
                            id=payload.get("id", str(uuid.uuid4())),
                            session_id=(
                                str(current_session_id)
                                if current_session_id
                                else "unknown"
                            ),
                            type=payload.get("type", "error"),
                            severity=payload.get("severity", "medium"),
                            title=payload.get("title", "Unknown Issue"),
                            description=payload.get("description"),
                            file=payload.get("file"),
                            line=payload.get("line"),
                            source=source,
                            status=payload.get("status", "detected"),
                            resolution=payload.get("resolution"),
                            detected_at=datetime.fromisoformat(
                                payload.get(
                                    "detected_at", datetime.utcnow().isoformat()
                                ).replace("Z", "+00:00")
                            ),
                            resolved_at=(
                                datetime.fromisoformat(
                                    payload["resolved_at"].replace("Z", "+00:00")
                                )
                                if payload.get("resolved_at")
                                else None
                            ),
                        )

                        # Sync to database
                        project_id = (
                            UUID(message.data.get("project_id"))
                            if message.data.get("project_id")
                            else None
                        )
                        synced, updated, errors = await issue_crud.sync_issues(
                            db=db,
                            user_id=user.id,
                            project_id=project_id,
                            issues=[issue_item],
                        )

                        logger.info(
                            "issue_detected_stored",
                            user_id=str(user.id),
                            issue_title=issue_item.title[:50],
                            synced=synced,
                            updated=updated,
                        )

                        # Relay to frontends
                        if connection_record and runner_manager:
                            await runner_manager.send_response_to_frontends(
                                connection_record.id,
                                {
                                    "type": "issue_detected",
                                    **payload,
                                    "timestamp": datetime.utcnow().isoformat() + "Z",
                                },
                            )

                        await websocket.send_json(
                            {
                                "type": "issue_detected_ack",
                                "synced": synced,
                                "updated": updated,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            }
                        )

                    except Exception as e:
                        logger.error(
                            "issue_detected_error",
                            error=str(e),
                            error_type=type(e).__name__,
                        )
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Failed to store issue: {str(e)}",
                            }
                        )

                elif message_type == "issue_updated":
                    # Handle issue status update from runner
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    try:
                        payload = message.data.get("payload", {})
                        # Note: For updates, we need to match by title/detected_at
                        # since the runner's client ID might not be the DB UUID
                        # This is handled by sync_issues deduplication logic

                        logger.info(
                            "issue_updated_received",
                            user_id=str(user.id),
                            issue_id=payload.get("id"),
                            status=payload.get("status"),
                        )

                        # Relay to frontends
                        if connection_record and runner_manager:
                            await runner_manager.send_response_to_frontends(
                                connection_record.id,
                                {
                                    "type": "issue_updated",
                                    **payload,
                                    "timestamp": datetime.utcnow().isoformat() + "Z",
                                },
                            )

                        await websocket.send_json(
                            {
                                "type": "issue_updated_ack",
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            }
                        )

                    except Exception as e:
                        logger.error(
                            "issue_updated_error",
                            error=str(e),
                            error_type=type(e).__name__,
                        )
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Failed to update issue: {str(e)}",
                            }
                        )

                elif message_type == "issues_sync":
                    # Handle bulk issues sync from runner
                    if not session_started:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "No active session. Start session first.",
                            }
                        )
                        continue

                    try:
                        payload = message.data.get("payload", {})
                        issues_data = payload.get("issues", [])
                        project_id = (
                            UUID(message.data.get("project_id"))
                            if message.data.get("project_id")
                            else None
                        )

                        # Convert to IssueSyncItem list
                        issue_items = []
                        for issue_data in issues_data:
                            source_data = issue_data.get("source", {})
                            source = IssueSource(
                                type=source_data.get("type", "other"),
                                path=source_data.get("path"),
                                line_range=(
                                    tuple(source_data["line_range"])
                                    if source_data.get("line_range")
                                    else None
                                ),
                                description=source_data.get("description"),
                            )

                            issue_items.append(
                                IssueSyncItem(
                                    id=issue_data.get("id", str(uuid.uuid4())),
                                    session_id=(
                                        str(current_session_id)
                                        if current_session_id
                                        else "unknown"
                                    ),
                                    type=issue_data.get("type", "error"),
                                    severity=issue_data.get("severity", "medium"),
                                    title=issue_data.get("title", "Unknown Issue"),
                                    description=issue_data.get("description"),
                                    file=issue_data.get("file"),
                                    line=issue_data.get("line"),
                                    source=source,
                                    status=issue_data.get("status", "detected"),
                                    resolution=issue_data.get("resolution"),
                                    detected_at=datetime.fromisoformat(
                                        issue_data.get(
                                            "detected_at", datetime.utcnow().isoformat()
                                        ).replace("Z", "+00:00")
                                    ),
                                    resolved_at=(
                                        datetime.fromisoformat(
                                            issue_data["resolved_at"].replace(
                                                "Z", "+00:00"
                                            )
                                        )
                                        if issue_data.get("resolved_at")
                                        else None
                                    ),
                                )
                            )

                        # Sync to database
                        synced, updated, errors = await issue_crud.sync_issues(
                            db=db,
                            user_id=user.id,
                            project_id=project_id,
                            issues=issue_items,
                        )

                        logger.info(
                            "issues_sync_completed",
                            user_id=str(user.id),
                            total_issues=len(issues_data),
                            synced=synced,
                            updated=updated,
                            errors=len(errors),
                        )

                        await websocket.send_json(
                            {
                                "type": "issues_sync_ack",
                                "synced": synced,
                                "updated": updated,
                                "errors": errors,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            }
                        )

                    except Exception as e:
                        logger.error(
                            "issues_sync_error",
                            error=str(e),
                            error_type=type(e).__name__,
                        )
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": f"Failed to sync issues: {str(e)}",
                            }
                        )

                elif message_type == "pong":
                    # Standard WebSocket keepalive response - no action needed
                    # Silently ignore to avoid log spam
                    pass

                else:
                    # Unknown message type - still relay to frontend in case they can handle it
                    if connection_record and runner_manager:
                        await runner_manager.send_response_to_frontends(
                            connection_record.id,
                            {
                                "type": message_type,
                                **message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                        logger.warning(
                            "unknown_message_type_relayed",
                            connection_id=connection_record.id,
                            message_type=message_type,
                        )
                    await websocket.send_json(
                        {
                            "type": "warning",
                            "message": f"Unknown message type '{message_type}' - relayed to frontends anyway",
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
        # Clean up rate limiting state
        cleanup_rate_limit_session(session_key)

        # Unregister runner from connection manager
        if connection_record:
            try:
                redis_client = await get_redis()
                runner_manager = await get_runner_connection_manager(redis_client)
                # Pass user_id to ensure disconnect event is published to frontend
                await runner_manager.unregister_runner(
                    connection_record.id, user.id if user else None
                )
            except Exception as e:
                logger.error(
                    "runner_unregister_failed",
                    connection_id=connection_record.id if connection_record else None,
                    error=str(e),
                )

        # Close connection record (for both runner token and JWT auth)
        if connection_record and db:
            try:
                await runner_crud.close_connection_record(
                    db=db,
                    connection_id=connection_record.id,
                )
                logger.info(
                    "runner_connection_closed",
                    connection_id=connection_record.id,
                    duration_seconds=connection_record.duration_seconds,
                )
            except Exception as e:
                logger.error(
                    "runner_connection_close_failed",
                    error=str(e),
                    error_type=type(e).__name__,
                )

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
            auth_method="jwt",
        )


@router.websocket("/ws/automation/monitor/{session_id}")
async def websocket_monitor_endpoint(
    websocket: WebSocket,
    session_id: str,
    token: str | None = None,
):
    """
    WebSocket endpoint for monitoring automation sessions in real-time.

    This endpoint demonstrates the Redis Pub/Sub scalability feature.
    Multiple backend instances can broadcast events, and all connected
    clients receive them through Redis channels.

    Connection URL:
        ws://localhost:8000/api/v1/ws/automation/monitor/{session_id}?token=<jwt_token>

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
        - Rate limiting: 5 connections per minute per IP, 60 messages per minute per session
    """
    # Check connection rate limit (5 per minute per IP)
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_connection_rate_limit(client_ip, limit=5, window=60):
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
    session_key = f"ws_monitor_{id(websocket)}"  # Unique session key for rate limiting

    try:
        # Authenticate user (supports JWT token, runner tokens, and cookies)
        # Try to get token from query param, then from cookies
        auth_token: str | None = token
        if not auth_token:
            # Try to read from cookies (for HttpOnly cookie auth)
            auth_token = websocket.cookies.get("access_token")

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
                    "message": "Authentication required. Provide token query param or access_token cookie.",
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

        # Get database session
        async for db_session in get_async_db():
            db = db_session
            break

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
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

        # Broadcast connection event to all instances
        await ws_manager.broadcast(
            session_id,
            {
                "type": "connection_info",
                "action": "user_joined",
                "user_id": str(user.id),
                "username": user.username,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
        )

        # Main message loop
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)

                # Check message rate limit (60 messages per minute)
                if not check_message_rate_limit(session_key, limit=60, window=60):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Message rate limit exceeded. Maximum 60 messages per minute.",
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
                    # Acknowledge ping
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "request_status":
                    # Send status information
                    await websocket.send_json(
                        {
                            "type": "status",
                            "session_id": session_id,
                            "local_connections": ws_manager.get_connection_count(
                                session_id
                            ),
                            "total_sessions": len(ws_manager.get_active_sessions()),
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
        cleanup_rate_limit_session(session_key)

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
                        "timestamp": datetime.utcnow().isoformat() + "Z",
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
