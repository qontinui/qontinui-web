"""
Recording models for automated state structure discovery

These models store recording data (frames, interactions, context) that will be
processed to automatically generate state structures.
"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class RecordingStatus(StrEnum):
    """Status of recording processing"""

    UPLOADED = "uploaded"
    VALIDATING = "validating"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProcessingPhase(StrEnum):
    """Processing phases for state discovery"""

    FRAME_ANALYSIS = "frame_analysis"
    STATE_IDENTIFICATION = "state_identification"
    INTERACTION_PROCESSING = "interaction_processing"
    TRANSITION_DISCOVERY = "transition_discovery"
    STATE_MACHINE_ASSEMBLY = "state_machine_assembly"
    OPTIMIZATION = "optimization"
    COMPLETED = "completed"


class Recording(Base):
    """A recording session containing frames and interactions for state discovery."""

    __tablename__ = "recordings"

    # Primary identification
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Recording metadata
    name = Column(String, nullable=False)
    description = Column(Text)
    tags = Column(JSON, default=list)  # Array of string tags

    # Recording details (from metadata.json)
    recording_start_time = Column(DateTime, nullable=False)
    recording_end_time = Column(DateTime, nullable=False)
    duration_ms = Column(Integer, nullable=False)  # Milliseconds

    # Recorder information
    recorder_name = Column(String)
    recorder_version = Column(String)
    recorder_platform = Column(String)  # windows, macos, linux, web

    # System information
    screen_width = Column(Integer, nullable=False)
    screen_height = Column(Integer, nullable=False)
    screen_dpi = Column(Integer)
    os_name = Column(String)
    os_version = Column(String)
    locale = Column(String)

    # Target application
    app_name = Column(String, nullable=False)
    app_version = Column(String)
    app_type = Column(String)  # desktop, web, mobile
    app_url = Column(String)  # For web applications

    # Frame information
    frame_rate = Column(Float, nullable=False)  # Frames per second
    total_frames = Column(Integer, nullable=False)
    total_interactions = Column(Integer, default=0)
    total_context_events = Column(Integer, default=0)

    # Storage
    s3_bucket = Column(String)
    s3_prefix = Column(String)  # Folder prefix for this recording's files
    upload_size_bytes = Column(Integer)

    # Processing status
    status: RecordingStatus = Column(
        Enum(RecordingStatus),
        default=RecordingStatus.UPLOADED,
        nullable=False,
        index=True,
    )  # type: ignore[assignment]
    processing_phase: ProcessingPhase | None = Column(
        Enum(ProcessingPhase), nullable=True
    )  # type: ignore[assignment]
    processing_progress = Column(Float, default=0.0)  # 0.0 to 1.0
    processing_started_at = Column(DateTime)
    processing_completed_at = Column(DateTime)
    processing_error = Column(Text)

    # Validation results
    validation_errors = Column(JSON, default=list)
    validation_warnings = Column(JSON, default=list)

    # Discovered state structure
    discovered_states_count = Column(Integer, default=0)
    discovered_transitions_count = Column(Integer, default=0)
    discovered_workflows_count = Column(Integer, default=0)
    discovery_confidence = Column(Float)  # Average confidence score

    # User review status
    reviewed = Column(Boolean, default=False)
    reviewed_at = Column(DateTime)
    accepted = Column(Boolean, default=False)
    accepted_at = Column(DateTime)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    project = relationship("Project")
    created_by = relationship("User")
    frames = relationship(
        "RecordingFrame", back_populates="recording", cascade="all, delete-orphan"
    )
    interactions = relationship(
        "RecordingInteraction", back_populates="recording", cascade="all, delete-orphan"
    )
    context_events = relationship(
        "RecordingContext", back_populates="recording", cascade="all, delete-orphan"
    )
    discovered_states = relationship(
        "DiscoveredState",
        back_populates="recording",
        cascade="all, delete-orphan",
        foreign_keys="DiscoveredState.recording_id",
    )
    discovered_transitions = relationship(
        "DiscoveredTransition", back_populates="recording", cascade="all, delete-orphan"
    )
    processing_logs = relationship(
        "ProcessingLog", back_populates="recording", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_recordings_project_status", "project_id", "status"),
        Index("ix_recordings_created_at", "created_at"),
    )

    @property
    def duration_seconds(self) -> float:
        """Get duration in seconds"""
        return self.duration_ms / 1000.0  # type: ignore[return-value]

    @property
    def is_processing(self) -> bool:
        """Check if recording is currently being processed"""
        return self.status in [RecordingStatus.VALIDATING, RecordingStatus.PROCESSING]

    @property
    def is_completed(self) -> bool:
        """Check if processing is completed"""
        return self.status == RecordingStatus.COMPLETED

    @property
    def has_errors(self) -> bool:
        """Check if there are validation or processing errors"""
        return (
            self.validation_errors and len(self.validation_errors) > 0
        ) or self.processing_error is not None


class RecordingFrame(Base):
    """Individual frame from a recording."""

    __tablename__ = "recording_frames"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Frame identification
    frame_number = Column(Integer, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    relative_time_ms = Column(
        Integer, nullable=False
    )  # Milliseconds since recording start

    # Image storage
    s3_key = Column(String, nullable=False)  # Full S3 key for frame image
    image_url = Column(String)  # Presigned URL (temporary)
    url_expires_at = Column(DateTime)

    # Image properties
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    size_bytes = Column(Integer)
    format = Column(String)  # png, jpeg, webp

    # Visual analysis results (computed during processing)
    perceptual_hash = Column(String)  # Hex string of pHash
    phash_computed = Column(Boolean, default=False)

    # Cluster assignment
    cluster_id = Column(Integer)  # Which cluster this frame belongs to
    state_id = Column(
        UUID(as_uuid=True), ForeignKey("discovered_states.id"), nullable=True
    )

    # Quality metrics
    sharpness = Column(Float)
    brightness = Column(Float)
    contrast = Column(Float)

    # Window context at this frame
    window_title = Column(String)
    window_bounds = Column(JSON)  # {x, y, width, height}
    window_state = Column(String)  # maximized, minimized, normal

    # Web context (for web applications)
    url = Column(String)
    page_title = Column(String)

    # User annotations (optional)
    user_notes = Column(Text)
    user_annotations = Column(JSON)  # Custom annotations from user

    # Relationship
    recording = relationship("Recording", back_populates="frames")
    state = relationship("DiscoveredState", foreign_keys=[state_id])

    __table_args__ = (
        Index("ix_recording_frames_recording_frame", "recording_id", "frame_number"),
        Index("ix_recording_frames_recording_time", "recording_id", "relative_time_ms"),
        Index("ix_recording_frames_cluster", "recording_id", "cluster_id"),
    )


class RecordingInteraction(Base):
    """User interaction event (click, key, drag, etc.)."""

    __tablename__ = "recording_interactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Timing
    timestamp = Column(DateTime, nullable=False)
    relative_time_ms = Column(Integer, nullable=False)
    frame_number = Column(Integer)  # Nearest frame

    # Interaction type
    interaction_type = Column(String, nullable=False)  # click, drag, key, scroll, hover
    action = Column(String)  # press, release, type (for keyboard)

    # Mouse interactions
    x = Column(Integer)
    y = Column(Integer)
    button = Column(String)  # left, right, middle
    click_count = Column(Integer, default=1)

    # Drag interactions
    start_x = Column(Integer)
    start_y = Column(Integer)
    end_x = Column(Integer)
    end_y = Column(Integer)
    drag_path = Column(JSON)  # Array of {x, y, time} points

    # Keyboard interactions
    key = Column(String)
    key_code = Column(Integer)
    char = Column(String)
    text = Column(String)  # For type action
    is_sensitive = Column(Boolean, default=False)  # Is this a password field?

    # Modifiers
    modifiers = Column(JSON, default=list)  # ["ctrl", "shift", "alt"]
    is_combo = Column(Boolean, default=False)

    # Scroll interactions
    scroll_delta_x = Column(Integer)
    scroll_delta_y = Column(Integer)
    scroll_direction = Column(String)  # up, down, left, right

    # Hover interactions
    hover_duration_ms = Column(Integer)
    hover_triggered = Column(Boolean)  # Did hover cause visual change?

    # Target element (if detected)
    target_element = Column(JSON)  # {text, role, boundingBox, etc.}

    # Metadata
    duration_ms = Column(Integer)
    extra_data = Column("metadata", JSON)  # Renamed to avoid SQLAlchemy reserved word

    # Processing results
    causes_state_change = Column(Boolean)  # Determined during processing
    target_state_id = Column(
        UUID(as_uuid=True), ForeignKey("discovered_states.id"), nullable=True
    )
    transition_id = Column(
        UUID(as_uuid=True), ForeignKey("discovered_transitions.id"), nullable=True
    )

    # Relationship
    recording = relationship("Recording", back_populates="interactions")
    target_state = relationship("DiscoveredState", foreign_keys=[target_state_id])
    transition = relationship("DiscoveredTransition", foreign_keys=[transition_id])

    __table_args__ = (
        Index(
            "ix_recording_interactions_recording_time",
            "recording_id",
            "relative_time_ms",
        ),
        Index("ix_recording_interactions_type", "recording_id", "interaction_type"),
    )


class RecordingContext(Base):
    """Context events (window changes, URL navigation, focus changes)."""

    __tablename__ = "recording_contexts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Timing
    timestamp = Column(DateTime, nullable=False)
    relative_time_ms = Column(Integer, nullable=False)
    frame_number = Column(Integer)

    # Event type
    event_type = Column(
        String, nullable=False
    )  # window_change, url_change, focus_change, app_launch, app_close

    # Window information
    window_title = Column(String)
    process_name = Column(String)
    process_id = Column(Integer)
    window_bounds = Column(JSON)  # {x, y, width, height}
    window_state = Column(String)
    window_z_index = Column(Integer)
    is_modal = Column(Boolean)

    # Previous window (for change events)
    previous_window = Column(JSON)

    # Web context
    url = Column(String)
    previous_url = Column(String)
    page_title = Column(String)
    domain = Column(String)
    pathname = Column(String)
    navigation_type = Column(String)  # pushState, replaceState, reload, link
    load_time_ms = Column(Integer)
    load_complete = Column(Boolean)

    # Focus information
    focused_element = Column(JSON)  # {type, role, label, placeholder, boundingBox}
    previous_focus = Column(JSON)

    # Application state
    app_state = Column(JSON)  # {authenticated, userId, sessionId, etc.}

    # Performance metrics
    cpu_usage = Column(Float)
    memory_usage = Column(Integer)
    network_activity = Column(Boolean)
    is_loading = Column(Boolean)

    # Metadata
    extra_data = Column("metadata", JSON)  # Renamed to avoid SQLAlchemy reserved word
    description = Column(Text)

    # Relationship
    recording = relationship("Recording", back_populates="context_events")

    __table_args__ = (
        Index(
            "ix_recording_contexts_recording_time", "recording_id", "relative_time_ms"
        ),
        Index("ix_recording_contexts_type", "recording_id", "event_type"),
    )


class DiscoveredTransition(Base):
    """A transition discovered through automated analysis."""

    __tablename__ = "discovered_transitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transition definition
    from_state_id = Column(
        UUID(as_uuid=True), ForeignKey("discovered_states.id"), nullable=False
    )
    to_state_id = Column(
        UUID(as_uuid=True), ForeignKey("discovered_states.id"), nullable=True
    )

    # Multi-state support
    activate_state_ids = Column(JSON, default=list)  # Array of state UUIDs
    deactivate_state_ids = Column(JSON, default=list)
    stays_visible = Column(Boolean, default=False)

    # Trigger information
    trigger_interaction_id = Column(
        UUID(as_uuid=True), ForeignKey("recording_interactions.id"), nullable=True
    )
    trigger_type = Column(String)  # click, key, auto, etc.
    trigger_description = Column(Text)

    # Timing
    latency_ms = Column(Integer)  # Time from trigger to state change
    recommended_timeout_ms = Column(Integer)
    recommended_retry_count = Column(Integer, default=3)

    # Generated workflow (stored as JSON)
    workflow = Column(JSON)  # Full workflow object with actions
    workflow_name = Column(String)

    # Confidence
    confidence = Column(Float)
    clarity_score = Column(Float)  # How clear is the visual change?
    consistency_score = Column(Float)  # How reproducible?
    completeness_score = Column(Float)  # Are all actions captured?

    # Position on canvas
    position_x = Column(Float)
    position_y = Column(Float)

    # User review
    user_edited = Column(Boolean, default=False)
    user_approved = Column(Boolean, default=False)
    user_notes = Column(Text)

    # Conversion to actual transition
    converted_to_transition_id = Column(UUID(as_uuid=True), nullable=True)
    converted_at = Column(DateTime)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    recording = relationship("Recording", back_populates="discovered_transitions")
    from_state = relationship("DiscoveredState", foreign_keys=[from_state_id])
    to_state = relationship("DiscoveredState", foreign_keys=[to_state_id])
    trigger_interaction = relationship(
        "RecordingInteraction", foreign_keys=[trigger_interaction_id]
    )

    __table_args__ = (
        Index("ix_discovered_transitions_recording", "recording_id"),
        Index("ix_discovered_transitions_from_state", "from_state_id"),
        Index("ix_discovered_transitions_to_state", "to_state_id"),
    )


class ProcessingLog(Base):
    """Logs for processing steps (for debugging and progress tracking)."""

    __tablename__ = "processing_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recording_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Log entry
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    phase: ProcessingPhase = Column(Enum(ProcessingPhase), nullable=False)  # type: ignore[assignment]
    level = Column(String, nullable=False)  # info, warning, error
    message = Column(Text, nullable=False)

    # Additional data
    data = Column(JSON)

    # Progress
    progress = Column(Float)  # Phase progress (0.0-1.0)

    # Relationship
    recording = relationship("Recording", back_populates="processing_logs")

    __table_args__ = (
        Index("ix_processing_logs_recording_time", "recording_id", "timestamp"),
        Index("ix_processing_logs_phase", "recording_id", "phase"),
    )
