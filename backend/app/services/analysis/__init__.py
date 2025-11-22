"""
Modular GUI element analysis system

This package provides a pluggable architecture for analyzing screenshots
to detect GUI elements using multiple analysis methods.
"""

# Import register module to trigger analyzer registration
from . import register  # noqa: F401
from .base import AnalysisResult, AnalysisType, BaseAnalyzer
from .fusion import DecisionFusion
from .orchestrator import AnalysisOrchestrator

__all__ = [
    "AnalysisResult",
    "BaseAnalyzer",
    "AnalysisType",
    "AnalysisOrchestrator",
    "DecisionFusion",
]
