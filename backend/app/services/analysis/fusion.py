"""
Decision Fusion System - Combines results from multiple analyzers
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .base import AnalysisResult, AnalysisType, BoundingBox, DetectedElement

logger = logging.getLogger(__name__)


@dataclass
class FusedElement:
    """An element with combined confidence from multiple analyzers"""

    bounding_box: BoundingBox
    confidence: float  # Combined confidence
    sources: List[str]  # Which analyzers detected this
    source_confidences: Dict[str, float]  # Individual analyzer confidences
    votes: int  # How many analyzers agreed
    label: Optional[str] = None
    element_type: Optional[str] = None
    screenshot_index: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "bounding_box": {
                "x": self.bounding_box.x,
                "y": self.bounding_box.y,
                "width": self.bounding_box.width,
                "height": self.bounding_box.height,
            },
            "confidence": self.confidence,
            "sources": self.sources,
            "source_confidences": self.source_confidences,
            "votes": self.votes,
            "label": self.label,
            "element_type": self.element_type,
            "screenshot_index": self.screenshot_index,
            "metadata": self.metadata,
        }


class FusionStrategy:
    """Base class for fusion strategies"""

    def fuse(
        self, results: List[AnalysisResult], overlap_threshold: float = 0.5
    ) -> List[FusedElement]:
        """
        Combine results from multiple analyzers

        Args:
            results: List of analysis results
            overlap_threshold: IoU threshold for considering boxes as same element

        Returns:
            List of fused elements
        """
        raise NotImplementedError


class WeightedVotingFusion(FusionStrategy):
    """
    Fusion strategy using weighted voting

    Elements detected by multiple analyzers get higher confidence.
    Weights can be assigned to different analyzer types.
    """

    def __init__(self, weights: Optional[Dict[AnalysisType, float]] = None):
        """
        Initialize fusion strategy

        Args:
            weights: Optional weights for different analyzer types
                    Default: all analyzers weighted equally
        """
        self.weights = weights or {
            AnalysisType.STABLE_REGION: 1.0,
            AnalysisType.PATTERN_MATCH: 1.0,
            AnalysisType.SINGLE_SHOT: 1.0,
            AnalysisType.CUSTOM: 1.0,
        }

    def fuse(
        self, results: List[AnalysisResult], overlap_threshold: float = 0.5
    ) -> List[FusedElement]:
        """Combine results using weighted voting"""

        if not results:
            return []

        # Collect all elements
        all_elements: List[tuple[DetectedElement, AnalysisResult]] = []
        for result in results:
            for element in result.elements:
                all_elements.append((element, result))

        # Group overlapping elements
        element_groups: List[List[tuple[DetectedElement, AnalysisResult]]] = []

        for element, result in all_elements:
            # Find existing group this element belongs to
            found_group = False
            for group in element_groups:
                # Check if element overlaps with any element in the group
                if any(
                    element.bounding_box.overlaps(e.bounding_box, overlap_threshold)
                    for e, _ in group
                ):
                    group.append((element, result))
                    found_group = True
                    break

            if not found_group:
                # Create new group
                element_groups.append([(element, result)])

        # Fuse each group
        fused_elements = []
        for group in element_groups:
            fused = self._fuse_group(group)
            fused_elements.append(fused)

        # Sort by confidence (highest first)
        fused_elements.sort(key=lambda e: e.confidence, reverse=True)

        return fused_elements

    def _fuse_group(
        self, group: List[tuple[DetectedElement, AnalysisResult]]
    ) -> FusedElement:
        """Fuse a group of overlapping elements"""

        # Calculate average bounding box (weighted by confidence)
        total_weight = sum(
            elem.confidence * self.weights.get(result.analyzer_type, 1.0)
            for elem, result in group
        )

        avg_x = (
            sum(
                elem.bounding_box.x
                * elem.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for elem, result in group
            )
            / total_weight
        )

        avg_y = (
            sum(
                elem.bounding_box.y
                * elem.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for elem, result in group
            )
            / total_weight
        )

        avg_width = (
            sum(
                elem.bounding_box.width
                * elem.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for elem, result in group
            )
            / total_weight
        )

        avg_height = (
            sum(
                elem.bounding_box.height
                * elem.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for elem, result in group
            )
            / total_weight
        )

        fused_box = BoundingBox(
            x=int(avg_x),
            y=int(avg_y),
            width=int(avg_width),
            height=int(avg_height),
        )

        # Collect sources and confidences
        sources = [result.analyzer_name for _, result in group]
        source_confidences = {
            result.analyzer_name: elem.confidence for elem, result in group
        }

        # Calculate combined confidence
        # Higher confidence if multiple analyzers agree
        votes = len(group)
        base_confidence = sum(
            elem.confidence * self.weights.get(result.analyzer_type, 1.0)
            for elem, result in group
        ) / len(group)

        # Boost confidence based on number of votes
        vote_boost = min(votes * 0.1, 0.3)  # Max 0.3 boost
        combined_confidence = min(base_confidence + vote_boost, 1.0)

        # Get most common label and element_type
        labels = [elem.label for elem, _ in group if elem.label]
        element_types = [elem.element_type for elem, _ in group if elem.element_type]

        most_common_label = max(set(labels), key=labels.count) if labels else None
        most_common_type = (
            max(set(element_types), key=element_types.count) if element_types else None
        )

        # Get screenshot index (should be same for all in group)
        screenshot_index = group[0][0].screenshot_index

        # Merge metadata
        merged_metadata = {}
        for elem, result in group:
            merged_metadata.update(elem.metadata)

        return FusedElement(
            bounding_box=fused_box,
            confidence=combined_confidence,
            sources=sources,
            source_confidences=source_confidences,
            votes=votes,
            label=most_common_label,
            element_type=most_common_type,
            screenshot_index=screenshot_index,
            metadata=merged_metadata,
        )


class DecisionFusion:
    """
    Main decision fusion system

    Combines results from multiple analyzers using a configurable strategy.
    """

    def __init__(
        self,
        strategy: Optional[FusionStrategy] = None,
        min_confidence: float = 0.3,
        min_votes: int = 1,
    ):
        """
        Initialize decision fusion system

        Args:
            strategy: Fusion strategy to use (default: WeightedVotingFusion)
            min_confidence: Minimum confidence threshold for final elements
            min_votes: Minimum number of analyzer votes required
        """
        self.strategy = strategy or WeightedVotingFusion()
        self.min_confidence = min_confidence
        self.min_votes = min_votes

    async def fuse(
        self, results: List[AnalysisResult], overlap_threshold: float = 0.5
    ) -> List[FusedElement]:
        """
        Combine results from multiple analyzers

        Args:
            results: List of analysis results
            overlap_threshold: IoU threshold for considering elements as same

        Returns:
            List of fused elements meeting confidence and vote thresholds
        """
        logger.info(
            f"Fusing {len(results)} analysis results with "
            f"overlap_threshold={overlap_threshold}"
        )

        # Use strategy to fuse results
        fused_elements = self.strategy.fuse(results, overlap_threshold)

        logger.info(f"Initial fusion produced {len(fused_elements)} elements")

        # Filter by confidence and votes
        filtered = [
            elem
            for elem in fused_elements
            if elem.confidence >= self.min_confidence and elem.votes >= self.min_votes
        ]

        logger.info(
            f"After filtering (min_confidence={self.min_confidence}, "
            f"min_votes={self.min_votes}): {len(filtered)} elements"
        )

        return filtered

    def get_analyzer_statistics(self, results: List[AnalysisResult]) -> Dict[str, Any]:
        """
        Get statistics about analyzer performance

        Args:
            results: List of analysis results

        Returns:
            Dictionary with statistics per analyzer
        """
        stats = defaultdict(lambda: {"elements": 0, "avg_confidence": 0.0})

        for result in results:
            stats[result.analyzer_name]["elements"] = len(result.elements)
            if result.elements:
                stats[result.analyzer_name]["avg_confidence"] = sum(
                    e.confidence for e in result.elements
                ) / len(result.elements)

        return dict(stats)
