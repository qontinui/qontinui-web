"""
Screenshot Input Association Model

Links screenshots to automation logs that represent user inputs or actions.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_log import AutomationLog
    from app.models.automation_screenshot import AutomationScreenshot


class ScreenshotInputAssociation(Base):
    """
    Associates screenshots with automation logs representing user inputs.

    Links screenshots captured during automation to the log entries that
    represent user actions (clicks, types, etc.) for context and analysis.
    """

    __tablename__ = "screenshot_input_associations"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Foreign keys
    screenshot_id: Mapped[UUID] = mapped_column(
        ForeignKey("project.automation_screenshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    log_id: Mapped[UUID] = mapped_column(
        ForeignKey("project.automation_logs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Input metadata
    input_type: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )  # click, type, scroll, etc.

    # Input-specific data (JSONB for flexible storage)
    input_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    # Timing information (milliseconds difference between screenshot and log)
    timestamp_diff_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    # Created timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    screenshot: Mapped["AutomationScreenshot"] = relationship(
        "AutomationScreenshot", back_populates="input_associations"
    )
    log: Mapped["AutomationLog"] = relationship(
        "AutomationLog", back_populates="screenshot_associations"
    )

    # Indexes for common queries
    __table_args__ = (
        Index("ix_screenshot_input_assoc_screenshot", "screenshot_id"),
        Index("ix_screenshot_input_assoc_log", "log_id"),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        return f"<ScreenshotInputAssociation(id={self.id}, screenshot_id={self.screenshot_id}, log_id={self.log_id}, input_type='{self.input_type}')>"
