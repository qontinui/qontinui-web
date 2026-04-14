"""
Pydantic schemas for Training Dataset API.

These schemas define the request/response models for the training dataset
management endpoints.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime

# ============================================================================
# Enums (mirror the model enums for API)
# ============================================================================


class DatasetSourceEnum(str):
    RUNNER_EXPORT = "runner_export"
    MANUAL_UPLOAD = "manual_upload"
    MERGED = "merged"


class AnnotationSourceEnum(str):
    USER_CLICK = "user_click"
    TEMPLATE_MATCHING = "template_matching"
    SMART_CLICK_ANALYSIS = "smart_click_analysis"
    MANUAL = "manual"


class ElementTypeEnum(str):
    BUTTON = "button"
    ICON = "icon"
    TEXT = "text"
    IMAGE = "image"
    CHECKBOX = "checkbox"
    RADIO = "radio"
    INPUT_FIELD = "input_field"
    LINK = "link"
    MENU_ITEM = "menu_item"
    TAB = "tab"
    UNKNOWN = "unknown"


class ReviewStatusEnum(str):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    FLAGGED = "flagged"


class ExportFormatEnum(str):
    COCO = "coco"
    YOLO = "yolo"
    PASCAL_VOC = "pascal_voc"
    CSV = "csv"
    JSONL = "jsonl"


class ExportJobStatusEnum(str):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# ============================================================================
# Dataset Schemas
# ============================================================================


class DatasetCreate(BaseModel):
    """Schema for creating a new dataset"""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class DatasetUpdate(BaseModel):
    """Schema for updating a dataset"""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class DatasetResponse(BaseModel):
    """Schema for dataset response"""

    id: str
    name: str
    description: str | None = None
    source: str
    created_at: IsoDatetime
    updated_at: IsoDatetime
    created_by: str

    # Statistics
    total_images: int
    total_annotations: int
    reviewed_count: int

    # Metadata
    dataset_version: str | None = None
    export_metadata: dict[str, Any] | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "created_by", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        if isinstance(v, UUID):
            return str(v)
        return v

    @field_validator("source", mode="before")
    @classmethod
    def convert_source_to_str(cls, v):
        if hasattr(v, "value"):
            return v.value
        return str(v)


# ============================================================================
# Image Schemas
# ============================================================================


class DatasetImageBase(BaseModel):
    """Base schema for dataset image"""

    image_hash: str
    filename: str
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    action_id: str | None = None
    action_type: str | None = None
    active_states: list[str] | None = None
    timestamp: datetime | None = None


class DatasetImageResponse(DatasetImageBase):
    """Schema for dataset image response"""

    id: str
    dataset_id: str
    storage_path: str
    image_url: str | None = None  # Computed field

    # Review status
    reviewed: bool
    reviewed_by: str | None = None
    reviewed_at: IsoDatetime | None = None
    reviewer_notes: str | None = None

    # Annotation count
    annotation_count: int | None = None

    created_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "dataset_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        if isinstance(v, UUID):
            return str(v)
        return v

    @field_validator("reviewed_by", mode="before")
    @classmethod
    def convert_reviewed_by(cls, v):
        if v is None:
            return None
        if isinstance(v, UUID):
            return str(v)
        return str(v) if v else None


class DatasetImageUpdate(BaseModel):
    """Schema for updating an image"""

    reviewed: bool | None = None
    reviewer_notes: str | None = None


# ============================================================================
# Annotation Schemas
# ============================================================================


class InferenceMetadataResponse(BaseModel):
    """Schema for inference metadata"""

    strategy_used: str
    element_type: str
    used_fallback: bool
    processing_time_ms: float
    alternatives_count: int | None = None


class DatasetAnnotationBase(BaseModel):
    """Base schema for dataset annotation"""

    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    category_id: int = 1
    category_name: str = "gui_element"
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    source: str = "user_click"
    element_type: str | None = None
    verified: bool = False


class DatasetAnnotationCreate(DatasetAnnotationBase):
    """Schema for creating an annotation"""

    image_id: str
    inference_metadata: dict[str, Any] | None = None


class DatasetAnnotationUpdate(BaseModel):
    """Schema for updating an annotation"""

    x: int | None = Field(None, ge=0)
    y: int | None = Field(None, ge=0)
    width: int | None = Field(None, gt=0)
    height: int | None = Field(None, gt=0)
    category_id: int | None = None
    category_name: str | None = None
    confidence: float | None = Field(None, ge=0.0, le=1.0)
    element_type: str | None = None
    verified: bool | None = None
    review_status: str | None = None
    reviewer_notes: str | None = None


class DatasetAnnotationResponse(DatasetAnnotationBase):
    """Schema for annotation response"""

    id: str
    dataset_id: str
    image_id: str
    inference_metadata: dict[str, Any] | None = None
    review_status: str
    reviewer_notes: str | None = None
    reviewed_by: str | None = None
    reviewed_at: IsoDatetime | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "dataset_id", "image_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        if isinstance(v, UUID):
            return str(v)
        return v

    @field_validator("source", "review_status", mode="before")
    @classmethod
    def convert_enum_to_str(cls, v):
        if hasattr(v, "value"):
            return v.value
        return str(v) if v else None

    @field_validator("element_type", mode="before")
    @classmethod
    def convert_element_type(cls, v):
        if v is None:
            return None
        if hasattr(v, "value"):
            return v.value
        return str(v)

    @field_validator("reviewed_by", mode="before")
    @classmethod
    def convert_reviewed_by(cls, v):
        if v is None:
            return None
        if isinstance(v, UUID):
            return str(v)
        return str(v) if v else None


# ============================================================================
# Filter Schemas
# ============================================================================


class DatasetFilters(BaseModel):
    """Schema for dataset filters"""

    sources: list[str] | None = None
    element_types: list[str] | None = None
    confidence_min: float | None = Field(None, ge=0.0, le=1.0)
    confidence_max: float | None = Field(None, ge=0.0, le=1.0)
    review_statuses: list[str] | None = None
    verified: bool | None = None
    category_names: list[str] | None = None
    search: str | None = None
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=500)
    sort_by: str | None = None
    sort_order: str = "desc"


# ============================================================================
# Pagination Schemas
# ============================================================================


class PaginatedResponse(BaseModel):
    """Generic paginated response"""

    items: list[Any]
    total: int
    page: int
    page_size: int
    total_pages: int


class PaginatedImagesResponse(BaseModel):
    """Paginated images response"""

    items: list[DatasetImageResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class PaginatedAnnotationsResponse(BaseModel):
    """Paginated annotations response"""

    items: list[DatasetAnnotationResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ============================================================================
# Statistics Schemas
# ============================================================================


class ConfidenceStats(BaseModel):
    """Confidence statistics"""

    min: float
    max: float
    mean: float
    median: float


class CategoryCount(BaseModel):
    """Category count"""

    category_id: int
    category_name: str
    count: int


class DatasetStatisticsResponse(BaseModel):
    """Schema for dataset statistics response"""

    total_images: int
    unique_images: int
    total_annotations: int
    reviewed_images: int
    reviewed_annotations: int
    by_source: dict[str, int]
    by_element_type: dict[str, int]
    by_review_status: dict[str, int]
    confidence_stats: ConfidenceStats
    by_category: list[CategoryCount]


class ConfidenceHistogramBucket(BaseModel):
    """Confidence histogram bucket"""

    min: float
    max: float
    count: int


class ConfidenceHistogramResponse(BaseModel):
    """Confidence histogram response"""

    buckets: list[ConfidenceHistogramBucket]


# ============================================================================
# Import Schemas
# ============================================================================


class DatasetImportResponse(BaseModel):
    """Schema for import response"""

    dataset_id: str
    images_imported: int
    annotations_imported: int
    warnings: list[str]
    errors: list[str]


# ============================================================================
# Export Schemas
# ============================================================================


class TrainValTestSplit(BaseModel):
    """Train/val/test split configuration"""

    train_percent: float = Field(..., ge=0.0, le=1.0)
    val_percent: float = Field(..., ge=0.0, le=1.0)
    test_percent: float = Field(..., ge=0.0, le=1.0)
    random_seed: int | None = None

    @field_validator("test_percent")
    @classmethod
    def validate_split_sum(cls, v, info):
        train = info.data.get("train_percent", 0)
        val = info.data.get("val_percent", 0)
        total = train + val + v
        if abs(total - 1.0) > 0.001:
            raise ValueError(f"Split percentages must sum to 1.0, got {total}")
        return v


class DatasetExportRequest(BaseModel):
    """Schema for export request"""

    format: str = Field(
        ..., description="Export format: coco, yolo, pascal_voc, csv, jsonl"
    )
    filters: DatasetFilters | None = None
    split: TrainValTestSplit | None = None
    include_images: bool = True


class DatasetExportJobResponse(BaseModel):
    """Schema for export job response"""

    id: str
    dataset_id: str
    status: str
    progress: int
    format: str
    download_url: str | None = None
    error: str | None = None
    created_at: IsoDatetime
    completed_at: IsoDatetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "dataset_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        if isinstance(v, UUID):
            return str(v)
        return v

    @field_validator("status", "format", mode="before")
    @classmethod
    def convert_enum_to_str(cls, v):
        if hasattr(v, "value"):
            return v.value
        return str(v)


# ============================================================================
# Bulk Operation Schemas
# ============================================================================


class BulkAnnotationUpdate(BaseModel):
    """Schema for bulk annotation update"""

    annotation_ids: list[str]
    update: DatasetAnnotationUpdate


class BulkAnnotationError(BaseModel):
    """Schema for bulk operation error"""

    annotation_id: str
    error: str


class BulkOperationResult(BaseModel):
    """Schema for bulk operation result"""

    updated_count: int
    failed_count: int
    errors: list[BulkAnnotationError]
