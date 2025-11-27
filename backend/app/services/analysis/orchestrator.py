"""
Analysis Orchestrator - Manages the analysis pipeline
"""

import asyncio
import logging
from typing import Any
from uuid import UUID

from .base import AnalysisInput, AnalysisResult, BaseAnalyzer
from .fusion import DecisionFusion
from .progress import ProgressTracker

logger = logging.getLogger(__name__)


class AnalyzerRegistry:
    """Registry of available analyzers"""

    def __init__(self):
        self._analyzers: dict[str, type[BaseAnalyzer]] = {}
        self._instances: dict[str, BaseAnalyzer] = {}

    def register(self, analyzer_class: type[BaseAnalyzer], name: str | None = None):
        """
        Register an analyzer class

        Args:
            analyzer_class: The analyzer class to register
            name: Optional custom name (defaults to analyzer's name property)
        """
        # Create temporary instance to get name
        temp_instance = analyzer_class()
        analyzer_name = name or temp_instance.name

        self._analyzers[analyzer_name] = analyzer_class
        logger.info(f"Registered analyzer: {analyzer_name}")

    def get_analyzer(
        self, name: str, config: dict[str, Any] | None = None
    ) -> BaseAnalyzer:
        """
        Get an analyzer instance

        Args:
            name: Analyzer name
            config: Optional configuration

        Returns:
            Analyzer instance
        """
        if name not in self._analyzers:
            raise ValueError(f"Analyzer '{name}' not found in registry")

        # Create new instance with config
        return self._analyzers[name](config)

    def list_analyzers(self) -> list[dict[str, Any]]:
        """
        List all registered analyzers

        Returns:
            List of analyzer information
        """
        result = []
        for name, analyzer_class in self._analyzers.items():
            instance = analyzer_class()
            result.append(
                {
                    "name": name,
                    "type": instance.analysis_type.value,
                    "version": instance.version,
                    "supports_multi_screenshot": instance.supports_multi_screenshot,
                    "required_screenshots": instance.required_screenshots,
                    "default_parameters": instance.get_default_parameters(),
                }
            )
        return result


# Global registry instance
analyzer_registry = AnalyzerRegistry()


class AnalysisOrchestrator:
    """
    Orchestrates the analysis pipeline

    Manages execution of multiple analyzers and fusion of results.
    """

    def __init__(
        self,
        fusion_system: DecisionFusion | None = None,
        registry: AnalyzerRegistry | None = None,
        progress_tracker: ProgressTracker | None = None,
    ):
        """
        Initialize orchestrator

        Args:
            fusion_system: Decision fusion system (default: new instance)
            registry: Analyzer registry (default: global registry)
            progress_tracker: Progress tracker (default: new instance)
        """
        self.fusion_system = fusion_system or DecisionFusion()
        self.registry = registry or analyzer_registry
        self.progress_tracker = progress_tracker or ProgressTracker()

    async def analyze(
        self,
        input_data: AnalysisInput,
        analyzer_names: list[str] | None = None,
        analyzer_configs: dict[str, dict[str, Any]] | None = None,
        parallel: bool = True,
        fuse_results: bool = True,
        overlap_threshold: float = 0.5,
        job_id: UUID | None = None,
    ) -> dict[str, Any]:
        """
        Run analysis pipeline

        Args:
            input_data: Input data for analysis
            analyzer_names: List of analyzer names to use (default: all)
            analyzer_configs: Optional configs per analyzer
            parallel: Run analyzers in parallel
            fuse_results: Whether to fuse results
            overlap_threshold: Overlap threshold for fusion
            job_id: Optional job ID for progress tracking

        Returns:
            Dictionary with analysis results and fused elements
        """
        logger.info(
            f"Starting analysis pipeline for annotation_set "
            f"{input_data.annotation_set_id}"
        )

        # Determine which analyzers to use
        if analyzer_names is None:
            available = self.registry.list_analyzers()
            analyzer_names = [a["name"] for a in available]

        logger.info(f"Using analyzers: {analyzer_names}")

        # Initialize progress tracking if job_id provided
        if job_id:
            await self.progress_tracker.initialize(
                job_id=job_id,
                total_analyzers=len(analyzer_names),
                analyzer_names=analyzer_names,
            )

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
                logger.warning(f"Analyzer {analyzer.name} validation failed, skipping")

        if not valid_analyzers:
            if job_id:
                await self.progress_tracker.update_error(
                    job_id, "No valid analyzers for this input"
                )
            raise ValueError("No valid analyzers for this input")

        # Run analyzers
        try:
            if parallel:
                results = await self._run_parallel(valid_analyzers, input_data, job_id)
            else:
                results = await self._run_sequential(
                    valid_analyzers, input_data, job_id
                )

            logger.info(f"Analysis complete. Got {len(results)} results")
        except Exception as e:
            if job_id:
                await self.progress_tracker.update_error(job_id, str(e))
            raise

        # Prepare response
        response = {
            "annotation_set_id": str(input_data.annotation_set_id),
            "analyzer_results": [r.to_dict() for r in results],
            "analyzer_statistics": self.fusion_system.get_analyzer_statistics(results),
        }

        # Fuse results if requested
        if fuse_results and len(results) > 0:
            total_elements = sum(len(r.elements) for r in results)
            if job_id:
                await self.progress_tracker.update_fusion_start(job_id, total_elements)

            fused_elements = await self.fusion_system.fuse(results, overlap_threshold)
            response["fused_elements"] = [e.to_dict() for e in fused_elements]
            response["fusion_stats"] = {
                "total_elements": len(fused_elements),
                "avg_confidence": (
                    sum(e.confidence for e in fused_elements) / len(fused_elements)
                    if fused_elements
                    else 0.0
                ),
                "multi_vote_elements": len([e for e in fused_elements if e.votes > 1]),
            }

            if job_id:
                await self.progress_tracker.update_fusion_complete(
                    job_id, len(fused_elements)
                )

        return response

    async def _run_parallel(
        self,
        analyzers: list[BaseAnalyzer],
        input_data: AnalysisInput,
        job_id: UUID | None = None,
    ) -> list[AnalysisResult]:
        """Run analyzers in parallel"""

        async def run_with_progress(analyzer: BaseAnalyzer):
            if job_id:
                await self.progress_tracker.update_analyzer_start(job_id, analyzer.name)

            try:
                result = await analyzer.analyze(input_data)
                if job_id:
                    await self.progress_tracker.update_analyzer_complete(
                        job_id, analyzer.name, len(result.elements)
                    )
                return result
            except Exception as e:
                if job_id:
                    await self.progress_tracker.update_analyzer_error(
                        job_id, analyzer.name, str(e)
                    )
                raise

        tasks = [run_with_progress(analyzer) for analyzer in analyzers]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out exceptions
        valid_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(
                    f"Analyzer {analyzers[i].name} failed: {result}", exc_info=result
                )
            else:
                valid_results.append(result)

        return valid_results  # type: ignore[return-value]

    async def _run_sequential(
        self,
        analyzers: list[BaseAnalyzer],
        input_data: AnalysisInput,
        job_id: UUID | None = None,
    ) -> list[AnalysisResult]:
        """Run analyzers sequentially"""
        results: list[AnalysisResult] = []
        for analyzer in analyzers:
            if job_id:
                await self.progress_tracker.update_analyzer_start(job_id, analyzer.name)

            try:
                result = await analyzer.analyze(input_data)
                results.append(result)

                if job_id:
                    await self.progress_tracker.update_analyzer_complete(
                        job_id, analyzer.name, len(result.elements)
                    )
            except Exception as e:
                logger.error(f"Analyzer {analyzer.name} failed: {e}", exc_info=e)
                if job_id:
                    await self.progress_tracker.update_analyzer_error(
                        job_id, analyzer.name, str(e)
                    )

        return results

    def get_available_analyzers(self) -> list[dict[str, Any]]:
        """Get list of available analyzers"""
        return self.registry.list_analyzers()
