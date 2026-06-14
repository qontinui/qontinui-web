"""Pydantic schemas for org-scoped auto-response rules."""

import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime


class BackoffConfig(BaseModel):
    """Exponential backoff schedule for a rule's auto-continue retries."""

    initial_delay_secs: int = Field(ge=0)
    multiplier: float = Field(ge=1.0)
    # ``None`` = unbounded (no cap on the delay between retries).
    max_delay_secs: int | None = Field(default=None, ge=0)


class AutoResponseRuleCreate(BaseModel):
    """Schema for creating an auto-response rule."""

    name: str = Field(..., min_length=1, max_length=200)
    pattern: str = Field(..., min_length=1, max_length=1000)
    prompt: str = Field(..., min_length=1)
    enabled: bool = True
    backoff: BackoffConfig

    @field_validator("pattern")
    @classmethod
    def _validate_pattern(cls, v: str) -> str:
        """Reject patterns that are not valid Python regexes (→ 422)."""
        try:
            re.compile(v)
        except re.error as exc:
            raise ValueError(f"Invalid regex pattern: {exc}") from exc
        return v


class AutoResponseRuleUpdate(BaseModel):
    """Schema for partially updating an auto-response rule (PUT)."""

    name: str | None = Field(None, min_length=1, max_length=200)
    pattern: str | None = Field(None, min_length=1, max_length=1000)
    prompt: str | None = Field(None, min_length=1)
    enabled: bool | None = None
    sort_order: int | None = Field(None, ge=0)
    backoff: BackoffConfig | None = None

    @field_validator("pattern")
    @classmethod
    def _validate_pattern(cls, v: str | None) -> str | None:
        """Reject patterns that are not valid Python regexes (→ 422)."""
        if v is None:
            return v
        try:
            re.compile(v)
        except re.error as exc:
            raise ValueError(f"Invalid regex pattern: {exc}") from exc
        return v


class AutoResponseRuleResponse(BaseModel):
    """Full auto-response rule row."""

    id: UUID
    organization_id: UUID
    name: str
    pattern: str
    prompt: str
    enabled: bool
    is_built_in: bool
    sort_order: int
    backoff: BackoffConfig
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class AutoResponseRuleListResponse(BaseModel):
    """List of auto-response rules for an organization."""

    items: list[AutoResponseRuleResponse]
    count: int


class AutoResponseRuleReorder(BaseModel):
    """Reorder request — the desired ordering of rule ids."""

    ordered_ids: list[UUID]


class RunnerRule(BaseModel):
    """Slim rule projection served to runners (enabled rules only)."""

    id: UUID
    name: str
    pattern: str
    prompt: str
    backoff: BackoffConfig

    model_config = ConfigDict(from_attributes=True)


class RunnerRulesResponse(BaseModel):
    """Response for the device-JWT runner rules endpoint."""

    rules: list[RunnerRule]
    updated_at: IsoDatetime
    etag: str
