"""
Stable Region Analyzer - Variance-Based Method

Detects GUI elements that remain in the same position across multiple screenshots
using pixel-wise variance analysis.
"""

import logging
from typing import Dict, Any, List, Tuple
from io import BytesIO
from PIL import Image
import numpy as np
import cv2

from ..base import (
    BaseAnalyzer,
    AnalysisType,
    AnalysisInput,
    AnalysisResult,
    DetectedElement,
    BoundingBox,
)

logger = logging.getLogger(__name__)


class StableRegionVarianceAnalyzer(BaseAnalyzer):
    """
    Finds stable regions using variance analysis

    Algorithm:
    1. Convert all images to grayscale
    2. Compute pixel-wise variance across all images
    3. Threshold to get stability mask (low variance = stable)
    4. Apply morphological operations to clean up
    5. Find contours to get bounding boxes
    6. Filter by size and aspect ratio
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.STABLE_REGION

    @property
    def name(self) -> str:
        return "stable_region_variance"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 2

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            "variance_threshold": 100.0,  # Pixels with variance below this are "stable"
            "min_area": 400,  # Minimum element area (20x20)
            "max_area": 100000,  # Maximum element area
            "min_aspect_ratio": 0.2,  # Min width/height ratio
            "max_aspect_ratio": 5.0,  # Max width/height ratio
            "morph_kernel_size": 5,  # Morphological operation kernel size
            "blur_kernel_size": 5,  # Gaussian blur to reduce noise
        }

    def validate_input(self, input_data: AnalysisInput) -> bool:
        return len(input_data.screenshots) >= self.required_screenshots

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform variance-based stable region analysis"""
        logger.info(
            f"Running variance-based stable region analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images as grayscale
        images = self._load_images_grayscale(input_data.screenshot_data)

        # Ensure all images have the same size
        images = self._resize_to_common_size(images)

        # Compute variance map
        variance_map = self._compute_variance(images)

        # Threshold to get stable regions
        stability_mask = variance_map < params["variance_threshold"]

        # Clean up mask with morphological operations
        stability_mask = self._clean_mask(stability_mask, params)

        # Find contours and create bounding boxes
        elements = self._find_elements_from_mask(stability_mask, params)

        logger.info(f"Found {len(elements)} stable regions")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.85,
            metadata={
                "num_screenshots": len(images),
                "method": "variance",
                "parameters": params,
                "mean_variance": float(np.mean(variance_map)),
                "stable_pixel_percentage": float(np.sum(stability_mask) / stability_mask.size * 100),
            },
        )

    def _load_images_grayscale(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots as grayscale numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert('L')  # Convert to grayscale
            images.append(np.array(img, dtype=np.float32))
        return images

    def _resize_to_common_size(self, images: List[np.ndarray]) -> List[np.ndarray]:
        """Resize all images to the size of the first image"""
        if not images:
            return images

        target_height, target_width = images[0].shape[:2]
        resized = []

        for img in images:
            if img.shape[:2] != (target_height, target_width):
                img = cv2.resize(img, (target_width, target_height))
            resized.append(img)

        return resized

    def _compute_variance(self, images: List[np.ndarray]) -> np.ndarray:
        """
        Compute pixel-wise variance across all images

        Returns:
            Variance map where each pixel value represents variance across images
        """
        # Stack images along a new axis
        stacked = np.stack(images, axis=0)

        # Compute variance along the image axis
        variance = np.var(stacked, axis=0)

        return variance

    def _clean_mask(self, mask: np.ndarray, params: Dict[str, Any]) -> np.ndarray:
        """
        Clean up binary mask using morphological operations

        Args:
            mask: Binary mask (boolean array)
            params: Parameters including kernel size

        Returns:
            Cleaned binary mask
        """
        # Convert boolean to uint8
        mask_uint8 = (mask.astype(np.uint8) * 255)

        # Gaussian blur to reduce noise
        blur_size = params["blur_kernel_size"]
        if blur_size > 0:
            mask_uint8 = cv2.GaussianBlur(mask_uint8, (blur_size, blur_size), 0)
            _, mask_uint8 = cv2.threshold(mask_uint8, 127, 255, cv2.THRESH_BINARY)

        # Morphological operations to clean up
        kernel_size = params["morph_kernel_size"]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))

        # Close small holes
        mask_uint8 = cv2.morphologyEx(mask_uint8, cv2.MORPH_CLOSE, kernel)

        # Remove small noise
        mask_uint8 = cv2.morphologyEx(mask_uint8, cv2.MORPH_OPEN, kernel)

        return mask_uint8 > 0

    def _find_elements_from_mask(
        self, mask: np.ndarray, params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """
        Find connected components in mask and create bounding boxes

        Args:
            mask: Binary mask indicating stable regions
            params: Parameters for filtering

        Returns:
            List of detected elements
        """
        elements = []

        # Convert to uint8 for findContours
        mask_uint8 = (mask.astype(np.uint8) * 255)

        # Find contours
        contours, _ = cv2.findContours(
            mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:
            # Get bounding box
            x, y, w, h = cv2.boundingRect(contour)

            # Calculate area and aspect ratio
            area = w * h
            aspect_ratio = w / h if h > 0 else 0

            # Filter by size and aspect ratio
            if (params["min_area"] <= area <= params["max_area"] and
                params["min_aspect_ratio"] <= aspect_ratio <= params["max_aspect_ratio"]):

                # Calculate confidence based on how stable the region is
                region_mask = mask[y:y+h, x:x+w]
                stability = np.mean(region_mask)  # Percentage of stable pixels

                elements.append(DetectedElement(
                    bounding_box=BoundingBox(x=int(x), y=int(y), width=int(w), height=int(h)),
                    confidence=float(stability) * 0.9,  # Scale to 0-0.9 range
                    label="Stable Region",
                    element_type="stable",
                    screenshot_index=0,
                    metadata={
                        "method": "variance",
                        "area": int(area),
                        "aspect_ratio": float(aspect_ratio),
                        "stability": float(stability),
                    },
                ))

        return elements
