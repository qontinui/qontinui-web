"""
Template matching service for UI element detection.

Interfaces with the runner for semantic analysis and element detection.
"""

import io

import httpx
import structlog
from app.core.config import settings
from PIL import Image

logger = structlog.get_logger(__name__)


class TemplateMatcherService:
    """Service for matching UI elements using external API."""

    @staticmethod
    async def detect_with_api(
        image: Image.Image, config: dict
    ) -> tuple[list[dict], bool]:
        """
        Detect elements using the runner.

        Args:
            image: PIL Image of the screenshot
            config: Detection configuration with options:
                - extract_text: bool - Extract text from elements
                - detect_elements: bool - Detect UI elements
                - segment_regions: bool - Segment regions

        Returns:
            Tuple of (detected elements list, success flag)
        """
        try:
            # Save image to bytes
            image_buffer = io.BytesIO()
            image.save(image_buffer, format="PNG")
            image_buffer.seek(0)

            # Call runner semantic analysis endpoint
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.QONTINUI_API_URL}/api/semantic/analyze",
                    files={"image": ("screenshot.png", image_buffer, "image/png")},
                    data={
                        "extract_text": config.get("extract_text", True),
                        "detect_elements": config.get("detect_elements", True),
                        "segment_regions": config.get("segment_regions", False),
                    },
                )

                if response.status_code == 200:
                    result = response.json()
                    elements = TemplateMatcherService.parse_api_response(result)
                    logger.info(
                        "api_detection_successful",
                        element_count=len(elements),
                    )
                    return elements, True
                else:
                    logger.warning(
                        "runner_detection_failed",
                        status=response.status_code,
                        response=response.text[:500],
                    )
                    return [], False

        except httpx.TimeoutException:
            logger.error("api_detection_timeout")
            return [], False
        except Exception as e:
            logger.error("api_detection_error", error=str(e))
            return [], False

    @staticmethod
    def parse_api_response(api_result: dict) -> list[dict]:
        """
        Parse runner response into element format.

        Args:
            api_result: Response from the runner with 'regions' and 'text_regions'

        Returns:
            List of element dictionaries with standardized structure
        """
        elements = []

        # Parse detected regions
        if "regions" in api_result:
            for region in api_result["regions"]:
                element = {
                    "element_type": region.get("type", "unknown"),
                    "x": region.get("x", 0),
                    "y": region.get("y", 0),
                    "width": region.get("width", 0),
                    "height": region.get("height", 0),
                    "text_content": region.get("text"),
                    "confidence": region.get("confidence", 0.5),
                    "properties": {
                        "color": region.get("color"),
                        "background": region.get("background"),
                        "semantic_label": region.get("label"),
                    },
                    "visual_hash": region.get("hash"),
                }
                elements.append(element)

        # Parse text detections
        if "text_regions" in api_result:
            for text_region in api_result["text_regions"]:
                element = {
                    "element_type": "text",
                    "x": text_region.get("bbox", [0, 0, 0, 0])[0],
                    "y": text_region.get("bbox", [0, 0, 0, 0])[1],
                    "width": text_region.get("bbox", [0, 0, 0, 0])[2],
                    "height": text_region.get("bbox", [0, 0, 0, 0])[3],
                    "text_content": text_region.get("text"),
                    "confidence": text_region.get("confidence", 0.8),
                    "properties": {"font_size": text_region.get("font_size")},
                }
                elements.append(element)

        return elements
