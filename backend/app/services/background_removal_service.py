"""
Background Removal Service

Wraps the qontinui background removal functionality for use in the API.
"""

import sys
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

# Add qontinui directory to Python path
QONTINUI_PATH = Path(__file__).parent.parent.parent.parent.parent / "qontinui"
if QONTINUI_PATH.exists():
    sys.path.insert(0, str(QONTINUI_PATH))
    logger.info(f"Added qontinui path: {QONTINUI_PATH}")
else:
    logger.warning(f"Qontinui path not found: {QONTINUI_PATH}")


class BackgroundRemovalService:
    """Service for removing backgrounds from screenshots using base64 strings."""

    def __init__(self, config_dict: dict[str, Any] | None = None):
        """
        Initialize the background removal service.

        Args:
            config_dict: Configuration dictionary with parameters
        """
        try:
            # Import qontinui background removal module
            from discovery.background_removal import (  # type: ignore[import-not-found]
                BackgroundRemovalConfig,
                remove_backgrounds_from_base64,
            )

            # Store the function for use in remove_backgrounds
            self._remove_backgrounds_from_base64 = remove_backgrounds_from_base64

            # Convert config dict to BackgroundRemovalConfig
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

                self.config = BackgroundRemovalConfig(**python_config)
            else:
                self.config = None

            logger.info("BackgroundRemovalService initialized successfully")

        except ImportError as e:
            logger.error(f"Failed to import qontinui modules: {e}")
            logger.error(
                "Make sure the qontinui library is accessible from the backend directory"
            )
            raise RuntimeError(
                f"Failed to import qontinui background removal module: {e}"
            ) from e

    def remove_backgrounds_base64(
        self, base64_screenshots: list[str], debug: bool = False
    ) -> tuple[list[str], dict[str, Any]]:
        """
        Remove backgrounds from base64-encoded screenshots.

        Args:
            base64_screenshots: List of base64 encoded screenshot strings
            debug: If True, include debug information

        Returns:
            Tuple of (base64_masked_screenshots, statistics)
        """
        try:
            masked_screenshots, stats = self._remove_backgrounds_from_base64(
                base64_screenshots, config=self.config, debug=debug
            )

            logger.info(
                f"Processed {len(base64_screenshots)} screenshots: "
                f"{stats['foreground_percentage']:.1f}% foreground"
            )

            return masked_screenshots, stats

        except Exception as e:
            logger.error(f"Background removal failed: {e}", exc_info=True)
            raise RuntimeError(f"Background removal processing failed: {e}") from e
