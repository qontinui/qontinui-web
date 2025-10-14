"""
Background Removal API endpoint
"""

import base64
import logging

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.background_removal_service import BackgroundRemovalService

logger = logging.getLogger(__name__)

router = APIRouter()

# Try to import cv2, but make it optional
try:
    import cv2

    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    logger.warning(
        "opencv-python not installed - background removal endpoint will be disabled"
    )


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
    1. Decodes base64 screenshots
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
    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="Background removal is not available. OpenCV (opencv-python) is not installed.",
        )

    try:
        if not request.screenshots:
            raise HTTPException(status_code=400, detail="No screenshots provided")

        if len(request.screenshots) < request.config.min_screenshots_for_variance:
            logger.warning(
                f"Only {len(request.screenshots)} screenshots provided, "
                f"but {request.config.min_screenshots_for_variance} required for temporal variance"
            )

        # Initialize service
        service = BackgroundRemovalService(request.config.model_dump())

        # Decode screenshots from base64
        decoded_screenshots = []
        for idx, screenshot_b64 in enumerate(request.screenshots):
            try:
                # Remove data URL prefix if present
                if "," in screenshot_b64:
                    screenshot_b64 = screenshot_b64.split(",")[1]

                # Decode base64
                img_bytes = base64.b64decode(screenshot_b64)
                nparr = np.frombuffer(img_bytes, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if img is None:
                    raise ValueError(f"Failed to decode screenshot {idx}")

                decoded_screenshots.append(img)
            except Exception as e:
                logger.error(f"Failed to decode screenshot {idx}: {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to decode screenshot {idx}: {str(e)}",
                )

        # Remove backgrounds
        masked_screenshots, stats = service.remove_backgrounds(
            decoded_screenshots, debug=request.debug
        )

        # Encode masked screenshots to base64
        encoded_screenshots = []
        for masked_img in masked_screenshots:
            # Encode as PNG (supports alpha channel)
            _, buffer = cv2.imencode(".png", masked_img)
            img_b64 = base64.b64encode(buffer).decode("utf-8")
            # Add data URL prefix
            img_data_url = f"data:image/png;base64,{img_b64}"
            encoded_screenshots.append(img_data_url)

        # Encode background mask if debug mode
        background_mask_b64 = None
        if request.debug and "background_mask" in stats:
            mask = stats["background_mask"]
            _, buffer = cv2.imencode(".png", mask)
            mask_b64 = base64.b64encode(buffer).decode("utf-8")
            background_mask_b64 = f"data:image/png;base64,{mask_b64}"

        # Build response
        response = RemoveBackgroundResponse(
            masked_screenshots=encoded_screenshots,
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
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Background removal failed: {e}", exc_info=True)
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
