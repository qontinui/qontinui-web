"""
Single Shot Analyzer - Edge-Based Method

Detects GUI elements using edge detection and contour analysis.
Good for finding buttons, inputs, and other rectangular UI elements.
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


class SingleShotEdgeAnalyzer(BaseAnalyzer):
    """
    Detects GUI elements using edge detection

    Algorithm:
    1. Convert to grayscale
    2. Apply Canny edge detection
    3. Find contours in edge map
    4. Filter contours by size and shape
    5. Classify by aspect ratio and position
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "single_shot_edge"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            "canny_low": 50,  # Canny low threshold
            "canny_high": 150,  # Canny high threshold
            "min_area": 400,  # Minimum element area
            "max_area": 50000,  # Maximum element area
            "min_aspect_ratio": 0.1,
            "max_aspect_ratio": 10.0,
            "morph_kernel_size": 3,
            "classify_by_shape": True,  # Attempt to classify element types
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform edge-based GUI element detection"""
        logger.info(
            f"Running edge-based single-shot analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images
        images_gray = self._load_images_grayscale(input_data.screenshot_data)
        images_color = self._load_images_color(input_data.screenshot_data)

        # Analyze each screenshot
        all_elements = []
        for screenshot_idx, (img_gray, img_color) in enumerate(
            zip(images_gray, images_color)
        ):
            elements = await self._analyze_screenshot(
                img_gray, img_color, screenshot_idx, params
            )
            all_elements.extend(elements)

        logger.info(f"Found {len(all_elements)} elements across all screenshots")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=0.72,
            metadata={
                "num_screenshots": len(images_gray),
                "method": "edge_detection",
                "parameters": params,
            },
        )

    def _load_images_grayscale(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots as grayscale"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("L")
            images.append(np.array(img, dtype=np.uint8))
        return images

    def _load_images_color(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots in color"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(np.array(img, dtype=np.uint8))
        return images

    async def _analyze_screenshot(
        self,
        img_gray: np.ndarray,
        img_color: np.ndarray,
        screenshot_idx: int,
        params: Dict[str, Any],
    ) -> List[DetectedElement]:
        """Analyze a single screenshot"""
        elements = []

        # Apply Canny edge detection
        edges = cv2.Canny(img_gray, params["canny_low"], params["canny_high"])

        # Dilate edges to connect nearby edges
        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (params["morph_kernel_size"], params["morph_kernel_size"])
        )
        edges = cv2.dilate(edges, kernel, iterations=1)

        # Find contours
        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)

            # Calculate metrics
            area = w * h
            aspect_ratio = w / h if h > 0 else 0
            perimeter = cv2.arcLength(contour, True)
            rectangularity = (4 * area) / (perimeter**2) if perimeter > 0 else 0

            # Filter by size and aspect ratio
            if not (params["min_area"] <= area <= params["max_area"]):
                continue
            if not (
                params["min_aspect_ratio"] <= aspect_ratio <= params["max_aspect_ratio"]
            ):
                continue

            # Classify element type if requested
            if params["classify_by_shape"]:
                element_type, label = self._classify_element(
                    w, h, aspect_ratio, rectangularity, img_color[y : y + h, x : x + w]
                )
            else:
                element_type = "element"
                label = "GUI Element"

            # Calculate confidence based on shape regularity
            confidence = min(0.9, 0.5 + rectangularity * 0.4)

            elements.append(
                DetectedElement(
                    bounding_box=BoundingBox(
                        x=int(x), y=int(y), width=int(w), height=int(h)
                    ),
                    confidence=confidence,
                    label=label,
                    element_type=element_type,
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "edge_detection",
                        "area": int(area),
                        "aspect_ratio": float(aspect_ratio),
                        "rectangularity": float(rectangularity),
                    },
                )
            )

        return elements

    def _classify_element(
        self,
        width: int,
        height: int,
        aspect_ratio: float,
        rectangularity: float,
        region: np.ndarray,
    ) -> tuple[str, str]:
        """
        Classify element type based on shape characteristics

        Returns:
            (element_type, label) tuple
        """
        # Button: roughly rectangular, medium size
        if 0.3 <= aspect_ratio <= 4.0 and rectangularity > 0.6:
            if 1000 < (width * height) < 20000:
                return ("button", "Button")

        # Input field: horizontally elongated rectangle
        if aspect_ratio > 2.5 and rectangularity > 0.7:
            if 20 < height < 60:
                return ("input", "Input Field")

        # Icon/Image: small, roughly square
        if 0.7 <= aspect_ratio <= 1.3:
            if (width * height) < 5000:
                return ("icon", "Icon")
            elif (width * height) < 50000:
                return ("image", "Image")

        # Container: large rectangular area
        if rectangularity > 0.8 and (width * height) > 20000:
            return ("container", "Container")

        # Default
        return ("element", "GUI Element")
