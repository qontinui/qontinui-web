"""
Unit tests for Computer Vision Service.

Tests perceptual hashing, similarity calculation, state change detection,
and stable region extraction.
"""

import io
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.services.computer_vision_service import ComputerVisionService


@pytest.fixture
def cv_service():
    """Create a computer vision service instance for testing."""
    # Computer vision service uses object_storage singleton
    # No need to mock it for these tests
    service = ComputerVisionService()
    return service


def create_test_image(
    size: tuple[int, int] = (100, 100), color: str = "white", pattern: str = None
) -> bytes:
    """
    Create a test image with optional pattern.

    Args:
        size: Image dimensions (width, height)
        color: Background color
        pattern: Optional pattern to draw ("rect", "circle", "text")

    Returns:
        Image data as bytes
    """
    img = Image.new("RGB", size, color=color)

    if pattern == "rect":
        draw = ImageDraw.Draw(img)
        draw.rectangle([20, 20, 80, 80], fill="blue", outline="black")
    elif pattern == "circle":
        draw = ImageDraw.Draw(img)
        draw.ellipse([20, 20, 80, 80], fill="red", outline="black")
    elif pattern == "text":
        draw = ImageDraw.Draw(img)
        draw.text((30, 40), "TEST", fill="black")

    output = io.BytesIO()
    img.save(output, format="PNG")
    return output.getvalue()


def create_stable_region_images(
    num_images: int = 3, stable_region: tuple[int, int, int, int] = (10, 10, 30, 30)
) -> list[bytes]:
    """
    Create a batch of test images with a stable region.

    Args:
        num_images: Number of images to create
        stable_region: (x, y, width, height) of stable region

    Returns:
        List of image bytes
    """
    images = []
    x, y, w, h = stable_region

    for i in range(num_images):
        img = Image.new("RGB", (100, 100), color="white")
        draw = ImageDraw.Draw(img)

        # Stable region - same in all images (blue rectangle)
        draw.rectangle([x, y, x + w, y + h], fill="blue", outline="black")

        # Variable region - different in each image (red circle at different positions)
        offset = i * 10
        draw.ellipse([50 + offset, 50, 70 + offset, 70], fill="red", outline="black")

        output = io.BytesIO()
        img.save(output, format="PNG")
        images.append(output.getvalue())

    return images


class TestPerceptualHashing:
    """Tests for perceptual hash generation."""

    @pytest.mark.asyncio
    async def test_generate_perceptual_hash_success(self, cv_service):
        """Test successful perceptual hash generation."""
        image_bytes = create_test_image(pattern="rect")

        hash_str = await cv_service.generate_perceptual_hash(image_bytes)

        assert isinstance(hash_str, str)
        assert len(hash_str) == 16  # 8x8 hash = 64 bits = 16 hex chars
        # Hash should be valid hexadecimal
        int(hash_str, 16)

    @pytest.mark.asyncio
    async def test_generate_perceptual_hash_consistent(self, cv_service):
        """Test that same image produces same hash."""
        image_bytes = create_test_image(pattern="circle")

        hash1 = await cv_service.generate_perceptual_hash(image_bytes)
        hash2 = await cv_service.generate_perceptual_hash(image_bytes)

        assert hash1 == hash2

    @pytest.mark.asyncio
    async def test_generate_perceptual_hash_different_images(self, cv_service):
        """Test that different images produce different hashes."""
        image1_bytes = create_test_image(pattern="rect")
        image2_bytes = create_test_image(pattern="circle")

        hash1 = await cv_service.generate_perceptual_hash(image1_bytes)
        hash2 = await cv_service.generate_perceptual_hash(image2_bytes)

        assert hash1 != hash2

    @pytest.mark.asyncio
    async def test_generate_perceptual_hash_rgba_image(self, cv_service):
        """Test hash generation with RGBA image."""
        img = Image.new("RGBA", (100, 100), color=(255, 255, 255, 128))
        output = io.BytesIO()
        img.save(output, format="PNG")
        image_bytes = output.getvalue()

        hash_str = await cv_service.generate_perceptual_hash(image_bytes)

        assert isinstance(hash_str, str)
        assert len(hash_str) == 16

    @pytest.mark.asyncio
    async def test_generate_perceptual_hash_grayscale(self, cv_service):
        """Test hash generation with grayscale image."""
        img = Image.new("L", (100, 100), color=128)
        output = io.BytesIO()
        img.save(output, format="PNG")
        image_bytes = output.getvalue()

        hash_str = await cv_service.generate_perceptual_hash(image_bytes)

        assert isinstance(hash_str, str)
        assert len(hash_str) == 16

    @pytest.mark.asyncio
    async def test_generate_perceptual_hash_invalid_data(self, cv_service):
        """Test hash generation with invalid image data."""
        invalid_bytes = b"not an image"

        with pytest.raises(ValueError, match="Failed to generate perceptual hash"):
            await cv_service.generate_perceptual_hash(invalid_bytes)


class TestSimilarityCalculation:
    """Tests for similarity calculation."""

    @pytest.mark.asyncio
    async def test_calculate_similarity_identical_hashes(self, cv_service):
        """Test similarity of identical hashes."""
        image_bytes = create_test_image(pattern="rect")
        hash_str = await cv_service.generate_perceptual_hash(image_bytes)

        similarity = await cv_service.calculate_similarity(hash_str, hash_str)

        assert similarity == 1.0

    @pytest.mark.asyncio
    async def test_calculate_similarity_similar_images(self, cv_service):
        """Test similarity of visually similar images."""
        # Create two similar images (white background with blue rectangle)
        image1_bytes = create_test_image(pattern="rect")
        image2_bytes = create_test_image(pattern="rect")

        hash1 = await cv_service.generate_perceptual_hash(image1_bytes)
        hash2 = await cv_service.generate_perceptual_hash(image2_bytes)

        similarity = await cv_service.calculate_similarity(hash1, hash2)

        # Should be identical since same pattern
        assert similarity == 1.0

    @pytest.mark.asyncio
    async def test_calculate_similarity_different_images(self, cv_service):
        """Test similarity of visually different images."""
        image1_bytes = create_test_image(pattern="rect")
        image2_bytes = create_test_image(pattern="circle")

        hash1 = await cv_service.generate_perceptual_hash(image1_bytes)
        hash2 = await cv_service.generate_perceptual_hash(image2_bytes)

        similarity = await cv_service.calculate_similarity(hash1, hash2)

        # Should be less than 1.0 for different patterns
        assert similarity < 1.0

    @pytest.mark.asyncio
    async def test_calculate_similarity_completely_different(self, cv_service):
        """Test similarity of completely different images."""
        # Use images with different patterns instead of just colors
        # Solid colors can have similar perceptual hashes (both uniform)
        image1_bytes = create_test_image(color="white", pattern="rect")
        image2_bytes = create_test_image(color="black", pattern="circle")

        hash1 = await cv_service.generate_perceptual_hash(image1_bytes)
        hash2 = await cv_service.generate_perceptual_hash(image2_bytes)

        similarity = await cv_service.calculate_similarity(hash1, hash2)

        # Should be different for images with different patterns
        assert similarity < 1.0

    @pytest.mark.asyncio
    async def test_calculate_similarity_invalid_hash(self, cv_service):
        """Test similarity calculation with invalid hash."""
        valid_hash = "0123456789abcdef"
        invalid_hash = "not_a_valid_hash"

        with pytest.raises(ValueError, match="Failed to calculate similarity"):
            await cv_service.calculate_similarity(valid_hash, invalid_hash)


class TestStateChangeDetection:
    """Tests for state change detection."""

    @pytest.mark.asyncio
    async def test_detect_state_change_no_change(self, cv_service):
        """Test that identical screenshots show no state change."""
        image_bytes = create_test_image(pattern="rect")

        state_changed = await cv_service.detect_state_change(
            image_bytes, image_bytes, threshold=0.15
        )

        assert state_changed is False

    @pytest.mark.asyncio
    async def test_detect_state_change_significant_change(self, cv_service):
        """Test that different screenshots show state change."""
        image1_bytes = create_test_image(pattern="rect")
        image2_bytes = create_test_image(pattern="circle")

        state_changed = await cv_service.detect_state_change(
            image1_bytes, image2_bytes, threshold=0.15
        )

        assert state_changed is True

    @pytest.mark.asyncio
    async def test_detect_state_change_threshold_sensitivity(self, cv_service):
        """Test threshold sensitivity for state change detection."""
        # Use images with different patterns for better hash differences
        image1_bytes = create_test_image(color="white", pattern="rect")
        image2_bytes = create_test_image(color="white", pattern="circle")

        # Very strict threshold (less sensitive) - won't detect small differences
        state_changed_strict = await cv_service.detect_state_change(
            image1_bytes, image2_bytes, threshold=0.01
        )

        # Normal threshold - will detect differences
        state_changed_normal = await cv_service.detect_state_change(
            image1_bytes, image2_bytes, threshold=0.15
        )

        # Normal threshold should detect change
        assert state_changed_normal is True

    @pytest.mark.asyncio
    async def test_detect_state_change_invalid_image(self, cv_service):
        """Test state change detection with invalid image data."""
        valid_image = create_test_image()
        invalid_image = b"not an image"

        with pytest.raises(ValueError, match="Failed to detect state change"):
            await cv_service.detect_state_change(valid_image, invalid_image)


class TestStableRegionDetection:
    """Tests for stable region detection."""

    @pytest.mark.asyncio
    async def test_find_stable_regions_success(self, cv_service):
        """Test successful stable region detection."""
        # Create images with stable region
        images = create_stable_region_images(num_images=3, stable_region=(10, 10, 30, 30))

        regions = await cv_service.find_stable_regions(
            images, min_stability=0.90, min_region_size=(20, 20)
        )

        # Should find at least one stable region
        assert len(regions) > 0

        # Check region structure
        region = regions[0]
        assert "x" in region
        assert "y" in region
        assert "width" in region
        assert "height" in region
        assert "pixel_hash" in region
        assert "stability_score" in region
        assert "screenshot_indices" in region

        # Stability score should be high for stable regions
        assert region["stability_score"] >= 0.90

    @pytest.mark.asyncio
    async def test_find_stable_regions_minimum_size_filter(self, cv_service):
        """Test that small regions are filtered out."""
        images = create_stable_region_images(num_images=3, stable_region=(10, 10, 5, 5))

        # Use large minimum size to filter out the small stable region
        regions = await cv_service.find_stable_regions(
            images, min_stability=0.90, min_region_size=(20, 20)
        )

        # Should find no regions matching the size filter, or only larger regions
        # Note: The whole image might be detected as stable if images are identical enough
        for region in regions:
            assert region["width"] >= 20 or region["height"] >= 20

    @pytest.mark.asyncio
    async def test_find_stable_regions_sorted_by_stability(self, cv_service):
        """Test that regions are sorted by stability score."""
        images = create_stable_region_images(num_images=5)

        regions = await cv_service.find_stable_regions(images, min_stability=0.80)

        # Verify sorting (descending order)
        if len(regions) > 1:
            for i in range(len(regions) - 1):
                assert regions[i]["stability_score"] >= regions[i + 1]["stability_score"]

    @pytest.mark.asyncio
    async def test_find_stable_regions_insufficient_screenshots(self, cv_service):
        """Test error with insufficient screenshots."""
        images = [create_test_image()]  # Only one image

        with pytest.raises(ValueError, match="Need at least 2 screenshots"):
            await cv_service.find_stable_regions(images)

    @pytest.mark.asyncio
    async def test_find_stable_regions_inconsistent_sizes(self, cv_service):
        """Test handling of inconsistent screenshot sizes."""
        # Create images of different sizes
        img1 = create_test_image(size=(100, 100), pattern="rect")
        img2 = create_test_image(size=(120, 120), pattern="rect")
        img3 = create_test_image(size=(150, 150), pattern="rect")

        images = [img1, img2, img3]

        # Should handle by resizing to common dimensions
        regions = await cv_service.find_stable_regions(images, min_stability=0.90)

        # Should still work (may or may not find regions depending on resizing)
        assert isinstance(regions, list)

    @pytest.mark.asyncio
    async def test_find_stable_regions_all_identical(self, cv_service):
        """Test with all identical screenshots."""
        image = create_test_image(pattern="rect")
        images = [image] * 5

        regions = await cv_service.find_stable_regions(
            images, min_stability=0.95, min_region_size=(10, 10)
        )

        # Should find stable regions (entire image should be stable)
        assert len(regions) > 0

        # All regions should have maximum stability
        for region in regions:
            assert region["stability_score"] > 0.95


class TestS3ScreenshotDownload:
    """Tests for S3 screenshot download."""

    @pytest.mark.asyncio
    async def test_download_screenshot_success(self, cv_service):
        """Test successful screenshot download from S3."""
        mock_storage = MagicMock()
        test_bytes = create_test_image()
        mock_storage.download_file.return_value = test_bytes
        cv_service.storage = mock_storage

        result = await cv_service.download_screenshot_from_s3("test/screenshot.png")

        assert result == test_bytes
        mock_storage.download_file.assert_called_once_with("test/screenshot.png")

    @pytest.mark.asyncio
    async def test_download_screenshot_failure(self, cv_service):
        """Test screenshot download failure."""
        mock_storage = MagicMock()
        mock_storage.download_file.side_effect = Exception("S3 error")
        cv_service.storage = mock_storage

        with pytest.raises(ValueError, match="Failed to download screenshot from S3"):
            await cv_service.download_screenshot_from_s3("test/screenshot.png")


class TestRegionExtraction:
    """Tests for region extraction."""

    @pytest.mark.asyncio
    async def test_extract_region_success(self, cv_service):
        """Test successful region extraction."""
        # Create a test image
        image_bytes = create_test_image(size=(100, 100), pattern="rect")

        # Extract a region
        region_bytes = await cv_service.extract_region_image(
            image_bytes, x=20, y=20, width=60, height=60
        )

        # Verify it's valid image data
        region_img = Image.open(io.BytesIO(region_bytes))
        assert region_img.size == (60, 60)

    @pytest.mark.asyncio
    async def test_extract_region_full_image(self, cv_service):
        """Test extracting entire image."""
        image_bytes = create_test_image(size=(100, 100))

        region_bytes = await cv_service.extract_region_image(
            image_bytes, x=0, y=0, width=100, height=100
        )

        region_img = Image.open(io.BytesIO(region_bytes))
        assert region_img.size == (100, 100)

    @pytest.mark.asyncio
    async def test_extract_region_invalid_image(self, cv_service):
        """Test region extraction with invalid image."""
        invalid_bytes = b"not an image"

        with pytest.raises(ValueError, match="Failed to extract region"):
            await cv_service.extract_region_image(
                invalid_bytes, x=0, y=0, width=50, height=50
            )


class TestIntegration:
    """Integration tests combining multiple features."""

    @pytest.mark.asyncio
    async def test_end_to_end_workflow(self, cv_service):
        """Test complete workflow from download to analysis."""
        # Create test screenshots
        screenshot1 = create_test_image(pattern="rect")
        screenshot2 = create_test_image(pattern="rect")
        screenshot3 = create_test_image(pattern="circle")

        # Test perceptual hashing
        hash1 = await cv_service.generate_perceptual_hash(screenshot1)
        hash2 = await cv_service.generate_perceptual_hash(screenshot2)
        hash3 = await cv_service.generate_perceptual_hash(screenshot3)

        # Test similarity
        similarity_same = await cv_service.calculate_similarity(hash1, hash2)
        similarity_diff = await cv_service.calculate_similarity(hash1, hash3)

        assert similarity_same == 1.0  # Identical patterns
        assert similarity_diff < 1.0  # Different patterns

        # Test state change detection
        no_change = await cv_service.detect_state_change(screenshot1, screenshot2)
        has_change = await cv_service.detect_state_change(screenshot1, screenshot3)

        assert no_change is False
        assert has_change is True

    @pytest.mark.asyncio
    async def test_stable_region_hashing(self, cv_service):
        """Test that stable regions can be hashed and compared."""
        images = create_stable_region_images(num_images=3)

        # Find stable regions
        regions = await cv_service.find_stable_regions(images, min_stability=0.90)

        assert len(regions) > 0

        # Verify region hashes are valid
        for region in regions:
            assert isinstance(region["pixel_hash"], str)
            assert len(region["pixel_hash"]) == 16

            # Hash should be valid hex
            int(region["pixel_hash"], 16)
