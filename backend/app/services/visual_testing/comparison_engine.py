"""
Core visual comparison engine.

Handles image conversion, comparison algorithms (SSIM, histogram, pixel diff),
and diff image upload.

NOTE: As of plan-2026-05-17-web-image-slim, the comparator property raises
HTTPException(503) — qontinui.vision.comparison no longer ships with the web
image. The runner-bridge replacement is tracked under
plan-2026-05-17-ws-bridge-for-violating-routers.
"""

import io
from datetime import UTC, datetime
from uuid import UUID

import numpy as np
import structlog
from fastapi import HTTPException, status
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
        """Lazy-load the comparator (historically backed by qontinui.vision).

        Raises HTTPException(503) until the runner-bridge ships —
        qontinui.vision.comparison no longer lives in the web image
        (plan-2026-05-17-web-image-slim). FastAPI propagates the 503
        envelope from whichever route handler accessed this property.
        DEFERRED: ws-bridge.
        """
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "endpoint_requires_runner_bridge",
                "message": (
                    "This endpoint depends on qontinui runtime functionality that lives on "
                    "the runner. The web - runner WebSocket bridge for this functionality is "
                    "not yet implemented. See architectural-decisions.md "
                    "'Web - runner WebSocket boundary'."
                ),
                "runner_module": "qontinui.vision.comparison",
                "endpoint": "comparison_engine.comparator",
                "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
            },
        )

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
