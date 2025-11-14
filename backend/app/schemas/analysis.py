"""
Pydantic schemas for analysis API
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


class DetectedElementSchema(BaseModel):
    """Schema for a detected element"""
    bounding_box: BoundingBoxSchema
    confidence: float = Field(ge=0.0, le=1.0)
    label: Optional[str] = None
    element_type: Optional[str] = None
    screenshot_index: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AnalyzerResultSchema(BaseModel):
    """Schema for results from a single analyzer"""
    analyzer_type: str
    analyzer_name: str
    elements: List[DetectedElementSchema]
    confidence: float
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FusedElementSchema(BaseModel):
    """Schema for a fused element from multiple analyzers"""
    bounding_box: BoundingBoxSchema
    confidence: float
    sources: List[str]
    source_confidences: Dict[str, float]
    votes: int
    label: Optional[str] = None
    element_type: Optional[str] = None
    screenshot_index: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AnalyzerInfoSchema(BaseModel):
    """Information about an available analyzer"""
    name: str
    type: str
    version: str
    supports_multi_screenshot: bool
    required_screenshots: int
    default_parameters: Dict[str, Any]


# Request schemas
class AnalysisRequest(BaseModel):
    """Request to run analysis on an annotation set"""
    annotation_set_id: UUID
    analyzer_names: Optional[List[str]] = None  # None = all analyzers
    analyzer_configs: Optional[Dict[str, Dict[str, Any]]] = None
    parallel: bool = True
    fuse_results: bool = True
    overlap_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    save_to_database: bool = True  # Whether to save results to DB


class QuickAnalysisRequest(BaseModel):
    """Quick analysis request (no DB storage)"""
    annotation_set_id: UUID
    analyzers: Optional[List[str]] = None
    fuse_results: bool = True


# Response schemas
class AnalysisResponse(BaseModel):
    """Response from running analysis"""
    analysis_job_id: Optional[UUID] = None  # None if not saved to DB
    progress_job_id: Optional[UUID] = None  # For polling progress (only during analysis)
    annotation_set_id: UUID
    analyzer_results: List[AnalyzerResultSchema]
    fused_elements: Optional[List[FusedElementSchema]] = None
    fusion_stats: Optional[Dict[str, Any]] = None
    analyzer_statistics: Dict[str, Any]
    status: str = "completed"
    error_message: Optional[str] = None


class AnalysisJobSchema(BaseModel):
    """Schema for a stored analysis job"""
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
    total_elements_found: int
    total_fused_elements: int
    analyzer_statistics: Optional[Dict[str, Any]] = None
    created_at: datetime
    created_by_id: UUID


class AnalysisJobDetailSchema(AnalysisJobSchema):
    """Detailed analysis job with elements"""
    fused_elements: List[FusedElementSchema]


class AnalysisJobListResponse(BaseModel):
    """Response for listing analysis jobs"""
    jobs: List[AnalysisJobSchema]
    total: int
    page: int
    page_size: int


# Utility schemas
class AnalyzerListResponse(BaseModel):
    """Response listing available analyzers"""
    analyzers: List[AnalyzerInfoSchema]
    total: int


class AnalysisStatistics(BaseModel):
    """Statistics about analysis results"""
    total_jobs: int
    total_elements_detected: int
    avg_confidence: float
    analyzers_used: Dict[str, int]  # {analyzer_name: count}
