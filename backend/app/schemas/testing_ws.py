"""
Pydantic schemas for testing WebSocket messages.

Defines message types for real-time test execution streaming from
qontinui-runner to qontinui-web backend.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ============================================================================
# Base WebSocket Message Schema
# ============================================================================


class WSTestMessage(BaseModel):
    """Base WebSocket message for testing events."""

    type: str = Field(..., description="Message type")
    data: dict = Field(default_factory=dict, description="Message payload")


# ============================================================================
# Session Management Messages
# ============================================================================


class SessionStartData(BaseModel):
    """Data for session_start message."""

    project_id: UUID = Field(..., description="Project ID")
    workflow_id: str | None = Field(None, description="Workflow identifier")
    test_mode: str | None = Field(
        None, description="exploration, regression, coverage, stress"
    )
    max_duration_seconds: int = Field(
        default=3600, description="Maximum test duration in seconds"
    )
    seed_value: str | None = Field(
        None, description="For reproducible random exploration"
    )
    configuration_snapshot: dict = Field(
        default_factory=dict, description="Test configuration snapshot"
    )
    runner_metadata: dict = Field(
        default_factory=dict, description="Runner environment metadata"
    )


class SessionEndData(BaseModel):
    """Data for session_end message."""

    status: str = Field(..., description="Final test run status")
    error_summary: str | None = Field(None, description="Error summary if failed")
    total_transitions: int = Field(default=0, description="Total transitions executed")
    successful_transitions: int = Field(
        default=0, description="Successful transitions"
    )
    failed_transitions: int = Field(default=0, description="Failed transitions")
    skipped_transitions: int = Field(default=0, description="Skipped transitions")
    coverage_percentage: float = Field(
        default=0.0, description="Coverage percentage", ge=0.0, le=100.0
    )
    unique_paths_found: int = Field(default=0, description="Unique paths discovered")
    unique_states_visited: int = Field(default=0, description="Unique states visited")
    deficiencies_found: int = Field(default=0, description="Deficiencies found")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = ["completed", "failed", "cancelled", "timeout"]
        if v not in allowed:
            raise ValueError(f"Status must be one of: {', '.join(allowed)}")
        return v


# ============================================================================
# Transition Execution Messages
# ============================================================================


class TransitionStartedData(BaseModel):
    """Data for transition_started message."""

    transition_id: str = Field(..., description="Transition identifier")
    transition_name: str | None = Field(None, description="Human-readable name")
    sequence_number: int = Field(..., description="Sequence number in test run", ge=1)
    source_state: str | None = Field(None, description="Source state")
    target_state: str | None = Field(None, description="Target state")
    timestamp: datetime = Field(..., description="Start timestamp")


class TransitionCompletedData(BaseModel):
    """Data for transition_completed message."""

    transition_id: str = Field(..., description="Transition identifier")
    sequence_number: int = Field(..., description="Sequence number in test run", ge=1)
    status: str = Field(..., description="Transition execution status")
    timestamp: datetime = Field(..., description="Completion timestamp")
    execution_time_ms: int = Field(..., description="Execution time in milliseconds")
    actual_state: str | None = Field(None, description="Actual ending state")
    state_match: bool | None = Field(
        None, description="Whether actual state matched expected"
    )
    error_type: str | None = Field(None, description="Error type if failed")
    error_message: str | None = Field(None, description="Error message if failed")
    error_stacktrace: str | None = Field(None, description="Error stacktrace if failed")
    input_data: dict = Field(
        default_factory=dict, description="Input data/context at start"
    )
    output_data: dict = Field(
        default_factory=dict, description="Output data/context at end"
    )
    action_count: int = Field(default=0, description="Number of actions executed")
    retry_count: int = Field(default=0, description="Number of retries")
    metadata: dict = Field(default_factory=dict, description="Additional metadata")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = ["success", "failed", "timeout", "skipped", "error"]
        if v not in allowed:
            raise ValueError(f"Status must be one of: {', '.join(allowed)}")
        return v


# ============================================================================
# Screenshot Messages
# ============================================================================


class ScreenshotData(BaseModel):
    """Data for screenshot message."""

    image: str = Field(..., description="Base64-encoded image data")
    transition_id: str | None = Field(None, description="Associated transition ID")
    sequence_number: int | None = Field(
        None, description="Associated transition sequence number"
    )
    timestamp: datetime = Field(..., description="Screenshot timestamp")
    metadata: dict = Field(
        default_factory=dict,
        description="Metadata (content_type, width, height, etc.)",
    )


# ============================================================================
# Deficiency Messages
# ============================================================================


class DeficiencyData(BaseModel):
    """Data for deficiency message."""

    transition_id: str | None = Field(None, description="Associated transition ID")
    sequence_number: int | None = Field(
        None, description="Associated transition sequence number"
    )
    severity: str = Field(..., description="Deficiency severity")
    deficiency_type: str = Field(..., description="Deficiency type")
    title: str = Field(..., description="Deficiency title", max_length=500)
    description: str = Field(..., description="Detailed description")
    reproduction_steps: list[str] = Field(
        default_factory=list, description="Steps to reproduce"
    )
    screenshot_ids: list[UUID] = Field(
        default_factory=list, description="Associated screenshot IDs"
    )
    environment_info: dict = Field(
        default_factory=dict, description="Environment information"
    )
    preconditions: dict = Field(default_factory=dict, description="Required setup")
    tags: list[str] = Field(default_factory=list, description="Tags")
    custom_fields: dict = Field(
        default_factory=dict, description="Custom metadata fields"
    )

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        allowed = ["critical", "high", "medium", "low", "info"]
        if v not in allowed:
            raise ValueError(f"Severity must be one of: {', '.join(allowed)}")
        return v

    @field_validator("deficiency_type")
    @classmethod
    def validate_deficiency_type(cls, v: str) -> str:
        allowed = [
            "crash",
            "timeout",
            "visual",
            "functional",
            "performance",
            "data",
            "accessibility",
            "security",
        ]
        if v not in allowed:
            raise ValueError(f"Deficiency type must be one of: {', '.join(allowed)}")
        return v


# ============================================================================
# Response Messages (Server -> Client)
# ============================================================================


class SessionStartedResponse(BaseModel):
    """Response for session_start message."""

    type: str = Field(default="session_started", description="Response type")
    test_run_id: UUID = Field(..., description="Created test run ID")
    timestamp: str = Field(..., description="ISO timestamp")


class TransitionStartedResponse(BaseModel):
    """Response for transition_started message."""

    type: str = Field(default="transition_started_ack", description="Response type")
    transition_execution_id: UUID = Field(..., description="Created execution record ID")
    timestamp: str = Field(..., description="ISO timestamp")


class TransitionCompletedResponse(BaseModel):
    """Response for transition_completed message."""

    type: str = Field(default="transition_completed_ack", description="Response type")
    transition_execution_id: UUID = Field(..., description="Updated execution record ID")
    timestamp: str = Field(..., description="ISO timestamp")


class ScreenshotStoredResponse(BaseModel):
    """Response for screenshot message."""

    type: str = Field(default="screenshot_stored", description="Response type")
    screenshot_id: UUID = Field(..., description="Stored screenshot ID")
    timestamp: str = Field(..., description="ISO timestamp")


class DeficiencyRecordedResponse(BaseModel):
    """Response for deficiency message."""

    type: str = Field(default="deficiency_recorded", description="Response type")
    deficiency_id: UUID = Field(..., description="Created deficiency ID")
    timestamp: str = Field(..., description="ISO timestamp")


class SessionEndedResponse(BaseModel):
    """Response for session_end message."""

    type: str = Field(default="session_ended", description="Response type")
    test_run_id: UUID = Field(..., description="Completed test run ID")
    status: str = Field(..., description="Final status")
    timestamp: str = Field(..., description="ISO timestamp")


class ErrorResponse(BaseModel):
    """Error response message."""

    type: str = Field(default="error", description="Response type")
    message: str = Field(..., description="Error message")
    timestamp: str = Field(..., description="ISO timestamp")
