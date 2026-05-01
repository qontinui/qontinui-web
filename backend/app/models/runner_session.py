"""
Runner session model — audit log of WebSocket sessions.

Each row represents one open-to-close WebSocket connection between a
runner and the backend. The authoritative "is this runner online right
now" signal lives on :class:`~app.models.runner.Runner.ws_session_id`,
which points at the currently-open session row (or ``NULL`` when no
session is open). The session-history table is for connection history
and analytics — never query it for liveness.
"""

from datetime import datetime
from uuid import UUID

from qontinui_schemas.common import to_utc, utc_now
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RunnerSession(Base):
    """
    Audit-log row for one runner WebSocket session.

    Created when the runner's WS connects, closed when it disconnects.
    The owning :class:`~app.models.runner.Runner` row's
    ``ws_session_id`` points at the currently-open session for that
    runner.
    """

    __tablename__ = "runner_sessions"
    __table_args__ = {'schema': "auth"}

    # Primary key (auto-incrementing integer for simplicity)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # FK to the canonical runners row this session belongs to.
    runner_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.runners.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Owning runner row (one runner has many sessions over its lifetime).",
    )

    # Foreign key to user
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Connection timestamps (always timezone-aware UTC)
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True,
        comment="When the WebSocket connection was established",
    )

    disconnected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the WebSocket connection was closed",
    )

    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Connection duration in seconds (calculated on disconnect)",
    )

    # Connection metadata
    ip_address: Mapped[str | None] = mapped_column(
        String(45),  # IPv6 max length
        nullable=True,
        comment="IP address of the connection",
    )

    # Session metadata
    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        comment="Project ID if connection was associated with a specific project",
    )

    session_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="WebSocket session ID for correlation with logs",
    )

    # Relationships
    runner = relationship("Runner", back_populates="sessions")
    user = relationship("User", back_populates="runner_sessions")
    software_test_runs = relationship(
        "SoftwareTestRun", back_populates="runner_session"
    )

    def calculate_duration(self) -> None:
        """Calculate and set the duration_seconds field.

        Uses to_utc() to ensure both datetimes are timezone-aware before
        subtraction, preventing "can't subtract offset-naive and offset-aware
        datetimes" errors.
        """
        if self.connected_at and self.disconnected_at:
            connected_utc = to_utc(self.connected_at)
            disconnected_utc = to_utc(self.disconnected_at)
            delta = disconnected_utc - connected_utc
            self.duration_seconds = int(delta.total_seconds())

    def __repr__(self) -> str:
        """Return string representation of the runner session."""
        status = "active" if self.disconnected_at is None else "closed"
        return (
            f"<RunnerSession(id={self.id}, runner_id={self.runner_id}, "
            f"status={status})>"
        )
