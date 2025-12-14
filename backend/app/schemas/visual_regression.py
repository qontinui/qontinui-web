"""
Pydantic schemas for visual regression API.

These schemas define request/response models for visual baseline and
comparison endpoints.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import IsoDatetime


# ============================================================================
# Ignore Region Schemas
# ============================================================================


class IgnoreRegionCreate(BaseModel):
    """Schema for creating an ignore region."""

    x: int = Field(..., ge=0, description="X coordinate of region")
    y: int = Field(..., ge=0, description="Y coordinate of region")
    width: int = Field(..., gt=0, description="Width of region in pixels")
    height: int = Field(..., gt=0, description="Height of region in pixels")
    name: str | None = Field(None, max_length=100, description="Optional name for region")


class IgnoreRegionResponse(BaseModel):
    """Response schema for an ignore region."""

    x: int
    y: int
    width: int
    height: int
    name: str | None = None


# ============================================================================
# Comparison Settings Schemas
# ============================================================================


class ComparisonSettingsCreate(BaseModel):
    """Schema for comparison settings."""

    algorithm: str = Field(
        default="ssim",
        description="Comparison algorithm: ssim, pixel_diff, or perceptual_hash",
    )
    threshold: float = Field(
        default=0.95,
        ge=0.0,
        le=1.0,
        description="Similarity threshold (0.0-1.0)",
    )
    ignore_regions: list[IgnoreRegionCreate] = Field(
        default_factory=list,
        description="Regions to ignore during comparison",
    )


class ComparisonSettingsResponse(BaseModel):
    """Response schema for comparison settings."""

    algorithm: str
    threshold: float
    ignore_regions: list[IgnoreRegionResponse]


# ============================================================================
# Visual Baseline Schemas
# ============================================================================


class BaselineCreate(BaseModel):
    """Request schema for creating a baseline from upload."""

    state_name: str = Field(
        ...,
        max_length=500,
        description="State name for baseline matching",
    )
    workflow_id: str | None = Field(
        None,
        max_length=500,
        description="Optional workflow ID to scope baseline",
    )
    comparison_settings: ComparisonSettingsCreate | None = Field(
        None,
        description="Comparison configuration",
    )
    approval_notes: str | None = Field(
        None,
        description="Notes explaining the baseline",
    )


class BaselineFromScreenshot(BaseModel):
    """Request schema for creating a baseline from an existing screenshot."""

    screenshot_id: UUID = Field(..., description="Source screenshot ID")
    state_name: str = Field(
        ...,
        max_length=500,
        description="State name for baseline matching",
    )
    workflow_id: str | None = Field(
        None,
        max_length=500,
        description="Optional workflow ID to scope baseline",
    )
    comparison_settings: ComparisonSettingsCreate | None = Field(
        None,
        description="Comparison configuration",
    )
    approval_notes: str | None = Field(
        None,
        description="Notes explaining the baseline",
    )


class BaselineUpdate(BaseModel):
    """Request schema for updating baseline settings."""

    comparison_settings: ComparisonSettingsCreate | None = None
    approval_notes: str | None = None


class BaselineRollback(BaseModel):
    """Request schema for rolling back to a previous version."""

    target_version: int = Field(..., ge=1, description="Version to rollback to")


class BaselineResponse(BaseModel):
    """Response schema for a visual baseline."""

    id: UUID
    project_id: UUID
    state_name: str
    workflow_id: str | None
    width: int
    height: int
    file_size_bytes: int | None
    perceptual_hash: str | None
    version: int
    is_active: bool
    approved_by_user_id: UUID | None
    approved_at: IsoDatetime | None
    approval_notes: str | None
    comparison_settings: dict[str, Any]
    source_test_run_id: UUID | None
    source_screenshot_id: UUID | None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    # URLs for accessing images (computed by endpoint)
    image_url: str | None = None
    thumbnail_url: str | None = None

    model_config = {"from_attributes": True}


class BaselineListResponse(BaseModel):
    """Response schema for listing baselines."""

    items: list[BaselineResponse]
    total: int
    skip: int
    limit: int


class BaselineHistoryResponse(BaseModel):
    """Response schema for baseline version history."""

    state_name: str
    workflow_id: str | None
    versions: list[BaselineResponse]


# ============================================================================
# Diff Region Schemas
# ============================================================================


class DiffRegionResponse(BaseModel):
    """Response schema for a diff region."""

    x: int
    y: int
    width: int
    height: int
    change_percentage: float
    pixel_count: int | None = None


# ============================================================================
# Visual Comparison Schemas
# ============================================================================


class ComparisonCreate(BaseModel):
    """Request schema for running a comparison."""

    screenshot_id: UUID = Field(..., description="Screenshot to compare")
    baseline_id: UUID | None = Field(
        None,
        description="Optional explicit baseline (otherwise auto-lookup)",
    )
    algorithm: str | None = Field(
        None,
        description="Override comparison algorithm",
    )
    threshold: float | None = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Override comparison threshold",
    )


class ComparisonRunCreate(BaseModel):
    """Request schema for comparing all screenshots in a test run."""

    state_filter: str | None = Field(
        None,
        description="Optional state name filter",
    )


class ReviewCreate(BaseModel):
    """Request schema for reviewing a comparison."""

    decision: str = Field(
        ...,
        description="Review decision: approved, rejected, or new_baseline",
    )
    notes: str | None = Field(
        None,
        description="Optional review notes",
    )


class ComparisonResponse(BaseModel):
    """Response schema for a visual comparison result."""

    id: UUID
    test_run_id: UUID
    baseline_id: UUID | None
    screenshot_id: UUID
    transition_execution_id: UUID | None
    state_name: str
    comparison_algorithm: str
    similarity_score: float
    threshold_used: float
    status: str
    diff_region_count: int
    execution_time_ms: int | None
    reviewed_by_user_id: UUID | None
    reviewed_at: IsoDatetime | None
    review_decision: str | None
    review_notes: str | None
    deficiency_id: UUID | None
    error_message: str | None
    created_at: IsoDatetime

    # URLs for accessing images (computed by endpoint)
    diff_image_url: str | None = None
    screenshot_url: str | None = None
    baseline_url: str | None = None

    model_config = {"from_attributes": True}


class ComparisonDetailResponse(ComparisonResponse):
    """Detailed comparison response with diff regions."""

    diff_regions: list[DiffRegionResponse]


class ComparisonListResponse(BaseModel):
    """Response schema for listing comparisons."""

    items: list[ComparisonResponse]
    total: int
    skip: int
    limit: int


class ComparisonBatchResponse(BaseModel):
    """Response schema for batch comparison operation."""

    comparisons: list[ComparisonResponse]
    total: int
    passed: int
    failed: int
    pending_review: int
    no_baseline: int


# ============================================================================
# Statistics Schemas
# ============================================================================


class ComparisonStatsResponse(BaseModel):
    """Response schema for comparison statistics."""

    total: int
    passed: int
    failed: int
    pending_review: int
    approved_as_new: int
    no_baseline: int
    pass_rate: float


class ProjectVisualStatsResponse(BaseModel):
    """Response schema for project visual regression statistics."""

    total: int
    passed: int
    failed: int
    pending_review: int
    approved_as_new: int
    no_baseline: int
    pending_review_count: int
    active_baselines: int


# ============================================================================
# Auto-Create Baselines Schema
# ============================================================================


class AutoCreateBaselinesRequest(BaseModel):
    """Request schema for auto-creating baselines from a test run."""

    test_run_id: UUID = Field(..., description="Test run to create baselines from")
    state_filter: str | None = Field(
        None,
        description="Optional state name filter",
    )
    overwrite_existing: bool = Field(
        False,
        description="Whether to overwrite existing baselines",
    )


class AutoCreateBaselinesResponse(BaseModel):
    """Response schema for auto-create baselines operation."""

    created: int
    skipped: int
    errors: int
    baselines: list[BaselineResponse]
