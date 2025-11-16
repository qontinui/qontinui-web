"""
Button Affordance Scorer

Calculates a clickability "affordance score" (0-1) for regions to determine
how button-like they appear based on multiple visual cues:
- Contrast with background
- Color consistency
- Position on screen
- Shape regularity
- Padding and borders
- Visual prominence

This is a comprehensive scorer that combines multiple detection strategies
to provide a single likelihood score for each candidate region.
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


class ButtonAffordanceScorer(BaseAnalyzer):
    """
    Calculates affordance scores for GUI regions to identify buttons

    Algorithm:
    1. Extract all rectangular regions from the image
    2. For each region, calculate multiple affordance features:
       - Visual contrast (stands out from background)
       - Color uniformity (consistent button color)
       - Shape regularity (rectangular, proper aspect ratio)
       - Position (typical button locations)
       - Border quality (clear borders)
       - Size appropriateness
    3. Combine features into a single affordance score (0-1)
    4. Report regions with high affordance scores as buttons
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.CUSTOM

    @property
    def name(self) -> str:
        return "button_affordance_scorer"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            # Region extraction
            "edge_threshold1": 50,
            "edge_threshold2": 150,
            "min_region_area": 1500,

            # Size constraints
            "min_width": 60,
            "max_width": 400,
            "min_height": 25,
            "max_height": 80,

            # Aspect ratio
            "min_aspect_ratio": 1.5,
            "max_aspect_ratio": 6.0,
            "optimal_aspect_ratio": 3.0,

            # Feature weights (should sum to ~1.0)
            "weight_contrast": 0.20,
            "weight_color_uniformity": 0.15,
            "weight_shape": 0.15,
            "weight_position": 0.10,
            "weight_border": 0.15,
            "weight_size": 0.10,
            "weight_visual_prominence": 0.15,

            # Thresholds
            "min_affordance_score": 0.6,  # Minimum score to report as button
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform affordance-based button detection"""
        logger.info(
            f"Running button affordance scoring on {len(input_data.screenshots)} screenshots"
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

        logger.info(
            f"Detected {len(all_elements)} button candidates using affordance scoring"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=0.80,  # Comprehensive scoring is reliable
            metadata={
                "num_screenshots": len(images_gray),
                "method": "affordance_scoring",
                "parameters": params,
                "detector_type": "button_affordance",
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
        """Load screenshots in color (BGR for OpenCV)"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(cv2.cvtColor(np.array(img, dtype=np.uint8), cv2.COLOR_RGB2BGR))
        return images

    async def _analyze_screenshot(
        self,
        img_gray: np.ndarray,
        img_color: np.ndarray,
        screenshot_idx: int,
        params: Dict[str, Any],
    ) -> List[DetectedElement]:
        """Analyze a single screenshot using affordance scoring"""
        elements = []

        # Step 1: Extract candidate regions using edge detection
        candidate_regions = self._extract_candidate_regions(img_gray, params)

        logger.debug(f"Extracted {len(candidate_regions)} candidate regions")

        img_h, img_w = img_gray.shape

        # Step 2: Score each candidate region
        for bbox in candidate_regions:
            x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height

            # Extract region
            region_gray = img_gray[y:y+h, x:x+w]
            region_color = img_color[y:y+h, x:x+w]

            # Calculate all affordance features
            features = self._calculate_affordance_features(
                region_gray, region_color, img_gray, img_color, x, y, w, h, params
            )

            # Combine features into final affordance score
            affordance_score = self._combine_features(features, params)

            # Only report high-scoring regions
            if affordance_score < params["min_affordance_score"]:
                continue

            # Create detected element
            elements.append(
                DetectedElement(
                    bounding_box=bbox,
                    confidence=affordance_score,
                    label=f"Button (affordance: {affordance_score:.2f})",
                    element_type="button",
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "affordance_scoring",
                        "affordance_score": float(affordance_score),
                        "features": features,
                    },
                )
            )

        return elements

    def _extract_candidate_regions(
        self, img_gray: np.ndarray, params: Dict[str, Any]
    ) -> List[BoundingBox]:
        """
        Extract candidate rectangular regions that could be buttons

        Uses edge detection and contour finding
        """
        candidates = []

        # Apply Canny edge detection
        edges = cv2.Canny(img_gray, params["edge_threshold1"], params["edge_threshold2"])

        # Dilate to connect nearby edges
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=1)

        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h

            # Filter by size
            if area < params["min_region_area"]:
                continue
            if not (params["min_width"] <= w <= params["max_width"]):
                continue
            if not (params["min_height"] <= h <= params["max_height"]):
                continue

            # Filter by aspect ratio
            aspect_ratio = w / h if h > 0 else 0
            if not (params["min_aspect_ratio"] <= aspect_ratio <= params["max_aspect_ratio"]):
                continue

            candidates.append(BoundingBox(x=int(x), y=int(y), width=int(w), height=int(h)))

        return candidates

    def _calculate_affordance_features(
        self,
        region_gray: np.ndarray,
        region_color: np.ndarray,
        img_gray: np.ndarray,
        img_color: np.ndarray,
        x: int,
        y: int,
        w: int,
        h: int,
        params: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Calculate all affordance features for a region

        Returns:
            Dict mapping feature names to scores (0-1)
        """
        features = {}

        # Feature 1: Contrast with background
        features["contrast"] = self._score_contrast(
            region_color, img_color, x, y, w, h
        )

        # Feature 2: Color uniformity
        features["color_uniformity"] = self._score_color_uniformity(region_color)

        # Feature 3: Shape regularity
        features["shape"] = self._score_shape(w, h, params)

        # Feature 4: Position on screen
        features["position"] = self._score_position(
            x, y, w, h, img_gray.shape[1], img_gray.shape[0]
        )

        # Feature 5: Border quality
        features["border"] = self._score_border(region_gray)

        # Feature 6: Size appropriateness
        features["size"] = self._score_size(w, h, params)

        # Feature 7: Visual prominence
        features["visual_prominence"] = self._score_visual_prominence(
            region_gray, img_gray
        )

        return features

    def _score_contrast(
        self,
        region_color: np.ndarray,
        img_color: np.ndarray,
        x: int,
        y: int,
        w: int,
        h: int,
    ) -> float:
        """
        Score contrast between region and background (0-1)

        High contrast indicates the element stands out
        """
        if region_color.size == 0:
            return 0.0

        img_h, img_w = img_color.shape[:2]

        # Extract background (border around region)
        border_width = 15
        x1 = max(0, x - border_width)
        y1 = max(0, y - border_width)
        x2 = min(img_w, x + w + border_width)
        y2 = min(img_h, y + h + border_width)

        background = img_color[y1:y2, x1:x2].copy()

        # Mask out the region
        region_x = x - x1
        region_y = y - y1
        if (0 <= region_y < background.shape[0] and 0 <= region_x < background.shape[1]):
            mask = np.ones(background.shape[:2], dtype=bool)
            mask[region_y:region_y+h, region_x:region_x+w] = False
            bg_pixels = background[mask]
        else:
            bg_pixels = background.reshape(-1, 3)

        if len(bg_pixels) == 0:
            return 0.0

        # Calculate color distance
        region_mean = np.mean(region_color, axis=(0, 1))
        bg_mean = np.mean(bg_pixels, axis=0)

        contrast = np.linalg.norm(region_mean - bg_mean)

        # Normalize (typical range 0-150)
        return min(1.0, contrast / 80)

    def _score_color_uniformity(self, region_color: np.ndarray) -> float:
        """
        Score how uniform the color is within the region (0-1)

        Buttons typically have consistent color
        """
        if region_color.size == 0:
            return 0.0

        # Calculate standard deviation
        std_dev = np.std(region_color, axis=(0, 1))
        avg_std = np.mean(std_dev)

        # Lower std = higher uniformity
        uniformity = max(0, 1.0 - (avg_std / 40))

        return uniformity

    def _score_shape(self, w: int, h: int, params: Dict[str, Any]) -> float:
        """
        Score shape regularity (0-1)

        Buttons have consistent aspect ratios
        """
        aspect_ratio = w / h if h > 0 else 0
        optimal_ratio = params["optimal_aspect_ratio"]

        # Distance from optimal ratio
        ratio_diff = abs(aspect_ratio - optimal_ratio)

        # Score based on how close to optimal
        shape_score = max(0, 1.0 - (ratio_diff / 2.0))

        return shape_score

    def _score_position(
        self, x: int, y: int, w: int, h: int, img_w: int, img_h: int
    ) -> float:
        """
        Score position on screen (0-1)

        Buttons are often:
        - In lower portions of forms
        - Centered or aligned
        - In footer/header areas
        """
        # Calculate relative position
        center_x = (x + w / 2) / img_w
        center_y = (y + h / 2) / img_h

        position_score = 0.5  # Base score

        # Bonus for being in common button areas
        # Bottom third of screen (common for submit buttons)
        if center_y > 0.66:
            position_score += 0.2

        # Centered horizontally (common for primary actions)
        if 0.4 <= center_x <= 0.6:
            position_score += 0.2

        # Top area (common for navigation buttons)
        if center_y < 0.15:
            position_score += 0.1

        return min(1.0, position_score)

    def _score_border(self, region_gray: np.ndarray) -> float:
        """
        Score border quality (0-1)

        Buttons have clear, defined borders
        """
        if region_gray.size == 0 or region_gray.shape[0] < 5 or region_gray.shape[1] < 5:
            return 0.0

        h, w = region_gray.shape

        # Extract border pixels
        border_pixels = np.concatenate([
            region_gray[0, :],      # Top
            region_gray[-1, :],     # Bottom
            region_gray[:, 0],      # Left
            region_gray[:, -1],     # Right
        ])

        # Extract interior pixels (excluding border)
        interior = region_gray[2:-2, 2:-2]

        if interior.size == 0:
            return 0.0

        # Calculate contrast between border and interior
        border_mean = np.mean(border_pixels)
        interior_mean = np.mean(interior)

        border_contrast = abs(border_mean - interior_mean)

        # Also check border consistency
        border_std = np.std(border_pixels)
        border_uniformity = max(0, 1.0 - (border_std / 40))

        # Combine both aspects
        border_score = (min(1.0, border_contrast / 30) * 0.6 + border_uniformity * 0.4)

        return border_score

    def _score_size(self, w: int, h: int, params: Dict[str, Any]) -> float:
        """
        Score size appropriateness (0-1)

        Buttons are typically medium-sized elements
        """
        # Optimal button size: ~150x40 pixels
        optimal_width = 150
        optimal_height = 40

        # Calculate distance from optimal
        width_diff = abs(w - optimal_width) / optimal_width
        height_diff = abs(h - optimal_height) / optimal_height

        width_score = max(0, 1.0 - width_diff)
        height_score = max(0, 1.0 - height_diff)

        size_score = (width_score + height_score) / 2.0

        return size_score

    def _score_visual_prominence(
        self, region_gray: np.ndarray, img_gray: np.ndarray
    ) -> float:
        """
        Score visual prominence (0-1)

        Buttons are designed to stand out visually
        Measured by brightness/darkness relative to overall image
        """
        if region_gray.size == 0:
            return 0.0

        region_brightness = np.mean(region_gray)
        overall_brightness = np.mean(img_gray)

        # Buttons can be either brighter or darker than background
        brightness_diff = abs(region_brightness - overall_brightness)

        # Normalize (typical range 0-100)
        prominence = min(1.0, brightness_diff / 40)

        return prominence

    def _combine_features(
        self, features: Dict[str, float], params: Dict[str, Any]
    ) -> float:
        """
        Combine all feature scores into a single affordance score (0-1)

        Uses weighted average based on feature importance
        """
        affordance_score = 0.0

        affordance_score += features.get("contrast", 0) * params["weight_contrast"]
        affordance_score += features.get("color_uniformity", 0) * params["weight_color_uniformity"]
        affordance_score += features.get("shape", 0) * params["weight_shape"]
        affordance_score += features.get("position", 0) * params["weight_position"]
        affordance_score += features.get("border", 0) * params["weight_border"]
        affordance_score += features.get("size", 0) * params["weight_size"]
        affordance_score += features.get("visual_prominence", 0) * params["weight_visual_prominence"]

        return min(1.0, max(0.0, affordance_score))
