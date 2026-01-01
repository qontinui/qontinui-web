"""Rate limiting for WebSocket connections and messages.

Provides in-memory rate limiting for WebSocket connections with configurable
limits per IP address and per session. For production with horizontal scaling,
consider using Redis-based rate limiting.
"""

import time
from collections import defaultdict
from typing import ClassVar

import structlog

logger = structlog.get_logger(__name__)


class RateLimiter:
    """Rate limiter for WebSocket connections and messages.

    Thread-safe rate limiting using sliding window algorithm.
    Tracks connection attempts per IP and message counts per session.
    """

    # Class-level state for global rate limiting
    _connection_attempts: ClassVar[dict[str, list[float]]] = defaultdict(list)
    _message_counts: ClassVar[dict[str, list[float]]] = defaultdict(list)

    @classmethod
    def check_connection_rate_limit(
        cls,
        ip_address: str,
        limit: int = 5,
        window: int = 60,
    ) -> bool:
        """Check if an IP address has exceeded the connection rate limit.

        Args:
            ip_address: Client IP address.
            limit: Maximum connections allowed within the window.
            window: Time window in seconds.

        Returns:
            True if within limit, False if limit exceeded.
        """
        current_time = time.time()
        cutoff_time = current_time - window

        # Clean old attempts
        cls._connection_attempts[ip_address] = [
            t for t in cls._connection_attempts[ip_address] if t > cutoff_time
        ]

        # Check if limit exceeded
        if len(cls._connection_attempts[ip_address]) >= limit:
            logger.warning(
                "connection_rate_limit_exceeded",
                ip_address=ip_address,
                limit=limit,
                window=window,
                current_count=len(cls._connection_attempts[ip_address]),
            )
            return False

        # Record this attempt
        cls._connection_attempts[ip_address].append(current_time)
        return True

    @classmethod
    def check_message_rate_limit(
        cls,
        session_key: str,
        limit: int = 60,
        window: int = 60,
    ) -> bool:
        """Check if a session has exceeded the message rate limit.

        Args:
            session_key: Unique session identifier (e.g., websocket connection ID).
            limit: Maximum messages allowed within the window.
            window: Time window in seconds.

        Returns:
            True if within limit, False if limit exceeded.
        """
        current_time = time.time()
        cutoff_time = current_time - window

        # Clean old messages
        cls._message_counts[session_key] = [
            t for t in cls._message_counts[session_key] if t > cutoff_time
        ]

        # Check if limit exceeded
        if len(cls._message_counts[session_key]) >= limit:
            logger.warning(
                "message_rate_limit_exceeded",
                session_key=session_key,
                limit=limit,
                window=window,
                current_count=len(cls._message_counts[session_key]),
            )
            return False

        # Record this message
        cls._message_counts[session_key].append(current_time)
        return True

    @classmethod
    def cleanup_session(cls, session_key: str) -> None:
        """Clean up rate limiting state for a session.

        Args:
            session_key: Session identifier to clean up.
        """
        if session_key in cls._message_counts:
            del cls._message_counts[session_key]

    @classmethod
    def get_remaining_connections(
        cls,
        ip_address: str,
        limit: int = 5,
        window: int = 60,
    ) -> int:
        """Get remaining connection attempts for an IP address.

        Args:
            ip_address: Client IP address.
            limit: Maximum connections allowed within the window.
            window: Time window in seconds.

        Returns:
            Number of remaining connection attempts.
        """
        current_time = time.time()
        cutoff_time = current_time - window

        # Clean old attempts
        cls._connection_attempts[ip_address] = [
            t for t in cls._connection_attempts[ip_address] if t > cutoff_time
        ]

        return max(0, limit - len(cls._connection_attempts[ip_address]))

    @classmethod
    def get_remaining_messages(
        cls,
        session_key: str,
        limit: int = 60,
        window: int = 60,
    ) -> int:
        """Get remaining message quota for a session.

        Args:
            session_key: Unique session identifier.
            limit: Maximum messages allowed within the window.
            window: Time window in seconds.

        Returns:
            Number of remaining messages allowed.
        """
        current_time = time.time()
        cutoff_time = current_time - window

        # Clean old messages
        cls._message_counts[session_key] = [
            t for t in cls._message_counts[session_key] if t > cutoff_time
        ]

        return max(0, limit - len(cls._message_counts[session_key]))
