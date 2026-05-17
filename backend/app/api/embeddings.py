"""Embedding computation endpoints.

Serves POST /api/embeddings/compute-text and /api/embeddings/compute-batch
using the qontinui all-MiniLM-L6-v2 model (384 dimensions).

Both the Rust runner (embedding_client.rs) and the web backend's own
semantic_search endpoint call these routes at http://127.0.0.1:8001.

NOTE: As of plan-2026-05-17-web-image-slim, the web backend no longer
depends on `qontinui` (sentence-transformers + torch were ~3.7 GiB of the
image). These endpoints return 503 until the runner-bridge ships
(plan-2026-05-17-ws-bridge-for-violating-routers).
"""

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

router = APIRouter()


# ── Request / response schemas ─────────────────────────────────────


class TextEmbeddingRequest(BaseModel):
    text: str
    model: str = "minilm"


class BatchEmbeddingRequest(BaseModel):
    texts: list[str]
    model: str = "minilm"


class TextEmbeddingResponse(BaseModel):
    success: bool
    embedding: list[float]
    embedding_dim: int
    error: str | None = None


class BatchEmbeddingResponse(BaseModel):
    success: bool
    embeddings: list[list[float]]
    embedding_dim: int


# ── 503 helper ─────────────────────────────────────────────────────


def _runner_bridge_503(endpoint: str) -> HTTPException:
    """Build the structured 503 envelope for endpoints that depend on
    qontinui runtime functionality (now living on the runner)."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "endpoint_requires_runner_bridge",
            "message": (
                "This endpoint depends on qontinui runtime functionality that lives on "
                "the runner. The web - runner WebSocket bridge for this functionality is "
                "not yet implemented. See architectural-decisions.md "
                "'Web - runner WebSocket boundary'."
            ),
            "runner_module": "qontinui.embeddings",
            "endpoint": endpoint,
            "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
        },
    )


# ── Endpoints ──────────────────────────────────────────────────────


@router.post("/compute-text", response_model=TextEmbeddingResponse)
def compute_text_embedding(request: TextEmbeddingRequest) -> TextEmbeddingResponse:
    """Compute a single 384-dim text embedding.

    Returns 503 until the runner-bridge ships — sentence-transformers/torch
    are no longer installed in the web image.
    """
    raise _runner_bridge_503("/api/embeddings/compute-text")


@router.post("/compute-batch", response_model=BatchEmbeddingResponse)
def compute_batch_embedding(request: BatchEmbeddingRequest) -> BatchEmbeddingResponse:
    """Compute 384-dim embeddings for multiple texts.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503("/api/embeddings/compute-batch")


@router.get("/status")
def embedding_status() -> dict[str, object]:
    """Health/status probe for the embedding service.

    Returns a structured "available: false" payload — the qontinui-backed
    provider has been removed pending the runner-bridge.
    """
    return {
        "available": False,
        "error": "embedding_provider_moved_to_runner",
        "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
    }
