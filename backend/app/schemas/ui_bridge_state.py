"""Schemas for UI Bridge state discovery and persistence."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

# =============================================================================
# Domain Knowledge Schemas
# =============================================================================


class DomainKnowledgeCreate(BaseModel):
    """Schema for creating domain knowledge."""

    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    tags: list[str] = Field(default_factory=list)


class DomainKnowledgeUpdate(BaseModel):
    """Schema for updating domain knowledge."""

    title: str | None = Field(None, min_length=1, max_length=255)
    content: str | None = Field(None, min_length=1)
    tags: list[str] | None = None


class DomainKnowledgeResponse(BaseModel):
    """Schema for domain knowledge response."""

    id: UUID
    project_id: UUID | None
    title: str
    content: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class DomainKnowledgeListResponse(BaseModel):
    """Schema for listing domain knowledge."""

    items: list[DomainKnowledgeResponse]
    total: int


# =============================================================================
# UI Bridge State Schemas
# =============================================================================


class UIBridgeStateCreate(BaseModel):
    """Schema for creating a UI Bridge state."""

    state_id: str = Field(..., description="State identifier from discovery")
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    element_ids: list[str] = Field(default_factory=list)
    render_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    acceptance_criteria: list[str] = Field(default_factory=list)
    extra_metadata: dict = Field(default_factory=dict)


class UIBridgeStateUpdate(BaseModel):
    """Schema for updating a UI Bridge state."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    acceptance_criteria: list[str] | None = None
    extra_metadata: dict | None = None


class UIBridgeStateDomainKnowledgeLink(BaseModel):
    """Schema for linking domain knowledge to a state."""

    knowledge_id: UUID
    order: int = 0


class UIBridgeStateResponse(BaseModel):
    """Schema for UI Bridge state response."""

    id: UUID
    config_id: UUID
    state_id: str
    name: str
    description: str | None
    element_ids: list[str]
    render_ids: list[str]
    confidence: float
    acceptance_criteria: list[str]
    extra_metadata: dict
    created_at: datetime
    updated_at: datetime
    domain_knowledge: list[DomainKnowledgeResponse] = Field(default_factory=list)

    class Config:
        """Pydantic model config."""

        from_attributes = True


class UIBridgeStateListResponse(BaseModel):
    """Schema for listing UI Bridge states."""

    items: list[UIBridgeStateResponse]
    total: int


# =============================================================================
# UI Bridge State Config Schemas
# =============================================================================


class UIBridgeStateConfigCreate(BaseModel):
    """Schema for creating a UI Bridge state config."""

    name: str = Field(default="default", min_length=1, max_length=255)
    description: str | None = None
    include_html_ids: bool = False


class UIBridgeStateConfigUpdate(BaseModel):
    """Schema for updating a UI Bridge state config."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class UIBridgeStateConfigResponse(BaseModel):
    """Schema for UI Bridge state config response."""

    id: UUID
    project_id: UUID
    name: str
    description: str | None
    render_count: int
    element_count: int
    include_html_ids: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class UIBridgeStateConfigWithStates(UIBridgeStateConfigResponse):
    """Schema for UI Bridge state config with states."""

    states: list[UIBridgeStateResponse] = Field(default_factory=list)


class UIBridgeStateConfigListResponse(BaseModel):
    """Schema for listing UI Bridge state configs."""

    items: list[UIBridgeStateConfigResponse]
    total: int


# =============================================================================
# UI Bridge Transition Schemas
# =============================================================================


class UIBridgeTransitionActionCreate(BaseModel):
    """Schema for a transition action.

    Supports all UI Bridge SDK standard actions:
      click, doubleClick, rightClick, type, clear, select, focus, blur,
      hover, scroll, check, uncheck, toggle, setValue, drag, submit, reset

    Plus workflow-level actions: wait, navigate
    """

    type: str = Field(
        ...,
        description=(
            "Action type. SDK element actions: click, doubleClick, rightClick, "
            "type, clear, select, focus, blur, hover, scroll, check, uncheck, "
            "toggle, setValue, drag, submit, reset. "
            "Workflow actions: wait, navigate"
        ),
    )
    target: str | None = Field(None, description="Target element ID")

    # type action
    text: str | None = Field(None, description="Text to type (type action)")
    clear_first: bool | None = Field(
        None, description="Clear existing value before typing (type action)"
    )
    type_delay: int | None = Field(
        None, description="Delay between keystrokes in ms (type action)"
    )

    # select / setValue actions
    value: str | list[str] | None = Field(
        None, description="Value(s) to select or set (select / setValue actions)"
    )
    select_by_label: bool | None = Field(
        None, description="Select by label instead of value (select action)"
    )

    # navigate action
    url: str | None = Field(None, description="URL to navigate to (navigate action)")

    # wait action
    delay_ms: int | None = Field(
        None, description="Delay in milliseconds (wait action)"
    )

    # scroll action
    scroll_direction: str | None = Field(
        None, description="Scroll direction: up, down, left, right (scroll action)"
    )
    scroll_amount: int | None = Field(
        None, description="Scroll amount in pixels (scroll action)"
    )

    # drag action
    drag_target: str | None = Field(
        None, description="Target element ID or data-ui-id to drag to (drag action)"
    )
    drag_target_position: str | None = Field(
        None,
        description="Position on target: center, top, bottom, left, right (drag action)",
    )
    drag_steps: int | None = Field(
        None, description="Number of intermediate mouse move steps (drag action)"
    )
    drag_hold_delay: int | None = Field(
        None, description="Milliseconds to hold before releasing (drag action)"
    )
    drag_html5: bool | None = Field(
        None,
        description="Dispatch HTML5 drag events alongside mouse events (drag action)",
    )

    # click / doubleClick / rightClick actions
    button: str | None = Field(
        None, description="Mouse button: left, right, middle (click actions)"
    )
    position: dict | None = Field(
        None,
        description="Click position {x, y} relative to element (click actions)",
    )


class UIBridgeTransitionCreate(BaseModel):
    """Schema for creating a UI Bridge transition."""

    name: str = Field(..., min_length=1, max_length=255)
    from_states: list[str] = Field(default_factory=list)
    activate_states: list[str] = Field(default_factory=list)
    exit_states: list[str] = Field(default_factory=list)
    actions: list[UIBridgeTransitionActionCreate] = Field(default_factory=list)
    path_cost: float = Field(default=1.0, ge=0.0)
    stays_visible: bool = False
    extra_metadata: dict = Field(default_factory=dict)


class UIBridgeTransitionUpdate(BaseModel):
    """Schema for updating a UI Bridge transition."""

    name: str | None = Field(None, min_length=1, max_length=255)
    from_states: list[str] | None = None
    activate_states: list[str] | None = None
    exit_states: list[str] | None = None
    actions: list[UIBridgeTransitionActionCreate] | None = None
    path_cost: float | None = Field(None, ge=0.0)
    stays_visible: bool | None = None
    extra_metadata: dict | None = None


class UIBridgeTransitionResponse(BaseModel):
    """Schema for UI Bridge transition response."""

    id: UUID
    config_id: UUID
    transition_id: str
    name: str
    from_states: list[str]
    activate_states: list[str]
    exit_states: list[str]
    actions: list[dict]
    path_cost: float
    stays_visible: bool
    extra_metadata: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class UIBridgeTransitionListResponse(BaseModel):
    """Schema for listing UI Bridge transitions."""

    items: list[UIBridgeTransitionResponse]
    total: int


class UIBridgeStateConfigWithStatesAndTransitions(UIBridgeStateConfigResponse):
    """Schema for UI Bridge state config with states and transitions."""

    states: list[UIBridgeStateResponse] = Field(default_factory=list)
    transitions: list[UIBridgeTransitionResponse] = Field(default_factory=list)


# =============================================================================
# Pathfinding Schemas
# =============================================================================


class PathfindingRequest(BaseModel):
    """Request for pathfinding between states."""

    from_states: list[str] = Field(..., description="Currently active state IDs")
    target_states: list[str] = Field(..., description="Target state IDs to reach")


class PathfindingStep(BaseModel):
    """A step in a pathfinding result."""

    transition_id: str
    transition_name: str
    from_states: list[str]
    activate_states: list[str]
    exit_states: list[str]
    path_cost: float


class PathfindingResponse(BaseModel):
    """Response from pathfinding endpoint."""

    found: bool
    steps: list[PathfindingStep] = Field(default_factory=list)
    total_cost: float = 0.0
    error: str | None = None


# =============================================================================
# Export Schemas
# =============================================================================


class ExportResponse(BaseModel):
    """Response from export endpoint — matches UIBridgeRuntime.from_dict() format."""

    states: dict[str, dict]
    transitions: dict[str, dict]
    config: dict


# =============================================================================
# Discovery and Save Request
# =============================================================================


class DiscoveryStrategy(StrEnum):
    """Available discovery strategy types."""

    LEGACY = "legacy"  # ID-based co-occurrence (original)
    FINGERPRINT = "fingerprint"  # Enhanced with element fingerprints
    AUTO = "auto"  # Auto-detect based on available data


class UIBridgeDiscoverAndSaveRequest(BaseModel):
    """Request to discover states from renders and save to database.

    Supports two discovery modes:
    1. Legacy (default): Uses element IDs (data-ui-id, data-testid) with co-occurrence
    2. Fingerprint: Enhanced discovery using element fingerprints for cross-page matching

    For fingerprint discovery, provide `cooccurrence_export` from the UI Bridge.
    """

    config_name: str = Field(default="default", min_length=1, max_length=255)
    config_description: str | None = None
    renders: list[dict] = Field(
        default_factory=list, description="List of render log entries to analyze"
    )
    include_html_ids: bool = Field(
        default=False, description="Whether to include HTML id attributes as elements"
    )
    cooccurrence_export: dict | None = Field(
        default=None,
        description="Co-occurrence export from UI Bridge with fingerprint data. "
        "If provided with fingerprint data, uses enhanced discovery.",
    )
    strategy: DiscoveryStrategy = Field(
        default=DiscoveryStrategy.AUTO,
        description="Discovery strategy to use. AUTO selects based on available data.",
    )


class UIBridgeDiscoverAndSaveResponse(BaseModel):
    """Response from discover and save operation."""

    config: UIBridgeStateConfigResponse
    states: list[UIBridgeStateResponse]
    render_count: int
    unique_element_count: int


# =============================================================================
# UI Bridge Exploration Session Schemas
# =============================================================================


class ExplorationSessionStatus(StrEnum):
    """Status of an exploration session."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExplorationSessionCreate(BaseModel):
    """Schema for creating an exploration session."""

    name: str | None = Field(None, max_length=255, description="Optional session name")
    target_type: str = Field(
        default="extension", description="Target type: extension, web, desktop, mobile"
    )
    target_url: str | None = Field(
        None, max_length=2048, description="Target URL for non-extension modes"
    )
    exploration_config: dict = Field(
        default_factory=dict, description="Exploration configuration"
    )


class ExplorationSessionUpdate(BaseModel):
    """Schema for updating an exploration session."""

    status: ExplorationSessionStatus | None = None
    render_logs: list[dict] | None = Field(None, description="Append render logs")
    elements_discovered: int | None = None
    elements_explored: int | None = None
    error_message: str | None = None
    discovery_completed: bool | None = None
    saved_config_id: UUID | None = None


class ExplorationSessionAppendRenders(BaseModel):
    """Schema for appending render logs to a session."""

    render_logs: list[dict] = Field(..., description="Render logs to append")
    elements_discovered: int | None = None
    elements_explored: int | None = None


class ExplorationSessionResponse(BaseModel):
    """Schema for exploration session response."""

    id: UUID
    project_id: UUID
    name: str
    status: str
    target_type: str
    target_url: str | None
    exploration_config: dict
    render_count: int
    elements_discovered: int
    elements_explored: int
    error_message: str | None
    discovery_completed: bool
    saved_config_id: UUID | None
    started_at: datetime
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class ExplorationSessionWithRenders(ExplorationSessionResponse):
    """Schema for exploration session with render logs included."""

    render_logs: list[dict] = Field(default_factory=list)


class ExplorationSessionListResponse(BaseModel):
    """Schema for listing exploration sessions."""

    items: list[ExplorationSessionResponse]
    total: int
