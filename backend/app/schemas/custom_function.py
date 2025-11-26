"""
Pydantic schemas for custom function management.

Provides request/response models for the function library API.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ===== Base Schemas =====


class CustomFunctionBase(BaseModel):
    """Base custom function schema."""

    file_path: str = Field(..., min_length=1, max_length=500)
    function_name: str = Field(..., min_length=1, max_length=100)
    display_name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=2000)
    category: str | None = Field(None, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)


class CustomFunctionCreate(CustomFunctionBase):
    """Schema for creating a custom function (used by scanner)."""

    parameters: list[dict] = Field(default_factory=list)
    return_type: str | None = None
    inputs: dict = Field(default_factory=dict)
    outputs: dict = Field(default_factory=dict)
    observable_outputs: list[str] = Field(default_factory=list)
    source_code: str | None = None
    docstring: str | None = None
    line_start: int | None = None
    line_end: int | None = None


class CustomFunctionUpdate(BaseModel):
    """Schema for updating custom function metadata."""

    display_name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=2000)
    category: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=20)


class CustomFunctionRead(CustomFunctionBase):
    """Schema for reading custom function data."""

    id: int
    project_id: UUID
    parameters: list[dict]
    return_type: str | None
    inputs: dict
    outputs: dict
    observable_outputs: list[str]
    source_code: str | None
    docstring: str | None
    line_start: int | None
    line_end: int | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomFunctionSummary(BaseModel):
    """Lightweight custom function summary (for list views)."""

    id: int
    project_id: UUID
    file_path: str
    function_name: str
    display_name: str | None
    description: str | None
    category: str | None
    tags: list[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===== Search & List Schemas =====


class CustomFunctionSearchFilters(BaseModel):
    """Filters for searching custom functions."""

    query: str | None = Field(None, min_length=1, max_length=100)
    category: str | None = None
    tags: list[str] | None = None
    file_path: str | None = None


class CustomFunctionListResponse(BaseModel):
    """Paginated list of custom functions."""

    functions: list[CustomFunctionSummary]
    total: int
    limit: int
    offset: int
    has_more: bool


# ===== Statistics Schemas =====


class FunctionStats(BaseModel):
    """Custom function statistics for a project."""

    total_functions: int
    categories: list[str]
    tags: list[str]
    files_with_functions: int
