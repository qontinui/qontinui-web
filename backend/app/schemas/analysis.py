"""
Pydantic schemas for analysis API
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Base schemas for request/response
class BoundingBoxSchema(BaseModel):
    """Bounding box coordinates"""

    x: int
    y: int
    width: int
    height: int


class DetectedElementSchema(BaseModel):
    """Schema for a detected element"""

    bounding_box: BoundingBoxSchema
    confidence: float = Field(ge=0.0, le=1.0)
    label: str | None = None
    element_type: str | None = None
    screenshot_index: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnalyzerResultSchema(BaseModel):
    """Schema for results from a single analyzer"""

    analyzer_type: str
    analyzer_name: str
    elements: list[DetectedElementSchema]
    confidence: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class FusedElementSchema(BaseModel):
    """Schema for a fused element from multiple analyzers"""

    bounding_box: BoundingBoxSchema
    confidence: float
    sources: list[str]
    source_confidences: dict[str, float]
    votes: int
    label: str | None = None
    element_type: str | None = None
    screenshot_index: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnalyzerInfoSchema(BaseModel):
    """Information about an available analyzer"""

    name: str
    type: str
    version: str
    supports_multi_screenshot: bool
    required_screenshots: int
    default_parameters: dict[str, Any]


# Request schemas
class AnalysisRequest(BaseModel):
    """Request to run analysis on an annotation set"""

    annotation_set_id: UUID
    analyzer_names: list[str] | None = None  # None = all analyzers
    analyzer_configs: dict[str, dict[str, Any]] | None = None
    parallel: bool = True
    fuse_results: bool = True
    overlap_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    save_to_database: bool = True  # Whether to save results to DB


class QuickAnalysisRequest(BaseModel):
    """Quick analysis request (no DB storage)"""

    annotation_set_id: UUID
    analyzers: list[str] | None = None
    fuse_results: bool = True


# Response schemas
class AnalysisResponse(BaseModel):
    """Response from running analysis"""

    analysis_job_id: UUID | None = None  # None if not saved to DB
    progress_job_id: UUID | None = None  # For polling progress (only during analysis)
    annotation_set_id: UUID
    analyzer_results: list[AnalyzerResultSchema]
    fused_elements: list[FusedElementSchema] | None = None
    fusion_stats: dict[str, Any] | None = None
    analyzer_statistics: dict[str, Any]
    status: str = "completed"
    error_message: str | None = None


class AnalysisJobSchema(BaseModel):
    """Schema for a stored analysis job"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    annotation_set_id: UUID
    analyzers_used: list[str]
    parameters: dict[str, Any] | None = None
    fusion_enabled: bool
    fusion_config: dict[str, Any] | None = None
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    total_elements_found: int
    total_fused_elements: int
    analyzer_statistics: dict[str, Any] | None = None
    created_at: datetime
    created_by_id: UUID


class AnalysisJobDetailSchema(AnalysisJobSchema):
    """Detailed analysis job with elements"""

    fused_elements: list[FusedElementSchema]


class AnalysisJobListResponse(BaseModel):
    """Response for listing analysis jobs"""

    jobs: list[AnalysisJobSchema]
    total: int
    page: int
    page_size: int


# Utility schemas
class AnalyzerListResponse(BaseModel):
    """Response listing available analyzers"""

    analyzers: list[AnalyzerInfoSchema]
    total: int


class AnalysisStatistics(BaseModel):
    """Statistics about analysis results"""

    total_jobs: int
    total_elements_detected: int
    avg_confidence: float
    analyzers_used: dict[str, int]  # {analyzer_name: count}
