"""
Automation Session Model

Tracks automation test sessions including runner metadata and session lifecycle.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, String, JSON, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_log import AutomationLog
    from app.models.automation_screenshot import AutomationScreenshot
    from app.models.automation import AutomationInputEvent
    from app.models.discovered_state import DiscoveredState
    from app.models.state_transition import StateTransition
    from app.models.user import User


class AutomationSession(Base):
    """
    Tracks an automation test session from start to completion.

    Stores runner environment details, session status, and configuration snapshots.
    """

    __tablename__ = "automation_sessions"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default="gen_random_uuid()"
    )

    # Optional project association (nullable for now)
    # Note: projects.id is Integer, not UUID
    project_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # User who initiated the session
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Runner environment information
    runner_version: Mapped[str] = mapped_column(String(100), nullable=False)
    runner_os: Mapped[str] = mapped_column(String(100), nullable=False)
    runner_hostname: Mapped[str] = mapped_column(String(255), nullable=False)

    # Session lifecycle
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="active", index=True
    )  # active, completed, failed

    # Configuration snapshot (JSONB for flexible storage)
    configuration_snapshot: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # State Discovery tracking fields
    state_discovery_status: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # pending, running, completed, failed
    state_discovery_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    state_discovery_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    state_discovery_error: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="automation_sessions"
    )
    logs: Mapped[list["AutomationLog"]] = relationship(
        "AutomationLog",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    screenshots: Mapped[list["AutomationScreenshot"]] = relationship(
        "AutomationScreenshot",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    input_events: Mapped[list["AutomationInputEvent"]] = relationship(
        "AutomationInputEvent",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    discovered_states: Mapped[list["DiscoveredState"]] = relationship(
        "DiscoveredState",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    state_transitions: Mapped[list["StateTransition"]] = relationship(
        "StateTransition",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<AutomationSession(id={self.id}, status='{self.status}', runner_version='{self.runner_version}')>"
