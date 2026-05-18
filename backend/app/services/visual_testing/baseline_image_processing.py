"""
Baseline image processing utilities.

Handles downloading, hashing, thumbnailing, and uploading baseline images.

Phase 7 of plan ``plans/2026-05-17-web-runner-ws-bridge-plan-b.md`` routes
the perceptual-hash computation through the runner WebSocket bridge via
the ``vision.compute_perceptual_hash`` command (a thin wrapper around
:meth:`qontinui.vision.comparison.VisualComparator.compute_perceptual_hash`).
The web tier no longer imports ``qontinui.vision``; it pipes image bytes
to the user's connected runner over Redis pub/sub and round-trips the
hex hash string.
"""

import base64
import io
from datetime import UTC, datetime
from uuid import UUID, uuid4

import structlog
from PIL import Image
from qontinui_schemas.commands.vision import (
    ComputePerceptualHashRequest,
    ComputePerceptualHashResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_config import get_redis
from app.services.object_storage import object_storage
from app.services.runner import (
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
    pick_active_runner_for_user,
    runner_bridge_503_no_runner,
)
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

# Storage paths for baselines
BASELINE_STORAGE_PREFIX = "visual-baselines"
THUMBNAIL_SIZE = (200, 200)

# Endpoint identifier surfaced inside ``runner_bridge_503_no_runner`` when
# this code path falls back to the no-runner envelope. The actual HTTP
# route varies (baselines/from-upload, baselines/from-screenshot, ...);
# this identifier is the SERVICE-LEVEL key so frontends know which
# subsystem failed.
_PERCEPTUAL_HASH_ENDPOINT = (
    "/api/v1/baselines/* (perceptual_hash via vision.compute_perceptual_hash)"
)

# Synchronous request/reply timeout for the perceptual-hash dispatch.
# The runtime function is sub-second on typical UI screenshots;
# 30s leaves wide headroom for unusual payloads + transient backpressure.
_HASH_TIMEOUT_S = 30.0


class BaselineImageProcessing:
    """Image processing operations for visual baselines."""

    def __init__(self):
        self.storage = object_storage

    async def _download_image(self, storage_path: str) -> bytes:
        """Download image bytes from storage."""
        return self.storage.download_file(storage_path)

    async def _compute_perceptual_hash(
        self,
        image_bytes: bytes,
        *,
        db: AsyncSession,
        user_id: UUID,
    ) -> str | None:
        """Compute perceptual hash for an image via the runner WS bridge.

        Picks the user's most-recently-heartbeat-active connected runner
        (via :func:`pick_active_runner_for_user`) and dispatches the
        ``vision.compute_perceptual_hash`` command with the image
        base64-encoded. Returns the hex perceptual-hash string on
        success or ``None`` when the runner reports
        ``imagehash_unavailable`` (caller treats ``None`` as "skip the
        hash; baseline still persists").

        Raises:
            HTTPException(503): no connected runner for the user
                (via :func:`runner_bridge_503_no_runner`).
            HTTPException(504): runner accepted the command but did
                not respond within ``_HASH_TIMEOUT_S``.
            HTTPException(500): runner replied with a
                ``qontinui_exception`` / ``internal_error`` /
                ``invalid_payload`` envelope.
        """
        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)

        runner = await pick_active_runner_for_user(user_id, db, manager.registry)
        if runner is None:
            raise runner_bridge_503_no_runner(_PERCEPTUAL_HASH_ENDPOINT)

        request_id = uuid4()
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        cmd = ComputePerceptualHashRequest(
            request_id=request_id,
            image_b64=image_b64,
        ).model_dump(mode="json")

        logger.info(
            "perceptual_hash_dispatch",
            runner_id=str(runner.id),
            request_id=str(request_id),
            image_size_bytes=len(image_bytes),
        )

        try:
            raw_response = await manager.relay.dispatch_and_wait(
                str(runner.id),
                cmd,
                request_id=str(request_id),
                timeout_s=_HASH_TIMEOUT_S,
            )
        except RunnerNotConnectedError:
            logger.warning(
                "perceptual_hash_runner_disconnected_mid_dispatch",
                runner_id=str(runner.id),
                request_id=str(request_id),
            )
            raise runner_bridge_503_no_runner(_PERCEPTUAL_HASH_ENDPOINT)
        except RunnerCommandTimeoutError:
            from fastapi import HTTPException, status

            logger.error(
                "perceptual_hash_timeout",
                runner_id=str(runner.id),
                request_id=str(request_id),
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "error": "runner_timeout",
                    "endpoint": _PERCEPTUAL_HASH_ENDPOINT,
                    "request_id": str(request_id),
                },
            )

        # The runner may surface a structured soft-error envelope when
        # the optional ``imagehash`` package is missing. Treat that as
        # "no hash available" rather than 500 — the baseline is still
        # creatable, just without phash-based pre-filtering. Other
        # error envelopes (qontinui_exception / invalid_payload /
        # internal_error) DO propagate as 500.
        runner_error = raw_response.get("error")
        if runner_error == "imagehash_unavailable":
            logger.warning(
                "perceptual_hash_imagehash_unavailable",
                runner_id=str(runner.id),
                request_id=str(request_id),
                message=raw_response.get("message"),
            )
            return None
        if runner_error:
            from fastapi import HTTPException, status

            logger.error(
                "perceptual_hash_runner_error",
                runner_id=str(runner.id),
                request_id=str(request_id),
                error=runner_error,
                message=raw_response.get("message"),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error": "runner_error",
                    "runner_error": runner_error,
                    "message": raw_response.get("message")
                    or "Runner returned an error.",
                },
            )

        response = ComputePerceptualHashResponse.model_validate(raw_response)
        logger.info(
            "perceptual_hash_completed",
            runner_id=str(runner.id),
            request_id=str(request_id),
        )
        return str(response.hash_hex)

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
