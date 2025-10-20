"""
Background Removal API endpoint
"""

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.background_removal_service import BackgroundRemovalService

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
async def remove_background(request: RemoveBackgroundRequest):
    """
    Remove backgrounds from screenshots for State Discovery.

    This endpoint:
    1. Accepts base64 encoded screenshots
    2. Applies background removal using configured strategies
    3. Returns RGBA images with transparent backgrounds
    4. Provides statistics about the removal

    Args:
        request: Background removal request with screenshots and config

    Returns:
        Masked screenshots with statistics

    Raises:
        HTTPException: If processing fails or invalid data provided
    """
    try:
        if not request.screenshots:
            raise HTTPException(status_code=400, detail="No screenshots provided")

        logger.info(
            f"Received {len(request.screenshots)} screenshots for background removal"
        )

        if len(request.screenshots) < request.config.min_screenshots_for_variance:
            logger.warning(
                f"Only {len(request.screenshots)} screenshots provided, "
                f"but {request.config.min_screenshots_for_variance} required for temporal variance"
            )

        # Initialize service
        logger.info("Initializing BackgroundRemovalService")
        service = BackgroundRemovalService(request.config.model_dump())

        # Process screenshots (all encoding/decoding handled by qontinui library)
        logger.info("Processing screenshots...")
        masked_screenshots, stats = service.remove_backgrounds_base64(
            request.screenshots, debug=request.debug
        )
        logger.info(
            f"Processing complete: {len(masked_screenshots)} masked screenshots"
        )

        # Extract debug mask if present
        background_mask_b64 = stats.pop("background_mask_base64", None)

        # Build response
        response = RemoveBackgroundResponse(
            masked_screenshots=masked_screenshots,
            statistics=BackgroundRemovalStatistics(
                total_pixels=stats["total_pixels"],
                background_pixels=stats["background_pixels"],
                foreground_pixels=stats["foreground_pixels"],
                background_percentage=stats["background_percentage"],
                foreground_percentage=stats["foreground_percentage"],
                num_screenshots=stats["num_screenshots"],
                image_size=tuple(stats["image_size"]),
            ),
            background_mask=background_mask_b64,
        )

        logger.info(
            f"Background removal complete: {len(request.screenshots)} screenshots processed, "
            f"{stats['foreground_percentage']:.1f}% foreground"
        )

        return response

    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Background removal failed: {e}", exc_info=True)
        # Include more detailed error information
        import traceback

        error_detail = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        logger.error(f"Full traceback:\n{error_detail}")
        raise HTTPException(
            status_code=500, detail=f"Background removal failed: {str(e)}"
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
