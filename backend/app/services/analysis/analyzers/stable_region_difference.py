"""
Stable Region Analyzer - Difference-Based Method

Detects stable regions by computing frame-to-frame differences and identifying
areas with minimal changes.
"""

import logging
from io import BytesIO
from typing import Any

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


class StableRegionDifferenceAnalyzer(BaseAnalyzer):
    """
    Finds stable regions using frame difference analysis

    Algorithm:
    1. Compute differences between consecutive frames
    2. Accumulate differences across all frame pairs
    3. Threshold to identify low-change regions
    4. Use connected components to find stable areas
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.STABLE_REGION

    @property
    def name(self) -> str:
        return "stable_region_difference"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 2

    def get_default_parameters(self) -> dict[str, Any]:
        return {
            "difference_threshold": 30.0,  # Max pixel difference for "stable"
            "min_area": 400,
            "max_area": 100000,
            "min_aspect_ratio": 0.2,
            "max_aspect_ratio": 5.0,
            "morph_kernel_size": 5,
            "accumulation_method": "mean",  # "mean", "median", or "max"
        }

    def validate_input(self, input_data: AnalysisInput) -> bool:
        return len(input_data.screenshots) >= self.required_screenshots

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform difference-based stable region analysis"""
        logger.info(
            f"Running difference-based stable region analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images as grayscale
        images = self._load_images_grayscale(input_data.screenshot_data)
        images = self._resize_to_common_size(images)

        # Compute accumulated differences
        diff_map = self._compute_accumulated_differences(images, params)

        # Threshold to get stable regions
        stability_mask = diff_map < params["difference_threshold"]

        # Clean up mask
        stability_mask = self._clean_mask(stability_mask, params)

        # Find elements
        elements = self._find_elements_from_mask(stability_mask, params)

        logger.info(f"Found {len(elements)} stable regions")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.82,
            metadata={
                "num_screenshots": len(images),
                "method": "difference",
                "parameters": params,
                "mean_difference": float(np.mean(diff_map)),
                "stable_pixel_percentage": float(
                    np.sum(stability_mask) / stability_mask.size * 100
                ),
            },
        )

    def _load_images_grayscale(self, screenshot_data: list[bytes]) -> list[np.ndarray]:
        """Load screenshots as grayscale numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("L")
            images.append(np.array(img, dtype=np.float32))
        return images

    def _resize_to_common_size(self, images: list[np.ndarray]) -> list[np.ndarray]:
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

    def _compute_accumulated_differences(
        self, images: list[np.ndarray], params: dict[str, Any]
    ) -> np.ndarray:
        """
        Compute accumulated frame differences

        Returns:
            Difference map where each pixel shows accumulated change
        """
        if len(images) < 2:
            return np.zeros_like(images[0])

        differences = []

        # Compute differences between consecutive frames
        for i in range(len(images) - 1):
            diff = np.abs(images[i + 1] - images[i])
            differences.append(diff)

        # Accumulate using specified method
        differences_array = np.stack(differences, axis=0)
        method = params["accumulation_method"]

        accumulated: np.ndarray
        if method == "mean":
            accumulated = np.mean(differences_array, axis=0)
        elif method == "median":
            accumulated = np.median(differences_array, axis=0)
        elif method == "max":
            accumulated = np.max(differences_array, axis=0)
        else:
            logger.warning(f"Unknown accumulation method: {method}, using mean")
            accumulated = np.mean(differences_array, axis=0)

        return accumulated

    def _clean_mask(self, mask: np.ndarray, params: dict[str, Any]) -> np.ndarray:
        """Clean up binary mask using morphological operations"""
        mask_uint8 = mask.astype(np.uint8) * 255

        kernel_size = params["morph_kernel_size"]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))

        # Close small holes
        mask_cleaned: np.ndarray = cv2.morphologyEx(mask_uint8, cv2.MORPH_CLOSE, kernel)

        # Remove small noise
        mask_cleaned = cv2.morphologyEx(mask_cleaned, cv2.MORPH_OPEN, kernel)

        return mask_cleaned > 0

    def _find_elements_from_mask(
        self, mask: np.ndarray, params: dict[str, Any]
    ) -> list[DetectedElement]:
        """Find connected components in mask and create bounding boxes"""
        elements = []

        mask_uint8 = mask.astype(np.uint8) * 255

        contours, _ = cv2.findContours(
            mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)

            area = w * h
            aspect_ratio = w / h if h > 0 else 0

            if (
                params["min_area"] <= area <= params["max_area"]
                and params["min_aspect_ratio"]
                <= aspect_ratio
                <= params["max_aspect_ratio"]
            ):

                region_mask = mask[y : y + h, x : x + w]
                stability = np.mean(region_mask)

                elements.append(
                    DetectedElement(
                        bounding_box=BoundingBox(
                            x=int(x), y=int(y), width=int(w), height=int(h)
                        ),
                        confidence=float(stability) * 0.85,
                        label="Stable Region",
                        element_type="stable",
                        screenshot_index=0,
                        metadata={
                            "method": "difference",
                            "area": int(area),
                            "aspect_ratio": float(aspect_ratio),
                            "stability": float(stability),
                        },
                    )
                )

        return elements
