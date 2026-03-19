"""Schemas for unified state discovery results.

This module re-exports core schemas from qontinui-schemas and adds
backend-specific schemas with UUID and datetime handling.
"""

from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import IsoDatetime

# Re-export core schemas from qontinui-schemas
from qontinui_schemas.discovery import (
    SOURCE_TYPE_LABELS,
    DiscoveredState,
    DiscoveredStateImage,
    DiscoveredTransition,
    DiscoveryBoundingBox,
    DiscoverySourceType,
    DiscoveryTransitionTrigger,
    StateMachineExport,
    StateMachineImport,
    TransitionTriggerType,
)

# Aliases for backward compatibility
BoundingBox = DiscoveryBoundingBox
StateImage = DiscoveredStateImage
StateTransition = DiscoveredTransition
TransitionTrigger = DiscoveryTransitionTrigger


# =============================================================================
# Backend-Specific API Schemas (with UUID handling)
# =============================================================================


class StateDiscoveryResultCreate(BaseModel):
    """Schema for creating a state discovery result."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    source_type: DiscoverySourceType
    source_session_id: UUID | None = None
    discovery_strategy: str | None = None
    images: list[DiscoveredStateImage] = Field(default_factory=list)
    states: list[DiscoveredState] = Field(default_factory=list)
    transitions: list[DiscoveredTransition] = Field(default_factory=list)
    element_to_renders: dict[str, list[str]] = Field(default_factory=dict)
    confidence: float = 0.0
    discovery_metadata: dict = Field(default_factory=dict)


class StateDiscoveryResultUpdate(BaseModel):
    """Schema for updating a state discovery result."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    images: list[DiscoveredStateImage] | None = None
    states: list[DiscoveredState] | None = None
    transitions: list[DiscoveredTransition] | None = None
    discovery_metadata: dict | None = None


class StateDiscoveryResultResponse(BaseModel):
    """Schema for state discovery result response."""

    id: UUID
    project_id: UUID
    name: str
    description: str | None
    source_type: str
    source_session_id: UUID | None
    discovery_strategy: str | None
    images: list[dict]  # StateImage as dict for flexibility
    states: list[dict]  # DiscoveredState as dict
    transitions: list[dict]  # StateTransition as dict
    element_to_renders: dict
    image_count: int
    state_count: int
    transition_count: int
    render_count: int
    unique_element_count: int
    confidence: float
    discovery_metadata: dict
    created_at: IsoDatetime
    updated_at: IsoDatetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class StateDiscoveryResultSummary(BaseModel):
    """Summary schema for listing discovery results."""

    id: UUID
    project_id: UUID
    name: str
    description: str | None
    source_type: str
    discovery_strategy: str | None
    image_count: int
    state_count: int
    transition_count: int
    confidence: float
    created_at: IsoDatetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class StateDiscoveryResultListResponse(BaseModel):
    """Schema for listing state discovery results."""

    items: list[StateDiscoveryResultSummary]
    total: int


# Re-export for convenience
__all__ = [
    # From qontinui-schemas
    "DiscoverySourceType",
    "TransitionTriggerType",
    "DiscoveryBoundingBox",
    "DiscoveryTransitionTrigger",
    "DiscoveredStateImage",
    "DiscoveredState",
    "DiscoveredTransition",
    "StateMachineExport",
    "StateMachineImport",
    "SOURCE_TYPE_LABELS",
    # Aliases
    "BoundingBox",
    "StateImage",
    "StateTransition",
    "TransitionTrigger",
    # Backend-specific
    "StateDiscoveryResultCreate",
    "StateDiscoveryResultUpdate",
    "StateDiscoveryResultResponse",
    "StateDiscoveryResultSummary",
    "StateDiscoveryResultListResponse",
]
