"""
Evaluation Framework for GUI Element Detection

Strict metrics: 100% precision and 100% recall required
"""

from typing import List, Dict, Tuple, Optional
import numpy as np
from dataclasses import dataclass
import json


@dataclass
class BBox:
    """Bounding box representation"""
    x1: int
    y1: int
    x2: int
    y2: int
    label: str = ""
    confidence: float = 1.0

    @property
    def area(self) -> int:
        return (self.x2 - self.x1) * (self.y2 - self.y1)

    @property
    def center(self) -> Tuple[int, int]:
        return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)

    def to_dict(self) -> Dict:
        return {
            'bbox': [self.x1, self.y1, self.x2, self.y2],
            'label': self.label,
            'confidence': self.confidence,
            'area': self.area
        }


@dataclass
class EvaluationResult:
    """Results from evaluating a detection method"""
    method_name: str
    precision: float
    recall: float
    f1: float
    true_positives: int
    false_positives: int
    false_negatives: int
    avg_iou: float
    processing_time: float
    matches: List[Tuple[BBox, BBox, float]]  # (ground_truth, prediction, iou)
    unmatched_gt: List[BBox]
    unmatched_pred: List[BBox]

    def is_perfect(self) -> bool:
        """Check if detection is perfect (100% precision and recall)"""
        return self.precision == 1.0 and self.recall == 1.0

    def to_dict(self) -> Dict:
        return {
            'method_name': self.method_name,
            'precision': self.precision,
            'recall': self.recall,
            'f1': self.f1,
            'true_positives': self.true_positives,
            'false_positives': self.false_positives,
            'false_negatives': self.false_negatives,
            'avg_iou': self.avg_iou,
            'processing_time': self.processing_time,
            'is_perfect': self.is_perfect(),
            'num_matches': len(self.matches),
            'num_unmatched_gt': len(self.unmatched_gt),
            'num_unmatched_pred': len(self.unmatched_pred)
        }

    def __str__(self) -> str:
        status = "✓ PERFECT" if self.is_perfect() else "✗ NEEDS IMPROVEMENT"
        return f"""
{status} - {self.method_name}
{'='*60}
Precision: {self.precision:.2%} ({self.true_positives} TP, {self.false_positives} FP)
Recall:    {self.recall:.2%} ({self.true_positives} TP, {self.false_negatives} FN)
F1 Score:  {self.f1:.2%}
Avg IoU:   {self.avg_iou:.3f}
Time:      {self.processing_time:.3f}s

Matches:   {len(self.matches)}
Missing:   {len(self.unmatched_gt)} elements not detected
Extra:     {len(self.unmatched_pred)} false detections
"""


class Evaluator:
    """Evaluates detection results against ground truth"""

    def __init__(self, iou_threshold: float = 0.5, boundary_width: int = 0):
        self.iou_threshold = iou_threshold
        self.boundary_width = boundary_width

    @staticmethod
    def expand_box(box: BBox, margin: int) -> BBox:
        """Expand a box by a margin on all sides"""
        return BBox(
            x1=box.x1 - margin,
            y1=box.y1 - margin,
            x2=box.x2 + margin,
            y2=box.y2 + margin,
            label=box.label,
            confidence=box.confidence
        )

    @staticmethod
    def compute_iou(box1: BBox, box2: BBox) -> float:
        """Compute Intersection over Union between two boxes"""
        # Intersection
        x1 = max(box1.x1, box2.x1)
        y1 = max(box1.y1, box2.y1)
        x2 = min(box1.x2, box2.x2)
        y2 = min(box1.y2, box2.y2)

        if x2 < x1 or y2 < y1:
            return 0.0

        intersection = (x2 - x1) * (y2 - y1)

        # Union
        union = box1.area + box2.area - intersection

        return intersection / union if union > 0 else 0.0

    def match_boxes(self, ground_truth: List[BBox], predictions: List[BBox]) -> Tuple[List[Tuple[BBox, BBox, float]], List[BBox], List[BBox]]:
        """
        Match predicted boxes to ground truth using Hungarian algorithm

        Returns:
            matches: List of (gt_box, pred_box, iou) tuples
            unmatched_gt: Ground truth boxes not matched
            unmatched_pred: Predicted boxes not matched
        """
        if not ground_truth or not predictions:
            return [], ground_truth[:], predictions[:]

        # Expand ground truth boxes by boundary_width if specified
        if self.boundary_width > 0:
            expanded_gt = [self.expand_box(box, self.boundary_width) for box in ground_truth]
        else:
            expanded_gt = ground_truth

        # Compute IoU matrix with expanded boxes
        iou_matrix = np.zeros((len(ground_truth), len(predictions)))
        for i, gt_box in enumerate(expanded_gt):
            for j, pred_box in enumerate(predictions):
                iou_matrix[i, j] = self.compute_iou(gt_box, pred_box)

        # Use greedy matching (could use Hungarian for optimal matching)
        matches = []
        matched_gt = set()
        matched_pred = set()

        # Sort by IoU descending
        iou_flat = [(i, j, iou_matrix[i, j]) for i in range(len(ground_truth)) for j in range(len(predictions))]
        iou_flat.sort(key=lambda x: x[2], reverse=True)

        for i, j, iou in iou_flat:
            if i not in matched_gt and j not in matched_pred and iou >= self.iou_threshold:
                matches.append((ground_truth[i], predictions[j], iou))
                matched_gt.add(i)
                matched_pred.add(j)

        unmatched_gt = [gt for i, gt in enumerate(ground_truth) if i not in matched_gt]
        unmatched_pred = [pred for j, pred in enumerate(predictions) if j not in matched_pred]

        return matches, unmatched_gt, unmatched_pred

    def evaluate(self, method_name: str, ground_truth: List[BBox], predictions: List[BBox], processing_time: float) -> EvaluationResult:
        """
        Evaluate predictions against ground truth

        Args:
            method_name: Name of detection method
            ground_truth: List of ground truth bounding boxes
            predictions: List of predicted bounding boxes
            processing_time: Time taken for detection

        Returns:
            EvaluationResult with metrics
        """
        matches, unmatched_gt, unmatched_pred = self.match_boxes(ground_truth, predictions)

        true_positives = len(matches)
        false_positives = len(unmatched_pred)
        false_negatives = len(unmatched_gt)

        # Calculate metrics
        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
        recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        avg_iou = sum(iou for _, _, iou in matches) / len(matches) if matches else 0.0

        return EvaluationResult(
            method_name=method_name,
            precision=precision,
            recall=recall,
            f1=f1,
            true_positives=true_positives,
            false_positives=false_positives,
            false_negatives=false_negatives,
            avg_iou=avg_iou,
            processing_time=processing_time,
            matches=matches,
            unmatched_gt=unmatched_gt,
            unmatched_pred=unmatched_pred
        )

    @staticmethod
    def load_ground_truth(annotation_file: str) -> Tuple[List[BBox], int]:
        """
        Load ground truth from annotation file

        Returns:
            Tuple of (boxes, boundary_width)
        """
        with open(annotation_file, 'r') as f:
            data = json.load(f)

        boxes = []
        for ann in data['annotations']:
            bbox = ann['bbox']
            boxes.append(BBox(
                x1=bbox[0],
                y1=bbox[1],
                x2=bbox[2],
                y2=bbox[3],
                label=ann.get('label', '')
            ))

        # Get boundary_width from annotation set, default to 0 for backwards compatibility
        boundary_width = data.get('boundary_width', 0)

        return boxes, boundary_width

    @staticmethod
    def visualize_results(image_path: str, ground_truth: List[BBox], predictions: List[BBox],
                         matches: List[Tuple[BBox, BBox, float]], output_path: str):
        """Create visualization of detection results"""
        import cv2

        img = cv2.imread(image_path)
        if img is None:
            return

        # Draw ground truth in green
        for box in ground_truth:
            cv2.rectangle(img, (box.x1, box.y1), (box.x2, box.y2), (0, 255, 0), 2)
            if box.label:
                cv2.putText(img, box.label, (box.x1, box.y1 - 5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        # Draw predictions in blue
        for box in predictions:
            cv2.rectangle(img, (box.x1, box.y1), (box.x2, box.y2), (255, 0, 0), 2)
            if box.confidence:
                cv2.putText(img, f"{box.confidence:.2f}", (box.x2 - 40, box.y1 - 5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)

        # Draw matches in yellow
        for gt_box, pred_box, iou in matches:
            cx, cy = gt_box.center
            px, py = pred_box.center
            cv2.line(img, (cx, cy), (px, py), (0, 255, 255), 1)

        cv2.imwrite(output_path, img)


def compare_methods(results: List[EvaluationResult]) -> str:
    """Generate comparison report for multiple methods"""
    if not results:
        return "No results to compare"

    # Sort by F1 score
    results_sorted = sorted(results, key=lambda r: (r.is_perfect(), r.f1, -r.processing_time), reverse=True)

    report = "\n" + "="*80 + "\n"
    report += "DETECTION METHOD COMPARISON\n"
    report += "="*80 + "\n\n"

    # Summary table
    report += f"{'Method':<30} {'Precision':<12} {'Recall':<12} {'F1':<12} {'Time':<10} {'Perfect'}\n"
    report += "-"*80 + "\n"

    for result in results_sorted:
        perfect_mark = "✓" if result.is_perfect() else "✗"
        report += f"{result.method_name:<30} {result.precision:>10.2%}  {result.recall:>10.2%}  {result.f1:>10.2%}  {result.processing_time:>8.3f}s  {perfect_mark}\n"

    report += "\n" + "="*80 + "\n"

    # Best method
    best = results_sorted[0]
    if best.is_perfect():
        report += f"\n🎉 PERFECT DETECTION ACHIEVED: {best.method_name}\n"
        report += f"   Detected all {best.true_positives} elements with no false positives\n"
        report += f"   Processing time: {best.processing_time:.3f}s\n"
    else:
        report += f"\n⚠ No perfect detection yet. Best method: {best.method_name}\n"
        report += f"   Precision: {best.precision:.2%}, Recall: {best.recall:.2%}\n"
        report += f"   Missing: {best.false_negatives} elements\n"
        report += f"   False positives: {best.false_positives} detections\n"

    return report
