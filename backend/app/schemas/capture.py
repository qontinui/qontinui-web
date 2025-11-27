"""
Pydantic schemas for capture session API.

These schemas define the request/response models for the capture-to-workflow
learning system.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

# ============================================================================
# CaptureSession Schemas
# ============================================================================


class CaptureSessionCreate(BaseModel):
    """Schema for creating a new capture session."""

    name: str = Field(..., min_length=1, max_length=255, description="Session name")
    description: str | None = Field(None, description="Optional session description")
    extra_metadata: dict | None = Field(
        None,
        description="Optional metadata (runner version, OS, screen resolution, etc.)",
    )


class CaptureSessionUpdate(BaseModel):
    """Schema for updating a capture session."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    status: str | None = Field(
        None,
        pattern="^(capturing|uploading|analyzing|completed|failed|archived)$",
        description="Session status",
    )
    extra_metadata: dict | None = None


class CaptureSessionResponse(BaseModel):
    """Schema for capture session response."""

    id: UUID
    project_id: UUID
    user_id: UUID
    name: str
    description: str | None
    status: str
    extra_metadata: dict | None
    created_at: datetime
    completed_at: datetime | None
    screenshot_count: int = Field(
        0, description="Number of screenshots in this session"
    )

    model_config = {"from_attributes": True}


# ============================================================================
# CaptureScreenshot Schemas
# ============================================================================


class CaptureScreenshotCreate(BaseModel):
    """Schema for creating a screenshot within a session."""

    session_id: UUID
    sequence_number: int = Field(..., ge=0, description="Order within session")
    image_url: str = Field(..., max_length=500, description="S3/MinIO image URL")
    thumbnail_url: str | None = Field(None, max_length=500)
    width: int = Field(..., gt=0, description="Image width in pixels")
    height: int = Field(..., gt=0, description="Image height in pixels")
    extra_metadata: dict | None = Field(
        None, description="Window title, application, etc."
    )


class CaptureScreenshotUpload(BaseModel):
    """Schema for uploading a screenshot (multipart form data)."""

    session_id: UUID
    sequence_number: int = Field(..., ge=0)
    extra_metadata: dict | None = None
    # Note: actual file comes via UploadFile in the endpoint


class CaptureScreenshotResponse(BaseModel):
    """Schema for screenshot response."""

    id: UUID
    session_id: UUID
    sequence_number: int
    image_url: str
    thumbnail_url: str | None
    width: int
    height: int
    timestamp: datetime
    extra_metadata: dict | None
    analysis_status: str
    action_count: int = Field(0, description="Number of actions on this screenshot")
    detected_element_count: int = Field(0, description="Number of detected elements")

    model_config = {"from_attributes": True}


# ============================================================================
# CaptureAction Schemas
# ============================================================================


class CaptureActionCreate(BaseModel):
    """Schema for creating a user action."""

    screenshot_id: UUID
    sequence_number: int = Field(..., ge=0)
    action_type: str = Field(
        ...,
        pattern="^(click|double_click|right_click|type|key_press|scroll)$",
        description="Type of action",
    )
    x: int | None = Field(None, description="X coordinate (for click actions)")
    y: int | None = Field(None, description="Y coordinate (for click actions)")
    text: str | None = Field(None, description="Text content (for type actions)")
    key: str | None = Field(
        None, max_length=50, description="Key name (for key_press actions)"
    )
    button: str | None = Field(
        None, pattern="^(left|right|middle)$", description="Mouse button"
    )
    scroll_delta: int | None = Field(None, description="Scroll amount")
    extra_metadata: dict | None = Field(
        None, description="Duration, modifiers, cursor path, etc."
    )


class CaptureActionResponse(BaseModel):
    """Schema for action response."""

    id: UUID
    screenshot_id: UUID
    sequence_number: int
    action_type: str
    x: int | None
    y: int | None
    text: str | None
    key: str | None
    button: str | None
    scroll_delta: int | None
    timestamp: datetime
    extra_metadata: dict | None

    model_config = {"from_attributes": True}


# ============================================================================
# CaptureDetectedElement Schemas
# ============================================================================


class CaptureDetectedElementCreate(BaseModel):
    """Schema for creating a detected UI element."""

    screenshot_id: UUID
    element_type: str = Field(
        ...,
        max_length=50,
        description="Element type: button, input, text, image, checkbox, etc.",
    )
    x: int = Field(..., description="Bounding box X")
    y: int = Field(..., description="Bounding box Y")
    width: int = Field(..., gt=0, description="Bounding box width")
    height: int = Field(..., gt=0, description="Bounding box height")
    text_content: str | None = Field(None, description="OCR extracted text")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Detection confidence")
    properties: dict | None = Field(
        None, description="Color, background, font, shape, icon, etc."
    )
    visual_hash: str | None = Field(
        None, max_length=64, description="Hash for visual similarity matching"
    )


class CaptureDetectedElementResponse(BaseModel):
    """Schema for detected element response."""

    id: UUID
    screenshot_id: UUID
    element_type: str
    x: int
    y: int
    width: int
    height: int
    text_content: str | None
    confidence: float
    properties: dict | None
    visual_hash: str | None

    model_config = {"from_attributes": True}


# ============================================================================
# ScreenshotStateMatch Schemas
# ============================================================================


class ScreenshotStateMatchCreate(BaseModel):
    """Schema for creating a state match."""

    screenshot_id: UUID
    state_identifier: str = Field(
        ..., max_length=255, description="State name or ID from project config"
    )
    state_metadata: dict | None = Field(
        None, description="State name, ID, project version for reference"
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Match confidence")
    matched_elements: dict = Field(
        ..., description="Which elements matched, match percentage, etc."
    )
    is_confirmed: bool | None = Field(None, description="User review status")
    review_notes: str | None = Field(None, description="User review comments")


class ScreenshotStateMatchResponse(BaseModel):
    """Schema for state match response."""

    id: UUID
    screenshot_id: UUID
    state_identifier: str
    state_metadata: dict | None
    confidence: float
    matched_elements: dict
    is_confirmed: bool | None
    review_notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ============================================================================
# LearnedWorkflow Schemas
# ============================================================================


class LearnedWorkflowCreate(BaseModel):
    """Schema for creating a learned workflow."""

    session_id: UUID
    project_id: UUID
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    workflow_json: dict = Field(
        ..., description="Generated workflow structure (states, transitions, etc.)"
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Overall confidence")
    warnings: list | None = Field(
        None, description="Warnings/issues found during generation"
    )


class LearnedWorkflowUpdate(BaseModel):
    """Schema for updating a learned workflow."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    status: str | None = Field(
        None,
        pattern="^(draft|reviewing|approved|rejected|published)$",
        description="Workflow status",
    )
    reviewer_id: UUID | None = None
    published_info: dict | None = Field(
        None, description="Info about where workflow was published"
    )


class LearnedWorkflowResponse(BaseModel):
    """Schema for learned workflow response."""

    id: UUID
    session_id: UUID
    project_id: UUID
    name: str
    description: str | None
    workflow_json: dict
    confidence: float
    status: str
    warnings: list | None
    created_at: datetime
    reviewed_at: datetime | None
    reviewer_id: UUID | None
    published_info: dict | None

    model_config = {"from_attributes": True}


# ============================================================================
# Batch Operations
# ============================================================================


class BatchActionCreate(BaseModel):
    """Schema for batch creating actions."""

    actions: list[CaptureActionCreate] = Field(
        ..., description="Batch of actions to create", max_length=1000
    )


class BatchDetectedElementCreate(BaseModel):
    """Schema for batch creating detected elements."""

    elements: list[CaptureDetectedElementCreate] = Field(
        ..., description="Batch of elements to create", max_length=1000
    )


# ============================================================================
# Analysis Request Schemas
# ============================================================================


class AnalyzeSessionRequest(BaseModel):
    """Schema for requesting session analysis."""

    session_id: UUID
    detect_elements: bool = Field(
        True, description="Run element detection on screenshots"
    )
    match_states: bool = Field(True, description="Match screenshots to known states")
    generate_workflow: bool = Field(
        False, description="Automatically generate workflow (experimental)"
    )
    analysis_config: dict | None = Field(None, description="Custom analysis parameters")


class AnalyzeSessionResponse(BaseModel):
    """Schema for analysis response."""

    session_id: UUID
    status: str = Field(..., description="Analysis status")
    detected_elements_count: int = 0
    state_matches_count: int = 0
    workflow_generated: bool = False
    warnings: list[str] = Field(default_factory=list)
    progress: float = Field(0.0, ge=0.0, le=1.0, description="Analysis progress")
