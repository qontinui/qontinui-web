"""
Color analysis service for UI element detection.

Provides color-based analysis of images and regions to support
element detection and classification.
"""

import structlog
from PIL import Image

logger = structlog.get_logger(__name__)


class ColorAnalyzer:
    """Service for analyzing colors in images and regions."""

    @staticmethod
    def get_dominant_color(image: Image.Image) -> tuple[int, int, int]:
        """
        Get the dominant color in an image.

        Args:
            image: PIL Image to analyze

        Returns:
            RGB tuple of dominant color
        """
        import numpy as np

        try:
            img_array = np.array(image.convert("RGB"))
            pixels = img_array.reshape(-1, 3)

            # Calculate mean color as approximation of dominant color
            mean_color = np.mean(pixels, axis=0)

            return (int(mean_color[0]), int(mean_color[1]), int(mean_color[2]))

        except Exception as e:
            logger.error("dominant_color_extraction_failed", error=str(e))
            return (0, 0, 0)

    @staticmethod
    def calculate_color_variance(image: Image.Image) -> float:
        """
        Calculate color variance in an image.

        Lower variance indicates more uniform color, which can suggest
        UI elements like buttons or input fields.

        Args:
            image: PIL Image to analyze

        Returns:
            Color variance value
        """
        import numpy as np

        try:
            img_array = np.array(image.convert("RGB"))
            variance = float(np.var(img_array))

            logger.debug("color_variance_calculated", variance=variance)

            return variance

        except Exception as e:
            logger.error("color_variance_calculation_failed", error=str(e))
            return 0.0

    @staticmethod
    def is_uniform_color(
        image: Image.Image, threshold: float = 100.0
    ) -> tuple[bool, float]:
        """
        Check if an image has uniform color.

        Args:
            image: PIL Image to analyze
            threshold: Maximum variance for "uniform" classification

        Returns:
            Tuple of (is_uniform, variance_value)
        """
        variance = ColorAnalyzer.calculate_color_variance(image)
        is_uniform = variance < threshold

        logger.debug(
            "uniformity_check",
            is_uniform=is_uniform,
            variance=variance,
            threshold=threshold,
        )

        return is_uniform, variance

    @staticmethod
    def extract_color_palette(
        image: Image.Image, num_colors: int = 5
    ) -> list[tuple[int, int, int]]:
        """
        Extract a color palette from an image.

        Args:
            image: PIL Image to analyze
            num_colors: Number of dominant colors to extract

        Returns:
            List of RGB tuples representing the color palette
        """
        import numpy as np
        from sklearn.cluster import KMeans  # type: ignore[import-untyped]

        try:
            img_array = np.array(image.convert("RGB"))
            pixels = img_array.reshape(-1, 3)

            # Use K-means clustering to find dominant colors
            kmeans = KMeans(n_clusters=num_colors, random_state=42, n_init=10)
            kmeans.fit(pixels)

            colors = kmeans.cluster_centers_.astype(int)
            palette = [tuple(color) for color in colors]

            logger.debug("color_palette_extracted", num_colors=len(palette))

            return palette

        except ImportError:
            logger.warning(
                "sklearn_not_available",
                message="Cannot extract color palette without sklearn",
            )
            # Fallback: return dominant color only
            dominant = ColorAnalyzer.get_dominant_color(image)
            return [dominant]

        except Exception as e:
            logger.error("color_palette_extraction_failed", error=str(e))
            return [(0, 0, 0)]
