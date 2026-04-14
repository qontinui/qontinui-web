"""WebSocket endpoints for test execution streaming.

Provides real-time test execution monitoring, allowing qontinui-runner to stream
test results (transitions, screenshots, deficiencies) to the backend and broadcast
updates to dashboard clients via Redis pub/sub.

This module provides a thin endpoint layer that delegates to the refactored
WebSocket infrastructure in app.websockets.testing.
"""

from app.websockets.testing import testing_handler
from fastapi import APIRouter, WebSocket

router = APIRouter()


@router.websocket("/ws/testing/runner")
async def websocket_testing_runner_endpoint(
    websocket: WebSocket,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for test execution streaming from runners.

    Connection URL:
        ws://localhost:8000/api/v1/testing/ws/testing/runner?token=<jwt_token>

    Query Parameters:
        token: JWT access token for authentication

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
    await testing_handler.handle_connection(websocket, token=token)
