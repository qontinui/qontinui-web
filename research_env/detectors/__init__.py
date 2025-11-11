"""
Detection strategy implementations

Each detector should implement:
- Single-screenshot: detect(image_path: str, **params) -> List[BBox]
- Multi-screenshot: detect_multi(dataset: MultiScreenshotDataset, **params) -> Dict[int, List[BBox]]
"""

from .base_detector import BaseDetector, MultiScreenshotDetector
from .edge_detector import EdgeBasedDetector
from .contour_detector import ContourDetector
from .color_detector import ColorClusterDetector
from .template_detector import TemplateDetector
from .selective_search import SelectiveSearchDetector
from .mser_detector import MSERDetector
from .hybrid_detector import HybridDetector
from .sam2_detector import SAM2Detector
from .consistency_detector import ConsistencyDetector
from .mask_generator import MaskGenerator

__all__ = [
    'BaseDetector',
    'MultiScreenshotDetector',
    'EdgeBasedDetector',
    'ContourDetector',
    'ColorClusterDetector',
    'TemplateDetector',
    'SelectiveSearchDetector',
    'MSERDetector',
    'HybridDetector',
    'SAM2Detector',
    'ConsistencyDetector',
    'MaskGenerator',
]
