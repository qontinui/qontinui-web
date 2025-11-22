"""
Stable Region Analyzer (Type 1)

Detects GUI elements that remain in the same position across multiple screenshots.
Examples: Navigation bars, toolbars, static menus, persistent buttons.
"""

import logging
from io import BytesIO
from typing import Any, Dict, List

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


class StableRegionAnalyzer(BaseAnalyzer):
    """
    Analyzes multiple screenshots to find stable regions

    Algorithm:
    1. Load all screenshots
    2. Compute pixel-wise variance across screenshots
    3. Low variance regions = stable elements
    4. Use edge detection to find element boundaries
    5. Group connected regions into bounding boxes
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.STABLE_REGION

    @property
    def name(self) -> str:
        return "stable_region"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 2  # Need at least 2 to compare

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            "variance_threshold": 0.05,  # Threshold for "stable" regions
            "min_area": 100,  # Minimum element area in pixels
            "max_area": 50000,  # Maximum element area
            "edge_threshold": 30,  # Edge detection sensitivity
            "morphology_kernel": 3,  # Size for morphological operations
        }

    def validate_input(self, input_data: AnalysisInput) -> bool:
        """Validate that we have enough screenshots"""
        return len(input_data.screenshots) >= self.required_screenshots

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform stable region analysis"""
        logger.info(
            f"Running stable region analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images
        images = self._load_images(input_data.screenshot_data)

        # Find stable regions
        elements = await self._find_stable_regions(images, params)

        logger.info(f"Found {len(elements)} stable regions")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.85,  # High confidence for stable regions
            metadata={
                "num_screenshots": len(images),
                "parameters": params,
            },
        )

    def _load_images(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots as numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(np.array(img))
        return images

    async def _find_stable_regions(
        self, images: List[np.ndarray], params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """
        Find regions with low variance across screenshots

        This is a placeholder implementation. In production, you would:
        1. Compute pixel-wise variance
        2. Threshold to find stable regions
        3. Use connected components to find boundaries
        4. Create bounding boxes
        """
        elements = []

        # Example: Find regions that are similar across all images
        # This is a simplified version - you'd want more sophisticated analysis

        # For now, return mock data showing the concept
        # In real implementation, you'd do actual computer vision here

        logger.info("Stable region analysis - placeholder implementation")

        # Mock: Assume navigation bar at top
        height, width = images[0].shape[:2]

        # Example stable region: top navigation bar
        if self._is_region_stable(images, 0, 0, width, 60):
            elements.append(
                DetectedElement(
                    bounding_box=BoundingBox(x=0, y=0, width=width, height=60),
                    confidence=0.9,
                    label="Navigation Bar",
                    element_type="navigation",
                    screenshot_index=0,
                    metadata={"analysis": "stable_across_screenshots"},
                )
            )

        return elements

    def _is_region_stable(
        self,
        images: List[np.ndarray],
        x: int,
        y: int,
        width: int,
        height: int,
        threshold: float = 0.1,
    ) -> bool:
        """
        Check if a region is stable across all images

        Computes standard deviation of pixel values across images
        """
        regions = []
        for img in images:
            h, w = img.shape[:2]
            x2 = min(x + width, w)
            y2 = min(y + height, h)
            region = img[y:y2, x:x2]
            regions.append(region)

        # Stack regions and compute variance
        stacked = np.stack(regions)
        variance = np.var(stacked, axis=0).mean()

        return variance < threshold
