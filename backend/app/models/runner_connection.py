"""
Runner connection model for tracking WebSocket connections.

This model logs each connection session from desktop runners,
providing an audit trail and connection history.
"""

from datetime import datetime
from uuid import UUID

from qontinui_schemas.common import to_utc, utc_now
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RunnerConnection(Base):
    """
    Runner connection model for tracking desktop runner WebSocket sessions.

    Each record represents a single WebSocket connection session,
    from connect to disconnect. Provides complete audit trail of
    runner activity.
    """

    __tablename__ = "runner_connections"

    # Primary key (auto-incrementing integer for simplicity)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Foreign key to user
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("runner.users.id", ondelete="CASCADE"), nullable=False, index=True
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

    user_agent: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="User agent string from the client"
    )

    # Custom runner name (user-defined in the runner app)
    runner_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Custom user-defined name for this runner (e.g., 'My Laptop')",
    )

    # HTTP API port the runner is listening on
    runner_port: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="HTTP API port the runner is listening on",
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
    user = relationship("User", back_populates="runner_connections")
    software_test_runs = relationship(
        "SoftwareTestRun", back_populates="runner_connection"
    )

    def calculate_duration(self) -> None:
        """Calculate and set the duration_seconds field.

        Uses to_utc() to ensure both datetimes are timezone-aware before
        subtraction, preventing "can't subtract offset-naive and offset-aware
        datetimes" errors.
        """
        if self.connected_at and self.disconnected_at:
            # Ensure both datetimes are timezone-aware UTC
            connected_utc = to_utc(self.connected_at)
            disconnected_utc = to_utc(self.disconnected_at)
            delta = disconnected_utc - connected_utc
            self.duration_seconds = int(delta.total_seconds())

    def __repr__(self) -> str:
        """Return string representation of the runner connection."""
        status = "active" if self.disconnected_at is None else "closed"
        return (
            f"<RunnerConnection(id={self.id}, user_id={self.user_id}, status={status})>"
        )
