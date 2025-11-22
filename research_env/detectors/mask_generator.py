"""
Mask Generator - Generates pixel-level masks for GUI elements across screenshots
"""

import os
import sys
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from evaluator import BBox, MultiScreenshotAnnotation, MultiScreenshotDataset


class MaskGenerator:
    """
    Generates pixel-level masks for GUI elements by analyzing their stability
    across multiple screenshots.

    This class helps identify which pixels within a bounding box are part of
    the static UI element vs. dynamic content that changes across screenshots.
    """

    def __init__(self):
        pass

    def generate_masks_for_dataset(
        self,
        dataset: MultiScreenshotDataset,
        stability_threshold: float = 0.9,
        edge_weight: float = 0.3,
        output_dir: Optional[str] = None,
    ) -> Dict[str, np.ndarray]:
        """
        Generate pixel-level masks for all annotated elements in the dataset

        Args:
            dataset: MultiScreenshotDataset with annotations
            stability_threshold: Threshold for considering a pixel stable (0-1)
            edge_weight: Weight for edge information in stability calculation
            output_dir: Optional directory to save mask images

        Returns:
            Dict mapping element_id to binary mask (numpy array)
        """
        masks = {}

        # Load all screenshots
        screenshot_images = {}
        for screenshot_info in dataset.screenshots:
            img = cv2.imread(screenshot_info.path)
            if img is not None:
                screenshot_images[screenshot_info.screenshot_id] = img

        # Generate mask for each annotation
        for annotation in dataset.annotations:
            mask = self._generate_mask_for_annotation(
                annotation, screenshot_images, stability_threshold, edge_weight
            )

            if mask is not None:
                masks[annotation.element_id] = mask

                # Save mask to file if output_dir provided
                if output_dir:
                    os.makedirs(output_dir, exist_ok=True)
                    mask_path = os.path.join(
                        output_dir, f"{annotation.element_id}_mask.png"
                    )
                    cv2.imwrite(mask_path, mask)

        return masks

    def _generate_mask_for_annotation(
        self,
        annotation: MultiScreenshotAnnotation,
        screenshot_images: Dict[int, np.ndarray],
        stability_threshold: float = 0.9,
        edge_weight: float = 0.3,
    ) -> Optional[np.ndarray]:
        """
        Generate a pixel-level mask for a specific annotated element

        Args:
            annotation: MultiScreenshotAnnotation for the element
            screenshot_images: Dict mapping screenshot_id to image
            stability_threshold: Threshold for considering a pixel stable
            edge_weight: Weight for edge information

        Returns:
            Binary mask (uint8) where 255 = stable pixel, 0 = unstable
            None if element appears in fewer than 2 screenshots
        """
        # Get all bounding boxes for this element
        bboxes = annotation.get_all_bboxes()

        if len(bboxes) < 2:
            # Need at least 2 screenshots to compute stability
            return None

        # Extract image regions for each bounding box
        regions = []
        reference_bbox = None

        for screenshot_id, bbox in bboxes.items():
            if screenshot_id not in screenshot_images:
                continue

            img = screenshot_images[screenshot_id]

            # Extract region
            region = img[bbox.y1 : bbox.y2, bbox.x1 : bbox.x2]

            if region.size == 0:
                continue

            regions.append(region)

            # Use first bbox as reference for mask dimensions
            if reference_bbox is None:
                reference_bbox = bbox

        if len(regions) < 2:
            return None

        # Ensure all regions have the same size (resize if needed)
        ref_height = reference_bbox.y2 - reference_bbox.y1
        ref_width = reference_bbox.x2 - reference_bbox.x1

        aligned_regions = []
        for region in regions:
            if region.shape[:2] != (ref_height, ref_width):
                region = cv2.resize(
                    region, (ref_width, ref_height), interpolation=cv2.INTER_LINEAR
                )
            aligned_regions.append(region)

        # Compute pixel stability
        stability_map = self._compute_pixel_stability(
            aligned_regions, stability_threshold, edge_weight
        )

        return stability_map

    def _generate_mask_for_box(
        self,
        bbox: BBox,
        screenshots: List[np.ndarray],
        stability_threshold: float = 0.9,
        edge_weight: float = 0.3,
    ) -> np.ndarray:
        """
        Generate a pixel-level mask for a bounding box across multiple screenshots

        Args:
            bbox: Bounding box defining the region
            screenshots: List of screenshot images (same size)
            stability_threshold: Threshold for pixel stability (0-1)
            edge_weight: Weight for edge information

        Returns:
            Binary mask (uint8) where 255 = stable pixel, 0 = unstable
        """
        # Extract regions from all screenshots
        regions = []
        for img in screenshots:
            # Ensure coordinates are valid
            y1 = max(0, bbox.y1)
            y2 = min(img.shape[0], bbox.y2)
            x1 = max(0, bbox.x1)
            x2 = min(img.shape[1], bbox.x2)

            if y2 <= y1 or x2 <= x1:
                continue

            region = img[y1:y2, x1:x2]
            regions.append(region)

        if not regions:
            # No valid regions extracted
            return np.zeros((bbox.y2 - bbox.y1, bbox.x2 - bbox.x1), dtype=np.uint8)

        # Compute pixel stability
        stability_map = self._compute_pixel_stability(
            regions, stability_threshold, edge_weight
        )

        return stability_map

    def _compute_pixel_stability(
        self,
        regions: List[np.ndarray],
        stability_threshold: float = 0.9,
        edge_weight: float = 0.3,
    ) -> np.ndarray:
        """
        Compute pixel-level stability map for a set of image regions

        Args:
            regions: List of image regions (same size)
            stability_threshold: Threshold for considering a pixel stable
            edge_weight: Weight for edge information in stability

        Returns:
            Binary mask (uint8) where 255 = stable pixel, 0 = unstable
        """
        if len(regions) < 2:
            # Single region - all pixels considered stable
            return np.ones(regions[0].shape[:2], dtype=np.uint8) * 255

        # Convert all regions to grayscale
        gray_regions = []
        edge_regions = []

        for region in regions:
            gray = (
                cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
                if len(region.shape) == 3
                else region
            )
            gray_regions.append(gray)

            # Compute edges
            edges = cv2.Canny(gray, 50, 150)
            edge_regions.append(edges)

        # Compute pixel-wise standard deviation across regions
        gray_stack = np.stack(gray_regions, axis=0)
        pixel_std = np.std(gray_stack, axis=0)

        # Normalize std to 0-1 range
        pixel_std_norm = pixel_std / 255.0

        # Compute stability score: 1 - std (high stability = low variance)
        pixel_stability = 1.0 - pixel_std_norm

        # Compute edge stability
        edge_stack = np.stack(edge_regions, axis=0)
        # Count how many regions have an edge at each pixel
        edge_count = np.sum(edge_stack > 0, axis=0) / len(regions)

        # Combine pixel stability and edge stability
        combined_stability = (
            1.0 - edge_weight
        ) * pixel_stability + edge_weight * edge_count

        # Threshold to create binary mask
        stability_mask = (combined_stability >= stability_threshold).astype(
            np.uint8
        ) * 255

        # Clean up the mask with morphological operations
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        stability_mask = cv2.morphologyEx(stability_mask, cv2.MORPH_CLOSE, kernel)
        stability_mask = cv2.morphologyEx(stability_mask, cv2.MORPH_OPEN, kernel)

        return stability_mask

    def compute_mask_quality(self, mask: np.ndarray, bbox: BBox) -> Dict[str, float]:
        """
        Compute quality metrics for a generated mask

        Args:
            mask: Binary mask (uint8)
            bbox: Bounding box that the mask corresponds to

        Returns:
            Dict with quality metrics:
                - coverage: Fraction of bbox covered by mask
                - compactness: How compact the mask is
                - num_components: Number of connected components
        """
        if mask is None or mask.size == 0:
            return {"coverage": 0.0, "compactness": 0.0, "num_components": 0}

        # Coverage: fraction of bbox area covered by mask
        total_pixels = mask.shape[0] * mask.shape[1]
        stable_pixels = np.sum(mask > 0)
        coverage = stable_pixels / total_pixels if total_pixels > 0 else 0.0

        # Connected components
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            mask, connectivity=8
        )
        num_components = num_labels - 1  # Exclude background

        # Compactness: ratio of area to perimeter
        # More compact = higher ratio (circle is most compact)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            total_area = sum(cv2.contourArea(c) for c in contours)
            total_perimeter = sum(cv2.arcLength(c, True) for c in contours)
            compactness = (
                (4 * np.pi * total_area) / (total_perimeter**2)
                if total_perimeter > 0
                else 0.0
            )
        else:
            compactness = 0.0

        return {
            "coverage": coverage,
            "compactness": min(compactness, 1.0),  # Cap at 1.0
            "num_components": num_components,
        }

    def visualize_mask(
        self, image: np.ndarray, mask: np.ndarray, bbox: BBox, output_path: str
    ):
        """
        Create a visualization of the mask overlaid on the image

        Args:
            image: Original image
            mask: Binary mask
            bbox: Bounding box
            output_path: Path to save visualization
        """
        # Extract region
        region = image[bbox.y1 : bbox.y2, bbox.x1 : bbox.x2].copy()

        # Resize mask if needed
        if mask.shape[:2] != region.shape[:2]:
            mask = cv2.resize(
                mask,
                (region.shape[1], region.shape[0]),
                interpolation=cv2.INTER_NEAREST,
            )

        # Create colored overlay (stable pixels in green)
        overlay = region.copy()
        overlay[mask > 0] = overlay[mask > 0] * 0.5 + np.array([0, 255, 0]) * 0.5

        # Create side-by-side visualization
        vis = np.hstack([region, overlay])

        # Save
        cv2.imwrite(output_path, vis)
