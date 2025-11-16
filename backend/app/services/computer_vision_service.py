"""
Computer Vision Service for screenshot analysis and StateImage extraction.

Provides functionality for:
- Perceptual hashing of screenshots
- Visual similarity comparison
- State change detection
- Stable UI region extraction
"""

import io
from typing import BinaryIO

import cv2
import imagehash
import numpy as np
import structlog
from PIL import Image

from app.core.config import settings
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class ComputerVisionService:
    """Service for analyzing screenshots and extracting visual patterns."""

    def __init__(self):
        self.storage = object_storage

    async def generate_perceptual_hash(self, image_bytes: bytes) -> str:
        """
        Generate perceptual hash (pHash) for an image.

        Args:
            image_bytes: Image data as bytes

        Returns:
            64-bit hash as hex string

        Raises:
            ValueError: If image cannot be loaded or processed
        """
        try:
            # Load image from bytes
            image = Image.open(io.BytesIO(image_bytes))

            # Convert to RGB if necessary (handles RGBA, grayscale, etc.)
            if image.mode != "RGB":
                image = image.convert("RGB")

            # Generate perceptual hash
            phash = imagehash.phash(image, hash_size=8)

            # Convert to hex string
            hash_str = str(phash)

            logger.debug(
                "generated_perceptual_hash",
                hash=hash_str,
                image_size=image.size,
                image_mode=image.mode,
            )

            return hash_str

        except Exception as e:
            logger.error(
                "failed_to_generate_hash",
                error=str(e),
                error_type=type(e).__name__,
            )
            raise ValueError(f"Failed to generate perceptual hash: {str(e)}") from e

    async def calculate_similarity(self, hash1: str, hash2: str) -> float:
        """
        Calculate visual similarity between two screenshots.

        Args:
            hash1, hash2: Perceptual hash hex strings

        Returns:
            0.0 (completely different) to 1.0 (identical)

        Raises:
            ValueError: If hashes are invalid
        """
        try:
            # Convert hex strings back to imagehash objects
            ihash1 = imagehash.hex_to_hash(hash1)
            ihash2 = imagehash.hex_to_hash(hash2)

            # Calculate Hamming distance (number of differing bits)
            hamming_distance = ihash1 - ihash2

            # Normalize to similarity score (0.0 to 1.0)
            # Max distance for 8x8 hash is 64 bits
            max_distance = len(ihash1.hash.flatten())
            similarity = 1.0 - (hamming_distance / max_distance)

            logger.debug(
                "calculated_similarity",
                hash1=hash1,
                hash2=hash2,
                hamming_distance=hamming_distance,
                similarity=similarity,
            )

            return similarity

        except Exception as e:
            logger.error(
                "failed_to_calculate_similarity",
                error=str(e),
                error_type=type(e).__name__,
                hash1=hash1,
                hash2=hash2,
            )
            raise ValueError(f"Failed to calculate similarity: {str(e)}") from e

    async def detect_state_change(
        self,
        screenshot1_bytes: bytes,
        screenshot2_bytes: bytes,
        threshold: float = 0.15,
    ) -> bool:
        """
        Detect if significant visual change occurred.

        Args:
            screenshot1_bytes: First screenshot as bytes
            screenshot2_bytes: Second screenshot as bytes
            threshold: Minimum difference to consider a state change (default 0.15)
                      Lower values = more sensitive to changes

        Returns:
            True if similarity < (1 - threshold), indicating different states

        Raises:
            ValueError: If screenshots cannot be processed
        """
        try:
            # Generate hashes for both screenshots
            hash1 = await self.generate_perceptual_hash(screenshot1_bytes)
            hash2 = await self.generate_perceptual_hash(screenshot2_bytes)

            # Calculate similarity
            similarity = await self.calculate_similarity(hash1, hash2)

            # Detect state change (similarity below threshold means change detected)
            state_changed = similarity < (1.0 - threshold)

            logger.info(
                "state_change_detection",
                similarity=similarity,
                threshold=threshold,
                state_changed=state_changed,
            )

            return state_changed

        except Exception as e:
            logger.error(
                "failed_to_detect_state_change",
                error=str(e),
                error_type=type(e).__name__,
            )
            raise ValueError(f"Failed to detect state change: {str(e)}") from e

    async def find_stable_regions(
        self,
        screenshot_batch: list[bytes],
        min_stability: float = 0.95,
        min_region_size: tuple[int, int] = (20, 20),
    ) -> list[dict]:
        """
        Find UI regions that are stable across multiple screenshots.

        Process:
        1. Convert all screenshots to numpy arrays
        2. Calculate pixel-wise variance across screenshots
        3. Low variance regions = stable UI elements
        4. Extract bounding boxes around stable regions
        5. Generate hash for each region

        Args:
            screenshot_batch: List of screenshot image bytes
            min_stability: Minimum stability score (0.0 to 1.0)
            min_region_size: Minimum width and height for region (width, height)

        Returns:
            List of StateImage candidates with:
                {
                    'x': int, 'y': int,
                    'width': int, 'height': int,
                    'pixel_hash': str,
                    'stability_score': float,
                    'screenshot_indices': list[int]
                }

        Raises:
            ValueError: If screenshots cannot be processed or batch is too small
        """
        try:
            if len(screenshot_batch) < 2:
                raise ValueError("Need at least 2 screenshots to find stable regions")

            logger.info(
                "finding_stable_regions",
                num_screenshots=len(screenshot_batch),
                min_stability=min_stability,
                min_region_size=min_region_size,
            )

            # Convert all screenshots to grayscale numpy arrays
            arrays = []
            for idx, img_bytes in enumerate(screenshot_batch):
                # Load image
                img = Image.open(io.BytesIO(img_bytes))

                # Convert to grayscale for variance calculation
                img_gray = img.convert("L")

                # Convert to numpy array
                arr = np.array(img_gray, dtype=np.float32)
                arrays.append(arr)

                logger.debug(
                    "loaded_screenshot",
                    index=idx,
                    shape=arr.shape,
                )

            # Ensure all images are same size
            shapes = [arr.shape for arr in arrays]
            if len(set(shapes)) > 1:
                logger.warning(
                    "inconsistent_screenshot_sizes",
                    shapes=shapes,
                )
                # Resize all to smallest common dimensions
                min_height = min(s[0] for s in shapes)
                min_width = min(s[1] for s in shapes)
                arrays = [arr[:min_height, :min_width] for arr in arrays]

            # Stack arrays and calculate pixel-wise variance
            stacked = np.stack(arrays, axis=0)
            variance = np.var(stacked, axis=0)

            # Normalize variance to 0-1 range
            if variance.max() > 0:
                variance_normalized = variance / variance.max()
            else:
                variance_normalized = variance

            # Stability score is inverse of variance (low variance = high stability)
            stability_map = 1.0 - variance_normalized

            # Threshold to binary mask of stable pixels
            stable_mask = (stability_map >= min_stability).astype(np.uint8) * 255

            logger.debug(
                "calculated_stability_map",
                stable_pixels=np.sum(stable_mask > 0),
                total_pixels=stable_mask.size,
                stability_percentage=(np.sum(stable_mask > 0) / stable_mask.size) * 100,
            )

            # Find contours (connected regions)
            contours, _ = cv2.findContours(
                stable_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            # Extract bounding boxes and generate region hashes
            stable_regions = []
            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)

                # Filter by minimum size
                if w < min_region_size[0] or h < min_region_size[1]:
                    continue

                # Calculate average stability score for this region
                region_stability = float(np.mean(stability_map[y : y + h, x : x + w]))

                # Extract region from first screenshot for hashing
                first_img = Image.open(io.BytesIO(screenshot_batch[0]))
                region_img = first_img.crop((x, y, x + w, y + h))

                # Generate hash for region
                region_hash = imagehash.phash(region_img, hash_size=8)

                # Find which screenshots contain this stable region
                screenshot_indices = list(range(len(screenshot_batch)))

                stable_regions.append(
                    {
                        "x": int(x),
                        "y": int(y),
                        "width": int(w),
                        "height": int(h),
                        "pixel_hash": str(region_hash),
                        "stability_score": float(region_stability),
                        "screenshot_indices": screenshot_indices,
                    }
                )

            # Sort by stability score (highest first)
            stable_regions.sort(key=lambda r: r["stability_score"], reverse=True)

            logger.info(
                "found_stable_regions",
                num_regions=len(stable_regions),
                avg_stability=(
                    np.mean([r["stability_score"] for r in stable_regions])
                    if stable_regions
                    else 0
                ),
            )

            return stable_regions

        except Exception as e:
            logger.error(
                "failed_to_find_stable_regions",
                error=str(e),
                error_type=type(e).__name__,
            )
            raise ValueError(f"Failed to find stable regions: {str(e)}") from e

    async def download_screenshot_from_s3(self, s3_key: str) -> bytes:
        """
        Download screenshot from S3 and return bytes.

        Args:
            s3_key: S3 object key for the screenshot

        Returns:
            Image data as bytes

        Raises:
            ValueError: If download fails
        """
        try:
            logger.debug("downloading_screenshot", s3_key=s3_key)

            # Use the object storage service to download
            image_bytes = self.storage.download_file(s3_key)

            logger.info(
                "downloaded_screenshot",
                s3_key=s3_key,
                size_bytes=len(image_bytes),
            )

            return image_bytes

        except Exception as e:
            logger.error(
                "failed_to_download_screenshot",
                s3_key=s3_key,
                error=str(e),
                error_type=type(e).__name__,
            )
            raise ValueError(
                f"Failed to download screenshot from S3: {str(e)}"
            ) from e

    async def extract_region_image(
        self, image_bytes: bytes, x: int, y: int, width: int, height: int
    ) -> bytes:
        """
        Extract a specific region from an image.

        Args:
            image_bytes: Source image as bytes
            x, y: Top-left coordinates of region
            width, height: Dimensions of region

        Returns:
            Cropped region as image bytes (PNG format)

        Raises:
            ValueError: If extraction fails
        """
        try:
            # Load image
            image = Image.open(io.BytesIO(image_bytes))

            # Crop region
            region = image.crop((x, y, x + width, y + height))

            # Convert to bytes
            output = io.BytesIO()
            region.save(output, format="PNG")
            region_bytes = output.getvalue()

            logger.debug(
                "extracted_region",
                x=x,
                y=y,
                width=width,
                height=height,
                size_bytes=len(region_bytes),
            )

            return region_bytes

        except Exception as e:
            logger.error(
                "failed_to_extract_region",
                error=str(e),
                error_type=type(e).__name__,
            )
            raise ValueError(f"Failed to extract region: {str(e)}") from e


# Singleton instance
_cv_service: ComputerVisionService | None = None


def get_cv_service() -> ComputerVisionService:
    """Get or create singleton computer vision service instance."""
    global _cv_service
    if _cv_service is None:
        _cv_service = ComputerVisionService()
    return _cv_service
