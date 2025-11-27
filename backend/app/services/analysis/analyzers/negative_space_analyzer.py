"""
Negative Space Analyzer - Whitespace-Based Detection

Detects UI elements by analyzing negative space (whitespace) around them.
Buttons and interactive elements are typically "islands" of content surrounded
by whitespace, with consistent padding patterns (8-16px typical).

Uses morphological operations to identify isolated content regions.
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


class NegativeSpaceAnalyzer(BaseAnalyzer):
    """
    Detects UI elements by analyzing whitespace patterns

    Algorithm:
    1. Create "content map" (where content exists vs. whitespace)
    2. Calculate isolation score for each content region
    3. Identify "islands" with consistent padding
    4. Validate button-like properties (size, aspect ratio)
    5. Use morphological operations to refine detection

    Buttons typically have:
    - 8-16px padding on all sides
    - High isolation score (surrounded by whitespace)
    - Consistent padding ratio
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "negative_space"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> dict[str, Any]:
        return {
            # Whitespace detection
            "background_threshold": 240,  # Brightness threshold for background
            "min_padding": 6,  # Minimum padding around elements (pixels)
            "max_padding": 24,  # Maximum padding (pixels)
            "padding_consistency": 0.7,  # How consistent padding should be
            # Content detection
            "content_threshold": 50,  # Minimum content density
            "min_isolation_score": 0.6,  # Minimum isolation from other content
            # Size filters
            "min_area": 500,
            "max_area": 50000,
            "min_aspect_ratio": 1.5,
            "max_aspect_ratio": 8.0,
            # Morphological operations
            "morph_kernel_size": 3,
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform negative space analysis"""
        logger.info(
            f"Running negative space analysis on {len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images
        images = self._load_images(input_data.screenshot_data)

        # Analyze each screenshot
        all_elements = []
        for screenshot_idx, img in enumerate(images):
            elements = await self._analyze_screenshot(img, screenshot_idx, params)
            all_elements.extend(elements)

        avg_confidence = (
            np.mean([e.confidence for e in all_elements]) if all_elements else 0.0
        )

        logger.info(
            f"Found {len(all_elements)} isolated elements with "
            f"avg confidence {avg_confidence:.2f}"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=float(avg_confidence),
            metadata={
                "num_screenshots": len(images),
                "method": "negative_space",
                "parameters": params,
            },
        )

    def _load_images(self, screenshot_data: list[bytes]) -> list[np.ndarray]:
        """Load screenshots as numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(np.array(img))
        return images

    async def _analyze_screenshot(
        self, img: np.ndarray, screenshot_idx: int, params: dict[str, Any]
    ) -> list[DetectedElement]:
        """Analyze single screenshot for isolated elements"""

        # Create content map
        content_map = self._create_content_map(img, params)

        # Find content islands
        islands = self._find_content_islands(content_map, params)

        logger.info(
            f"Screenshot {screenshot_idx}: Found {len(islands)} content islands"
        )

        # Analyze each island for button characteristics
        elements = []
        for bbox, isolation_score in islands:
            # Calculate padding around island
            padding_info = self._calculate_padding(img, bbox, content_map, params)

            if padding_info is None:
                continue

            padding_score, avg_padding = padding_info

            # Check if padding is in expected range for buttons
            if not (params["min_padding"] <= avg_padding <= params["max_padding"]):
                continue

            # Validate button properties
            if not self._is_button_like(img, bbox, params):
                continue

            # Calculate final confidence
            confidence = self._calculate_confidence(
                isolation_score, padding_score, avg_padding, params
            )

            elements.append(
                DetectedElement(
                    bounding_box=bbox,
                    confidence=confidence,
                    label="Isolated Element",
                    element_type="button_candidate",
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "negative_space",
                        "isolation_score": float(isolation_score),
                        "padding_score": float(padding_score),
                        "avg_padding": float(avg_padding),
                    },
                )
            )

        return elements

    def _create_content_map(
        self, img: np.ndarray, params: dict[str, Any]
    ) -> np.ndarray:
        """
        Create binary map of content vs. whitespace

        Content = any pixel that's not background/whitespace
        """
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        # Detect edges (content has edges)
        edges = cv2.Canny(gray, 50, 150)

        # Detect non-background pixels (not white/very light)
        non_background = gray < params["background_threshold"]

        # Combine: content = edges OR non-background
        content_map = np.logical_or(edges > 0, non_background)

        # Clean up with morphological operations
        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (params["morph_kernel_size"], params["morph_kernel_size"])
        )

        # Close small gaps
        content_map = cv2.morphologyEx(
            content_map.astype(np.uint8), cv2.MORPH_CLOSE, kernel
        )

        return content_map.astype(bool)

    def _find_content_islands(
        self, content_map: np.ndarray, params: dict[str, Any]
    ) -> list[tuple[BoundingBox, float]]:
        """
        Find isolated regions of content ("islands")

        Returns list of (bbox, isolation_score) tuples
        """
        islands = []

        # Find connected components
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
            content_map.astype(np.uint8), connectivity=8
        )

        # Skip label 0 (background)
        for label in range(1, num_labels):
            x = stats[label, cv2.CC_STAT_LEFT]
            y = stats[label, cv2.CC_STAT_TOP]
            w = stats[label, cv2.CC_STAT_WIDTH]
            h = stats[label, cv2.CC_STAT_HEIGHT]
            area = stats[label, cv2.CC_STAT_AREA]

            # Size filter
            if not (params["min_area"] <= w * h <= params["max_area"]):
                continue

            # Aspect ratio filter
            aspect_ratio = w / h if h > 0 else 0
            if not (
                params["min_aspect_ratio"] <= aspect_ratio <= params["max_aspect_ratio"]
            ):
                continue

            # Calculate isolation score
            isolation_score = self._calculate_isolation_score(
                content_map, x, y, w, h, params
            )

            if isolation_score < params["min_isolation_score"]:
                continue

            bbox = BoundingBox(x=x, y=y, width=w, height=h)
            islands.append((bbox, isolation_score))

        return islands

    def _calculate_isolation_score(
        self,
        content_map: np.ndarray,
        x: int,
        y: int,
        w: int,
        h: int,
        params: dict[str, Any],
    ) -> float:
        """
        Calculate how isolated an element is from surrounding content

        Score of 1.0 = completely isolated (surrounded by whitespace)
        Score of 0.0 = no isolation (merged with other content)
        """
        # Define surrounding region (padded area)
        padding = params["max_padding"]
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(content_map.shape[1], x + w + padding)
        y2 = min(content_map.shape[0], y + h + padding)

        # Extract surrounding region
        surrounding = content_map[y1:y2, x1:x2].copy()

        # Mask out the element itself
        elem_x1 = x - x1
        elem_y1 = y - y1
        elem_x2 = elem_x1 + w
        elem_y2 = elem_y1 + h
        surrounding[elem_y1:elem_y2, elem_x1:elem_x2] = False

        # Calculate isolation: ratio of whitespace in surrounding area
        total_surrounding = surrounding.size
        whitespace_surrounding = np.sum(~surrounding)

        if total_surrounding == 0:
            return 0.0

        isolation_score = whitespace_surrounding / total_surrounding

        return float(isolation_score)

    def _calculate_padding(
        self,
        img: np.ndarray,
        bbox: BoundingBox,
        content_map: np.ndarray,
        params: dict[str, Any],
    ) -> tuple[float, float] | None:
        """
        Calculate padding around element and padding consistency score

        Returns (padding_score, avg_padding) or None if invalid
        """
        x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height

        # Measure padding in each direction
        paddings = {
            "top": self._measure_padding_direction(
                content_map, x, y, w, h, "top", params
            ),
            "bottom": self._measure_padding_direction(
                content_map, x, y, w, h, "bottom", params
            ),
            "left": self._measure_padding_direction(
                content_map, x, y, w, h, "left", params
            ),
            "right": self._measure_padding_direction(
                content_map, x, y, w, h, "right", params
            ),
        }

        # Filter out None values
        valid_paddings = [p for p in paddings.values() if p is not None]

        if len(valid_paddings) < 2:
            return None

        avg_padding = np.mean(valid_paddings)
        std_padding = np.std(valid_paddings)

        # Padding consistency: low std = consistent padding
        # Normalize std by average to get consistency score
        consistency: float
        if avg_padding > 0:
            consistency_val = 1 - (std_padding / avg_padding)
            consistency = max(0.0, float(consistency_val))
        else:
            consistency = 0.0

        # Require minimum consistency
        if consistency < params["padding_consistency"]:
            return None

        return (consistency, float(avg_padding))

    def _measure_padding_direction(
        self,
        content_map: np.ndarray,
        x: int,
        y: int,
        w: int,
        h: int,
        direction: str,
        params: dict[str, Any],
    ) -> float | None:
        """
        Measure padding in a specific direction

        Returns padding in pixels, or None if invalid
        """
        max_search = params["max_padding"]

        if direction == "top":
            search_start = max(0, y - max_search)
            search_region = content_map[search_start:y, x : x + w]
            if search_region.size == 0:
                return None

            # Find first row with content (from top)
            row_has_content = np.any(search_region, axis=1)
            if not np.any(row_has_content):
                return float(max_search)  # No content found = max padding

            first_content = np.where(row_has_content)[0][-1]  # Last occurrence
            padding = y - (search_start + first_content)

        elif direction == "bottom":
            search_end = min(content_map.shape[0], y + h + max_search)
            search_region = content_map[y + h : search_end, x : x + w]
            if search_region.size == 0:
                return None

            row_has_content = np.any(search_region, axis=1)
            if not np.any(row_has_content):
                return float(max_search)

            first_content = np.where(row_has_content)[0][0]
            padding = first_content

        elif direction == "left":
            search_start = max(0, x - max_search)
            search_region = content_map[y : y + h, search_start:x]
            if search_region.size == 0:
                return None

            col_has_content = np.any(search_region, axis=0)
            if not np.any(col_has_content):
                return float(max_search)

            first_content = np.where(col_has_content)[0][-1]
            padding = x - (search_start + first_content)

        elif direction == "right":
            search_end = min(content_map.shape[1], x + w + max_search)
            search_region = content_map[y : y + h, x + w : search_end]
            if search_region.size == 0:
                return None

            col_has_content = np.any(search_region, axis=0)
            if not np.any(col_has_content):
                return float(max_search)

            first_content = np.where(col_has_content)[0][0]
            padding = first_content

        else:
            return None

        return float(max(0, padding))

    def _is_button_like(
        self, img: np.ndarray, bbox: BoundingBox, params: dict[str, Any]
    ) -> bool:
        """
        Validate that region has button-like visual properties
        """
        x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height

        # Extract region
        region = img[y : y + h, x : x + w]

        if region.size == 0:
            return False

        # Check for uniform background (buttons have consistent bg color)
        hsv = cv2.cvtColor(region, cv2.COLOR_RGB2HSV)
        hue_std = np.std(hsv[:, :, 0])

        # Some uniformity required
        if hue_std > 50:
            return False

        # Check for content presence (text or icon)
        gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / edges.size

        # Should have some content but not too much
        if not (0.05 <= edge_density <= 0.4):
            return False

        return True

    def _calculate_confidence(
        self,
        isolation_score: float,
        padding_score: float,
        avg_padding: float,
        params: dict[str, Any],
    ) -> float:
        """
        Calculate final confidence based on isolation and padding metrics
        """
        # Base confidence from isolation
        confidence = isolation_score * 0.4

        # Bonus from consistent padding
        confidence += padding_score * 0.3

        # Bonus for padding in ideal range (10-14px typical for buttons)
        ideal_padding = 12
        padding_distance = abs(avg_padding - ideal_padding)
        padding_bonus = max(0, 1 - (padding_distance / ideal_padding)) * 0.3
        confidence += padding_bonus

        return min(0.92, confidence)
