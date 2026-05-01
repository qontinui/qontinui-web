"""CaptureDetectedElement model for workflow learning capture."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from .screenshot import CaptureScreenshot


class CaptureDetectedElement(Base):
    """
    A UI element detected in a capture screenshot via computer vision.

    Elements have bounding boxes, types (button, input, etc.), and confidence scores.
    Used for matching screenshots to known states during workflow learning.

    Note: Different from DetectedElementModel which is used for state discovery analysis.
    This table is specifically for the capture-to-workflow learning pipeline.
    """

    __tablename__ = "capture_detected_elements"
    __table_args__ = {'schema': "project"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    screenshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project.capture_screenshots.id", ondelete="CASCADE")
    )

    # Element type: 'button', 'input', 'text', 'image', 'checkbox', 'radio', 'select', 'link'
    element_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Bounding box
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Text content extracted via OCR (if applicable)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Detection confidence (0.0 - 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Additional properties detected
    properties: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example properties:
    # {
    #   "color": "#3B82F6",
    #   "background_color": "#FFFFFF",
    #   "font_size": 14,
    #   "is_clickable": true,
    #   "is_visible": true,
    #   "shape": "rectangle",
    #   "has_icon": true,
    #   "icon_description": "magnifying glass"
    # }

    # Image hash for visual similarity matching
    visual_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Relationships
    screenshot: Mapped["CaptureScreenshot"] = relationship(
        "CaptureScreenshot", back_populates="detected_elements"
    )
