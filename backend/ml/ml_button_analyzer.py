"""
ML-based Button Analyzer

Integrates trained ML models with the analysis system.
Inherits from BaseAnalyzer for seamless integration.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from typing import Dict, Any, List, Optional
import numpy as np
from PIL import Image
import io
import torch

from app.services.analysis.base import (
    BaseAnalyzer,
    AnalysisType,
    AnalysisResult,
    AnalysisInput,
    DetectedElement,
    BoundingBox
)

from ml.inference import ButtonDetectorInference


class MLButtonAnalyzer(BaseAnalyzer):
    """
    ML-based button analyzer using trained detection models

    This analyzer uses trained machine learning models to detect and classify
    buttons in screenshots. Supports both classification and detection models.

    Features:
        - Single-shot analysis (no multiple screenshots needed)
        - GPU acceleration if available
        - Configurable confidence threshold
        - Support for multiple model architectures
        - NMS post-processing for overlapping detections
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize ML Button Analyzer

        Config parameters:
            - model_path: Path to trained model checkpoint (required)
            - model_type: Model architecture ('mobilenet_v3', 'efficientnet_b0', 'yolov8', etc.)
            - confidence_threshold: Minimum confidence for detections (default: 0.5)
            - nms_threshold: IoU threshold for NMS (default: 0.45)
            - device: Device to use ('auto', 'cpu', 'cuda')
            - mode: 'detection' or 'classification'
        """
        super().__init__(config)

        # Validate config
        if 'model_path' not in self.config:
            raise ValueError("model_path is required in config")

        # Initialize inference engine
        self.inference = ButtonDetectorInference(
            model_path=self.config['model_path'],
            model_type=self.config.get('model_type', 'mobilenet_v3'),
            device=self.config.get('device', 'auto'),
            confidence_threshold=self.config.get('confidence_threshold', 0.5),
            nms_threshold=self.config.get('nms_threshold', 0.45)
        )

        self.mode = self.config.get('mode', 'detection')

        print(f"MLButtonAnalyzer initialized: {self.inference.model_type} on {self.inference.device}")

    @property
    def analysis_type(self) -> AnalysisType:
        """Return the type of analysis this module performs"""
        return AnalysisType.SINGLE_SHOT

    @property
    def name(self) -> str:
        """Return a unique name for this analyzer"""
        return "ml_button_detector"

    @property
    def version(self) -> str:
        """Return the version of this analyzer"""
        return "1.0.0"

    @property
    def required_screenshots(self) -> int:
        """Minimum number of screenshots required"""
        return 1  # ML models work on single screenshots

    @property
    def supports_multi_screenshot(self) -> bool:
        """Whether this analyzer can process multiple screenshots"""
        return True  # Can process each screenshot independently

    def validate_input(self, input_data: AnalysisInput) -> bool:
        """Validate that input data is suitable for this analyzer"""
        if len(input_data.screenshots) < 1:
            return False

        if len(input_data.screenshot_data) < 1:
            return False

        return True

    def get_default_parameters(self) -> Dict[str, Any]:
        """Get default parameters for this analyzer"""
        return {
            'confidence_threshold': 0.5,
            'nms_threshold': 0.45,
            'mode': 'detection'
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """
        Perform ML-based button detection analysis

        Args:
            input_data: Input screenshots and parameters

        Returns:
            AnalysisResult containing detected button elements
        """
        all_elements = []
        metadata = {
            'model_type': self.inference.model_type,
            'confidence_threshold': self.inference.confidence_threshold,
            'device': str(self.inference.device),
            'mode': self.mode
        }

        # Override thresholds if provided in parameters
        confidence_threshold = input_data.parameters.get(
            'confidence_threshold',
            self.inference.confidence_threshold
        )

        # Process each screenshot
        for idx, (screenshot_meta, screenshot_bytes) in enumerate(
            zip(input_data.screenshots, input_data.screenshot_data)
        ):
            # Load image
            image = Image.open(io.BytesIO(screenshot_bytes)).convert('RGB')
            image_np = np.array(image)

            # Run inference based on mode
            if self.mode == 'detection' and isinstance(self.inference.model, type(self.inference.model)):
                # For YOLO models, run full detection
                try:
                    detections = self.inference.predict_detection(image)
                except ValueError:
                    # Model doesn't support detection, fall back to classification
                    detections = []
            else:
                detections = []

            # Convert detections to DetectedElement format
            for detection in detections:
                if detection['confidence'] >= confidence_threshold:
                    bbox = BoundingBox(
                        x=int(detection['bbox'][0]),
                        y=int(detection['bbox'][1]),
                        width=int(detection['bbox'][2]),
                        height=int(detection['bbox'][3])
                    )

                    element = DetectedElement(
                        bounding_box=bbox,
                        confidence=detection['confidence'],
                        label=detection['class_name'],
                        element_type='button',
                        screenshot_index=idx,
                        metadata={
                            'button_type': detection['class_name'],
                            'class_id': detection['class_id'],
                            'model_type': self.inference.model_type
                        }
                    )

                    all_elements.append(element)

        # Apply NMS if multiple overlapping detections
        if len(all_elements) > 1:
            all_elements = self._apply_nms_to_elements(all_elements)

        # Calculate overall confidence
        overall_confidence = self._calculate_overall_confidence(all_elements)

        metadata['num_detections'] = len(all_elements)
        metadata['screenshots_processed'] = len(input_data.screenshots)

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=overall_confidence,
            metadata=metadata
        )

    def _apply_nms_to_elements(self,
                               elements: List[DetectedElement],
                               iou_threshold: float = None) -> List[DetectedElement]:
        """
        Apply NMS to detected elements

        Args:
            elements: List of detected elements
            iou_threshold: IoU threshold (uses config if None)

        Returns:
            Filtered list of elements
        """
        if not elements:
            return []

        if iou_threshold is None:
            iou_threshold = self.inference.nms_threshold

        # Group by screenshot
        by_screenshot = {}
        for elem in elements:
            idx = elem.screenshot_index
            if idx not in by_screenshot:
                by_screenshot[idx] = []
            by_screenshot[idx].append(elem)

        # Apply NMS per screenshot
        filtered_elements = []
        for screenshot_elements in by_screenshot.values():
            if len(screenshot_elements) <= 1:
                filtered_elements.extend(screenshot_elements)
                continue

            # Convert to format for NMS
            detections = []
            for elem in screenshot_elements:
                detections.append({
                    'bbox': [
                        elem.bounding_box.x,
                        elem.bounding_box.y,
                        elem.bounding_box.width,
                        elem.bounding_box.height
                    ],
                    'confidence': elem.confidence,
                    'element': elem
                })

            # Apply NMS
            kept_detections = self.inference.apply_nms(detections, iou_threshold)

            # Extract elements
            for det in kept_detections:
                filtered_elements.append(det['element'])

        return filtered_elements

    def _calculate_overall_confidence(self, elements: List[DetectedElement]) -> float:
        """Calculate overall confidence for the analysis"""
        if not elements:
            return 0.0

        # Average confidence of all detections
        confidences = [elem.confidence for elem in elements]
        avg_confidence = sum(confidences) / len(confidences)

        # Adjust based on number of detections (more detections = higher confidence in analysis)
        detection_factor = min(1.0, len(elements) / 10.0)  # Cap at 10 detections

        return avg_confidence * (0.7 + 0.3 * detection_factor)

    def analyze_regions(self,
                       image: np.ndarray,
                       regions: List[List[int]]) -> List[DetectedElement]:
        """
        Analyze specific regions in an image

        This can be used when candidate regions are already identified
        by other analyzers (e.g., from stable region detection).

        Args:
            image: Image as numpy array
            regions: List of bounding boxes [x, y, width, height]

        Returns:
            List of detected elements for valid button regions
        """
        predictions = self.inference.predict_regions(image, regions)

        elements = []
        for pred in predictions:
            if pred['is_button'] and pred['confidence'] >= self.inference.confidence_threshold:
                bbox = BoundingBox(
                    x=pred['bbox'][0],
                    y=pred['bbox'][1],
                    width=pred['bbox'][2],
                    height=pred['bbox'][3]
                )

                element = DetectedElement(
                    bounding_box=bbox,
                    confidence=pred['confidence'],
                    label=pred['button_type'],
                    element_type='button',
                    screenshot_index=0,
                    metadata={
                        'button_type': pred['button_type'],
                        'button_type_id': pred['button_type_id'],
                        'model_type': self.inference.model_type
                    }
                )

                elements.append(element)

        return elements


def create_ml_button_analyzer(config: Dict[str, Any]) -> MLButtonAnalyzer:
    """
    Factory function to create ML button analyzer

    Args:
        config: Configuration dictionary with:
            - model_path: Path to trained model
            - model_type: Model architecture
            - confidence_threshold: Minimum confidence
            - device: Computation device

    Returns:
        MLButtonAnalyzer instance
    """
    return MLButtonAnalyzer(config)


if __name__ == "__main__":
    # Example usage
    print("ML Button Analyzer Test\n")

    try:
        # Create analyzer
        config = {
            'model_path': 'checkpoints/best.pt',
            'model_type': 'mobilenet_v3',
            'confidence_threshold': 0.5,
            'device': 'auto',
            'mode': 'detection'
        }

        analyzer = create_ml_button_analyzer(config)

        print(f"Analyzer created: {analyzer.name} v{analyzer.version}")
        print(f"Analysis type: {analyzer.analysis_type.value}")
        print(f"Required screenshots: {analyzer.required_screenshots}")
        print(f"Supports multi-screenshot: {analyzer.supports_multi_screenshot}")
        print(f"Default parameters: {analyzer.get_default_parameters()}")

    except FileNotFoundError:
        print("Model checkpoint not found. Train a model first.")
    except Exception as e:
        print(f"Error: {e}")
