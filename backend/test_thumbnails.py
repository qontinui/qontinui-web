#!/usr/bin/env python3
"""
Quick test script for thumbnail generation service.

This script creates a test image and generates thumbnails to verify
the ImageProcessingService works correctly.
"""

import io

from app.services.image_processing_service import (
    THUMBNAIL_SIZES,
    ImageProcessingService,
)
from PIL import Image


def create_test_image(width: int = 3000, height: int = 2000) -> bytes:
    """Create a test image with a gradient and text."""
    # Create a gradient image
    img = Image.new("RGB", (width, height))
    pixels = img.load()

    if pixels is None:
        raise ValueError("Failed to load image pixels")

    for y in range(height):
        for x in range(width):
            r = int(255 * x / width)
            g = int(255 * y / height)
            b = 128
            pixels[x, y] = (r, g, b)

    # Save to bytes
    output = io.BytesIO()
    img.save(output, format="PNG")
    return output.getvalue()


def test_thumbnail_generation():
    """Test thumbnail generation."""
    print("=" * 60)
    print("Testing Thumbnail Generation Service")
    print("=" * 60)

    # Create test image
    print("\n1. Creating test image (3000x2000)...")
    test_image = create_test_image(3000, 2000)
    print(f"   Original size: {len(test_image):,} bytes")

    # Generate thumbnails
    print("\n2. Generating thumbnails...")
    try:
        thumbnails = ImageProcessingService.generate_thumbnails(test_image)
        print(f"   Successfully generated {len(thumbnails)} thumbnails")
    except Exception as e:
        print(f"   ERROR: {e}")
        return False

    # Verify all sizes were created
    print("\n3. Verifying thumbnail sizes:")
    for size_name, expected_max_size in THUMBNAIL_SIZES.items():
        if size_name not in thumbnails:
            print(f"   ERROR: Missing thumbnail size '{size_name}'")
            return False

        thumbnail_data = thumbnails[size_name]

        # Load thumbnail and check dimensions
        thumbnail_img = Image.open(io.BytesIO(thumbnail_data))

        print(f"\n   {size_name.upper()}:")
        print(f"      Target max size: {expected_max_size}")
        print(f"      Actual size: {thumbnail_img.width}x{thumbnail_img.height}")
        print(f"      File size: {len(thumbnail_data):,} bytes")
        print(f"      Format: {thumbnail_img.format}")
        print(
            f"      Compression: {len(thumbnail_data) / len(test_image) * 100:.1f}% of original"
        )

        # Verify size constraints
        if (
            thumbnail_img.width > expected_max_size[0]
            or thumbnail_img.height > expected_max_size[1]
        ):
            print("      ERROR: Thumbnail exceeds max dimensions!")
            return False

        print("      ✓ Size within bounds")

    # Test optimize_image
    print("\n4. Testing image optimization...")
    try:
        optimized_webp, content_type = ImageProcessingService.optimize_image(
            test_image, target_format="webp", quality=85
        )
        print("   WebP optimization:")
        print(f"      Original: {len(test_image):,} bytes")
        print(f"      Optimized: {len(optimized_webp):,} bytes")
        print(f"      Compression: {len(optimized_webp) / len(test_image) * 100:.1f}%")
        print(f"      Content-Type: {content_type}")
        print("      ✓ WebP optimization successful")

        optimized_jpeg, content_type = ImageProcessingService.optimize_image(
            test_image, target_format="jpeg", quality=85
        )
        print("\n   JPEG optimization:")
        print(f"      Original: {len(test_image):,} bytes")
        print(f"      Optimized: {len(optimized_jpeg):,} bytes")
        print(f"      Compression: {len(optimized_jpeg) / len(test_image) * 100:.1f}%")
        print(f"      Content-Type: {content_type}")
        print("      ✓ JPEG optimization successful")

    except Exception as e:
        print(f"   ERROR: {e}")
        return False

    # Test RGBA handling
    print("\n5. Testing RGBA to RGB conversion...")
    try:
        # Create RGBA test image
        rgba_img = Image.new("RGBA", (1000, 1000), (255, 0, 0, 128))
        rgba_output = io.BytesIO()
        rgba_img.save(rgba_output, format="PNG")
        rgba_data = rgba_output.getvalue()

        thumbnails_rgba = ImageProcessingService.generate_thumbnails(rgba_data)
        print("   ✓ RGBA conversion successful")
        print(f"   Generated {len(thumbnails_rgba)} thumbnails from RGBA image")
    except Exception as e:
        print(f"   ERROR: {e}")
        return False

    print("\n" + "=" * 60)
    print("All tests passed! ✓")
    print("=" * 60)
    return True


if __name__ == "__main__":
    import sys

    success = test_thumbnail_generation()
    sys.exit(0 if success else 1)
