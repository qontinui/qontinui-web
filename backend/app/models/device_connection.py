"""Device connection model — audit log of device WebSocket connections.

Each row represents one open-to-close WebSocket connection between a
device (formerly "runner") and the backend. The session-history table
is for connection history and analytics; the authoritative liveness
signal lives on the unified ``coord.devices`` row.

This module replaces the legacy ``RunnerSession`` model — Phase 5 of the
Unified Devices Registry plan (``coord.machines`` + ``auth.runners`` →
``coord.devices``). The renamed table is ``coord.device_connections``;
the rename specifically avoids colliding with the user-fingerprinting
``DeviceSession`` model (``auth.device_sessions``) which is unrelated
and stays in place.
"""

from datetime import datetime
from uuid import UUID

from qontinui_schemas.common import to_utc, utc_now
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DeviceConnection(Base):
    """Audit-log row for one device WebSocket session.

    Created when the device's WS connects, closed when it disconnects.
    """

    __tablename__ = "device_connections"
    __table_args__ = {"schema": "coord"}

    # Primary key (auto-incrementing integer for simplicity)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # FK to the canonical coord.devices row this connection belongs to.
    device_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("coord.devices.device_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Owning device row (one device has many connections over its lifetime).",
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
    user = relationship("User", back_populates="device_connections")
    software_test_runs = relationship(
        "SoftwareTestRun", back_populates="device_connection"
    )

    def calculate_duration(self) -> None:
        """Calculate and set the duration_seconds field."""
        if self.connected_at and self.disconnected_at:
            connected_utc = to_utc(self.connected_at)
            disconnected_utc = to_utc(self.disconnected_at)
            delta = disconnected_utc - connected_utc
            self.duration_seconds = int(delta.total_seconds())

    def __repr__(self) -> str:
        """Return string representation of the device connection."""
        status = "active" if self.disconnected_at is None else "closed"
        return (
            f"<DeviceConnection(id={self.id}, device_id={self.device_id}, "
            f"status={status})>"
        )
