"""Image processing utilities for pattern matching and optimization."""

import base64
import hashlib
import io

import numpy as np
from fastapi import HTTPException
from PIL import Image


class ImageProcessor:
    """Handles image encoding, decoding, and basic processing operations."""

    @staticmethod
    def decode_base64_to_array(base64_string: str) -> np.ndarray:
        """
        Decode base64 string to numpy array.

        Args:
            base64_string: Base64 encoded image data

        Returns:
            Numpy array representation of the image

        Raises:
            HTTPException: If image data is invalid
        """
        try:
            image_data = base64.b64decode(base64_string)
            image = Image.open(io.BytesIO(image_data))
            return np.array(image)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")

    @staticmethod
    def encode_array_to_base64(image_array: np.ndarray, format: str = "PNG") -> str:
        """
        Encode numpy array to base64 string.

        Args:
            image_array: Numpy array representing an image
            format: Image format (PNG, JPEG, etc.)

        Returns:
            Base64 encoded string
        """
        image = Image.fromarray(image_array.astype("uint8"))
        buffer = io.BytesIO()
        image.save(buffer, format=format)
        return base64.b64encode(buffer.getvalue()).decode()

    @staticmethod
    def extract_region(
        image: np.ndarray, x: int, y: int, width: int, height: int
    ) -> np.ndarray:
        """
        Extract a rectangular region from an image.

        Args:
            image: Source image as numpy array
            x: X coordinate of top-left corner
            y: Y coordinate of top-left corner
            width: Width of region
            height: Height of region

        Returns:
            Extracted region as numpy array
        """
        return image[y : y + height, x : x + width]

    @staticmethod
    def validate_base64_image(base64_string: str) -> tuple[bool, str]:
        """
        Validate base64 image data.

        Args:
            base64_string: Base64 encoded image string

        Returns:
            Tuple of (is_valid, error_message)
        """
        try:
            base64.b64decode(base64_string)
            return (True, "")
        except Exception as e:
            return (False, f"Invalid base64: {str(e)}")

    @staticmethod
    def calculate_hash(base64_string: str) -> str:
        """
        Calculate SHA256 hash of base64 image data.

        Args:
            base64_string: Base64 encoded image string

        Returns:
            Hexadecimal hash string
        """
        return hashlib.sha256(base64_string.encode()).hexdigest()

    @staticmethod
    def calculate_similarity(pattern1: np.ndarray, pattern2: np.ndarray) -> float:
        """
        Calculate similarity between two patterns using normalized correlation.

        Args:
            pattern1: First pattern as numpy array
            pattern2: Second pattern as numpy array

        Returns:
            Similarity score between 0.0 and 1.0
        """
        try:
            # Resize patterns to same size if needed
            if pattern1.shape != pattern2.shape:
                h = min(pattern1.shape[0], pattern2.shape[0])
                w = min(pattern1.shape[1], pattern2.shape[1])
                pattern1 = Image.fromarray(pattern1).resize((w, h))
                pattern2 = Image.fromarray(pattern2).resize((w, h))
                pattern1 = np.array(pattern1)
                pattern2 = np.array(pattern2)

            # Calculate normalized correlation
            pattern1_flat = pattern1.flatten().astype(float)
            pattern2_flat = pattern2.flatten().astype(float)

            # Normalize
            pattern1_flat = (pattern1_flat - np.mean(pattern1_flat)) / (
                np.std(pattern1_flat) + 1e-10
            )
            pattern2_flat = (pattern2_flat - np.mean(pattern2_flat)) / (
                np.std(pattern2_flat) + 1e-10
            )

            # Calculate correlation
            correlation = np.corrcoef(pattern1_flat, pattern2_flat)[0, 1]

            # Convert to similarity score (0-1)
            similarity = (correlation + 1) / 2
            return float(similarity)
        except Exception:
            # Return neutral similarity on error
            return 0.5
