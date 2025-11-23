"""
Pydantic schemas for workflow variables.

Provides schemas for managing the three-tier variable system:
- Global variables (project-scoped)
- Workflow variables (workflow-scoped)
- Variable history tracking
"""

from enum import Enum
from typing import Annotated, Any
from uuid import UUID

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime
from pydantic import Field, field_validator
from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator

# Custom type for UUID as string (consistent with project.py pattern)
UuidAsString = Annotated[
    str,
    BeforeValidator(lambda v: str(v) if v is not None else None),
    PlainSerializer(lambda v: str(v) if v is not None else None, return_type=str),
]


class VariableScope(str, Enum):
    """Variable scope enumeration."""

    GLOBAL = "GLOBAL"
    WORKFLOW = "WORKFLOW"


class VariableBase(BaseSchema):
    """Base schema for variable data."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Variable name (alphanumeric and underscore only)",
    )
    value: Any = Field(..., description="Variable value (must be JSON-serializable)")
    description: str | None = Field(
        None, max_length=1000, description="Optional variable description"
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Validate variable name contains only alphanumeric characters and underscores."""
        if not v.replace("_", "").isalnum():
            raise ValueError(
                "Variable name must contain only alphanumeric characters and underscores"
            )
        return v


class VariableCreate(VariableBase):
    """Schema for creating a new variable."""

    scope: VariableScope = Field(..., description="Variable scope (GLOBAL or WORKFLOW)")


class VariableUpdate(BaseSchema):
    """Schema for updating an existing variable."""

    value: Any | None = Field(
        None, description="Variable value (must be JSON-serializable)"
    )
    description: str | None = Field(None, max_length=1000)


class VariableRead(VariableBase, BaseORMSchema):
    """Schema for reading variable data."""

    id: UuidAsString
    project_id: UuidAsString
    workflow_id: UuidAsString | None = None
    scope: VariableScope
    created_at: IsoDatetime
    updated_at: IsoDatetime


class VariableHistoryRead(BaseORMSchema):
    """Schema for reading variable history."""

    id: UuidAsString
    variable_id: UuidAsString
    workflow_run_id: UuidAsString | None = None
    old_value: Any
    new_value: Any
    changed_at: IsoDatetime
    changed_by_action: str | None = Field(
        None, description="Action that triggered the change"
    )


class VariableSnapshot(BaseSchema):
    """
    Schema for variable snapshot at a specific point in time.

    Used to capture variable state for a workflow run.
    """

    name: str
    value: Any
    scope: VariableScope
    description: str | None = None


class VariableListResponse(BaseSchema):
    """Response schema for listing variables."""

    variables: list[VariableRead]
    total: int


class VariableHistoryListResponse(BaseSchema):
    """Response schema for listing variable history."""

    history: list[VariableHistoryRead]
    total: int


class VariableSnapshotResponse(BaseSchema):
    """Response schema for variable snapshot."""

    run_id: UuidAsString
    variables: list[VariableSnapshot]
    timestamp: IsoDatetime
