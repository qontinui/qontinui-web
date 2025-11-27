"""
Pydantic schemas for recording API (automated state discovery)
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

# Enums


class RecordingStatusEnum(str, Enum):
    """Recording processing status"""

    UPLOADED = "uploaded"
    VALIDATING = "validating"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProcessingPhaseEnum(str, Enum):
    """Processing phases"""

    FRAME_ANALYSIS = "frame_analysis"
    STATE_IDENTIFICATION = "state_identification"
    INTERACTION_PROCESSING = "interaction_processing"
    TRANSITION_DISCOVERY = "transition_discovery"
    STATE_MACHINE_ASSEMBLY = "state_machine_assembly"
    OPTIMIZATION = "optimization"
    COMPLETED = "completed"


class InteractionTypeEnum(str, Enum):
    """Interaction types"""

    CLICK = "click"
    DRAG = "drag"
    KEY = "key"
    SCROLL = "scroll"
    HOVER = "hover"


class ContextEventTypeEnum(str, Enum):
    """Context event types"""

    WINDOW_CHANGE = "window_change"
    URL_CHANGE = "url_change"
    FOCUS_CHANGE = "focus_change"
    APP_LAUNCH = "app_launch"
    APP_CLOSE = "app_close"


# Metadata schemas (from recording format spec)


class RecorderInfo(BaseModel):
    """Information about the recording tool"""

    name: str
    version: str | None = None
    platform: str = Field(..., pattern="^(windows|macos|linux|web)$")


class SystemInfo(BaseModel):
    """System information"""

    os: str | None = None
    osVersion: str | None = None
    screenResolution: dict[str, int] = Field(..., description="width and height")
    dpi: int | None = None
    locale: str | None = None

    @field_validator("screenResolution")
    @classmethod
    def validate_resolution(cls, v):
        if "width" not in v or "height" not in v:
            raise ValueError("screenResolution must contain width and height")
        if v["width"] <= 0 or v["height"] <= 0:
            raise ValueError("screenResolution dimensions must be positive")
        return v


class TargetApplication(BaseModel):
    """Target application information"""

    name: str
    version: str | None = None
    type: str = Field(..., pattern="^(desktop|web|mobile)$")
    url: str | None = None


class RecordingMetadata(BaseModel):
    """Metadata about the recording"""

    recordingId: str
    version: str = Field(default="1.0")
    recordingStartTime: datetime
    recordingEndTime: datetime
    duration: int = Field(..., description="Duration in milliseconds")
    recorder: RecorderInfo
    system: SystemInfo
    targetApplication: TargetApplication
    frameRate: float = Field(..., gt=0)
    totalFrames: int = Field(..., ge=0)
    annotations: dict[str, Any] | None = None

    @field_validator("recordingEndTime")
    @classmethod
    def validate_end_time(cls, v, info):
        start_time = info.data.get("recordingStartTime")
        if start_time and v <= start_time:
            raise ValueError("recordingEndTime must be after recordingStartTime")
        return v


# Frame schemas


class FrameData(BaseModel):
    """Individual frame data"""

    frameNumber: int = Field(..., ge=0)
    timestamp: datetime
    imageUrl: str | None = None  # For JSON format with URLs
    relativeTime: int | None = Field(None, description="Milliseconds since start")
    windowInfo: dict[str, Any] | None = None
    userAnnotations: dict[str, Any] | None = None


# Interaction schemas


class Coordinates(BaseModel):
    """X, Y coordinates"""

    x: int
    y: int


class DragPath(BaseModel):
    """Point in drag path"""

    x: int
    y: int
    time: int  # Milliseconds from drag start


class TargetElement(BaseModel):
    """Target UI element information"""

    text: str | None = None
    role: str | None = None
    label: str | None = None
    placeholder: str | None = None
    boundingBox: dict[str, int] | None = None


class InteractionData(BaseModel):
    """User interaction event"""

    id: str
    timestamp: datetime
    relativeTime: int = Field(..., description="Milliseconds since recording start")
    frameNumber: int | None = None
    type: InteractionTypeEnum

    # Mouse/click fields
    coordinates: Coordinates | None = None
    button: str | None = Field(None, pattern="^(left|right|middle)$")
    clickCount: int | None = Field(default=1, ge=1)

    # Drag fields
    startCoordinates: Coordinates | None = None
    endCoordinates: Coordinates | None = None
    path: list[DragPath] | None = None

    # Keyboard fields
    action: str | None = Field(None, pattern="^(press|release|type)$")
    key: str | None = None
    keyCode: int | None = None
    char: str | None = None
    text: str | None = None

    # Scroll fields
    delta: Coordinates | None = None
    direction: str | None = Field(None, pattern="^(up|down|left|right)$")
    scrollType: str | None = Field(None, pattern="^(wheel|trackpad|scrollbar)$")

    # Hover fields
    hoverDuration: int | None = None
    hoverTriggered: bool | None = None

    # Common fields
    targetElement: TargetElement | None = None
    metadata: dict[str, Any] | None = None


# Context schemas


class WindowInfo(BaseModel):
    """Window information"""

    title: str | None = None
    processName: str | None = None
    processId: int | None = None
    bounds: dict[str, int] | None = None
    state: str | None = Field(None, pattern="^(maximized|minimized|normal)$")
    zIndex: int | None = None
    isModal: bool | None = None


class WebContext(BaseModel):
    """Web application context"""

    url: str
    previousUrl: str | None = None
    title: str | None = None
    domain: str | None = None
    pathname: str | None = None
    hash: str | None = None
    navigation: str | None = Field(
        None, pattern="^(pushState|replaceState|reload|link)$"
    )
    loadTime: int | None = None
    loadComplete: bool | None = None


class ContextEventData(BaseModel):
    """Context event"""

    timestamp: datetime
    relativeTime: int
    frameNumber: int | None = None
    eventType: ContextEventTypeEnum
    windowInfo: WindowInfo | None = None
    webContext: WebContext | None = None
    previousWindow: dict[str, Any] | None = None
    focusedElement: dict[str, Any] | None = None
    previousFocus: dict[str, Any] | None = None
    appState: dict[str, Any] | None = None
    performance: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    description: str | None = None


# Upload request schema


class RecordingUploadRequest(BaseModel):
    """Request to upload a recording"""

    metadata: RecordingMetadata
    frames: list[FrameData] | None = None  # For JSON format
    interactions: list[InteractionData] = Field(default_factory=list)
    contextEvents: list[ContextEventData] = Field(default_factory=list)
    annotations: dict[str, Any] | None = None


# Recording response schemas


class RecordingBase(BaseModel):
    """Base recording information"""

    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)


class RecordingCreate(RecordingBase):
    """Create recording request"""

    project_id: str
    recording_data: RecordingUploadRequest


class RecordingUpdate(BaseModel):
    """Update recording request"""

    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None


class RecordingStats(BaseModel):
    """Recording statistics"""

    total_frames: int
    total_interactions: int
    total_context_events: int
    duration_seconds: float
    frame_rate: float
    discovered_states: int = 0
    discovered_transitions: int = 0
    discovered_workflows: int = 0


class RecordingResponse(RecordingBase):
    """Recording response"""

    id: str
    project_id: str
    created_by_id: str
    status: RecordingStatusEnum
    processing_phase: ProcessingPhaseEnum | None = None
    processing_progress: float = Field(default=0.0, ge=0.0, le=1.0)
    created_at: datetime
    updated_at: datetime
    recording_start_time: datetime
    recording_end_time: datetime
    stats: RecordingStats
    validation_errors: list[str] = Field(default_factory=list)
    validation_warnings: list[str] = Field(default_factory=list)
    confidence: float | None = None

    class Config:
        from_attributes = True


class RecordingListResponse(BaseModel):
    """List of recordings response"""

    recordings: list[RecordingResponse]
    total: int
    page: int
    page_size: int


# Frame response schemas


class FrameResponse(BaseModel):
    """Frame response"""

    id: str
    recording_id: str
    frame_number: int
    timestamp: datetime
    relative_time_ms: int
    image_url: str | None = None
    width: int
    height: int
    perceptual_hash: str | None = None
    cluster_id: int | None = None
    state_id: str | None = None
    window_title: str | None = None
    url: str | None = None

    class Config:
        from_attributes = True


# Processing job schemas


class ProcessingJobStatus(BaseModel):
    """Processing job status"""

    recording_id: str
    status: RecordingStatusEnum
    phase: ProcessingPhaseEnum | None = None
    progress: float = Field(..., ge=0.0, le=1.0)
    started_at: datetime | None = None
    estimated_completion: datetime | None = None
    error: str | None = None


class ProcessingLogEntry(BaseModel):
    """Processing log entry"""

    timestamp: datetime
    phase: ProcessingPhaseEnum
    level: str
    message: str
    data: dict[str, Any] | None = None
    progress: float | None = None

    class Config:
        from_attributes = True


# Discovered state schemas


class DiscoveredStateResponse(BaseModel):
    """Discovered state response"""

    id: str
    recording_id: str
    name: str
    description: str | None = None
    cluster_id: int | None = None
    state_images: list[dict[str, Any]] = Field(default_factory=list)
    regions: list[dict[str, Any]] = Field(default_factory=list)
    locations: list[dict[str, Any]] = Field(default_factory=list)
    strings: list[dict[str, Any]] = Field(default_factory=list)
    frame_count: int
    position_x: float | None = None
    position_y: float | None = None
    is_initial: bool = False
    is_error_state: bool = False
    confidence: float | None = None
    user_edited: bool = False
    user_approved: bool = False
    converted_to_state_id: str | None = None

    class Config:
        from_attributes = True


# Discovered transition schemas


class DiscoveredTransitionResponse(BaseModel):
    """Discovered transition response"""

    id: str
    recording_id: str
    from_state_id: str
    to_state_id: str | None = None
    activate_state_ids: list[str] = Field(default_factory=list)
    deactivate_state_ids: list[str] = Field(default_factory=list)
    stays_visible: bool = False
    trigger_type: str | None = None
    trigger_description: str | None = None
    latency_ms: int | None = None
    recommended_timeout_ms: int | None = None
    workflow: dict[str, Any] | None = None
    workflow_name: str | None = None
    confidence: float | None = None
    user_edited: bool = False
    user_approved: bool = False
    converted_to_transition_id: str | None = None

    class Config:
        from_attributes = True


# State structure response


class DiscoveredStateStructure(BaseModel):
    """Complete discovered state structure"""

    recording_id: str
    states: list[DiscoveredStateResponse]
    transitions: list[DiscoveredTransitionResponse]
    stats: dict[str, Any]
    confidence: float | None = None


# Review and acceptance schemas


class StateReviewUpdate(BaseModel):
    """Update for state review"""

    user_approved: bool
    user_notes: str | None = None
    modifications: dict[str, Any] | None = None


class TransitionReviewUpdate(BaseModel):
    """Update for transition review"""

    user_approved: bool
    user_notes: str | None = None
    modifications: dict[str, Any] | None = None


class AcceptanceRequest(BaseModel):
    """Request to accept discovered structure"""

    action: str = Field(..., pattern="^(accept|accept_selected|modify|discard)$")
    selected_state_ids: list[str] | None = None
    selected_transition_ids: list[str] | None = None
    modifications: dict[str, Any] | None = None


class AcceptanceResponse(BaseModel):
    """Response after accepting discovered structure"""

    success: bool
    message: str
    created_states: list[str] = Field(default_factory=list)
    created_transitions: list[str] = Field(default_factory=list)
    created_workflows: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# Upload response


class UploadResponse(BaseModel):
    """Response after upload"""

    success: bool
    recording_id: str
    uploaded_at: datetime
    size_bytes: int
    frame_count: int
    interaction_count: int
    status: RecordingStatusEnum
    validation_errors: list[str] = Field(default_factory=list)
    validation_warnings: list[str] = Field(default_factory=list)
    message: str | None = None


# Error response


class RecordingError(BaseModel):
    """Error response"""

    success: bool = False
    error: str
    message: str
    details: dict[str, Any] | None = None
