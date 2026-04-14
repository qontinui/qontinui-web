"""Analytics event model for tracking user behavior and system events."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.db.base import Base
from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class AnalyticsEvent(Base):
    """
    Analytics event model for comprehensive event tracking.

    This model stores all analytics events including:
    - User login events (with remember_me tracking)
    - Session events (token refresh, expiry, etc.)
    - Device validation events (fingerprint mismatches)
    - Feature usage events
    - System events

    The properties field (JSONB) allows flexible storage of event-specific data.
    """

    __tablename__ = "analytics_events"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )

    # Event identification
    event_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # User association (nullable for system-wide events)
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Event properties (flexible JSON storage)
    properties: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Timestamp
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        index=True,
    )

    # Additional metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    # Relationships
    user = relationship("User", back_populates="analytics_events")

    # Composite indexes for efficient queries
    __table_args__ = (
        # Index for querying events by name and time range
        Index("ix_analytics_events_name_timestamp", "event_name", "timestamp"),
        # Index for querying user events by name
        Index("ix_analytics_events_user_name", "user_id", "event_name"),
        # Index for time-based queries
        Index("ix_analytics_events_timestamp_desc", timestamp.desc()),
    )

    def __repr__(self) -> str:
        return f"<AnalyticsEvent(id={self.id}, event_name={self.event_name}, user_id={self.user_id}, timestamp={self.timestamp})>"
