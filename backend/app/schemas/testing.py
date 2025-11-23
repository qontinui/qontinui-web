"""
Pydantic schemas for testing results API.

These schemas define request/response models for software testing endpoints,
including test runs, transitions, deficiencies, screenshots, and analytics.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from app.schemas.base import BaseORMSchema, IsoDatetime
from pydantic import BaseModel, Field, field_validator

# ============================================================================
# Test Run Schemas
# ============================================================================


class TestRunCreate(BaseModel):
    """Request schema for creating a new test run."""

    project_id: int = Field(..., description="Project ID", example=123)
    run_name: str = Field(
        ...,
        max_length=255,
        description="Name of the test run",
        example="Nightly Regression - 2025-11-23",
    )
    description: str | None = Field(
        None, description="Optional description of the test run"
    )
    runner_metadata: dict[str, Any] = Field(
        ...,
        description="Metadata about the runner environment",
        example={
            "runner_version": "0.1.0",
            "os": "Windows 11",
            "hostname": "test-machine-01",
            "screen_resolution": "1920x1080",
        },
    )
    workflow_metadata: dict[str, Any] = Field(
        ...,
        description="Metadata about the workflow being tested",
        example={
            "workflow_id": "workflow-uuid-456",
            "workflow_name": "E-commerce Checkout Flow",
            "total_states": 12,
            "total_transitions": 24,
        },
    )
    configuration_snapshot: dict[str, Any] = Field(
        ...,
        description="Snapshot of the test configuration",
        example={
            "strategy": "random_walk",
            "max_duration_seconds": 3600,
            "max_transitions": 100,
            "screenshot_on_error": True,
        },
    )


class TestRunResponse(BaseModel):
    """Response schema for test run creation and retrieval."""

    run_id: UUID = Field(..., description="Unique test run identifier")
    project_id: int = Field(..., description="Project ID")
    run_name: str = Field(..., description="Name of the test run")
    status: str = Field(..., description="Test run status", example="running")
    started_at: IsoDatetime = Field(..., description="Test run start time")
    ended_at: IsoDatetime | None = Field(None, description="Test run end time")
    duration_seconds: int | None = Field(
        None, description="Test run duration in seconds"
    )
    runner_metadata: dict[str, Any] = Field(..., description="Runner metadata")
    created_at: IsoDatetime = Field(..., description="Record creation time")


class TestRunDetail(TestRunResponse):
    """Detailed test run information including optional related data."""

    description: str | None = Field(None, description="Test run description")
    workflow_metadata: dict[str, Any] = Field(..., description="Workflow metadata")
    configuration_snapshot: dict[str, Any] = Field(
        ..., description="Configuration snapshot"
    )
    final_metrics: dict[str, Any] | None = Field(None, description="Final test metrics")
    coverage_data: dict[str, Any] | None = Field(None, description="Coverage data")
    updated_at: IsoDatetime | None = Field(None, description="Last update time")
    created_by: dict[str, Any] | None = Field(
        None,
        description="User who created the run",
        example={"user_id": "user-uuid-456", "email": "tester@example.com"},
    )
    transitions: list[Any] | None = Field(
        None, description="List of transitions (optional)"
    )
    deficiencies: list[Any] | None = Field(
        None, description="List of deficiencies (optional)"
    )
    screenshots: list[Any] | None = Field(
        None, description="List of screenshots (optional)"
    )


class TestRunListResponse(BaseModel):
    """Response schema for paginated test run list."""

    runs: list[TestRunResponse] = Field(..., description="List of test runs")
    pagination: dict[str, Any] = Field(
        ...,
        description="Pagination metadata",
        example={"total": 145, "limit": 20, "offset": 0, "has_more": True},
    )


# ============================================================================
# Test Transition Schemas
# ============================================================================


class TransitionCreate(BaseModel):
    """Schema for a single transition report."""

    sequence_number: int = Field(
        ..., ge=1, description="Order within test run (1-indexed)"
    )
    from_state: str = Field(..., max_length=255, description="Source state")
    to_state: str = Field(..., max_length=255, description="Destination state")
    transition_name: str = Field(..., max_length=255, description="Transition name")
    status: str = Field(..., description="Transition status", example="success")
    started_at: datetime = Field(..., description="Transition start time")
    completed_at: datetime = Field(..., description="Transition completion time")
    duration_ms: int = Field(..., ge=0, description="Duration in milliseconds")
    error_message: str | None = Field(None, description="Error message if failed")
    error_type: str | None = Field(None, description="Error type if failed")
    screenshot_id: UUID | None = Field(None, description="Associated screenshot ID")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional transition metadata",
        example={"actions_executed": 3, "confidence_score": 0.95, "retry_count": 0},
    )

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = ["success", "failed", "timeout", "skipped"]
        if v not in allowed:
            raise ValueError(f"Status must be one of: {', '.join(allowed)}")
        return v

    @field_validator("error_type")
    @classmethod
    def validate_error_type(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = ["element_not_found", "timeout", "assertion_failed", "crash", "other"]
        if v not in allowed:
            raise ValueError(f"Error type must be one of: {', '.join(allowed)}")
        return v


class TransitionBatchCreate(BaseModel):
    """Request schema for batch transition reporting."""

    transitions: list[TransitionCreate] = Field(
        ..., min_length=1, max_length=50, description="List of transitions (max 50)"
    )


class TransitionBatchResponse(BaseModel):
    """Response schema for batch transition creation."""

    run_id: UUID = Field(..., description="Test run ID")
    transitions_recorded: int = Field(..., description="Number of transitions recorded")
    transition_ids: list[UUID] = Field(..., description="IDs of created transitions")
    coverage_updated: dict[str, Any] = Field(
        ...,
        description="Updated coverage metrics",
        example={
            "total_transitions_executed": 2,
            "unique_transitions_covered": 2,
            "coverage_percentage": 8.33,
        },
    )


class TransitionResponse(BaseModel):
    """Response schema for a single transition."""

    transition_id: UUID = Field(..., description="Transition ID")
    sequence_number: int = Field(..., description="Sequence number")
    from_state: str = Field(..., description="Source state")
    to_state: str = Field(..., description="Destination state")
    transition_name: str = Field(..., description="Transition name")
    status: str = Field(..., description="Transition status")
    duration_ms: int = Field(..., description="Duration in milliseconds")
    started_at: IsoDatetime = Field(..., description="Start time")
    completed_at: IsoDatetime = Field(..., description="Completion time")
    error_message: str | None = Field(None, description="Error message")
    error_type: str | None = Field(None, description="Error type")


# ============================================================================
# Test Deficiency Schemas
# ============================================================================


class DeficiencyCreate(BaseModel):
    """Schema for a single deficiency report."""

    title: str = Field(..., max_length=500, description="Deficiency title")
    description: str = Field(..., description="Detailed description")
    severity: str = Field(..., description="Severity level")
    deficiency_type: str = Field(..., description="Type of deficiency")
    transition_sequence_number: int | None = Field(
        None, description="Related transition sequence number"
    )
    state: str | None = Field(
        None, max_length=255, description="State where deficiency occurred"
    )
    screenshot_ids: list[UUID] = Field(
        default_factory=list, description="Associated screenshot IDs"
    )
    reproduction_steps: list[str] = Field(
        default_factory=list, description="Steps to reproduce the issue"
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        allowed = ["critical", "high", "medium", "low", "informational"]
        if v not in allowed:
            raise ValueError(f"Severity must be one of: {', '.join(allowed)}")
        return v

    @field_validator("deficiency_type")
    @classmethod
    def validate_deficiency_type(cls, v: str) -> str:
        allowed = [
            "functional_bug",
            "ui_issue",
            "performance",
            "crash",
            "security",
            "accessibility",
            "other",
        ]
        if v not in allowed:
            raise ValueError(f"Deficiency type must be one of: {', '.join(allowed)}")
        return v


class DeficiencyBatchCreate(BaseModel):
    """Request schema for batch deficiency reporting."""

    deficiencies: list[DeficiencyCreate] = Field(
        ..., min_length=1, max_length=20, description="List of deficiencies (max 20)"
    )


class DeficiencyBatchResponse(BaseModel):
    """Response schema for batch deficiency creation."""

    run_id: UUID = Field(..., description="Test run ID")
    deficiencies_recorded: int = Field(
        ..., description="Number of deficiencies recorded"
    )
    deficiency_ids: list[UUID] = Field(..., description="IDs of created deficiencies")


class DeficiencyResponse(BaseModel):
    """Response schema for a single deficiency."""

    deficiency_id: UUID = Field(..., description="Deficiency ID")
    run_id: UUID = Field(..., description="Test run ID")
    title: str = Field(..., description="Deficiency title")
    description: str = Field(..., description="Deficiency description")
    severity: str = Field(..., description="Severity level")
    status: str = Field(..., description="Deficiency status")
    deficiency_type: str = Field(..., description="Deficiency type")
    state: str | None = Field(None, description="State where deficiency occurred")
    transition_sequence_number: int | None = Field(
        None, description="Related transition"
    )
    screenshot_count: int | None = Field(None, description="Number of screenshots")
    created_at: IsoDatetime = Field(..., description="Creation time")
    updated_at: IsoDatetime = Field(..., description="Last update time")
    run_info: dict[str, Any] | None = Field(None, description="Related run information")


class DeficiencyDetail(DeficiencyResponse):
    """Detailed deficiency information."""

    reproduction_steps: list[str] = Field(
        default_factory=list, description="Reproduction steps"
    )
    screenshots: list[Any] = Field(
        default_factory=list, description="Associated screenshots"
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )
    assigned_to: dict[str, Any] | None = Field(None, description="Assigned user")
    resolution_notes: str | None = Field(None, description="Resolution notes")
    comments: list[Any] = Field(
        default_factory=list, description="Comments on deficiency"
    )


class DeficiencyUpdate(BaseModel):
    """Request schema for updating a deficiency."""

    status: str | None = Field(None, description="New status")
    severity: str | None = Field(None, description="New severity")
    assigned_to_user_id: UUID | None = Field(None, description="Assign to user")
    resolution_notes: str | None = Field(None, description="Resolution notes")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = ["open", "in_progress", "resolved", "closed", "wont_fix"]
        if v not in allowed:
            raise ValueError(f"Status must be one of: {', '.join(allowed)}")
        return v

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = ["critical", "high", "medium", "low", "informational"]
        if v not in allowed:
            raise ValueError(f"Severity must be one of: {', '.join(allowed)}")
        return v


class DeficiencyListResponse(BaseModel):
    """Response schema for paginated deficiency list."""

    deficiencies: list[DeficiencyResponse] = Field(
        ..., description="List of deficiencies"
    )
    pagination: dict[str, Any] = Field(..., description="Pagination metadata")
    summary: dict[str, Any] = Field(
        ...,
        description="Summary statistics",
        example={
            "total_deficiencies": 27,
            "by_status": {"open": 15, "in_progress": 5, "resolved": 7},
            "by_severity": {"critical": 2, "high": 8, "medium": 12, "low": 5},
        },
    )


# ============================================================================
# Coverage Schemas
# ============================================================================


class CoverageUpdate(BaseModel):
    """Request schema for updating coverage metrics."""

    total_transitions_executed: int = Field(
        ..., ge=0, description="Total transitions executed"
    )
    unique_transitions_covered: int = Field(
        ..., ge=0, description="Unique transitions covered"
    )
    coverage_percentage: float = Field(
        ..., ge=0.0, le=100.0, description="Coverage percentage"
    )
    transition_coverage_map: dict[str, int] = Field(
        default_factory=dict,
        description="Map of transition names to execution counts",
        example={"login_page->dashboard": 5, "dashboard->profile_page": 3},
    )
    state_coverage_map: dict[str, int] = Field(
        default_factory=dict,
        description="Map of state names to visit counts",
        example={"login_page": 5, "dashboard": 12, "profile_page": 8},
    )
    uncovered_transitions: list[str] = Field(
        default_factory=list,
        description="List of uncovered transitions",
        example=["dashboard->admin_panel", "profile_page->payment_methods"],
    )


class CoverageUpdateResponse(BaseModel):
    """Response schema for coverage update."""

    run_id: UUID = Field(..., description="Test run ID")
    coverage_updated: bool = Field(..., description="Whether update was successful")
    coverage_percentage: float = Field(..., description="Current coverage percentage")
    unique_transitions_covered: int = Field(
        ..., description="Unique transitions covered"
    )


# ============================================================================
# Test Run Completion Schemas
# ============================================================================


class TestRunComplete(BaseModel):
    """Request schema for completing a test run."""

    status: str = Field(..., description="Final status")
    ended_at: datetime = Field(..., description="End time")
    final_metrics: dict[str, Any] = Field(
        ...,
        description="Final test metrics",
        example={
            "total_transitions_executed": 42,
            "successful_transitions": 38,
            "failed_transitions": 4,
            "timeout_transitions": 0,
            "unique_transitions_covered": 18,
            "coverage_percentage": 75.0,
            "total_deficiencies_found": 2,
            "total_screenshots_captured": 15,
            "total_duration_seconds": 3600,
        },
    )
    summary: str | None = Field(None, description="Optional summary text")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = ["completed", "failed", "timeout", "aborted", "crashed"]
        if v not in allowed:
            raise ValueError(f"Status must be one of: {', '.join(allowed)}")
        return v


class TestRunCompleteResponse(BaseModel):
    """Response schema for test run completion."""

    run_id: UUID = Field(..., description="Test run ID")
    status: str = Field(..., description="Final status")
    started_at: IsoDatetime = Field(..., description="Start time")
    ended_at: IsoDatetime = Field(..., description="End time")
    duration_seconds: int = Field(..., description="Duration in seconds")
    final_metrics: dict[str, Any] = Field(..., description="Final metrics")


# ============================================================================
# Screenshot Schemas
# ============================================================================


class ScreenshotMetadata(BaseModel):
    """Metadata for screenshot upload."""

    screenshot_id: UUID = Field(..., description="Screenshot ID (client-generated)")
    sequence_number: int = Field(..., ge=1, description="Screenshot sequence number")
    transition_sequence_number: int | None = Field(
        None, description="Associated transition sequence number"
    )
    state: str | None = Field(
        None, max_length=255, description="State when screenshot taken"
    )
    screenshot_type: str = Field(..., description="Screenshot type")
    timestamp: datetime = Field(..., description="Screenshot timestamp")
    width: int = Field(..., ge=1, description="Image width")
    height: int = Field(..., ge=1, description="Image height")
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )

    @field_validator("screenshot_type")
    @classmethod
    def validate_screenshot_type(cls, v: str) -> str:
        allowed = ["error", "success", "manual", "periodic"]
        if v not in allowed:
            raise ValueError(f"Screenshot type must be one of: {', '.join(allowed)}")
        return v


class ScreenshotUploadResponse(BaseModel):
    """Response schema for screenshot upload."""

    screenshot_id: UUID = Field(..., description="Screenshot ID")
    run_id: UUID = Field(..., description="Test run ID")
    image_url: str = Field(..., description="Full image URL")
    thumbnail_url: str | None = Field(None, description="Thumbnail URL")
    uploaded_at: IsoDatetime = Field(..., description="Upload time")
    file_size_bytes: int = Field(..., description="File size in bytes")


# ============================================================================
# Analytics Schemas
# ============================================================================


class CoverageTrendDataPoint(BaseModel):
    """Single data point in coverage trend."""

    date: str = Field(..., description="Date (YYYY-MM-DD)")
    runs_count: int = Field(..., description="Number of runs on this date")
    avg_coverage_percentage: float = Field(
        ..., description="Average coverage percentage"
    )
    max_coverage_percentage: float = Field(
        ..., description="Maximum coverage percentage"
    )
    min_coverage_percentage: float = Field(
        ..., description="Minimum coverage percentage"
    )
    total_transitions_executed: int = Field(
        ..., description="Total transitions executed"
    )
    unique_transitions_covered: int = Field(
        ..., description="Unique transitions covered"
    )


class CoverageTrendResponse(BaseModel):
    """Response schema for coverage trends."""

    project_id: int = Field(..., description="Project ID")
    start_date: str = Field(..., description="Start date")
    end_date: str = Field(..., description="End date")
    granularity: str = Field(..., description="Granularity (daily, weekly, monthly)")
    data_points: list[CoverageTrendDataPoint] = Field(
        ..., description="Trend data points"
    )
    overall_stats: dict[str, Any] = Field(
        ...,
        description="Overall statistics",
        example={
            "total_runs": 45,
            "avg_coverage_percentage": 70.2,
            "coverage_trend": "increasing",
            "total_unique_transitions": 24,
        },
    )


class TransitionReliabilityStats(BaseModel):
    """Statistics for a single transition."""

    transition_name: str = Field(..., description="Transition name")
    from_state: str = Field(..., description="Source state")
    to_state: str = Field(..., description="Destination state")
    total_executions: int = Field(..., description="Total executions")
    successful_executions: int = Field(..., description="Successful executions")
    failed_executions: int = Field(..., description="Failed executions")
    success_rate: float = Field(..., description="Success rate percentage")
    avg_duration_ms: int = Field(..., description="Average duration in milliseconds")
    median_duration_ms: int = Field(..., description="Median duration in milliseconds")
    p95_duration_ms: int = Field(..., description="95th percentile duration")
    failure_modes: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Failure mode breakdown",
        example=[{"error_type": "timeout", "count": 2, "percentage": 100.0}],
    )


class ReliabilityResponse(BaseModel):
    """Response schema for transition reliability statistics."""

    workflow_id: str = Field(..., description="Workflow ID")
    workflow_name: str | None = Field(None, description="Workflow name")
    project_id: int = Field(..., description="Project ID")
    date_range: dict[str, str] = Field(
        ...,
        description="Date range",
        example={"start": "2025-10-01", "end": "2025-11-30"},
    )
    transition_stats: list[TransitionReliabilityStats] = Field(
        ..., description="Transition statistics"
    )
    overall_reliability: dict[str, Any] = Field(
        ...,
        description="Overall reliability metrics",
        example={
            "total_transitions_analyzed": 24,
            "avg_success_rate": 87.3,
            "most_reliable_transition": "successful_login",
            "least_reliable_transition": "open_profile",
        },
    )


# ============================================================================
# Comment Schemas
# ============================================================================


class DeficiencyCommentCreate(BaseModel):
    """Request schema for creating a comment on a deficiency."""

    comment: str = Field(..., description="Comment text")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional metadata",
        example={"mentioned_users": ["user-uuid-123"]},
    )


class DeficiencyCommentResponse(BaseModel):
    """Response schema for a deficiency comment."""

    comment_id: UUID = Field(..., description="Comment ID")
    deficiency_id: UUID = Field(..., description="Deficiency ID")
    user: dict[str, Any] = Field(
        ...,
        description="User who created the comment",
        example={
            "user_id": "user-uuid-789",
            "email": "dev@example.com",
            "full_name": "Developer User",
        },
    )
    comment: str = Field(..., description="Comment text")
    created_at: IsoDatetime = Field(..., description="Creation time")
