"""Automation Session Model.

Tracks automation test sessions including runner metadata and session lifecycle.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation import AutomationInputEvent
    from app.models.automation_log import AutomationLog
    from app.models.automation_screenshot import AutomationScreenshot
    from app.models.discovered_state import DiscoveredState
    from app.models.user import User
    from app.models.workflow_execution_history import WorkflowExecutionHistory


class AutomationSession(Base):
    """
    Tracks an automation test session from start to completion.

    Stores runner environment details, session status, and configuration snapshots.
    """

    __tablename__ = "automation_sessions"
    __table_args__ = {'schema': "project"}

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Optional project association (nullable for now)
    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # User who initiated the session
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Runner environment information
    runner_version: Mapped[str] = mapped_column(String(100), nullable=False)
    runner_os: Mapped[str] = mapped_column(String(100), nullable=False)
    runner_hostname: Mapped[str] = mapped_column(String(255), nullable=False)

    # Session lifecycle
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="active", index=True
    )  # active, completed, failed, expired, aborted

    # Configuration snapshot (JSONB for flexible storage)
    configuration_snapshot: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False
    )

    # Duration limits (8 hours default = 28800 seconds)
    max_duration_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=28800
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="automation_sessions")
    logs: Mapped[list["AutomationLog"]] = relationship(
        "AutomationLog",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="select",  # Changed from selectin for pagination support
    )
    screenshots: Mapped[list["AutomationScreenshot"]] = relationship(
        "AutomationScreenshot",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="select",  # Changed from selectin for pagination support
    )
    input_events: Mapped[list["AutomationInputEvent"]] = relationship(
        "AutomationInputEvent",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    execution_history: Mapped["WorkflowExecutionHistory | None"] = relationship(
        "WorkflowExecutionHistory",
        back_populates="session",
        uselist=False,
        cascade="all, delete-orphan",
    )
    discovered_states: Mapped[list["DiscoveredState"]] = relationship(
        "DiscoveredState",
        back_populates="automation_session",
        foreign_keys="DiscoveredState.automation_session_id",
        cascade="all, delete-orphan",
    )

    def is_expired(self) -> bool:
        """
        Check if session has exceeded its maximum duration.

        Returns:
            True if session duration exceeds max_duration_seconds, False otherwise
        """
        if self.status in ("completed", "failed", "expired", "aborted"):
            # Session already ended
            return False

        duration = (datetime.now(UTC) - self.created_at).total_seconds()
        return duration > self.max_duration_seconds

    def __repr__(self) -> str:
        """Return string representation of the session."""
        return f"<AutomationSession(id={self.id}, status='{self.status}', runner_version='{self.runner_version}')>"
