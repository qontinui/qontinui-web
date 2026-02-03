"""Connection lifecycle management for automation WebSocket.

Handles the connection setup, authentication, runner registration,
and cleanup for automation runner WebSocket connections.
"""

import json
from typing import Any

import structlog
from fastapi import WebSocket, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.crud import runner as runner_crud
from app.db.session import AsyncSessionLocal
from app.models.runner_connection import RunnerConnection
from app.models.user import User
from app.services.runner_connection_manager import (
    RunnerConnectionManager,
    get_runner_connection_manager,
)
from app.websockets.automation.schemas import make_timestamp
from app.websockets.automation.session_manager import SessionManager
from app.websockets.rate_limiter import RateLimiter

logger = structlog.get_logger(__name__)


class ConnectionHandler:
    """Manages WebSocket connection lifecycle for automation runners.

    Handles:
    - Rate limiting on connection
    - Authentication (JWT or cookie-based)
    - User validation and streaming permission checks
    - Runner registration with connection manager
    - Cleanup on disconnect
    """

    def __init__(self, websocket: WebSocket, token: str | None = None):
        """Initialize connection handler.

        Args:
            websocket: The WebSocket connection.
            token: Optional JWT token from query parameter.
        """
        self.websocket = websocket
        self.token = token
        self.db: AsyncSession | None = None
        self.user: User | None = None
        self.connection_record: RunnerConnection | None = None
        self.runner_manager: RunnerConnectionManager | None = None
        self.redis_client: Any = None
        self.session_manager: SessionManager | None = None
        self.session_key = f"ws_runner_{id(websocket)}"

    @property
    def client_ip(self) -> str:
        """Get client IP address."""
        return self.websocket.client.host if self.websocket.client else "unknown"

    async def check_rate_limit(self) -> bool:
        """Check connection rate limit.

        Returns:
            True if connection is allowed, False if rate limited.
        """
        if not RateLimiter.check_connection_rate_limit(
            self.client_ip, limit=5, window=60
        ):
            await self.websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="Connection rate limit exceeded. Maximum 5 connections per minute.",
            )
            logger.warning(
                "websocket_connection_rate_limited",
                client_ip=self.client_ip,
                limit=5,
                window=60,
            )
            return False
        return True

    async def accept_connection(self) -> None:
        """Accept the WebSocket connection."""
        await self.websocket.accept()
        logger.info(
            "automation_ws_runner_incoming_request",
            client_ip=self.client_ip,
            query_params=dict(self.websocket.query_params),
            path=str(self.websocket.url.path),
        )

    async def authenticate(self) -> bool:
        """Authenticate the connection.

        Returns:
            True if authentication succeeded, False otherwise.
        """
        # Try to get token from query param, then from cookies
        auth_token = self.token
        if not auth_token:
            auth_token = self.websocket.cookies.get("access_token")

        if auth_token:
            logger.info("automation_ws_using_cookie_auth")

        if not auth_token:
            logger.error(
                "automation_ws_no_token",
                error="No token in query param or cookies",
            )
            await self._send_error(
                "Authentication required. Provide token query param or access_token cookie."
            )
            await self.websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False

        try:
            self.user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("automation_ws_auth_failed", error=str(e))
            await self._send_error("Authentication failed")
            await self.websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False

        return True

    async def setup_database(self) -> bool:
        """Set up database session and re-fetch user.

        Note: This creates a session that must be managed manually.
        The session is NOT wrapped in a context manager because it needs
        to persist for the lifetime of the WebSocket connection.

        Returns:
            True if setup succeeded, False otherwise.
        """
        try:
            # Create a new session directly - we manage its lifecycle manually
            self.db = AsyncSessionLocal()
        except Exception as e:
            logger.error("automation_ws_db_failed", error=str(e))
            await self._send_error("Database connection failed")
            await self.websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return False

        if not self.db:
            logger.error("automation_ws_db_failed")
            await self._send_error("Database connection failed")
            await self.websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return False

        try:
            # Re-fetch user in this session
            user_result = await self.db.execute(
                select(User).filter(User.id == self.user.id)  # type: ignore
            )
            self.user = user_result.scalar_one_or_none()
        except Exception as e:
            logger.error("automation_ws_user_fetch_failed", error=str(e))
            await self._send_error("Failed to fetch user")
            await self.websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return False

        if not self.user:
            logger.error("automation_ws_user_not_found")
            await self._send_error("User not found")
            await self.websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False

        return True

    async def check_streaming_permissions(self) -> bool:
        """Check if user has streaming permissions.

        Returns:
            True if streaming is allowed, False otherwise.
        """
        if not self.user:
            return False

        if not self.user.automation_streaming_enabled:
            await self.websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason=(
                    "Automation streaming is not enabled for your account. "
                    "Enable it in your account settings."
                ),
            )
            return False

        return True

    async def check_session_limits(self) -> bool:
        """Check if user has available session quota.

        Returns:
            True if within limits, False otherwise.
        """
        if not self.user or not self.db:
            return False

        # Initialize session manager
        self.session_manager = SessionManager(self.db, self.user)

        # Check and reset monthly limit if needed
        await self.session_manager.check_and_reset_monthly_limit()

        # Check session limit
        within_limit, error_message = self.session_manager.check_session_limit()
        if not within_limit:
            await self.websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason=error_message,
            )
            return False

        return True

    async def register_runner(self) -> bool:
        """Register runner connection with connection manager.

        Returns:
            True if registration succeeded, False otherwise.
        """
        if not self.user or not self.db:
            return False

        try:
            # Extract IP from WebSocket
            client_host = self.websocket.client.host if self.websocket.client else None

            # Create connection record
            self.connection_record = await runner_crud.create_connection_record(
                db=self.db,
                user_id=self.user.id,
                ip_address=client_host,
            )

            # Clean up orphaned connections
            closed_connection_ids = await runner_crud.close_orphaned_connections(
                db=self.db,
                user_id=self.user.id,
                exclude_connection_id=self.connection_record.id,
            )
            if closed_connection_ids:
                logger.info(
                    "orphaned_connections_closed",
                    count=len(closed_connection_ids),
                    connection_ids=closed_connection_ids,
                    user_id=str(self.user.id),
                )
                # Send disconnect notifications for orphaned connections
                self.redis_client = await get_redis()
                self.runner_manager = await get_runner_connection_manager(
                    self.redis_client
                )
                for closed_id in closed_connection_ids:
                    await self.runner_manager.unregister_runner(closed_id, self.user.id)

            logger.info(
                "runner_connection_logged",
                connection_id=self.connection_record.id,
                auth_method="jwt",
            )

            # Register runner with connection manager for frontend command relay
            self.redis_client = await get_redis()
            self.runner_manager = await get_runner_connection_manager(self.redis_client)
            await self.runner_manager.register_runner(
                connection_id=self.connection_record.id,
                websocket=self.websocket,
                user_id=self.user.id,
                runner_name=self.connection_record.runner_name,
                ip_address=client_host,
                connected_at=self.connection_record.connected_at,
                project_id=self.connection_record.project_id,
            )

            return True

        except Exception as e:
            logger.error(
                "runner_connection_log_failed",
                error=str(e),
                error_type=type(e).__name__,
            )
            return False

    async def send_connected_ack(self) -> None:
        """Send connection acknowledgment to client."""
        if not self.user:
            return

        await self.websocket.send_json(
            {
                "type": "connected",
                "user_id": str(self.user.id),
                "username": self.user.username,
                "auth_method": "jwt",
                "sessions_remaining": (
                    self.session_manager.get_sessions_remaining()
                    if self.session_manager
                    else None
                ),
                "timestamp": make_timestamp(),
            }
        )

        logger.info(
            "automation_ws_connected",
            user_id=str(self.user.id),
            username=self.user.username,
            auth_method="jwt",
            streaming_enabled=self.user.automation_streaming_enabled,
            sessions_limit=self.user.automation_sessions_limit,
            sessions_used=self.user.automation_sessions_used,
        )

    async def update_runner_name(self, runner_name: str) -> None:
        """Update runner name in connection record and Redis.

        Args:
            runner_name: Name of the runner.
        """
        if not self.connection_record or not self.db or not self.user:
            return

        try:
            await runner_crud.update_connection_runner_name(
                db=self.db,
                connection_id=self.connection_record.id,
                runner_name=runner_name,
            )

            # Update Redis metadata
            if self.runner_manager and self.redis_client:
                metadata = await self.runner_manager.get_connection_metadata(
                    self.connection_record.id
                )
                if metadata:
                    metadata["runner_name"] = runner_name
                    metadata_key = (
                        f"runner:connection:{self.connection_record.id}:metadata"
                    )
                    await self.redis_client.set(
                        metadata_key, json.dumps(metadata), ex=300
                    )

                # Publish runner_name_updated event to frontend
                await self.runner_manager.publish_runner_name_update(
                    connection_id=self.connection_record.id,
                    runner_name=runner_name,
                    user_id=self.user.id,
                )

            logger.info(
                "runner_name_updated",
                connection_id=self.connection_record.id,
                runner_name=runner_name,
            )

        except Exception as e:
            logger.error(
                "runner_name_update_failed",
                connection_id=self.connection_record.id,
                error=str(e),
            )

    async def cleanup(self) -> None:
        """Clean up resources on disconnect."""
        # Clean up rate limiting state
        RateLimiter.cleanup_session(self.session_key)

        # Unregister runner from connection manager
        if self.connection_record:
            try:
                redis_client = await get_redis()
                runner_manager = await get_runner_connection_manager(redis_client)
                await runner_manager.unregister_runner(
                    self.connection_record.id,
                    self.user.id if self.user else None,
                )
            except Exception as e:
                logger.error(
                    "runner_unregister_failed",
                    connection_id=(
                        self.connection_record.id if self.connection_record else None
                    ),
                    error=str(e),
                )

        # Close connection record - use a fresh session to avoid race conditions
        if self.connection_record:
            try:
                async with AsyncSessionLocal() as cleanup_db:
                    await runner_crud.close_connection_record(
                        db=cleanup_db,
                        connection_id=self.connection_record.id,
                    )
                    await cleanup_db.commit()
                logger.info(
                    "runner_connection_closed",
                    connection_id=self.connection_record.id,
                    duration_seconds=self.connection_record.duration_seconds,
                )
            except Exception as e:
                logger.error(
                    "runner_connection_close_failed",
                    error=str(e),
                    error_type=type(e).__name__,
                )

        # Close the main database session safely
        # Avoid rollback() as it can cause IllegalStateChangeError if there's an
        # operation in progress (e.g., query was running when client disconnected).
        # Just close the session - uncommitted changes will be rolled back by the
        # connection pool when the connection is returned.
        if self.db:
            try:
                await self.db.close()
            except Exception as e:
                # If close fails (e.g., operation in progress), log and continue.
                # The session will be garbage collected and connection returned to pool.
                logger.debug(
                    "db_close_exception",
                    error=str(e),
                    error_type=type(e).__name__,
                )

        # Close websocket
        try:
            await self.websocket.close()
        except Exception:
            pass

        logger.info(
            "automation_ws_cleanup_complete",
            user_id=str(self.user.id) if self.user else None,
            auth_method="jwt",
        )

    async def _send_error(self, message: str) -> None:
        """Send error message to client.

        Args:
            message: Error message to send.
        """
        await self.websocket.send_json(
            {
                "type": "error",
                "message": message,
            }
        )

    async def refresh_connection_ttl(self) -> None:
        """Refresh Redis TTL on heartbeat."""
        if self.connection_record and self.runner_manager:
            await self.runner_manager.refresh_connection_ttl(self.connection_record.id)

    async def send_to_frontends(self, message: dict[str, Any]) -> None:
        """Relay message to connected frontends.

        Args:
            message: Message to relay.
        """
        if self.connection_record and self.runner_manager:
            await self.runner_manager.send_response_to_frontends(
                self.connection_record.id,
                message,
            )

    async def broadcast_status_event(self, event: dict[str, Any]) -> None:
        """Broadcast event to status channel for frontend monitoring.

        Args:
            event: Event to broadcast.
        """
        if self.runner_manager and self.redis_client and self.user:
            channel = f"runner:status:updates:{self.user.id}"
            try:
                await self.redis_client.publish(channel, json.dumps(event))
            except Exception as e:
                logger.error("status_broadcast_failed", error=str(e))
