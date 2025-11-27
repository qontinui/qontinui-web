"""
Region Fusion System - Combines results from multiple region analyzers

Handles overlapping regions, nested regions, and weighted voting for confidence.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from .base import (
    BoundingBox,
    DetectedRegion,
    RegionAnalysisResult,
    RegionAnalysisType,
    RegionType,
)

logger = logging.getLogger(__name__)


@dataclass
class FusedRegion:
    """A region with combined confidence from multiple analyzers"""

    bounding_box: BoundingBox
    confidence: float  # Combined confidence
    region_type: RegionType
    sources: list[str]  # Which analyzers detected this
    source_confidences: dict[str, float]  # Individual analyzer confidences
    votes: int  # How many analyzers agreed
    label: str | None = None
    screenshot_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    is_nested: bool = False  # Whether this region is nested within another
    parent_region: Optional["FusedRegion"] = None  # Reference to parent if nested

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "bounding_box": {
                "x": self.bounding_box.x,
                "y": self.bounding_box.y,
                "width": self.bounding_box.width,
                "height": self.bounding_box.height,
            },
            "confidence": self.confidence,
            "region_type": self.region_type.value,
            "sources": self.sources,
            "source_confidences": self.source_confidences,
            "votes": self.votes,
            "label": self.label,
            "screenshot_index": self.screenshot_index,
            "metadata": self.metadata,
            "is_nested": self.is_nested,
        }


class RegionFusionStrategy:
    """Base class for region fusion strategies"""

    def fuse(
        self, results: list[RegionAnalysisResult], overlap_threshold: float = 0.5
    ) -> list[FusedRegion]:
        """
        Combine results from multiple analyzers

        Args:
            results: List of region analysis results
            overlap_threshold: IoU threshold for considering boxes as same region

        Returns:
            List of fused regions
        """
        raise NotImplementedError


class WeightedVotingRegionFusion(RegionFusionStrategy):
    """
    Fusion strategy using weighted voting for regions

    Regions detected by multiple analyzers get higher confidence.
    Handles nested regions (e.g., minimap within a larger UI panel).
    """

    def __init__(self, weights: dict[RegionAnalysisType, float] | None = None):
        """
        Initialize fusion strategy

        Args:
            weights: Optional weights for different analyzer types
                    Default: all analyzers weighted equally
        """
        self.weights = weights or {
            RegionAnalysisType.TEMPLATE_MATCH: 1.2,  # Template matching is reliable
            RegionAnalysisType.EDGE_DETECTION: 1.0,
            RegionAnalysisType.COLOR_CLUSTERING: 1.0,
            RegionAnalysisType.PATTERN_ANALYSIS: 1.1,  # Pattern analysis good for grids
            RegionAnalysisType.ML_CLASSIFICATION: 1.3,  # ML typically most accurate
            RegionAnalysisType.CUSTOM: 1.0,
        }

    def fuse(
        self, results: list[RegionAnalysisResult], overlap_threshold: float = 0.5
    ) -> list[FusedRegion]:
        """Combine results using weighted voting"""

        if not results:
            return []

        # Collect all regions
        all_regions: list[tuple[DetectedRegion, RegionAnalysisResult]] = []
        for result in results:
            for region in result.regions:
                all_regions.append((region, result))

        # Group overlapping regions (but only if same type)
        region_groups: list[list[tuple[DetectedRegion, RegionAnalysisResult]]] = []

        for region, result in all_regions:
            # Find existing group this region belongs to
            found_group = False
            for group in region_groups:
                # Check if region overlaps with any region in the group
                # AND has the same region type
                if any(
                    region.bounding_box.overlaps(r.bounding_box, overlap_threshold)
                    and region.region_type == r.region_type
                    for r, _ in group
                ):
                    group.append((region, result))
                    found_group = True
                    break

            if not found_group:
                # Create new group
                region_groups.append([(region, result)])

        # Fuse each group
        fused_regions = []
        for group in region_groups:
            fused = self._fuse_group(group)
            fused_regions.append(fused)

        # Handle nested regions
        fused_regions = self._identify_nested_regions(fused_regions)

        # Sort by confidence (highest first)
        fused_regions.sort(key=lambda r: r.confidence, reverse=True)

        return fused_regions

    def _fuse_group(
        self, group: list[tuple[DetectedRegion, RegionAnalysisResult]]
    ) -> FusedRegion:
        """Fuse a group of overlapping regions"""

        # Calculate average bounding box (weighted by confidence)
        total_weight = sum(
            region.confidence * self.weights.get(result.analyzer_type, 1.0)
            for region, result in group
        )

        avg_x = (
            sum(
                region.bounding_box.x
                * region.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for region, result in group
            )
            / total_weight
        )

        avg_y = (
            sum(
                region.bounding_box.y
                * region.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for region, result in group
            )
            / total_weight
        )

        avg_width = (
            sum(
                region.bounding_box.width
                * region.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for region, result in group
            )
            / total_weight
        )

        avg_height = (
            sum(
                region.bounding_box.height
                * region.confidence
                * self.weights.get(result.analyzer_type, 1.0)
                for region, result in group
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
            result.analyzer_name: region.confidence for region, result in group
        }

        # Calculate combined confidence
        # Higher confidence if multiple analyzers agree
        votes = len(group)
        base_confidence = sum(
            region.confidence * self.weights.get(result.analyzer_type, 1.0)
            for region, result in group
        ) / len(group)

        # Boost confidence based on number of votes
        vote_boost = min(votes * 0.1, 0.3)  # Max 0.3 boost
        combined_confidence = min(base_confidence + vote_boost, 1.0)

        # Get region type (should be same for all in group)
        region_type = group[0][0].region_type

        # Get most common label
        labels = [region.label for region, _ in group if region.label]
        most_common_label = max(set(labels), key=labels.count) if labels else None

        # Get screenshot index (should be same for all in group)
        screenshot_index = group[0][0].screenshot_index

        # Merge metadata
        merged_metadata = {}
        for region, result in group:
            merged_metadata.update(region.metadata)

        return FusedRegion(
            bounding_box=fused_box,
            confidence=combined_confidence,
            region_type=region_type,
            sources=sources,
            source_confidences=source_confidences,
            votes=votes,
            label=most_common_label,
            screenshot_index=screenshot_index,
            metadata=merged_metadata,
        )

    def _identify_nested_regions(self, regions: list[FusedRegion]) -> list[FusedRegion]:
        """
        Identify and mark nested regions

        A region is nested if it's completely contained within another region.
        Example: A minimap (smaller) within a larger UI panel (bigger).
        """
        # Sort by area (largest first)
        regions_by_area = sorted(
            regions, key=lambda r: r.bounding_box.area(), reverse=True
        )

        for i, small_region in enumerate(regions_by_area):
            for large_region in regions_by_area[:i]:
                # Check if small_region is contained by large_region
                if small_region.bounding_box.is_contained_by(large_region.bounding_box):
                    small_region.is_nested = True
                    small_region.parent_region = large_region
                    small_region.metadata["parent_region_type"] = (
                        large_region.region_type.value
                    )
                    break

        return regions


class RegionFusion:
    """
    Main region fusion system

    Combines results from multiple region analyzers using a configurable strategy.
    Handles nested regions and provides filtering options.
    """

    def __init__(
        self,
        strategy: RegionFusionStrategy | None = None,
        min_confidence: float = 0.3,
        min_votes: int = 1,
        include_nested: bool = True,
    ):
        """
        Initialize region fusion system

        Args:
            strategy: Fusion strategy to use (default: WeightedVotingRegionFusion)
            min_confidence: Minimum confidence threshold for final regions
            min_votes: Minimum number of analyzer votes required
            include_nested: Whether to include nested regions in results
        """
        self.strategy = strategy or WeightedVotingRegionFusion()
        self.min_confidence = min_confidence
        self.min_votes = min_votes
        self.include_nested = include_nested

    async def fuse(
        self, results: list[RegionAnalysisResult], overlap_threshold: float = 0.5
    ) -> list[FusedRegion]:
        """
        Combine results from multiple region analyzers

        Args:
            results: List of region analysis results
            overlap_threshold: IoU threshold for considering regions as same

        Returns:
            List of fused regions meeting confidence and vote thresholds
        """
        logger.info(
            f"Fusing {len(results)} region analysis results with "
            f"overlap_threshold={overlap_threshold}"
        )

        # Use strategy to fuse results
        fused_regions = self.strategy.fuse(results, overlap_threshold)

        logger.info(f"Initial fusion produced {len(fused_regions)} regions")

        # Filter by confidence and votes
        filtered = [
            region
            for region in fused_regions
            if region.confidence >= self.min_confidence
            and region.votes >= self.min_votes
        ]

        # Optionally filter out nested regions
        if not self.include_nested:
            filtered = [r for r in filtered if not r.is_nested]

        logger.info(
            f"After filtering (min_confidence={self.min_confidence}, "
            f"min_votes={self.min_votes}, include_nested={self.include_nested}): "
            f"{len(filtered)} regions"
        )

        return filtered

    def get_analyzer_statistics(
        self, results: list[RegionAnalysisResult]
    ) -> dict[str, Any]:
        """
        Get statistics about region analyzer performance

        Args:
            results: List of region analysis results

        Returns:
            Dictionary with statistics per analyzer
        """
        stats: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"regions": 0, "avg_confidence": 0.0, "region_types": {}}
        )

        for result in results:
            stats[result.analyzer_name]["regions"] = len(result.regions)
            if result.regions:
                stats[result.analyzer_name]["avg_confidence"] = sum(
                    r.confidence for r in result.regions
                ) / len(result.regions)

                # Count region types
                for region in result.regions:
                    region_type = region.region_type.value
                    type_counts: dict[str, int] = stats[result.analyzer_name][
                        "region_types"
                    ]
                    type_counts[region_type] = type_counts.get(region_type, 0) + 1

        return dict(stats)
