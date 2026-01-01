"""Common WebSocket message type definitions.

Provides base message schemas and utility functions shared across
WebSocket endpoints.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class BaseWSMessage(BaseModel):
    """Base WebSocket message schema.

    All WebSocket messages should contain a type field identifying
    the message type, and an optional data payload.
    """

    type: str = Field(..., description="Message type identifier")
    data: dict[str, Any] = Field(default_factory=dict, description="Message payload")


class HeartbeatMessage(BaseModel):
    """Heartbeat message for connection keep-alive."""

    type: str = Field(default="heartbeat", description="Message type")


class PingMessage(BaseModel):
    """Ping message sent by server."""

    type: str = Field(default="ping", description="Message type")
    timestamp: str = Field(..., description="ISO timestamp")


class PongMessage(BaseModel):
    """Pong response message."""

    type: str = Field(default="pong", description="Message type")
    timestamp: str = Field(..., description="ISO timestamp")


class HeartbeatAckMessage(BaseModel):
    """Heartbeat acknowledgment message."""

    type: str = Field(default="heartbeat_ack", description="Message type")
    timestamp: str = Field(..., description="ISO timestamp")


class ErrorMessage(BaseModel):
    """Error response message."""

    type: str = Field(default="error", description="Message type")
    message: str = Field(..., description="Error message")
    timestamp: str = Field(..., description="ISO timestamp")


class ConnectedMessage(BaseModel):
    """Connection acknowledgment message."""

    type: str = Field(default="connected", description="Message type")
    user_id: str = Field(..., description="Connected user ID")
    auth_method: str = Field(default="jwt", description="Authentication method used")
    timestamp: str = Field(..., description="ISO timestamp")


def create_timestamp() -> str:
    """Create an ISO timestamp string.

    Returns:
        ISO formatted timestamp with Z suffix.
    """
    return datetime.utcnow().isoformat() + "Z"


def create_error_response(message: str) -> dict[str, Any]:
    """Create an error response dictionary.

    Args:
        message: Error message.

    Returns:
        Error response dictionary.
    """
    return {
        "type": "error",
        "message": message,
        "timestamp": create_timestamp(),
    }


def create_ack_response(ack_type: str, **kwargs: Any) -> dict[str, Any]:
    """Create an acknowledgment response dictionary.

    Args:
        ack_type: Type of acknowledgment.
        **kwargs: Additional fields to include.

    Returns:
        Acknowledgment response dictionary.
    """
    return {
        "type": ack_type,
        "timestamp": create_timestamp(),
        **kwargs,
    }
