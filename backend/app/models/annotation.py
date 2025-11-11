"""
Annotation models for GUI element ground truth data
"""

from sqlalchemy import Column, String, Integer, Text, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base
import uuid


class AnnotationSet(Base):
    """A set of annotations for a screenshot"""
    __tablename__ = "annotation_sets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    screenshot_name = Column(String, nullable=False, index=True)
    screenshot_url = Column(String, nullable=False)
    image_width = Column(Integer, nullable=False)
    image_height = Column(Integer, nullable=False)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    created_by_id = Column(String, ForeignKey("users.id"), nullable=False)

    # Notes about this annotation set
    notes = Column(Text)

    # Boundary tolerance for matching (pixels)
    # A larger width allows more flexibility - detected boxes within this margin
    # of the ground truth boundary are considered correct matches
    boundary_width = Column(Integer, default=5, nullable=False)

    # Relationships
    annotations = relationship("Annotation", back_populates="annotation_set", cascade="all, delete-orphan")
    created_by = relationship("User")


class Annotation(Base):
    """Individual bounding box annotation"""
    __tablename__ = "annotations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    annotation_set_id = Column(String, ForeignKey("annotation_sets.id", ondelete="CASCADE"), nullable=False)

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
