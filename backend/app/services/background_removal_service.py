"""
Background Removal Service

Wraps the qontinui background removal functionality for use in the API.
"""

import logging
import sys
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Add qontinui directory to Python path
QONTINUI_PATH = Path(__file__).parent.parent.parent.parent.parent / "qontinui"
if QONTINUI_PATH.exists():
    sys.path.insert(0, str(QONTINUI_PATH))
    logger.info(f"Added qontinui path: {QONTINUI_PATH}")
else:
    logger.warning(f"Qontinui path not found: {QONTINUI_PATH}")


class BackgroundRemovalService:
    """Service for removing backgrounds from screenshots."""

    def __init__(self, config_dict: dict[str, Any] | None = None):
        """
        Initialize the background removal service.

        Args:
            config_dict: Configuration dictionary with parameters
        """
        try:
            # Import qontinui background removal module
            from discovery.background_removal import (
                BackgroundRemovalAnalyzer,
                BackgroundRemovalConfig,
            )

            # Convert snake_case to camelCase for config
            if config_dict:
                # Map snake_case keys to what the Python module expects
                python_config = {
                    "use_temporal_variance": config_dict.get(
                        "use_temporal_variance", True
                    ),
                    "use_edge_density": config_dict.get("use_edge_density", True),
                    "use_uniformity": config_dict.get("use_uniformity", True),
                    "variance_threshold": config_dict.get("variance_threshold", 20.0),
                    "min_screenshots_for_variance": config_dict.get(
                        "min_screenshots_for_variance", 3
                    ),
                    "edge_density_threshold": config_dict.get(
                        "edge_density_threshold", 0.05
                    ),
                    "edge_kernel_size": config_dict.get("edge_kernel_size", 3),
                    "uniformity_threshold": config_dict.get(
                        "uniformity_threshold", 15.0
                    ),
                    "uniformity_region_size": config_dict.get(
                        "uniformity_region_size", 20
                    ),
                    "apply_morphology": config_dict.get("apply_morphology", True),
                    "morphology_kernel_size": config_dict.get(
                        "morphology_kernel_size", 3
                    ),
                    "min_foreground_region_size": config_dict.get(
                        "min_foreground_region_size", 50
                    ),
                    "foreground_alpha": config_dict.get("foreground_alpha", 255),
                    "background_alpha": config_dict.get("background_alpha", 0),
                }

                config = BackgroundRemovalConfig(**python_config)
            else:
                config = BackgroundRemovalConfig()

            self.analyzer = BackgroundRemovalAnalyzer(config)
            logger.info("BackgroundRemovalService initialized successfully")

        except ImportError as e:
            logger.error(f"Failed to import qontinui modules: {e}")
            logger.error(
                "Make sure the qontinui library is accessible from the backend directory"
            )
            raise RuntimeError(
                f"Failed to import qontinui background removal module: {e}"
            ) from e

    def remove_backgrounds(
        self, screenshots: list[np.ndarray], debug: bool = False
    ) -> tuple[list[np.ndarray], dict[str, Any]]:
        """
        Remove backgrounds from screenshots.

        Args:
            screenshots: List of BGR screenshot images
            debug: If True, include debug information

        Returns:
            Tuple of (masked_screenshots, statistics)
        """
        try:
            masked_screenshots, stats = self.analyzer.remove_backgrounds(
                screenshots, debug=debug
            )

            logger.info(
                f"Processed {len(screenshots)} screenshots: "
                f"{stats['foreground_percentage']:.1f}% foreground"
            )

            return masked_screenshots, stats

        except Exception as e:
            logger.error(f"Background removal failed: {e}", exc_info=True)
            raise RuntimeError(f"Background removal processing failed: {e}") from e

    def visualize_mask(
        self, screenshot: np.ndarray, background_mask: np.ndarray
    ) -> np.ndarray:
        """
        Create visualization of background mask overlay.

        Args:
            screenshot: Original screenshot
            background_mask: Background mask

        Returns:
            Visualization image
        """
        try:
            return self.analyzer.visualize_mask(screenshot, background_mask)
        except Exception as e:
            logger.error(f"Visualization failed: {e}")
            raise RuntimeError(f"Mask visualization failed: {e}") from e
