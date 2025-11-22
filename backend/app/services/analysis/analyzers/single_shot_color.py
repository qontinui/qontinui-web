"""
Single Shot Analyzer - Color Segmentation Method

Detects GUI elements using color-based segmentation. Good for finding
colored buttons, highlights, and distinct visual elements.
"""

import logging
from io import BytesIO
from typing import Any, Dict, List

import cv2
import numpy as np
from PIL import Image

from ..base import (
    AnalysisInput,
    AnalysisResult,
    AnalysisType,
    BaseAnalyzer,
    BoundingBox,
    DetectedElement,
)

logger = logging.getLogger(__name__)


class SingleShotColorAnalyzer(BaseAnalyzer):
    """
    Detects GUI elements using color segmentation

    Algorithm:
    1. Convert to HSV color space
    2. Find regions with distinct colors
    3. Use K-means clustering to identify color groups
    4. Segment image by dominant colors
    5. Extract bounding boxes from color regions
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "single_shot_color"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            "num_colors": 8,  # Number of dominant colors to find
            "min_area": 400,
            "max_area": 50000,
            "min_aspect_ratio": 0.1,
            "max_aspect_ratio": 10.0,
            "saturation_threshold": 30,  # Minimum saturation for colored elements
            "morph_kernel_size": 5,
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform color-based GUI element detection"""
        logger.info(
            f"Running color-based single-shot analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images in color
        images = self._load_images_color(input_data.screenshot_data)

        # Analyze each screenshot
        all_elements = []
        for screenshot_idx, img in enumerate(images):
            elements = await self._analyze_screenshot(img, screenshot_idx, params)
            all_elements.extend(elements)

        logger.info(f"Found {len(all_elements)} elements across all screenshots")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=0.68,
            metadata={
                "num_screenshots": len(images),
                "method": "color_segmentation",
                "parameters": params,
            },
        )

    def _load_images_color(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots in color"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(np.array(img, dtype=np.uint8))
        return images

    async def _analyze_screenshot(
        self, img: np.ndarray, screenshot_idx: int, params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """Analyze a single screenshot"""
        elements = []

        # Convert to HSV for better color segmentation
        hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)

        # Find dominant colors using K-means
        dominant_colors = self._find_dominant_colors(img, params["num_colors"])

        # For each dominant color, find regions
        for color_idx, color in enumerate(dominant_colors):
            # Create mask for this color
            mask = self._create_color_mask(hsv, color, params)

            if mask is None or np.sum(mask) == 0:
                continue

            # Clean up mask
            mask = self._clean_mask(mask, params)

            # Find contours
            contours, _ = cv2.findContours(
                mask.astype(np.uint8) * 255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)

                area = w * h
                aspect_ratio = w / h if h > 0 else 0

                # Filter by size and aspect ratio
                if not (params["min_area"] <= area <= params["max_area"]):
                    continue
                if not (
                    params["min_aspect_ratio"]
                    <= aspect_ratio
                    <= params["max_aspect_ratio"]
                ):
                    continue

                # Calculate color distinctiveness (saturation)
                region_hsv = hsv[y : y + h, x : x + w]
                mean_saturation = np.mean(region_hsv[:, :, 1])

                if mean_saturation < params["saturation_threshold"]:
                    continue  # Skip low-saturation (grayish) regions

                # Confidence based on color distinctiveness
                confidence = min(0.9, 0.4 + (mean_saturation / 255.0) * 0.5)

                elements.append(
                    DetectedElement(
                        bounding_box=BoundingBox(
                            x=int(x), y=int(y), width=int(w), height=int(h)
                        ),
                        confidence=confidence,
                        label="Colored Element",
                        element_type="colored_element",
                        screenshot_index=screenshot_idx,
                        metadata={
                            "method": "color_segmentation",
                            "color_idx": color_idx,
                            "mean_saturation": float(mean_saturation),
                            "area": int(area),
                        },
                    )
                )

        return elements

    def _find_dominant_colors(
        self, img: np.ndarray, num_colors: int
    ) -> List[np.ndarray]:
        """
        Find dominant colors using K-means clustering

        Returns:
            List of dominant colors in HSV space
        """
        # Reshape image to be a list of pixels
        pixels = img.reshape((-1, 3)).astype(np.float32)

        # Sample pixels to speed up computation
        if len(pixels) > 10000:
            indices = np.random.choice(len(pixels), 10000, replace=False)
            pixels = pixels[indices]

        # Apply K-means
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
        _, labels, centers = cv2.kmeans(
            pixels, num_colors, None, criteria, 10, cv2.KMEANS_PP_CENTERS
        )

        # Convert centers to HSV
        centers_rgb = centers.reshape((1, num_colors, 3)).astype(np.uint8)
        centers_hsv = cv2.cvtColor(centers_rgb, cv2.COLOR_RGB2HSV)[0]

        return centers_hsv

    def _create_color_mask(
        self, hsv: np.ndarray, color: np.ndarray, params: Dict[str, Any]
    ) -> np.ndarray:
        """
        Create binary mask for pixels close to the given color

        Args:
            hsv: Image in HSV space
            color: Target color in HSV
            params: Parameters

        Returns:
            Binary mask
        """
        # Define color range (hue wraps around at 180)
        hue_range = 15  # +/- degrees
        sat_range = 50  # +/- saturation
        val_range = 50  # +/- value

        lower = np.array(
            [
                max(0, color[0] - hue_range),
                max(0, color[1] - sat_range),
                max(0, color[2] - val_range),
            ]
        )

        upper = np.array(
            [
                min(180, color[0] + hue_range),
                min(255, color[1] + sat_range),
                min(255, color[2] + val_range),
            ]
        )

        # Create mask
        mask = cv2.inRange(hsv, lower, upper)

        return mask

    def _clean_mask(self, mask: np.ndarray, params: Dict[str, Any]) -> np.ndarray:
        """Clean up binary mask using morphological operations"""
        kernel_size = params["morph_kernel_size"]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))

        # Close small holes
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        # Remove small noise
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        return mask > 0
