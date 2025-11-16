"""
Region Analysis Orchestrator - Manages the region analysis pipeline
"""

import logging
from typing import List, Dict, Any, Optional, Type
from uuid import UUID
import asyncio

from .base import BaseRegionAnalyzer, RegionAnalysisInput, RegionAnalysisResult, RegionAnalysisType
from .fusion import RegionFusion, FusedRegion

logger = logging.getLogger(__name__)


class RegionAnalyzerRegistry:
    """Registry of available region analyzers"""

    def __init__(self):
        self._analyzers: Dict[str, Type[BaseRegionAnalyzer]] = {}
        self._instances: Dict[str, BaseRegionAnalyzer] = {}

    def register(
        self, analyzer_class: Type[BaseRegionAnalyzer], name: Optional[str] = None
    ):
        """
        Register a region analyzer class

        Args:
            analyzer_class: The analyzer class to register
            name: Optional custom name (defaults to analyzer's name property)
        """
        # Create temporary instance to get name
        temp_instance = analyzer_class()
        analyzer_name = name or temp_instance.name

        self._analyzers[analyzer_name] = analyzer_class
        logger.info(f"Registered region analyzer: {analyzer_name}")

    def get_analyzer(
        self, name: str, config: Optional[Dict[str, Any]] = None
    ) -> BaseRegionAnalyzer:
        """
        Get a region analyzer instance

        Args:
            name: Analyzer name
            config: Optional configuration

        Returns:
            Analyzer instance
        """
        if name not in self._analyzers:
            raise ValueError(f"Region analyzer '{name}' not found in registry")

        # Create new instance with config
        return self._analyzers[name](config)

    def list_analyzers(self) -> List[Dict[str, Any]]:
        """
        List all registered region analyzers

        Returns:
            List of analyzer information
        """
        result = []
        for name, analyzer_class in self._analyzers.items():
            instance = analyzer_class()
            result.append({
                "name": name,
                "type": instance.analysis_type.value,
                "version": instance.version,
                "supports_multi_screenshot": instance.supports_multi_screenshot,
                "required_screenshots": instance.required_screenshots,
                "supported_region_types": [rt.value for rt in instance.supported_region_types],
                "default_parameters": instance.get_default_parameters(),
            })
        return result


# Global registry instance
region_analyzer_registry = RegionAnalyzerRegistry()


class RegionOrchestrator:
    """
    Orchestrates the region analysis pipeline

    Manages execution of multiple region analyzers and fusion of results.
    Similar to AnalysisOrchestrator but specifically for region detection.
    """

    def __init__(
        self,
        fusion_system: Optional[RegionFusion] = None,
        registry: Optional[RegionAnalyzerRegistry] = None,
    ):
        """
        Initialize region orchestrator

        Args:
            fusion_system: Region fusion system (default: new instance)
            registry: Region analyzer registry (default: global registry)
        """
        self.fusion_system = fusion_system or RegionFusion()
        self.registry = registry or region_analyzer_registry

    async def analyze(
        self,
        input_data: RegionAnalysisInput,
        analyzer_names: Optional[List[str]] = None,
        analyzer_configs: Optional[Dict[str, Dict[str, Any]]] = None,
        parallel: bool = True,
        fuse_results: bool = True,
        overlap_threshold: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Run region analysis pipeline

        Args:
            input_data: Input data for analysis
            analyzer_names: List of analyzer names to use (default: all)
            analyzer_configs: Optional configs per analyzer
            parallel: Run analyzers in parallel
            fuse_results: Whether to fuse results
            overlap_threshold: Overlap threshold for fusion

        Returns:
            Dictionary with analysis results and fused regions
        """
        logger.info(
            f"Starting region analysis pipeline for annotation_set "
            f"{input_data.annotation_set_id}"
        )

        # Determine which analyzers to use
        if analyzer_names is None:
            available = self.registry.list_analyzers()
            analyzer_names = [a["name"] for a in available]

        logger.info(f"Using region analyzers: {analyzer_names}")

        # Get analyzer instances
        analyzer_configs = analyzer_configs or {}
        analyzers = [
            self.registry.get_analyzer(name, analyzer_configs.get(name))
            for name in analyzer_names
        ]

        # Validate input for each analyzer
        valid_analyzers = []
        for analyzer in analyzers:
            if analyzer.validate_input(input_data):
                valid_analyzers.append(analyzer)
            else:
                logger.warning(
                    f"Region analyzer {analyzer.name} validation failed, skipping"
                )

        if not valid_analyzers:
            raise ValueError("No valid region analyzers for this input")

        # Run analyzers
        if parallel:
            results = await self._run_parallel(valid_analyzers, input_data)
        else:
            results = await self._run_sequential(valid_analyzers, input_data)

        logger.info(f"Region analysis complete. Got {len(results)} results")

        # Prepare response
        response = {
            "annotation_set_id": str(input_data.annotation_set_id),
            "analyzer_results": [r.to_dict() for r in results],
            "analyzer_statistics": self.fusion_system.get_analyzer_statistics(
                results
            ),
        }

        # Fuse results if requested
        if fuse_results and len(results) > 0:
            fused_regions = await self.fusion_system.fuse(
                results, overlap_threshold
            )
            response["fused_regions"] = [r.to_dict() for r in fused_regions]
            response["fusion_stats"] = {
                "total_regions": len(fused_regions),
                "avg_confidence": (
                    sum(r.confidence for r in fused_regions) / len(fused_regions)
                    if fused_regions else 0.0
                ),
                "multi_vote_regions": len(
                    [r for r in fused_regions if r.votes > 1]
                ),
                "region_type_counts": self._count_region_types(fused_regions),
            }

        return response

    def _count_region_types(self, regions: List[FusedRegion]) -> Dict[str, int]:
        """Count regions by type"""
        counts = {}
        for region in regions:
            region_type = region.region_type.value
            counts[region_type] = counts.get(region_type, 0) + 1
        return counts

    async def _run_parallel(
        self, analyzers: List[BaseRegionAnalyzer], input_data: RegionAnalysisInput
    ) -> List[RegionAnalysisResult]:
        """Run analyzers in parallel"""
        tasks = [analyzer.analyze(input_data) for analyzer in analyzers]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out exceptions
        valid_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(
                    f"Region analyzer {analyzers[i].name} failed: {result}",
                    exc_info=result
                )
            else:
                valid_results.append(result)

        return valid_results

    async def _run_sequential(
        self, analyzers: List[BaseRegionAnalyzer], input_data: RegionAnalysisInput
    ) -> List[RegionAnalysisResult]:
        """Run analyzers sequentially"""
        results = []
        for analyzer in analyzers:
            try:
                result = await analyzer.analyze(input_data)
                results.append(result)
            except Exception as e:
                logger.error(
                    f"Region analyzer {analyzer.name} failed: {e}",
                    exc_info=e
                )

        return results

    def get_available_analyzers(self) -> List[Dict[str, Any]]:
        """Get list of available region analyzers"""
        return self.registry.list_analyzers()
