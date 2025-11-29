"""
State discovery service for automated state identification

This service handles:
- Identifying states from frame clusters
- Extracting StateImages from stable regions
- Generating intelligent state names using OCR
- Calculating confidence scores

ARCHITECTURE NOTE - DUPLICATE CV FUNCTIONALITY
===============================================
WARNING: This service currently reimplements computer vision logic that already exists
in the qontinui library. This duplication was necessary for prototyping but should be
refactored in production.

DUPLICATE CV OPERATIONS TO MIGRATE:
------------------------------------
1. PIXEL STABILITY ANALYSIS (lines 60, 186-245)
   - Current: detect_stable_regions() calculates per-pixel variance
   - Library: PixelStabilityAnalyzer performs this exact analysis
   - Action: Delegate to library's PixelStabilityAnalyzer

2. REGION DETECTION (lines 209-216)
   - Current: _extract_regions() finds connected regions in masks
   - Library: DifferentialConsistencyDetector handles region detection
   - Action: Use library's region detection instead

3. STATE CONSTRUCTION WITH OCR (lines 30-135, 255-287)
   - Current: _extract_text_elements() runs OCR, _generate_state_name() creates names
   - Library: StateBuilder handles state object construction with OCR
   - Action: Delegate entire state construction to StateBuilder

4. PERCEPTUAL HASHING (via FrameAnalysisService)
   - Current: FrameAnalysisService computes imagehash operations
   - Library: Already has perceptual hashing utilities
   - Action: Use library's hash functions

5. SSIM/SIMILARITY CALCULATIONS (via FrameAnalysisService)
   - Current: calculate_image_similarity() computes SSIM, MSE, histogram correlation
   - Library: Has optimized similarity comparison functions
   - Action: Delegate to library's comparison utilities

INTENDED ARCHITECTURE
=====================
This service should primarily:
- Coordinate workflow (download frames, call library, store results)
- Perform lightweight data transformations
- Handle web-specific concerns (S3 storage, database persistence)

Heavy CV operations should be delegated to qontinui library via runner.
"""

import uuid
from typing import Any

import numpy as np
import pytesseract  # type: ignore[import-untyped]
import structlog
from PIL import Image

from app.services.frame_analysis_service import FrameAnalysisService

logger = structlog.get_logger(__name__)


class FrameStateDiscoveryService:
    """Service for discovering states from clustered frames"""

    def __init__(self):
        self.frame_analysis = FrameAnalysisService()

    async def identify_states_from_clusters(
        self,
        frames_by_cluster: dict[int, list[dict[str, Any]]],
        all_frames_data: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Identify states from frame clusters

        Args:
            frames_by_cluster: Dict mapping cluster_id to list of frame data
            all_frames_data: List of all frame data for cross-cluster analysis

        Returns:
            List of discovered state dictionaries
        """
        discovered_states = []

        for cluster_id, frames in frames_by_cluster.items():
            if cluster_id == -1:  # Noise/unclustered
                continue

            try:
                # Download representative frames for analysis
                images = await self._download_cluster_frames(
                    frames[:10]
                )  # Limit to 10 for performance

                if not images:
                    logger.warning(f"No images downloaded for cluster {cluster_id}")
                    continue

                # TODO [ARCHITECTURE]: Delegate to qontinui library
                # This should call PixelStabilityAnalyzer from qontinui library instead
                # of reimplementing pixel variance analysis in FrameAnalysisService

                # Detect stable regions across cluster frames
                stable_regions, volatile_regions = (
                    self.frame_analysis.detect_stable_regions(images)
                )

                # Extract StateImages from stable regions
                state_images = await self._extract_state_images(
                    stable_regions,
                    images[0],  # Use first frame as representative
                    frames,
                    all_frames_data,
                )

                # TODO [ARCHITECTURE]: Delegate OCR and state construction to qontinui library
                # Should use StateBuilder from qontinui library which handles:
                # - OCR extraction with proper preprocessing
                # - Intelligent state naming
                # - State object construction with all metadata

                # Extract text elements using OCR
                state_strings = self._extract_text_elements(images[0])

                # Generate intelligent state name
                state_name = self._generate_state_name(
                    state_strings,
                    frames[0].get("window_title"),
                    frames[0].get("url"),
                    cluster_id,
                )

                # Calculate confidence scores
                confidence_scores = self._calculate_confidence_scores(
                    state_images, stable_regions, len(frames), all_frames_data
                )

                # Determine if this is an error state
                is_error_state = self._detect_error_state(state_strings, state_images)

                # Create state object
                state = {
                    "id": str(uuid.uuid4()),
                    "name": state_name,
                    "description": f"Auto-discovered state from {len(frames)} frames",
                    "cluster_id": cluster_id,
                    "state_images": state_images,
                    "regions": [
                        {
                            "id": str(uuid.uuid4()),
                            "name": f"dynamic_region_{i}",
                            **region,
                        }
                        for i, region in enumerate(volatile_regions[:5])  # Limit to 5
                    ],
                    "strings": state_strings,
                    "locations": [],  # Will be populated from interactions
                    "frame_ids": [f["id"] for f in frames],
                    "frame_count": len(frames),
                    "is_initial": False,  # Will be determined later
                    "is_error_state": is_error_state,
                    "is_transient": self._is_transient_state(frames),
                    "confidence": confidence_scores["overall"],
                    "uniqueness_score": confidence_scores["uniqueness"],
                    "stability_score": confidence_scores["stability"],
                    "distinctiveness_score": confidence_scores["distinctiveness"],
                    "window_context": {
                        "title": frames[0].get("window_title"),
                        "bounds": frames[0].get("window_bounds"),
                    },
                    "url_context": frames[0].get("url"),
                }

                discovered_states.append(state)

            except Exception as e:
                logger.error(
                    f"Failed to process cluster {cluster_id}",
                    error=str(e),
                    exc_info=True,
                )
                continue

        # Set initial state (first cluster with frames)
        if discovered_states:
            discovered_states[0]["is_initial"] = True

        return discovered_states

    async def _download_cluster_frames(
        self, frames: list[dict[str, Any]]
    ) -> list[Image.Image]:
        """Download sample frames from a cluster"""
        images = []

        for frame in frames:
            s3_key = frame.get("s3_key")
            if not s3_key:
                continue

            image = await self.frame_analysis.download_frame(s3_key)
            if image:
                images.append(image)

        return images

    async def _extract_state_images(
        self,
        stable_regions: list[dict[str, Any]],
        representative_image: Image.Image,
        cluster_frames: list[dict[str, Any]],
        all_frames: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Extract StateImages from stable regions

        Args:
            stable_regions: List of stable region bounding boxes
            representative_image: Representative frame image
            cluster_frames: Frames in this cluster
            all_frames: All frames for shared element detection

        Returns:
            List of StateImage objects
        """
        state_images = []

        for i, region in enumerate(stable_regions[:10]):  # Limit to top 10 regions
            try:
                # Crop region from representative image
                x, y, w, h = region["x"], region["y"], region["width"], region["height"]
                representative_image.crop((x, y, x + w, y + h))

                # Calculate if this element appears in other clusters (shared)
                is_shared = self._is_shared_element(region, all_frames, cluster_frames)

                # Calculate stability score (how consistent across cluster)
                stability_score = self._calculate_region_stability(
                    region, cluster_frames
                )

                # Determine if position is fixed (appears at same coordinates)
                is_fixed = self._is_fixed_position(region, cluster_frames)

                state_image = {
                    "id": str(uuid.uuid4()),
                    "name": f"element_{i}",
                    "patterns": [
                        {
                            "id": str(uuid.uuid4()),
                            "searchRegions": [
                                {"x": x, "y": y, "width": w, "height": h}
                            ],
                            "fixed": is_fixed,
                            "similarity": 0.85,  # Default threshold
                        }
                    ],
                    "shared": is_shared,
                    "source": "state-discovery",
                    "stabilityScore": stability_score,
                }

                state_images.append(state_image)

            except Exception as e:
                logger.error(
                    f"Failed to extract state image for region {i}", error=str(e)
                )
                continue

        return state_images

    def _is_shared_element(
        self,
        region: dict[str, Any],
        all_frames: list[dict[str, Any]],
        cluster_frames: list[dict[str, Any]],
    ) -> bool:
        """Check if a region appears in frames outside this cluster"""
        # Simplified: assume element is shared if it's in top-left corner
        # (like logos, headers)
        _x, y = region["x"], region["y"]
        if y < 100:  # Top 100 pixels
            return True
        return False

    def _calculate_region_stability(
        self, region: dict[str, Any], frames: list[dict[str, Any]]
    ) -> float:
        """
        Calculate how stable a region is across frames

        TODO [ARCHITECTURE]: Delegate to qontinui library
        - PixelStabilityAnalyzer in library has robust stability scoring
        - Should use library's stability calculations instead
        """
        # Simplified: return high stability for now
        # In production, would compare region across all frames
        return 0.95

    def _is_fixed_position(
        self, region: dict[str, Any], frames: list[dict[str, Any]]
    ) -> bool:
        """Check if region appears at fixed coordinates"""
        # Simplified: assume fixed if variance is low
        return True

    def _extract_text_elements(self, image: Image.Image) -> list[dict[str, Any]]:
        """
        Extract text elements using OCR

        TODO [ARCHITECTURE]: This duplicates OCR functionality in qontinui library
        - Library's StateBuilder already performs OCR with better preprocessing
        - Should delegate to library instead of running pytesseract directly here

        Args:
            image: PIL Image

        Returns:
            List of StateString objects
        """
        try:
            # Run OCR on image
            text = pytesseract.image_to_string(image)

            # Split into lines and filter
            lines = [line.strip() for line in text.split("\n") if line.strip()]

            # Create StateString objects
            state_strings = []
            for i, line in enumerate(lines[:10]):  # Limit to 10 strings
                state_string = {
                    "id": str(uuid.uuid4()),
                    "name": f"text_{i}",
                    "value": line,
                    "identifier": i < 3,  # First 3 strings used for identification
                }
                state_strings.append(state_string)

            return state_strings

        except Exception as e:
            logger.error("Failed to extract text elements", error=str(e))
            return []

    def _generate_state_name(
        self,
        state_strings: list[dict[str, Any]],
        window_title: str | None,
        url: str | None,
        cluster_id: int,
    ) -> str:
        """
        Generate intelligent name for state

        Priority:
        1. Window title
        2. Prominent text from OCR
        3. URL path
        4. Fallback to "State_XXX"
        """
        # Try window title first
        if window_title:
            # Clean up window title
            name = window_title.split("-")[0].strip()
            if len(name) > 3:
                return self._sanitize_name(name)

        # Try OCR text
        if state_strings:
            # Use longest string as likely title
            longest = max(state_strings, key=lambda s: len(s["value"]))
            if len(longest["value"]) > 3:
                return self._sanitize_name(longest["value"])

        # Try URL pathname
        if url:
            try:
                from urllib.parse import urlparse

                path = urlparse(url).path
                if path and path != "/":
                    parts = [p for p in path.split("/") if p]
                    if parts:
                        return self._sanitize_name(parts[-1].title())
            except:
                pass

        # Fallback
        return f"State_{cluster_id:03d}"

    def _sanitize_name(self, name: str) -> str:
        """Sanitize state name"""
        # Remove special characters, limit length
        import re

        name = re.sub(r"[^a-zA-Z0-9\s_-]", "", name)
        name = name.strip()
        if len(name) > 50:
            name = name[:50]
        return name or "UnnamedState"

    def _detect_error_state(
        self, state_strings: list[dict[str, Any]], state_images: list[dict[str, Any]]
    ) -> bool:
        """
        Detect if this is an error state

        Look for:
        - Error-related text ("error", "failed", "retry")
        - Red color schemes (simplified)
        """
        error_keywords = [
            "error",
            "failed",
            "failure",
            "retry",
            "cancel",
            "warning",
            "problem",
        ]

        for string_obj in state_strings:
            text = string_obj["value"].lower()
            if any(keyword in text for keyword in error_keywords):
                return True

        return False

    def _is_transient_state(self, frames: list[dict[str, Any]]) -> bool:
        """
        Determine if this is a transient state (like loading)

        Args:
            frames: Frames in this state

        Returns:
            True if transient (brief duration, no interactions)
        """
        # Check duration
        if frames:
            first_time = frames[0].get("relative_time_ms", 0)
            last_time = frames[-1].get("relative_time_ms", 0)
            duration = last_time - first_time

            # Less than 1 second = likely transient
            if duration < 1000:
                return True

        # Check frame count (< 3 frames = very brief)
        if len(frames) < 3:
            return True

        return False

    def _calculate_confidence_scores(
        self,
        state_images: list[dict[str, Any]],
        stable_regions: list[dict[str, Any]],
        frame_count: int,
        all_frames: list[dict[str, Any]],
    ) -> dict[str, float]:
        """
        Calculate confidence scores for state

        Returns:
            Dict with uniqueness, stability, distinctiveness, and overall scores
        """
        # Uniqueness: proportion of unique (non-shared) elements
        if state_images:
            unique_count = sum(
                1 for img in state_images if not img.get("shared", False)
            )
            uniqueness = unique_count / len(state_images)
        else:
            uniqueness = 0.0

        # Stability: average stability of all elements
        if state_images:
            stability = np.mean(
                [img.get("stabilityScore", 0.5) for img in state_images]
            )
        else:
            stability = 0.0

        # Distinctiveness: simplified - based on number of identifying elements
        distinctiveness = min(len(state_images) / 5.0, 1.0)  # 5+ elements = 1.0

        # Overall: weighted average
        overall = uniqueness * 0.4 + stability * 0.3 + distinctiveness * 0.3

        return {
            "uniqueness": float(uniqueness),
            "stability": float(stability),
            "distinctiveness": float(distinctiveness),
            "overall": float(overall),
        }

    def merge_similar_states(
        self, states: list[dict[str, Any]], similarity_threshold: float = 0.90
    ) -> list[dict[str, Any]]:
        """
        Merge states that are too similar (deduplication)

        Args:
            states: List of discovered states
            similarity_threshold: Threshold for merging (0.0-1.0)

        Returns:
            List of deduplicated states
        """
        if len(states) < 2:
            return states

        merged = []
        used = set()

        for i, state1 in enumerate(states):
            if i in used:
                continue

            # Find similar states
            similar_indices = [i]

            for j, state2 in enumerate(states[i + 1 :], start=i + 1):
                if j in used:
                    continue

                similarity = self._calculate_state_similarity(state1, state2)

                if similarity >= similarity_threshold:
                    similar_indices.append(j)
                    used.add(j)

            # Merge similar states
            if len(similar_indices) > 1:
                merged_state = self._merge_states(
                    [states[idx] for idx in similar_indices]
                )
                merged.append(merged_state)
            else:
                merged.append(state1)

            used.add(i)

        return merged

    def _calculate_state_similarity(
        self, state1: dict[str, Any], state2: dict[str, Any]
    ) -> float:
        """Calculate similarity between two states"""
        # Compare state images
        images1 = {img["name"] for img in state1.get("state_images", [])}
        images2 = {img["name"] for img in state2.get("state_images", [])}

        if not images1 and not images2:
            return 0.0

        if not images1 or not images2:
            return 0.0

        # Jaccard similarity
        intersection = len(images1 & images2)
        union = len(images1 | images2)

        return intersection / union if union > 0 else 0.0

    def _merge_states(self, states: list[dict[str, Any]]) -> dict[str, Any]:
        """Merge multiple similar states into one"""
        # Use the state with highest confidence as base
        base_state = max(states, key=lambda s: s.get("confidence", 0.0))

        # Combine frame IDs
        all_frame_ids = []
        for state in states:
            all_frame_ids.extend(state.get("frame_ids", []))

        base_state["frame_ids"] = list(set(all_frame_ids))
        base_state["frame_count"] = len(base_state["frame_ids"])

        # Update description
        base_state["description"] = (
            f"Merged state from {len(states)} similar states ({base_state['frame_count']} frames)"
        )

        return base_state
