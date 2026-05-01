"""CaptureScreenshot model for workflow learning capture."""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from .action import CaptureAction
    from .detected_element import CaptureDetectedElement
    from .session import CaptureSession
    from .state_match import ScreenshotStateMatch


class CaptureScreenshot(Base):
    """
    A single screenshot captured during a session.

    Contains the image, detected elements, and actions performed on it.
    Screenshots are ordered by sequence_number within a session.
    """

    __tablename__ = "capture_screenshots"
    __table_args__ = {"schema": "project"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project.capture_sessions.id", ondelete="CASCADE")
    )

    # Order within the session (0-indexed)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Image storage (S3/MinIO paths)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Image dimensions
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Timestamp when screenshot was taken
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )

    # Additional metadata (using extra_metadata to avoid SQLAlchemy reserved name)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example extra_metadata:
    # {
    #   "window_title": "Chrome - Login Page",
    #   "application": "chrome.exe",
    #   "screen_index": 0,
    #   "file_size_bytes": 245678
    # }

    # Analysis status: 'pending', 'analyzing', 'completed', 'failed'
    analysis_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending"
    )

    # Relationships
    session: Mapped["CaptureSession"] = relationship(
        "CaptureSession", back_populates="screenshots"
    )
    actions: Mapped[list["CaptureAction"]] = relationship(
        "CaptureAction", back_populates="screenshot", cascade="all, delete-orphan"
    )
    detected_elements: Mapped[list["CaptureDetectedElement"]] = relationship(
        "CaptureDetectedElement",
        back_populates="screenshot",
        cascade="all, delete-orphan",
    )
    state_matches: Mapped[list["ScreenshotStateMatch"]] = relationship(
        "ScreenshotStateMatch",
        back_populates="screenshot",
        cascade="all, delete-orphan",
    )
