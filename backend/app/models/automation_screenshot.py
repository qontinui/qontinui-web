"""
Automation Screenshot Model

Stores screenshots captured during automation sessions with metadata.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_session import AutomationSession
    from app.models.screenshot_input_association import ScreenshotInputAssociation


class AutomationScreenshot(Base):
    """
    Screenshots captured during automation sessions.

    Stores screenshot metadata, storage paths, dimensions, and timing information.
    Supports association with automation logs for context.
    """

    __tablename__ = "automation_screenshots"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default="gen_random_uuid()"
    )

    # Foreign key to automation session
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("automation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Screenshot identification
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # Image dimensions
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Content type
    content_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="image/png"
    )

    # Automation-specific metadata (JSONB)
    automation_metadata: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False
    )

    # Timestamps
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    # Presigned URL for temporary access (nullable, generated on demand)
    presigned_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # Created timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    # Relationships
    session: Mapped["AutomationSession"] = relationship(
        "AutomationSession",
        back_populates="screenshots"
    )
    input_associations: Mapped[list["ScreenshotInputAssociation"]] = relationship(
        "ScreenshotInputAssociation",
        back_populates="screenshot",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<AutomationScreenshot(id={self.id}, name='{self.name}', session_id={self.session_id})>"
