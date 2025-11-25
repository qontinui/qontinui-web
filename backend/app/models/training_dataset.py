"""
Training Dataset models for ML training data management.

These models store datasets exported from qontinui-runner's Training Data Exporter,
allowing for curation, review, and export to various ML training formats.
"""

import uuid
from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional

from app.db.base import Base
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship


class DatasetSource(str, PyEnum):
    """Source of the dataset"""
    RUNNER_EXPORT = "runner_export"
    MANUAL_UPLOAD = "manual_upload"
    MERGED = "merged"


class AnnotationSource(str, PyEnum):
    """Source of annotation detection"""
    USER_CLICK = "user_click"
    TEMPLATE_MATCHING = "template_matching"
    SMART_CLICK_ANALYSIS = "smart_click_analysis"
    MANUAL = "manual"


class ElementType(str, PyEnum):
    """Type of GUI element"""
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


class ReviewStatus(str, PyEnum):
    """Review status for annotations"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    FLAGGED = "flagged"


class ExportFormat(str, PyEnum):
    """Export format for datasets"""
    COCO = "coco"
    YOLO = "yolo"
    PASCAL_VOC = "pascal_voc"
    CSV = "csv"
    JSONL = "jsonl"


class ExportJobStatus(str, PyEnum):
    """Status of export job"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class TrainingDataset(Base):
    """A training dataset containing images and annotations"""

    __tablename__ = "training_datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    source = Column(
        Enum(DatasetSource, name="dataset_source_enum"),
        nullable=False,
        default=DatasetSource.RUNNER_EXPORT,
    )

    # Statistics (denormalized for performance)
    total_images = Column(Integer, nullable=False, default=0)
    total_annotations = Column(Integer, nullable=False, default=0)
    reviewed_count = Column(Integer, nullable=False, default=0)

    # Metadata from export
    dataset_version = Column(String(50), nullable=True)
    export_metadata = Column(JSON, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Relationships
    images = relationship(
        "TrainingDatasetImage",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )
    annotations = relationship(
        "TrainingDatasetAnnotation",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )
    export_jobs = relationship(
        "TrainingDatasetExportJob",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )
    created_by = relationship("User")

    __table_args__ = (
        Index("ix_training_datasets_created_by", "created_by_id"),
    )


class TrainingDatasetImage(Base):
    """An image in a training dataset"""

    __tablename__ = "training_dataset_images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("training_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Image identification
    image_hash = Column(String(64), nullable=False, index=True)  # SHA256 hash
    filename = Column(String(255), nullable=False)

    # Image dimensions
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)

    # Storage
    storage_path = Column(String(512), nullable=False)

    # From manifest metadata
    action_id = Column(String(255), nullable=True)
    action_type = Column(String(100), nullable=True)
    active_states = Column(JSON, nullable=True)  # List of state names
    timestamp = Column(DateTime, nullable=True)

    # Review status
    reviewed = Column(Boolean, nullable=False, default=False)
    reviewed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    reviewer_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    dataset = relationship("TrainingDataset", back_populates="images")
    annotations = relationship(
        "TrainingDatasetAnnotation",
        back_populates="image",
        cascade="all, delete-orphan",
    )
    reviewed_by = relationship("User")

    __table_args__ = (
        Index("ix_training_dataset_images_dataset_hash", "dataset_id", "image_hash"),
        Index("ix_training_dataset_images_reviewed", "dataset_id", "reviewed"),
    )


class TrainingDatasetAnnotation(Base):
    """A bounding box annotation in a training dataset"""

    __tablename__ = "training_dataset_annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("training_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    image_id = Column(
        UUID(as_uuid=True),
        ForeignKey("training_dataset_images.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Bounding box (COCO format: x, y, width, height)
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)

    # Category
    category_id = Column(Integer, nullable=False, default=1)
    category_name = Column(String(100), nullable=False, default="gui_element")

    # Metadata
    confidence = Column(Float, nullable=False, default=1.0)
    source = Column(
        Enum(AnnotationSource, name="annotation_source_enum"),
        nullable=False,
        default=AnnotationSource.USER_CLICK,
    )
    element_type = Column(
        Enum(ElementType, name="element_type_enum"),
        nullable=True,
    )
    verified = Column(Boolean, nullable=False, default=False)

    # Smart analysis metadata (from click_analysis module)
    inference_metadata = Column(JSON, nullable=True)

    # Review workflow
    review_status = Column(
        Enum(ReviewStatus, name="review_status_enum"),
        nullable=False,
        default=ReviewStatus.PENDING,
    )
    reviewer_notes = Column(Text, nullable=True)
    reviewed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    dataset = relationship("TrainingDataset", back_populates="annotations")
    image = relationship("TrainingDatasetImage", back_populates="annotations")
    reviewed_by = relationship("User")

    __table_args__ = (
        Index("ix_training_dataset_annotations_dataset", "dataset_id"),
        Index("ix_training_dataset_annotations_image", "image_id"),
        Index("ix_training_dataset_annotations_review", "dataset_id", "review_status"),
        Index("ix_training_dataset_annotations_confidence", "dataset_id", "confidence"),
        Index("ix_training_dataset_annotations_source", "dataset_id", "source"),
    )


class TrainingDatasetExportJob(Base):
    """An export job for a training dataset"""

    __tablename__ = "training_dataset_export_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("training_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Export configuration
    format = Column(
        Enum(ExportFormat, name="export_format_enum"),
        nullable=False,
    )
    include_images = Column(Boolean, nullable=False, default=True)

    # Split configuration
    train_percent = Column(Float, nullable=True)
    val_percent = Column(Float, nullable=True)
    test_percent = Column(Float, nullable=True)
    random_seed = Column(Integer, nullable=True)

    # Filters applied
    filters = Column(JSON, nullable=True)

    # Job status
    status = Column(
        Enum(ExportJobStatus, name="export_job_status_enum"),
        nullable=False,
        default=ExportJobStatus.PENDING,
    )
    progress = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)

    # Result
    download_url = Column(String(1024), nullable=True)
    file_size = Column(Integer, nullable=True)  # Size in bytes

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Relationships
    dataset = relationship("TrainingDataset", back_populates="export_jobs")
    created_by = relationship("User")

    __table_args__ = (
        Index("ix_training_dataset_export_jobs_dataset", "dataset_id"),
        Index("ix_training_dataset_export_jobs_status", "status"),
    )
