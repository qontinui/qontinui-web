"""
Accessibility Analyzer - ARIA Roles and Semantic Detection

Leverages accessibility information when available (web screenshots with DOM access).
Detects interactive elements using:
- ARIA roles (button, link, menuitem, etc.)
- Semantic HTML (button, a, input[type=button/submit])
- Tab index and focus indicators
- Accessibility labels and descriptions

Works best with browser automation tools that can inject accessibility data.
"""

import json
import logging
from io import BytesIO
from typing import Any, Dict, List, Optional

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


class AccessibilityAnalyzer(BaseAnalyzer):
    """
    Detects interactive elements using accessibility information

    When accessibility data is available (from DOM, accessibility tree, etc.),
    this provides the most accurate detection of interactive elements.

    Input format (in parameters):
    {
        "accessibility_data": [
            {
                "role": "button",
                "name": "Submit",
                "bbox": {"x": 100, "y": 200, "width": 80, "height": 32},
                "screenshot_index": 0,
                "tag": "button",
                "attributes": {...}
            },
            ...
        ]
    }
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "accessibility"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            # Accessibility data (injected by browser automation)
            "accessibility_data": None,
            # Role filtering
            "interactive_roles": [
                "button",
                "link",
                "menuitem",
                "menuitemcheckbox",
                "menuitemradio",
                "option",
                "radio",
                "checkbox",
                "switch",
                "tab",
                "treeitem",
                "searchbox",
                "textbox",
                "combobox",
                "slider",
                "spinbutton",
            ],
            # Tag filtering (HTML tags)
            "interactive_tags": ["button", "a", "input", "select", "textarea"],
            # Confidence scores
            "role_confidence": 0.95,  # High confidence for explicit roles
            "tag_confidence": 0.85,  # Slightly lower for semantic HTML
            "visual_validation": True,  # Validate visually if possible
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform accessibility-based detection"""
        logger.info(
            f"Running accessibility analysis on {len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Check if accessibility data is provided
        accessibility_data = params.get("accessibility_data")

        if accessibility_data is None:
            logger.warning(
                "No accessibility data provided. "
                "This analyzer requires accessibility_data in parameters."
            )
            return AnalysisResult(
                analyzer_type=self.analysis_type,
                analyzer_name=self.name,
                elements=[],
                confidence=0.0,
                metadata={
                    "num_screenshots": len(input_data.screenshots),
                    "method": "accessibility",
                    "error": "no_accessibility_data",
                },
            )

        # Load images for visual validation
        images = (
            self._load_images(input_data.screenshot_data)
            if params["visual_validation"]
            else []
        )

        # Process accessibility data
        elements = self._process_accessibility_data(accessibility_data, images, params)

        avg_confidence = np.mean([e.confidence for e in elements]) if elements else 0.0

        logger.info(
            f"Found {len(elements)} interactive elements from accessibility data "
            f"with avg confidence {avg_confidence:.2f}"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=float(avg_confidence),
            metadata={
                "num_screenshots": len(input_data.screenshots),
                "method": "accessibility",
                "num_accessible_elements": len(accessibility_data),
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

    def _process_accessibility_data(
        self,
        accessibility_data: List[Dict[str, Any]],
        images: List[np.ndarray],
        params: Dict[str, Any],
    ) -> List[DetectedElement]:
        """
        Process accessibility data to extract interactive elements
        """
        elements = []

        for item in accessibility_data:
            # Check if element is interactive
            if not self._is_interactive(item, params):
                continue

            # Extract bounding box
            bbox_data = item.get("bbox")
            if bbox_data is None:
                continue

            bbox = BoundingBox(
                x=int(bbox_data["x"]),
                y=int(bbox_data["y"]),
                width=int(bbox_data["width"]),
                height=int(bbox_data["height"]),
            )

            screenshot_idx = item.get("screenshot_index", 0)

            # Determine confidence
            confidence = self._calculate_confidence(item, params)

            # Visual validation if enabled
            if params["visual_validation"] and images:
                if screenshot_idx < len(images):
                    validation_score = self._validate_visually(
                        images[screenshot_idx], bbox
                    )
                    confidence *= validation_score

            # Extract element type
            element_type = self._determine_element_type(item)

            # Extract label
            label = self._extract_label(item)

            elements.append(
                DetectedElement(
                    bounding_box=bbox,
                    confidence=confidence,
                    label=label,
                    element_type=element_type,
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "accessibility",
                        "role": item.get("role"),
                        "tag": item.get("tag"),
                        "accessible_name": item.get("name"),
                        "attributes": item.get("attributes", {}),
                    },
                )
            )

        return elements

    def _is_interactive(self, item: Dict[str, Any], params: Dict[str, Any]) -> bool:
        """
        Determine if accessibility item represents an interactive element
        """
        # Check role
        role = item.get("role")
        if role and role in params["interactive_roles"]:
            return True

        # Check tag
        tag = item.get("tag", "").lower()
        if tag in params["interactive_tags"]:
            # For input tags, check type
            if tag == "input":
                input_type = item.get("attributes", {}).get("type", "text").lower()
                if input_type in ["button", "submit", "reset", "image"]:
                    return True
            else:
                return True

        # Check for interactive attributes
        attributes = item.get("attributes", {})
        if "onclick" in attributes or "href" in attributes:
            return True

        # Check tabindex (positive tabindex = interactive)
        tabindex = attributes.get("tabindex")
        if tabindex is not None:
            try:
                if int(tabindex) >= 0:
                    return True
            except (ValueError, TypeError):
                pass

        return False

    def _calculate_confidence(
        self, item: Dict[str, Any], params: Dict[str, Any]
    ) -> float:
        """
        Calculate confidence based on accessibility information quality
        """
        confidence = 0.5

        # Explicit role = high confidence
        role = item.get("role")
        if role and role in params["interactive_roles"]:
            confidence = params["role_confidence"]

        # Semantic HTML tag
        tag = item.get("tag", "").lower()
        if tag in params["interactive_tags"]:
            confidence = max(confidence, params["tag_confidence"])

        # Has accessible name = higher confidence
        if item.get("name"):
            confidence = min(1.0, confidence + 0.05)

        # Has proper ARIA attributes
        attributes = item.get("attributes", {})
        aria_attrs = [k for k in attributes.keys() if k.startswith("aria-")]
        if aria_attrs:
            confidence = min(1.0, confidence + 0.02 * len(aria_attrs))

        return confidence

    def _determine_element_type(self, item: Dict[str, Any]) -> str:
        """
        Determine element type from accessibility data
        """
        role = item.get("role", "").lower()
        tag = item.get("tag", "").lower()

        # Map roles to element types
        if role in ["button", "menuitem", "menuitemcheckbox", "menuitemradio"]:
            return "button"
        elif role in ["link"]:
            return "link"
        elif role in ["textbox", "searchbox"]:
            return "input"
        elif role in ["checkbox"]:
            return "checkbox"
        elif role in ["radio"]:
            return "radio"
        elif role in ["combobox", "listbox"]:
            return "select"

        # Fallback to tag
        if tag == "button":
            return "button"
        elif tag == "a":
            return "link"
        elif tag == "input":
            input_type = item.get("attributes", {}).get("type", "text").lower()
            if input_type in ["button", "submit", "reset"]:
                return "button"
            else:
                return "input"
        elif tag == "select":
            return "select"
        elif tag == "textarea":
            return "textarea"

        return "interactive"

    def _extract_label(self, item: Dict[str, Any]) -> str:
        """
        Extract human-readable label for element
        """
        # Try accessible name first
        name = item.get("name")
        if name:
            return name

        # Try aria-label
        aria_label = item.get("attributes", {}).get("aria-label")
        if aria_label:
            return aria_label

        # Try value/placeholder for inputs
        attributes = item.get("attributes", {})
        value = attributes.get("value")
        if value:
            return value

        placeholder = attributes.get("placeholder")
        if placeholder:
            return f"[{placeholder}]"

        # Fallback to role/tag
        role = item.get("role")
        if role:
            return role.title()

        tag = item.get("tag")
        if tag:
            return tag.title()

        return "Interactive Element"

    def _validate_visually(self, img: np.ndarray, bbox: BoundingBox) -> float:
        """
        Visually validate that element exists at given location

        Returns validation score (0-1)
        """
        x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height

        # Check bounds
        if x < 0 or y < 0 or x + w > img.shape[1] or y + h > img.shape[0]:
            return 0.7  # Out of bounds but might be scroll issue

        # Extract region
        region = img[y : y + h, x : x + w]

        if region.size == 0:
            return 0.5

        # Check if region has content
        gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)

        # Calculate content variance
        variance = np.var(gray)

        # Empty region (all white/single color) = suspicious
        if variance < 10:
            return 0.6

        # Has content = good
        if variance > 50:
            return 1.0

        # Moderate content
        return 0.8
