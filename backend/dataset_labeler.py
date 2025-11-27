"""
Semi-Automated Dataset Labeling Tool

Uses existing analyzers on real screenshots to create training datasets.
Allows for validation and correction of automated predictions.
"""

import json
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


class DatasetLabeler:
    """Semi-automated labeling tool for button detection datasets."""

    def __init__(self, output_dir: str = "datasets/labeled"):
        """
        Initialize the dataset labeler.

        Args:
            output_dir: Output directory for labeled dataset
        """
        self.output_dir = Path(output_dir)
        self.images_dir = self.output_dir / "images"
        self.annotations_dir = self.output_dir / "annotations"

        # Create directories
        for split in ["train", "val", "test"]:
            (self.images_dir / split).mkdir(parents=True, exist_ok=True)
        self.annotations_dir.mkdir(parents=True, exist_ok=True)

        # Dataset structure
        self.datasets = {
            "train": self._init_coco_dataset(),
            "val": self._init_coco_dataset(),
            "test": self._init_coco_dataset(),
        }

        self.image_id = 1
        self.annotation_id = 1

    def _init_coco_dataset(self) -> dict:
        """Initialize COCO format dataset."""
        return {
            "info": {
                "description": "Labeled Button Detection Dataset",
                "version": "1.0",
                "year": 2025,
                "contributor": "QontinUI",
                "date_created": datetime.now().isoformat(),
            },
            "licenses": [],
            "images": [],
            "annotations": [],
            "categories": [{"id": 1, "name": "button", "supercategory": "ui_element"}],
        }

    def detect_buttons_opencv(self, image_path: str) -> list[dict]:
        """
        Detect buttons using OpenCV-based analysis.

        Args:
            image_path: Path to input image

        Returns:
            List of detected button candidates
        """
        # Load image
        img = cv2.imread(image_path)
        if img is None:
            return []

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape

        # Edge detection
        edges = cv2.Canny(gray, 50, 150)

        # Find contours
        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        candidates = []

        for contour in contours:
            # Get bounding box
            x, y, w, h = cv2.boundingRect(contour)

            # Filter by size and aspect ratio (buttons are typically rectangular)
            if w < 30 or h < 15 or w > width * 0.5 or h > height * 0.3:
                continue

            aspect_ratio = w / h
            if aspect_ratio < 0.5 or aspect_ratio > 8:
                continue

            # Calculate confidence based on edge strength
            roi = edges[y : y + h, x : x + w]
            edge_density = np.sum(roi > 0) / (w * h)

            # Check if it has button-like characteristics
            if edge_density > 0.1 and edge_density < 0.8:
                candidates.append(
                    {
                        "bbox": [x, y, w, h],
                        "confidence": float(edge_density),
                        "area": w * h,
                        "aspect_ratio": aspect_ratio,
                    }
                )

        # Sort by confidence
        candidates.sort(key=lambda x: x["confidence"], reverse=True)

        return candidates[:20]  # Return top 20 candidates

    def detect_buttons_color(self, image_path: str) -> list[dict]:
        """
        Detect buttons using color-based analysis.

        Args:
            image_path: Path to input image

        Returns:
            List of detected button candidates
        """
        img = cv2.imread(image_path)
        if img is None:
            return []

        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        height, width = hsv.shape[:2]

        candidates = []

        # Common button colors (HSV ranges)
        color_ranges = [
            # Blue
            ((100, 50, 50), (130, 255, 255)),
            # Green
            ((40, 50, 50), (80, 255, 255)),
            # Red
            ((0, 50, 50), (10, 255, 255)),
            ((170, 50, 50), (180, 255, 255)),
            # Gray/White
            ((0, 0, 150), (180, 50, 255)),
        ]

        for lower, upper in color_ranges:
            mask = cv2.inRange(hsv, np.array(lower), np.array(upper))

            # Morphological operations
            kernel = np.ones((5, 5), np.uint8)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

            # Find contours
            contours, _ = cv2.findContours(
                mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)

                # Filter by size
                if w < 40 or h < 20 or w > width * 0.4 or h > height * 0.25:
                    continue

                aspect_ratio = w / h
                if aspect_ratio < 0.5 or aspect_ratio > 6:
                    continue

                candidates.append(
                    {
                        "bbox": [x, y, w, h],
                        "confidence": 0.6,
                        "area": w * h,
                        "aspect_ratio": aspect_ratio,
                        "method": "color",
                    }
                )

        return candidates

    def merge_detections(
        self, detections: list[dict], iou_threshold: float = 0.5
    ) -> list[dict]:
        """
        Merge overlapping detections using Non-Maximum Suppression.

        Args:
            detections: List of detection dictionaries
            iou_threshold: IoU threshold for merging

        Returns:
            Merged list of detections
        """
        if not detections:
            return []

        # Convert to numpy arrays
        boxes = np.array([d["bbox"] for d in detections])
        scores = np.array([d.get("confidence", 0.5) for d in detections])

        # Convert [x, y, w, h] to [x1, y1, x2, y2]
        boxes_xyxy = boxes.copy()
        boxes_xyxy[:, 2] = boxes[:, 0] + boxes[:, 2]
        boxes_xyxy[:, 3] = boxes[:, 1] + boxes[:, 3]

        # NMS
        keep_indices = []
        indices = np.argsort(scores)[::-1]

        while len(indices) > 0:
            current = indices[0]
            keep_indices.append(current)

            if len(indices) == 1:
                break

            # Calculate IoU with remaining boxes
            current_box = boxes_xyxy[current]
            other_boxes = boxes_xyxy[indices[1:]]

            xx1 = np.maximum(current_box[0], other_boxes[:, 0])
            yy1 = np.maximum(current_box[1], other_boxes[:, 1])
            xx2 = np.minimum(current_box[2], other_boxes[:, 2])
            yy2 = np.minimum(current_box[3], other_boxes[:, 3])

            w = np.maximum(0, xx2 - xx1)
            h = np.maximum(0, yy2 - yy1)
            intersection = w * h

            current_area = (current_box[2] - current_box[0]) * (
                current_box[3] - current_box[1]
            )
            other_areas = (other_boxes[:, 2] - other_boxes[:, 0]) * (
                other_boxes[:, 3] - other_boxes[:, 1]
            )
            union = current_area + other_areas - intersection

            iou = intersection / union

            # Keep only boxes with IoU below threshold
            indices = indices[1:][iou < iou_threshold]

        return [detections[i] for i in keep_indices]

    def label_image(
        self, image_path: str, split: str = "train", auto_detect: bool = True
    ) -> dict:
        """
        Label a single image.

        Args:
            image_path: Path to input image
            split: Dataset split
            auto_detect: Whether to run automatic detection

        Returns:
            Image info and annotations
        """
        # Load image
        img = Image.open(image_path)
        img_width, img_height = img.size

        annotations = []

        if auto_detect:
            # Run detection
            print(f"Running automatic detection on {image_path}...")

            opencv_detections = self.detect_buttons_opencv(image_path)
            color_detections = self.detect_buttons_color(image_path)

            # Merge all detections
            all_detections = opencv_detections + color_detections
            merged_detections = self.merge_detections(all_detections)

            print(f"Found {len(merged_detections)} button candidates")

            # Convert to annotations
            for detection in merged_detections:
                x, y, w, h = detection["bbox"]

                annotation = {
                    "id": self.annotation_id,
                    "image_id": self.image_id,
                    "category_id": 1,
                    "bbox": [int(x), int(y), int(w), int(h)],
                    "area": int(w * h),
                    "iscrowd": 0,
                    "confidence": detection.get("confidence", 0.5),
                    "needs_review": True,
                }
                annotations.append(annotation)
                self.annotation_id += 1

        # Copy image to output directory
        filename = f"labeled_{self.image_id:06d}.png"
        output_path = self.images_dir / split / filename
        img.save(output_path)

        # Create image info
        image_info = {
            "id": self.image_id,
            "file_name": filename,
            "width": img_width,
            "height": img_height,
            "date_captured": datetime.now().isoformat(),
            "source_path": str(image_path),
        }

        self.image_id += 1

        return {"image": image_info, "annotations": annotations}

    def label_directory(
        self, input_dir: str, split: str = "train", pattern: str = "*.png"
    ) -> dict[str, int]:
        """
        Label all images in a directory.

        Args:
            input_dir: Input directory with images
            split: Dataset split
            pattern: File pattern to match

        Returns:
            Statistics
        """
        input_path = Path(input_dir)
        image_files = list(input_path.glob(pattern))

        print(f"Found {len(image_files)} images to label")

        stats = {"images": 0, "annotations": 0}

        for i, image_file in enumerate(image_files):
            print(f"\nProcessing {i+1}/{len(image_files)}: {image_file.name}")

            result = self.label_image(str(image_file), split)

            self.datasets[split]["images"].append(result["image"])
            self.datasets[split]["annotations"].extend(result["annotations"])

            stats["images"] += 1
            stats["annotations"] += len(result["annotations"])

        return stats

    def export_coco(self, output_file: str | None = None):
        """Export dataset in COCO format."""
        for split in ["train", "val", "test"]:
            if self.datasets[split]["images"]:
                out_file = output_file or self.annotations_dir / f"{split}.json"
                with open(out_file, "w") as f:
                    json.dump(self.datasets[split], f, indent=2)
                print(f"Exported {split} annotations to {out_file}")

    def export_yolo(self, output_dir: str | None = None):
        """Export dataset in YOLO format."""
        out_dir = Path(output_dir) if output_dir else self.output_dir / "yolo"
        out_dir.mkdir(parents=True, exist_ok=True)

        for split in ["train", "val", "test"]:
            labels_dir = out_dir / split / "labels"
            labels_dir.mkdir(parents=True, exist_ok=True)

            for image_info in self.datasets[split]["images"]:
                image_id = image_info["id"]
                img_width = image_info["width"]
                img_height = image_info["height"]

                # Get annotations for this image
                anns = [
                    a
                    for a in self.datasets[split]["annotations"]
                    if a["image_id"] == image_id
                ]

                # Write YOLO format label file
                label_file = labels_dir / f"{Path(image_info['file_name']).stem}.txt"
                with open(label_file, "w") as f:
                    for ann in anns:
                        x, y, w, h = ann["bbox"]
                        # Convert to YOLO format (normalized center coordinates)
                        x_center = (x + w / 2) / img_width
                        y_center = (y + h / 2) / img_height
                        w_norm = w / img_width
                        h_norm = h / img_height

                        # Class 0 for button
                        f.write(f"0 {x_center} {y_center} {w_norm} {h_norm}\n")

        print(f"Exported YOLO format to {out_dir}")

    def export_pascal_voc(self, output_dir: str | None = None):
        """Export dataset in Pascal VOC format."""
        try:
            import xml.etree.ElementTree as ET
        except ImportError:
            print("xml library not available")
            return

        out_dir = Path(output_dir) if output_dir else self.output_dir / "pascal_voc"
        out_dir.mkdir(parents=True, exist_ok=True)

        for split in ["train", "val", "test"]:
            annotations_dir = out_dir / split / "Annotations"
            annotations_dir.mkdir(parents=True, exist_ok=True)

            for image_info in self.datasets[split]["images"]:
                image_id = image_info["id"]

                # Create XML structure
                annotation = ET.Element("annotation")

                filename = ET.SubElement(annotation, "filename")
                filename.text = image_info["file_name"]

                size = ET.SubElement(annotation, "size")
                width = ET.SubElement(size, "width")
                width.text = str(image_info["width"])
                height = ET.SubElement(size, "height")
                height.text = str(image_info["height"])
                depth = ET.SubElement(size, "depth")
                depth.text = "3"

                # Get annotations for this image
                anns = [
                    a
                    for a in self.datasets[split]["annotations"]
                    if a["image_id"] == image_id
                ]

                for ann in anns:
                    x, y, w, h = ann["bbox"]

                    obj = ET.SubElement(annotation, "object")
                    name = ET.SubElement(obj, "name")
                    name.text = "button"

                    bndbox = ET.SubElement(obj, "bndbox")
                    xmin = ET.SubElement(bndbox, "xmin")
                    xmin.text = str(x)
                    ymin = ET.SubElement(bndbox, "ymin")
                    ymin.text = str(y)
                    xmax = ET.SubElement(bndbox, "xmax")
                    xmax.text = str(x + w)
                    ymax = ET.SubElement(bndbox, "ymax")
                    ymax.text = str(y + h)

                # Write XML file
                tree = ET.ElementTree(annotation)
                xml_file = annotations_dir / f"{Path(image_info['file_name']).stem}.xml"
                tree.write(xml_file)

        print(f"Exported Pascal VOC format to {out_dir}")


def main():
    """CLI interface for dataset labeling."""
    import argparse

    parser = argparse.ArgumentParser(description="Label button detection dataset")
    parser.add_argument(
        "--input-dir", type=str, required=True, help="Input directory with images"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="datasets/labeled",
        help="Output directory (default: datasets/labeled)",
    )
    parser.add_argument(
        "--split",
        type=str,
        default="train",
        choices=["train", "val", "test"],
        help="Dataset split (default: train)",
    )
    parser.add_argument(
        "--pattern", type=str, default="*.png", help="File pattern (default: *.png)"
    )
    parser.add_argument(
        "--export-format",
        type=str,
        default="coco",
        choices=["coco", "yolo", "pascal_voc", "all"],
        help="Export format (default: coco)",
    )

    args = parser.parse_args()

    # Create labeler
    labeler = DatasetLabeler(args.output_dir)

    # Label images
    stats = labeler.label_directory(args.input_dir, args.split, args.pattern)

    # Export in requested format
    if args.export_format == "coco" or args.export_format == "all":
        labeler.export_coco()

    if args.export_format == "yolo" or args.export_format == "all":
        labeler.export_yolo()

    if args.export_format == "pascal_voc" or args.export_format == "all":
        labeler.export_pascal_voc()

    # Print statistics
    print("\n" + "=" * 60)
    print("LABELING STATISTICS")
    print("=" * 60)
    print(f"Images labeled: {stats['images']}")
    print(f"Annotations created: {stats['annotations']}")
    print(
        f"Average annotations per image: {stats['annotations'] / max(1, stats['images']):.2f}"
    )
    print(f"\nDataset saved to: {args.output_dir}")
    print("=" * 60)


if __name__ == "__main__":
    main()
