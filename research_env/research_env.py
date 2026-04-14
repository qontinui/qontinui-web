#!/usr/bin/env python3
"""
Autonomous Research Environment for GUI Element Detection

This script autonomously:
1. Loads ground truth annotations
2. Tests multiple detection strategies
3. Evaluates results with strict metrics (100% precision/recall required)
4. Iterates and refines approaches
5. Keeps notes on findings
6. Runs until perfect detection is achieved or max iterations reached
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path

from detectors import (ColorClusterDetector, ContourDetector,
                       EdgeBasedDetector, HybridDetector, MSERDetector,
                       SAM2Detector, SelectiveSearchDetector, TemplateDetector)
from detectors.consistency_detector import ConsistencyDetector
from evaluator import (BBox, EvaluationResult, Evaluator,
                       MultiScreenshotDataset, MultiScreenshotEvaluator,
                       compare_methods, load_multi_screenshot_dataset)


class ResearchNotes:
    """Manages research notes and findings"""

    def __init__(self, notes_file: str = "research_notes.md"):
        self.notes_file = notes_file
        self.findings = []

        # Create or load existing notes
        if os.path.exists(notes_file):
            with open(notes_file) as f:
                self.existing_notes = f.read()
        else:
            self.existing_notes = ""
            self._initialize_notes()

    def _initialize_notes(self):
        """Initialize notes file"""
        header = f"""# GUI Element Detection Research Notes

**Started:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

## Objective
Achieve 100% precision and 100% recall in detecting GUI elements from screenshots.

## Metrics
- **Precision:** True Positives / (True Positives + False Positives)
- **Recall:** True Positives / (True Positives + False Negatives)
- **F1 Score:** Harmonic mean of precision and recall
- **Success Criteria:** Both precision and recall must be 1.0 (100%)

---

"""
        with open(self.notes_file, "w") as f:
            f.write(header)

    def add_iteration_notes(
        self, iteration: int, results: list[EvaluationResult], insights: str
    ):
        """Add notes for an iteration"""
        with open(self.notes_file, "a") as f:
            f.write(f"\n## Iteration {iteration}\n")
            f.write(f"**Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")

            # Best result
            if results:
                best = max(
                    results, key=lambda r: (r.is_perfect(), r.f1, -r.processing_time)
                )
                f.write(f"### Best Method: {best.method_name}\n")
                f.write(f"- Precision: {best.precision:.2%}\n")
                f.write(f"- Recall: {best.recall:.2%}\n")
                f.write(f"- F1: {best.f1:.2%}\n")
                f.write(f"- Perfect: {'✓ YES' if best.is_perfect() else '✗ NO'}\n")
                f.write(f"- Time: {best.processing_time:.3f}s\n\n")

                if not best.is_perfect():
                    f.write("**Issues:**\n")
                    f.write(f"- Missing elements: {best.false_negatives}\n")
                    f.write(f"- False positives: {best.false_positives}\n\n")

            # Insights
            f.write(f"### Insights\n{insights}\n\n")

            # Comparison table
            f.write("### Method Comparison\n\n")
            f.write("| Method | Precision | Recall | F1 | Time | Perfect |\n")
            f.write("|--------|-----------|--------|----|----|----------|\n")

            for result in sorted(results, key=lambda r: r.f1, reverse=True):
                perfect = "✓" if result.is_perfect() else "✗"
                f.write(
                    f"| {result.method_name} | {result.precision:.2%} | {result.recall:.2%} | {result.f1:.2%} | {result.processing_time:.3f}s | {perfect} |\n"
                )

            f.write("\n---\n")

    def add_finding(self, finding: str):
        """Add a general finding"""
        self.findings.append(finding)
        with open(self.notes_file, "a") as f:
            f.write(f"\n**Finding:** {finding}\n")

    def add_success_notes(self, winning_method: str, result: EvaluationResult):
        """Add notes when perfect detection is achieved"""
        with open(self.notes_file, "a") as f:
            f.write(f"\n{'=' * 80}\n")
            f.write("# 🎉 SUCCESS - Perfect Detection Achieved!\n")
            f.write(f"{'=' * 80}\n\n")
            f.write(f"**Method:** {winning_method}\n")
            f.write(f"**Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"**Processing Time:** {result.processing_time:.3f}s\n")
            f.write(f"**Elements Detected:** {result.true_positives}\n")
            f.write(f"**Precision:** {result.precision:.2%}\n")
            f.write(f"**Recall:** {result.recall:.2%}\n")
            f.write(f"**Avg IoU:** {result.avg_iou:.3f}\n\n")


class ResearchEnvironment:
    """Main research environment for autonomous experimentation"""

    def __init__(
        self,
        screenshots_dir: str = "screenshots",
        annotations_dir: str = "annotations",
        results_dir: str = "results",
        max_iterations: int = 50,
    ):
        self.screenshots_dir = Path(screenshots_dir)
        self.annotations_dir = Path(annotations_dir)
        self.results_dir = Path(results_dir)
        self.max_iterations = max_iterations

        # Create directories
        self.results_dir.mkdir(exist_ok=True)

        # Initialize components (evaluator will be re-initialized with boundary_width after loading ground truth)
        self.evaluator = Evaluator(iou_threshold=0.5)
        self.notes = ResearchNotes(str(self.results_dir / "research_notes.md"))

        # Load ground truth
        self.ground_truth_file = None
        self.ground_truth_boxes: list[BBox] = []
        self.test_screenshots: list[Path] = []
        self.annotated_screenshot: Path | None = None
        self.boundary_width: int = 0

        # Multi-screenshot mode
        self.multi_screenshot_mode: bool = False
        self.multi_screenshot_dataset: MultiScreenshotDataset | None = None
        self.multi_screenshot_evaluator: MultiScreenshotEvaluator | None = None

        # Single-screenshot detectors
        self.detectors = [
            EdgeBasedDetector(),
            ContourDetector(),
            ColorClusterDetector(),
            TemplateDetector(),
            MSERDetector(),
            SelectiveSearchDetector(),
            HybridDetector(),
            SAM2Detector(),
        ]

        # Multi-screenshot detectors
        self.multi_screenshot_detectors = [
            ConsistencyDetector(),
        ]

        # Track best results
        self.best_result: EvaluationResult | None = None
        self.best_params: dict | None = None
        self.best_detector: str | None = None

    def load_ground_truth(self):
        """Load ground truth annotations"""
        # Find annotation file
        annotation_files = list(self.annotations_dir.glob("*_annotations.json"))

        if not annotation_files:
            print("❌ No annotation files found!")
            print("   Please annotate screenshots using the annotation tool.")
            print(f"   Annotations should be in: {self.annotations_dir}")
            return False

        # Use first annotation file
        self.ground_truth_file = annotation_files[0]
        print(f"📝 Loading ground truth from: {self.ground_truth_file.name}")

        with open(self.ground_truth_file) as f:
            data = json.load(f)

        # Detect format version to determine single vs multi-screenshot mode
        format_version = data.get("format_version", "1.0")

        if format_version == "2.0":
            # Multi-screenshot mode
            print("📊 Multi-screenshot mode detected (format v2.0)")
            self.multi_screenshot_mode = True

            # Load multi-screenshot dataset
            self.multi_screenshot_dataset = load_multi_screenshot_dataset(
                str(self.ground_truth_file), str(self.screenshots_dir)
            )

            # Initialize multi-screenshot evaluator
            self.boundary_width = self.multi_screenshot_dataset.boundary_width
            self.multi_screenshot_evaluator = MultiScreenshotEvaluator(
                iou_threshold=0.5, boundary_width=self.boundary_width
            )

            print(
                f"✓ Loaded {len(self.multi_screenshot_dataset.screenshots)} screenshots"
            )
            print(
                f"✓ Loaded {len(self.multi_screenshot_dataset.annotations)} cross-screenshot annotations"
            )
            if self.boundary_width > 0:
                print(f"✓ Boundary tolerance: {self.boundary_width} pixels")

            return True

        else:
            # Single-screenshot mode (v1.0 or missing version)
            print("📊 Single-screenshot mode detected (format v1.0)")
            self.multi_screenshot_mode = False

            # Load boxes
            self.ground_truth_boxes = []
            for ann in data["annotations"]:
                bbox = ann["bbox"]
                self.ground_truth_boxes.append(
                    BBox(
                        x1=bbox[0],
                        y1=bbox[1],
                        x2=bbox[2],
                        y2=bbox[3],
                        label=ann.get("label", ""),
                    )
                )

            # Load boundary_width (default to 0 for backwards compatibility)
            self.boundary_width = data.get("boundary_width", 0)

            # Re-initialize evaluator with boundary_width
            self.evaluator = Evaluator(
                iou_threshold=0.5, boundary_width=self.boundary_width
            )

            # Find annotated screenshot
            screenshot_name = data["screenshot"]
            self.annotated_screenshot = self.screenshots_dir / screenshot_name

            if not self.annotated_screenshot.exists():
                print(f"❌ Annotated screenshot not found: {self.annotated_screenshot}")
                return False

            print(f"✓ Loaded {len(self.ground_truth_boxes)} ground truth elements")
            print(f"✓ Annotated screenshot: {screenshot_name}")
            if self.boundary_width > 0:
                print(f"✓ Boundary tolerance: {self.boundary_width} pixels")

            # Load all other screenshots
            self.test_screenshots = [
                f
                for f in self.screenshots_dir.glob("*.png")
                if f != self.annotated_screenshot
            ]
            self.test_screenshots.extend(
                [
                    f
                    for f in self.screenshots_dir.glob("*.jpg")
                    if f != self.annotated_screenshot
                ]
            )

            print(f"✓ Found {len(self.test_screenshots)} additional test screenshots")

            return True

    def test_detector(
        self, detector, image_path: str, params: dict
    ) -> tuple[list[BBox], float]:
        """Test a detector with given parameters"""
        start_time = time.time()
        try:
            boxes = detector.detect(image_path, **params)
            processing_time = time.time() - start_time
            return boxes, processing_time
        except Exception as e:
            print(f"   ⚠ Error in {detector.name}: {e}")
            processing_time = time.time() - start_time
            return [], processing_time

    def run_iteration(self, iteration: int) -> list[EvaluationResult]:
        """Run one iteration of testing"""
        print(f"\n{'=' * 80}")
        print(f"ITERATION {iteration}")
        print(f"{'=' * 80}\n")

        results = []

        # Test each detector with its parameter grid
        for detector in self.detectors:
            param_grid = detector.get_param_grid()

            if not param_grid:
                print(f"⏭ Skipping {detector.name} (no parameters or not available)")
                continue

            print(f"\n🔬 Testing {detector.name} ({len(param_grid)} configurations)...")

            for i, params in enumerate(param_grid):
                # Test on annotated screenshot
                boxes, proc_time = self.test_detector(
                    detector, str(self.annotated_screenshot), params
                )

                # Evaluate
                method_name = f"{detector.name} [{i + 1}]"
                result = self.evaluator.evaluate(
                    method_name=method_name,
                    ground_truth=self.ground_truth_boxes,
                    predictions=boxes,
                    processing_time=proc_time,
                )

                results.append(result)

                # Print summary
                status = "✓" if result.is_perfect() else "✗"
                print(
                    f"   {status} Config {i + 1}: P={result.precision:.2%} R={result.recall:.2%} "
                    f"F1={result.f1:.2%} ({proc_time:.3f}s)"
                )

                # Track best
                if self.best_result is None or result.f1 > self.best_result.f1:
                    self.best_result = result
                    self.best_params = params
                    self.best_detector = detector.name

                # If perfect, save and report
                if result.is_perfect():
                    print("\n   🎉 PERFECT DETECTION ACHIEVED!")
                    self._save_result(result, detector.name, params)
                    return results

        return results

    def run_multi_screenshot_iteration(self, iteration: int) -> list[EvaluationResult]:
        """Run one iteration of multi-screenshot testing"""
        print(f"\n{'=' * 80}")
        print(f"MULTI-SCREENSHOT ITERATION {iteration}")
        print(f"{'=' * 80}\n")

        results = []

        # Test each multi-screenshot detector with its parameter grid
        for detector in self.multi_screenshot_detectors:
            param_grid = detector.get_param_grid()

            if not param_grid:
                print(f"⏭ Skipping {detector.name} (no parameters or not available)")
                continue

            print(f"\n🔬 Testing {detector.name} ({len(param_grid)} configurations)...")

            for i, params in enumerate(param_grid):
                # Test on multi-screenshot dataset
                start_time = time.time()
                try:
                    predictions = detector.detect_multi(
                        self.multi_screenshot_dataset, **params
                    )
                    proc_time = time.time() - start_time
                except Exception as e:
                    print(f"   ⚠ Error in {detector.name} config {i + 1}: {e}")
                    continue

                # Evaluate per-screenshot results
                method_name = f"{detector.name} [{i + 1}]"
                per_screenshot_results = self.multi_screenshot_evaluator.evaluate_multi(
                    method_name=method_name,
                    dataset=self.multi_screenshot_dataset,
                    predictions=predictions,
                    processing_time=proc_time,
                )

                # Aggregate results across screenshots
                aggregated_result = self.multi_screenshot_evaluator.aggregate_results(
                    per_screenshot_results
                )

                if aggregated_result:
                    results.append(aggregated_result)

                    # Print summary
                    status = "✓" if aggregated_result.is_perfect() else "✗"
                    print(
                        f"   {status} Config {i + 1}: P={aggregated_result.precision:.2%} R={aggregated_result.recall:.2%} "
                        f"F1={aggregated_result.f1:.2%} ({proc_time:.3f}s)"
                    )

                    # Track best
                    if (
                        self.best_result is None
                        or aggregated_result.f1 > self.best_result.f1
                    ):
                        self.best_result = aggregated_result
                        self.best_params = params
                        self.best_detector = detector.name

                    # If perfect, save and report
                    if aggregated_result.is_perfect():
                        print("\n   🎉 PERFECT DETECTION ACHIEVED!")
                        self._save_result(aggregated_result, detector.name, params)
                        return results

        return results

    def _save_result(self, result: EvaluationResult, detector_name: str, params: dict):
        """Save a result to file"""
        result_file = (
            self.results_dir
            / f"result_{detector_name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )

        data = {
            "detector": detector_name,
            "parameters": params,
            "result": result.to_dict(),
            "timestamp": datetime.now().isoformat(),
        }

        with open(result_file, "w") as f:
            json.dump(data, f, indent=2)

    def generate_insights(self, results: list[EvaluationResult]) -> str:
        """Generate insights from iteration results"""
        if not results:
            return "No results to analyze."

        insights = []

        # Check for perfect results
        perfect_results = [r for r in results if r.is_perfect()]
        if perfect_results:
            insights.append(
                f"✓ {len(perfect_results)} method(s) achieved perfect detection!"
            )
            return "\n".join(insights)

        # Analyze precision vs recall
        high_precision = [r for r in results if r.precision >= 0.9]
        high_recall = [r for r in results if r.recall >= 0.9]

        if high_precision:
            insights.append(f"- {len(high_precision)} methods achieved ≥90% precision")
        if high_recall:
            insights.append(f"- {len(high_recall)} methods achieved ≥90% recall")

        # Check for common issues
        avg_fp = sum(r.false_positives for r in results) / len(results)
        avg_fn = sum(r.false_negatives for r in results) / len(results)

        if avg_fp > avg_fn:
            insights.append(
                "- More false positives than false negatives → Try stricter filters"
            )
        elif avg_fn > avg_fp:
            insights.append(
                "- More false negatives than false positives → Try more aggressive detection"
            )

        # Best detector types
        best_3 = sorted(results, key=lambda r: r.f1, reverse=True)[:3]
        insights.append(f"- Top 3 methods: {', '.join(r.method_name for r in best_3)}")

        return "\n".join(insights) if insights else "No clear patterns yet."

    def refine_strategy(self, iteration: int, results: list[EvaluationResult]) -> bool:
        """
        Refine detection strategy based on results
        Returns True if refinement was made, False if no more refinements possible
        """
        # If we have perfect results, we're done
        if any(r.is_perfect() for r in results):
            return False

        # Analyze what's working
        best = max(results, key=lambda r: r.f1)

        print(f"\n🔍 Refining strategy based on iteration {iteration}...")
        print(
            f"   Best so far: {best.method_name} (P={best.precision:.2%}, R={best.recall:.2%})"
        )

        # Strategy: Focus on best-performing detector types in next iteration
        # This would involve creating custom parameter grids based on performance
        # For now, the parameter grids are comprehensive

        return True

    def run(self):
        """Main research loop"""
        print("\n" + "=" * 80)
        print("GUI ELEMENT DETECTION RESEARCH ENVIRONMENT")
        print("=" * 80 + "\n")

        # Load ground truth
        if not self.load_ground_truth():
            print(
                "\n❌ Cannot proceed without ground truth. Please create annotations first."
            )
            print("   Use the web-based annotation tool at /admin/annotations")
            return

        # Print goal based on mode
        if self.multi_screenshot_mode:
            total_annotations = len(self.multi_screenshot_dataset.annotations)
            total_screenshots = len(self.multi_screenshot_dataset.screenshots)
            print(
                f"\n🎯 Goal: Detect all {total_annotations} elements across {total_screenshots} screenshots with 100% precision and recall"
            )
        else:
            print(
                f"\n🎯 Goal: Detect all {len(self.ground_truth_boxes)} elements with 100% precision and recall"
            )

        print(f"📊 Max iterations: {self.max_iterations}\n")

        # Main research loop
        for iteration in range(1, self.max_iterations + 1):
            # Run iteration based on mode
            if self.multi_screenshot_mode:
                results = self.run_multi_screenshot_iteration(iteration)
            else:
                results = self.run_iteration(iteration)

            if not results:
                print("\n⚠ No results from this iteration")
                continue

            # Generate insights
            insights = self.generate_insights(results)

            # Save notes
            self.notes.add_iteration_notes(iteration, results, insights)

            # Print summary
            print(f"\n{compare_methods(results)}")

            # Check for success
            perfect_results = [r for r in results if r.is_perfect()]
            if perfect_results:
                best_perfect = min(perfect_results, key=lambda r: r.processing_time)
                print(
                    f"\n🎉 SUCCESS! Perfect detection achieved in iteration {iteration}"
                )
                print(f"   Method: {best_perfect.method_name}")
                print(f"   Time: {best_perfect.processing_time:.3f}s")

                self.notes.add_success_notes(best_perfect.method_name, best_perfect)

                # Create visualization
                self._create_visualization(best_perfect)

                return

            # Refine strategy
            if not self.refine_strategy(iteration, results):
                print("\n⚠ No more refinements possible")
                break

            # Check if we should continue
            if iteration < self.max_iterations:
                print(f"\n▶ Continuing to iteration {iteration + 1}...")

        # Final summary
        print(f"\n{'=' * 80}")
        print("RESEARCH COMPLETE")
        print(f"{'=' * 80}\n")

        if self.best_result:
            print(f"Best result: {self.best_result.method_name}")
            print(f"  Precision: {self.best_result.precision:.2%}")
            print(f"  Recall: {self.best_result.recall:.2%}")
            print(f"  F1: {self.best_result.f1:.2%}")

            if not self.best_result.is_perfect():
                print("\n⚠ Perfect detection not achieved")
                print(f"  Missing: {self.best_result.false_negatives} elements")
                print(f"  False positives: {self.best_result.false_positives}")
                print("\n💡 Consider:")
                print("  - Adding more detection strategies")
                print("  - Expanding parameter grids")
                print("  - Using ensemble methods")
        else:
            print("❌ No successful detections")

        print(f"\n📝 See detailed notes at: {self.notes.notes_file}")

    def _create_visualization(self, result: EvaluationResult):
        """Create visualization of successful detection"""
        output_path = str(self.results_dir / "perfect_detection.png")
        print(f"\n📸 Creating visualization: {output_path}")

        # This would be implemented using the evaluator's visualization method
        # For now, just a placeholder
        pass


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Autonomous GUI Element Detection Research"
    )
    parser.add_argument(
        "--screenshots", default="screenshots", help="Screenshots directory"
    )
    parser.add_argument(
        "--annotations", default="annotations", help="Annotations directory"
    )
    parser.add_argument("--results", default="results", help="Results output directory")
    parser.add_argument(
        "--max-iterations", type=int, default=50, help="Maximum iterations"
    )
    parser.add_argument(
        "--continue",
        dest="continue_research",
        action="store_true",
        help="Continue from previous run",
    )

    args = parser.parse_args()

    env = ResearchEnvironment(
        screenshots_dir=args.screenshots,
        annotations_dir=args.annotations,
        results_dir=args.results,
        max_iterations=args.max_iterations,
    )

    env.run()


if __name__ == "__main__":
    main()
