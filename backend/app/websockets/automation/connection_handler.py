"""Connection lifecycle management for the legacy automation WebSocket.

Handles the connection setup, authentication, runner registration, and
cleanup for the JWT-keyed automation runner WebSocket. This is the
*legacy* path; new code uses ``WS /api/v1/runners/ws`` (header-keyed,
runner-token auth). The legacy mount stays alive until Phase 5 cleanup
because the running runner depends on it.

Phase 2B note: this handler now upserts a parent ``Runner`` row keyed by
``(user_id, "Desktop Runner")`` and writes a ``RunnerSession`` audit row
per connection (instead of the deleted ``RunnerConnection`` table).
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import WebSocket, status
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.crud import runner_crud
from app.crud import runner_session as runner_session_crud
from app.db.session import AsyncSessionLocal
from app.models.runner import Runner
from app.models.runner_session import RunnerSession
from app.models.user import User
from app.services.runner_websocket_manager import (
    RunnerWebSocketManager,
    get_runner_websocket_manager,
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
        self.runner_record: Runner | None = None
        self.session_record: RunnerSession | None = None
        self.runner_manager: RunnerWebSocketManager | None = None
        self.redis_client: Any = None
        self.session_manager: SessionManager | None = None
        self.session_key = f"ws_runner_{id(websocket)}"

    @property
    def runner_id(self) -> UUID | None:
        """Return the parent Runner row id, if registered."""
        return self.runner_record.id if self.runner_record else None

    @property
    def client_ip(self) -> str:
        """Get client IP address."""
        return self.websocket.client.host if self.websocket.client else "unknown"

    async def check_rate_limit(self) -> bool:
        """Check connection rate limit.

        Returns:
            True if connection is allowed, False if rate limited.
        """
        # Use a higher limit for localhost connections (runners in development)
        is_localhost = self.client_ip in ("127.0.0.1", "::1", "localhost")
        limit = 120 if is_localhost else 30

        if not RateLimiter.check_connection_rate_limit(
            self.client_ip, limit=limit, window=60
        ):
            await self.websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason=f"Connection rate limit exceeded. Maximum {limit} connections per minute.",
            )
            logger.warning(
                "websocket_connection_rate_limited",
                client_ip=self.client_ip,
                limit=limit,
                window=60,
            )
            return False
        return True

    async def accept_connection(self) -> None:
        """Accept the WebSocket connection."""
        await self.websocket.accept()
        params = dict(self.websocket.query_params)
        if "token" in params:
            params["token"] = "***REDACTED***"
        logger.info(
            "automation_ws_runner_incoming_request",
            client_ip=self.client_ip,
            query_params=params,
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
            logger.warning(
                "automation_ws_streaming_not_enabled",
                user_id=str(self.user.id),
                user_email=self.user.email,
            )
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
        """Upsert a Runner row + RunnerSession, register with the manager.

        Returns:
            True if registration succeeded, False otherwise.
        """
        if not self.user or not self.db:
            return False

        try:
            client_host = self.websocket.client.host if self.websocket.client else None
            runner_name = "Desktop Runner"

            # Upsert the Runner row keyed by (user_id, name).
            self.runner_record = await runner_crud.register_runner(
                db=self.db,
                user_id=self.user.id,
                name=runner_name,
                hostname=client_host or "localhost",
                port=0,
                capabilities=[],
                server_mode=False,
                restate_enabled=False,
                restate_healthy=False,
                runner_token_id=None,
            )

            # Create a RunnerSession audit row.
            self.session_record = await runner_session_crud.create_session_record(
                db=self.db,
                runner_id=self.runner_record.id,
                user_id=self.user.id,
                ip_address=client_host,
            )

            # Set ws_session_id pointer on the Runner row.
            self.runner_record.ws_session_id = self.session_record.id
            self.runner_record.ws_connected_at = self.session_record.connected_at
            await self.db.commit()
            await self.db.refresh(self.runner_record)

            # Close any orphaned RunnerSession rows for this user (other than ours).
            closed_session_pks = await runner_session_crud.close_orphaned_sessions(
                db=self.db,
                user_id=self.user.id,
                exclude_session_id=self.session_record.id,
            )
            if closed_session_pks:
                logger.info(
                    "orphaned_sessions_closed",
                    count=len(closed_session_pks),
                    user_id=str(self.user.id),
                )

            logger.info(
                "automation_ws_runner_registered",
                runner_id=str(self.runner_record.id),
                session_pk=self.session_record.id,
                auth_method="jwt",
            )

            self.redis_client = await get_redis()
            self.runner_manager = await get_runner_websocket_manager(self.redis_client)
            await self.runner_manager.register(
                runner_id=self.runner_record.id,
                websocket=self.websocket,
                user_id=self.user.id,
                runner_name=runner_name,
                ip_address=client_host,
                connected_at=utc_now().isoformat(),
            )

            await self.runner_manager.publish_runner_connected(
                runner_id=self.runner_record.id,
                user_id=self.user.id,
                runner_name=runner_name,
                connected_at=utc_now().isoformat(),
                ip_address=client_host,
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
        """Update the parent Runner row's name on the legacy WS path."""
        if not self.runner_record or not self.db:
            return
        try:
            self.runner_record.name = runner_name
            await self.db.commit()
            logger.info(
                "runner_name_updated",
                runner_id=str(self.runner_record.id),
                runner_name=runner_name,
            )
        except Exception as e:
            logger.error(
                "runner_name_update_failed",
                runner_id=str(self.runner_record.id) if self.runner_record else None,
                error=str(e),
            )

    async def update_runner_port(self, runner_port: int) -> None:
        """Update the parent Runner row's port on the legacy WS path."""
        if not self.runner_record or not self.db:
            return
        try:
            self.runner_record.port = runner_port
            await self.db.commit()
            logger.info(
                "runner_port_updated",
                runner_id=str(self.runner_record.id),
                runner_port=runner_port,
            )
        except Exception as e:
            logger.error(
                "runner_port_update_failed",
                runner_id=str(self.runner_record.id) if self.runner_record else None,
                error=str(e),
            )

    async def cleanup(self) -> None:
        """Clean up resources on disconnect."""
        RateLimiter.cleanup_session(self.session_key)

        if self.runner_record:
            try:
                redis_client = await get_redis()
                runner_manager = await get_runner_websocket_manager(redis_client)
                await runner_manager.unregister(
                    self.runner_record.id,
                    self.user.id if self.user else None,
                )
            except Exception as e:
                logger.error(
                    "runner_unregister_failed",
                    runner_id=str(self.runner_record.id),
                    error=str(e),
                )

        # Close session row + clear ws_session_id pointer.
        if self.session_record:
            try:
                async with AsyncSessionLocal() as cleanup_db:
                    await runner_session_crud.close_session_record(
                        cleanup_db, self.session_record.id
                    )
                    if self.runner_record is not None:
                        from sqlalchemy import select as _select

                        runner_in_cleanup = await cleanup_db.execute(
                            _select(Runner).where(Runner.id == self.runner_record.id)
                        )
                        runner_row = runner_in_cleanup.scalar_one_or_none()
                        if runner_row is not None:
                            runner_row.ws_session_id = None
                            runner_row.ws_connected_at = None
                            await cleanup_db.commit()
            except Exception as e:
                logger.error(
                    "runner_session_close_failed",
                    error=str(e),
                    error_type=type(e).__name__,
                )

            try:
                if self.runner_manager and self.user:
                    await self.runner_manager.publish_runner_disconnected(
                        runner_id=self.runner_record.id if self.runner_record else "",
                        user_id=self.user.id,
                    )
            except Exception:
                pass

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
        if self.runner_record and self.runner_manager:
            await self.runner_manager.refresh_ttl(self.runner_record.id)

    async def send_to_frontends(self, message: dict[str, Any]) -> None:
        """Relay message to connected frontends."""
        if self.runner_record and self.runner_manager:
            await self.runner_manager.send_response_to_frontends(
                self.runner_record.id, message
            )

    async def send_chat_to_mobiles(self, message: dict[str, Any]) -> None:
        """Relay chat response to connected mobiles via Redis pub/sub."""
        if self.runner_record and self.runner_manager:
            await self.runner_manager.send_chat_response_to_mobiles(
                self.runner_record.id, message
            )

    async def send_terminal_to_mobiles(self, message: dict[str, Any]) -> None:
        """Relay terminal response to connected mobiles via Redis pub/sub."""
        if self.runner_record and self.runner_manager:
            await self.runner_manager.send_terminal_response_to_mobiles(
                self.runner_record.id, message
            )

    async def broadcast_status_event(self, event: dict[str, Any]) -> None:
        """Broadcast event to status channel for frontend monitoring."""
        import json as _json

        if self.runner_manager and self.redis_client and self.user:
            channel = f"runner:status:updates:{self.user.id}"
            try:
                await self.redis_client.publish(channel, _json.dumps(event))
            except Exception as e:
                logger.error("status_broadcast_failed", error=str(e))
