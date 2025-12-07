"""
Database models for project assets (screenshots and images).

This module handles storage of visual assets for projects:
- ProjectScreenshot: Full screenshots uploaded/captured for a project
- ProjectImage: Extracted image regions/patterns from screenshots

Assets are stored in S3/MinIO with metadata in the database.
"""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base

if TYPE_CHECKING:
    from app.models.capture import CaptureSession
    from app.models.project import Project
    from app.models.user import User


class ProjectScreenshot(Base):
    """
    A full screenshot uploaded or captured for a project.

    Screenshots can come from multiple sources:
    - upload: User uploaded directly
    - runner: Captured by qontinui-runner
    - capture_session: From a workflow learning session
    - screen_capture: From web interface screen capture tool

    All screenshots are stored in S3/MinIO with metadata here.
    """

    __tablename__ = "project_screenshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # S3/MinIO storage key
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)

    # Image dimensions
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # File size in bytes
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    # Source type: 'upload', 'runner', 'capture_session', 'screen_capture'
    source: Mapped[str] = mapped_column(String(50), nullable=False)

    # Optional link to capture session (if from workflow learning)
    capture_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("capture_sessions.id", ondelete="SET NULL"), nullable=True
    )

    # Monitor index (for runner captures, which monitor was captured)
    monitor_index: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Additional metadata
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    # Example metadata:
    # {
    #   "window_title": "Chrome - Login Page",
    #   "application": "chrome.exe",
    #   "uploaded_filename": "screenshot.png",
    #   "mime_type": "image/png",
    #   "screen_resolution": "1920x1080",
    #   "capture_timestamp": "2024-01-15T10:30:00Z"
    # }

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="screenshots")
    user: Mapped["User"] = relationship("User", back_populates="project_screenshots")
    capture_session: Mapped["CaptureSession | None"] = relationship(
        "CaptureSession", back_populates="project_screenshots"
    )
    extracted_images: Mapped[list["ProjectImage"]] = relationship(
        "ProjectImage",
        back_populates="source_screenshot",
        foreign_keys="ProjectImage.source_screenshot_id",
        cascade="all, delete-orphan",
    )


class ProjectImage(Base):
    """
    An extracted image region or pattern for a project.

    Images can be:
    - Uploaded directly by users
    - Extracted from screenshots (cropped regions)
    - Generated during pattern optimization
    - Discovered during state discovery

    Each image can optionally have an associated mask image.
    """

    __tablename__ = "project_images"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # S3/MinIO storage key for the main image
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)

    # Optional S3/MinIO storage key for mask image
    mask_s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Image dimensions
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # File size in bytes (main image)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    # Source type: 'uploaded', 'pattern_optimization', 'image_extraction', 'state_discovery'
    source: Mapped[str] = mapped_column(String(50), nullable=False)

    # Optional link to source screenshot (if extracted from a screenshot)
    source_screenshot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("project_screenshots.id", ondelete="SET NULL"), nullable=True
    )

    # Source region (if extracted from screenshot): {x, y, width, height}
    source_region: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example:
    # {
    #   "x": 100,
    #   "y": 200,
    #   "width": 300,
    #   "height": 150
    # }

    # Additional metadata
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    # Example metadata:
    # {
    #   "uploaded_filename": "login_button.png",
    #   "mime_type": "image/png",
    #   "pattern_type": "template",
    #   "confidence_threshold": 0.85,
    #   "extraction_method": "manual_crop",
    #   "visual_hash": "abc123..."
    # }

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="images")
    user: Mapped["User"] = relationship("User", back_populates="project_images")
    source_screenshot: Mapped["ProjectScreenshot | None"] = relationship(
        "ProjectScreenshot",
        back_populates="extracted_images",
        foreign_keys=[source_screenshot_id],
    )
