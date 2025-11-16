"""
Temporal Analyzer - Animation and Hover Effects Detection

Detects interactive elements by analyzing temporal changes:
- Hover effects (color/style changes on mouseover)
- Click animations (press states)
- Focus indicators
- Micro-animations

Requires video input or sequential screenshots with interaction events.
"""

import logging
from typing import Dict, Any, List, Tuple, Optional
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


class TemporalAnalyzer(BaseAnalyzer):
    """
    Detects interactive elements by analyzing temporal changes

    Algorithm:
    1. Compute frame-to-frame differences
    2. Identify regions with transient changes (hover, focus)
    3. Analyze change patterns (color shift, size change, etc.)
    4. Correlate changes with interaction events if available
    5. Detect elements that respond to interaction

    Input format:
    - Multiple screenshots in temporal sequence
    - Optional: interaction_events with timestamps and locations

    Best used with:
    - Video recordings of UI interactions
    - Sequential screenshots with hover/click states
    - Browser automation that captures interaction states
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.STABLE_REGION

    @property
    def name(self) -> str:
        return "temporal"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 2  # Need at least 2 frames to detect changes

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            # Interaction events (optional)
            "interaction_events": None,  # List of {type, timestamp, x, y}

            # Change detection
            "min_change_threshold": 10,  # Minimum pixel difference
            "change_area_threshold": 50,  # Minimum changed area (pixels)
            "temporal_window": 5,  # Frames to look back

            # Hover detection
            "hover_color_change_threshold": 20,  # Color change indicating hover
            "hover_duration_frames": 2,  # Min frames for hover state

            # Animation detection
            "animation_variance_threshold": 15,  # Variance indicating animation
            "transition_detection": True,  # Detect CSS transitions

            # Element validation
            "min_element_area": 400,
            "max_element_area": 50000,
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform temporal analysis"""
        logger.info(
            f"Running temporal analysis on {len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        if len(input_data.screenshots) < self.required_screenshots:
            logger.warning(
                f"Temporal analyzer requires at least {self.required_screenshots} "
                f"screenshots, got {len(input_data.screenshots)}"
            )

        # Load images
        images = self._load_images(input_data.screenshot_data)

        # Analyze temporal changes
        change_regions = self._detect_temporal_changes(images, params)

        logger.info(f"Detected {len(change_regions)} regions with temporal changes")

        # Filter and validate as interactive elements
        elements = self._validate_interactive_elements(
            images, change_regions, params
        )

        avg_confidence = np.mean([e.confidence for e in elements]) if elements else 0.0

        logger.info(
            f"Found {len(elements)} interactive elements from temporal analysis "
            f"with avg confidence {avg_confidence:.2f}"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=float(avg_confidence),
            metadata={
                "num_screenshots": len(images),
                "method": "temporal",
                "num_change_regions": len(change_regions),
                "parameters": params,
            },
        )

    def _load_images(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots as numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert('RGB')
            images.append(np.array(img))
        return images

    def _detect_temporal_changes(
        self, images: List[np.ndarray], params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Detect regions that change over time

        Returns list of change region descriptors
        """
        if len(images) < 2:
            return []

        change_regions = []

        # Analyze consecutive frame pairs
        for i in range(len(images) - 1):
            frame1 = images[i]
            frame2 = images[i + 1]

            # Compute difference
            diff = self._compute_frame_difference(frame1, frame2, params)

            # Find changed regions
            regions = self._extract_changed_regions(diff, i, params)

            change_regions.extend(regions)

        # Cluster overlapping regions across frames
        clustered_regions = self._cluster_temporal_regions(change_regions, params)

        return clustered_regions

    def _compute_frame_difference(
        self, frame1: np.ndarray, frame2: np.ndarray, params: Dict[str, Any]
    ) -> np.ndarray:
        """
        Compute pixel-wise difference between frames

        Returns binary mask of changed pixels
        """
        # Convert to grayscale
        gray1 = cv2.cvtColor(frame1, cv2.COLOR_RGB2GRAY)
        gray2 = cv2.cvtColor(frame2, cv2.COLOR_RGB2GRAY)

        # Absolute difference
        diff = cv2.absdiff(gray1, gray2)

        # Threshold to get binary mask
        _, mask = cv2.threshold(
            diff,
            params["min_change_threshold"],
            255,
            cv2.THRESH_BINARY
        )

        # Clean up noise
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        return mask

    def _extract_changed_regions(
        self, diff_mask: np.ndarray, frame_idx: int, params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Extract bounding boxes of changed regions
        """
        regions = []

        # Find contours
        contours, _ = cv2.findContours(
            diff_mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)

            area = w * h

            # Filter by size
            if area < params["change_area_threshold"]:
                continue

            # Calculate change intensity
            change_pixels = cv2.countNonZero(diff_mask[y:y+h, x:x+w])
            change_density = change_pixels / area if area > 0 else 0

            regions.append({
                "bbox": BoundingBox(x=x, y=y, width=w, height=h),
                "frame_idx": frame_idx,
                "area": area,
                "change_density": change_density,
            })

        return regions

    def _cluster_temporal_regions(
        self, regions: List[Dict[str, Any]], params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Cluster regions that appear in same location across frames

        These are likely interactive elements with hover/animation effects
        """
        if not regions:
            return []

        # Sort by frame index
        regions = sorted(regions, key=lambda r: r["frame_idx"])

        clusters = []
        used = set()

        for i, region in enumerate(regions):
            if i in used:
                continue

            # Start new cluster
            cluster = {
                "bbox": region["bbox"],
                "frame_indices": [region["frame_idx"]],
                "regions": [region],
            }

            used.add(i)

            # Find overlapping regions in subsequent frames
            for j in range(i + 1, len(regions)):
                if j in used:
                    continue

                other = regions[j]

                # Check spatial overlap
                if region["bbox"].iou(other["bbox"]) > 0.5:
                    cluster["regions"].append(other)
                    cluster["frame_indices"].append(other["frame_idx"])
                    used.add(j)

            # Only keep if changes persist across multiple frames
            if len(cluster["frame_indices"]) >= params["hover_duration_frames"]:
                clusters.append(cluster)

        return clusters

    def _validate_interactive_elements(
        self,
        images: List[np.ndarray],
        change_regions: List[Dict[str, Any]],
        params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """
        Validate that changed regions are interactive elements
        """
        elements = []

        for cluster in change_regions:
            bbox = cluster["bbox"]

            # Size validation
            area = bbox.width * bbox.height
            if not (params["min_element_area"] <= area <= params["max_element_area"]):
                continue

            # Analyze change pattern
            change_type = self._analyze_change_pattern(images, cluster, params)

            if change_type is None:
                continue

            # Calculate confidence based on change characteristics
            confidence = self._calculate_temporal_confidence(cluster, change_type, params)

            # Use first frame for screenshot index
            screenshot_idx = cluster["frame_indices"][0]

            elements.append(DetectedElement(
                bounding_box=bbox,
                confidence=confidence,
                label=f"Interactive ({change_type})",
                element_type="interactive",
                screenshot_index=screenshot_idx,
                metadata={
                    "method": "temporal",
                    "change_type": change_type,
                    "num_frames_changed": len(cluster["frame_indices"]),
                    "frame_indices": cluster["frame_indices"],
                },
            ))

        return elements

    def _analyze_change_pattern(
        self,
        images: List[np.ndarray],
        cluster: Dict[str, Any],
        params: Dict[str, Any]
    ) -> Optional[str]:
        """
        Analyze what type of change occurred

        Returns: "hover", "focus", "animation", "click", or None
        """
        bbox = cluster["bbox"]
        frame_indices = cluster["frame_indices"]

        if len(frame_indices) < 2:
            return None

        # Extract regions from frames
        regions = []
        for idx in frame_indices:
            if idx < len(images):
                img = images[idx]
                x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height
                region = img[y:y+h, x:x+w]
                regions.append(region)

        if not regions:
            return None

        # Analyze color changes (hover often changes color)
        color_variance = self._calculate_color_variance(regions)

        if color_variance > params["hover_color_change_threshold"]:
            # Significant color change = likely hover effect
            return "hover"

        # Analyze brightness changes (focus indicators)
        brightness_changes = self._calculate_brightness_changes(regions)

        if brightness_changes > 20:
            return "focus"

        # Analyze size changes (animations)
        size_variance = self._calculate_size_variance(cluster["regions"])

        if size_variance > 10:
            return "animation"

        # Default to hover if persistent change
        if len(frame_indices) >= params["hover_duration_frames"]:
            return "hover"

        return None

    def _calculate_color_variance(self, regions: List[np.ndarray]) -> float:
        """
        Calculate color variance across regions
        """
        if not regions or len(regions) < 2:
            return 0.0

        # Calculate mean color for each region
        mean_colors = []
        for region in regions:
            if region.size > 0:
                mean_color = np.mean(region, axis=(0, 1))
                mean_colors.append(mean_color)

        if not mean_colors:
            return 0.0

        # Calculate variance of mean colors
        mean_colors = np.array(mean_colors)
        variance = np.mean(np.var(mean_colors, axis=0))

        return variance

    def _calculate_brightness_changes(self, regions: List[np.ndarray]) -> float:
        """
        Calculate brightness change magnitude
        """
        if not regions or len(regions) < 2:
            return 0.0

        brightnesses = []
        for region in regions:
            if region.size > 0:
                gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
                brightness = np.mean(gray)
                brightnesses.append(brightness)

        if not brightnesses:
            return 0.0

        # Max change in brightness
        return max(brightnesses) - min(brightnesses)

    def _calculate_size_variance(self, regions: List[Dict[str, Any]]) -> float:
        """
        Calculate variance in region sizes (detecting size animations)
        """
        areas = [r["area"] for r in regions]

        if len(areas) < 2:
            return 0.0

        return np.var(areas)

    def _calculate_temporal_confidence(
        self,
        cluster: Dict[str, Any],
        change_type: str,
        params: Dict[str, Any]
    ) -> float:
        """
        Calculate confidence based on temporal characteristics
        """
        # Base confidence
        confidence = 0.6

        # More frames = higher confidence
        num_frames = len(cluster["frame_indices"])
        frame_bonus = min(0.2, num_frames * 0.05)
        confidence += frame_bonus

        # Change type confidence
        if change_type == "hover":
            confidence += 0.15  # Hover is strong indicator
        elif change_type == "focus":
            confidence += 0.1
        elif change_type == "animation":
            confidence += 0.05

        # Change density (how much of region changed)
        avg_density = np.mean([r["change_density"] for r in cluster["regions"]])
        if avg_density > 0.5:
            confidence += 0.1

        return min(0.95, confidence)
