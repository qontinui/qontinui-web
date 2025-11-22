"""
Button Text Rectangle Detector

Detects buttons by finding text enclosed in rectangles:
- Uses pytesseract OCR to find text regions
- Finds enclosing rectangles around text
- Checks padding consistency (text shouldn't touch edges)
- Validates button-like text (short: 1-3 words, common button labels)

High precision strategy - only reports high-confidence button detections.
"""

import logging
from io import BytesIO
from typing import Any, Dict, List, Tuple

import cv2
import numpy as np
from PIL import Image

try:
    import pytesseract

    PYTESSERACT_AVAILABLE = True
except ImportError:
    PYTESSERACT_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning(
        "pytesseract not available - button_text_rectangle will have limited functionality"
    )

from ..base import (
    AnalysisInput,
    AnalysisResult,
    AnalysisType,
    BaseAnalyzer,
    BoundingBox,
    DetectedElement,
)

logger = logging.getLogger(__name__)


class ButtonTextRectangleDetector(BaseAnalyzer):
    """
    Detects buttons by finding text inside rectangles

    Algorithm:
    1. Use OCR to detect all text regions
    2. For each text region, find the enclosing rectangle/border
    3. Check if padding is consistent (indicates a button)
    4. Validate that text is button-like (short, common words)
    5. High precision - only report confident detections
    """

    # Common button text patterns (lowercase)
    COMMON_BUTTON_TEXTS = {
        "ok",
        "cancel",
        "submit",
        "save",
        "delete",
        "edit",
        "add",
        "remove",
        "close",
        "confirm",
        "yes",
        "no",
        "next",
        "back",
        "previous",
        "continue",
        "apply",
        "reset",
        "clear",
        "search",
        "login",
        "logout",
        "sign in",
        "sign up",
        "register",
        "download",
        "upload",
        "send",
        "create",
        "update",
        "done",
        "finish",
        "start",
        "stop",
        "pause",
        "play",
        "retry",
        "skip",
    }

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.CUSTOM

    @property
    def name(self) -> str:
        return "button_text_rectangle"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            # Text constraints
            "min_text_length": 1,
            "max_text_length": 20,  # Characters
            "max_words": 3,  # Buttons usually have 1-3 words
            # Padding constraints (pixels)
            "min_padding": 5,  # Minimum padding around text
            "max_padding": 30,  # Maximum padding around text
            "padding_symmetry_threshold": 0.3,  # How symmetric padding should be
            # Rectangle detection
            "edge_detection_threshold1": 50,
            "edge_detection_threshold2": 150,
            # Confidence thresholds
            "min_confidence": 0.6,
            "common_text_bonus": 0.2,  # Bonus for common button text
            # OCR settings
            "ocr_config": "--psm 11",  # Page segmentation mode: sparse text
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform text-rectangle button detection"""
        logger.info(
            f"Running button text-rectangle detection on {len(input_data.screenshots)} screenshots"
        )

        if not PYTESSERACT_AVAILABLE:
            logger.warning("pytesseract not available - returning empty results")
            return AnalysisResult(
                analyzer_type=self.analysis_type,
                analyzer_name=self.name,
                elements=[],
                confidence=0.0,
                metadata={
                    "error": "pytesseract not available",
                    "num_screenshots": len(input_data.screenshots),
                },
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
            f"Detected {len(all_elements)} button candidates using text-rectangle analysis"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=0.82,  # High precision strategy
            metadata={
                "num_screenshots": len(images_gray),
                "method": "text_rectangle_detection",
                "parameters": params,
                "detector_type": "button_text_rectangle",
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
            images.append(
                cv2.cvtColor(np.array(img, dtype=np.uint8), cv2.COLOR_RGB2BGR)
            )
        return images

    async def _analyze_screenshot(
        self,
        img_gray: np.ndarray,
        img_color: np.ndarray,
        screenshot_idx: int,
        params: Dict[str, Any],
    ) -> List[DetectedElement]:
        """Analyze a single screenshot for text-in-rectangle buttons"""
        elements = []

        try:
            # Step 1: Perform OCR to detect text regions
            ocr_data = pytesseract.image_to_data(
                img_gray,
                config=params["ocr_config"],
                output_type=pytesseract.Output.DICT,
            )

            # Step 2: Process each detected text region
            num_boxes = len(ocr_data["text"])
            for i in range(num_boxes):
                text = ocr_data["text"][i].strip()

                # Skip empty or invalid text
                if not text:
                    continue

                # Step 3: Validate text is button-like
                if not self._is_button_like_text(text, params):
                    continue

                # Get text bounding box
                text_x = ocr_data["left"][i]
                text_y = ocr_data["top"][i]
                text_w = ocr_data["width"][i]
                text_h = ocr_data["height"][i]
                ocr_conf = float(ocr_data["conf"][i])

                # Skip low confidence OCR results
                if ocr_conf < 30:
                    continue

                # Step 4: Find enclosing rectangle around the text
                button_bbox, padding_info = self._find_enclosing_rectangle(
                    img_gray, text_x, text_y, text_w, text_h, params
                )

                if button_bbox is None:
                    continue

                # Step 5: Check padding consistency
                padding_score = self._evaluate_padding(padding_info, params)
                if padding_score < 0.5:
                    continue

                # Step 6: Calculate confidence
                confidence = self._calculate_confidence(
                    text, ocr_conf, padding_score, padding_info, params
                )

                if confidence < params["min_confidence"]:
                    continue

                # Create detected element
                elements.append(
                    DetectedElement(
                        bounding_box=button_bbox,
                        confidence=confidence,
                        label=f"Button: {text}",
                        element_type="button",
                        screenshot_index=screenshot_idx,
                        metadata={
                            "method": "text_rectangle_detection",
                            "text": text,
                            "ocr_confidence": float(ocr_conf / 100.0),
                            "padding_score": float(padding_score),
                            "padding": padding_info,
                        },
                    )
                )

        except Exception as e:
            logger.error(f"Error in OCR processing: {e}", exc_info=True)

        return elements

    def _is_button_like_text(self, text: str, params: Dict[str, Any]) -> bool:
        """
        Check if text is typical of button labels

        Buttons usually have:
        - Short text (1-3 words)
        - Common action words
        - Reasonable length
        """
        # Check length
        if not (params["min_text_length"] <= len(text) <= params["max_text_length"]):
            return False

        # Check word count
        words = text.split()
        if len(words) > params["max_words"]:
            return False

        # Empty words list
        if len(words) == 0:
            return False

        return True

    def _find_enclosing_rectangle(
        self,
        img_gray: np.ndarray,
        text_x: int,
        text_y: int,
        text_w: int,
        text_h: int,
        params: Dict[str, Any],
    ) -> Tuple[BoundingBox | None, Dict[str, int]]:
        """
        Find the button rectangle enclosing the text

        Strategy:
        1. Extract region around text
        2. Apply edge detection
        3. Find contours
        4. Select the contour that encloses the text with reasonable padding
        """
        # Expand search region around text
        search_margin = params["max_padding"] + 10
        h, w = img_gray.shape[:2]

        x1 = max(0, text_x - search_margin)
        y1 = max(0, text_y - search_margin)
        x2 = min(w, text_x + text_w + search_margin)
        y2 = min(h, text_y + text_h + search_margin)

        region = img_gray[y1:y2, x1:x2]

        if region.size == 0:
            return None, {}

        # Apply edge detection
        edges = cv2.Canny(
            region,
            params["edge_detection_threshold1"],
            params["edge_detection_threshold2"],
        )

        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        # Convert text coordinates to region-relative
        text_x_rel = text_x - x1
        text_y_rel = text_y - y1

        best_bbox = None
        best_padding = {}
        best_score = 0

        for contour in contours:
            # Get bounding rectangle
            cx, cy, cw, ch = cv2.boundingRect(contour)

            # Check if this contour encloses the text
            if not (
                cx <= text_x_rel
                and cy <= text_y_rel
                and cx + cw >= text_x_rel + text_w
                and cy + ch >= text_y_rel + text_h
            ):
                continue

            # Calculate padding
            pad_left = text_x_rel - cx
            pad_right = (cx + cw) - (text_x_rel + text_w)
            pad_top = text_y_rel - cy
            pad_bottom = (cy + ch) - (text_y_rel + text_h)

            # Check if padding is in valid range
            paddings = [pad_left, pad_right, pad_top, pad_bottom]
            if not all(
                params["min_padding"] <= p <= params["max_padding"] for p in paddings
            ):
                continue

            # Score based on padding symmetry and size
            avg_h_pad = (pad_left + pad_right) / 2
            avg_v_pad = (pad_top + pad_bottom) / 2
            h_symmetry = 1.0 - abs(pad_left - pad_right) / max(avg_h_pad, 1)
            v_symmetry = 1.0 - abs(pad_top - pad_bottom) / max(avg_v_pad, 1)
            symmetry_score = (h_symmetry + v_symmetry) / 2

            # Prefer smaller rectangles that still enclose the text
            size_score = 1.0 / (1.0 + (cw * ch) / 10000)

            score = symmetry_score * 0.7 + size_score * 0.3

            if score > best_score:
                best_score = score
                # Convert back to absolute coordinates
                best_bbox = BoundingBox(x=x1 + cx, y=y1 + cy, width=cw, height=ch)
                best_padding = {
                    "left": pad_left,
                    "right": pad_right,
                    "top": pad_top,
                    "bottom": pad_bottom,
                }

        return best_bbox, best_padding

    def _evaluate_padding(
        self, padding_info: Dict[str, int], params: Dict[str, Any]
    ) -> float:
        """
        Evaluate how consistent and appropriate the padding is

        Good button padding:
        - Symmetric (left/right similar, top/bottom similar)
        - Reasonable size (not too tight, not too loose)
        """
        if not padding_info:
            return 0.0

        pad_left = padding_info["left"]
        pad_right = padding_info["right"]
        pad_top = padding_info["top"]
        pad_bottom = padding_info["bottom"]

        # Calculate symmetry
        avg_h_pad = (pad_left + pad_right) / 2
        avg_v_pad = (pad_top + pad_bottom) / 2

        h_diff = abs(pad_left - pad_right)
        v_diff = abs(pad_top - pad_bottom)

        h_symmetry = 1.0 - min(1.0, h_diff / max(avg_h_pad, 1))
        v_symmetry = 1.0 - min(1.0, v_diff / max(avg_v_pad, 1))

        symmetry_score = (h_symmetry + v_symmetry) / 2

        # Check if padding is in optimal range (10-20 pixels is typical)
        optimal_min = 10
        optimal_max = 20
        avg_padding = (avg_h_pad + avg_v_pad) / 2

        if optimal_min <= avg_padding <= optimal_max:
            size_score = 1.0
        elif avg_padding < optimal_min:
            size_score = avg_padding / optimal_min
        else:
            size_score = max(0, 1.0 - (avg_padding - optimal_max) / optimal_max)

        return symmetry_score * 0.7 + size_score * 0.3

    def _calculate_confidence(
        self,
        text: str,
        ocr_conf: float,
        padding_score: float,
        padding_info: Dict[str, int],
        params: Dict[str, Any],
    ) -> float:
        """
        Calculate confidence score for button detection

        Factors:
        - OCR confidence: how confident the text detection is
        - Padding score: how button-like the padding is
        - Text matching: bonus for common button text
        """
        # Base score from OCR confidence (0.0 to 0.3)
        confidence = (ocr_conf / 100.0) * 0.3

        # Padding quality (0.0 to 0.4)
        confidence += padding_score * 0.4

        # Text quality bonus (0.0 to 0.3)
        text_lower = text.lower().strip()

        # Check for exact match with common button text
        if text_lower in self.COMMON_BUTTON_TEXTS:
            confidence += params["common_text_bonus"]
        # Check for partial match
        elif any(common in text_lower for common in self.COMMON_BUTTON_TEXTS):
            confidence += params["common_text_bonus"] * 0.5

        # Short text bonus (buttons typically have short text)
        if len(text.split()) <= 2:
            confidence += 0.1

        return min(1.0, max(0.0, confidence))
