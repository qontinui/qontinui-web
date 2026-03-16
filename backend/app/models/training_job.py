"""Training job model for ML training pipeline integration."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


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

    DETECTION = "detection"  # Object detection (e.g., YOLO, Faster R-CNN)
    CLASSIFICATION = "classification"  # Image classification
    SEGMENTATION = "segmentation"  # Semantic/instance segmentation


class TrainingJob(Base):
    """A training job for ML model training."""

    __tablename__ = "training_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Foreign keys
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    annotation_set_id = Column(
        UUID(as_uuid=True),
        ForeignKey("annotation_sets.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Job configuration
    name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    model_type = Column(
        String(50), nullable=False, default=TrainingJobModelType.DETECTION.value
    )
    config = Column(JSON, nullable=False, default=dict)
    # Config structure:
    # {
    #     "epochs": int,
    #     "batch_size": int,
    #     "learning_rate": float,
    #     "base_model": str,  # e.g., "yolov8n", "resnet50"
    #     "augmentation": bool,
    #     "train_split": float,  # 0.0-1.0
    #     "validation_split": float,
    #     "custom_params": {}
    # }

    # Status and progress
    status = Column(String(50), nullable=False, default=TrainingJobStatus.PENDING.value)
    progress = Column(Integer, nullable=False, default=0)  # 0-100
    current_epoch = Column(Integer, nullable=True)
    total_epochs = Column(Integer, nullable=True)

    # Logs and results
    logs = Column(Text, nullable=True)  # Training logs
    error = Column(Text, nullable=True)  # Error message if failed
    metrics = Column(JSON, nullable=True)
    # Metrics structure:
    # {
    #     "train_loss": [...],
    #     "val_loss": [...],
    #     "train_accuracy": [...],
    #     "val_accuracy": [...],
    #     "mAP": float,
    #     "final_metrics": {...}
    # }

    # Output
    output_path = Column(String(500), nullable=True)  # Path to trained model artifacts
    model_url = Column(String(500), nullable=True)  # URL for model download

    # Timestamps
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("Project", backref="training_jobs")
    user = relationship("User", backref="training_jobs")
    annotation_set = relationship("AnnotationSet", backref="training_jobs")
