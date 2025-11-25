"""
Frame analysis service for automated state discovery

This service handles:
- Downloading frames from S3
- Computing perceptual hashes
- Calculating frame similarity
- Detecting stable vs volatile regions

ARCHITECTURE WARNING - CV DUPLICATION
======================================
This service reimplements heavy computer vision operations that already exist
in the qontinui library. This was done for web service prototyping but creates
maintenance burden and duplicates complex CV logic.

DUPLICATE CV OPERATIONS IN THIS FILE:
--------------------------------------
1. PERCEPTUAL HASHING (lines 50-67)
   - compute_perceptual_hash(): Uses imagehash library for dhash
   - Library equivalent: qontinui has optimized hash utilities
   - Should delegate to library

2. HASH SIMILARITY (lines 69-96)
   - calculate_hash_similarity(): Computes Hamming distance between hashes
   - Library equivalent: Built into library's comparison utilities
   - Should delegate to library

3. IMAGE SIMILARITY METRICS (lines 98-161)
   - calculate_image_similarity(): SSIM, MSE, histogram correlation
   - Library equivalent: qontinui has comprehensive similarity functions
   - Should delegate to library

4. PIXEL STABILITY ANALYSIS (lines 163-216)
   - detect_stable_regions(): Per-pixel variance analysis across frames
   - Library equivalent: PixelStabilityAnalyzer in qontinui library
   - Should delegate to library's PixelStabilityAnalyzer

5. REGION EXTRACTION (lines 218-277)
   - _extract_regions(): Connected component analysis on masks
   - Library equivalent: DifferentialConsistencyDetector handles this
   - Should delegate to library

6. DBSCAN CLUSTERING (lines 338-401)
   - cluster_frames_by_similarity(): DBSCAN on perceptual hashes
   - Library equivalent: Library has clustering implementations
   - Should delegate to library

MIGRATION STRATEGY
==================
These CV operations should be:
1. Removed from web service
2. Submitted as jobs/tasks to qontinui library
3. Run via local runner (not in web process)
4. Results stored back to database

Web service should focus on: S3 operations, database persistence, API responses
"""

import io
from typing import List, Tuple, Dict, Any, Optional
import numpy as np
from PIL import Image
import imagehash
import structlog
from sklearn.cluster import DBSCAN
from scipy.spatial.distance import hamming
import cv2

from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class FrameAnalysisService:
    """Service for analyzing video frames to identify states"""

    def __init__(self):
        self.storage = object_storage

    async def download_frame(self, s3_key: str) -> Optional[Image.Image]:
        """
        Download frame from S3 and return as PIL Image

        Args:
            s3_key: S3 key for the frame

        Returns:
            PIL Image or None if download fails
        """
        try:
            frame_bytes = self.storage.download_file(s3_key)
            image = Image.open(io.BytesIO(frame_bytes))
            return image
        except Exception as e:
            logger.error(f"Failed to download frame: {s3_key}", error=str(e))
            return None

    def compute_perceptual_hash(self, image: Image.Image, hash_size: int = 16) -> str:
        """
        Compute perceptual hash (pHash) for an image

        TODO [ARCHITECTURE]: Delegate to qontinui library
        - Library has optimized perceptual hashing utilities
        - Should call library functions instead of direct imagehash usage

        Args:
            image: PIL Image
            hash_size: Size of hash (default 16x16 = 256 bits)

        Returns:
            Hex string representation of hash
        """
        try:
            # Use difference hash (dHash) - fast and effective
            dhash = imagehash.dhash(image, hash_size=hash_size)
            return str(dhash)
        except Exception as e:
            logger.error("Failed to compute perceptual hash", error=str(e))
            return ""

    def calculate_hash_similarity(self, hash1: str, hash2: str) -> float:
        """
        Calculate similarity between two perceptual hashes

        Args:
            hash1: First hash (hex string)
            hash2: Second hash (hex string)

        Returns:
            Similarity score (0.0 = completely different, 1.0 = identical)
        """
        try:
            # Convert hex strings to imagehash objects
            h1 = imagehash.hex_to_hash(hash1)
            h2 = imagehash.hex_to_hash(hash2)

            # Calculate Hamming distance
            distance = h1 - h2

            # Convert to similarity (0-1 scale)
            max_distance = len(hash1) * 4  # Each hex char = 4 bits
            similarity = 1.0 - (distance / max_distance)

            return similarity

        except Exception as e:
            logger.error("Failed to calculate hash similarity", error=str(e))
            return 0.0

    def calculate_image_similarity(self, img1: Image.Image, img2: Image.Image) -> Dict[str, float]:
        """
        Calculate multiple similarity metrics between two images

        TODO [ARCHITECTURE]: Delegate to qontinui library
        - Library has comprehensive similarity comparison functions
        - SSIM, MSE, histogram analysis should use library implementations
        - Avoid reimplementing these heavy CV operations

        Args:
            img1: First image
            img2: Second image

        Returns:
            Dict with similarity metrics
        """
        try:
            # Ensure images are same size
            if img1.size != img2.size:
                img2 = img2.resize(img1.size, Image.LANCZOS)

            # Convert to numpy arrays
            arr1 = np.array(img1)
            arr2 = np.array(img2)

            # Convert to grayscale for some metrics
            if len(arr1.shape) == 3:
                gray1 = cv2.cvtColor(arr1, cv2.COLOR_RGB2GRAY)
                gray2 = cv2.cvtColor(arr2, cv2.COLOR_RGB2GRAY)
            else:
                gray1 = arr1
                gray2 = arr2

            # 1. Structural Similarity Index (SSIM)
            from skimage.metrics import structural_similarity as ssim
            ssim_score = ssim(gray1, gray2)

            # 2. Mean Squared Error (MSE) - converted to similarity
            mse = np.mean((arr1.astype(float) - arr2.astype(float)) ** 2)
            mse_similarity = 1.0 / (1.0 + mse / 1000.0)  # Normalize

            # 3. Histogram correlation
            hist1 = cv2.calcHist([gray1], [0], None, [256], [0, 256])
            hist2 = cv2.calcHist([gray2], [0], None, [256], [0, 256])
            hist_correlation = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)

            # 4. Perceptual hash similarity
            phash_sim = self.calculate_hash_similarity(
                self.compute_perceptual_hash(img1),
                self.compute_perceptual_hash(img2)
            )

            return {
                "ssim": float(ssim_score),
                "mse_similarity": float(mse_similarity),
                "histogram_correlation": float(hist_correlation),
                "perceptual_hash": float(phash_sim),
                "combined": float((ssim_score + hist_correlation + phash_sim) / 3.0)
            }

        except Exception as e:
            logger.error("Failed to calculate image similarity", error=str(e))
            return {
                "ssim": 0.0,
                "mse_similarity": 0.0,
                "histogram_correlation": 0.0,
                "perceptual_hash": 0.0,
                "combined": 0.0
            }

    def detect_stable_regions(
        self,
        images: List[Image.Image],
        threshold: float = 0.95
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Detect stable and volatile regions across multiple images

        TODO [ARCHITECTURE]: CRITICAL - Delegate to qontinui library
        - This is pixel stability analysis, core functionality of PixelStabilityAnalyzer
        - Library's PixelStabilityAnalyzer performs this exact per-pixel variance analysis
        - Direct duplication of library logic - should be removed from web service
        - Submit frames to library's analyzer instead

        Args:
            images: List of PIL Images (should be visually similar frames)
            threshold: Similarity threshold for stable regions (0.0-1.0)

        Returns:
            Tuple of (stable_regions, volatile_regions)
        """
        if len(images) < 2:
            return [], []

        try:
            # Convert all images to same size
            base_size = images[0].size
            normalized_images = []
            for img in images:
                if img.size != base_size:
                    normalized_images.append(img.resize(base_size, Image.LANCZOS))
                else:
                    normalized_images.append(img)

            # Convert to numpy arrays
            arrays = [np.array(img) for img in normalized_images]

            # Calculate per-pixel variance across all images
            stacked = np.stack(arrays, axis=0)
            variance = np.var(stacked, axis=0)

            # Average variance across color channels if RGB
            if len(variance.shape) == 3:
                variance = np.mean(variance, axis=2)

            # Threshold: low variance = stable, high variance = volatile
            variance_threshold = np.percentile(variance, 90)  # Top 10% most variable

            stable_mask = variance < variance_threshold
            volatile_mask = variance >= variance_threshold

            # Find connected regions
            stable_regions = self._extract_regions(stable_mask, base_size)
            volatile_regions = self._extract_regions(volatile_mask, base_size)

            return stable_regions, volatile_regions

        except Exception as e:
            logger.error("Failed to detect stable regions", error=str(e))
            return [], []

    def _extract_regions(
        self,
        mask: np.ndarray,
        image_size: Tuple[int, int],
        min_area: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Extract bounding box regions from a binary mask

        TODO [ARCHITECTURE]: Delegate to qontinui library
        - Region extraction from masks is handled by DifferentialConsistencyDetector
        - Library has optimized region detection algorithms
        - Should use library's region detection instead

        Args:
            mask: Binary mask (True = region of interest)
            image_size: Original image size (width, height)
            min_area: Minimum area for a region to be included

        Returns:
            List of region dictionaries with bounding boxes
        """
        try:
            # Convert mask to uint8 for OpenCV
            mask_uint8 = (mask.astype(np.uint8) * 255)

            # Find contours
            contours, _ = cv2.findContours(
                mask_uint8,
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE
            )

            regions = []
            for i, contour in enumerate(contours):
                # Get bounding rectangle
                x, y, w, h = cv2.boundingRect(contour)

                # Filter by area
                area = w * h
                if area < min_area:
                    continue

                # Calculate region statistics
                region_mask = np.zeros_like(mask_uint8)
                cv2.drawContours(region_mask, [contour], -1, 255, -1)

                regions.append({
                    "id": i,
                    "x": int(x),
                    "y": int(y),
                    "width": int(w),
                    "height": int(h),
                    "area": int(area),
                    "density": float(area / (image_size[0] * image_size[1]))
                })

            # Sort by area (largest first)
            regions.sort(key=lambda r: r["area"], reverse=True)

            return regions

        except Exception as e:
            logger.error("Failed to extract regions", error=str(e))
            return []

    def calculate_image_features(self, image: Image.Image) -> Dict[str, Any]:
        """
        Extract visual features from an image for analysis

        Args:
            image: PIL Image

        Returns:
            Dict of image features
        """
        try:
            # Convert to numpy array
            arr = np.array(image)

            # Convert to grayscale
            if len(arr.shape) == 3:
                gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
            else:
                gray = arr

            # Calculate features
            features = {
                # Color features
                "avg_brightness": float(np.mean(arr)),
                "brightness_std": float(np.std(arr)),

                # Texture features
                "sharpness": float(self._calculate_sharpness(gray)),
                "contrast": float(np.std(gray)),

                # Edge features
                "edge_density": float(self._calculate_edge_density(gray)),

                # Color distribution
                "dark_pixel_percentage": float(np.sum(gray < 50) / gray.size),
                "light_pixel_percentage": float(np.sum(gray > 200) / gray.size),

                # Histogram features
                "histogram": cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten().tolist(),
            }

            return features

        except Exception as e:
            logger.error("Failed to calculate image features", error=str(e))
            return {}

    def _calculate_sharpness(self, gray_image: np.ndarray) -> float:
        """Calculate image sharpness using Laplacian variance"""
        laplacian = cv2.Laplacian(gray_image, cv2.CV_64F)
        return float(laplacian.var())

    def _calculate_edge_density(self, gray_image: np.ndarray) -> float:
        """Calculate density of edges in image"""
        edges = cv2.Canny(gray_image, 100, 200)
        edge_pixels = np.sum(edges > 0)
        total_pixels = edges.size
        return float(edge_pixels / total_pixels)

    def cluster_frames_by_similarity(
        self,
        perceptual_hashes: List[str],
        similarity_threshold: float = 0.95
    ) -> List[int]:
        """
        Cluster frames based on perceptual hash similarity using DBSCAN

        TODO [ARCHITECTURE]: Delegate to qontinui library
        - Library has frame clustering implementations
        - DBSCAN on perceptual hashes should use library functions
        - Avoid reimplementing clustering algorithms in web service

        Args:
            perceptual_hashes: List of perceptual hash strings
            similarity_threshold: Minimum similarity for same cluster (0.0-1.0)

        Returns:
            List of cluster IDs (same length as input, -1 = noise/unclustered)
        """
        try:
            if len(perceptual_hashes) < 2:
                return [0] * len(perceptual_hashes)

            # Convert hashes to binary vectors
            hash_size = len(perceptual_hashes[0]) * 4  # hex chars to bits
            vectors = []

            for hash_str in perceptual_hashes:
                try:
                    h = imagehash.hex_to_hash(hash_str)
                    # Convert to binary array
                    binary = np.array([int(b) for b in h.hash.flatten()])
                    vectors.append(binary)
                except:
                    # Invalid hash, use zeros
                    vectors.append(np.zeros(hash_size, dtype=int))

            vectors = np.array(vectors)

            # Calculate distance matrix using Hamming distance
            n = len(vectors)
            distances = np.zeros((n, n))

            for i in range(n):
                for j in range(i + 1, n):
                    dist = hamming(vectors[i], vectors[j])
                    distances[i, j] = dist
                    distances[j, i] = dist

            # Convert similarity threshold to distance threshold
            # similarity = 1 - distance, so distance = 1 - similarity
            distance_threshold = 1.0 - similarity_threshold

            # Cluster using DBSCAN
            # eps = maximum distance between samples in same cluster
            # min_samples = minimum number of samples for a core point
            clustering = DBSCAN(
                eps=distance_threshold,
                min_samples=2,
                metric='precomputed'
            ).fit(distances)

            return clustering.labels_.tolist()

        except Exception as e:
            logger.error("Failed to cluster frames", error=str(e))
            # Return all frames in cluster 0 as fallback
            return [0] * len(perceptual_hashes)

    def calculate_frame_quality(self, image: Image.Image) -> Dict[str, float]:
        """
        Calculate quality metrics for a frame

        Args:
            image: PIL Image

        Returns:
            Dict of quality metrics
        """
        try:
            arr = np.array(image)

            # Convert to grayscale
            if len(arr.shape) == 3:
                gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
            else:
                gray = arr

            return {
                "sharpness": float(self._calculate_sharpness(gray)),
                "brightness": float(np.mean(gray) / 255.0),
                "contrast": float(np.std(gray) / 128.0),  # Normalize to 0-1
            }

        except Exception as e:
            logger.error("Failed to calculate frame quality", error=str(e))
            return {"sharpness": 0.0, "brightness": 0.5, "contrast": 0.0}
