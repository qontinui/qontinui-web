"""WebSocket modules for real-time communication.

Provides shared infrastructure for WebSocket endpoints including:
- Base handler class with common patterns
- Rate limiting
- Message type definitions
"""

from app.websockets.base import BaseWebSocketHandler, WebSocketContext
from app.websockets.message_types import (BaseWSMessage, ConnectedMessage,
                                          ErrorMessage, HeartbeatAckMessage,
                                          HeartbeatMessage, PingMessage,
                                          PongMessage, create_ack_response,
                                          create_error_response,
                                          create_timestamp)
from app.websockets.rate_limiter import RateLimiter

__all__ = [
    # Base handler
    "BaseWebSocketHandler",
    "WebSocketContext",
    # Rate limiter
    "RateLimiter",
    # Message types
    "BaseWSMessage",
    "ConnectedMessage",
    "ErrorMessage",
    "HeartbeatAckMessage",
    "HeartbeatMessage",
    "PingMessage",
    "PongMessage",
    # Utility functions
    "create_ack_response",
    "create_error_response",
    "create_timestamp",
]
