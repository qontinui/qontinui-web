"""
Runner connection model for tracking WebSocket connections.

This model logs each connection session from desktop runners,
providing an audit trail and connection history.
"""

from datetime import datetime
from uuid import UUID

from app.db.base import Base
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship


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

    # Foreign keys
    runner_token_id: Mapped[UUID] = mapped_column(
        ForeignKey("runner_tokens.id", ondelete="CASCADE"), nullable=False, index=True
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Connection timestamps
    connected_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="When the WebSocket connection was established",
    )

    disconnected_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="When the WebSocket connection was closed"
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

    # Session metadata
    project_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Project ID if connection was associated with a specific project",
    )

    session_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="WebSocket session ID for correlation with logs",
    )

    # Relationships
    runner_token = relationship("RunnerToken", back_populates="connections")
    user = relationship("User", back_populates="runner_connections")
    software_test_runs = relationship(
        "SoftwareTestRun", back_populates="runner_connection"
    )

    def calculate_duration(self) -> None:
        """Calculate and set the duration_seconds field."""
        if self.connected_at and self.disconnected_at:
            delta = self.disconnected_at - self.connected_at
            self.duration_seconds = int(delta.total_seconds())

    def __repr__(self) -> str:
        status = "active" if self.disconnected_at is None else "closed"
        return f"<RunnerConnection(id={self.id}, token_id={self.runner_token_id}, status={status})>"
