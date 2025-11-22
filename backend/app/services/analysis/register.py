"""
Auto-registration of analyzers
"""

import logging

from .analyzers import (  # Stable Region; Pattern Match; Single Shot; Specialized GUI Element Detectors
    DropdownDetector,
    IconButtonDetector,
    InputFieldDetector,
    MenuBarDetector,
    ModalDialogDetector,
    PatternFeatureMatchAnalyzer,
    PatternTemplateMatchAnalyzer,
    SidebarDetector,
    SingleShotColorAnalyzer,
    SingleShotEdgeAnalyzer,
    StableRegionDifferenceAnalyzer,
    StableRegionVarianceAnalyzer,
)
from .orchestrator import analyzer_registry

logger = logging.getLogger(__name__)


def register_default_analyzers():
    """Register all default analyzers"""
    logger.info("Registering default analyzers...")

    # Register Stable Region analyzers
    analyzer_registry.register(StableRegionVarianceAnalyzer)
    analyzer_registry.register(StableRegionDifferenceAnalyzer)

    # Register Pattern Match analyzers
    analyzer_registry.register(PatternTemplateMatchAnalyzer)
    analyzer_registry.register(PatternFeatureMatchAnalyzer)

    # Register Single Shot analyzers
    analyzer_registry.register(SingleShotEdgeAnalyzer)
    analyzer_registry.register(SingleShotColorAnalyzer)

    # Register Specialized GUI Element Detectors
    analyzer_registry.register(InputFieldDetector)
    analyzer_registry.register(DropdownDetector)
    analyzer_registry.register(MenuBarDetector)
    analyzer_registry.register(SidebarDetector)
    analyzer_registry.register(IconButtonDetector)
    analyzer_registry.register(ModalDialogDetector)

    registered = analyzer_registry.list_analyzers()
    logger.info(f"Registered {len(registered)} analyzers:")
    for analyzer in registered:
        logger.info(f"  - {analyzer['name']} ({analyzer['type']})")


# Auto-register on import
register_default_analyzers()
