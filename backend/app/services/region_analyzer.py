"""
Region analysis service for UI element detection.

Performs basic region detection using image analysis techniques
when advanced API-based detection is unavailable.
"""

import structlog
from PIL import Image

logger = structlog.get_logger(__name__)


class RegionAnalyzer:
    """Service for analyzing image regions to detect potential UI elements."""

    @staticmethod
    def detect_uniform_regions(
        image: Image.Image,
        grid_size: int = 50,
        variance_threshold: float = 100.0,
        max_regions: int = 50,
    ) -> list[dict]:
        """
        Detect uniform color regions that might be UI elements.

        Uses a grid-based approach to find regions with low color variance,
        which often indicate buttons, input fields, or other UI components.

        Args:
            image: PIL Image to analyze
            grid_size: Size of grid cells in pixels
            variance_threshold: Maximum variance for "uniform" regions
            max_regions: Maximum number of regions to return

        Returns:
            List of detected region dictionaries with bounding boxes
        """
        import numpy as np

        try:
            # Convert to numpy array
            img_array = np.array(image.convert("RGB"))
            height, width = img_array.shape[:2]

            regions = []

            # Split image into grid and check for color uniformity
            for y in range(0, height - grid_size, grid_size):
                for x in range(0, width - grid_size, grid_size):
                    region = img_array[y : y + grid_size, x : x + grid_size]

                    # Check if region has low variance (uniform color)
                    variance = np.var(region)
                    if variance < variance_threshold:
                        element = {
                            "element_type": "region",
                            "x": x,
                            "y": y,
                            "width": grid_size,
                            "height": grid_size,
                            "text_content": None,
                            "confidence": 0.3,  # Low confidence for basic detection
                            "properties": {
                                "detection_method": "basic_grid",
                                "color_variance": float(variance),
                            },
                        }
                        regions.append(element)

            logger.info(
                "region_detection_completed",
                total_regions=len(regions),
                returned_regions=min(len(regions), max_regions),
            )

            return regions[:max_regions]

        except Exception as e:
            logger.error("region_detection_failed", error=str(e))
            return []

    @staticmethod
    def analyze_region_color(
        image: Image.Image, x: int, y: int, width: int, height: int
    ) -> dict:
        """
        Analyze color properties of a specific region.

        Args:
            image: PIL Image to analyze
            x: Region x coordinate
            y: Region y coordinate
            width: Region width
            height: Region height

        Returns:
            Dictionary with color statistics (mean, variance, dominant color)
        """
        import numpy as np

        try:
            img_array = np.array(image.convert("RGB"))
            region = img_array[y : y + height, x : x + width]

            mean_color = np.mean(region, axis=(0, 1))
            variance = np.var(region)

            return {
                "mean_color": mean_color.tolist(),
                "variance": float(variance),
                "is_uniform": variance < 100.0,
            }

        except Exception as e:
            logger.error("color_analysis_failed", error=str(e))
            return {
                "mean_color": [0, 0, 0],
                "variance": 0.0,
                "is_uniform": False,
            }
