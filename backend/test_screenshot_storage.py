"""
Test script for screenshot storage service.

Run this to verify the screenshot storage implementation works correctly.
"""

import asyncio
import io
from uuid import uuid4

from app.core.config import settings
from app.services.screenshot_storage import screenshot_storage
from PIL import Image


def create_test_image(
    width: int = 800, height: int = 600, color: str = "blue"
) -> bytes:
    """Create a simple test image."""
    img = Image.new("RGB", (width, height), color=color)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer.getvalue()


async def test_screenshot_storage():
    """Test screenshot storage operations."""
    print("=" * 60)
    print("Testing Screenshot Storage Service")
    print("=" * 60)

    # Test IDs
    run_id = uuid4()
    step_id = uuid4()

    print(f"\nTest Run ID: {run_id}")
    print(f"Test Step ID: {step_id}")
    print(f"\nStorage Backend: {settings.STORAGE_BACKEND}")
    print(f"Bucket: {settings.STORAGE_BUCKET_NAME}")

    # Test 1: Upload screenshot
    print("\n1. Testing screenshot upload...")
    try:
        image_bytes = create_test_image(1920, 1080, "blue")
        url = screenshot_storage.upload_screenshot(
            run_id=run_id,
            step_id=step_id,
            image_bytes=image_bytes,
            screenshot_type="test",
            metadata={"test_key": "test_value", "confidence": 0.95},
        )
        print("   ✓ Upload successful")
        print(f"   URL: {url}")
    except Exception as e:
        print(f"   ✗ Upload failed: {e}")
        return

    # Test 2: Get presigned URL
    print("\n2. Testing presigned URL generation...")
    try:
        # Extract path from URL
        path = f"test-screenshots/{run_id}/{step_id}"
        presigned_url = screenshot_storage.get_screenshot_url(path, expiration=3600)
        print("   ✓ Presigned URL generated")
        print(f"   URL: {presigned_url[:100]}...")
    except Exception as e:
        print(f"   ✗ URL generation failed: {e}")

    # Test 3: Upload second screenshot
    print("\n3. Testing second screenshot upload...")
    try:
        step_id_2 = uuid4()
        image_bytes_2 = create_test_image(1920, 1080, "red")
        url_2 = screenshot_storage.upload_screenshot(
            run_id=run_id,
            step_id=step_id_2,
            image_bytes=image_bytes_2,
            screenshot_type="error",
            metadata={"error_message": "Test error"},
        )
        print("   ✓ Second upload successful")
        print(f"   URL: {url_2}")
    except Exception as e:
        print(f"   ✗ Second upload failed: {e}")

    # Test 4: Check if screenshot exists
    print("\n4. Testing screenshot existence check...")
    try:
        exists = screenshot_storage.screenshot_exists(path)
        print(f"   ✓ Existence check: {exists}")
    except Exception as e:
        print(f"   ✗ Existence check failed: {e}")

    # Test 5: Get metadata
    print("\n5. Testing metadata retrieval...")
    try:
        metadata = screenshot_storage.get_screenshot_metadata(path)
        print("   ✓ Metadata retrieved:")
        print(f"     Size: {metadata.get('size')} bytes")
        print(f"     Content-Type: {metadata.get('content_type')}")
        custom_meta = metadata.get("metadata", {})
        print(f"     Custom metadata: {custom_meta}")
    except Exception as e:
        print(f"   ✗ Metadata retrieval failed: {e}")

    # Test 6: Delete all screenshots for run
    print("\n6. Testing bulk delete...")
    try:
        count = screenshot_storage.delete_screenshots(run_id)
        print(f"   ✓ Deleted {count} screenshots")
    except Exception as e:
        print(f"   ✗ Bulk delete failed: {e}")

    # Test 7: Verify deletion
    print("\n7. Verifying deletion...")
    try:
        exists_after = screenshot_storage.screenshot_exists(path)
        print(f"   ✓ Screenshot exists after deletion: {exists_after}")
        if not exists_after:
            print("   ✓ Deletion verified successfully")
        else:
            print("   ✗ Screenshot still exists after deletion")
    except Exception as e:
        print(f"   ✗ Verification failed: {e}")

    print("\n" + "=" * 60)
    print("Test completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_screenshot_storage())
