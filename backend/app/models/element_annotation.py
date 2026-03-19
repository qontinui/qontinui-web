"""
Element annotation models for project-scoped GUI element annotations.

These models store element annotations that are associated with specific projects,
supporting versioning and persistence of annotated UI elements.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ElementAnnotationSet(Base):
    """
    A set of element annotations for a project.

    Each project can have multiple annotation sets, with one being the "current" version.
    This supports versioning of annotations over time.
    """

    __tablename__ = "element_annotation_sets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Screenshot metadata
    screenshot_width: Mapped[int] = mapped_column(Integer, nullable=False)
    screenshot_height: Mapped[int] = mapped_column(Integer, nullable=False)
    screenshot_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # Version tracking
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_current: Mapped[bool] = mapped_column(default=True, nullable=False)
    version_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    # Relationships
    elements: Mapped[list["ElementAnnotation"]] = relationship(
        "ElementAnnotation",
        back_populates="annotation_set",
        cascade="all, delete-orphan",
        order_by="ElementAnnotation.order",
    )
    project = relationship("Project", back_populates="element_annotation_sets")
    created_by = relationship("User")

    __table_args__ = (
        Index(
            "ix_element_annotation_sets_project_current",
            "project_id",
            "is_current",
        ),
        Index(
            "ix_element_annotation_sets_project_version",
            "project_id",
            "version_number",
        ),
    )

    @property
    def element_count(self) -> int:
        """Get the number of elements in this annotation set."""
        return len(self.elements) if self.elements else 0


class ElementAnnotation(Base):
    """
    Individual element annotation within an annotation set.

    Represents a single annotated GUI element with bounding box,
    label, and optional metadata.
    """

    __tablename__ = "element_annotations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    annotation_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("element_annotation_sets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Bounding box coordinates (in pixels)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Element metadata
    label: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    element_type: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True
    )  # e.g., "button", "input", "text"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Additional data as JSON (custom properties, attributes, etc.)
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    # Ordering
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Client-side ID for tracking (optional, for sync purposes)
    client_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Relationship
    annotation_set: Mapped["ElementAnnotationSet"] = relationship(
        "ElementAnnotationSet", back_populates="elements"
    )

    __table_args__ = (
        Index("ix_element_annotations_set_id", "annotation_set_id"),
        Index("ix_element_annotations_set_order", "annotation_set_id", "order"),
    )
