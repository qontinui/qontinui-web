"""
Pattern Match Analyzer - Template Matching Method

Detects recurring patterns using template matching. Extracts candidate templates
from screenshots and matches them across all images.
"""

import logging
from typing import Dict, Any, List, Tuple
from io import BytesIO
from PIL import Image
import numpy as np
import cv2
from collections import defaultdict

from ..base import (
    BaseAnalyzer,
    AnalysisType,
    AnalysisInput,
    AnalysisResult,
    DetectedElement,
    BoundingBox,
)

logger = logging.getLogger(__name__)


class PatternTemplateMatchAnalyzer(BaseAnalyzer):
    """
    Finds recurring patterns using template matching

    Algorithm:
    1. Extract candidate regions (potential UI elements) from first screenshot
    2. Use each candidate as a template
    3. Match template across all screenshots
    4. Group matches with similar positions
    5. Return patterns that appear multiple times
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.PATTERN_MATCH

    @property
    def name(self) -> str:
        return "pattern_template_match"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            "min_occurrences": 2,  # Pattern must appear at least N times
            "match_threshold": 0.7,  # Template matching threshold (0-1)
            "min_template_size": 20,  # Minimum template size
            "max_template_size": 200,  # Maximum template size
            "max_templates": 50,  # Max number of templates to extract
            "match_method": "cv2.TM_CCOEFF_NORMED",  # OpenCV matching method
            "nms_threshold": 0.3,  # Non-maximum suppression threshold
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform template matching pattern analysis"""
        logger.info(
            f"Running template matching pattern analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images as grayscale
        images = self._load_images_grayscale(input_data.screenshot_data)
        images = self._resize_to_common_size(images)

        # Extract templates from first image
        templates = self._extract_candidate_templates(images[0], params)
        logger.info(f"Extracted {len(templates)} candidate templates")

        # Match templates across all images
        all_matches = []
        for template_idx, template in enumerate(templates):
            matches = self._match_template_across_images(
                template, images, params, template_idx
            )
            all_matches.extend(matches)

        # Filter by occurrence count
        elements = self._filter_by_occurrences(all_matches, params)

        logger.info(f"Found {len(elements)} recurring pattern instances")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.78,
            metadata={
                "num_screenshots": len(images),
                "method": "template_matching",
                "num_templates": len(templates),
                "parameters": params,
            },
        )

    def _load_images_grayscale(self, screenshot_data: List[bytes]) -> List[np.ndarray]:
        """Load screenshots as grayscale numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert('L')
            images.append(np.array(img, dtype=np.uint8))
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

    def _extract_candidate_templates(
        self, image: np.ndarray, params: Dict[str, Any]
    ) -> List[Tuple[np.ndarray, BoundingBox]]:
        """
        Extract candidate templates using edge detection and contours

        Returns:
            List of (template_image, bounding_box) tuples
        """
        templates = []

        # Edge detection
        edges = cv2.Canny(image, 50, 150)

        # Dilate to connect nearby edges
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=2)

        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Sort by area (largest first) and take top N
        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        contours = contours[:params["max_templates"]]

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)

            # Filter by size
            if (params["min_template_size"] <= w <= params["max_template_size"] and
                params["min_template_size"] <= h <= params["max_template_size"]):

                # Extract template
                template = image[y:y+h, x:x+w].copy()
                bbox = BoundingBox(x=x, y=y, width=w, height=h)

                templates.append((template, bbox))

        return templates

    def _match_template_across_images(
        self,
        template_info: Tuple[np.ndarray, BoundingBox],
        images: List[np.ndarray],
        params: Dict[str, Any],
        template_idx: int
    ) -> List[DetectedElement]:
        """
        Match a template across all images

        Returns:
            List of detected instances
        """
        template, original_bbox = template_info
        matches = []

        # Get matching method
        method_name = params["match_method"]
        method = getattr(cv2, method_name.replace("cv2.", ""), cv2.TM_CCOEFF_NORMED)

        for screenshot_idx, image in enumerate(images):
            # Skip if template is larger than image
            if template.shape[0] > image.shape[0] or template.shape[1] > image.shape[1]:
                continue

            # Perform template matching
            result = cv2.matchTemplate(image, template, method)

            # Find locations above threshold
            threshold = params["match_threshold"]
            locations = np.where(result >= threshold)

            # Convert to list of (x, y, confidence)
            for y, x in zip(*locations):
                confidence = float(result[y, x])

                matches.append(DetectedElement(
                    bounding_box=BoundingBox(
                        x=int(x),
                        y=int(y),
                        width=template.shape[1],
                        height=template.shape[0]
                    ),
                    confidence=confidence,
                    label="Recurring Pattern",
                    element_type="pattern",
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "template_matching",
                        "template_id": template_idx,
                    },
                ))

        # Apply non-maximum suppression within each screenshot
        matches = self._apply_nms_per_screenshot(matches, params)

        return matches

    def _apply_nms_per_screenshot(
        self, elements: List[DetectedElement], params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """Apply non-maximum suppression to remove overlapping detections"""
        # Group by screenshot
        by_screenshot = defaultdict(list)
        for elem in elements:
            by_screenshot[elem.screenshot_index].append(elem)

        result = []

        # Apply NMS to each screenshot separately
        for screenshot_idx, elems in by_screenshot.items():
            if not elems:
                continue

            # Convert to format for NMS
            boxes = []
            scores = []
            for elem in elems:
                boxes.append([
                    elem.bounding_box.x,
                    elem.bounding_box.y,
                    elem.bounding_box.x + elem.bounding_box.width,
                    elem.bounding_box.y + elem.bounding_box.height
                ])
                scores.append(elem.confidence)

            boxes = np.array(boxes)
            scores = np.array(scores)

            # Apply NMS
            indices = cv2.dnn.NMSBoxes(
                boxes.tolist(),
                scores.tolist(),
                score_threshold=0.0,
                nms_threshold=params["nms_threshold"]
            )

            # Keep only non-suppressed elements
            if len(indices) > 0:
                indices = indices.flatten()
                for idx in indices:
                    result.append(elems[idx])

        return result

    def _filter_by_occurrences(
        self, elements: List[DetectedElement], params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """
        Filter patterns by minimum occurrence count

        Group similar patterns and keep only those appearing multiple times
        """
        min_occurrences = params["min_occurrences"]

        # Group by template_id
        by_template = defaultdict(list)
        for elem in elements:
            template_id = elem.metadata.get("template_id", 0)
            by_template[template_id].append(elem)

        # Keep only templates with enough occurrences
        result = []
        for template_id, elems in by_template.items():
            if len(elems) >= min_occurrences:
                result.extend(elems)

        return result
