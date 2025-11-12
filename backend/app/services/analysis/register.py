"""
Auto-registration of analyzers
"""

import logging
from .orchestrator import analyzer_registry
from .analyzers import (
    StableRegionAnalyzer,
    PatternMatchAnalyzer,
    SingleShotAnalyzer,
)

logger = logging.getLogger(__name__)


def register_default_analyzers():
    """Register all default analyzers"""
    logger.info("Registering default analyzers...")

    analyzer_registry.register(StableRegionAnalyzer)
    analyzer_registry.register(PatternMatchAnalyzer)
    analyzer_registry.register(SingleShotAnalyzer)

    registered = analyzer_registry.list_analyzers()
    logger.info(f"Registered {len(registered)} analyzers:")
    for analyzer in registered:
        logger.info(f"  - {analyzer['name']} ({analyzer['type']})")


# Auto-register on import
register_default_analyzers()
