#!/usr/bin/env python3
"""
Autonomous Analysis Evaluation Script

This script evaluates all analysis methods independently, generating
comprehensive reports on accuracy, performance, and effectiveness.

Usage:
    poetry run python test_analysis.py --iterations 5
    poetry run python test_analysis.py --annotation-set-id <uuid>
    poetry run python test_analysis.py --generate-test-data
"""

import asyncio
import json
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

# Add backend to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.annotation import AnnotationSet
from app.services.analysis import AnalysisInput, AnalysisOrchestrator
from app.services.analysis.orchestrator import analyzer_registry
from app.services.object_storage import download_file


class AnalysisEvaluator:
    """Autonomous evaluation system for analysis methods"""

    def __init__(self):
        self.orchestrator = AnalysisOrchestrator()
        self.results = []

    async def get_test_annotation_sets(
        self, db: AsyncSession, limit: int = 5
    ) -> list[AnnotationSet]:
        """Get annotation sets for testing"""
        query = select(AnnotationSet).limit(limit)
        result = await db.execute(query)
        return list(result.scalars().all())

    async def evaluate_single_set(
        self, annotation_set: AnnotationSet, db: AsyncSession
    ) -> dict[str, Any]:
        """Evaluate all analyzers on a single annotation set"""

        print(f"\n{'='*80}")
        print(f"Evaluating Annotation Set: {annotation_set.id}")
        print(f"Name: {annotation_set.name}")
        print(
            f"Screenshots: {len(annotation_set.screenshots or [annotation_set.screenshot_url])}"
        )
        print(f"{'='*80}")

        # Get screenshots
        screenshots = annotation_set.screenshots or [
            {
                "name": annotation_set.screenshot_name,
                "url": annotation_set.screenshot_url,
                "width": annotation_set.image_width,
                "height": annotation_set.image_height,
            }
        ]

        # Download screenshot data
        screenshot_data = []
        for screenshot in screenshots:
            try:
                data = await download_file(screenshot["url"])
                screenshot_data.append(data)
            except Exception as e:
                print(f"❌ Failed to download screenshot: {e}")
                return None

        # Get all available analyzers
        available_analyzers = analyzer_registry.list_analyzers()
        analyzer_names = [a["name"] for a in available_analyzers]

        print(f"\n📊 Testing {len(analyzer_names)} analyzers:")
        for name in analyzer_names:
            print(f"  - {name}")

        evaluation_result = {
            "annotation_set_id": str(annotation_set.id),
            "annotation_set_name": annotation_set.name,
            "num_screenshots": len(screenshots),
            "timestamp": datetime.utcnow().isoformat(),
            "analyzers": {},
            "fusion_results": None,
            "performance": {},
            "statistics": {},
        }

        # Test each analyzer individually with default parameters
        for analyzer_name in analyzer_names:
            print(f"\n🔍 Testing: {analyzer_name}")

            try:
                analysis_input = AnalysisInput(
                    annotation_set_id=UUID(str(annotation_set.id)),
                    screenshots=screenshots,
                    screenshot_data=screenshot_data,
                    parameters={},
                )

                start_time = time.time()
                results = await self.orchestrator.analyze(
                    input_data=analysis_input,
                    analyzer_names=[analyzer_name],
                    parallel=False,
                    fuse_results=False,
                )
                elapsed = time.time() - start_time

                analyzer_result = results["analyzer_results"][0]
                elements = analyzer_result["elements"]

                # Calculate statistics
                confidences = [e["confidence"] for e in elements]
                bbox_areas = [
                    e["bounding_box"]["width"] * e["bounding_box"]["height"]
                    for e in elements
                ]

                stats = {
                    "elements_detected": len(elements),
                    "execution_time_ms": int(elapsed * 1000),
                    "avg_confidence": (
                        statistics.mean(confidences) if confidences else 0
                    ),
                    "min_confidence": min(confidences) if confidences else 0,
                    "max_confidence": max(confidences) if confidences else 0,
                    "avg_bbox_area": statistics.mean(bbox_areas) if bbox_areas else 0,
                    "element_types": self._count_element_types(elements),
                }

                evaluation_result["analyzers"][analyzer_name] = {
                    "result": analyzer_result,
                    "statistics": stats,
                }

                print(
                    f"  ✓ Detected {len(elements)} elements in {stats['execution_time_ms']}ms"
                )
                print(f"    Avg confidence: {stats['avg_confidence']:.3f}")

            except Exception as e:
                print(f"  ❌ Failed: {e}")
                evaluation_result["analyzers"][analyzer_name] = {"error": str(e)}

        # Test fusion with all analyzers
        print("\n🔀 Testing fusion with all analyzers...")
        try:
            analysis_input = AnalysisInput(
                annotation_set_id=UUID(str(annotation_set.id)),
                screenshots=screenshots,
                screenshot_data=screenshot_data,
                parameters={},
            )

            start_time = time.time()
            results = await self.orchestrator.analyze(
                input_data=analysis_input,
                analyzer_names=analyzer_names,
                parallel=True,
                fuse_results=True,
                overlap_threshold=0.5,
            )
            elapsed = time.time() - start_time

            fused_elements = results.get("fused_elements", [])

            fusion_stats = {
                "total_fused_elements": len(fused_elements),
                "execution_time_ms": int(elapsed * 1000),
                "multi_vote_elements": sum(1 for e in fused_elements if e["votes"] > 1),
                "avg_votes": (
                    statistics.mean([e["votes"] for e in fused_elements])
                    if fused_elements
                    else 0
                ),
                "analyzer_agreement": self._calculate_agreement(fused_elements),
            }

            evaluation_result["fusion_results"] = {
                "elements": fused_elements,
                "statistics": fusion_stats,
            }

            print(
                f"  ✓ Fused {len(fused_elements)} elements in {fusion_stats['execution_time_ms']}ms"
            )
            print(f"    Multi-vote elements: {fusion_stats['multi_vote_elements']}")

        except Exception as e:
            print(f"  ❌ Fusion failed: {e}")
            evaluation_result["fusion_results"] = {"error": str(e)}

        # Overall statistics
        successful_analyzers = [
            name
            for name, result in evaluation_result["analyzers"].items()
            if "error" not in result
        ]

        evaluation_result["statistics"] = {
            "total_analyzers_tested": len(analyzer_names),
            "successful_analyzers": len(successful_analyzers),
            "failed_analyzers": len(analyzer_names) - len(successful_analyzers),
            "total_elements_detected": sum(
                result["statistics"]["elements_detected"]
                for result in evaluation_result["analyzers"].values()
                if "statistics" in result
            ),
            "avg_execution_time_ms": (
                statistics.mean(
                    [
                        result["statistics"]["execution_time_ms"]
                        for result in evaluation_result["analyzers"].values()
                        if "statistics" in result
                    ]
                )
                if successful_analyzers
                else 0
            ),
        }

        return evaluation_result

    def _count_element_types(self, elements: list[dict]) -> dict[str, int]:
        """Count occurrences of each element type"""
        counts = {}
        for elem in elements:
            elem_type = elem.get("element_type", "unknown")
            counts[elem_type] = counts.get(elem_type, 0) + 1
        return counts

    def _calculate_agreement(self, fused_elements: list[dict]) -> dict[str, Any]:
        """Calculate analyzer agreement statistics"""
        if not fused_elements:
            return {}

        vote_distribution = {}
        for elem in fused_elements:
            votes = elem["votes"]
            vote_distribution[votes] = vote_distribution.get(votes, 0) + 1

        return {
            "vote_distribution": vote_distribution,
            "unanimous_elements": vote_distribution.get(
                max(vote_distribution.keys()) if vote_distribution else 0, 0
            ),
        }

    async def run_evaluation(
        self, annotation_set_ids: list[str] | None = None, max_sets: int = 5
    ) -> dict[str, Any]:
        """Run full evaluation across multiple annotation sets"""

        print("\n" + "=" * 80)
        print("AUTONOMOUS ANALYSIS EVALUATION")
        print("=" * 80)

        async with AsyncSessionLocal() as db:
            # Get annotation sets
            if annotation_set_ids:
                annotation_sets = []
                for set_id in annotation_set_ids:
                    result = await db.execute(
                        select(AnnotationSet).where(AnnotationSet.id == set_id)
                    )
                    ann_set = result.scalar_one_or_none()
                    if ann_set:
                        annotation_sets.append(ann_set)
            else:
                annotation_sets = await self.get_test_annotation_sets(
                    db, limit=max_sets
                )

            if not annotation_sets:
                print("❌ No annotation sets found for testing")
                return {"error": "No test data available"}

            print(f"\n📋 Found {len(annotation_sets)} annotation sets for evaluation")

            # Evaluate each set
            all_results = []
            for ann_set in annotation_sets:
                result = await self.evaluate_single_set(ann_set, db)
                if result:
                    all_results.append(result)

            # Generate summary report
            summary = self._generate_summary(all_results)

            return {
                "summary": summary,
                "detailed_results": all_results,
                "evaluation_timestamp": datetime.utcnow().isoformat(),
                "total_annotation_sets_tested": len(all_results),
            }

    def _generate_summary(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        """Generate summary statistics across all evaluations"""

        if not results:
            return {}

        # Aggregate statistics across all annotation sets
        all_analyzer_names = set()
        for result in results:
            all_analyzer_names.update(result["analyzers"].keys())

        analyzer_summary = {}
        for analyzer_name in all_analyzer_names:
            detections = []
            execution_times = []
            confidences = []

            for result in results:
                if analyzer_name in result["analyzers"]:
                    analyzer_data = result["analyzers"][analyzer_name]
                    if "statistics" in analyzer_data:
                        stats = analyzer_data["statistics"]
                        detections.append(stats["elements_detected"])
                        execution_times.append(stats["execution_time_ms"])
                        confidences.append(stats["avg_confidence"])

            if detections:
                analyzer_summary[analyzer_name] = {
                    "avg_elements_detected": statistics.mean(detections),
                    "total_elements_detected": sum(detections),
                    "avg_execution_time_ms": statistics.mean(execution_times),
                    "avg_confidence": statistics.mean(confidences),
                    "success_rate": len(detections) / len(results),
                }

        return {
            "total_sets_evaluated": len(results),
            "analyzer_performance": analyzer_summary,
            "best_detector": (
                max(
                    analyzer_summary.items(),
                    key=lambda x: x[1]["avg_elements_detected"],
                )[0]
                if analyzer_summary
                else None
            ),
            "fastest_analyzer": (
                min(
                    analyzer_summary.items(),
                    key=lambda x: x[1]["avg_execution_time_ms"],
                )[0]
                if analyzer_summary
                else None
            ),
        }

    def save_report(self, results: dict[str, Any], output_file: str):
        """Save evaluation report to file"""
        output_path = Path(output_file)

        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)

        print(f"\n✅ Report saved to: {output_path}")

        # Also save a human-readable summary
        summary_path = output_path.with_suffix(".txt")
        with open(summary_path, "w") as f:
            f.write("=" * 80 + "\n")
            f.write("ANALYSIS EVALUATION SUMMARY\n")
            f.write("=" * 80 + "\n\n")

            summary = results.get("summary", {})
            f.write(
                f"Total Annotation Sets Tested: {summary.get('total_sets_evaluated', 0)}\n"
            )
            f.write(f"Best Detector: {summary.get('best_detector', 'N/A')}\n")
            f.write(f"Fastest Analyzer: {summary.get('fastest_analyzer', 'N/A')}\n\n")

            f.write("Analyzer Performance:\n")
            f.write("-" * 80 + "\n")

            for analyzer_name, stats in summary.get("analyzer_performance", {}).items():
                f.write(f"\n{analyzer_name}:\n")
                f.write(
                    f"  Avg Elements Detected: {stats['avg_elements_detected']:.2f}\n"
                )
                f.write(f"  Total Elements: {stats['total_elements_detected']}\n")
                f.write(
                    f"  Avg Execution Time: {stats['avg_execution_time_ms']:.0f}ms\n"
                )
                f.write(f"  Avg Confidence: {stats['avg_confidence']:.3f}\n")
                f.write(f"  Success Rate: {stats['success_rate']*100:.1f}%\n")

        print(f"✅ Summary saved to: {summary_path}")


async def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Autonomous Analysis Evaluation")
    parser.add_argument(
        "--annotation-set-id",
        type=str,
        action="append",
        help="Specific annotation set ID to test (can be specified multiple times)",
    )
    parser.add_argument(
        "--max-sets",
        type=int,
        default=5,
        help="Maximum number of annotation sets to test (default: 5)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=f"evaluation_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        help="Output file for evaluation report",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=1,
        help="Number of evaluation iterations to run",
    )

    args = parser.parse_args()

    evaluator = AnalysisEvaluator()

    for iteration in range(args.iterations):
        if args.iterations > 1:
            print(f"\n{'#'*80}")
            print(f"# ITERATION {iteration + 1} of {args.iterations}")
            print(f"{'#'*80}")

        results = await evaluator.run_evaluation(
            annotation_set_ids=args.annotation_set_id, max_sets=args.max_sets
        )

        # Save report
        if args.iterations > 1:
            output_file = args.output.replace(".json", f"_iter{iteration+1}.json")
        else:
            output_file = args.output

        evaluator.save_report(results, output_file)

    print("\n" + "=" * 80)
    print("EVALUATION COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
