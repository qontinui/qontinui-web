"""Base WebSocket handler providing shared functionality.

Provides a foundation for WebSocket endpoints with common patterns:
- Rate limiting
- Authentication
- Connection lifecycle management
- Error handling
- Heartbeat/ping-pong
"""

import asyncio
import time
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any, TypeVar
from uuid import UUID

import structlog
from fastapi import WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_from_ws
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.websockets.rate_limiter import RateLimiter

logger = structlog.get_logger(__name__)

T = TypeVar("T", bound=BaseModel)


class WebSocketContext:
    """Context object holding WebSocket connection state."""

    def __init__(
        self,
        websocket: WebSocket,
        user: User,
        db: AsyncSession,
        session_key: str,
    ) -> None:
        """Initialize WebSocket context.

        Args:
            websocket: The WebSocket connection.
            user: Authenticated user.
            db: Database session.
            session_key: Unique session identifier for rate limiting.
        """
        self.websocket = websocket
        self.user = user
        self.db = db
        self.session_key = session_key
        self.last_activity = time.time()
        self.connected_at = datetime.now(UTC)

    @property
    def user_id(self) -> UUID:
        """Get the user ID."""
        return UUID(str(self.user.id))

    def update_activity(self) -> None:
        """Update the last activity timestamp."""
        self.last_activity = time.time()

    def time_since_activity(self) -> float:
        """Get time since last activity in seconds."""
        return time.time() - self.last_activity


class BaseWebSocketHandler(ABC):
    """Abstract base class for WebSocket handlers.

    Provides shared functionality for:
    - Connection rate limiting
    - Message rate limiting
    - Authentication
    - Database session management
    - Error handling
    - Heartbeat monitoring
    """

    # Configuration
    connection_rate_limit: int = 5
    connection_rate_window: int = 60
    message_rate_limit: int = 100
    message_rate_window: int = 60
    heartbeat_interval: float = 30.0
    stale_connection_timeout: float = 90.0

    def __init__(self) -> None:
        """Initialize the handler."""
        self.logger = structlog.get_logger(self.__class__.__name__)

    @property
    @abstractmethod
    def endpoint_name(self) -> str:
        """Name of this endpoint for logging."""
        ...

    async def handle_connection(
        self,
        websocket: WebSocket,
        token: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Main entry point for handling a WebSocket connection.

        Args:
            websocket: The WebSocket connection.
            token: Authentication token.
            **kwargs: Additional arguments passed to setup methods.
        """
        # Check connection rate limit
        client_ip = websocket.client.host if websocket.client else "unknown"
        if not RateLimiter.check_connection_rate_limit(
            client_ip,
            limit=self.connection_rate_limit,
            window=self.connection_rate_window,
        ):
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason=f"Connection rate limit exceeded. Maximum {self.connection_rate_limit} connections per minute.",
            )
            self.logger.warning(
                f"{self.endpoint_name}_connection_rate_limited",
                client_ip=client_ip,
            )
            return

        await websocket.accept()
        self.logger.info(
            f"{self.endpoint_name}_connection_attempt", client_ip=client_ip
        )

        context: WebSocketContext | None = None
        db: AsyncSession | None = None

        try:
            # Authenticate
            auth_token = token or websocket.cookies.get("access_token")
            if not auth_token:
                self.logger.error(f"{self.endpoint_name}_no_token")
                await self._send_error(
                    websocket,
                    "Authentication required. Provide token query param or access_token cookie.",
                )
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            try:
                user = await get_current_user_from_ws(auth_token)
            except Exception as e:
                self.logger.error(f"{self.endpoint_name}_auth_failed", error=str(e))
                await self._send_error(websocket, "Authentication failed")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Get database session - use AsyncSessionLocal directly to avoid generator lifecycle issues
            # The generator pattern (get_async_db) doesn't work well outside FastAPI's dependency injection
            # because breaking out of the generator loop leaves it in an invalid state
            try:
                db = AsyncSessionLocal()
            except Exception as e:
                self.logger.error(
                    f"{self.endpoint_name}_db_session_create_failed", error=str(e)
                )
                db = None

            if not db:
                self.logger.error(f"{self.endpoint_name}_db_failed")
                await self._send_error(websocket, "Database connection failed")
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                return

            # Re-fetch user in this session
            from sqlalchemy import select

            user_result = await db.execute(
                select(User).where(User.id == user.id)  # type: ignore[arg-type]
            )
            refetched_user = user_result.scalar_one_or_none()

            if not refetched_user:
                self.logger.error(f"{self.endpoint_name}_user_not_found")
                await self._send_error(websocket, "User not found")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            # Create context
            session_key = f"ws_{self.endpoint_name}_{id(websocket)}"
            context = WebSocketContext(
                websocket=websocket,
                user=refetched_user,
                db=db,
                session_key=session_key,
            )

            # Run setup (subclass hook)
            setup_result = await self.on_connect(context, **kwargs)
            if setup_result is False:
                return

            self.logger.info(
                f"{self.endpoint_name}_connected",
                user_id=str(user.id),
            )

            # Main message loop
            await self._message_loop(context)

        except Exception as e:
            self.logger.error(
                f"{self.endpoint_name}_fatal_error",
                error=str(e),
                error_type=type(e).__name__,
            )

        finally:
            # Cleanup
            if context:
                RateLimiter.cleanup_session(context.session_key)
                await self.on_disconnect(context)

            if db:
                try:
                    # Close the session without explicit rollback.
                    # Calling rollback() or in_transaction() while an operation is in progress
                    # can cause IllegalStateChangeError. The connection pool will handle
                    # rolling back uncommitted changes when the connection is returned.
                    await db.close()
                except Exception as e:
                    # If close fails (e.g., operation was in progress), log and continue.
                    # The session will be garbage collected and connection returned to pool.
                    self.logger.debug(
                        f"{self.endpoint_name}_db_close_error",
                        error=str(e),
                        error_type=type(e).__name__,
                    )

            try:
                await websocket.close()
            except Exception:
                pass

            self.logger.info(
                f"{self.endpoint_name}_cleanup_complete",
                user_id=str(context.user_id) if context else None,
            )

    async def _message_loop(self, context: WebSocketContext) -> None:
        """Process messages in a loop until disconnect.

        Args:
            context: WebSocket context.
        """
        while True:
            try:
                # Receive message with timeout
                data = await asyncio.wait_for(
                    context.websocket.receive_json(),
                    timeout=self.heartbeat_interval,
                )

                # Check message rate limit
                if not RateLimiter.check_message_rate_limit(
                    context.session_key,
                    limit=self.message_rate_limit,
                    window=self.message_rate_window,
                ):
                    await self._send_error(
                        context.websocket,
                        f"Message rate limit exceeded. Maximum {self.message_rate_limit} messages per minute.",
                    )
                    self.logger.warning(
                        f"{self.endpoint_name}_message_rate_limited",
                        user_id=str(context.user_id),
                        session_key=context.session_key,
                    )
                    continue

                # Update activity
                context.update_activity()

                # Process message
                await self.on_message(context, data)

            except TimeoutError:
                # Check for stale connection
                if context.time_since_activity() > self.stale_connection_timeout:
                    self.logger.warning(
                        f"{self.endpoint_name}_stale_connection",
                        user_id=str(context.user_id),
                        time_since_activity=context.time_since_activity(),
                    )
                    await self._send_error(
                        context.websocket,
                        f"Connection stale - no activity for {int(self.stale_connection_timeout)}s",
                    )
                    break

                # Send ping to keep connection alive
                try:
                    await context.websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": datetime.now(UTC).isoformat() + "Z",
                        }
                    )
                    self.logger.debug(
                        f"{self.endpoint_name}_ping_sent",
                        user_id=str(context.user_id),
                    )
                except Exception as e:
                    self.logger.error(
                        f"{self.endpoint_name}_ping_failed",
                        user_id=str(context.user_id),
                        error=str(e),
                    )
                    break

            except WebSocketDisconnect:
                self.logger.info(
                    f"{self.endpoint_name}_client_disconnected",
                    user_id=str(context.user_id),
                )
                break

            except Exception as e:
                self.logger.error(
                    f"{self.endpoint_name}_message_error",
                    user_id=str(context.user_id),
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await self._send_error(
                        context.websocket,
                        f"Message processing error: {str(e)}",
                    )
                except Exception:
                    break

    @abstractmethod
    async def on_connect(
        self,
        context: WebSocketContext,
        **kwargs: Any,
    ) -> bool | None:
        """Called when a connection is established.

        Args:
            context: WebSocket context.
            **kwargs: Additional arguments from the endpoint.

        Returns:
            False to close the connection, None/True to continue.
        """
        ...

    @abstractmethod
    async def on_message(
        self,
        context: WebSocketContext,
        data: dict[str, Any],
    ) -> None:
        """Called when a message is received.

        Args:
            context: WebSocket context.
            data: Parsed JSON message data.
        """
        ...

    async def on_disconnect(self, context: WebSocketContext) -> None:  # noqa: B027
        """Called when the connection is closing.

        Override in subclass for cleanup logic.
        This is intentionally not abstract to allow subclasses to skip cleanup.

        Args:
            context: WebSocket context.
        """

    async def _send_error(
        self,
        websocket: WebSocket,
        message: str,
    ) -> None:
        """Send an error message.

        Args:
            websocket: The WebSocket connection.
            message: Error message.
        """
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": message,
                    "timestamp": datetime.now(UTC).isoformat() + "Z",
                }
            )
        except Exception:
            pass

    def validate_message(
        self,
        data: dict[str, Any],
        schema: type[T],
    ) -> T | None:
        """Validate a message against a Pydantic schema.

        Args:
            data: Message data to validate.
            schema: Pydantic model class.

        Returns:
            Validated model or None if validation failed.
        """
        try:
            return schema(**data)
        except ValidationError as e:
            self.logger.warning(
                "message_validation_failed",
                error=str(e),
                schema=schema.__name__,
            )
            return None
