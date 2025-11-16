"""
State Discovery schemas for automation session analysis.

Provides Pydantic models for state discovery API responses.
"""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import BaseORMSchema, IsoDatetime


class StateDiscoveryConfig(BaseModel):
    """Configuration for state discovery analysis."""

    similarity_threshold: float = Field(
        default=0.90,
        description="Similarity threshold for considering regions as same state",
        ge=0.0,
        le=1.0,
    )
    min_region_size: tuple[int, int] = Field(
        default=(20, 20),
        description="Minimum region size (width, height) in pixels",
    )
    stability_threshold: float = Field(
        default=0.95,
        description="Minimum stability score to consider a region stable",
        ge=0.0,
        le=1.0,
    )
    cooccurrence_threshold: float = Field(
        default=0.80,
        description="Threshold for co-occurrence to group regions",
        ge=0.0,
        le=1.0,
    )
    max_screenshots: int | None = Field(
        default=None,
        description="Maximum number of screenshots to process (for large sessions)",
    )


class StateImageSchema(BaseModel):
    """Represents a stable visual region within a state."""

    id: str = Field(..., description="Unique identifier for this state image")
    name: str = Field(..., description="Human-readable name for the state image")
    x: int = Field(..., description="X coordinate of region")
    y: int = Field(..., description="Y coordinate of region")
    width: int = Field(..., description="Width of region")
    height: int = Field(..., description="Height of region")
    pixel_hash: str = Field(..., description="Hash of the pixel data")
    stability_score: float = Field(
        ...,
        description="Stability score (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )
    screenshots: list[str] = Field(
        default_factory=list,
        description="Screenshot IDs where this region appears",
    )


class StateTransition(BaseModel):
    """Represents a transition from one state to another."""

    from_state_id: str = Field(..., description="Source state ID")
    to_state_id: str = Field(..., description="Destination state ID")
    trigger_event_id: int | None = Field(
        None, description="Input event that triggered the transition"
    )
    event_type: str | None = Field(None, description="Type of triggering event")
    timestamp: IsoDatetime = Field(..., description="When the transition occurred")
    confidence: float = Field(
        default=1.0,
        description="Confidence score for this transition (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )


class DiscoveredState(BaseModel):
    """Represents a discovered state in the automation session."""

    state_id: str = Field(..., description="Unique state identifier")
    name: str | None = Field(None, description="User-defined or auto-generated name")
    screenshot_ids: list[int] = Field(
        default_factory=list, description="Screenshots associated with this state"
    )
    representative_screenshot_id: int | None = Field(
        None, description="Primary screenshot representing this state"
    )
    timestamp_first_seen: IsoDatetime = Field(
        ..., description="First time this state was observed"
    )
    timestamp_last_seen: IsoDatetime = Field(
        ..., description="Last time this state was observed"
    )
    visit_count: int = Field(default=1, description="Number of times state was visited")
    confidence: float = Field(
        default=1.0,
        description="Confidence score for this state (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )
    input_events: list[int] = Field(
        default_factory=list, description="Input events that occurred in this state"
    )
    state_images: list[StateImageSchema] = Field(
        default_factory=list,
        description="Stable visual regions that define this state",
    )
    outgoing_transitions: list[StateTransition] = Field(
        default_factory=list, description="Transitions from this state to others"
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional state metadata"
    )


class StateDiscoveryResponse(BaseModel):
    """Response for state discovery operation."""

    session_id: UUID = Field(..., description="Automation session ID")
    total_states: int = Field(..., description="Total number of discovered states")
    total_transitions: int = Field(..., description="Total number of state transitions")
    states: list[DiscoveredState] = Field(
        default_factory=list, description="Discovered states"
    )
    algorithm: str = Field(
        default="timestamp_clustering",
        description="Algorithm used for state discovery",
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict, description="Algorithm parameters used"
    )
    processing_time_ms: float | None = Field(
        None, description="Time taken to process in milliseconds"
    )


class StateDiscoveryTriggerRequest(BaseModel):
    """Request to trigger state discovery."""

    algorithm: str = Field(
        default="timestamp_clustering",
        description="Algorithm to use for state discovery",
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict, description="Algorithm-specific parameters"
    )


class StateDiscoveryStatus(BaseModel):
    """Status of a state discovery operation."""

    session_id: UUID = Field(..., description="Automation session ID")
    status: str = Field(
        ...,
        description="Discovery status (pending, processing, completed, failed)",
    )
    message: str | None = Field(None, description="Status message or error")
    started_at: IsoDatetime | None = Field(None, description="When discovery started")
    completed_at: IsoDatetime | None = Field(
        None, description="When discovery completed"
    )
    error: str | None = Field(None, description="Error message if status is failed")


class StateUpdateRequest(BaseModel):
    """Request to update a discovered state."""

    name: str | None = Field(None, description="New name for the state")
    metadata: dict[str, Any] | None = Field(
        None, description="Updated metadata for the state"
    )


class StateTransitionSchema(BaseModel):
    """Schema for state transitions with database IDs."""

    id: UUID | None = Field(None, description="Database ID of the transition")
    from_state_id: UUID = Field(..., description="Source state database ID")
    to_state_id: UUID = Field(..., description="Destination state database ID")
    trigger_event_id: int | None = Field(
        None, description="Input event that triggered the transition"
    )
    event_type: str | None = Field(None, description="Type of triggering event")
    confidence: float = Field(
        default=1.0,
        description="Confidence score for this transition (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )
    timestamp: IsoDatetime = Field(..., description="When the transition occurred")
