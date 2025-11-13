"""
Pydantic schemas for region analysis API
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Any, Optional
from datetime import datetime
from uuid import UUID


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
    cells: List[GridCellSchema]
    cell_spacing: Optional[int] = None
    cell_size: Optional[Dict[str, int]] = None  # {"width": int, "height": int}


class DetectedRegionSchema(BaseModel):
    """Schema for a detected region"""
    bounding_box: BoundingBoxSchema
    confidence: float = Field(ge=0.0, le=1.0)
    label: Optional[str] = None
    region_type: Optional[str] = None
    screenshot_index: int = 0
    grid_metadata: Optional[GridMetadataSchema] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RegionAnalyzerResultSchema(BaseModel):
    """Schema for results from a single region analyzer"""
    analyzer_name: str
    regions: List[DetectedRegionSchema]
    confidence: float
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FusedRegionSchema(BaseModel):
    """Schema for a fused region from multiple analyzers"""
    bounding_box: BoundingBoxSchema
    confidence: float
    sources: List[str]
    source_confidences: Dict[str, float]
    votes: int
    label: Optional[str] = None
    region_type: Optional[str] = None
    screenshot_index: int = 0
    grid_metadata: Optional[GridMetadataSchema] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RegionAnalyzerInfoSchema(BaseModel):
    """Information about an available region analyzer"""
    name: str
    version: str
    supported_region_types: List[str]
    default_parameters: Dict[str, Any]


# Request schemas
class RegionAnalysisRequest(BaseModel):
    """Request to run region analysis on an annotation set"""
    annotation_set_id: UUID
    analyzer_names: Optional[List[str]] = None  # None = all analyzers
    analyzer_configs: Optional[Dict[str, Dict[str, Any]]] = None
    parallel: bool = True
    fuse_results: bool = True
    overlap_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    save_to_database: bool = True  # Whether to save results to DB


class QuickRegionAnalysisRequest(BaseModel):
    """Quick region analysis request (no DB storage)"""
    annotation_set_id: UUID
    analyzers: Optional[List[str]] = None
    fuse_results: bool = True


# Response schemas
class RegionAnalysisResponse(BaseModel):
    """Response from running region analysis"""
    analysis_job_id: Optional[UUID] = None  # None if not saved to DB
    annotation_set_id: UUID
    analyzer_results: List[RegionAnalyzerResultSchema]
    fused_regions: Optional[List[FusedRegionSchema]] = None
    fusion_stats: Optional[Dict[str, Any]] = None
    analyzer_statistics: Dict[str, Any]
    status: str = "completed"
    error_message: Optional[str] = None


class RegionJobSchema(BaseModel):
    """Schema for a stored region analysis job"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    annotation_set_id: UUID
    analyzers_used: List[str]
    parameters: Optional[Dict[str, Any]] = None
    fusion_enabled: bool
    fusion_config: Optional[Dict[str, Any]] = None
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    total_regions_found: int
    total_fused_regions: int
    analyzer_statistics: Optional[Dict[str, Any]] = None
    created_at: datetime
    created_by_id: UUID


class RegionJobDetailSchema(RegionJobSchema):
    """Detailed region analysis job with regions"""
    fused_regions: List[FusedRegionSchema]


class RegionJobListResponse(BaseModel):
    """Response for listing region analysis jobs"""
    jobs: List[RegionJobSchema]
    total: int
    page: int
    page_size: int


# Utility schemas
class RegionAnalyzerListResponse(BaseModel):
    """Response listing available region analyzers"""
    analyzers: List[RegionAnalyzerInfoSchema]
    total: int


class RegionAnalysisStatistics(BaseModel):
    """Statistics about region analysis results"""
    total_jobs: int
    total_regions_detected: int
    avg_confidence: float
    analyzers_used: Dict[str, int]  # {analyzer_name: count}
    region_types_found: Dict[str, int]  # {region_type: count}
