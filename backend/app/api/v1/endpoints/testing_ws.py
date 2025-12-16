"""
WebSocket endpoints for test execution streaming.

Provides real-time test execution monitoring, allowing qontinui-runner to stream
test results (transitions, screenshots, deficiencies) to the backend and broadcast
updates to dashboard clients via Redis pub/sub.
"""

import asyncio
import base64
import io
import time
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import authenticate_runner, get_async_db
from app.api.v1.endpoints.images import (
    validate_image_magic_bytes,
    validate_image_mime_type,
)
from app.config.redis_config import get_redis
from app.crud import runner as runner_crud
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.transition_execution import (
    TransitionExecution,
    TransitionExecutionStatus,
)
from app.models.user import User
from app.schemas.testing_ws import (
    DeficiencyData,
    ScreenshotData,
    SessionEndData,
    SessionStartData,
    TransitionCompletedData,
    TransitionStartedData,
    WSTestMessage,
)
from app.services.object_storage import object_storage
from app.services.websocket_manager import get_websocket_manager

router = APIRouter()
logger = structlog.get_logger(__name__)

# Rate limiting state (in-memory for WebSocket connections)
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
    session_key: str, limit: int = 100, window: int = 60
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


async def handle_session_start(
    message: dict,
    db: AsyncSession,
    user: User,
    connection_record_id: int | None,
) -> dict:
    """
    Handle session_start message.

    Creates SoftwareTestRun record and returns the test run ID.

    Args:
        message: Message data containing session start details
        db: Database session
        user: Authenticated user
        connection_record_id: Runner connection record ID

    Returns:
        Response message with test_run_id
    """
    try:
        # Validate and parse message data
        try:
            session_data = SessionStartData(**message)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid session_start data: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Verify project exists and user has access
        from sqlalchemy.sql import Select

        user_org_subquery: Select = select(User.personal_org_id).where(User.id == user.id)  # type: ignore[arg-type]
        project_query = select(Project).where(
            Project.id == session_data.project_id,
            Project.organization_id.in_(user_org_subquery),
        )
        project_result = await db.execute(project_query)
        project = project_result.scalar_one_or_none()

        if not project:
            return {
                "type": "error",
                "message": f"Project {session_data.project_id} not found or access denied",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Create test run record
        test_run = SoftwareTestRun(
            project_id=session_data.project_id,
            runner_connection_id=connection_record_id,
            workflow_id=session_data.workflow_id,
            status=TestRunStatus.RUNNING,
            started_at=datetime.utcnow(),
            configuration_snapshot=session_data.configuration_snapshot,
            test_mode=session_data.test_mode,
            max_duration_seconds=session_data.max_duration_seconds,
            seed_value=session_data.seed_value,
            runner_metadata=session_data.runner_metadata,
        )

        db.add(test_run)
        await db.commit()
        await db.refresh(test_run)

        logger.info(
            "test_run_started",
            test_run_id=str(test_run.id),
            project_id=str(session_data.project_id),
            workflow_id=session_data.workflow_id,
            user_id=str(user.id),
        )

        return {
            "type": "session_started",
            "test_run_id": str(test_run.id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error("session_start_error", error=str(e), error_type=type(e).__name__)
        return {
            "type": "error",
            "message": f"Failed to start test session: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


async def handle_transition_started(
    message: dict,
    db: AsyncSession,
    test_run_id: UUID | None,
) -> dict:
    """
    Handle transition_started message.

    Creates TransitionExecution record with status "running".

    Args:
        message: Message data containing transition start details
        db: Database session
        test_run_id: Current test run ID

    Returns:
        Response message with transition_execution_id
    """
    try:
        if not test_run_id:
            return {
                "type": "error",
                "message": "No active test session. Start session first.",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate and parse message data
        try:
            transition_data = TransitionStartedData(**message)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid transition_started data: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Create transition execution record
        transition_execution = TransitionExecution(
            test_run_id=test_run_id,
            transition_id=transition_data.transition_id,
            transition_name=transition_data.transition_name,
            sequence_number=transition_data.sequence_number,
            status=TransitionExecutionStatus.SUCCESS,  # Will be updated on completion
            started_at=transition_data.timestamp,
            source_state=transition_data.source_state,
            target_state=transition_data.target_state,
        )

        db.add(transition_execution)
        await db.commit()
        await db.refresh(transition_execution)

        logger.info(
            "transition_started",
            transition_execution_id=str(transition_execution.id),
            test_run_id=str(test_run_id),
            transition_id=transition_data.transition_id,
            sequence_number=transition_data.sequence_number,
        )

        return {
            "type": "transition_started_ack",
            "transition_execution_id": str(transition_execution.id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error(
            "transition_started_error", error=str(e), error_type=type(e).__name__
        )
        return {
            "type": "error",
            "message": f"Failed to record transition start: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


async def handle_transition_completed(
    message: dict,
    db: AsyncSession,
    test_run_id: UUID | None,
) -> dict:
    """
    Handle transition_completed message.

    Updates TransitionExecution record with result and timing.

    Args:
        message: Message data containing transition completion details
        db: Database session
        test_run_id: Current test run ID

    Returns:
        Response message with transition_execution_id
    """
    try:
        if not test_run_id:
            return {
                "type": "error",
                "message": "No active test session. Start session first.",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate and parse message data
        try:
            transition_data = TransitionCompletedData(**message)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid transition_completed data: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Find the transition execution record by transition_id and sequence_number
        query = select(TransitionExecution).where(
            TransitionExecution.test_run_id == test_run_id,
            TransitionExecution.transition_id == transition_data.transition_id,
            TransitionExecution.sequence_number == transition_data.sequence_number,
        )
        result = await db.execute(query)
        transition_execution = result.scalar_one_or_none()

        if not transition_execution:
            return {
                "type": "error",
                "message": f"Transition execution not found for sequence {transition_data.sequence_number}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Update transition execution record
        transition_execution.status = TransitionExecutionStatus(transition_data.status)
        transition_execution.completed_at = transition_data.timestamp
        transition_execution.execution_time_ms = transition_data.execution_time_ms
        transition_execution.actual_state = transition_data.actual_state
        transition_execution.state_match = transition_data.state_match
        transition_execution.error_type = transition_data.error_type
        transition_execution.error_message = transition_data.error_message
        transition_execution.error_stacktrace = transition_data.error_stacktrace
        transition_execution.input_data = transition_data.input_data
        transition_execution.output_data = transition_data.output_data
        transition_execution.action_count = transition_data.action_count
        transition_execution.retry_count = transition_data.retry_count
        transition_execution.execution_metadata = transition_data.metadata

        await db.commit()
        await db.refresh(transition_execution)

        # Update test run aggregate statistics
        test_run_query = select(SoftwareTestRun).where(
            SoftwareTestRun.id == test_run_id
        )
        test_run_result = await db.execute(test_run_query)
        test_run = test_run_result.scalar_one_or_none()

        if test_run:
            test_run.total_transitions += 1
            if transition_data.status == "success":
                test_run.successful_transitions += 1
            elif (
                transition_data.status == "failed" or transition_data.status == "error"
            ):
                test_run.failed_transitions += 1
            elif transition_data.status == "skipped":
                test_run.skipped_transitions += 1

            await db.commit()

        logger.info(
            "transition_completed",
            transition_execution_id=str(transition_execution.id),
            test_run_id=str(test_run_id),
            status=transition_data.status,
            execution_time_ms=transition_data.execution_time_ms,
        )

        return {
            "type": "transition_completed_ack",
            "transition_execution_id": str(transition_execution.id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error(
            "transition_completed_error", error=str(e), error_type=type(e).__name__
        )
        return {
            "type": "error",
            "message": f"Failed to record transition completion: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


async def handle_screenshot(
    message: dict,
    db: AsyncSession,
    user_id: UUID,
    test_run_id: UUID | None,
) -> dict:
    """
    Handle screenshot message with S3 upload and database storage.

    Args:
        message: Message data containing screenshot image and metadata
        db: Database session
        user_id: User ID for S3 path organization
        test_run_id: Current test run ID

    Returns:
        Response message with screenshot_id
    """
    try:
        if not test_run_id:
            return {
                "type": "error",
                "message": "No active test session. Start session first.",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate and parse message data
        try:
            screenshot_data = ScreenshotData(**message)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid screenshot data: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Decode base64 image
        try:
            image_bytes = base64.b64decode(screenshot_data.image)
        except Exception as e:
            logger.error("screenshot_decode_failed", error=str(e))
            return {
                "type": "error",
                "message": f"Failed to decode base64 image: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate image MIME type
        content_type = screenshot_data.metadata.get("content_type", "image/png")
        try:
            content_type = validate_image_mime_type(content_type)
        except HTTPException as e:
            return {
                "type": "error",
                "message": str(e.detail),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate file size (10MB limit)
        file_size = len(image_bytes)
        if file_size > 10 * 1024 * 1024:
            return {
                "type": "error",
                "message": "Screenshot too large. Maximum size: 10.0MB",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate magic bytes
        try:
            validate_image_magic_bytes(image_bytes, content_type)
        except HTTPException as e:
            return {
                "type": "error",
                "message": str(e.detail),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Extract image dimensions
        try:
            image_file = io.BytesIO(image_bytes)
            with Image.open(image_file) as img:
                width, height = img.size
        except Exception as e:
            logger.error("screenshot_dimension_extraction_failed", error=str(e))
            return {
                "type": "error",
                "message": f"Failed to extract image dimensions: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Generate unique screenshot ID and S3 key
        screenshot_id = uuid4()
        file_extension = content_type.split("/")[-1]
        s3_key = f"testing/{user_id}/{test_run_id}/{screenshot_id}.{file_extension}"

        # Upload to S3
        try:
            image_file = io.BytesIO(image_bytes)
            object_storage.backend.upload_file(
                file_obj=image_file,
                key=s3_key,
                content_type=content_type,
                metadata={
                    "user_id": str(user_id),
                    "test_run_id": str(test_run_id),
                    "screenshot_id": str(screenshot_id),
                    "transition_id": screenshot_data.transition_id or "",
                    "sequence_number": str(screenshot_data.sequence_number or ""),
                    "width": str(width),
                    "height": str(height),
                },
            )

            logger.info(
                "screenshot_uploaded_to_s3",
                user_id=str(user_id),
                test_run_id=str(test_run_id),
                screenshot_id=str(screenshot_id),
                s3_key=s3_key,
                file_size=file_size,
            )
        except Exception as e:
            logger.error(
                "screenshot_s3_upload_failed",
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "type": "error",
                "message": f"Failed to upload screenshot: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Link screenshot to transition execution if provided
        if screenshot_data.transition_id and screenshot_data.sequence_number:
            query = select(TransitionExecution).where(
                TransitionExecution.test_run_id == test_run_id,
                TransitionExecution.transition_id == screenshot_data.transition_id,
                TransitionExecution.sequence_number == screenshot_data.sequence_number,
            )
            result = await db.execute(query)
            transition_execution = result.scalar_one_or_none()

            if transition_execution:
                # Add screenshot URL to transition execution
                screenshot_urls = transition_execution.screenshot_urls or []
                screenshot_urls.append(s3_key)
                transition_execution.screenshot_urls = screenshot_urls
                await db.commit()

                logger.info(
                    "screenshot_linked_to_transition",
                    screenshot_id=str(screenshot_id),
                    transition_execution_id=str(transition_execution.id),
                )

        return {
            "type": "screenshot_stored",
            "screenshot_id": str(screenshot_id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error(
            "screenshot_handler_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to process screenshot: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


async def handle_deficiency(
    message: dict,
    db: AsyncSession,
    test_run_id: UUID | None,
) -> dict:
    """
    Handle deficiency message.

    Creates TestDeficiency record for bugs/issues found during testing.

    Args:
        message: Message data containing deficiency details
        db: Database session
        test_run_id: Current test run ID

    Returns:
        Response message with deficiency_id
    """
    try:
        if not test_run_id:
            return {
                "type": "error",
                "message": "No active test session. Start session first.",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate and parse message data
        try:
            deficiency_data = DeficiencyData(**message)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid deficiency data: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Find transition execution if provided
        transition_execution_id = None
        if deficiency_data.transition_id and deficiency_data.sequence_number:
            query = select(TransitionExecution).where(
                TransitionExecution.test_run_id == test_run_id,
                TransitionExecution.transition_id == deficiency_data.transition_id,
                TransitionExecution.sequence_number == deficiency_data.sequence_number,
            )
            result = await db.execute(query)
            transition_execution = result.scalar_one_or_none()
            if transition_execution:
                transition_execution_id = transition_execution.id

        # Create deficiency record
        deficiency = TestDeficiency(
            test_run_id=test_run_id,
            transition_execution_id=transition_execution_id,
            severity=DeficiencySeverity(deficiency_data.severity),
            deficiency_type=DeficiencyType(deficiency_data.deficiency_type),
            title=deficiency_data.title,
            description=deficiency_data.description,
            reproduction_steps=deficiency_data.reproduction_steps,
            screenshot_urls=[
                f"testing/{str(screenshot_id)}"
                for screenshot_id in deficiency_data.screenshot_ids
            ],
            environment_info=deficiency_data.environment_info,
            preconditions=deficiency_data.preconditions,
            tags=deficiency_data.tags,
            custom_fields=deficiency_data.custom_fields,
            status=DeficiencyStatus.NEW,
        )

        db.add(deficiency)
        await db.commit()
        await db.refresh(deficiency)

        # Update test run deficiencies count
        test_run_query = select(SoftwareTestRun).where(
            SoftwareTestRun.id == test_run_id
        )
        test_run_result = await db.execute(test_run_query)
        test_run = test_run_result.scalar_one_or_none()

        if test_run:
            test_run.deficiencies_found += 1
            await db.commit()

        logger.info(
            "deficiency_recorded",
            deficiency_id=str(deficiency.id),
            test_run_id=str(test_run_id),
            severity=deficiency_data.severity,
            deficiency_type=deficiency_data.deficiency_type,
        )

        return {
            "type": "deficiency_recorded",
            "deficiency_id": str(deficiency.id),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error(
            "deficiency_handler_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to record deficiency: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


async def handle_session_end(
    message: dict,
    db: AsyncSession,
    test_run_id: UUID | None,
) -> dict:
    """
    Handle session_end message.

    Updates SoftwareTestRun status and final metrics.

    Args:
        message: Message data containing session end details
        db: Database session
        test_run_id: Current test run ID

    Returns:
        Response message with test_run_id and final status
    """
    try:
        if not test_run_id:
            return {
                "type": "error",
                "message": "No active test session to end.",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Validate and parse message data
        try:
            session_data = SessionEndData(**message)
        except ValidationError as e:
            return {
                "type": "error",
                "message": f"Invalid session_end data: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        # Update test run record
        query = select(SoftwareTestRun).where(SoftwareTestRun.id == test_run_id)
        result = await db.execute(query)
        test_run = result.scalar_one_or_none()

        if not test_run:
            return {
                "type": "error",
                "message": f"Test run {test_run_id} not found",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }

        test_run.status = TestRunStatus(session_data.status)
        test_run.completed_at = datetime.utcnow()
        test_run.error_summary = session_data.error_summary
        test_run.total_transitions = session_data.total_transitions
        test_run.successful_transitions = session_data.successful_transitions
        test_run.failed_transitions = session_data.failed_transitions
        test_run.skipped_transitions = session_data.skipped_transitions
        test_run.coverage_percentage = Decimal(str(session_data.coverage_percentage))
        test_run.unique_paths_found = session_data.unique_paths_found
        test_run.unique_states_visited = session_data.unique_states_visited
        test_run.deficiencies_found = session_data.deficiencies_found

        await db.commit()
        await db.refresh(test_run)

        logger.info(
            "test_run_ended",
            test_run_id=str(test_run_id),
            status=session_data.status,
            total_transitions=session_data.total_transitions,
            deficiencies_found=session_data.deficiencies_found,
        )

        return {
            "type": "session_ended",
            "test_run_id": str(test_run_id),
            "status": session_data.status,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    except Exception as e:
        logger.error("session_end_error", error=str(e), error_type=type(e).__name__)
        return {
            "type": "error",
            "message": f"Failed to end test session: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }


@router.websocket("/ws/testing/runner")
async def websocket_testing_runner_endpoint(
    websocket: WebSocket,
    token: str | None = None,
):
    """
    WebSocket endpoint for test execution streaming from runners.

    Connection URL:
        ws://localhost:8000/api/v1/testing/ws/testing/runner?token=<runner_token>

    Query Parameters:
        token: Runner token or JWT access token for authentication

    Message Types (Client -> Server):
        - session_start: Start new test session
          {"type": "session_start", "data": {...}}

        - transition_started: Transition execution started
          {"type": "transition_started", "data": {...}}

        - transition_completed: Transition execution completed
          {"type": "transition_completed", "data": {...}}

        - screenshot: Send screenshot with metadata
          {"type": "screenshot", "data": {...}}

        - deficiency: Report deficiency found
          {"type": "deficiency", "data": {...}}

        - session_end: End test session
          {"type": "session_end", "data": {...}}

        - heartbeat: Keep connection alive
          {"type": "heartbeat"}

    Message Types (Server -> Client):
        - session_started: Session created successfully
        - transition_started_ack: Transition record created
        - transition_completed_ack: Transition updated
        - screenshot_stored: Screenshot uploaded
        - deficiency_recorded: Deficiency recorded
        - session_ended: Session completed
        - error: Error message
        - heartbeat_ack: Heartbeat acknowledgment

    Features:
        - Authentication via runner token or JWT
        - Real-time streaming to dashboard via Redis pub/sub
        - Automatic heartbeat/ping-pong
        - Rate limiting: 5 connections/min per IP, 100 messages/min per session
    """
    # Check connection rate limit
    client_ip = websocket.client.host if websocket.client else "unknown"
    if not check_connection_rate_limit(client_ip, limit=5, window=60):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Connection rate limit exceeded. Maximum 5 connections per minute.",
        )
        logger.warning(
            "testing_ws_connection_rate_limited",
            client_ip=client_ip,
        )
        return

    await websocket.accept()

    logger.info("testing_ws_connection_attempt", client_ip=client_ip)

    db = None
    user = None
    runner_token = None
    connection_record = None
    test_run_id = None
    session_key = f"ws_testing_{id(websocket)}"

    try:
        # Authenticate user (supports runner tokens and JWT)
        auth_token: str | None = token
        if not auth_token:
            auth_token = websocket.cookies.get("access_token")

        if not auth_token:
            logger.error("testing_ws_no_token")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication required. Provide token query param or access_token cookie.",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user, runner_token = await authenticate_runner(auth_token)
        except Exception as e:
            logger.error("testing_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Authentication failed",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Get database session
        async for db_session in get_async_db():
            db = db_session
            break

        if not db:
            logger.error("testing_ws_db_failed")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Database connection failed",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Re-fetch user in this session
        from typing import cast
        from uuid import UUID as UUIDType

        user_id = cast(UUIDType, user.id)
        user_result = await db.execute(select(User).where(User.id == user_id))  # type: ignore[arg-type]
        user = user_result.scalar_one_or_none()

        if not user:
            logger.error("testing_ws_user_not_found")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "User not found",
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Log connection record (for runner tokens)
        if runner_token:
            try:
                client_host = websocket.client.host if websocket.client else None
                connection_record = await runner_crud.create_connection_record(
                    db=db,
                    user_id=user.id,
                    token_id=runner_token.id,
                    ip_address=client_host,
                )
                logger.info(
                    "testing_runner_connection_logged",
                    connection_id=connection_record.id,
                    token_name=runner_token.name,
                )
            except Exception as e:
                logger.error(
                    "testing_runner_connection_log_failed",
                    error=str(e),
                    error_type=type(e).__name__,
                )

        logger.info(
            "testing_ws_connected",
            user_id=str(user.id),
            auth_method="runner_token" if runner_token else "jwt",
        )

        # Send connection acknowledgment
        await websocket.send_json(
            {
                "type": "connected",
                "user_id": str(user.id),
                "auth_method": "runner_token" if runner_token else "jwt",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

        # Get WebSocket manager for broadcasting
        redis_client = await get_redis()
        ws_manager = await get_websocket_manager(redis_client)

        # Track last activity for heartbeat monitoring
        last_activity = time.time()
        heartbeat_interval = 30.0
        stale_connection_timeout = 90.0

        # Main message loop
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(
                    websocket.receive_json(), timeout=heartbeat_interval
                )

                # Check message rate limit
                if not check_message_rate_limit(session_key, limit=100, window=60):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Message rate limit exceeded. Maximum 100 messages per minute.",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                    logger.warning(
                        "testing_ws_message_rate_limited",
                        user_id=str(user.id),
                        session_key=session_key,
                    )
                    continue

                # Validate message
                try:
                    message = WSTestMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Invalid message format: {str(e)}",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                    continue

                # Update last activity timestamp
                last_activity = time.time()

                # Handle message types
                message_type = message.type

                if message_type == "heartbeat":
                    await websocket.send_json(
                        {
                            "type": "heartbeat_ack",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                elif message_type == "session_start":
                    response = await handle_session_start(
                        message.data,
                        db,
                        user,
                        connection_record.id if connection_record else None,
                    )
                    if response["type"] == "session_started":
                        test_run_id = UUID(response["test_run_id"])
                        # Broadcast to dashboard clients
                        if test_run_id:
                            await ws_manager.broadcast(
                                str(test_run_id),
                                {
                                    "type": "test_run_started",
                                    "test_run_id": str(test_run_id),
                                    "timestamp": datetime.utcnow().isoformat() + "Z",
                                },
                            )
                    await websocket.send_json(response)

                elif message_type == "transition_started":
                    response = await handle_transition_started(
                        message.data, db, test_run_id
                    )
                    # Broadcast to dashboard clients
                    if test_run_id and response["type"] == "transition_started_ack":
                        await ws_manager.broadcast(
                            str(test_run_id),
                            {
                                "type": "transition_started",
                                **message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                    await websocket.send_json(response)

                elif message_type == "transition_completed":
                    response = await handle_transition_completed(
                        message.data, db, test_run_id
                    )
                    # Broadcast to dashboard clients
                    if test_run_id and response["type"] == "transition_completed_ack":
                        await ws_manager.broadcast(
                            str(test_run_id),
                            {
                                "type": "transition_completed",
                                **message.data,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                    await websocket.send_json(response)

                elif message_type == "screenshot":
                    response = await handle_screenshot(
                        message.data, db, user.id, test_run_id
                    )
                    await websocket.send_json(response)

                elif message_type == "deficiency":
                    response = await handle_deficiency(message.data, db, test_run_id)
                    # Broadcast to dashboard clients
                    if test_run_id and response["type"] == "deficiency_recorded":
                        await ws_manager.broadcast(
                            str(test_run_id),
                            {
                                "type": "deficiency_found",
                                "deficiency_id": response["deficiency_id"],
                                "severity": message.data.get("severity"),
                                "title": message.data.get("title"),
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                    await websocket.send_json(response)

                elif message_type == "session_end":
                    response = await handle_session_end(message.data, db, test_run_id)
                    # Broadcast to dashboard clients
                    if test_run_id and response["type"] == "session_ended":
                        await ws_manager.broadcast(
                            str(test_run_id),
                            {
                                "type": "test_run_ended",
                                "test_run_id": str(test_run_id),
                                "status": response["status"],
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                        )
                    await websocket.send_json(response)
                    # Clear test_run_id after session end
                    test_run_id = None

                elif message_type == "ping":
                    # Respond to client ping
                    last_activity = time.time()
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message_type}",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )

            except TimeoutError:
                # Check if connection is stale
                time_since_activity = time.time() - last_activity
                if time_since_activity > stale_connection_timeout:
                    logger.warning(
                        "testing_ws_stale_connection",
                        user_id=str(user.id) if user else None,
                        time_since_activity=time_since_activity,
                    )
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Connection stale - no activity for 90s",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                    break

                # Send ping to keep connection alive
                try:
                    await websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                    logger.debug(
                        "testing_ws_ping_sent",
                        user_id=str(user.id) if user else None,
                    )
                except Exception as e:
                    logger.error(
                        "testing_ws_ping_failed",
                        user_id=str(user.id) if user else None,
                        error=str(e),
                    )
                    break

            except WebSocketDisconnect:
                logger.info(
                    "testing_ws_client_disconnected",
                    user_id=str(user.id) if user else None,
                )
                break

            except Exception as e:
                logger.error(
                    "testing_ws_message_error",
                    user_id=str(user.id) if user else None,
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Message processing error: {str(e)}",
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                except Exception:
                    break

    except Exception as e:
        logger.error(
            "testing_ws_fatal_error",
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Clean up rate limiting state
        cleanup_rate_limit_session(session_key)

        # Close connection record (for runner tokens)
        if connection_record and db:
            try:
                await runner_crud.close_connection_record(
                    db=db,
                    connection_id=connection_record.id,
                )
                logger.info(
                    "testing_runner_connection_closed",
                    connection_id=connection_record.id,
                )
            except Exception as e:
                logger.error(
                    "testing_runner_connection_close_failed",
                    error=str(e),
                )

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
            "testing_ws_cleanup_complete",
            user_id=str(user.id) if user else None,
        )
