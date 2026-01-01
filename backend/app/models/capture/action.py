"""CaptureAction model for workflow learning capture."""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from .screenshot import CaptureScreenshot


class CaptureAction(Base):
    """
    A user action performed during capture (click, type, key press).

    Actions are linked to screenshots and ordered by sequence_number.
    Multiple actions can occur on the same screenshot.
    """

    __tablename__ = "capture_actions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    screenshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_screenshots.id", ondelete="CASCADE")
    )

    # Order within the screenshot (0-indexed)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Action type: 'click', 'double_click', 'right_click', 'type', 'key_press', 'scroll'
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Click coordinates (null for non-click actions)
    x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    y: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Text content (for 'type' actions)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Key name (for 'key_press' actions, e.g., 'Enter', 'Escape', 'Tab')
    key: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Mouse button (for click actions: 'left', 'right', 'middle')
    button: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Scroll amount (for scroll actions)
    scroll_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Timestamp of the action
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )

    # Additional metadata (using extra_metadata to avoid SQLAlchemy reserved name)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example extra_metadata:
    # {
    #   "duration_ms": 150,  # time held for click
    #   "modifiers": ["ctrl", "shift"],  # keyboard modifiers
    #   "cursor_path": [[x1,y1], [x2,y2], ...]  # mouse movement path
    # }

    # Relationships
    screenshot: Mapped["CaptureScreenshot"] = relationship(
        "CaptureScreenshot", back_populates="actions"
    )
