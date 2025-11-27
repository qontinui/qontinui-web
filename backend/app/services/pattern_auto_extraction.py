"""
Pattern Auto-Extraction Service

Automatic pattern detection using OpenCV computer vision.
This is an EXPERIMENTAL feature.
"""

import base64
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np
else:
    try:
        import numpy as np
    except ImportError:
        np = None  # type: ignore

try:
    import cv2
    import numpy as np

    CV2_AVAILABLE = True
except ImportError:
    cv2 = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]
    CV2_AVAILABLE = False

logger = logging.getLogger(__name__)


@dataclass
class DetectedPattern:
    """Represents a detected UI pattern"""

    region: dict  # {x, y, w, h}
    confidence: float
    pattern_type: str  # button, input, icon, text
    suggested_name: str
    image_data: str  # base64
    source_screenshot: str


class PatternAutoExtractor:
    """Automatic pattern extraction using computer vision"""

    def extract_patterns(
        self,
        screenshot_paths: list[str],
        state_name: str,
        detect_buttons: bool = True,
        detect_inputs: bool = True,
        detect_icons: bool = True,
        min_confidence: float = 0.7,
    ) -> list[DetectedPattern]:
        """
        Auto-detect UI patterns using computer vision.

        Args:
            screenshot_paths: List of paths to screenshot images
            state_name: Name of the state for pattern naming
            detect_buttons: Whether to detect button-like regions
            detect_inputs: Whether to detect input field regions
            detect_icons: Whether to detect icon-like regions
            min_confidence: Minimum confidence threshold (0.0 to 1.0)

        Returns:
            List of detected patterns filtered by confidence
        """
        if not CV2_AVAILABLE:
            logger.warning("OpenCV not available - pattern auto-extraction disabled")
            return []

        patterns = []

        for path in screenshot_paths:
            path_obj = Path(path)
            if not path_obj.exists():
                logger.warning(f"Screenshot not found: {path}")
                continue

            try:
                img = cv2.imread(str(path_obj))
                if img is None:
                    logger.warning(f"Failed to load image: {path}")  # type: ignore[unreachable]
                    continue

                if detect_buttons:
                    patterns.extend(self._detect_buttons(img, str(path)))
                if detect_inputs:
                    patterns.extend(self._detect_input_fields(img, str(path)))
                if detect_icons:
                    patterns.extend(self._detect_icons(img, str(path)))

            except Exception as e:
                logger.error(f"Error processing {path}: {e}", exc_info=True)
                continue

        # Filter by confidence
        patterns = [p for p in patterns if p.confidence >= min_confidence]

        # Merge similar patterns
        patterns = self._merge_similar_patterns(patterns)

        # Generate names
        for i, p in enumerate(patterns):
            p.suggested_name = f"{state_name}_{p.pattern_type}_{i+1}"

        logger.info(
            f"Extracted {len(patterns)} patterns from {len(screenshot_paths)} screenshots"
        )

        return patterns

    def _detect_buttons(self, img: "np.ndarray", path: str) -> list[DetectedPattern]:
        """
        Detect button-like regions using edge detection.

        Buttons are identified by:
        - Rectangular shape
        - Clear edges/borders
        - Reasonable aspect ratio
        - Minimum size
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        patterns = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            aspect_ratio = w / h if h > 0 else 0

            # Button criteria: rectangular, reasonable size
            if 0.5 < aspect_ratio < 10 and w > 50 and h > 20:
                confidence = self._calculate_confidence(
                    contour, img[y : y + h, x : x + w]
                )

                if confidence > 0.5:
                    pattern = DetectedPattern(
                        region={"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                        confidence=float(confidence),
                        pattern_type="button",
                        suggested_name="",
                        image_data=self._encode_region(img, x, y, w, h),
                        source_screenshot=path,
                    )
                    patterns.append(pattern)

        return patterns

    def _detect_input_fields(
        self, img: "np.ndarray", path: str
    ) -> list[DetectedPattern]:
        """
        Detect input field regions.

        Input fields are identified by:
        - White/light background
        - Wide and short rectangular shape
        - Typical input field dimensions
        """
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

        # Detect white/light backgrounds
        lower = np.array([0, 0, 200])
        upper = np.array([180, 30, 255])
        mask = cv2.inRange(hsv, lower, upper)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        patterns = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            aspect_ratio = w / h if h > 0 else 0

            # Input criteria: wide and short
            if 3 < aspect_ratio < 20 and w > 100 and 20 < h < 50:
                confidence = 0.7  # Simplified for input fields
                pattern = DetectedPattern(
                    region={"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                    confidence=confidence,
                    pattern_type="input",
                    suggested_name="",
                    image_data=self._encode_region(img, x, y, w, h),
                    source_screenshot=path,
                )
                patterns.append(pattern)

        return patterns

    def _detect_icons(self, img: "np.ndarray", path: str) -> list[DetectedPattern]:
        """
        Detect small icon-like regions.

        Icons are identified by:
        - Small square or near-square shape
        - Clear edges
        - Typical icon dimensions (15-60 pixels)
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 100, 200)
        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        patterns = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            aspect_ratio = w / h if h > 0 else 0

            # Icon criteria: small and squarish
            if 0.8 < aspect_ratio < 1.2 and 15 < w < 60 and 15 < h < 60:
                pattern = DetectedPattern(
                    region={"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                    confidence=0.6,
                    pattern_type="icon",
                    suggested_name="",
                    image_data=self._encode_region(img, x, y, w, h),
                    source_screenshot=path,
                )
                patterns.append(pattern)

        return patterns

    def _merge_similar_patterns(
        self, patterns: list[DetectedPattern]
    ) -> list[DetectedPattern]:
        """
        Merge patterns with high overlap using IoU (Intersection over Union).

        Args:
            patterns: List of detected patterns

        Returns:
            Merged list with duplicates removed
        """
        if len(patterns) <= 1:
            return patterns

        merged = []
        used = set()

        for i, p1 in enumerate(patterns):
            if i in used:
                continue

            similar = [p1]
            for j, p2 in enumerate(patterns[i + 1 :], i + 1):
                if j in used:
                    continue
                iou = self._calculate_iou(p1.region, p2.region)
                if iou > 0.7:
                    similar.append(p2)
                    used.add(j)

            # Use highest confidence pattern from group
            best = max(similar, key=lambda p: p.confidence)
            merged.append(best)

        return merged

    def _calculate_iou(self, r1: dict, r2: dict) -> float:
        """
        Calculate Intersection over Union for two regions.

        Args:
            r1: Region 1 with x, y, w, h keys
            r2: Region 2 with x, y, w, h keys

        Returns:
            IoU score (0.0 to 1.0)
        """
        x1, y1, w1, h1 = r1["x"], r1["y"], r1["w"], r1["h"]
        x2, y2, w2, h2 = r2["x"], r2["y"], r2["w"], r2["h"]

        xi = max(x1, x2)
        yi = max(y1, y2)
        xi2 = min(x1 + w1, x2 + w2)
        yi2 = min(y1 + h1, y2 + h2)

        inter_area = max(0, xi2 - xi) * max(0, yi2 - yi)
        union_area = w1 * h1 + w2 * h2 - inter_area

        return inter_area / union_area if union_area > 0 else 0

    def _calculate_confidence(
        self, contour: "np.ndarray", region_img: "np.ndarray"
    ) -> float:
        """
        Calculate confidence score for a detected pattern.

        This is a simplified implementation. In production, this could
        incorporate more sophisticated metrics like:
        - Edge strength
        - Color uniformity
        - Texture analysis
        - Machine learning classification

        Args:
            contour: OpenCV contour
            region_img: Image region

        Returns:
            Confidence score (0.0 to 1.0)
        """
        # Base confidence
        confidence = 0.75

        # Adjust based on contour area vs bounding box area
        contour_area = cv2.contourArea(contour)
        x, y, w, h = cv2.boundingRect(contour)
        bbox_area = w * h

        if bbox_area > 0:
            fill_ratio = contour_area / bbox_area
            # More filled = more likely to be a real UI element
            confidence *= 0.5 + 0.5 * fill_ratio

        return min(1.0, confidence)

    def _encode_region(self, img: "np.ndarray", x: int, y: int, w: int, h: int) -> str:
        """
        Extract and encode region as base64.

        Args:
            img: Source image
            x, y: Top-left coordinates
            w, h: Width and height

        Returns:
            Base64 encoded PNG image data with data URI prefix
        """
        # Ensure coordinates are within bounds
        h_img, w_img = img.shape[:2]
        x = max(0, min(x, w_img - 1))
        y = max(0, min(y, h_img - 1))
        w = min(w, w_img - x)
        h = min(h, h_img - y)

        region = img[y : y + h, x : x + w]
        _, buffer = cv2.imencode(".png", region)
        return "data:image/png;base64," + base64.b64encode(buffer).decode()
