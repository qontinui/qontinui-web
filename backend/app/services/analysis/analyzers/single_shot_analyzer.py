"""
Single Shot Analyzer (Type 3)

Uses computer vision or machine learning to detect GUI elements in single screenshots.
Can work with ML models like YOLO, Faster R-CNN, or classical CV techniques.
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


class SingleShotAnalyzer(BaseAnalyzer):
    """
    Analyzes individual screenshots using ML/CV techniques

    Can use various backends:
    - Classical CV: Edge detection, contours, color segmentation
    - ML Models: YOLO, Faster R-CNN, custom GUI element detection models
    - Hybrid: Combination of multiple techniques
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        return "single_shot"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True  # Can process multiple, but analyzes each independently

    @property
    def required_screenshots(self) -> int:
        return 1

    def get_default_parameters(self) -> Dict[str, Any]:
        return {
            "backend": "classical",  # "classical", "ml", or "hybrid"
            "confidence_threshold": 0.5,  # Minimum detection confidence
            "nms_threshold": 0.4,  # Non-maximum suppression threshold
            "detect_buttons": True,
            "detect_inputs": True,
            "detect_images": True,
            "detect_text": True,
            "detect_containers": True,
            "model_path": None,  # Path to ML model if using ML backend
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform single-shot analysis"""
        logger.info(
            f"Running single-shot analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images
        images = self._load_images(input_data.screenshot_data)

        # Analyze each screenshot
        all_elements = []
        for screenshot_idx, img in enumerate(images):
            elements = await self._analyze_screenshot(img, screenshot_idx, params)
            all_elements.extend(elements)

        logger.info(f"Found {len(all_elements)} elements across all screenshots")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=0.75,  # Moderate confidence, depends on backend
            metadata={
                "num_screenshots": len(images),
                "backend": params["backend"],
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

    async def _analyze_screenshot(
        self, image: np.ndarray, screenshot_idx: int, params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """Analyze a single screenshot"""

        backend = params["backend"]

        if backend == "classical":
            return await self._classical_cv_analysis(image, screenshot_idx, params)
        elif backend == "ml":
            return await self._ml_analysis(image, screenshot_idx, params)
        elif backend == "hybrid":
            # Combine both approaches
            classical = await self._classical_cv_analysis(image, screenshot_idx, params)
            ml = await self._ml_analysis(image, screenshot_idx, params)
            return classical + ml
        else:
            logger.warning(f"Unknown backend: {backend}, using classical")
            return await self._classical_cv_analysis(image, screenshot_idx, params)

    async def _classical_cv_analysis(
        self, image: np.ndarray, screenshot_idx: int, params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """
        Classical computer vision analysis

        Uses edge detection, contours, color segmentation, etc.
        This is a placeholder - in production you'd implement actual CV algorithms.
        """
        elements = []

        logger.info("Running classical CV analysis - placeholder implementation")

        # Mock implementation showing different element types
        height, width = image.shape[:2]

        # Detect buttons using color and edge information
        if params.get("detect_buttons", True):
            buttons = self._detect_buttons_cv(image)
            for bbox in buttons:
                elements.append(
                    DetectedElement(
                        bounding_box=bbox,
                        confidence=0.7,
                        label="Button",
                        element_type="button",
                        screenshot_index=screenshot_idx,
                        metadata={"method": "classical_cv", "detector": "edge_based"},
                    )
                )

        # Detect input fields
        if params.get("detect_inputs", True):
            inputs = self._detect_inputs_cv(image)
            for bbox in inputs:
                elements.append(
                    DetectedElement(
                        bounding_box=bbox,
                        confidence=0.65,
                        label="Input Field",
                        element_type="input",
                        screenshot_index=screenshot_idx,
                        metadata={
                            "method": "classical_cv",
                            "detector": "contour_based",
                        },
                    )
                )

        # Detect images/icons
        if params.get("detect_images", True):
            images_found = self._detect_images_cv(image)
            for bbox in images_found:
                elements.append(
                    DetectedElement(
                        bounding_box=bbox,
                        confidence=0.6,
                        label="Image",
                        element_type="image",
                        screenshot_index=screenshot_idx,
                        metadata={"method": "classical_cv", "detector": "color_based"},
                    )
                )

        return elements

    async def _ml_analysis(
        self, image: np.ndarray, screenshot_idx: int, params: Dict[str, Any]
    ) -> List[DetectedElement]:
        """
        Machine learning-based analysis

        Would use models like YOLO, Faster R-CNN, or custom trained models.
        This is a placeholder for actual ML inference.
        """
        elements = []

        logger.info("Running ML analysis - placeholder implementation")

        # In production, you would:
        # 1. Load the ML model (YOLO, etc.)
        # 2. Preprocess the image
        # 3. Run inference
        # 4. Post-process detections (NMS, etc.)
        # 5. Convert to DetectedElement objects

        # Mock ML detections
        height, width = image.shape[:2]

        # Simulate ML model detecting various GUI elements
        mock_detections = [
            {
                "bbox": BoundingBox(x=50, y=50, width=100, height=40),
                "class": "button",
                "confidence": 0.92,
            },
            {
                "bbox": BoundingBox(x=200, y=100, width=150, height=30),
                "class": "input",
                "confidence": 0.88,
            },
        ]

        for detection in mock_detections:
            elements.append(
                DetectedElement(
                    bounding_box=detection["bbox"],
                    confidence=detection["confidence"],
                    label=detection["class"].title(),
                    element_type=detection["class"],
                    screenshot_index=screenshot_idx,
                    metadata={
                        "method": "ml",
                        "model": params.get("model_path", "default"),
                    },
                )
            )

        return elements

    def _detect_buttons_cv(self, image: np.ndarray) -> List[BoundingBox]:
        """
        Detect buttons using classical CV

        Placeholder - would use edge detection, color analysis, shape detection
        """
        # Mock implementation
        return [
            BoundingBox(x=100, y=100, width=80, height=30),
        ]

    def _detect_inputs_cv(self, image: np.ndarray) -> List[BoundingBox]:
        """
        Detect input fields using classical CV

        Placeholder - would look for rectangular regions with certain characteristics
        """
        # Mock implementation
        return [
            BoundingBox(x=100, y=200, width=200, height=25),
        ]

    def _detect_images_cv(self, image: np.ndarray) -> List[BoundingBox]:
        """
        Detect images/icons using classical CV

        Placeholder - would use color histograms, SIFT features, etc.
        """
        # Mock implementation
        return [
            BoundingBox(x=50, y=50, width=40, height=40),
        ]
