"""
Baseline image processing utilities.

Handles downloading, hashing, thumbnailing, and uploading baseline images.

NOTE: As of plan-2026-05-17-web-image-slim, the perceptual-hash helper raises
HTTPException(503) — qontinui.vision.comparison no longer ships with the web
image. The runner-bridge replacement is tracked under
plan-2026-05-17-ws-bridge-for-violating-routers.
"""

import io
from datetime import UTC, datetime
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from PIL import Image

from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)

# Storage paths for baselines
BASELINE_STORAGE_PREFIX = "visual-baselines"
THUMBNAIL_SIZE = (200, 200)


class BaselineImageProcessing:
    """Image processing operations for visual baselines."""

    def __init__(self):
        self.storage = object_storage

    async def _download_image(self, storage_path: str) -> bytes:
        """Download image bytes from storage."""
        return self.storage.download_file(storage_path)

    async def _compute_perceptual_hash(self, image_bytes: bytes) -> str | None:
        """Compute perceptual hash for an image.

        Raises HTTPException(503) until the runner-bridge ships — qontinui.vision.comparison
        no longer lives in the web image. FastAPI propagates the 503 envelope
        from whichever route handler called us. DEFERRED: ws-bridge.
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
                "endpoint": "baseline_image_processing._compute_perceptual_hash",
                "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
            },
        )

    async def _create_thumbnail(self, image_bytes: bytes) -> bytes:
        """Create a thumbnail from image bytes."""
        image_file = io.BytesIO(image_bytes)
        with Image.open(image_file) as img:
            img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            thumb_buffer = io.BytesIO()
            img.save(thumb_buffer, format="PNG")
            return thumb_buffer.getvalue()

    async def _upload_baseline_image(
        self,
        project_id: UUID,
        state_name: str,
        version: int,
        image_bytes: bytes,
        is_thumbnail: bool,
    ) -> str:
        """Upload a baseline image to storage."""
        safe_state_name = "".join(
            c if c.isalnum() or c in "-_" else "_" for c in state_name
        )

        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        suffix = "_thumb" if is_thumbnail else ""
        filename = f"v{version}_{timestamp}{suffix}.png"

        prefix = f"{BASELINE_STORAGE_PREFIX}/{project_id}/{safe_state_name}"

        image_file = io.BytesIO(image_bytes)
        storage_key, storage_url = self.storage.upload_file(
            file_obj=image_file,
            prefix=prefix,
            filename=filename,
            content_type="image/png",
            metadata={
                "project_id": str(project_id),
                "state_name": state_name,
                "version": str(version),
                "is_thumbnail": str(is_thumbnail),
            },
            generate_unique_name=False,
        )

        return storage_key

    async def _deactivate_existing_baselines(
        self,
        db,
        project_id: UUID,
        state_name: str,
        workflow_id: str | None,
    ) -> None:
        """Deactivate all existing baselines for a state."""
        from sqlalchemy import and_, select

        from app.models.visual_baseline import VisualBaseline

        conditions = [
            VisualBaseline.project_id == project_id,
            VisualBaseline.state_name == state_name,
            VisualBaseline.is_active.is_(True),
        ]

        if workflow_id:
            conditions.append(VisualBaseline.workflow_id == workflow_id)
        else:
            conditions.append(VisualBaseline.workflow_id.is_(None))

        result = await db.execute(select(VisualBaseline).where(and_(*conditions)))

        for baseline in result.scalars().all():
            baseline.is_active = False
            baseline.updated_at = datetime.now(UTC)

        await db.flush()

    async def _get_next_version(
        self,
        db,
        project_id: UUID,
        state_name: str,
        workflow_id: str | None,
    ) -> int:
        """Get the next version number for a state's baseline."""
        from sqlalchemy import and_, func, select

        from app.models.visual_baseline import VisualBaseline

        conditions = [
            VisualBaseline.project_id == project_id,
            VisualBaseline.state_name == state_name,
        ]

        if workflow_id:
            conditions.append(VisualBaseline.workflow_id == workflow_id)
        else:
            conditions.append(VisualBaseline.workflow_id.is_(None))

        result = await db.execute(
            select(func.max(VisualBaseline.version)).where(and_(*conditions))
        )
        max_version = result.scalar()

        return (max_version or 0) + 1
