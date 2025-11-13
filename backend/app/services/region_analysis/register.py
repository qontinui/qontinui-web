"""
Auto-registration of region analyzers

This module automatically registers all region analyzers when imported.
Add new analyzers to the imports and registration function.
"""

import logging
from .orchestrator import region_analyzer_registry

logger = logging.getLogger(__name__)


def register_default_region_analyzers():
    """
    Register all default region analyzers

    To add a new region analyzer:
    1. Import it at the top of this file
    2. Add it to the registration list below
    3. The analyzer will be automatically available to the orchestrator
    """
    logger.info("Registering default region analyzers...")

    # Import available analyzers
    try:
        from .analyzers.grid_pattern_detector import GridPatternDetector
        region_analyzer_registry.register(GridPatternDetector)
    except Exception as e:
        logger.warning(f"Failed to register GridPatternDetector: {e}")

    # NOTE: Additional analyzers can be registered here
    # When you create more region analyzers, import them and register like:
    #
    # from .analyzers import (
    #     MinimapDetector,
    #     StatusBarDetector,
    #     ToolbarDetector,
    #     DialogDetector,
    # )
    #
    # region_analyzer_registry.register(MinimapDetector)
    # region_analyzer_registry.register(StatusBarDetector)
    # region_analyzer_registry.register(ToolbarDetector)
    # region_analyzer_registry.register(DialogDetector)

    registered = region_analyzer_registry.list_analyzers()
    logger.info(f"Registered {len(registered)} region analyzers:")
    for analyzer in registered:
        logger.info(
            f"  - {analyzer['name']} ({analyzer['type']}) - "
            f"Supports: {', '.join(analyzer['supported_region_types'])}"
        )


# Auto-register on import
register_default_region_analyzers()
