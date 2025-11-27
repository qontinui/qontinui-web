"""
Pattern Match Analyzer - Feature-Based Method

Uses ORB (Oriented FAST and Rotated BRIEF) features to find recurring patterns.
More robust to scale and rotation than template matching.
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


class PatternFeatureMatchAnalyzer(BaseAnalyzer):
    """
    Finds recurring patterns using feature matching (ORB)

    Algorithm:
    1. Detect ORB features in all images
    2. Match features between images
    3. Cluster matched keypoints to find recurring patterns
    4. Estimate bounding boxes around feature clusters
    """

    @property
    def analysis_type(self) -> AnalysisType:
        return AnalysisType.PATTERN_MATCH

    @property
    def name(self) -> str:
        return "pattern_feature_match"

    @property
    def supports_multi_screenshot(self) -> bool:
        return True

    @property
    def required_screenshots(self) -> int:
        return 2  # Need at least 2 to find recurring patterns

    def get_default_parameters(self) -> dict[str, Any]:
        return {
            "min_occurrences": 2,
            "max_features": 500,  # Maximum ORB features per image
            "match_ratio_threshold": 0.75,  # Lowe's ratio test threshold
            "min_matches_per_pattern": 4,  # Minimum feature matches for a pattern
            "cluster_distance": 50,  # Max distance for clustering keypoints
            "min_cluster_size": 3,  # Minimum keypoints in a cluster
        }

    async def analyze(self, input_data: AnalysisInput) -> AnalysisResult:
        """Perform feature-based pattern analysis"""
        logger.info(
            f"Running feature-based pattern analysis on "
            f"{len(input_data.screenshots)} screenshots"
        )

        params = {**self.get_default_parameters(), **input_data.parameters}

        # Load images as grayscale
        images = self._load_images_grayscale(input_data.screenshot_data)
        images = self._resize_to_common_size(images)

        # Detect features in all images
        features_per_image = self._detect_features_all_images(images, params)

        # Match features between images
        pattern_clusters = self._find_pattern_clusters(
            images, features_per_image, params
        )

        # Convert clusters to detected elements
        elements = self._clusters_to_elements(pattern_clusters, params)

        logger.info(f"Found {len(elements)} recurring pattern instances")

        return AnalysisResult(
            analyzer_type=self.analysis_type,
            analyzer_name=self.name,
            elements=elements,
            confidence=0.75,
            metadata={
                "num_screenshots": len(images),
                "method": "feature_matching",
                "total_features": sum(len(f[0]) for f in features_per_image),
                "parameters": params,
            },
        )

    def _load_images_grayscale(self, screenshot_data: list[bytes]) -> list[np.ndarray]:
        """Load screenshots as grayscale numpy arrays"""
        images = []
        for data in screenshot_data:
            img = Image.open(BytesIO(data)).convert("L")
            images.append(np.array(img, dtype=np.uint8))
        return images

    def _resize_to_common_size(self, images: list[np.ndarray]) -> list[np.ndarray]:
        """Resize all images to the size of the first image"""
        if not images:
            return images

        target_height, target_width = images[0].shape[:2]
        resized = []

        for img in images:
            if img.shape[:2] != (target_height, target_width):
                img = cv2.resize(img, (target_width, target_height))
            resized.append(img)

        return resized

    def _detect_features_all_images(
        self, images: list[np.ndarray], params: dict[str, Any]
    ) -> list[tuple[list, np.ndarray]]:
        """
        Detect ORB features in all images

        Returns:
            List of (keypoints, descriptors) tuples for each image
        """
        orb = cv2.ORB_create(nfeatures=params["max_features"])  # type: ignore[attr-defined]
        features_per_image = []

        for img in images:
            keypoints, descriptors = orb.detectAndCompute(img, None)
            features_per_image.append((keypoints, descriptors))

        return features_per_image

    def _find_pattern_clusters(
        self,
        images: list[np.ndarray],
        features_per_image: list[tuple[list, np.ndarray]],
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Find clusters of matched features that represent recurring patterns

        Returns:
            List of pattern clusters with metadata
        """
        pattern_clusters = []

        # Create BFMatcher
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)

        # Match features between all pairs of images
        for i in range(len(images)):
            for j in range(i + 1, len(images)):
                kp1, desc1 = features_per_image[i]
                kp2, desc2 = features_per_image[j]

                if desc1 is None or desc2 is None:
                    continue  # type: ignore[unreachable]

                # Match descriptors
                matches = bf.knnMatch(desc1, desc2, k=2)

                # Apply ratio test (Lowe's ratio test)
                good_matches = []
                for match_pair in matches:
                    if len(match_pair) == 2:
                        m, n = match_pair
                        if m.distance < params["match_ratio_threshold"] * n.distance:
                            good_matches.append(m)

                if len(good_matches) < params["min_matches_per_pattern"]:
                    continue

                # Cluster matches spatially
                clusters_i = self._cluster_keypoints(
                    [kp1[m.queryIdx] for m in good_matches], params
                )

                clusters_j = self._cluster_keypoints(
                    [kp2[m.trainIdx] for m in good_matches], params
                )

                # Record pattern clusters
                for cluster_i, cluster_j in zip(clusters_i, clusters_j, strict=False):
                    if (
                        len(cluster_i) >= params["min_cluster_size"]
                        and len(cluster_j) >= params["min_cluster_size"]
                    ):

                        pattern_clusters.append(
                            {
                                "screenshot_i": i,
                                "screenshot_j": j,
                                "keypoints_i": cluster_i,
                                "keypoints_j": cluster_j,
                                "num_matches": len(cluster_i),
                            }
                        )

        return pattern_clusters

    def _cluster_keypoints(self, keypoints: list, params: dict[str, Any]) -> list[list]:
        """
        Cluster keypoints spatially

        Returns:
            List of keypoint clusters
        """
        if not keypoints:
            return []

        # Extract positions
        positions = np.array([[kp.pt[0], kp.pt[1]] for kp in keypoints])

        # Simple spatial clustering using distance threshold
        clusters = []
        used = set()

        for i, pos in enumerate(positions):
            if i in used:
                continue

            # Start new cluster
            cluster = [keypoints[i]]
            used.add(i)

            # Add nearby keypoints
            for j, other_pos in enumerate(positions):
                if j in used:
                    continue

                distance = np.linalg.norm(pos - other_pos)
                if distance < params["cluster_distance"]:
                    cluster.append(keypoints[j])
                    used.add(j)

            if len(cluster) >= params["min_cluster_size"]:
                clusters.append(cluster)

        return clusters

    def _clusters_to_elements(
        self, pattern_clusters: list[dict[str, Any]], params: dict[str, Any]
    ) -> list[DetectedElement]:
        """Convert pattern clusters to detected elements"""
        elements = []

        for cluster_idx, cluster in enumerate(pattern_clusters):
            # Create elements for both screenshots in the match
            for screenshot_idx, keypoints_key in [
                (cluster["screenshot_i"], "keypoints_i"),
                (cluster["screenshot_j"], "keypoints_j"),
            ]:
                keypoints = cluster[keypoints_key]

                # Compute bounding box from keypoints
                positions = np.array([[kp.pt[0], kp.pt[1]] for kp in keypoints])
                x_min, y_min = positions.min(axis=0)
                x_max, y_max = positions.max(axis=0)

                # Add some padding
                padding = 10
                x_min = max(0, x_min - padding)
                y_min = max(0, y_min - padding)

                width = int(x_max - x_min + 2 * padding)
                height = int(y_max - y_min + 2 * padding)

                # Confidence based on number of matches
                confidence = min(0.9, 0.5 + (cluster["num_matches"] / 20.0))

                elements.append(
                    DetectedElement(
                        bounding_box=BoundingBox(
                            x=int(x_min), y=int(y_min), width=width, height=height
                        ),
                        confidence=confidence,
                        label="Recurring Pattern",
                        element_type="pattern",
                        screenshot_index=screenshot_idx,
                        metadata={
                            "method": "feature_matching",
                            "pattern_id": cluster_idx,
                            "num_features": len(keypoints),
                        },
                    )
                )

        return elements
