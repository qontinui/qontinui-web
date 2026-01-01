"""Session state management for automation WebSocket connections.

Manages the lifecycle of automation sessions, including session creation,
user limit tracking, and session cleanup.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from dateutil.relativedelta import relativedelta  # type: ignore
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.websockets.automation.schemas import make_timestamp

logger = structlog.get_logger(__name__)


@dataclass
class SessionState:
    """Tracks the state of an automation session.

    Attributes:
        session_id: Current automation session UUID.
        started: Whether a session has been started.
        workflow_name: Name of the current workflow.
        started_at: When the session was started.
        request_id: Correlation ID for request-response tracking.
    """

    session_id: UUID | None = None
    started: bool = False
    workflow_name: str = "Unknown"
    started_at: datetime | None = None
    request_id: str | None = None


@dataclass
class ConnectionState:
    """Tracks the state of a WebSocket connection.

    Attributes:
        user: Authenticated user.
        db: Database session.
        connection_id: Runner connection record ID.
        session_key: Rate limiting session key.
        session: Current automation session state.
    """

    user: User | None = None
    db: AsyncSession | None = None
    connection_id: UUID | None = None
    session_key: str = ""
    session: SessionState = field(default_factory=SessionState)


class SessionManager:
    """Manages automation session lifecycle and user limits.

    Handles session creation, limit checking, and state tracking.
    """

    def __init__(self, db: AsyncSession, user: User):
        """Initialize session manager.

        Args:
            db: Database session for persistence.
            user: Authenticated user for the connection.
        """
        self.db = db
        self.user = user
        self.state = SessionState()

    @property
    def is_started(self) -> bool:
        """Check if a session is currently active."""
        return self.state.started

    @property
    def session_id(self) -> UUID | None:
        """Get current session ID."""
        return self.state.session_id

    async def check_and_reset_monthly_limit(self) -> None:
        """Check if monthly limit needs reset and apply if necessary."""
        if self.user.automation_sessions_reset_at is None:
            return

        if datetime.now(UTC) > self.user.automation_sessions_reset_at:
            # Reset for new month
            self.user.automation_sessions_used = 0
            self.user.automation_sessions_reset_at = datetime.now(UTC) + relativedelta(
                months=1
            )
            await self.db.commit()
            await self.db.refresh(self.user)
            logger.info(
                "monthly_session_limit_reset",
                user_id=str(self.user.id),
                next_reset=str(self.user.automation_sessions_reset_at),
            )

    def check_session_limit(self) -> tuple[bool, str | None]:
        """Check if user has reached their session limit.

        Returns:
            Tuple of (is_within_limit, error_message if exceeded).
        """
        if self.user.automation_sessions_limit is None:
            return True, None

        if self.user.automation_sessions_used >= self.user.automation_sessions_limit:
            return False, (
                f"Monthly automation streaming limit reached "
                f"({self.user.automation_sessions_limit} sessions). "
                f"Limit resets on the 1st of each month."
            )

        return True, None

    def get_sessions_remaining(self) -> int | None:
        """Get number of sessions remaining in user's quota."""
        if self.user.automation_sessions_limit is None:
            return None
        return max(
            0, self.user.automation_sessions_limit - self.user.automation_sessions_used
        )

    async def start_session(
        self,
        session_id: UUID | None,
        workflow_name: str,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        """Start a new automation session.

        Args:
            session_id: Optional session UUID from client.
            workflow_name: Name of the workflow being executed.
            request_id: Optional correlation ID for request-response tracking.

        Returns:
            Response message dict.
        """
        if self.state.started:
            return {
                "type": "error",
                "message": "Session already started. End current session first.",
            }

        # Increment sessions used if limit applies
        if self.user.automation_sessions_limit is not None:
            self.user.automation_sessions_used += 1
            await self.db.commit()
            await self.db.refresh(self.user)

        self.state.started = True
        self.state.session_id = session_id
        self.state.workflow_name = workflow_name
        self.state.started_at = datetime.utcnow()
        self.state.request_id = request_id

        logger.info(
            "automation_session_started",
            user_id=str(self.user.id),
            session_id=str(session_id) if session_id else None,
            workflow_name=workflow_name,
            sessions_used=self.user.automation_sessions_used,
        )

        response = {
            "type": "session_started",
            "success": True,
            "workflow_name": workflow_name,
            "sessions_used": self.user.automation_sessions_used,
            "sessions_remaining": self.get_sessions_remaining(),
            "timestamp": make_timestamp(),
            "data": {"session_id": str(session_id) if session_id else None},
        }

        if request_id:
            response["request_id"] = request_id

        return response

    def end_session(self, status: str = "completed") -> dict[str, Any]:
        """End the current automation session.

        Args:
            status: Session end status (completed, failed, etc.).

        Returns:
            Response message dict.
        """
        if not self.state.started:
            return {
                "type": "error",
                "message": "No active session to end.",
            }

        logger.info(
            "automation_session_ended",
            user_id=str(self.user.id),
            session_id=str(self.state.session_id) if self.state.session_id else None,
            status=status,
        )

        # Reset session state
        self.state = SessionState()

        return {
            "type": "session_ended",
            "status": status,
            "timestamp": make_timestamp(),
        }

    def require_session(self) -> dict[str, Any] | None:
        """Check if a session is active, return error if not.

        Returns:
            Error response dict if no session, None if session is active.
        """
        if not self.state.started:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }
        return None
