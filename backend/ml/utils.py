"""
Utility functions for ML button detection

Includes:
- COCO to YOLO format conversion
- Dataset statistics
- Visualization helpers
"""

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def coco_to_yolo(
    coco_json_path: str, output_dir: str, image_dir: str, split: str = "train"
) -> None:
    """
    Convert COCO format annotations to YOLO format

    Args:
        coco_json_path: Path to COCO JSON annotation file
        output_dir: Output directory for YOLO format labels
        image_dir: Directory containing images
        split: Dataset split name (train/val/test)
    """
    # Load COCO annotations
    with open(coco_json_path) as f:
        coco_data = json.load(f)

    # Create output directories
    output_path = Path(output_dir)
    labels_dir = output_path / "labels" / split
    labels_dir.mkdir(parents=True, exist_ok=True)

    # Build image mapping
    images = {img["id"]: img for img in coco_data["images"]}

    # Group annotations by image
    image_annotations = {}
    for ann in coco_data["annotations"]:
        img_id = ann["image_id"]
        if img_id not in image_annotations:
            image_annotations[img_id] = []
        image_annotations[img_id].append(ann)

    # Convert each image's annotations
    converted = 0
    for img_id, annotations in image_annotations.items():
        img_info = images[img_id]
        img_width = img_info["width"]
        img_height = img_info["height"]

        # Create label file
        label_filename = Path(img_info["file_name"]).stem + ".txt"
        label_path = labels_dir / label_filename

        with open(label_path, "w") as f:
            for ann in annotations:
                # COCO bbox: [x, y, width, height]
                x, y, w, h = ann["bbox"]

                # Convert to YOLO format: [x_center, y_center, width, height] normalized
                x_center = (x + w / 2) / img_width
                y_center = (y + h / 2) / img_height
                norm_w = w / img_width
                norm_h = h / img_height

                # YOLO class ID (0-indexed)
                class_id = ann["category_id"] - 1

                # Write line
                f.write(
                    f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}\n"
                )

        converted += 1

    print(f"Converted {converted} images to YOLO format")
    print(f"Labels saved to: {labels_dir}")


def analyze_dataset(coco_json_path: str) -> dict[str, Any]:
    """
    Analyze COCO dataset and return statistics

    Args:
        coco_json_path: Path to COCO JSON annotation file

    Returns:
        Dictionary with dataset statistics
    """
    with open(coco_json_path) as f:
        coco_data = json.load(f)

    # Basic stats
    num_images = len(coco_data["images"])
    num_annotations = len(coco_data["annotations"])
    num_categories = len(coco_data["categories"])

    # Category distribution
    category_counts = {}
    bbox_sizes = []

    for ann in coco_data["annotations"]:
        cat_id = ann["category_id"]
        category_counts[cat_id] = category_counts.get(cat_id, 0) + 1

        # Collect bbox sizes
        bbox = ann["bbox"]
        area = bbox[2] * bbox[3]  # width * height
        bbox_sizes.append(area)

    # Get category names
    categories = {cat["id"]: cat["name"] for cat in coco_data["categories"]}

    # Calculate statistics
    stats = {
        "num_images": num_images,
        "num_annotations": num_annotations,
        "num_categories": num_categories,
        "annotations_per_image": num_annotations / num_images if num_images > 0 else 0,
        "category_distribution": {
            categories[cat_id]: count for cat_id, count in category_counts.items()
        },
        "bbox_area_stats": {
            "mean": float(np.mean(bbox_sizes)),
            "median": float(np.median(bbox_sizes)),
            "min": float(np.min(bbox_sizes)),
            "max": float(np.max(bbox_sizes)),
            "std": float(np.std(bbox_sizes)),
        },
    }

    return stats


def visualize_annotations(
    image_path: str,
    annotations: list[dict[str, Any]],
    categories: dict[int, str],
    output_path: str = None,
) -> np.ndarray:
    """
    Visualize COCO annotations on image

    Args:
        image_path: Path to image
        annotations: List of annotation dictionaries
        categories: Mapping of category ID to name
        output_path: Optional path to save visualization

    Returns:
        Image with annotations drawn
    """
    # Load image
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not load image: {image_path}")

    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Draw each annotation
    for ann in annotations:
        # Get bbox
        x, y, w, h = [int(v) for v in ann["bbox"]]

        # Get category
        cat_id = ann["category_id"]
        cat_name = categories.get(cat_id, f"class_{cat_id}")

        # Random color per category
        np.random.seed(cat_id)
        color = tuple(np.random.randint(0, 255, 3).tolist())

        # Draw bounding box
        cv2.rectangle(image, (x, y), (x + w, y + h), color, 2)

        # Draw label
        label = cat_name
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.6
        thickness = 2

        # Get text size
        (text_w, text_h), _ = cv2.getTextSize(label, font, font_scale, thickness)

        # Draw background for text
        cv2.rectangle(image, (x, y - text_h - 10), (x + text_w, y), color, -1)

        # Draw text
        cv2.putText(
            image, label, (x, y - 5), font, font_scale, (255, 255, 255), thickness
        )

    # Save if output path provided
    if output_path:
        cv2.imwrite(output_path, cv2.cvtColor(image, cv2.COLOR_RGB2BGR))

    return image


def create_yolo_data_yaml(
    dataset_path: str, categories: list[str], output_path: str = "data.yaml"
) -> None:
    """
    Create YOLO data.yaml configuration file

    Args:
        dataset_path: Path to dataset root
        categories: List of category names (in order)
        output_path: Output path for data.yaml
    """
    import yaml

    data = {
        "path": str(dataset_path),
        "train": "images/train",
        "val": "images/val",
        "nc": len(categories),
        "names": categories,
    }

    with open(output_path, "w") as f:
        yaml.dump(data, f, default_flow_style=False)

    print(f"Created {output_path}")


def split_dataset(
    coco_json_path: str,
    output_dir: str,
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
    seed: int = 42,
) -> tuple[str, str, str]:
    """
    Split COCO dataset into train/val/test sets

    Args:
        coco_json_path: Path to COCO JSON annotation file
        output_dir: Output directory for split annotations
        train_ratio: Ratio of training data
        val_ratio: Ratio of validation data
        test_ratio: Ratio of test data
        seed: Random seed for reproducibility

    Returns:
        Tuple of (train_path, val_path, test_path)
    """
    import random

    # Load COCO data
    with open(coco_json_path) as f:
        coco_data = json.load(f)

    # Set random seed
    random.seed(seed)
    np.random.seed(seed)

    # Get all image IDs
    image_ids = [img["id"] for img in coco_data["images"]]
    random.shuffle(image_ids)

    # Calculate split indices
    n_images = len(image_ids)
    n_train = int(n_images * train_ratio)
    n_val = int(n_images * val_ratio)

    # Split image IDs
    train_ids = set(image_ids[:n_train])
    val_ids = set(image_ids[n_train : n_train + n_val])
    test_ids = set(image_ids[n_train + n_val :])

    # Create split annotations
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    def create_split(split_name: str, split_ids: set) -> str:
        split_data = {
            "images": [img for img in coco_data["images"] if img["id"] in split_ids],
            "annotations": [
                ann for ann in coco_data["annotations"] if ann["image_id"] in split_ids
            ],
            "categories": coco_data["categories"],
        }

        split_path = output_path / f"{split_name}.json"
        with open(split_path, "w") as f:
            json.dump(split_data, f, indent=2)

        print(
            f"Created {split_name} split: {len(split_data['images'])} images, {len(split_data['annotations'])} annotations"
        )
        return str(split_path)

    train_path = create_split("train", train_ids)
    val_path = create_split("val", val_ids)
    test_path = create_split("test", test_ids) if test_ids else None

    return train_path, val_path, test_path


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ML Dataset Utilities")
    parser.add_argument(
        "command", choices=["coco2yolo", "analyze", "split"], help="Command to run"
    )
    parser.add_argument("--coco-json", type=str, help="Path to COCO JSON file")
    parser.add_argument("--output-dir", type=str, help="Output directory")
    parser.add_argument("--image-dir", type=str, help="Image directory")
    parser.add_argument("--split", type=str, default="train", help="Dataset split name")

    args = parser.parse_args()

    if args.command == "coco2yolo":
        coco_to_yolo(args.coco_json, args.output_dir, args.image_dir, args.split)

    elif args.command == "analyze":
        stats = analyze_dataset(args.coco_json)
        print("\nDataset Statistics:")
        print(json.dumps(stats, indent=2))

    elif args.command == "split":
        train_path, val_path, test_path = split_dataset(args.coco_json, args.output_dir)
        print("\nDataset split complete:")
        print(f"  Train: {train_path}")
        print(f"  Val: {val_path}")
        print(f"  Test: {test_path}")
