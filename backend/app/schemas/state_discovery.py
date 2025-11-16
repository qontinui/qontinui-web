"""
State Discovery schemas for automation session analysis.

Provides Pydantic models for state discovery API responses.
"""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import BaseORMSchema, IsoDatetime


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
    input_events: list[int] = Field(
        default_factory=list, description="Input events that occurred in this state"
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
    status: str = Field(..., description="Discovery status (pending, processing, completed, failed)")
    message: str | None = Field(None, description="Status message or error")
    started_at: IsoDatetime | None = Field(None, description="When discovery started")
    completed_at: IsoDatetime | None = Field(None, description="When discovery completed")
