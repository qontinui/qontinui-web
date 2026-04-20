"""
Core visual comparison engine.

Handles image conversion, comparison algorithms (SSIM, histogram, pixel diff),
and diff image upload.
"""

import io
from datetime import UTC, datetime
from uuid import UUID

import numpy as np
import structlog
from PIL import Image

from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)

# Storage path for diff images
DIFF_STORAGE_PREFIX = "visual-diffs"


class ComparisonEngine:
    """Core comparison logic for visual regression testing."""

    def __init__(self):
        self.storage = object_storage
        self._comparator = None

    @property
    def comparator(self):
        """Lazy-load the comparator from qontinui library."""
        if self._comparator is None:
            try:
                from qontinui.vision.comparison import VisualComparator

                self._comparator = VisualComparator()
            except ImportError:
                logger.error("qontinui library not available for visual comparison")
                raise ImportError(
                    "qontinui library is required for visual comparison. "
                    "Install with: pip install qontinui"
                )
        return self._comparator

    def _bytes_to_numpy(self, image_bytes: bytes) -> np.ndarray:
        """Convert image bytes to numpy array."""
        image_file = io.BytesIO(image_bytes)
        with Image.open(image_file) as img:
            return np.array(img.convert("RGB"))

    async def _upload_diff_image(
        self,
        test_run_id: UUID,
        screenshot_id: UUID,
        diff_bytes: bytes,
    ) -> str:
        """Upload diff image to storage."""
        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        filename = f"{screenshot_id}_{timestamp}_diff.png"
        prefix = f"{DIFF_STORAGE_PREFIX}/{test_run_id}"

        image_file = io.BytesIO(diff_bytes)
        storage_key, _ = self.storage.upload_file(
            file_obj=image_file,
            prefix=prefix,
            filename=filename,
            content_type="image/png",
            metadata={
                "test_run_id": str(test_run_id),
                "screenshot_id": str(screenshot_id),
                "type": "diff_image",
            },
            generate_unique_name=False,
        )

        return storage_key
