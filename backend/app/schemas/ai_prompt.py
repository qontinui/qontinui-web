"""
Pydantic schemas for AI prompt template and sequence management.

Provides request/response models for the AI prompt library API.
"""

from typing import Any
from uuid import UUID

from app.schemas.base import IsoDatetime
from pydantic import BaseModel, ConfigDict, Field

# ===== AI Prompt Template Schemas =====


class AIPromptTemplateBase(BaseModel):
    """Base AI prompt template schema."""

    id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    category: str | None = Field(None, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)


class AIPromptTemplateCreate(AIPromptTemplateBase):
    """Schema for creating an AI prompt template."""

    prompt: str = Field(..., min_length=1)
    parameters: list[dict[str, Any]] = Field(
        default_factory=list, description="List of PromptParameter dicts"
    )
    default_timeout: int | None = Field(600000, ge=1000, le=3600000)
    default_working_directory: str | None = None


class AIPromptTemplateUpdate(BaseModel):
    """Schema for updating AI prompt template."""

    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    category: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=20)
    prompt: str | None = Field(None, min_length=1)
    parameters: list[dict[str, Any]] | None = None
    default_timeout: int | None = Field(None, ge=1000, le=3600000)
    default_working_directory: str | None = None


class AIPromptTemplateResponse(AIPromptTemplateBase):
    """Schema for reading AI prompt template data."""

    project_id: UUID
    created_by: UUID
    prompt: str
    parameters: list[dict[str, Any]]
    default_timeout: int | None
    default_working_directory: str | None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class AIPromptTemplateSummary(BaseModel):
    """Lightweight template summary (for list views)."""

    id: str
    project_id: UUID
    name: str
    description: str | None
    category: str | None
    tags: list[str]
    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


# ===== Prompt Sequence Schemas =====


class PromptSequenceBase(BaseModel):
    """Base prompt sequence schema."""

    id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    category: str | None = Field(None, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)


class PromptSequenceCreate(PromptSequenceBase):
    """Schema for creating a prompt sequence."""

    steps: list[dict[str, Any]] = Field(
        ..., min_length=1, description="List of PromptSequenceStep dicts"
    )
    on_failure: str = Field("stop", pattern="^(stop|continue|retry)$")
    max_retries: int = Field(0, ge=0, le=10)
    results_directory: str | None = None
    default_timeout: int | None = Field(600000, ge=1000, le=3600000)


class PromptSequenceUpdate(BaseModel):
    """Schema for updating prompt sequence."""

    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    category: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=20)
    steps: list[dict[str, Any]] | None = Field(None, min_length=1)
    on_failure: str | None = Field(None, pattern="^(stop|continue|retry)$")
    max_retries: int | None = Field(None, ge=0, le=10)
    results_directory: str | None = None
    default_timeout: int | None = Field(None, ge=1000, le=3600000)


class PromptSequenceResponse(PromptSequenceBase):
    """Schema for reading prompt sequence data."""

    project_id: UUID
    created_by: UUID
    steps: list[dict[str, Any]]
    on_failure: str
    max_retries: int
    results_directory: str | None
    default_timeout: int | None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class PromptSequenceSummary(BaseModel):
    """Lightweight sequence summary (for list views)."""

    id: str
    project_id: UUID
    name: str
    description: str | None
    category: str | None
    tags: list[str]
    steps_count: int = Field(..., description="Number of steps in sequence")
    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


# ===== List Response Schemas =====


class AIPromptTemplateListResponse(BaseModel):
    """Paginated list of AI prompt templates."""

    templates: list[AIPromptTemplateSummary]
    total: int
    limit: int
    offset: int
    has_more: bool


class PromptSequenceListResponse(BaseModel):
    """Paginated list of prompt sequences."""

    sequences: list[PromptSequenceSummary]
    total: int
    limit: int
    offset: int
    has_more: bool


# ===== Statistics Schemas =====


class PromptLibraryStats(BaseModel):
    """Statistics for AI prompt library in a project."""

    total_templates: int
    total_sequences: int
    categories: list[str]
    tags: list[str]
