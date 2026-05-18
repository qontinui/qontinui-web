"""
Background Removal API endpoint.

Dispatches the cv2+numpy background-removal work to a connected
qontinui-runner over the WS bridge (Phase 6 of plan
``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``). The runner
invokes
``qontinui.discovery.background_removal.remove_backgrounds_from_base64``
and returns masked screenshots + analyser statistics; this endpoint
re-emits them in the existing ``RemoveBackgroundResponse`` shape so
existing callers are unchanged.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.user import User
from app.services.background_removal_service import BackgroundRemovalService
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


class BackgroundRemovalConfig(BaseModel):
    """Configuration for background removal."""

    # Detection strategies
    use_temporal_variance: bool = True
    use_edge_density: bool = True
    use_uniformity: bool = True

    # Temporal variance thresholds
    variance_threshold: float = 20.0
    min_screenshots_for_variance: int = 3

    # Edge density thresholds
    edge_density_threshold: float = 0.05
    edge_kernel_size: int = 3

    # Uniformity thresholds
    uniformity_threshold: float = 15.0
    uniformity_region_size: int = 20

    # Morphological operations
    apply_morphology: bool = True
    morphology_kernel_size: int = 3
    min_foreground_region_size: int = 50

    # Output format
    foreground_alpha: int = 255
    background_alpha: int = 0


class RemoveBackgroundRequest(BaseModel):
    """Request model for background removal."""

    screenshots: list[str]  # Base64 encoded images
    config: BackgroundRemovalConfig
    debug: bool = False


class BackgroundRemovalStatistics(BaseModel):
    """Statistics from background removal."""

    total_pixels: int
    background_pixels: int
    foreground_pixels: int
    background_percentage: float
    foreground_percentage: float
    num_screenshots: int
    image_size: tuple[int, int]


class RemoveBackgroundResponse(BaseModel):
    """Response model for background removal."""

    masked_screenshots: list[str]  # Base64 encoded RGBA images
    statistics: BackgroundRemovalStatistics
    background_mask: str | None = None  # Base64 encoded mask (debug mode)


@router.post("/remove-background", response_model=RemoveBackgroundResponse)
async def remove_background(
    request: RemoveBackgroundRequest,
    runner_id: UUID | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> RemoveBackgroundResponse:
    """
    Remove backgrounds from screenshots for State Discovery.

    Dispatches the cv2-based work to the user's currently-connected
    qontinui-runner over the WS bridge. Behaviour:

    1. Accepts base64 encoded screenshots.
    2. Forwards the batch + config to the active runner.
    3. Returns RGBA images with transparent backgrounds.
    4. Provides analyser statistics about the removal.

    **Runner selection:**

    - If ``?runner_id=<uuid>`` is provided, that runner is used (must
      belong to the current user).
    - Otherwise the user's most-recently-heartbeat-active connected
      runner is selected.
    - If no runner is connected, returns 503 with the
      ``no_runner_connected`` envelope.

    Args:
        request: Background removal request with screenshots and config.
        runner_id: Optional explicit runner UUID; must belong to caller.

    Returns:
        Masked screenshots with statistics.

    Raises:
        HTTPException: 400 on empty input, 413 on >20 MB payload, 503
            when no runner is available, 504 on runner timeout, 500 on
            runner-side error.
    """
    if not request.screenshots:
        raise HTTPException(status_code=400, detail="No screenshots provided")

    logger.info(
        "background_removal_request",
        num_screenshots=len(request.screenshots),
        debug=request.debug,
        user_id=str(current_user.id),
    )

    if len(request.screenshots) < request.config.min_screenshots_for_variance:
        logger.warning(
            "background_removal_screenshot_count_below_variance_threshold",
            provided=len(request.screenshots),
            required=request.config.min_screenshots_for_variance,
        )

    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)

    service = BackgroundRemovalService(
        user_id=current_user.id,
        db=db,
        manager=manager,
        runner_id=runner_id,
    )

    masked_screenshots, stats = await service.remove_backgrounds(
        screenshots_b64=request.screenshots,
        config=request.config.model_dump(),
        debug=request.debug,
    )

    logger.info(
        "background_removal_complete",
        num_screenshots=len(request.screenshots),
        num_masked=len(masked_screenshots),
    )

    # Extract debug mask if present
    stats_local: dict[str, Any] = dict(stats)
    background_mask_b64 = stats_local.pop("background_mask_base64", None)

    return RemoveBackgroundResponse(
        masked_screenshots=masked_screenshots,
        statistics=BackgroundRemovalStatistics(
            total_pixels=stats_local["total_pixels"],
            background_pixels=stats_local["background_pixels"],
            foreground_pixels=stats_local["foreground_pixels"],
            background_percentage=stats_local["background_percentage"],
            foreground_percentage=stats_local["foreground_percentage"],
            num_screenshots=stats_local["num_screenshots"],
            image_size=tuple(stats_local["image_size"]),  # type: ignore[arg-type]
        ),
        background_mask=background_mask_b64,
    )


@router.get("/background-removal/presets")
async def get_presets():
    """
    Get available background removal preset configurations.

    Returns:
        Dictionary of preset names and their configurations
    """
    presets = {
        "balanced": BackgroundRemovalConfig().model_dump(),
        "dynamic": BackgroundRemovalConfig(
            use_temporal_variance=True,
            use_edge_density=False,
            use_uniformity=False,
            variance_threshold=10.0,
        ).model_dump(),
        "subtle": BackgroundRemovalConfig(
            use_temporal_variance=False,
            use_edge_density=True,
            use_uniformity=True,
            edge_density_threshold=0.03,
            uniformity_threshold=15.0,
        ).model_dump(),
        "aggressive": BackgroundRemovalConfig(
            variance_threshold=15.0,
            edge_density_threshold=0.07,
            uniformity_threshold=20.0,
        ).model_dump(),
        "gentle": BackgroundRemovalConfig(
            variance_threshold=30.0,
            edge_density_threshold=0.03,
            uniformity_threshold=10.0,
        ).model_dump(),
    }

    return {"presets": presets}
