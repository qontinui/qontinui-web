"""
Pydantic schemas for region analysis API
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


class GridCellSchema(BaseModel):
    """Individual cell in a grid structure"""

    x: int
    y: int
    width: int
    height: int


class GridMetadataSchema(BaseModel):
    """Grid structure metadata for inventory grids, skill bars, etc."""

    rows: int
    cols: int
    cells: list[GridCellSchema]
    cell_spacing: int | None = None
    cell_size: dict[str, int] | None = None  # {"width": int, "height": int}


class DetectedRegionSchema(BaseModel):
    """Schema for a detected region"""

    bounding_box: BoundingBoxSchema
    confidence: float = Field(ge=0.0, le=1.0)
    label: str | None = None
    region_type: str | None = None
    screenshot_index: int = 0
    grid_metadata: GridMetadataSchema | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RegionAnalyzerResultSchema(BaseModel):
    """Schema for results from a single region analyzer"""

    analyzer_name: str
    regions: list[DetectedRegionSchema]
    confidence: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class FusedRegionSchema(BaseModel):
    """Schema for a fused region from multiple analyzers"""

    bounding_box: BoundingBoxSchema
    confidence: float
    sources: list[str]
    source_confidences: dict[str, float]
    votes: int
    label: str | None = None
    region_type: str | None = None
    screenshot_index: int = 0
    grid_metadata: GridMetadataSchema | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RegionAnalyzerInfoSchema(BaseModel):
    """Information about an available region analyzer"""

    name: str
    version: str
    supported_region_types: list[str]
    default_parameters: dict[str, Any]


# Request schemas
class RegionAnalysisRequest(BaseModel):
    """Request to run region analysis on an annotation set"""

    annotation_set_id: UUID
    analyzer_names: list[str] | None = None  # None = all analyzers
    analyzer_configs: dict[str, dict[str, Any]] | None = None
    parallel: bool = True
    fuse_results: bool = True
    overlap_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    save_to_database: bool = True  # Whether to save results to DB


class QuickRegionAnalysisRequest(BaseModel):
    """Quick region analysis request (no DB storage)"""

    annotation_set_id: UUID
    analyzers: list[str] | None = None
    fuse_results: bool = True


# Response schemas
class RegionAnalysisResponse(BaseModel):
    """Response from running region analysis"""

    analysis_job_id: UUID | None = None  # None if not saved to DB
    annotation_set_id: UUID
    analyzer_results: list[RegionAnalyzerResultSchema]
    fused_regions: list[FusedRegionSchema] | None = None
    fusion_stats: dict[str, Any] | None = None
    analyzer_statistics: dict[str, Any]
    status: str = "completed"
    error_message: str | None = None


class RegionJobSchema(BaseModel):
    """Schema for a stored region analysis job"""

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
    total_regions_found: int
    total_fused_regions: int
    analyzer_statistics: dict[str, Any] | None = None
    created_at: datetime
    created_by_id: UUID


class RegionJobDetailSchema(RegionJobSchema):
    """Detailed region analysis job with regions"""

    fused_regions: list[FusedRegionSchema]


class RegionJobListResponse(BaseModel):
    """Response for listing region analysis jobs"""

    jobs: list[RegionJobSchema]
    total: int
    page: int
    page_size: int


# Utility schemas
class RegionAnalyzerListResponse(BaseModel):
    """Response listing available region analyzers"""

    analyzers: list[RegionAnalyzerInfoSchema]
    total: int


class RegionAnalysisStatistics(BaseModel):
    """Statistics about region analysis results"""

    total_jobs: int
    total_regions_detected: int
    avg_confidence: float
    analyzers_used: dict[str, int]  # {analyzer_name: count}
    region_types_found: dict[str, int]  # {region_type: count}
