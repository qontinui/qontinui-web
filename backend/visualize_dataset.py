"""
Visualize Dataset Annotations

Draw bounding boxes and labels on sample images to verify dataset quality.
"""

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def visualize_sample(dataset_dir: str, split: str = "train", num_samples: int = 5):
    """
    Visualize sample images with annotations.

    Args:
        dataset_dir: Dataset directory
        split: Dataset split
        num_samples: Number of samples to visualize
    """
    dataset_path = Path(dataset_dir)
    annotation_file = dataset_path / "annotations" / f"{split}.json"

    # Load annotations
    with open(annotation_file) as f:
        dataset = json.load(f)

    # Select random samples
    sample_images = random.sample(
        dataset["images"], min(num_samples, len(dataset["images"]))
    )

    output_dir = dataset_path / "visualizations"
    output_dir.mkdir(exist_ok=True)

    for img_info in sample_images:
        image_id = img_info["id"]
        image_path = dataset_path / "images" / split / img_info["file_name"]

        # Load image
        img = Image.open(image_path)
        draw = ImageDraw.Draw(img)

        # Get annotations for this image
        anns = [a for a in dataset["annotations"] if a["image_id"] == image_id]

        # Try to load font
        try:
            font = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12
            )
        except OSError:
            font = ImageFont.load_default()

        # Draw bounding boxes
        colors = {
            "primary": (59, 130, 246),
            "secondary": (107, 114, 128),
            "success": (34, 197, 94),
            "danger": (239, 68, 68),
            "warning": (251, 191, 36),
            "info": (99, 102, 241),
            "dark": (31, 41, 55),
            "light": (200, 200, 200),
        }

        for ann in anns:
            x, y, w, h = ann["bbox"]

            # Get color from attributes
            color_name = ann.get("attributes", {}).get("color", "primary")
            color = colors.get(color_name, (0, 255, 0))

            # Draw bounding box
            draw.rectangle([x, y, x + w, y + h], outline=color, width=2)

            # Draw label
            label = ann.get("attributes", {}).get("label", "Button")
            draw.text((x, y - 15), label, fill=color, font=font)

        # Save visualization
        output_path = output_dir / f"vis_{img_info['file_name']}"
        img.save(output_path)
        print(f"Saved visualization: {output_path}")

    print(f"\nVisualized {len(sample_images)} samples")
    print(f"Output directory: {output_dir}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Visualize dataset annotations")
    parser.add_argument(
        "--dataset-dir", type=str, required=True, help="Dataset directory"
    )
    parser.add_argument(
        "--split",
        type=str,
        default="train",
        choices=["train", "val", "test"],
        help="Dataset split (default: train)",
    )
    parser.add_argument(
        "--num-samples",
        type=int,
        default=5,
        help="Number of samples to visualize (default: 5)",
    )

    args = parser.parse_args()

    visualize_sample(args.dataset_dir, args.split, args.num_samples)
