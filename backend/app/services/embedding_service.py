"""Service for RAG embeddings.

This service provides methods to:
1. Call qontinui-api for embedding computation (used by runner)
2. Receive and store embedding results from the runner
"""

import os
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

# qontinui-api URL (default to localhost:8001)
QONTINUI_API_URL = os.getenv("QONTINUI_API_URL", "http://localhost:8001")


class EmbeddingService:
    """Service for computing embeddings via qontinui-api."""

    def __init__(self, api_url: str | None = None) -> None:
        """Initialize the embedding service.

        Args:
            api_url: Base URL for qontinui-api. Defaults to QONTINUI_API_URL env var.
        """
        self.api_url = api_url or QONTINUI_API_URL
        self.timeout = 60.0  # Embedding computation can take time

    async def compute_embedding(
        self,
        image_data: str,
        text_description: str | None = None,
        compute_text_embedding: bool = True,
    ) -> dict[str, Any]:
        """Compute embeddings for a single image.

        Args:
            image_data: Base64 encoded image data
            text_description: Optional text description for text embedding
            compute_text_embedding: Whether to compute text embedding

        Returns:
            Dict with image_embedding, text_embedding, ocr_text, ocr_confidence
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.api_url}/api/embeddings/compute",
                    json={
                        "image_data": image_data,
                        "compute_text_embedding": compute_text_embedding,
                        "text_description": text_description,
                    },
                )
                response.raise_for_status()
                result: dict[str, Any] = response.json()
                return result

        except httpx.ConnectError:
            logger.warning(
                "embedding_service_connection_failed",
                api_url=self.api_url,
            )
            return {
                "success": False,
                "error": f"Could not connect to qontinui-api at {self.api_url}",
            }
        except httpx.HTTPStatusError as e:
            logger.error(
                "embedding_service_http_error",
                status_code=e.response.status_code,
                detail=e.response.text,
            )
            return {
                "success": False,
                "error": f"HTTP error {e.response.status_code}: {e.response.text}",
            }
        except Exception as e:
            logger.error("embedding_service_error", error=str(e), exc_info=True)
            return {
                "success": False,
                "error": str(e),
            }

    async def compute_embeddings_batch(
        self,
        images: list[dict[str, Any]],
        compute_text_embeddings: bool = True,
        extract_ocr: bool = True,
    ) -> dict[str, Any]:
        """Compute embeddings for multiple images.

        Args:
            images: List of dicts with 'id', 'image_data', and optional 'text_description'
            compute_text_embeddings: Whether to compute text embeddings
            extract_ocr: Whether to extract OCR text

        Returns:
            Dict with results list containing embeddings for each image
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout * 2) as client:
                response = await client.post(
                    f"{self.api_url}/api/embeddings/compute-batch",
                    json={
                        "images": images,
                        "compute_text_embeddings": compute_text_embeddings,
                        "extract_ocr": extract_ocr,
                    },
                )
                response.raise_for_status()
                batch_result: dict[str, Any] = response.json()
                return batch_result

        except httpx.ConnectError:
            logger.warning(
                "embedding_service_batch_connection_failed",
                api_url=self.api_url,
            )
            return {
                "success": False,
                "error": f"Could not connect to qontinui-api at {self.api_url}",
                "results": [],
            }
        except httpx.HTTPStatusError as e:
            logger.error(
                "embedding_service_batch_http_error",
                status_code=e.response.status_code,
                detail=e.response.text,
            )
            return {
                "success": False,
                "error": f"HTTP error {e.response.status_code}: {e.response.text}",
                "results": [],
            }
        except Exception as e:
            logger.error("embedding_service_batch_error", error=str(e), exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "results": [],
            }

    async def warmup_models(self) -> dict[str, Any]:
        """Warm up embedding models on qontinui-api.

        Call this before computing embeddings to avoid cold-start latency.
        """
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{self.api_url}/api/embeddings/warmup",
                )
                response.raise_for_status()
                warmup_result: dict[str, Any] = response.json()
                return warmup_result

        except Exception as e:
            logger.warning("embedding_warmup_failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
            }

    async def get_status(self) -> dict[str, Any]:
        """Get the status of embedding models on qontinui-api."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.api_url}/api/embeddings/status",
                )
                response.raise_for_status()
                status_result: dict[str, Any] = response.json()
                return status_result

        except Exception as e:
            logger.warning("embedding_status_failed", error=str(e))
            return {
                "clip_model": "unavailable",
                "text_model": "unavailable",
                "ocr_engine": "unavailable",
                "error": str(e),
            }


async def compute_embeddings_for_state_images(
    config: dict[str, Any],
    embedding_service: EmbeddingService | None = None,
) -> dict[str, Any]:
    """Compute embeddings for all RAG-enabled StateImages in a configuration.

    This function iterates through all states and their stateImages, computing
    embeddings for those with searchMode="rag". The config is modified in place
    with computed embeddings.

    Args:
        config: Configuration dictionary with states, stateImages, and images
        embedding_service: EmbeddingService instance (created if not provided)

    Returns:
        Dict with statistics about embedding computation
    """
    if embedding_service is None:
        embedding_service = EmbeddingService()

    # Build image lookup from config
    image_lookup: dict[str, str] = {}
    for image in config.get("images", []):
        image_id = image.get("id")
        image_data = image.get("data")
        if image_id and image_data:
            image_lookup[image_id] = image_data

    # Collect StateImages that need embeddings
    state_images_to_process: list[dict[str, Any]] = []

    for state in config.get("states", []):
        for state_image in state.get("stateImages", []):
            search_mode = state_image.get("searchMode", "default")

            # Only process RAG-enabled StateImages
            if search_mode != "rag":
                continue

            # Check if embeddings already exist
            if state_image.get("imageEmbedding"):
                continue

            # Get the image data from patterns
            patterns = state_image.get("patterns", [])
            if not patterns:
                continue

            first_pattern = patterns[0]
            image_id = first_pattern.get("imageId")
            if not image_id or image_id not in image_lookup:
                continue

            state_images_to_process.append(
                {
                    "state_id": state.get("id"),
                    "state_image_id": state_image.get("id"),
                    "state_image": state_image,
                    "image_id": image_id,
                    "image_data": image_lookup[image_id],
                }
            )

    if not state_images_to_process:
        logger.info("embedding_computation_skipped", reason="No RAG StateImages found")
        return {
            "processed": 0,
            "successful": 0,
            "failed": 0,
            "skipped": 0,
        }

    logger.info(
        "embedding_computation_starting",
        total_state_images=len(state_images_to_process),
    )

    # Prepare batch request
    batch_images = []
    for item in state_images_to_process:
        batch_images.append(
            {
                "id": item["state_image_id"],
                "image_data": item["image_data"],
                "text_description": item["state_image"].get("name"),
            }
        )

    # Compute embeddings in batch
    batch_result = await embedding_service.compute_embeddings_batch(
        images=batch_images,
        compute_text_embeddings=True,
        extract_ocr=True,
    )

    if not batch_result.get("success") and not batch_result.get("results"):
        logger.error(
            "embedding_computation_failed",
            error=batch_result.get("error"),
        )
        return {
            "processed": len(state_images_to_process),
            "successful": 0,
            "failed": len(state_images_to_process),
            "skipped": 0,
            "error": batch_result.get("error"),
        }

    # Map results back to StateImages
    results_by_id = {r["id"]: r for r in batch_result.get("results", [])}
    successful = 0
    failed = 0

    for item in state_images_to_process:
        state_image = item["state_image"]
        result = results_by_id.get(item["state_image_id"])

        if not result or not result.get("success"):
            failed += 1
            continue

        # Update StateImage with computed embeddings
        if result.get("image_embedding"):
            state_image["imageEmbedding"] = result["image_embedding"]

        if result.get("text_embedding"):
            state_image["textEmbedding"] = result["text_embedding"]

        if result.get("ocr_text"):
            state_image["ocrText"] = result["ocr_text"]

        if result.get("ocr_confidence") is not None:
            state_image["ocrConfidence"] = result["ocr_confidence"]

        successful += 1

    logger.info(
        "embedding_computation_complete",
        processed=len(state_images_to_process),
        successful=successful,
        failed=failed,
    )

    return {
        "processed": len(state_images_to_process),
        "successful": successful,
        "failed": failed,
        "skipped": 0,
    }


def apply_embedding_results_to_config(
    config: dict[str, Any],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply embedding results from runner to a configuration.

    This function takes embedding results computed by the runner and updates
    the corresponding StateImages in the configuration.

    Args:
        config: Configuration dictionary with states and stateImages
        results: List of embedding results with structure:
            - state_image_id: ID of the StateImage
            - success: Whether embedding was successful
            - image_embedding: CLIP image embedding (512 dimensions)
            - text_embedding: Text embedding (384 dimensions)
            - ocr_text: Extracted OCR text
            - ocr_confidence: OCR confidence score

    Returns:
        Dict with statistics about applied results
    """
    # Build lookup of StateImages by ID
    state_image_lookup: dict[str, dict[str, Any]] = {}
    for state in config.get("states", []):
        for state_image in state.get("stateImages", []):
            state_image_id = state_image.get("id")
            if state_image_id:
                state_image_lookup[state_image_id] = state_image

    successful = 0
    failed = 0
    not_found = 0

    for result in results:
        state_image_id = result.get("state_image_id")
        if not state_image_id:
            failed += 1
            continue

        state_image = state_image_lookup.get(state_image_id)
        if not state_image:
            not_found += 1
            logger.warning(
                "state_image_not_found",
                state_image_id=state_image_id,
            )
            continue

        if not result.get("success"):
            failed += 1
            continue

        # Apply embedding results
        if result.get("image_embedding"):
            state_image["imageEmbedding"] = result["image_embedding"]

        if result.get("text_embedding"):
            state_image["textEmbedding"] = result["text_embedding"]

        if result.get("ocr_text"):
            state_image["ocrText"] = result["ocr_text"]

        if result.get("ocr_confidence") is not None:
            state_image["ocrConfidence"] = result["ocr_confidence"]

        successful += 1

    logger.info(
        "embedding_results_applied",
        successful=successful,
        failed=failed,
        not_found=not_found,
    )

    return {
        "successful": successful,
        "failed": failed,
        "not_found": not_found,
        "total": len(results),
    }
