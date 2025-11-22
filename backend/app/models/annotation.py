"""
Annotation models for GUI element ground truth data
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.db.base import Base
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship


class AnnotationSet(Base):
    """A set of annotations for a screenshot or multiple screenshots"""

    __tablename__ = "annotation_sets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    screenshot_name = Column(String, nullable=False, index=True)
    screenshot_url = Column(String, nullable=False)
    image_width = Column(Integer, nullable=False)
    image_height = Column(Integer, nullable=False)

    # Multi-screenshot support: array of screenshot objects
    # Format: [{"name": "...", "url": "...", "width": ..., "height": ...}, ...]
    # If null, this is a single-screenshot set (backward compatibility)
    screenshots = Column(JSON, nullable=True)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Notes about this annotation set
    notes = Column(Text)

    # Boundary tolerance for matching (pixels)
    # A larger width allows more flexibility - detected boxes within this margin
    # of the ground truth boundary are considered correct matches
    boundary_width = Column(Integer, default=5, nullable=False)

    # Relationships
    annotations = relationship(
        "Annotation", back_populates="annotation_set", cascade="all, delete-orphan"
    )
    created_by = relationship("User")

    @property
    def screenshot_count(self) -> int:
        """Get the number of screenshots in this set"""
        if self.screenshots is None:
            return 1  # Single screenshot (backward compatibility)
        return len(self.screenshots)

    def get_screenshot(self, index: int = 0) -> Optional[Dict[str, Any]]:
        """Get screenshot metadata by index"""
        if self.screenshots is None:
            # Single screenshot mode - return the original fields
            if index == 0:
                return {
                    "name": self.screenshot_name,
                    "url": self.screenshot_url,
                    "width": self.image_width,
                    "height": self.image_height,
                }
            return None

        if 0 <= index < len(self.screenshots):
            return self.screenshots[index]
        return None


class Annotation(Base):
    """Individual bounding box annotation"""

    __tablename__ = "annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    annotation_set_id = Column(
        UUID(as_uuid=True),
        ForeignKey("annotation_sets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Screenshot index for multi-screenshot support
    # For single-screenshot sets, this is always 0
    screenshot_index = Column(Integer, default=0, nullable=False, index=True)

    # Bounding box coordinates
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)

    # Element metadata
    label = Column(String)
    description = Column(Text)
    reason = Column(Text)  # Why this element is useful

    # Additional data (custom properties)
    extra_data = Column(JSON)

    # Order in the list
    order = Column(Integer, default=0)

    # Relationship
    annotation_set = relationship("AnnotationSet", back_populates="annotations")

    __table_args__ = (
        Index("ix_annotations_set_screenshot", "annotation_set_id", "screenshot_index"),
    )
