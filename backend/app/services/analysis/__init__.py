"""
Modular GUI element analysis system

This package provides a pluggable architecture for analyzing screenshots
to detect GUI elements using multiple analysis methods.
"""

from .base import AnalysisResult, BaseAnalyzer, AnalysisType
from .orchestrator import AnalysisOrchestrator
from .fusion import DecisionFusion

# Import register module to trigger analyzer registration
from . import register  # noqa: F401

__all__ = [
    "AnalysisResult",
    "BaseAnalyzer",
    "AnalysisType",
    "AnalysisOrchestrator",
    "DecisionFusion",
]
