"""Pydantic schemas for training job API."""

from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime


class TrainingJobStatus(StrEnum):
    """Status of a training job."""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrainingJobModelType(StrEnum):
    """Type of model to train."""

    DETECTION = "detection"
    CLASSIFICATION = "classification"
    SEGMENTATION = "segmentation"


class TrainingConfig(BaseModel):
    """Configuration for training job."""

    model_type: TrainingJobModelType = Field(
        default=TrainingJobModelType.DETECTION,
        description="Type of model to train",
    )
    epochs: int = Field(
        default=50,
        ge=1,
        le=1000,
        description="Number of training epochs",
    )
    batch_size: int = Field(
        default=16,
        ge=1,
        le=256,
        description="Batch size for training",
    )
    learning_rate: float = Field(
        default=0.001,
        gt=0,
        le=1.0,
        description="Learning rate",
    )
    base_model: str = Field(
        default="yolov8n",
        description="Base model architecture",
    )
    dataset_id: str | None = Field(
        default=None,
        description=(
            "TrainingDataset ID to export and train on. Required at "
            "/start time — the ARQ worker reads this from config to "
            "locate the dataset."
        ),
    )
    augmentation: bool = Field(
        default=True,
        description="Enable data augmentation",
    )
    train_split: float = Field(
        default=0.8,
        ge=0.1,
        le=0.95,
        description="Fraction of data for training",
    )
    validation_split: float = Field(
        default=0.2,
        ge=0.05,
        le=0.5,
        description="Fraction of data for validation",
    )
    custom_params: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional custom parameters",
    )


class TrainingJobCreate(BaseModel):
    """Request schema for creating a training job."""

    project_id: str = Field(..., description="Project ID")
    annotation_set_id: str | None = Field(
        None, description="Annotation set to use for training"
    )
    name: str | None = Field(None, max_length=255, description="Job name")
    description: str | None = Field(None, description="Job description")
    config: TrainingConfig = Field(
        default_factory=TrainingConfig,
        description="Training configuration",
    )


class TrainingJobUpdate(BaseModel):
    """Request schema for updating a training job."""

    name: str | None = Field(None, max_length=255)
    description: str | None = None
    status: TrainingJobStatus | None = None
    progress: int | None = Field(None, ge=0, le=100)
    current_epoch: int | None = None
    logs: str | None = None
    error: str | None = None
    metrics: dict[str, Any] | None = None
    output_path: str | None = None
    model_url: str | None = None


class TrainingJobResponse(BaseModel):
    """Response schema for a training job."""

    id: str
    project_id: str
    user_id: str | None
    annotation_set_id: str | None
    name: str | None
    description: str | None
    model_type: str
    config: dict[str, Any]
    status: str
    progress: int
    current_epoch: int | None
    total_epochs: int | None
    logs: str | None
    error: str | None
    metrics: dict[str, Any] | None
    output_path: str | None
    model_url: str | None
    created_at: IsoDatetime
    updated_at: IsoDatetime
    started_at: IsoDatetime | None
    completed_at: IsoDatetime | None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "project_id", "user_id", "annotation_set_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return v


class TrainingJobListResponse(BaseModel):
    """Response schema for listing training jobs."""

    jobs: list[TrainingJobResponse]
    total: int
    skip: int
    limit: int


class TrainingEstimate(BaseModel):
    """Estimated time and cost for training."""

    estimated_time_minutes: int = Field(
        ..., description="Estimated training time in minutes"
    )
    estimated_cost_usd: float | None = Field(
        None, description="Estimated cost in USD (if applicable)"
    )
    gpu_type: str = Field(default="T4", description="GPU type for estimation")
    notes: str | None = Field(None, description="Additional notes about estimate")
