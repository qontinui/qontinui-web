"""
Automation Log Model

Stores log entries from automation sessions with structured event data.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_session import AutomationSession
    from app.models.screenshot_input_association import ScreenshotInputAssociation


class AutomationLog(Base):
    """
    Log entries from automation sessions.

    Stores sequential log messages with structured data and metadata.
    Includes support for various log levels and event types.
    """

    __tablename__ = "automation_logs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Foreign key to automation session
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("automation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Sequence tracking for ordering logs
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Log metadata
    level: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Structured log data (JSONB)
    log_data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # Timestamps
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    session: Mapped["AutomationSession"] = relationship(
        "AutomationSession", back_populates="logs"
    )
    screenshot_associations: Mapped[list["ScreenshotInputAssociation"]] = relationship(
        "ScreenshotInputAssociation",
        back_populates="log",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Composite indexes for common queries
    __table_args__ = (
        Index("ix_automation_logs_session_sequence", "session_id", "sequence_number"),
        Index(
            "ix_automation_logs_event_type",
            "log_data",
            postgresql_using="gin",
            postgresql_ops={"log_data": "jsonb_path_ops"},
        ),
    )

    def __repr__(self) -> str:
        return f"<AutomationLog(id={self.id}, session_id={self.session_id}, level='{self.level}', sequence={self.sequence_number})>"
