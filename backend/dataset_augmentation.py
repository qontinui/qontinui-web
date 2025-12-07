"""
Data Augmentation Pipeline

Apply transformations to expand and diversify the training dataset.
Includes rotation, scaling, color jitter, noise, blur, and resolution simulation.
"""

import json
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


class DatasetAugmenter:
    """Data augmentation pipeline for button detection datasets."""

    def __init__(self, input_dir: str, output_dir: str):
        """
        Initialize the augmenter.

        Args:
            input_dir: Input dataset directory
            output_dir: Output directory for augmented dataset
        """
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)

        # Create output structure
        for split in ["train", "val", "test"]:
            (self.output_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (self.output_dir / "annotations").mkdir(parents=True, exist_ok=True)

        self.image_id_offset = 1000000
        self.annotation_id_offset = 1000000

    def load_dataset(self, split: str) -> dict:
        """Load COCO format dataset."""
        annotation_file = self.input_dir / "annotations" / f"{split}.json"

        if not annotation_file.exists():
            return None

        with open(annotation_file) as f:
            return json.load(f)

    def save_dataset(self, dataset: dict, split: str):
        """Save COCO format dataset."""
        annotation_file = self.output_dir / "annotations" / f"{split}.json"
        with open(annotation_file, "w") as f:
            json.dump(dataset, f, indent=2)

    def rotate_image(
        self, image: Image.Image, angle: float, annotations: list[dict]
    ) -> tuple[Image.Image, list[dict]]:
        """
        Rotate image and update bounding boxes.

        Args:
            image: Input image
            angle: Rotation angle in degrees
            annotations: List of annotations

        Returns:
            Rotated image and updated annotations
        """
        # Convert PIL to OpenCV
        img_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        height, width = img_cv.shape[:2]

        # Get rotation matrix
        center = (width / 2, height / 2)
        rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)

        # Calculate new image size
        cos = np.abs(rotation_matrix[0, 0])
        sin = np.abs(rotation_matrix[0, 1])
        new_width = int((height * sin) + (width * cos))
        new_height = int((height * cos) + (width * sin))

        # Adjust rotation matrix for new size
        rotation_matrix[0, 2] += (new_width / 2) - center[0]
        rotation_matrix[1, 2] += (new_height / 2) - center[1]

        # Rotate image
        rotated = cv2.warpAffine(
            img_cv,
            rotation_matrix,
            (new_width, new_height),
            borderValue=(255, 255, 255),
        )

        # Convert back to PIL
        rotated_pil = Image.fromarray(cv2.cvtColor(rotated, cv2.COLOR_BGR2RGB))

        # Update annotations
        new_annotations = []
        for ann in annotations:
            x, y, w, h = ann["bbox"]

            # Get box corners
            corners = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])

            # Add ones for affine transformation
            corners_homogeneous = np.hstack([corners, np.ones((4, 1))])

            # Transform corners
            transformed = rotation_matrix @ corners_homogeneous.T
            transformed = transformed.T

            # Get new bounding box
            x_coords = transformed[:, 0]
            y_coords = transformed[:, 1]

            new_x = max(0, int(np.min(x_coords)))
            new_y = max(0, int(np.min(y_coords)))
            new_w = min(new_width - new_x, int(np.max(x_coords) - new_x))
            new_h = min(new_height - new_y, int(np.max(y_coords) - new_y))

            # Only keep if box is valid
            if new_w > 10 and new_h > 10:
                new_ann = ann.copy()
                new_ann["bbox"] = [new_x, new_y, new_w, new_h]
                new_ann["area"] = new_w * new_h
                new_annotations.append(new_ann)

        return rotated_pil, new_annotations

    def scale_image(
        self, image: Image.Image, scale_factor: float, annotations: list[dict]
    ) -> tuple[Image.Image, list[dict]]:
        """
        Scale image and update bounding boxes.

        Args:
            image: Input image
            scale_factor: Scale factor (e.g., 0.8 or 1.2)
            annotations: List of annotations

        Returns:
            Scaled image and updated annotations
        """
        width, height = image.size
        new_width = int(width * scale_factor)
        new_height = int(height * scale_factor)

        # Scale image
        scaled = image.resize((new_width, new_height), Image.LANCZOS)

        # Update annotations
        new_annotations = []
        for ann in annotations:
            x, y, w, h = ann["bbox"]

            new_ann = ann.copy()
            new_ann["bbox"] = [
                int(x * scale_factor),
                int(y * scale_factor),
                int(w * scale_factor),
                int(h * scale_factor),
            ]
            new_ann["area"] = int(new_ann["bbox"][2] * new_ann["bbox"][3])
            new_annotations.append(new_ann)

        return scaled, new_annotations

    def color_jitter(
        self,
        image: Image.Image,
        brightness: float = 0.2,
        contrast: float = 0.2,
        saturation: float = 0.2,
    ) -> Image.Image:
        """
        Apply color jittering.

        Args:
            image: Input image
            brightness: Brightness variation range
            contrast: Contrast variation range
            saturation: Saturation variation range

        Returns:
            Color-jittered image
        """
        # Random brightness
        brightness_factor = 1.0 + random.uniform(-brightness, brightness)
        enhancer = ImageEnhance.Brightness(image)
        image = enhancer.enhance(brightness_factor)

        # Random contrast
        contrast_factor = 1.0 + random.uniform(-contrast, contrast)
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(contrast_factor)

        # Random saturation
        saturation_factor = 1.0 + random.uniform(-saturation, saturation)
        enhancer = ImageEnhance.Color(image)
        image = enhancer.enhance(saturation_factor)

        return image

    def add_noise(self, image: Image.Image, noise_level: float = 0.02) -> Image.Image:
        """
        Add Gaussian noise to image.

        Args:
            image: Input image
            noise_level: Noise intensity (0-1)

        Returns:
            Noisy image
        """
        img_array = np.array(image).astype(np.float32) / 255.0

        # Generate noise
        noise = np.random.normal(0, noise_level, img_array.shape)
        noisy = img_array + noise

        # Clip values
        noisy = np.clip(noisy, 0, 1)
        noisy = (noisy * 255).astype(np.uint8)

        return Image.fromarray(noisy)

    def add_blur(self, image: Image.Image, blur_radius: float = 1.5) -> Image.Image:
        """
        Apply Gaussian blur.

        Args:
            image: Input image
            blur_radius: Blur radius

        Returns:
            Blurred image
        """
        return image.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    def simulate_resolution(
        self, image: Image.Image, scale: float = 0.5
    ) -> Image.Image:
        """
        Simulate different screen resolutions by downscaling and upscaling.

        Args:
            image: Input image
            scale: Downscale factor

        Returns:
            Resolution-simulated image
        """
        width, height = image.size
        new_width = int(width * scale)
        new_height = int(height * scale)

        # Downscale
        downscaled = image.resize((new_width, new_height), Image.LANCZOS)

        # Upscale back
        upscaled = downscaled.resize((width, height), Image.LANCZOS)

        return upscaled

    def flip_horizontal(
        self, image: Image.Image, annotations: list[dict]
    ) -> tuple[Image.Image, list[dict]]:
        """
        Flip image horizontally and update bounding boxes.

        Args:
            image: Input image
            annotations: List of annotations

        Returns:
            Flipped image and updated annotations
        """
        width = image.size[0]
        flipped = image.transpose(Image.FLIP_LEFT_RIGHT)

        # Update annotations
        new_annotations = []
        for ann in annotations:
            x, y, w, h = ann["bbox"]

            new_ann = ann.copy()
            new_ann["bbox"] = [width - x - w, y, w, h]
            new_annotations.append(new_ann)

        return flipped, new_annotations

    def augment_image(
        self, image_path: str, annotations: list[dict], augmentation_config: dict
    ) -> list[tuple[Image.Image, list[dict], str]]:
        """
        Apply augmentation pipeline to a single image.

        Args:
            image_path: Path to image
            annotations: List of annotations
            augmentation_config: Configuration for augmentations

        Returns:
            List of (augmented_image, updated_annotations, aug_type) tuples
        """
        image = Image.open(image_path)
        results = []

        # Original
        results.append((image.copy(), annotations.copy(), "original"))

        # Horizontal flip
        if augmentation_config.get("flip_horizontal", True):
            flipped, flipped_anns = self.flip_horizontal(image, annotations)
            results.append((flipped, flipped_anns, "flip_h"))

        # Rotation
        if augmentation_config.get("rotation", True):
            angles = augmentation_config.get("rotation_angles", [-10, -5, 5, 10])
            for angle in angles:
                rotated, rotated_anns = self.rotate_image(image, angle, annotations)
                results.append((rotated, rotated_anns, f"rot_{angle}"))

        # Scaling
        if augmentation_config.get("scaling", True):
            scales = augmentation_config.get("scale_factors", [0.9, 1.1])
            for scale in scales:
                scaled, scaled_anns = self.scale_image(image, scale, annotations)
                results.append((scaled, scaled_anns, f"scale_{scale}"))

        # Color jittering
        if augmentation_config.get("color_jitter", True):
            for i in range(augmentation_config.get("color_jitter_count", 2)):
                jittered = self.color_jitter(image.copy())
                results.append((jittered, annotations.copy(), f"color_jitter_{i}"))

        # Noise
        if augmentation_config.get("noise", True):
            noise_levels = augmentation_config.get("noise_levels", [0.01, 0.02])
            for i, level in enumerate(noise_levels):
                noisy = self.add_noise(image.copy(), level)
                results.append((noisy, annotations.copy(), f"noise_{i}"))

        # Blur
        if augmentation_config.get("blur", True):
            blur_radii = augmentation_config.get("blur_radii", [1.0, 2.0])
            for i, radius in enumerate(blur_radii):
                blurred = self.add_blur(image.copy(), radius)
                results.append((blurred, annotations.copy(), f"blur_{i}"))

        # Resolution simulation
        if augmentation_config.get("resolution", True):
            res_scales = augmentation_config.get("resolution_scales", [0.5, 0.7])
            for i, scale in enumerate(res_scales):
                sim_res = self.simulate_resolution(image.copy(), scale)
                results.append((sim_res, annotations.copy(), f"res_{i}"))

        return results

    def augment_dataset(
        self,
        split: str = "train",
        augmentation_config: dict | None = None,
        max_augmentations_per_image: int = None,
    ) -> dict[str, int]:
        """
        Augment entire dataset.

        Args:
            split: Dataset split to augment
            augmentation_config: Augmentation configuration
            max_augmentations_per_image: Maximum number of augmentations per image

        Returns:
            Statistics
        """
        if augmentation_config is None:
            augmentation_config = {
                "flip_horizontal": True,
                "rotation": True,
                "rotation_angles": [-5, 5],
                "scaling": True,
                "scale_factors": [0.9, 1.1],
                "color_jitter": True,
                "color_jitter_count": 2,
                "noise": True,
                "noise_levels": [0.01],
                "blur": True,
                "blur_radii": [1.0],
                "resolution": True,
                "resolution_scales": [0.6],
            }

        # Load dataset
        dataset = self.load_dataset(split)
        if not dataset:
            print(f"No dataset found for {split}")
            return {}

        # Create output dataset
        output_dataset = {
            "info": dataset["info"].copy(),
            "licenses": dataset["licenses"].copy(),
            "categories": dataset["categories"].copy(),
            "images": [],
            "annotations": [],
        }

        stats = {
            "original_images": len(dataset["images"]),
            "augmented_images": 0,
            "total_images": 0,
            "original_annotations": len(dataset["annotations"]),
            "augmented_annotations": 0,
            "total_annotations": 0,
        }

        print(f"Augmenting {split} dataset...")

        for img_idx, image_info in enumerate(dataset["images"]):
            # Get image annotations
            image_id = image_info["id"]
            anns = [a for a in dataset["annotations"] if a["image_id"] == image_id]

            # Get image path
            image_path = self.input_dir / "images" / split / image_info["file_name"]

            if not image_path.exists():
                print(f"Warning: Image not found: {image_path}")
                continue

            # Apply augmentations
            augmented = self.augment_image(str(image_path), anns, augmentation_config)

            # Limit number of augmentations if specified
            if max_augmentations_per_image:
                augmented = augmented[
                    : max_augmentations_per_image + 1
                ]  # +1 for original

            # Save augmented images
            for aug_idx, (aug_image, aug_anns, aug_type) in enumerate(augmented):
                # Generate new IDs
                new_image_id = self.image_id_offset + img_idx * 1000 + aug_idx
                new_filename = f"aug_{new_image_id:08d}_{aug_type}.png"

                # Save image
                output_path = self.output_dir / "images" / split / new_filename
                aug_image.save(output_path)

                # Create new image info
                new_image_info = image_info.copy()
                new_image_info["id"] = new_image_id
                new_image_info["file_name"] = new_filename
                new_image_info["width"] = aug_image.size[0]
                new_image_info["height"] = aug_image.size[1]
                new_image_info["augmentation"] = aug_type
                new_image_info["source_image_id"] = image_id

                output_dataset["images"].append(new_image_info)

                # Create new annotations
                for ann in aug_anns:
                    new_ann = ann.copy()
                    new_ann["id"] = self.annotation_id_offset + len(
                        output_dataset["annotations"]
                    )
                    new_ann["image_id"] = new_image_id

                    output_dataset["annotations"].append(new_ann)

                if aug_type == "original":
                    stats["total_images"] += 1
                    stats["total_annotations"] += len(aug_anns)
                else:
                    stats["augmented_images"] += 1
                    stats["augmented_annotations"] += len(aug_anns)
                    stats["total_images"] += 1
                    stats["total_annotations"] += len(aug_anns)

            if (img_idx + 1) % 100 == 0:
                print(f"  Processed {img_idx + 1}/{len(dataset['images'])} images")

        # Save augmented dataset
        self.save_dataset(output_dataset, split)

        print(f"\nAugmentation complete for {split}")
        return stats


def main():
    """CLI interface for dataset augmentation."""
    import argparse

    parser = argparse.ArgumentParser(description="Augment button detection dataset")
    parser.add_argument(
        "--input-dir", type=str, required=True, help="Input dataset directory"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        required=True,
        help="Output directory for augmented dataset",
    )
    parser.add_argument(
        "--split",
        type=str,
        default="train",
        choices=["train", "val", "test"],
        help="Dataset split to augment (default: train)",
    )
    parser.add_argument(
        "--max-augmentations",
        type=int,
        default=None,
        help="Maximum augmentations per image (default: all)",
    )

    args = parser.parse_args()

    # Create augmenter
    augmenter = DatasetAugmenter(args.input_dir, args.output_dir)

    # Augment dataset
    stats = augmenter.augment_dataset(
        args.split, max_augmentations_per_image=args.max_augmentations
    )

    # Print statistics
    print("\n" + "=" * 60)
    print("AUGMENTATION STATISTICS")
    print("=" * 60)
    print(f"Original images: {stats['original_images']}")
    print(f"Augmented images: {stats['augmented_images']}")
    print(f"Total images: {stats['total_images']}")
    print(
        f"Augmentation factor: {stats['total_images'] / stats['original_images']:.2f}x"
    )
    print(f"\nOriginal annotations: {stats['original_annotations']}")
    print(f"Augmented annotations: {stats['augmented_annotations']}")
    print(f"Total annotations: {stats['total_annotations']}")
    print(f"\nDataset saved to: {args.output_dir}")
    print("=" * 60)


if __name__ == "__main__":
    main()
