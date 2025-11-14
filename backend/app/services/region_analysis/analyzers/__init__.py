"""
Region Analyzers Package

This package contains all region detection strategies.
Each analyzer implements a specific technique for detecting UI regions.

To create a new region analyzer:
1. Create a new file in this directory (e.g., inventory_grid_detector.py)
2. Import BaseRegionAnalyzer from ..base
3. Implement the required methods:
   - analysis_type: Return RegionAnalysisType
   - name: Return unique analyzer name
   - analyze(input_data): Main detection logic
   - supported_region_types: List of RegionType this analyzer detects
4. Import and register it in ../register.py

Example analyzer structure:

    from ..base import (
        BaseRegionAnalyzer,
        RegionAnalysisType,
        RegionType,
        RegionAnalysisInput,
        RegionAnalysisResult,
        DetectedRegion,
        BoundingBox,
    )

    class InventoryGridDetector(BaseRegionAnalyzer):
        @property
        def analysis_type(self) -> RegionAnalysisType:
            return RegionAnalysisType.PATTERN_ANALYSIS

        @property
        def name(self) -> str:
            return "inventory_grid_detector"

        @property
        def supported_region_types(self) -> List[RegionType]:
            return [RegionType.INVENTORY_GRID]

        async def analyze(self, input_data: RegionAnalysisInput) -> RegionAnalysisResult:
            # Your detection logic here
            regions = []
            # ... detect inventory grids ...
            return RegionAnalysisResult(
                analyzer_type=self.analysis_type,
                analyzer_name=self.name,
                regions=regions,
                confidence=0.9,
            )
"""

# Inventory Grid Detection Analyzers
from .grid_pattern_detector import GridPatternDetector
from .corner_clustering_detector import CornerClusteringDetector
from .template_grid_detector import TemplateGridDetector
from .hough_grid_detector import HoughGridDetector
from .texture_uniformity_detector import TextureUniformityDetector
from .contour_grid_detector import ContourGridDetector
from .slot_border_detector import SlotBorderDetector
from .ransac_grid_detector import RANSACGridDetector
from .frequency_analysis_detector import FrequencyAnalysisDetector
from .color_quantization_detector import ColorQuantizationDetector

__all__ = [
    "GridPatternDetector",
    "CornerClusteringDetector",
    "TemplateGridDetector",
    "HoughGridDetector",
    "TextureUniformityDetector",
    "ContourGridDetector",
    "SlotBorderDetector",
    "RANSACGridDetector",
    "FrequencyAnalysisDetector",
    "ColorQuantizationDetector",
]
