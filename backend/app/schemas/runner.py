"""
Pydantic schemas for runner token management.

These schemas handle validation and serialization for runner tokens
and connection tracking.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime


class RunnerTokenCreate(BaseModel):
    """Schema for creating a new runner token."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="User-friendly name for this token (e.g., 'My Laptop', 'Work Desktop')"
    )

    expires_in_days: int | None = Field(
        default=None,
        ge=1,
        le=365,
        description="Number of days until token expires. None = never expires"
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate and clean the token name."""
        v = v.strip()
        if not v:
            raise ValueError("Token name cannot be empty or whitespace only")
        return v


class RunnerTokenResponse(BaseModel):
    """Schema for returning runner token information (without the actual token)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    created_at: IsoDatetime
    expires_at: IsoDatetime | None
    last_used_at: IsoDatetime | None
    is_revoked: bool
    last_ip_address: str | None
    connection_count: int = Field(
        default=0,
        description="Total number of connections made with this token"
    )


class RunnerTokenWithSecret(RunnerTokenResponse):
    """
    Schema for returning a newly created token with the actual token value.

    WARNING: The token is only shown ONCE during creation and never again!
    """

    token: str = Field(
        ...,
        description="The actual token value. Save this securely - it will never be shown again!"
    )


class RunnerConnectionResponse(BaseModel):
    """Schema for returning runner connection information."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    runner_token_id: UUID
    runner_name: str = Field(
        ...,
        description="Name of the runner token used for this connection"
    )
    connected_at: IsoDatetime
    disconnected_at: IsoDatetime | None
    duration_seconds: int | None
    ip_address: str | None
    project_id: int | None


class RunnerConnectionHistory(BaseModel):
    """Schema for paginated connection history."""

    connections: list[RunnerConnectionResponse]
    total: int = Field(
        ...,
        description="Total number of connections (across all pages)"
    )
    active_count: int = Field(
        ...,
        description="Number of currently active connections"
    )
    limit: int
    offset: int


class RunnerTokenUpdate(BaseModel):
    """Schema for updating runner token (e.g., rename)."""

    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="New name for the token"
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        """Validate and clean the token name."""
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Token name cannot be empty or whitespace only")
        return v


class RunnerTokenStats(BaseModel):
    """Schema for runner token usage statistics."""

    total_tokens: int
    active_tokens: int
    revoked_tokens: int
    expired_tokens: int
    total_connections: int
    active_connections: int
    most_recent_connection: IsoDatetime | None
