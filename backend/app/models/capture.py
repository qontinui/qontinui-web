"""
Database models for screenshot capture and workflow learning.

This module handles two distinct capture systems:

1. WORKFLOW LEARNING CAPTURE (existing):
   - Users capture screenshots + actions in the runner
   - Screenshots are uploaded to capture sessions
   - AI analyzes screenshots to detect UI elements
   - Elements are matched to known states
   - Workflows are generated from action sequences
   - Users review and publish learned workflows

2. VIDEO CAPTURE & HISTORICAL DATA (migrated from qontinui-api):
   - Video recording sessions with metadata
   - Input events (mouse, keyboard) as time-series data
   - Frame index for efficient video frame extraction
   - Links between automation results and video timestamps
   - Historical results for integration testing mock data
"""

import uuid
from datetime import UTC, datetime
from enum import Enum as PyEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.project_assets import ProjectScreenshot
    from app.models.user import User


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
        default=lambda: datetime.now(UTC),
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
    project_screenshots: Mapped[list["ProjectScreenshot"]] = relationship(
        "ProjectScreenshot", back_populates="capture_session"
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
        default=lambda: datetime.now(UTC),
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
        default=lambda: datetime.now(UTC),
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


# ==================================================================================
# VIDEO CAPTURE & HISTORICAL DATA MODELS (migrated from qontinui-api)
# ==================================================================================


class StorageBackend(PyEnum):
    """Storage backend types for video files."""

    LOCAL = "local"
    S3 = "s3"


class InputEventType(PyEnum):
    """Types of input events."""

    MOUSE_MOVE = "mouse_move"
    MOUSE_CLICK = "mouse_click"
    MOUSE_DOWN = "mouse_down"
    MOUSE_UP = "mouse_up"
    MOUSE_SCROLL = "mouse_scroll"
    MOUSE_DRAG = "mouse_drag"
    KEY_PRESS = "key_press"
    KEY_DOWN = "key_down"
    KEY_UP = "key_up"


class VideoCaptureSession(Base):
    """
    Video capture session metadata (migrated from qontinui-api).

    Represents a single video recording session that captures:
    - Screen video
    - Input events (mouse, keyboard)
    - Automation results (linked via snapshot_run)

    The video file is stored externally (local filesystem or S3),
    with only the reference stored in the database.

    NOTE: This is different from CaptureSession which is for workflow learning
    from screenshots. This model is for continuous video recording.
    """

    __tablename__ = "video_capture_sessions"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Unique session identifier (UUID)
    session_id: Mapped[str] = mapped_column(
        String(36), unique=True, nullable=False, index=True
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now(), index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_ms: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )  # Total duration in milliseconds

    # Video metadata
    video_width: Mapped[int] = mapped_column(Integer, nullable=False)
    video_height: Mapped[int] = mapped_column(Integer, nullable=False)
    video_fps: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    video_codec: Mapped[str] = mapped_column(String(50), nullable=False, default="h264")
    video_format: Mapped[str] = mapped_column(String(10), nullable=False, default="mp4")
    total_frames: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Storage information
    storage_backend: Mapped[str] = mapped_column(
        String(20), nullable=False, default="local"
    )  # 'local' or 's3'
    video_path: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # Local path or S3 key
    video_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Optional compressed/streaming version
    compressed_video_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    compressed_video_size_bytes: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )

    # Monitor/display info
    monitor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monitor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    monitor_scale_factor: Mapped[float | None] = mapped_column(
        Float, nullable=True, default=1.0
    )

    # Association with snapshot run (automation results)
    snapshot_run_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("snapshot_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Association with workflow (references workflow_id in project JSON, not a FK)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Association with project
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # User who created the session
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Session status
    is_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_processed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )  # Frame index built

    # Additional metadata
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now()
    )

    # Relationships
    input_events: Mapped[list["InputEvent"]] = relationship(
        "InputEvent",
        back_populates="video_capture_session",
        cascade="all, delete-orphan",
        lazy="dynamic",  # For efficient querying of large event sets
    )
    frame_index: Mapped[list["FrameIndex"]] = relationship(
        "FrameIndex",
        back_populates="video_capture_session",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    action_frames: Mapped[list["ActionFrame"]] = relationship(
        "ActionFrame",
        back_populates="video_capture_session",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_video_capture_sessions_started_at", "started_at"),
        Index("idx_video_capture_sessions_workflow_id", "workflow_id"),
        Index("idx_video_capture_sessions_project_id", "project_id"),
        Index("idx_video_capture_sessions_snapshot_run_id", "snapshot_run_id"),
    )

    def __repr__(self) -> str:
        return f"<VideoCaptureSession(id={self.id}, session_id='{self.session_id}')>"


class InputEvent(Base):
    """
    Input events (mouse and keyboard) captured during a video session (migrated from qontinui-api).

    Stored as time-series data with millisecond precision timestamps
    relative to session start. This allows efficient querying for
    events within a time range and playback synchronization with video.
    """

    __tablename__ = "input_events"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # Foreign key to video capture session
    video_capture_session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("video_capture_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Timestamp (milliseconds from session start)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)

    # Event type
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Mouse position (for mouse events)
    mouse_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mouse_y: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Mouse button (for click events): 1=left, 2=middle, 3=right
    mouse_button: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    # Scroll delta (for scroll events)
    scroll_dx: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scroll_dy: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Keyboard data
    key_code: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # Virtual key code
    key_name: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # Human-readable key name
    key_char: Mapped[str | None] = mapped_column(
        String(10), nullable=True
    )  # Character if printable

    # Modifier keys state
    shift_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )
    ctrl_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )
    alt_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )
    meta_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )  # Win/Cmd key

    # Additional event data (for complex events like drag)
    event_data_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Relationship
    video_capture_session: Mapped["VideoCaptureSession"] = relationship(
        "VideoCaptureSession", back_populates="input_events"
    )

    __table_args__ = (
        Index(
            "idx_input_events_session_timestamp",
            "video_capture_session_id",
            "timestamp_ms",
        ),
        Index("idx_input_events_type", "event_type"),
    )

    def __repr__(self) -> str:
        return f"<InputEvent(id={self.id}, type={self.event_type}, ts={self.timestamp_ms}ms)>"


class FrameIndex(Base):
    """
    Index mapping timestamps to video frame positions (migrated from qontinui-api).

    This table enables efficient frame extraction by storing:
    - Keyframe positions (I-frames) for fast seeking
    - Timestamp to frame number mapping
    - Byte offsets for direct seeking (optional)

    Only keyframes and periodic samples are stored to keep the table size manageable.
    """

    __tablename__ = "frame_index"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # Foreign key to video capture session
    video_capture_session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("video_capture_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Frame information
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp_ms: Mapped[int] = mapped_column(
        BigInteger, nullable=False, index=True
    )  # Milliseconds from start

    # Video seeking information
    byte_offset: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )  # Byte position in video file
    is_keyframe: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )

    # Frame metadata (optional, for important frames)
    frame_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # For deduplication/comparison

    # Relationship
    video_capture_session: Mapped["VideoCaptureSession"] = relationship(
        "VideoCaptureSession", back_populates="frame_index"
    )

    __table_args__ = (
        Index(
            "idx_frame_index_session_timestamp",
            "video_capture_session_id",
            "timestamp_ms",
        ),
        Index(
            "idx_frame_index_session_frame", "video_capture_session_id", "frame_number"
        ),
        Index("idx_frame_index_keyframes", "video_capture_session_id", "is_keyframe"),
        UniqueConstraint(
            "video_capture_session_id",
            "frame_number",
            name="uq_frame_index_session_frame",
        ),
    )

    def __repr__(self) -> str:
        return f"<FrameIndex(session={self.video_capture_session_id}, frame={self.frame_number})>"


class ActionFrame(Base):
    """
    Links automation actions to specific video frames (migrated from qontinui-api).

    This table enables:
    - Retrieving the exact frame when an action occurred
    - Showing visual context for automation results
    - Integration test playback with screenshots

    Each automation action (from SnapshotAction) can have multiple
    associated frames (before, during, after the action).
    """

    __tablename__ = "action_frames"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign keys
    video_capture_session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("video_capture_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    snapshot_action_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_actions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Frame timing
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Frame type relative to action
    frame_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="action"
    )  # 'before', 'action', 'after', 'result'

    # Cached frame path (if extracted and cached)
    cached_frame_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    cache_storage_backend: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # 'local' or 's3'

    # Relationship
    video_capture_session: Mapped["VideoCaptureSession"] = relationship(
        "VideoCaptureSession", back_populates="action_frames"
    )

    __table_args__ = (
        Index("idx_action_frames_session", "video_capture_session_id"),
        Index("idx_action_frames_action", "snapshot_action_id"),
        Index("idx_action_frames_type", "frame_type"),
        UniqueConstraint(
            "video_capture_session_id",
            "snapshot_action_id",
            "frame_type",
            name="uq_action_frames_session_action_type",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ActionFrame(action={self.snapshot_action_id}, type={self.frame_type})>"
        )


class HistoricalResult(Base):
    """
    Queryable historical results for integration testing (migrated from qontinui-api).

    This table aggregates data from snapshot actions in a format
    optimized for random selection during mock mode execution.
    It includes denormalized fields for efficient querying without joins.

    Key features:
    - Indexed by pattern, state, and action type for fast lookups
    - Links to video capture session for frame retrieval
    - Stores result data needed for mock responses
    """

    __tablename__ = "historical_results"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # Source references
    snapshot_run_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    snapshot_action_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_actions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    video_capture_session_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("video_capture_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Denormalized query fields (for efficient selection)
    pattern_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    pattern_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    active_states: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)

    # Result data
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    match_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_match_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)

    # Match location (for FIND actions)
    match_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Video frame info (for frame retrieval)
    frame_timestamp_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    frame_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Full result data for mock responses
    result_data_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Workflow/project context (workflow_id references workflow in project JSON, not a FK)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Timestamps
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )

    __table_args__ = (
        # Composite indexes for common query patterns
        Index("idx_historical_pattern_states", "pattern_id", "active_states"),
        Index("idx_historical_action_type_success", "action_type", "success"),
        Index("idx_historical_workflow_pattern", "workflow_id", "pattern_id"),
        Index("idx_historical_project_pattern", "project_id", "pattern_id"),
        # For random selection within a context
        Index(
            "idx_historical_selection",
            "pattern_id",
            "action_type",
            "success",
            "recorded_at",
        ),
    )

    def __repr__(self) -> str:
        return f"<HistoricalResult(id={self.id}, pattern={self.pattern_id}, type={self.action_type})>"
