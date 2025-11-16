"""
Region Analysis Result models for storing specialized region detection results
"""

from sqlalchemy import Column, String, Integer, Text, JSON, DateTime, ForeignKey, Float, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base
import uuid


class RegionAnalysisJob(Base):
    """
    Region analysis job - represents a full region analysis run on an annotation set
    """
    __tablename__ = "region_analysis_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    annotation_set_id = Column(
        UUID(as_uuid=True),
        ForeignKey("annotation_sets.id", ondelete="CASCADE"),
        nullable=False,
        index=True
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
    total_regions_found = Column(Integer, default=0)
    total_fused_regions = Column(Integer, default=0)
    analyzer_statistics = Column(JSON)  # Statistics per analyzer

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Relationships
    annotation_set = relationship("AnnotationSet", foreign_keys=[annotation_set_id])
    created_by = relationship("User")
    analyzer_results = relationship(
        "RegionAnalyzerResult",
        back_populates="analysis_job",
        cascade="all, delete-orphan"
    )
    fused_regions = relationship(
        "FusedRegionModel",
        back_populates="analysis_job",
        cascade="all, delete-orphan"
    )


class RegionAnalyzerResult(Base):
    """
    Result from a single region analyzer within an analysis job
    """
    __tablename__ = "region_analyzer_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("region_analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Analyzer info
    analyzer_name = Column(String, nullable=False, index=True)
    analyzer_version = Column(String)

    # Results
    regions_found = Column(Integer, default=0)
    confidence = Column(Float)  # Overall confidence from analyzer
    analyzer_metadata = Column(JSON)  # Analyzer-specific metadata

    # Timing
    execution_time_ms = Column(Integer)  # Execution time in milliseconds

    # Relationships
    analysis_job = relationship("RegionAnalysisJob", back_populates="analyzer_results")
    detected_regions = relationship(
        "DetectedRegionModel",
        back_populates="analyzer_result",
        cascade="all, delete-orphan"
    )


class DetectedRegionModel(Base):
    """
    A single detected region from an analyzer
    Includes full grid structure metadata for inventory grids, etc.
    """
    __tablename__ = "detected_regions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analyzer_result_id = Column(
        UUID(as_uuid=True),
        ForeignKey("region_analyzer_results.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Bounding box
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)

    # Region info
    confidence = Column(Float, nullable=False)
    label = Column(String)
    region_type = Column(String, index=True)  # inventory_grid, minimap, skill_bar, etc.
    screenshot_index = Column(Integer, default=0, nullable=False, index=True)

    # Grid structure metadata (for inventory grids, skill bars, etc.)
    # This stores the detected grid structure
    grid_metadata = Column(JSON)
    # Format: {
    #   "rows": int,
    #   "cols": int,
    #   "cells": [{"x": int, "y": int, "width": int, "height": int}, ...],
    #   "cell_spacing": int,
    #   "cell_size": {"width": int, "height": int}
    # }

    # Additional metadata
    region_metadata = Column(JSON)

    # Relationships
    analyzer_result = relationship("RegionAnalyzerResult", back_populates="detected_regions")

    __table_args__ = (
        Index('ix_detected_regions_analyzer_screenshot', 'analyzer_result_id', 'screenshot_index'),
        Index('ix_detected_regions_type', 'region_type'),
    )


class FusedRegionModel(Base):
    """
    Fused region from combining multiple analyzer results
    Includes full grid structure from fusion
    """
    __tablename__ = "fused_regions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("region_analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
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

    # Region info
    label = Column(String)
    region_type = Column(String, index=True)
    screenshot_index = Column(Integer, default=0, nullable=False, index=True)

    # Grid structure metadata (fused from multiple sources)
    grid_metadata = Column(JSON)
    # Same format as DetectedRegionModel.grid_metadata

    # Additional metadata
    region_metadata = Column(JSON)

    # Relationships
    analysis_job = relationship("RegionAnalysisJob", back_populates="fused_regions")

    __table_args__ = (
        Index('ix_fused_regions_job_screenshot', 'analysis_job_id', 'screenshot_index'),
        Index('ix_fused_regions_confidence', 'confidence'),
        Index('ix_fused_regions_votes', 'votes'),
        Index('ix_fused_regions_type', 'region_type'),
    )
