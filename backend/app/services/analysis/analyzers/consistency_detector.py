"""
Consistency Detector - Cross-Screen Pattern Detection

Detects UI elements by finding repeating visual patterns across multiple screenshots.
Buttons often follow consistent design patterns within an application.

Uses visual similarity (SSIM, feature matching) to cluster similar elements,
then bootstraps detection from these patterns.
"""

import logging
from io import BytesIO
from typing import Any

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


class ConsistencyDetector(BaseAnalyzer):
    """
    Detects UI elements by finding consistent patterns across screenshots

    Algorithm:
    1. Extract candidate regions from all screenshots
    2. Compute visual features for each region
    3. Cluster similar regions using visual similarity
    4. Identify clusters with high consistency (appear multiple times)
    5. Use clusters as "button motifs" to bootstrap detection
    6. Find similar patterns in all screenshots

    Works best with 3+ screenshots showing similar UI states.
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.PATTERN_MATCH

    @property
    def name(self) -> str:
        return "consistency"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 3  # Need multiple screenshots for pattern detection

    def get_default_parameters(self) -> dict[str, Any]:
        return {
            # Candidate extraction
            "min_candidate_area": 500,
            "max_candidate_area": 50000,
            "edge_threshold": 50,
            # Similarity matching
            "ssim_threshold": 0.7,  # SSIM similarity threshold for clustering
            "feature_match_threshold": 0.8,  # Feature matching threshold
            # Pattern consistency
            "min_cluster_size": 3,  # Minimum occurrences to consider a pattern
            "consistency_threshold": 0.75,  # How consistent cluster should be
            # Detection
            "pattern_match_threshold": 0.75,  # Threshold to match against patterns
            "nms_iou_threshold": 0.4,
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform cross-screen consistency analysis"""
        logger.info(
            f"Running consistency detection on {len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        if len(input_data.screenshots) < self.required_screenshots:
            logger.warning(
                f"Consistency detector requires at least {self.required_screenshots} "
                f"screenshots, got {len(input_data.screenshots)}"
            )

        # Load images
        images = self._load_images(input_data.screenshot_data)

        # Extract candidates from all screenshots
        all_candidates = []
        for screenshot_idx, img in enumerate(images):
            candidates = self._extract_candidates(img, screenshot_idx, params)
            all_candidates.extend(candidates)

        logger.info(f"Extracted {len(all_candidates)} total candidates")

        # Cluster similar patterns
        clusters = self._cluster_similar_patterns(all_candidates, params)

        logger.info(f"Found {len(clusters)} pattern clusters")

        # Identify consistent patterns (button motifs)
        button_patterns = self._identify_button_patterns(clusters, params)

        logger.info(f"Identified {len(button_patterns)} button patterns")

        # Use patterns to detect buttons in all screenshots
        all_elements = []
        for screenshot_idx, img in enumerate(images):
            elements = self._detect_using_patterns(
                img, screenshot_idx, button_patterns, params
            )
            all_elements.extend(elements)

        avg_confidence = (
            np.mean([e.confidence for e in all_elements]) if all_elements else 0.0
        )

        logger.info(
            f"Found {len(all_elements)} elements using pattern consistency "
            f"with avg confidence {avg_confidence:.2f}"
        )

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=all_elements,
            confidence=float(avg_confidence),
            metadata={
                "num_screenshots": len(images),
                "method": "consistency",
                "num_patterns": len(button_patterns),
                "num_clusters": len(clusters),
                "parameters": params,
            },
        )

    def _load_images(self, screenshot_data: list[bytes]) -> list[np.ndarray]:
        """Load screenshots as numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("RGB")
            images.append(np.array(img))
        return images

    def _extract_candidates(
        self, img: np.ndarray, screenshot_idx: int, params: dict[str, Any]
    ) -> list[tuple[BoundingBox, np.ndarray, int]]:
        """
        Extract candidate regions from screenshot

        Returns list of (bbox, region_image, screenshot_idx) tuples
        """
        candidates = []

        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        # Find regions using edge detection
        edges = cv2.Canny(gray, params["edge_threshold"], params["edge_threshold"] * 2)

        # Close edges
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)

            area = w * h
            if not (
                params["min_candidate_area"] <= area <= params["max_candidate_area"]
            ):
                continue

            aspect_ratio = w / h if h > 0 else 0
            if not (1.0 <= aspect_ratio <= 10.0):
                continue

            # Extract region
            region = img[y : y + h, x : x + w].copy()

            # Resize to standard size for comparison (64x32)
            region_resized = cv2.resize(region, (64, 32))

            bbox = BoundingBox(x=x, y=y, width=w, height=h)
            candidates.append((bbox, region_resized, screenshot_idx))

        return candidates

    def _cluster_similar_patterns(
        self,
        candidates: list[tuple[BoundingBox, np.ndarray, int]],
        params: dict[str, Any],
    ) -> list[list[tuple[BoundingBox, np.ndarray, int]]]:
        """
        Cluster candidates by visual similarity

        Returns list of clusters, where each cluster is a list of similar candidates
        """
        if not candidates:
            return []

        # Simple greedy clustering by similarity
        clusters = []
        unassigned = candidates.copy()

        while unassigned:
            # Start new cluster with first unassigned
            seed = unassigned.pop(0)
            cluster = [seed]

            # Find similar candidates
            remaining = []
            for candidate in unassigned:
                similarity = self._compute_similarity(seed[1], candidate[1])

                if similarity >= params["ssim_threshold"]:
                    cluster.append(candidate)
                else:
                    remaining.append(candidate)

            unassigned = remaining

            # Only keep clusters with minimum size
            if len(cluster) >= params["min_cluster_size"]:
                clusters.append(cluster)

        return clusters

    def _compute_similarity(self, region1: np.ndarray, region2: np.ndarray) -> float:
        """
        Compute visual similarity between two regions

        Uses combination of SSIM and color histogram similarity
        """
        # Convert to grayscale for SSIM
        gray1 = cv2.cvtColor(region1, cv2.COLOR_RGB2GRAY)
        gray2 = cv2.cvtColor(region2, cv2.COLOR_RGB2GRAY)

        # Compute SSIM (Structural Similarity Index)
        # Simple implementation: normalized cross-correlation
        mean1 = np.mean(gray1)
        mean2 = np.mean(gray2)
        std1 = np.std(gray1)
        std2 = np.std(gray2)

        if std1 == 0 or std2 == 0:
            return 0.0

        # Pearson correlation coefficient
        correlation = np.mean((gray1 - mean1) * (gray2 - mean2)) / (std1 * std2)
        ssim_approx = (correlation + 1) / 2  # Normalize to [0, 1]

        # Color histogram similarity
        hist1 = self._compute_color_histogram(region1)
        hist2 = self._compute_color_histogram(region2)
        hist_similarity = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)

        # Combined similarity
        similarity = 0.6 * ssim_approx + 0.4 * hist_similarity

        return float(max(0, similarity))

    def _compute_color_histogram(self, region: np.ndarray) -> np.ndarray:
        """Compute color histogram for region"""
        hsv = cv2.cvtColor(region, cv2.COLOR_RGB2HSV)

        # Compute histogram
        hist = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)

        return hist

    def _identify_button_patterns(
        self,
        clusters: list[list[tuple[BoundingBox, np.ndarray, int]]],
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Identify which clusters represent button patterns

        Returns list of pattern descriptors
        """
        patterns = []

        for cluster_idx, cluster in enumerate(clusters):
            # Calculate cluster consistency
            consistency = self._calculate_cluster_consistency(cluster)

            if consistency < params["consistency_threshold"]:
                continue

            # Create pattern descriptor from cluster median
            pattern_template = self._create_pattern_template(cluster)

            # Count unique screenshots
            screenshot_indices = {c[2] for c in cluster}

            patterns.append(
                {
                    "template": pattern_template,
                    "cluster_size": len(cluster),
                    "consistency": consistency,
                    "screenshot_count": len(screenshot_indices),
                    "cluster_idx": cluster_idx,
                }
            )

        return patterns

    def _calculate_cluster_consistency(
        self, cluster: list[tuple[BoundingBox, np.ndarray, int]]
    ) -> float:
        """
        Calculate how visually consistent a cluster is

        Returns consistency score (0-1)
        """
        if len(cluster) < 2:
            return 1.0

        # Compare all pairs
        similarities = []
        for i in range(len(cluster)):
            for j in range(i + 1, len(cluster)):
                sim = self._compute_similarity(cluster[i][1], cluster[j][1])
                similarities.append(sim)

        if not similarities:
            return 1.0

        # Consistency is mean pairwise similarity
        return float(np.mean(similarities))

    def _create_pattern_template(
        self, cluster: list[tuple[BoundingBox, np.ndarray, int]]
    ) -> np.ndarray:
        """
        Create template image representing the cluster

        Uses median image to be robust to outliers
        """
        # Stack all regions
        regions = np.stack([c[1] for c in cluster])

        # Compute median image
        median_result = np.median(regions, axis=0)
        template: np.ndarray = median_result.astype(np.uint8)

        return template

    def _detect_using_patterns(
        self,
        img: np.ndarray,
        screenshot_idx: int,
        patterns: list[dict[str, Any]],
        params: dict[str, Any],
    ) -> list[DetectedElement]:
        """
        Detect buttons in screenshot using learned patterns
        """
        elements = []

        # Extract candidates from this screenshot
        candidates = self._extract_candidates(img, screenshot_idx, params)

        # Match each candidate against patterns
        for bbox, region, _ in candidates:
            best_match = None
            best_similarity = 0.0

            for pattern in patterns:
                similarity = self._compute_similarity(region, pattern["template"])

                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match = pattern

            # If good match, consider it a button
            if best_match and best_similarity >= params["pattern_match_threshold"]:
                # Confidence based on similarity and pattern consistency
                confidence = min(
                    0.95,
                    0.5 * best_similarity
                    + 0.3 * best_match["consistency"]
                    + 0.2 * min(1.0, best_match["cluster_size"] / 10),
                )

                elements.append(
                    DetectedElement(
                        bounding_box=bbox,
                        confidence=confidence,
                        label=f"Button (Pattern {best_match['cluster_idx']})",
                        element_type="button",
                        screenshot_index=screenshot_idx,
                        metadata={
                            "method": "consistency",
                            "pattern_idx": best_match["cluster_idx"],
                            "pattern_cluster_size": best_match["cluster_size"],
                            "similarity": float(best_similarity),
                            "pattern_consistency": float(best_match["consistency"]),
                        },
                    )
                )

        # Apply NMS to remove duplicates
        elements = self._apply_nms(elements, params)

        return elements

    def _apply_nms(
        self, elements: list[DetectedElement], params: dict[str, Any]
    ) -> list[DetectedElement]:
        """Apply non-maximum suppression"""
        if not elements:
            return []

        # Sort by confidence
        elements = sorted(elements, key=lambda e: e.confidence, reverse=True)

        keep = []
        while elements:
            best = elements.pop(0)
            keep.append(best)

            # Remove overlapping elements
            elements = [
                e
                for e in elements
                if e.bounding_box.iou(best.bounding_box) < params["nms_iou_threshold"]
            ]

        return keep
