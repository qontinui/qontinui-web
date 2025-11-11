"""
Detection strategy implementations

Each detector should implement:
- detect(image_path: str, **params) -> List[BBox]
"""

from .base_detector import BaseDetector
from .edge_detector import EdgeBasedDetector
from .contour_detector import ContourDetector
from .color_detector import ColorClusterDetector
from .template_detector import TemplateDetector
from .selective_search import SelectiveSearchDetector
from .mser_detector import MSERDetector
from .hybrid_detector import HybridDetector
from .sam2_detector import SAM2Detector

__all__ = [
    'BaseDetector',
    'EdgeBasedDetector',
    'ContourDetector',
    'ColorClusterDetector',
    'TemplateDetector',
    'SelectiveSearchDetector',
    'MSERDetector',
    'HybridDetector',
    'SAM2Detector',
]
