"""
Automated Button Dataset Generator

Generates synthetic GUI screenshots with labeled buttons for ML training.
Creates diverse button examples with various styles, sizes, colors, and states.
"""

import colorsys
import json
import random
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


class ButtonDatasetGenerator:
    """Generate synthetic button datasets for ML training."""

    # Button configurations
    SIZES = {
        "small": (60, 24),
        "medium": (100, 36),
        "large": (140, 48),
        "xl": (180, 56),
    }

    STYLES = ["flat", "3d", "gradient", "outlined", "ghost", "raised"]

    COLORS = {
        "primary": (59, 130, 246),  # Blue
        "secondary": (107, 114, 128),  # Gray
        "success": (34, 197, 94),  # Green
        "danger": (239, 68, 68),  # Red
        "warning": (251, 191, 36),  # Yellow
        "info": (99, 102, 241),  # Indigo
        "dark": (31, 41, 55),  # Dark gray
        "light": (243, 244, 246),  # Light gray
    }

    SHAPES = ["rectangular", "rounded", "pill", "circular"]

    STATES = ["normal", "hover", "pressed", "disabled", "focus"]

    CONTEXTS = [
        "toolbar",
        "dialog",
        "form",
        "card",
        "navbar",
        "sidebar",
        "modal",
        "floating",
    ]

    LABELS = [
        "Submit",
        "Cancel",
        "OK",
        "Apply",
        "Close",
        "Save",
        "Delete",
        "Edit",
        "Add",
        "Remove",
        "Search",
        "Filter",
        "Export",
        "Import",
        "Upload",
        "Download",
        "Share",
        "Print",
        "Copy",
        "Paste",
        "Cut",
        "Undo",
        "Redo",
        "Refresh",
        "Settings",
        "Help",
        "Next",
        "Previous",
        "Start",
        "Stop",
        "Play",
        "Pause",
        "Login",
        "Logout",
        "Register",
        "Confirm",
        "Retry",
        "Skip",
        "Continue",
        "Finish",
        "Back",
        "Home",
    ]

    def __init__(self, output_dir: str = "datasets/buttons"):
        """
        Initialize the dataset generator.

        Args:
            output_dir: Root directory for dataset output
        """
        self.output_dir = Path(output_dir)
        self.images_dir = self.output_dir / "images"
        self.annotations_dir = self.output_dir / "annotations"

        # Create directory structure
        for split in ["train", "val", "test"]:
            (self.images_dir / split).mkdir(parents=True, exist_ok=True)
        self.annotations_dir.mkdir(parents=True, exist_ok=True)

        # COCO format datasets
        self.datasets = {
            "train": self._init_coco_dataset(),
            "val": self._init_coco_dataset(),
            "test": self._init_coco_dataset(),
        }

        self.image_id = 1
        self.annotation_id = 1

    def _init_coco_dataset(self) -> dict:
        """Initialize a COCO format dataset structure."""
        return {
            "info": {
                "description": "Button Detection Dataset",
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

    def _adjust_color_for_state(
        self, color: tuple[int, int, int], state: str
    ) -> tuple[int, int, int]:
        """Adjust button color based on state."""
        r, g, b = color

        if state == "hover":
            # Slightly lighter
            return tuple(min(255, int(c * 1.1)) for c in (r, g, b))
        elif state == "pressed":
            # Darker
            return tuple(int(c * 0.8) for c in (r, g, b))
        elif state == "disabled":
            # Desaturated and lighter
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            r, g, b = colorsys.hsv_to_rgb(h, s * 0.3, v * 0.7)
            return tuple(int(c * 255) for c in (r, g, b))
        elif state == "focus":
            # Slightly brighter
            return tuple(min(255, int(c * 1.15)) for c in (r, g, b))

        return color

    def _draw_button(
        self,
        draw: ImageDraw.Draw,
        x: int,
        y: int,
        width: int,
        height: int,
        style: str,
        color: tuple[int, int, int],
        shape: str,
        state: str,
        label: str,
    ) -> None:
        """Draw a button with specified properties."""

        # Adjust color for state
        button_color = self._adjust_color_for_state(color, state)

        # Calculate border radius
        if shape == "pill":
            radius = height // 2
        elif shape == "rounded":
            radius = min(8, height // 4)
        elif shape == "circular":
            # Make it square and use circular shape
            size = min(width, height)
            width = height = size
            radius = size // 2
        else:  # rectangular
            radius = 0

        # Draw button based on style
        if style == "flat":
            self._draw_rounded_rectangle(
                draw, x, y, x + width, y + height, radius, fill=button_color
            )

        elif style == "3d":
            # Draw shadow
            shadow_color = tuple(int(c * 0.6) for c in button_color)
            self._draw_rounded_rectangle(
                draw,
                x + 2,
                y + 3,
                x + width + 2,
                y + height + 3,
                radius,
                fill=shadow_color,
            )
            # Draw button
            self._draw_rounded_rectangle(
                draw, x, y, x + width, y + height, radius, fill=button_color
            )
            # Highlight
            if state != "pressed":
                highlight = tuple(min(255, int(c * 1.3)) for c in button_color)
                draw.line(
                    [(x + radius, y + 1), (x + width - radius, y + 1)],
                    fill=highlight,
                    width=2,
                )

        elif style == "gradient":
            # Simple gradient effect using multiple rectangles
            for i in range(height):
                factor = 1.2 - (i / height) * 0.4
                grad_color = tuple(min(255, int(c * factor)) for c in button_color)
                draw.rectangle([x, y + i, x + width, y + i + 1], fill=grad_color)
            # Add rounded corners on top
            if radius > 0:
                self._draw_rounded_rectangle(
                    draw,
                    x,
                    y,
                    x + width,
                    y + height,
                    radius,
                    outline=button_color,
                    width=1,
                )

        elif style == "outlined":
            # Border only
            self._draw_rounded_rectangle(
                draw, x, y, x + width, y + height, radius, outline=button_color, width=2
            )

        elif style == "ghost":
            # Subtle background with border
            tuple(int(c * 0.15) for c in button_color) + (50,)
            self._draw_rounded_rectangle(
                draw, x, y, x + width, y + height, radius, fill=button_color + (30,)
            )
            self._draw_rounded_rectangle(
                draw, x, y, x + width, y + height, radius, outline=button_color, width=1
            )

        elif style == "raised":
            # Light border on top/left, dark on bottom/right
            self._draw_rounded_rectangle(
                draw, x, y, x + width, y + height, radius, fill=button_color
            )
            highlight = tuple(min(255, int(c * 1.4)) for c in button_color)
            shadow = tuple(int(c * 0.6) for c in button_color)
            draw.line(
                [(x, y + height), (x, y), (x + width, y)], fill=highlight, width=2
            )
            draw.line(
                [(x + width, y), (x + width, y + height), (x, y + height)],
                fill=shadow,
                width=2,
            )

        # Draw label
        try:
            font = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(10, height // 3)
            )
        except OSError:
            font = ImageFont.load_default()

        # Calculate text position
        bbox = draw.textbbox((0, 0), label, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        text_x = x + (width - text_width) // 2
        text_y = y + (height - text_height) // 2

        # Text color based on button color brightness
        brightness = sum(button_color[:3]) / 3
        text_color = (255, 255, 255) if brightness < 128 else (0, 0, 0)

        if state == "disabled":
            text_color = tuple(int(c * 0.5) for c in text_color)

        if style != "outlined":
            draw.text((text_x, text_y), label, fill=text_color, font=font)
        else:
            draw.text((text_x, text_y), label, fill=button_color, font=font)

    def _draw_rounded_rectangle(
        self,
        draw: ImageDraw.Draw,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        radius: int,
        **kwargs,
    ) -> None:
        """Draw a rounded rectangle."""
        if radius == 0:
            draw.rectangle([x1, y1, x2, y2], **kwargs)
        else:
            draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, **kwargs)

    def _generate_background(
        self, width: int, height: int, context: str
    ) -> Image.Image:
        """Generate a background image based on context."""
        # Create base background
        bg_colors = {
            "toolbar": (248, 249, 250),
            "dialog": (255, 255, 255),
            "form": (249, 250, 251),
            "card": (255, 255, 255),
            "navbar": (31, 41, 55),
            "sidebar": (243, 244, 246),
            "modal": (255, 255, 255),
            "floating": (255, 255, 255),
        }

        bg_color = bg_colors.get(context, (255, 255, 255))
        img = Image.new("RGB", (width, height), bg_color)
        draw = ImageDraw.Draw(img)

        # Add context-specific elements
        if context == "toolbar":
            # Add toolbar border
            draw.line(
                [(0, height - 1), (width, height - 1)], fill=(209, 213, 219), width=1
            )

        elif context == "dialog":
            # Add dialog border
            draw.rectangle(
                [0, 0, width - 1, height - 1], outline=(209, 213, 219), width=1
            )
            # Title bar
            draw.rectangle([0, 0, width, 40], fill=(243, 244, 246))

        elif context == "card":
            # Card with shadow
            draw.rectangle(
                [0, 0, width - 1, height - 1], outline=(229, 231, 235), width=1
            )

        elif context == "navbar":
            # Dark navbar
            pass  # Already dark

        elif context == "modal":
            # Semi-transparent overlay effect (simulated with gray border)
            draw.rectangle(
                [0, 0, width - 1, height - 1], outline=(156, 163, 175), width=2
            )

        return img

    def generate_sample(self, split: str = "train", num_buttons: int = None) -> dict:
        """
        Generate a single screenshot sample with buttons.

        Args:
            split: Dataset split (train/val/test)
            num_buttons: Number of buttons to generate (random if None)

        Returns:
            Dictionary with image info and annotations
        """
        if num_buttons is None:
            num_buttons = random.randint(1, 6)

        # Generate image dimensions
        img_width = random.randint(600, 1200)
        img_height = random.randint(400, 800)

        # Select context
        context = random.choice(self.CONTEXTS)

        # Generate background
        img = self._generate_background(img_width, img_height, context)
        draw = ImageDraw.Draw(img)

        # Generate buttons
        annotations = []
        placed_buttons = []

        for _i in range(num_buttons):
            # Button properties
            size_name = random.choice(list(self.SIZES.keys()))
            width, height = self.SIZES[size_name]
            style = random.choice(self.STYLES)
            color_name = random.choice(list(self.COLORS.keys()))
            color = self.COLORS[color_name]
            shape = random.choice(self.SHAPES)
            state = random.choice(self.STATES)
            label = random.choice(self.LABELS)

            # Add some variation to size
            width = int(width * random.uniform(0.8, 1.2))
            height = int(height * random.uniform(0.9, 1.1))

            # Find non-overlapping position
            max_attempts = 50
            for _attempt in range(max_attempts):
                x = random.randint(20, img_width - width - 20)
                y = random.randint(20, img_height - height - 20)

                # Check for overlap
                overlap = False
                for bx, by, bw, bh in placed_buttons:
                    if not (
                        x + width < bx or x > bx + bw or y + height < by or y > by + bh
                    ):
                        overlap = True
                        break

                if not overlap:
                    break
            else:
                # Skip if we couldn't find a position
                continue

            # Draw button
            self._draw_button(
                draw, x, y, width, height, style, color, shape, state, label
            )

            # Record button position
            placed_buttons.append((x, y, width, height))

            # Create annotation
            annotation = {
                "id": self.annotation_id,
                "image_id": self.image_id,
                "category_id": 1,
                "bbox": [x, y, width, height],
                "area": width * height,
                "iscrowd": 0,
                "attributes": {
                    "size": size_name,
                    "style": style,
                    "color": color_name,
                    "shape": shape,
                    "state": state,
                    "label": label,
                    "context": context,
                },
            }
            annotations.append(annotation)
            self.annotation_id += 1

        # Save image
        filename = f"button_{self.image_id:06d}.png"
        filepath = self.images_dir / split / filename
        img.save(filepath)

        # Create image info
        image_info = {
            "id": self.image_id,
            "file_name": filename,
            "width": img_width,
            "height": img_height,
            "date_captured": datetime.now().isoformat(),
            "context": context,
        }

        self.image_id += 1

        return {"image": image_info, "annotations": annotations}

    def generate_dataset(
        self,
        num_samples: int,
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15,
    ) -> dict[str, int]:
        """
        Generate a complete dataset.

        Args:
            num_samples: Total number of samples to generate
            train_ratio: Proportion for training set
            val_ratio: Proportion for validation set
            test_ratio: Proportion for test set

        Returns:
            Statistics about the generated dataset
        """
        assert (
            abs(train_ratio + val_ratio + test_ratio - 1.0) < 0.01
        ), "Split ratios must sum to 1.0"

        num_train = int(num_samples * train_ratio)
        num_val = int(num_samples * val_ratio)
        num_test = num_samples - num_train - num_val

        print(f"Generating dataset: {num_train} train, {num_val} val, {num_test} test")

        stats = {
            "train": {"samples": 0, "buttons": 0},
            "val": {"samples": 0, "buttons": 0},
            "test": {"samples": 0, "buttons": 0},
        }

        # Generate training samples
        print("\nGenerating training samples...")
        for i in range(num_train):
            result = self.generate_sample("train")
            self.datasets["train"]["images"].append(result["image"])
            self.datasets["train"]["annotations"].extend(result["annotations"])
            stats["train"]["samples"] += 1
            stats["train"]["buttons"] += len(result["annotations"])

            if (i + 1) % 100 == 0:
                print(f"  Generated {i + 1}/{num_train} training samples")

        # Generate validation samples
        print("\nGenerating validation samples...")
        for i in range(num_val):
            result = self.generate_sample("val")
            self.datasets["val"]["images"].append(result["image"])
            self.datasets["val"]["annotations"].extend(result["annotations"])
            stats["val"]["samples"] += 1
            stats["val"]["buttons"] += len(result["annotations"])

            if (i + 1) % 50 == 0:
                print(f"  Generated {i + 1}/{num_val} validation samples")

        # Generate test samples
        print("\nGenerating test samples...")
        for i in range(num_test):
            result = self.generate_sample("test")
            self.datasets["test"]["images"].append(result["image"])
            self.datasets["test"]["annotations"].extend(result["annotations"])
            stats["test"]["samples"] += 1
            stats["test"]["buttons"] += len(result["annotations"])

            if (i + 1) % 50 == 0:
                print(f"  Generated {i + 1}/{num_test} test samples")

        # Save annotations
        print("\nSaving annotations...")
        for split in ["train", "val", "test"]:
            annotation_file = self.annotations_dir / f"{split}.json"
            with open(annotation_file, "w") as f:
                json.dump(self.datasets[split], f, indent=2)

        # Save metadata
        metadata = {
            "created": datetime.now().isoformat(),
            "total_samples": num_samples,
            "total_buttons": sum(s["buttons"] for s in stats.values()),
            "splits": stats,
            "categories": {
                "sizes": list(self.SIZES.keys()),
                "styles": self.STYLES,
                "colors": list(self.COLORS.keys()),
                "shapes": self.SHAPES,
                "states": self.STATES,
                "contexts": self.CONTEXTS,
            },
        }

        metadata_file = self.output_dir / "metadata.json"
        with open(metadata_file, "w") as f:
            json.dump(metadata, f, indent=2)

        print("\nDataset generation complete!")
        return stats


def main():
    """CLI interface for dataset generation."""
    import argparse

    parser = argparse.ArgumentParser(description="Generate button detection dataset")
    parser.add_argument(
        "--num-samples",
        type=int,
        default=1000,
        help="Total number of samples to generate (default: 1000)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="datasets/buttons",
        help="Output directory (default: datasets/buttons)",
    )
    parser.add_argument(
        "--train-ratio",
        type=float,
        default=0.7,
        help="Training set ratio (default: 0.7)",
    )
    parser.add_argument(
        "--val-ratio",
        type=float,
        default=0.15,
        help="Validation set ratio (default: 0.15)",
    )
    parser.add_argument(
        "--test-ratio", type=float, default=0.15, help="Test set ratio (default: 0.15)"
    )

    args = parser.parse_args()

    # Create generator
    generator = ButtonDatasetGenerator(args.output_dir)

    # Generate dataset
    stats = generator.generate_dataset(
        num_samples=args.num_samples,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        test_ratio=args.test_ratio,
    )

    # Print statistics
    print("\n" + "=" * 60)
    print("DATASET STATISTICS")
    print("=" * 60)

    total_samples = sum(s["samples"] for s in stats.values())
    total_buttons = sum(s["buttons"] for s in stats.values())

    print(f"\nTotal Samples: {total_samples}")
    print(f"Total Buttons: {total_buttons}")
    print(f"Average Buttons per Sample: {total_buttons / total_samples:.2f}")

    print("\nSplit Distribution:")
    for split, data in stats.items():
        print(
            f"  {split.upper():5s}: {data['samples']:4d} samples, "
            f"{data['buttons']:4d} buttons "
            f"({data['buttons'] / total_buttons * 100:5.1f}%)"
        )

    print(f"\nDataset saved to: {args.output_dir}")
    print("=" * 60)


if __name__ == "__main__":
    main()
