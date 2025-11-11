"""
MSER (Maximally Stable Extremal Regions) based detection
"""

import cv2
import numpy as np
from typing import List, Dict, Any
from .base_detector import BaseDetector
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from evaluator import BBox


class MSERDetector(BaseDetector):
    """Detect GUI elements using MSER"""

    def __init__(self):
        super().__init__("MSER Detector")

    def detect(self, image_path: str, **params) -> List[BBox]:
        """
        Detect elements using MSER

        Parameters:
            delta: Delta parameter for MSER (default: 5)
            min_area: Minimum area (default: 60)
            max_area: Maximum area ratio (default: 0.25)
            max_variation: Maximum variation (default: 0.25)
        """
        img = cv2.imread(image_path)
        if img is None:
            return []

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Parameters
        delta = params.get('delta', 5)
        min_area = params.get('min_area', 60)
        max_area_ratio = params.get('max_area', 0.25)
        max_variation = params.get('max_variation', 0.25)
        max_evolution = params.get('max_evolution', 200)
        edge_blur_size = params.get('edge_blur_size', 5)

        max_area_pixels = int(img.shape[0] * img.shape[1] * max_area_ratio)

        # Create MSER detector
        mser = cv2.MSER_create(
            _delta=delta,
            _min_area=min_area,
            _max_area=max_area_pixels,
            _max_variation=max_variation,
            _max_evolution=max_evolution,
            _edge_blur_size=edge_blur_size
        )

        # Detect regions
        regions, _ = mser.detectRegions(gray)

        # Convert regions to bounding boxes
        boxes = []
        for region in regions:
            x, y, w, h = cv2.boundingRect(region.reshape(-1, 1, 2))
            boxes.append(BBox(x, y, x + w, y + h))

        # Post-process
        boxes = self.remove_contained_boxes(boxes)
        boxes = self.merge_overlapping_boxes(boxes)

        return boxes

    def get_param_grid(self) -> List[Dict[str, Any]]:
        """Parameter grid for hyperparameter search"""
        return [
            # Conservative - larger stable regions
            {'delta': 10, 'min_area': 100, 'max_variation': 0.15},
            {'delta': 10, 'min_area': 60, 'max_variation': 0.15},

            # Moderate
            {'delta': 5, 'min_area': 60, 'max_variation': 0.25},
            {'delta': 5, 'min_area': 100, 'max_variation': 0.25},
            {'delta': 5, 'min_area': 200, 'max_variation': 0.25},

            # Aggressive - smaller regions
            {'delta': 3, 'min_area': 30, 'max_variation': 0.5},
            {'delta': 3, 'min_area': 60, 'max_variation': 0.5},

            # Very aggressive
            {'delta': 2, 'min_area': 20, 'max_variation': 0.75},
        ]
