"""Schemas for UI Bridge state discovery and persistence."""

from datetime import datetime
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
# Discovery and Save Request
# =============================================================================


class UIBridgeDiscoverAndSaveRequest(BaseModel):
    """Request to discover states from renders and save to database."""

    config_name: str = Field(default="default", min_length=1, max_length=255)
    config_description: str | None = None
    renders: list[dict] = Field(
        ..., description="List of render log entries to analyze"
    )
    include_html_ids: bool = Field(
        default=False, description="Whether to include HTML id attributes as elements"
    )


class UIBridgeDiscoverAndSaveResponse(BaseModel):
    """Response from discover and save operation."""

    config: UIBridgeStateConfigResponse
    states: list[UIBridgeStateResponse]
    render_count: int
    unique_element_count: int
