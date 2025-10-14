"""Service for pattern optimization and similarity analysis."""

import logging
import uuid
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.utils.image_utils import ImageProcessor

logger = logging.getLogger(__name__)


@dataclass
class Region:
    """Region coordinates for pattern extraction."""

    x: int
    y: int
    width: int
    height: int

    def dict(self) -> dict[str, int]:
        """Convert to dictionary."""
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


@dataclass
class PatternData:
    """Extracted pattern data."""

    id: str
    screenshot_index: int
    region: dict[str, int]
    image_data: str
    array: np.ndarray | None = None


@dataclass
class SimilarityStatistics:
    """Statistics calculated from similarity matrix."""

    mean_similarity: float
    variance: float
    min_similarity: float
    max_similarity: float
    outliers: list[str]


class PatternOptimizationService:
    """Handles pattern extraction, similarity analysis, and optimization."""

    def __init__(self, image_processor: ImageProcessor = None):
        """
        Initialize the service.

        Args:
            image_processor: ImageProcessor instance (defaults to new instance)
        """
        self.image_processor = image_processor or ImageProcessor()

    def extract_patterns(
        self, screenshots: list[str], regions: list[Region]
    ) -> list[PatternData]:
        """
        Extract patterns from screenshots at specified regions.

        Args:
            screenshots: List of base64 encoded screenshot images
            regions: List of regions to extract from each screenshot

        Returns:
            List of extracted pattern data

        Raises:
            ValueError: If screenshots and regions lists have different lengths
        """
        if len(screenshots) != len(regions):
            raise ValueError(
                f"Mismatch: {len(screenshots)} screenshots but {len(regions)} regions"
            )

        patterns = []
        for i, (screenshot_b64, region) in enumerate(zip(screenshots, regions)):
            # Decode image
            image = self.image_processor.decode_base64_to_array(screenshot_b64)

            # Extract region
            pattern_array = self.image_processor.extract_region(
                image, region.x, region.y, region.width, region.height
            )

            # Generate unique ID
            pattern_id = f"pattern_{uuid.uuid4().hex[:8]}"

            # Encode pattern back to base64
            pattern_b64 = self.image_processor.encode_array_to_base64(pattern_array)

            patterns.append(
                PatternData(
                    id=pattern_id,
                    screenshot_index=i,
                    region=region.dict(),
                    image_data=pattern_b64,
                    array=pattern_array,
                )
            )

        return patterns

    def calculate_similarity_matrix(
        self, patterns: list[PatternData]
    ) -> list[list[float]]:
        """
        Calculate similarity scores between all pattern pairs.

        Args:
            patterns: List of pattern data with numpy arrays

        Returns:
            NxN similarity matrix where N is the number of patterns
        """
        n_patterns = len(patterns)
        similarity_matrix = [[0.0] * n_patterns for _ in range(n_patterns)]

        for i in range(n_patterns):
            for j in range(n_patterns):
                if i == j:
                    similarity_matrix[i][j] = 1.0
                elif i < j:
                    # Calculate similarity only once for each pair
                    similarity = self.image_processor.calculate_similarity(
                        patterns[i].array, patterns[j].array
                    )
                    similarity_matrix[i][j] = similarity
                    similarity_matrix[j][i] = similarity

        return similarity_matrix

    def calculate_statistics(
        self, similarity_matrix: list[list[float]], pattern_ids: list[str]
    ) -> SimilarityStatistics:
        """
        Calculate statistics from similarity matrix.

        Args:
            similarity_matrix: NxN similarity matrix
            pattern_ids: List of pattern IDs for outlier identification

        Returns:
            Similarity statistics including mean, variance, and outliers
        """
        n_patterns = len(similarity_matrix)

        # Collect all unique similarities (upper triangle, excluding diagonal)
        all_similarities = []
        for i in range(n_patterns):
            for j in range(i + 1, n_patterns):
                all_similarities.append(similarity_matrix[i][j])

        if not all_similarities:
            return SimilarityStatistics(
                mean_similarity=1.0,
                variance=0.0,
                min_similarity=1.0,
                max_similarity=1.0,
                outliers=[],
            )

        mean_similarity = float(np.mean(all_similarities))
        variance = float(np.var(all_similarities))
        min_similarity = float(np.min(all_similarities))
        max_similarity = float(np.max(all_similarities))

        # Find outliers (patterns with average similarity < mean - 2*std)
        std = np.sqrt(variance)
        threshold = mean_similarity - 2 * std
        outliers = []

        for i in range(n_patterns):
            # Calculate average similarity for this pattern (excluding self)
            avg_sim = np.mean(
                [similarity_matrix[i][j] for j in range(n_patterns) if i != j]
            )
            if avg_sim < threshold:
                outliers.append(pattern_ids[i])

        return SimilarityStatistics(
            mean_similarity=mean_similarity,
            variance=variance,
            min_similarity=min_similarity,
            max_similarity=max_similarity,
            outliers=outliers,
        )

    def evaluate_strategies(
        self, patterns: list[PatternData], strategy_types: list[str]
    ) -> list[dict[str, Any]]:
        """
        Evaluate different pattern matching strategies.

        NOTE: This is currently a placeholder implementation that returns
        simulated results. In production, this should implement actual
        strategy evaluation logic.

        Args:
            patterns: List of extracted patterns
            strategy_types: List of strategy types to evaluate

        Returns:
            List of evaluation results sorted by performance
        """
        evaluations = []

        for strategy_type in strategy_types:
            # TODO: Replace with actual strategy evaluation
            # This is placeholder logic with random values
            evaluation = {
                "strategy": {"type": strategy_type, "parameters": {}},
                "performance": {
                    "truePositiveRate": 0.85 + np.random.random() * 0.1,
                    "falsePositiveRate": 0.05 + np.random.random() * 0.05,
                    "averageConfidence": 0.75 + np.random.random() * 0.15,
                    "processingTime": 50 + np.random.random() * 100,
                },
                "recommendations": {
                    "optimalThreshold": 0.7 + np.random.random() * 0.2,
                    "suggestedStrategy": strategy_type,
                    "confidenceLevel": np.random.choice(["high", "medium", "low"]),
                },
            }
            evaluations.append(evaluation)

        # Sort by performance score (TPR - FPR)
        evaluations.sort(
            key=lambda e: e["performance"]["truePositiveRate"]
            - e["performance"]["falsePositiveRate"],
            reverse=True,
        )

        return evaluations

    def prepare_response_data(
        self, patterns: list[PatternData]
    ) -> list[dict[str, Any]]:
        """
        Prepare pattern data for API response (remove numpy arrays).

        Args:
            patterns: List of pattern data

        Returns:
            List of pattern dictionaries without numpy arrays
        """
        response_patterns = []
        for pattern in patterns:
            response_patterns.append(
                {
                    "id": pattern.id,
                    "screenshot_index": pattern.screenshot_index,
                    "region": pattern.region,
                    "image_data": pattern.image_data,
                }
            )
        return response_patterns
