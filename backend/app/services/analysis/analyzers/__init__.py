"""
Analyzer implementations
"""

# Stable Region Analyzers
from .stable_region_variance import StableRegionVarianceAnalyzer
from .stable_region_difference import StableRegionDifferenceAnalyzer

# Pattern Match Analyzers
from .pattern_template_match import PatternTemplateMatchAnalyzer
from .pattern_feature_match import PatternFeatureMatchAnalyzer

# Single Shot Analyzers
from .single_shot_edge import SingleShotEdgeAnalyzer
from .single_shot_color import SingleShotColorAnalyzer

__all__ = [
    # Stable Region
    "StableRegionVarianceAnalyzer",
    "StableRegionDifferenceAnalyzer",
    # Pattern Match
    "PatternTemplateMatchAnalyzer",
    "PatternFeatureMatchAnalyzer",
    # Single Shot
    "SingleShotEdgeAnalyzer",
    "SingleShotColorAnalyzer",
]
