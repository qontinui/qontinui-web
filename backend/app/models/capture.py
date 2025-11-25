"""
Database models for screenshot capture and workflow learning.

This module handles the capture-to-workflow pipeline:
1. Users capture screenshots + actions in the runner
2. Screenshots are uploaded to capture sessions
3. AI analyzes screenshots to detect UI elements
4. Elements are matched to known states
5. Workflows are generated from action sequences
6. Users review and publish learned workflows
"""

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from app.db.base_class import Base
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.state import State
    from app.models.user import User
    from app.models.workflow import Workflow


class CaptureSession(Base):
    """
    A capture session represents a recording of user interactions.

    Contains multiple screenshots taken in sequence, along with the actions
    performed between them. Used for learning workflows from demonstrations.
    """

    __tablename__ = "capture_sessions"

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
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status: 'capturing', 'uploading', 'analyzing', 'completed', 'failed', 'archived'
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="capturing")

    # Metadata about the capture (using extra_metadata to avoid SQLAlchemy reserved name)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example extra_metadata:
    # {
    #   "runner_version": "1.0.0",
    #   "os": "Windows 11",
    #   "screen_resolution": "1920x1080",
    #   "total_duration_ms": 45000
    # }

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    project: Mapped["Project"] = relationship(
        "Project", back_populates="capture_sessions"
    )
    user: Mapped["User"] = relationship("User", back_populates="capture_sessions")
    screenshots: Mapped[list["CaptureScreenshot"]] = relationship(
        "CaptureScreenshot", back_populates="session", cascade="all, delete-orphan"
    )
    learned_workflows: Mapped[list["LearnedWorkflow"]] = relationship(
        "LearnedWorkflow", back_populates="session", cascade="all, delete-orphan"
    )


class CaptureScreenshot(Base):
    """
    A single screenshot captured during a session.

    Contains the image, detected elements, and actions performed on it.
    Screenshots are ordered by sequence_number within a session.
    """

    __tablename__ = "capture_screenshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_sessions.id", ondelete="CASCADE")
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
        default=lambda: datetime.now(timezone.utc),
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
        default=lambda: datetime.now(timezone.utc),
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


class CaptureDetectedElement(Base):
    """
    A UI element detected in a capture screenshot via computer vision.

    Elements have bounding boxes, types (button, input, etc.), and confidence scores.
    Used for matching screenshots to known states during workflow learning.

    Note: Different from DetectedElementModel which is used for state discovery analysis.
    This table is specifically for the capture-to-workflow learning pipeline.
    """

    __tablename__ = "capture_detected_elements"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    screenshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_screenshots.id", ondelete="CASCADE")
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


class ScreenshotStateMatch(Base):
    """
    A detected match between a screenshot and a known state.

    Multiple states can be active in a single screenshot (e.g., navbar + form + footer).
    Each match has a confidence score and list of which elements matched.

    Note: States are stored in project configuration JSON, not as database rows,
    so we reference them by name/identifier rather than foreign key.
    """

    __tablename__ = "screenshot_state_matches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    screenshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_screenshots.id", ondelete="CASCADE")
    )

    # State identifier (name or ID from project configuration)
    state_identifier: Mapped[str] = mapped_column(String(255), nullable=False)

    # State metadata for reference
    state_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example:
    # {
    #   "state_name": "LoginForm",
    #   "state_id": "state-uuid-123",
    #   "project_version": 15
    # }

    # Match confidence (0.0 - 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Which elements matched (references to DetectedElement IDs and State element IDs)
    matched_elements: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Example:
    # {
    #   "matches": [
    #     {
    #       "detected_element_id": "uuid-1",
    #       "state_element_id": "login_button",
    #       "confidence": 0.95
    #     },
    #     {
    #       "detected_element_id": "uuid-2",
    #       "state_element_id": "username_input",
    #       "confidence": 0.88
    #     }
    #   ],
    #   "total_expected": 5,  # state has 5 elements
    #   "total_matched": 2,    # 2 elements matched
    #   "match_percentage": 0.4
    # }

    # User confirmation (null = not reviewed, true = confirmed, false = rejected)
    is_confirmed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=None
    )

    # Notes from user review
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    screenshot: Mapped["CaptureScreenshot"] = relationship(
        "CaptureScreenshot", back_populates="state_matches"
    )


class LearnedWorkflow(Base):
    """
    A workflow generated from a capture session.

    This is a draft workflow awaiting user review. Once approved,
    it can be converted to a real Workflow in the workflows table.
    """

    __tablename__ = "learned_workflows"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_sessions.id", ondelete="CASCADE")
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Generated workflow structure (JSON)
    workflow_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Example structure:
    # {
    #   "states": [...],
    #   "transitions": [...],
    #   "start_state_id": "...",
    #   "metadata": {
    #     "confidence": 0.87,
    #     "warnings": ["Transition 2->3 has low confidence"],
    #     "generation_method": "sequential_analysis",
    #     "screenshot_count": 15
    #   }
    # }

    # Overall confidence score
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Status: 'draft', 'reviewing', 'approved', 'rejected', 'published'
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")

    # Warnings/issues found during generation
    warnings: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # If published, metadata about the workflow integration
    # Since workflows are stored in project configuration JSON, not a separate table,
    # we store metadata about where this workflow was published
    published_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example:
    # {
    #   "workflow_name": "Login Flow",
    #   "published_to_project_version": 15,
    #   "workflow_id_in_config": "workflow-uuid-123"
    # }

    # Relationships
    session: Mapped["CaptureSession"] = relationship(
        "CaptureSession", back_populates="learned_workflows"
    )
    project: Mapped["Project"] = relationship("Project")
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewer_id])
