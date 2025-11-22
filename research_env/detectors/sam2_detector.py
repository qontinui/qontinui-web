"""
SAM2 (Segment Anything Model 2) based detection

Note: Requires sam2 package to be installed.
Install with: pip install git+https://github.com/facebookresearch/segment-anything-2.git

For CPU: pip install torch torchvision
For GPU: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
"""

import os
import sys
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

from .base_detector import BaseDetector

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from evaluator import BBox


class SAM2Detector(BaseDetector):
    """Detect GUI elements using SAM2"""

    def __init__(self):
        super().__init__("SAM2 Detector")
        self.sam_available = False
        self.predictor = None
        self._try_load_sam2()

    def _try_load_sam2(self):
        """Try to load SAM2 model"""
        try:
            import torch
            from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
            from sam2.build_sam import build_sam2

            self.sam_available = True

            # Check for model checkpoint
            model_cfg = "sam2_hiera_l.yaml"  # or sam2_hiera_b+.yaml, sam2_hiera_s.yaml, sam2_hiera_t.yaml
            checkpoint_path = None

            # Common checkpoint paths
            possible_paths = [
                "checkpoints/sam2_hiera_large.pt",
                "sam2_hiera_large.pt",
                os.path.expanduser("~/.cache/sam2/sam2_hiera_large.pt"),
            ]

            for path in possible_paths:
                if os.path.exists(path):
                    checkpoint_path = path
                    break

            if checkpoint_path is None:
                print("SAM2 checkpoint not found. Will skip SAM2 detection.")
                print(
                    "Download from: https://github.com/facebookresearch/segment-anything-2"
                )
                self.sam_available = False
                return

            # Build SAM2 model
            device = "cuda" if torch.cuda.is_available() else "cpu"
            sam2 = build_sam2(model_cfg, checkpoint_path, device=device)
            self.mask_generator = SAM2AutomaticMaskGenerator(sam2)

            print(f"SAM2 loaded successfully on {device}")

        except ImportError as e:
            print(f"SAM2 not available: {e}")
            print(
                "Install with: pip install git+https://github.com/facebookresearch/segment-anything-2.git"
            )
            self.sam_available = False
        except Exception as e:
            print(f"Error loading SAM2: {e}")
            self.sam_available = False

    def detect(self, image_path: str, **params) -> List[BBox]:
        """
        Detect elements using SAM2

        Parameters:
            points_per_side: Number of points per side for grid (default: 32)
            pred_iou_thresh: IoU threshold for predictions (default: 0.88)
            stability_score_thresh: Stability score threshold (default: 0.95)
            min_area: Minimum mask area (default: 100)
        """
        if not self.sam_available:
            print("SAM2 not available, skipping...")
            return []

        img = cv2.imread(image_path)
        if img is None:
            return []

        # Convert BGR to RGB
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # Parameters
        points_per_side = params.get("points_per_side", 32)
        pred_iou_thresh = params.get("pred_iou_thresh", 0.88)
        stability_score_thresh = params.get("stability_score_thresh", 0.95)
        min_area = params.get("min_area", 100)
        max_area = params.get("max_area", img.shape[0] * img.shape[1] * 0.9)

        # Update mask generator parameters
        if hasattr(self, "mask_generator"):
            self.mask_generator.points_per_side = points_per_side
            self.mask_generator.pred_iou_thresh = pred_iou_thresh
            self.mask_generator.stability_score_thresh = stability_score_thresh

            # Generate masks
            try:
                masks = self.mask_generator.generate(img_rgb)

                # Convert masks to bounding boxes
                boxes = []
                for mask_data in masks:
                    segmentation = mask_data["segmentation"]

                    # Get bounding box from segmentation
                    y_indices, x_indices = np.where(segmentation)
                    if len(x_indices) == 0 or len(y_indices) == 0:
                        continue

                    x1, x2 = int(x_indices.min()), int(x_indices.max())
                    y1, y2 = int(y_indices.min()), int(y_indices.max())

                    area = (x2 - x1) * (y2 - y1)
                    if area >= min_area and area <= max_area:
                        # Use predicted_iou as confidence
                        confidence = mask_data.get("predicted_iou", 1.0)
                        box = BBox(x1, y1, x2, y2, confidence=confidence)
                        boxes.append(box)

                # Post-process
                boxes = self.remove_contained_boxes(boxes)
                boxes = self.merge_overlapping_boxes(boxes, iou_threshold=0.8)

                return boxes

            except Exception as e:
                print(f"Error during SAM2 detection: {e}")
                return []

        return []

    def get_param_grid(self) -> List[Dict[str, Any]]:
        """Parameter grid for hyperparameter search"""
        if not self.sam_available:
            return []

        return [
            # Conservative - high quality
            {
                "points_per_side": 32,
                "pred_iou_thresh": 0.90,
                "stability_score_thresh": 0.95,
            },
            {
                "points_per_side": 32,
                "pred_iou_thresh": 0.88,
                "stability_score_thresh": 0.95,
            },
            # Moderate
            {
                "points_per_side": 32,
                "pred_iou_thresh": 0.86,
                "stability_score_thresh": 0.90,
            },
            {
                "points_per_side": 48,
                "pred_iou_thresh": 0.88,
                "stability_score_thresh": 0.92,
            },
            {
                "points_per_side": 24,
                "pred_iou_thresh": 0.88,
                "stability_score_thresh": 0.92,
            },
            # Aggressive - more detections
            {
                "points_per_side": 64,
                "pred_iou_thresh": 0.80,
                "stability_score_thresh": 0.85,
            },
            {
                "points_per_side": 48,
                "pred_iou_thresh": 0.82,
                "stability_score_thresh": 0.88,
            },
            # Very aggressive
            {
                "points_per_side": 64,
                "pred_iou_thresh": 0.75,
                "stability_score_thresh": 0.80,
            },
        ]
