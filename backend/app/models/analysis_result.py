"""
Analysis Result models for storing GUI element analysis results
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class AnalysisJob(Base):
    """
    Analysis job - represents a full analysis run on an annotation set
    """

    __tablename__ = "analysis_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    annotation_set_id = Column(
        UUID(as_uuid=True),
        ForeignKey("annotation_sets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Analysis configuration
    analyzers_used = Column(JSON, nullable=False)  # List of analyzer names
    parameters = Column(JSON)  # Parameters used for analysis
    fusion_enabled = Column(Integer, nullable=False, default=1)  # Boolean as int
    fusion_config = Column(JSON)  # Fusion system configuration

    # Status and timing
    status = Column(String, nullable=False, default="pending", index=True)
    # Status: pending, running, completed, failed
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    error_message = Column(Text)

    # Results summary
    total_elements_found = Column(Integer, default=0)
    total_fused_elements = Column(Integer, default=0)
    analyzer_statistics = Column(JSON)  # Statistics per analyzer

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Relationships
    annotation_set = relationship("AnnotationSet", foreign_keys=[annotation_set_id])
    created_by = relationship("User")
    analyzer_results = relationship(
        "AnalyzerResult", back_populates="analysis_job", cascade="all, delete-orphan"
    )
    fused_elements = relationship(
        "FusedElement", back_populates="analysis_job", cascade="all, delete-orphan"
    )


class AnalyzerResult(Base):
    """
    Result from a single analyzer within an analysis job
    """

    __tablename__ = "analyzer_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Analyzer info
    analyzer_name = Column(String, nullable=False, index=True)
    analyzer_type = Column(String, nullable=False, index=True)
    # Type: stable_region, pattern_match, single_shot, custom
    analyzer_version = Column(String)

    # Results
    elements_found = Column(Integer, default=0)
    confidence = Column(Float)  # Overall confidence from analyzer
    analyzer_metadata = Column(JSON)  # Analyzer-specific metadata

    # Timing
    execution_time_ms = Column(Integer)  # Execution time in milliseconds

    # Relationships
    analysis_job = relationship("AnalysisJob", back_populates="analyzer_results")
    detected_elements = relationship(
        "DetectedElementModel",
        back_populates="analyzer_result",
        cascade="all, delete-orphan",
    )


class DetectedElementModel(Base):
    """
    A single detected element from an analyzer
    """

    __tablename__ = "detected_elements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analyzer_result_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analyzer_results.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Bounding box
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)

    # Element info
    confidence = Column(Float, nullable=False)
    label = Column(String)
    element_type = Column(String, index=True)  # button, input, image, etc.
    screenshot_index = Column(Integer, default=0, nullable=False, index=True)

    # Additional data
    element_metadata = Column(JSON)

    # Relationships
    analyzer_result = relationship("AnalyzerResult", back_populates="detected_elements")

    __table_args__ = (
        Index(
            "ix_detected_elements_analyzer_screenshot",
            "analyzer_result_id",
            "screenshot_index",
        ),
    )


class FusedElement(Base):
    """
    Fused element from combining multiple analyzer results
    """

    __tablename__ = "fused_elements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Bounding box (averaged from sources)
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)

    # Fusion results
    confidence = Column(Float, nullable=False)  # Combined confidence
    votes = Column(Integer, nullable=False)  # Number of analyzers that detected this
    sources = Column(JSON, nullable=False)  # List of analyzer names
    source_confidences = Column(JSON, nullable=False)  # Dict of {analyzer: confidence}

    # Element info
    label = Column(String)
    element_type = Column(String, index=True)
    screenshot_index = Column(Integer, default=0, nullable=False, index=True)

    # Additional data
    element_metadata = Column(JSON)

    # Relationships
    analysis_job = relationship("AnalysisJob", back_populates="fused_elements")

    __table_args__ = (
        Index(
            "ix_fused_elements_job_screenshot", "analysis_job_id", "screenshot_index"
        ),
        Index("ix_fused_elements_confidence", "confidence"),
        Index("ix_fused_elements_votes", "votes"),
    )
