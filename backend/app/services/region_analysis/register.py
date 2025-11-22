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

    # Import grid detection analyzers
    try:
        from .analyzers.grid_pattern_detector import GridPatternDetector

        region_analyzer_registry.register(GridPatternDetector)
    except Exception as e:
        logger.warning(f"Failed to register GridPatternDetector: {e}")

    # Import text detection analyzers
    try:
        from .analyzers.ocr_text_detector import OCRTextDetector

        region_analyzer_registry.register(OCRTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register OCRTextDetector: {e}")

    try:
        from .analyzers.mser_text_detector import MSERTextDetector

        region_analyzer_registry.register(MSERTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register MSERTextDetector: {e}")

    try:
        from .analyzers.connected_components_text_detector import (
            ConnectedComponentsTextDetector,
        )

        region_analyzer_registry.register(ConnectedComponentsTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register ConnectedComponentsTextDetector: {e}")

    try:
        from .analyzers.stroke_width_text_detector import StrokeWidthTextDetector

        region_analyzer_registry.register(StrokeWidthTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register StrokeWidthTextDetector: {e}")

    try:
        from .analyzers.edge_morphology_text_detector import EdgeMorphologyTextDetector

        region_analyzer_registry.register(EdgeMorphologyTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register EdgeMorphologyTextDetector: {e}")

    try:
        from .analyzers.contour_text_detector import ContourTextDetector

        region_analyzer_registry.register(ContourTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register ContourTextDetector: {e}")

    try:
        from .analyzers.gradient_text_detector import GradientTextDetector

        region_analyzer_registry.register(GradientTextDetector)
    except Exception as e:
        logger.warning(f"Failed to register GradientTextDetector: {e}")

    # Import window detection analyzers
    try:
        from .analyzers.window_title_bar_detector import WindowTitleBarDetector

        region_analyzer_registry.register(WindowTitleBarDetector)
    except Exception as e:
        logger.warning(f"Failed to register WindowTitleBarDetector: {e}")

    try:
        from .analyzers.window_border_detector import WindowBorderDetector

        region_analyzer_registry.register(WindowBorderDetector)
    except Exception as e:
        logger.warning(f"Failed to register WindowBorderDetector: {e}")

    try:
        from .analyzers.window_close_button_detector import WindowCloseButtonDetector

        region_analyzer_registry.register(WindowCloseButtonDetector)
    except Exception as e:
        logger.warning(f"Failed to register WindowCloseButtonDetector: {e}")

    registered = region_analyzer_registry.list_analyzers()
    logger.info(f"Registered {len(registered)} region analyzers:")
    for analyzer in registered:
        logger.info(
            f"  - {analyzer['name']} ({analyzer['type']}) - "
            f"Supports: {', '.join(analyzer['supported_region_types'])}"
        )


# Auto-register on import
register_default_region_analyzers()
