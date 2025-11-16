"""
Region Analysis Framework

A modular system for detecting important regions in screenshots
(e.g., inventory grids, minimaps, toolbars, status bars).

This is parallel to the element detection system but focuses on larger
functional areas rather than individual UI components.

Usage:
    from app.services.region_analysis import (
        RegionOrchestrator,
        RegionAnalysisInput,
        RegionType,
        DetectedRegion,
    )

    # Create orchestrator
    orchestrator = RegionOrchestrator()

    # Prepare input
    input_data = RegionAnalysisInput(
        annotation_set_id=annotation_set_id,
        screenshots=screenshots,
        screenshot_data=screenshot_data,
    )

    # Run analysis
    results = await orchestrator.analyze(input_data)

    # Access fused regions
    regions = results["fused_regions"]
"""

# Import base classes and data structures
from .base import (
    RegionType,
    RegionAnalysisType,
    BoundingBox,
    DetectedRegion,
    RegionAnalysisResult,
    RegionAnalysisInput,
    BaseRegionAnalyzer,
)

# Import orchestration
from .orchestrator import (
    RegionAnalyzerRegistry,
    RegionOrchestrator,
    region_analyzer_registry,
)

# Import fusion
from .fusion import (
    FusedRegion,
    RegionFusionStrategy,
    WeightedVotingRegionFusion,
    RegionFusion,
)

# Import registration (triggers auto-registration)
from . import register

__all__ = [
    # Base types
    "RegionType",
    "RegionAnalysisType",
    "BoundingBox",
    "DetectedRegion",
    "RegionAnalysisResult",
    "RegionAnalysisInput",
    "BaseRegionAnalyzer",
    # Orchestration
    "RegionAnalyzerRegistry",
    "RegionOrchestrator",
    "region_analyzer_registry",
    # Fusion
    "FusedRegion",
    "RegionFusionStrategy",
    "WeightedVotingRegionFusion",
    "RegionFusion",
]
