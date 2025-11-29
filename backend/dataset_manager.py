"""
Dataset Management Utilities

Tools for organizing, splitting, validating, and converting datasets.
Provides dataset statistics and quality checks.
"""

import json
import random
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime
from pathlib import Path


class DatasetManager:
    """Dataset organization and management utilities."""

    def __init__(self, dataset_dir: str):
        """
        Initialize the dataset manager.

        Args:
            dataset_dir: Root directory of the dataset
        """
        self.dataset_dir = Path(dataset_dir)
        self.images_dir = self.dataset_dir / "images"
        self.annotations_dir = self.dataset_dir / "annotations"

    def load_coco_dataset(self, split: str) -> dict | None:
        """Load COCO format dataset."""
        annotation_file = self.annotations_dir / f"{split}.json"

        if not annotation_file.exists():
            return None

        with open(annotation_file) as f:
            return json.load(f)

    def save_coco_dataset(self, dataset: dict, split: str):
        """Save COCO format dataset."""
        self.annotations_dir.mkdir(parents=True, exist_ok=True)
        annotation_file = self.annotations_dir / f"{split}.json"

        with open(annotation_file, "w") as f:
            json.dump(dataset, f, indent=2)

    def calculate_statistics(self, split: str = None) -> dict:
        """
        Calculate comprehensive dataset statistics.

        Args:
            split: Specific split to analyze, or None for all

        Returns:
            Dictionary of statistics
        """
        splits = [split] if split else ["train", "val", "test"]
        all_stats = {}

        for split_name in splits:
            dataset = self.load_coco_dataset(split_name)
            if not dataset:
                continue

            stats = {
                "split": split_name,
                "num_images": len(dataset["images"]),
                "num_annotations": len(dataset["annotations"]),
                "categories": {},
            }

            # Annotations per image
            anns_per_image = defaultdict(int)
            for ann in dataset["annotations"]:
                anns_per_image[ann["image_id"]] += 1

            stats["annotations_per_image"] = {
                "min": min(anns_per_image.values()) if anns_per_image else 0,
                "max": max(anns_per_image.values()) if anns_per_image else 0,
                "mean": (
                    sum(anns_per_image.values()) / len(anns_per_image)
                    if anns_per_image
                    else 0
                ),
                "total": len(anns_per_image),
            }

            # Bounding box statistics
            widths = []
            heights = []
            areas = []
            aspect_ratios = []

            for ann in dataset["annotations"]:
                x, y, w, h = ann["bbox"]
                widths.append(w)
                heights.append(h)
                areas.append(w * h)
                if h > 0:
                    aspect_ratios.append(w / h)

            if widths:
                stats["bbox_width"] = {
                    "min": min(widths),
                    "max": max(widths),
                    "mean": sum(widths) / len(widths),
                    "median": sorted(widths)[len(widths) // 2],
                }

                stats["bbox_height"] = {
                    "min": min(heights),
                    "max": max(heights),
                    "mean": sum(heights) / len(heights),
                    "median": sorted(heights)[len(heights) // 2],
                }

                stats["bbox_area"] = {
                    "min": min(areas),
                    "max": max(areas),
                    "mean": sum(areas) / len(areas),
                    "median": sorted(areas)[len(areas) // 2],
                }

                stats["aspect_ratio"] = {
                    "min": min(aspect_ratios),
                    "max": max(aspect_ratios),
                    "mean": sum(aspect_ratios) / len(aspect_ratios),
                    "median": sorted(aspect_ratios)[len(aspect_ratios) // 2],
                }

            # Image size statistics
            img_widths = [img["width"] for img in dataset["images"]]
            img_heights = [img["height"] for img in dataset["images"]]

            if img_widths:
                stats["image_width"] = {
                    "min": min(img_widths),
                    "max": max(img_widths),
                    "mean": sum(img_widths) / len(img_widths),
                }

                stats["image_height"] = {
                    "min": min(img_heights),
                    "max": max(img_heights),
                    "mean": sum(img_heights) / len(img_heights),
                }

            # Attribute statistics (if available)
            if dataset["annotations"] and "attributes" in dataset["annotations"][0]:
                attributes = defaultdict(lambda: defaultdict(int))

                for ann in dataset["annotations"]:
                    if "attributes" in ann:
                        for key, value in ann["attributes"].items():
                            attributes[key][str(value)] += 1

                stats["attributes"] = dict(attributes)

            all_stats[split_name] = stats

        return all_stats

    def verify_dataset(self, split: str = None) -> dict:
        """
        Verify dataset integrity and quality.

        Args:
            split: Specific split to verify, or None for all

        Returns:
            Dictionary of verification results
        """
        splits = [split] if split else ["train", "val", "test"]
        results = {}

        for split_name in splits:
            dataset = self.load_coco_dataset(split_name)
            if not dataset:
                results[split_name] = {"status": "not_found"}
                continue

            issues = []
            warnings = []

            # Check for missing images
            missing_images = []
            for img_info in dataset["images"]:
                img_path = self.images_dir / split_name / img_info["file_name"]
                if not img_path.exists():
                    missing_images.append(img_info["file_name"])

            if missing_images:
                issues.append(f"Missing {len(missing_images)} image files")

            # Check for orphaned annotations
            image_ids = {img["id"] for img in dataset["images"]}
            orphaned_anns = []
            for ann in dataset["annotations"]:
                if ann["image_id"] not in image_ids:
                    orphaned_anns.append(ann["id"])

            if orphaned_anns:
                issues.append(f"Found {len(orphaned_anns)} orphaned annotations")

            # Check for invalid bounding boxes
            invalid_boxes = []
            for ann in dataset["annotations"]:
                x, y, w, h = ann["bbox"]
                if w <= 0 or h <= 0:
                    invalid_boxes.append(ann["id"])
                elif x < 0 or y < 0:
                    warnings.append(f"Annotation {ann['id']} has negative coordinates")

            if invalid_boxes:
                issues.append(f"Found {len(invalid_boxes)} invalid bounding boxes")

            # Check for images without annotations
            images_without_anns = []
            ann_image_ids = {ann["image_id"] for ann in dataset["annotations"]}
            for img in dataset["images"]:
                if img["id"] not in ann_image_ids:
                    images_without_anns.append(img["id"])

            if images_without_anns:
                warnings.append(
                    f"Found {len(images_without_anns)} images without annotations"
                )

            # Check for duplicate image IDs
            image_id_counts = defaultdict(int)
            for img in dataset["images"]:
                image_id_counts[img["id"]] += 1

            duplicate_ids = [
                img_id for img_id, count in image_id_counts.items() if count > 1
            ]
            if duplicate_ids:
                issues.append(f"Found {len(duplicate_ids)} duplicate image IDs")

            results[split_name] = {
                "status": "valid" if not issues else "invalid",
                "issues": issues,
                "warnings": warnings,
                "num_images": len(dataset["images"]),
                "num_annotations": len(dataset["annotations"]),
                "missing_images": missing_images[:10],  # Show first 10
                "orphaned_annotations": orphaned_anns[:10],
            }

        return results

    def split_dataset(
        self,
        input_split: str = "train",
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15,
        shuffle: bool = True,
        seed: int = 42,
    ) -> dict[str, int]:
        """
        Split a dataset into train/val/test sets.

        Args:
            input_split: Input split to re-split
            train_ratio: Training set ratio
            val_ratio: Validation set ratio
            test_ratio: Test set ratio
            shuffle: Whether to shuffle before splitting
            seed: Random seed for reproducibility

        Returns:
            Statistics about the split
        """
        assert (
            abs(train_ratio + val_ratio + test_ratio - 1.0) < 0.01
        ), "Ratios must sum to 1.0"

        # Load input dataset
        dataset = self.load_coco_dataset(input_split)
        if not dataset:
            print(f"Dataset {input_split} not found")
            return {}

        # Get all images
        images = dataset["images"].copy()

        # Shuffle if requested
        if shuffle:
            random.seed(seed)
            random.shuffle(images)

        # Calculate split sizes
        num_images = len(images)
        num_train = int(num_images * train_ratio)
        num_val = int(num_images * val_ratio)
        num_images - num_train - num_val

        # Split images
        train_images = images[:num_train]
        val_images = images[num_train : num_train + num_val]
        test_images = images[num_train + num_val :]

        # Create new datasets
        datasets = {
            "train": self._create_split_dataset(dataset, train_images),
            "val": self._create_split_dataset(dataset, val_images),
            "test": self._create_split_dataset(dataset, test_images),
        }

        # Copy/move images to new splits
        for split_name, split_images in [
            ("train", train_images),
            ("val", val_images),
            ("test", test_images),
        ]:
            split_dir = self.images_dir / split_name
            split_dir.mkdir(parents=True, exist_ok=True)

            for img_info in split_images:
                src = self.images_dir / input_split / img_info["file_name"]
                dst = split_dir / img_info["file_name"]

                if src.exists() and not dst.exists():
                    shutil.copy2(src, dst)

        # Save new datasets
        for split_name, dataset_data in datasets.items():
            self.save_coco_dataset(dataset_data, split_name)

        # Return statistics
        stats = {
            "train": {
                "images": len(train_images),
                "annotations": len(datasets["train"]["annotations"]),
            },
            "val": {
                "images": len(val_images),
                "annotations": len(datasets["val"]["annotations"]),
            },
            "test": {
                "images": len(test_images),
                "annotations": len(datasets["test"]["annotations"]),
            },
        }

        return stats

    def _create_split_dataset(self, source_dataset: dict, images: list[dict]) -> dict:
        """Create a dataset for a specific split."""
        image_ids = {img["id"] for img in images}

        # Filter annotations
        annotations = [
            ann for ann in source_dataset["annotations"] if ann["image_id"] in image_ids
        ]

        return {
            "info": source_dataset["info"].copy(),
            "licenses": source_dataset["licenses"].copy(),
            "categories": source_dataset["categories"].copy(),
            "images": images,
            "annotations": annotations,
        }

    def convert_to_yolo(self, output_dir: str, split: str = None):
        """
        Convert COCO dataset to YOLO format.

        Args:
            output_dir: Output directory
            split: Specific split or None for all
        """
        output_path = Path(output_dir)
        splits = [split] if split else ["train", "val", "test"]

        for split_name in splits:
            dataset = self.load_coco_dataset(split_name)
            if not dataset:
                continue

            # Create YOLO directory structure
            images_dir = output_path / "images" / split_name
            labels_dir = output_path / "labels" / split_name
            images_dir.mkdir(parents=True, exist_ok=True)
            labels_dir.mkdir(parents=True, exist_ok=True)

            # Process each image
            for img_info in dataset["images"]:
                image_id = img_info["id"]
                img_width = img_info["width"]
                img_height = img_info["height"]

                # Get annotations
                anns = [a for a in dataset["annotations"] if a["image_id"] == image_id]

                # Copy image
                src_img = self.images_dir / split_name / img_info["file_name"]
                dst_img = images_dir / img_info["file_name"]
                if src_img.exists():
                    shutil.copy2(src_img, dst_img)

                # Write YOLO label file
                label_file = labels_dir / f"{Path(img_info['file_name']).stem}.txt"
                with open(label_file, "w") as f:
                    for ann in anns:
                        x, y, w, h = ann["bbox"]

                        # Convert to YOLO format (normalized center coordinates)
                        x_center = (x + w / 2) / img_width
                        y_center = (y + h / 2) / img_height
                        w_norm = w / img_width
                        h_norm = h / img_height

                        # Category ID (YOLO uses 0-indexed)
                        cat_id = ann["category_id"] - 1

                        f.write(
                            f"{cat_id} {x_center:.6f} {y_center:.6f} {w_norm:.6f} {h_norm:.6f}\n"
                        )

        # Create dataset.yaml
        yaml_content = f"""
# YOLO Dataset Configuration
path: {output_path.absolute()}
train: images/train
val: images/val
test: images/test

# Classes
nc: 1  # number of classes
names: ['button']  # class names
"""
        with open(output_path / "dataset.yaml", "w") as f:
            f.write(yaml_content.strip())

        print(f"Converted to YOLO format: {output_path}")

    def convert_to_pascal_voc(self, output_dir: str, split: str = None):
        """
        Convert COCO dataset to Pascal VOC format.

        Args:
            output_dir: Output directory
            split: Specific split or None for all
        """
        output_path = Path(output_dir)
        splits = [split] if split else ["train", "val", "test"]

        for split_name in splits:
            dataset = self.load_coco_dataset(split_name)
            if not dataset:
                continue

            # Create Pascal VOC directory structure
            annotations_dir = output_path / "Annotations" / split_name
            images_dir = output_path / "JPEGImages" / split_name
            annotations_dir.mkdir(parents=True, exist_ok=True)
            images_dir.mkdir(parents=True, exist_ok=True)

            # Process each image
            for img_info in dataset["images"]:
                image_id = img_info["id"]

                # Create XML annotation
                annotation = ET.Element("annotation")

                filename = ET.SubElement(annotation, "filename")
                filename.text = img_info["file_name"]

                size = ET.SubElement(annotation, "size")
                width = ET.SubElement(size, "width")
                width.text = str(img_info["width"])
                height = ET.SubElement(size, "height")
                height.text = str(img_info["height"])
                depth = ET.SubElement(size, "depth")
                depth.text = "3"

                # Get annotations
                anns = [a for a in dataset["annotations"] if a["image_id"] == image_id]

                for ann in anns:
                    x, y, w, h = ann["bbox"]

                    obj = ET.SubElement(annotation, "object")

                    name = ET.SubElement(obj, "name")
                    name.text = "button"

                    bndbox = ET.SubElement(obj, "bndbox")
                    xmin = ET.SubElement(bndbox, "xmin")
                    xmin.text = str(int(x))
                    ymin = ET.SubElement(bndbox, "ymin")
                    ymin.text = str(int(y))
                    xmax = ET.SubElement(bndbox, "xmax")
                    xmax.text = str(int(x + w))
                    ymax = ET.SubElement(bndbox, "ymax")
                    ymax.text = str(int(y + h))

                # Write XML file
                tree = ET.ElementTree(annotation)
                xml_file = annotations_dir / f"{Path(img_info['file_name']).stem}.xml"
                tree.write(xml_file)

                # Copy image
                src_img = self.images_dir / split_name / img_info["file_name"]
                dst_img = images_dir / img_info["file_name"]
                if src_img.exists():
                    shutil.copy2(src_img, dst_img)

        print(f"Converted to Pascal VOC format: {output_path}")

    def merge_datasets(self, dataset_paths: list[str], output_split: str = "train"):
        """
        Merge multiple datasets into one.

        Args:
            dataset_paths: List of dataset directories to merge
            output_split: Output split name
        """
        merged_dataset = {
            "info": {
                "description": "Merged Button Detection Dataset",
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

        image_id_offset = 0
        annotation_id_offset = 0

        for dataset_path in dataset_paths:
            dataset_dir = Path(dataset_path)

            # Try to load any split
            for split in ["train", "val", "test"]:
                ann_file = dataset_dir / "annotations" / f"{split}.json"
                if ann_file.exists():
                    with open(ann_file) as f:
                        dataset = json.load(f)

                    # Update IDs
                    for img in dataset["images"]:
                        img["id"] += image_id_offset
                        merged_dataset["images"].append(img)

                    for ann in dataset["annotations"]:
                        ann["id"] += annotation_id_offset
                        ann["image_id"] += image_id_offset
                        merged_dataset["annotations"].append(ann)

                    # Update offsets
                    if dataset["images"]:
                        image_id_offset = (
                            max(img["id"] for img in merged_dataset["images"]) + 1
                        )
                    if dataset["annotations"]:
                        annotation_id_offset = (
                            max(ann["id"] for ann in merged_dataset["annotations"]) + 1
                        )

        # Save merged dataset
        self.save_coco_dataset(merged_dataset, output_split)

        print(f"Merged {len(dataset_paths)} datasets into {output_split}")
        print(f"Total images: {len(merged_dataset['images'])}")
        print(f"Total annotations: {len(merged_dataset['annotations'])}")


def main():
    """CLI interface for dataset management."""
    import argparse

    parser = argparse.ArgumentParser(description="Manage button detection datasets")
    parser.add_argument(
        "--dataset-dir", type=str, required=True, help="Dataset directory"
    )
    parser.add_argument(
        "--action",
        type=str,
        required=True,
        choices=["stats", "verify", "split", "convert"],
        help="Action to perform",
    )
    parser.add_argument(
        "--split", type=str, default=None, help="Specific split to process"
    )
    parser.add_argument(
        "--format",
        type=str,
        default="yolo",
        choices=["yolo", "pascal_voc"],
        help="Output format for conversion",
    )
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory")

    args = parser.parse_args()

    manager = DatasetManager(args.dataset_dir)

    if args.action == "stats":
        stats = manager.calculate_statistics(args.split)

        print("\n" + "=" * 60)
        print("DATASET STATISTICS")
        print("=" * 60)

        for split_name, split_stats in stats.items():
            print(f"\n{split_name.upper()} Split:")
            print(f"  Images: {split_stats['num_images']}")
            print(f"  Annotations: {split_stats['num_annotations']}")

            if "annotations_per_image" in split_stats:
                apm = split_stats["annotations_per_image"]
                print(
                    f"  Annotations per image: {apm['mean']:.2f} (min: {apm['min']}, max: {apm['max']})"
                )

            if "bbox_width" in split_stats:
                print(
                    f"  Bbox width: {split_stats['bbox_width']['mean']:.1f} "
                    f"(min: {split_stats['bbox_width']['min']:.1f}, "
                    f"max: {split_stats['bbox_width']['max']:.1f})"
                )

            if "bbox_height" in split_stats:
                print(
                    f"  Bbox height: {split_stats['bbox_height']['mean']:.1f} "
                    f"(min: {split_stats['bbox_height']['min']:.1f}, "
                    f"max: {split_stats['bbox_height']['max']:.1f})"
                )

            if "attributes" in split_stats:
                print("  Attributes:")
                for attr, values in split_stats["attributes"].items():
                    print(f"    {attr}: {dict(values)}")

    elif args.action == "verify":
        results = manager.verify_dataset(args.split)

        print("\n" + "=" * 60)
        print("DATASET VERIFICATION")
        print("=" * 60)

        for split_name, result in results.items():
            print(f"\n{split_name.upper()} Split: {result['status'].upper()}")

            if result["status"] == "not_found":
                print("  Dataset not found")
                continue

            print(f"  Images: {result['num_images']}")
            print(f"  Annotations: {result['num_annotations']}")

            if result["issues"]:
                print("  Issues:")
                for issue in result["issues"]:
                    print(f"    - {issue}")

            if result["warnings"]:
                print("  Warnings:")
                for warning in result["warnings"]:
                    print(f"    - {warning}")

    elif args.action == "split":
        stats = manager.split_dataset()

        print("\n" + "=" * 60)
        print("DATASET SPLIT")
        print("=" * 60)

        for split_name, split_stats in stats.items():
            print(
                f"{split_name.upper()}: {split_stats['images']} images, "
                f"{split_stats['annotations']} annotations"
            )

    elif args.action == "convert":
        if not args.output_dir:
            print("Error: --output-dir required for conversion")
            return

        if args.format == "yolo":
            manager.convert_to_yolo(args.output_dir, args.split)
        elif args.format == "pascal_voc":
            manager.convert_to_pascal_voc(args.output_dir, args.split)


if __name__ == "__main__":
    main()
