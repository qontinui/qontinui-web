"""
Visual testing services.

Consolidates baseline management and visual comparison into a single package.
Re-exports BaselineManagementService and VisualComparisonService with their
singleton instances for backward compatibility.
"""

from app.services.visual_testing.baseline_creation import BaselineCreation
from app.services.visual_testing.baseline_crud import BaselineCrud
from app.services.visual_testing.baseline_history import BaselineHistory
from app.services.visual_testing.baseline_image_processing import (
    BaselineImageProcessing,
)
from app.services.visual_testing.comparison_engine import ComparisonEngine
from app.services.visual_testing.comparison_service import ComparisonService
from app.services.visual_testing.comparison_stats import ComparisonStats


class BaselineManagementService(BaselineCreation, BaselineHistory):
    """Service for managing visual regression baselines.

    Composes all baseline operations: CRUD, creation, history/rollback,
    and image processing.
    """

    def __init__(self):
        BaselineCreation.__init__(self)
        BaselineHistory.__init__(self)


class VisualComparisonService(ComparisonService, ComparisonStats):
    """Service for visual regression comparisons.

    Composes comparison workflow, review management, and statistics.
    """

    def __init__(self):
        ComparisonService.__init__(self)


# Singleton instances
baseline_management_service = BaselineManagementService()
visual_comparison_service = VisualComparisonService()

__all__ = [
    "BaselineManagementService",
    "VisualComparisonService",
    "baseline_management_service",
    "visual_comparison_service",
    "BaselineCrud",
    "BaselineCreation",
    "BaselineHistory",
    "BaselineImageProcessing",
    "ComparisonEngine",
    "ComparisonService",
    "ComparisonStats",
]
