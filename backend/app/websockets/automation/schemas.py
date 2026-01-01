"""WebSocket message schemas for automation endpoints.

Defines Pydantic models for validating WebSocket messages between
the runner, backend, and frontend clients.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class WSMessage(BaseModel):
    """Base WebSocket message schema.

    All incoming WebSocket messages must conform to this structure.
    """

    type: str = Field(..., description="Message type identifier")
    data: dict[str, Any] = Field(
        default_factory=dict,
        description="Message payload data",
    )


class HeartbeatResponse(BaseModel):
    """Heartbeat acknowledgment response."""

    type: str = "heartbeat_ack"
    timestamp: str


class ConnectedResponse(BaseModel):
    """Connection acknowledgment response."""

    type: str = "connected"
    user_id: str
    username: str
    auth_method: str
    sessions_remaining: int | None
    timestamp: str


class SessionStartedResponse(BaseModel):
    """Session start acknowledgment response."""

    type: str = "session_started"
    success: bool = True
    workflow_name: str
    sessions_used: int
    sessions_remaining: int | None
    timestamp: str
    data: dict[str, Any]
    request_id: str | None = None


class SessionEndedResponse(BaseModel):
    """Session end acknowledgment response."""

    type: str = "session_ended"
    status: str
    timestamp: str


class ErrorResponse(BaseModel):
    """Error response message."""

    type: str = "error"
    message: str


class WarningResponse(BaseModel):
    """Warning response message."""

    type: str = "warning"
    message: str


class LogReceivedResponse(BaseModel):
    """Log acknowledgment response."""

    type: str = "log_received"
    timestamp: str


class ScreenshotStoredResponse(BaseModel):
    """Screenshot storage acknowledgment response."""

    type: str = "screenshot_stored"
    screenshot_id: str
    timestamp: str


class InputEventReceivedResponse(BaseModel):
    """Input event acknowledgment response."""

    type: str = "input_event_received"
    event_id: str
    timestamp: str


class RunnerInfoAckResponse(BaseModel):
    """Runner info acknowledgment response."""

    type: str = "runner_info_ack"
    timestamp: str


class CommandResponseAckResponse(BaseModel):
    """Command response acknowledgment."""

    type: str = "command_response_ack"
    timestamp: str


class TreeEventAckResponse(BaseModel):
    """Tree event acknowledgment response."""

    type: str = "tree_event_ack"
    timestamp: str


class IssueDetectedAckResponse(BaseModel):
    """Issue detected acknowledgment response."""

    type: str = "issue_detected_ack"
    synced: int
    updated: int
    timestamp: str


class IssuesSyncAckResponse(BaseModel):
    """Issues sync acknowledgment response."""

    type: str = "issues_sync_ack"
    synced: int
    updated: int
    errors: list[str]
    timestamp: str


class PingMessage(BaseModel):
    """Ping keepalive message."""

    type: str = "ping"
    timestamp: str


class StatusResponse(BaseModel):
    """Status response for monitor endpoint."""

    type: str = "status"
    session_id: str
    local_connections: int
    total_sessions: int
    timestamp: str


def make_timestamp() -> str:
    """Generate ISO format timestamp string with Z suffix."""
    return datetime.utcnow().isoformat() + "Z"
