"""Service for pattern optimization and similarity analysis."""

import uuid
from dataclasses import dataclass
from typing import Any, cast

import numpy as np
import structlog
from numpy.typing import NDArray

from app.utils.image_utils import ImageProcessor

logger = structlog.get_logger(__name__)


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
    array: NDArray[np.uint8] | None = None  # np.ndarray when available


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

    def __init__(self, image_processor: ImageProcessor | None = None):
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
        for i, (screenshot_b64, region) in enumerate(
            zip(screenshots, regions, strict=False)
        ):
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
                    # Ensure arrays are not None
                    array_i = patterns[i].array
                    array_j = patterns[j].array
                    if array_i is None or array_j is None:
                        raise ValueError(
                            "Pattern arrays cannot be None for similarity calculation"
                        )
                    similarity = self.image_processor.calculate_similarity(
                        array_i, array_j
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

        Analyzes pattern similarity and characteristics to determine which
        strategy would be most effective for pattern matching.

        Strategy types:
        - multi-pattern: Uses multiple patterns with voting (best for consistent patterns)
        - consensus: Requires agreement across patterns (best for high-quality patterns)
        - feature-based: Uses feature detection/matching (best for varied patterns)
        - differential: Focuses on differences (best for subtle variations)

        Args:
            patterns: List of extracted patterns
            strategy_types: List of strategy types to evaluate

        Returns:
            List of evaluation results sorted by performance
        """
        if not patterns:
            return []

        # Calculate similarity matrix for analysis
        similarity_matrix = self.calculate_similarity_matrix(patterns)
        n_patterns = len(patterns)

        # Calculate pattern characteristics
        similarities = []
        for i in range(n_patterns):
            for j in range(i + 1, n_patterns):
                similarities.append(similarity_matrix[i][j])

        mean_similarity = float(np.mean(similarities)) if similarities else 1.0
        std_similarity = float(np.std(similarities)) if similarities else 0.0
        min_similarity = float(np.min(similarities)) if similarities else 1.0
        max_similarity = float(np.max(similarities)) if similarities else 1.0

        # Calculate pattern variance (how different patterns are from each other)
        variance = std_similarity**2

        # Evaluate each strategy based on pattern characteristics
        evaluations = []

        for strategy_type in strategy_types:
            evaluation = self._evaluate_strategy(
                strategy_type,
                n_patterns,
                mean_similarity,
                std_similarity,
                min_similarity,
                max_similarity,
                variance,
            )
            evaluations.append(evaluation)

        # Sort by performance score (TPR - FPR)
        def sort_key(e: dict[str, Any]) -> float:
            performance = cast(dict[str, float], e["performance"])
            return performance["truePositiveRate"] - performance["falsePositiveRate"]

        evaluations.sort(key=sort_key, reverse=True)

        return evaluations

    def _evaluate_strategy(
        self,
        strategy_type: str,
        n_patterns: int,
        mean_similarity: float,
        std_similarity: float,
        min_similarity: float,
        max_similarity: float,
        variance: float,
    ) -> dict[str, Any]:
        """
        Evaluate a specific strategy based on pattern characteristics.

        Args:
            strategy_type: Type of strategy to evaluate
            n_patterns: Number of patterns
            mean_similarity: Average similarity between patterns
            std_similarity: Standard deviation of similarities
            min_similarity: Minimum similarity score
            max_similarity: Maximum similarity score
            variance: Variance of similarity scores

        Returns:
            Evaluation result with performance metrics and recommendations
        """
        # Base metrics (will be adjusted per strategy)
        true_positive_rate = 0.0
        false_positive_rate = 0.0
        average_confidence = 0.0
        processing_time = 0.0
        optimal_threshold = 0.8
        confidence_level = "medium"
        suggested_parameters: dict[str, Any] = {}

        if strategy_type == "multi-pattern":
            # Multi-pattern works best with consistent, similar patterns
            # Performance degrades with high variance
            consistency_score = 1.0 - std_similarity
            true_positive_rate = 0.85 + (consistency_score * 0.1)
            false_positive_rate = 0.05 + (std_similarity * 0.05)
            average_confidence = mean_similarity
            processing_time = 50.0 + (n_patterns * 5.0)  # Scales with pattern count
            optimal_threshold = max(0.6, mean_similarity - std_similarity)

            if mean_similarity > 0.8 and std_similarity < 0.1:
                confidence_level = "high"
            elif mean_similarity > 0.6 and std_similarity < 0.2:
                confidence_level = "medium"
            else:
                confidence_level = "low"

            suggested_parameters = {
                "votingThreshold": 0.5,
                "minimumMatches": max(2, n_patterns // 2),
            }

        elif strategy_type == "consensus":
            # Consensus requires high agreement across patterns
            # Works best when patterns are very similar
            agreement_score = min_similarity
            true_positive_rate = 0.8 + (agreement_score * 0.15)
            false_positive_rate = 0.02 + ((1.0 - agreement_score) * 0.08)
            average_confidence = min_similarity
            processing_time = 60.0 + (n_patterns * 8.0)
            optimal_threshold = max(0.75, min_similarity)

            if min_similarity > 0.85 and std_similarity < 0.08:
                confidence_level = "high"
            elif min_similarity > 0.7 and std_similarity < 0.15:
                confidence_level = "medium"
            else:
                confidence_level = "low"

            suggested_parameters = {
                "consensusThreshold": 0.85,
                "requiredAgreement": 0.9,
            }

        elif strategy_type == "feature-based":
            # Feature-based works well with varied patterns
            # More robust to variations in lighting, scale, etc.
            true_positive_rate = 0.82 + (min(variance, 0.1) * 0.08)
            false_positive_rate = 0.08 + (max(0, variance - 0.1) * 0.12)
            average_confidence = 0.75 + (mean_similarity * 0.15)
            processing_time = 100.0 + (n_patterns * 15.0)  # More expensive
            optimal_threshold = 0.65

            if variance > 0.05 and mean_similarity > 0.5:
                confidence_level = "high"
            elif variance > 0.02 and mean_similarity > 0.4:
                confidence_level = "medium"
            else:
                confidence_level = "low"

            suggested_parameters = {
                "featureDetector": "ORB",
                "matchRatio": 0.7,
                "minFeatures": 10,
            }

        elif strategy_type == "differential":
            # Differential looks at what makes patterns different
            # Works best when patterns have clear distinguishing features
            distinctiveness = std_similarity
            true_positive_rate = 0.78 + (min(distinctiveness, 0.2) * 0.12)
            false_positive_rate = 0.06 + (max(0, distinctiveness - 0.2) * 0.14)
            average_confidence = 0.7 + (distinctiveness * 0.2)
            processing_time = 80.0 + (n_patterns * 10.0)
            optimal_threshold = 0.7

            if distinctiveness > 0.1 and distinctiveness < 0.3:
                confidence_level = "high"
            elif distinctiveness > 0.05 and distinctiveness < 0.4:
                confidence_level = "medium"
            else:
                confidence_level = "low"

            suggested_parameters = {
                "differenceMode": "structural",
                "sensitivityLevel": 0.5,
            }

        else:
            # Unknown strategy type - return neutral values
            logger.warning(f"Unknown strategy type: {strategy_type}")
            true_positive_rate = 0.75
            false_positive_rate = 0.1
            average_confidence = 0.7
            processing_time = 75.0
            optimal_threshold = 0.75
            confidence_level = "low"

        # Clamp values to valid ranges
        true_positive_rate = min(max(true_positive_rate, 0.0), 1.0)
        false_positive_rate = min(max(false_positive_rate, 0.0), 1.0)
        average_confidence = min(max(average_confidence, 0.0), 1.0)
        optimal_threshold = min(max(optimal_threshold, 0.0), 1.0)

        return {
            "strategy": {"type": strategy_type, "parameters": suggested_parameters},
            "performance": {
                "truePositiveRate": float(true_positive_rate),
                "falsePositiveRate": float(false_positive_rate),
                "averageConfidence": float(average_confidence),
                "processingTime": float(processing_time),
            },
            "recommendations": {
                "optimalThreshold": float(optimal_threshold),
                "suggestedStrategy": strategy_type,
                "confidenceLevel": confidence_level,
            },
        }

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
