"""
Selective Search for object detection
"""

import os
import sys
from typing import Any

import cv2

from .base_detector import BaseDetector

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from evaluator import BBox


class SelectiveSearchDetector(BaseDetector):
    """Detect GUI elements using Selective Search"""

    def __init__(self):
        super().__init__("Selective Search Detector")

    def detect(self, image_path: str, **params) -> list[BBox]:
        """
        Detect elements using Selective Search

        Parameters:
            mode: 'fast', 'quality', or 'single' (default: 'fast')
            min_area: Minimum area (default: 100)
        """
        img = cv2.imread(image_path)
        if img is None:
            return []

        # Parameters
        mode = params.get("mode", "fast")
        min_area = params.get("min_area", 100)
        max_area = params.get("max_area", img.shape[0] * img.shape[1] * 0.9)

        # Create selective search
        ss = cv2.ximgproc.segmentation.createSelectiveSearchSegmentation()
        ss.setBaseImage(img)

        # Set mode
        if mode == "quality":
            ss.switchToSelectiveSearchQuality()
        elif mode == "single":
            ss.switchToSingleStrategy()
        else:  # fast
            ss.switchToSelectiveSearchFast()

        # Run selective search
        rects = ss.process()

        # Convert to BBox
        boxes = []
        for x, y, w, h in rects:
            area = w * h
            if area >= min_area and area <= max_area:
                boxes.append(BBox(x, y, x + w, y + h))

        # Post-process
        boxes = self.remove_contained_boxes(boxes, threshold=0.95)
        boxes = self.merge_overlapping_boxes(boxes, iou_threshold=0.8)

        # Limit number of boxes (selective search can return many)
        if len(boxes) > 500:
            boxes = sorted(boxes, key=lambda b: b.area, reverse=True)[:500]

        return boxes

    def get_param_grid(self) -> list[dict[str, Any]]:
        """Parameter grid for hyperparameter search"""
        return [
            {"mode": "fast", "min_area": 100},
            {"mode": "fast", "min_area": 200},
            {"mode": "fast", "min_area": 50},
            {"mode": "quality", "min_area": 100},
            {"mode": "quality", "min_area": 200},
            {"mode": "single", "min_area": 100},
        ]
