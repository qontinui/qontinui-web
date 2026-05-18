"""
Core visual comparison engine.

Handles image conversion, runner-WS dispatch for the actual comparison
(SSIM, pixel diff, perceptual hash via
:meth:`qontinui.vision.comparison.VisualComparator.compare`), and diff
image upload.

Phase 7 of plan ``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``
routes the comparison through the runner WebSocket bridge via the
``vision.compare_screenshots`` command. The web tier no longer imports
``qontinui.vision``; it pipes image bytes to the user's connected
runner over Redis pub/sub and round-trips a structured
``ComparisonResult`` payload plus an optional diff PNG (base64).
"""

import base64
import io
from datetime import UTC, datetime
from uuid import UUID, uuid4

import numpy as np
import structlog
from fastapi import HTTPException, status
from PIL import Image
from qontinui_schemas.commands.vision import (
    CompareScreenshotsRequest,
    CompareScreenshotsResponse,
    IgnoreRegionPayload,
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

# Storage path for diff images
DIFF_STORAGE_PREFIX = "visual-diffs"

# Endpoint identifier surfaced inside ``runner_bridge_503_no_runner`` when
# the compare path falls back to the no-runner envelope. The actual HTTP
# route varies (screenshots/{id}/compare, runs/{id}/visual-compare, ...);
# this identifier is the SERVICE-LEVEL key so frontends know which
# subsystem failed.
_COMPARE_ENDPOINT = (
    "/api/v1/visual-comparison/* (compare via vision.compare_screenshots)"
)

# Synchronous request/reply timeout for the compare dispatch.
# Pixel-diff + ssim are typically <10s on UI screenshots; perceptual hash
# is sub-second; 30s leaves wide headroom.
_COMPARE_TIMEOUT_S = 30.0


class ComparisonEngine:
    """Core comparison logic for visual regression testing."""

    def __init__(self):
        self.storage = object_storage

    def _bytes_to_numpy(self, image_bytes: bytes) -> np.ndarray:
        """Convert image bytes to numpy array (kept for backwards-compat).

        Phase 7 no longer routes the actual comparison through this
        numpy array — :meth:`_dispatch_compare` passes the raw bytes
        (base64-encoded) to the runner. This helper is retained for
        callers that still want the in-memory numpy form (e.g. local
        validation in tests).
        """
        image_file = io.BytesIO(image_bytes)
        with Image.open(image_file) as img:
            return np.array(img.convert("RGB"))

    async def _dispatch_compare(
        self,
        *,
        db: AsyncSession,
        user_id: UUID,
        baseline_bytes: bytes,
        current_bytes: bytes,
        algorithm: str,
        threshold: float | None,
        ignore_regions: list[dict] | None = None,
        generate_diff_image: bool = True,
    ) -> tuple[CompareScreenshotsResponse, bytes | None]:
        """Dispatch the ``vision.compare_screenshots`` command + return parsed result.

        Picks the user's most-recently-heartbeat-active connected runner
        (via :func:`pick_active_runner_for_user`), pipes the image bytes
        + ignore regions + algorithm + threshold over Redis pub/sub, and
        synchronously awaits the response with a 30s timeout.

        Args:
            db: Async DB session (for runner selection).
            user_id: Owning user UUID (for runner selection).
            baseline_bytes: Raw baseline image bytes (PNG/JPEG).
            current_bytes: Raw current screenshot bytes (PNG/JPEG).
            algorithm: Algorithm literal — one of ``ssim`` /
                ``pixel_diff`` / ``perceptual_hash``.
            threshold: Similarity threshold (``None`` => algorithm
                default).
            ignore_regions: Pre-validated dict payloads matching the
                :class:`IgnoreRegionPayload` shape. ``None`` or empty
                list => no ignore regions.
            generate_diff_image: When True (default), the runner
                additionally generates a diff PNG when the comparison
                fails.

        Returns:
            Tuple of ``(parsed response, diff_image_bytes)`` —
            ``diff_image_bytes`` is the decoded PNG bytes when the
            runner returned a base64 diff, else ``None``.

        Raises:
            HTTPException(503): no connected runner.
            HTTPException(504): runner accepted the command but did
                not respond within ``_COMPARE_TIMEOUT_S``.
            HTTPException(500): runner returned an error envelope.
        """
        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)

        runner = await pick_active_runner_for_user(user_id, db, manager.registry)
        if runner is None:
            raise runner_bridge_503_no_runner(_COMPARE_ENDPOINT)

        request_id = uuid4()
        baseline_b64 = base64.b64encode(baseline_bytes).decode("ascii")
        current_b64 = base64.b64encode(current_bytes).decode("ascii")
        regions_payload = [
            IgnoreRegionPayload.model_validate(r) for r in (ignore_regions or [])
        ]

        cmd = CompareScreenshotsRequest(
            request_id=request_id,
            baseline_b64=baseline_b64,
            current_b64=current_b64,
            algorithm=algorithm,  # type: ignore[arg-type]  # validated literal
            threshold=threshold,
            ignore_regions=regions_payload,
            generate_diff_image=generate_diff_image,
        ).model_dump(mode="json")

        logger.info(
            "compare_screenshots_dispatch",
            runner_id=str(runner.id),
            request_id=str(request_id),
            algorithm=algorithm,
            threshold=threshold,
            ignore_region_count=len(regions_payload),
            baseline_size_bytes=len(baseline_bytes),
            current_size_bytes=len(current_bytes),
        )

        try:
            raw_response = await manager.relay.dispatch_and_wait(
                str(runner.id),
                cmd,
                request_id=str(request_id),
                timeout_s=_COMPARE_TIMEOUT_S,
            )
        except RunnerNotConnectedError:
            logger.warning(
                "compare_screenshots_runner_disconnected_mid_dispatch",
                runner_id=str(runner.id),
                request_id=str(request_id),
            )
            raise runner_bridge_503_no_runner(_COMPARE_ENDPOINT)
        except RunnerCommandTimeoutError:
            logger.error(
                "compare_screenshots_timeout",
                runner_id=str(runner.id),
                request_id=str(request_id),
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "error": "runner_timeout",
                    "endpoint": _COMPARE_ENDPOINT,
                    "request_id": str(request_id),
                },
            )

        runner_error = raw_response.get("error")
        if runner_error:
            logger.error(
                "compare_screenshots_runner_error",
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

        response = CompareScreenshotsResponse.model_validate(raw_response)

        diff_bytes: bytes | None = None
        if response.diff_image_b64:
            try:
                diff_bytes = base64.b64decode(response.diff_image_b64, validate=True)
            except (ValueError, TypeError) as exc:
                # Soft-fail: the comparison result is still usable;
                # only the diff PNG is unavailable.
                logger.warning(
                    "compare_screenshots_diff_b64_decode_failed",
                    runner_id=str(runner.id),
                    request_id=str(request_id),
                    error=str(exc),
                )

        logger.info(
            "compare_screenshots_completed",
            runner_id=str(runner.id),
            request_id=str(request_id),
            passed=response.result.passed,
            similarity_score=response.result.similarity_score,
            execution_time_ms=response.result.execution_time_ms,
        )
        return response, diff_bytes

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
