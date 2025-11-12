"""
Modular GUI element analysis system

This package provides a pluggable architecture for analyzing screenshots
to detect GUI elements using multiple analysis methods.
"""

from .base import AnalysisResult, BaseAnalyzer, AnalysisType
from .orchestrator import AnalysisOrchestrator
from .fusion import DecisionFusion

__all__ = [
    "AnalysisResult",
    "BaseAnalyzer",
    "AnalysisType",
    "AnalysisOrchestrator",
    "DecisionFusion",
]
