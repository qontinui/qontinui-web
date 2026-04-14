"""Embedding computation endpoints.

Serves POST /api/embeddings/compute-text and /api/embeddings/compute-batch
using the qontinui all-MiniLM-L6-v2 model (384 dimensions).

Both the Rust runner (embedding_client.rs) and the web backend's own
semantic_search endpoint call these routes at http://127.0.0.1:8001.
"""

import threading

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

router = APIRouter()

# Lazy-loaded, thread-safe singleton for the embedding provider.
_provider = None
_provider_lock = threading.Lock()


def _get_provider():
    global _provider
    if _provider is not None:
        return _provider
    with _provider_lock:
        if _provider is not None:
            return _provider
        try:
            from qontinui.embeddings import (
                EmbeddingConfig,
                EmbeddingProviderType,
                get_embedding_provider,
            )

            config = EmbeddingConfig(provider=EmbeddingProviderType.SENTENCE_TRANSFORMERS)
            _provider = get_embedding_provider(config)
            logger.info(
                "embedding_provider_loaded",
                model=config.model_name,
                dim=_provider.dimension,
            )
        except Exception as e:
            logger.error("embedding_provider_load_failed", error=str(e))
            raise
    return _provider


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


# ── Endpoints ──────────────────────────────────────────────────────


@router.post("/compute-text", response_model=TextEmbeddingResponse)
def compute_text_embedding(request: TextEmbeddingRequest):
    """Compute a single 384-dim text embedding.

    Uses `def` (not `async def`) so FastAPI runs the CPU-bound
    sentence-transformers inference in a threadpool worker, avoiding
    blocking the event loop.
    """
    try:
        provider = _get_provider()
        vec = provider.embed(request.text)
        return TextEmbeddingResponse(
            success=True,
            embedding=vec.tolist(),
            embedding_dim=len(vec),
        )
    except Exception as e:
        logger.error("compute_text_embedding_failed", error=str(e))
        return TextEmbeddingResponse(
            success=False,
            embedding=[],
            embedding_dim=0,
            error=str(e),
        )


@router.post("/compute-batch", response_model=BatchEmbeddingResponse)
def compute_batch_embedding(request: BatchEmbeddingRequest):
    """Compute 384-dim embeddings for multiple texts."""
    try:
        provider = _get_provider()
        matrix = provider.embed_batch(request.texts)
        return BatchEmbeddingResponse(
            success=True,
            embeddings=[row.tolist() for row in matrix],
            embedding_dim=int(matrix.shape[1]) if len(matrix) > 0 else 384,
        )
    except Exception as e:
        logger.error("compute_batch_embedding_failed", error=str(e))
        return BatchEmbeddingResponse(
            success=False,
            embeddings=[],
            embedding_dim=0,
        )


@router.get("/status")
def embedding_status():
    """Health/status probe for the embedding service."""
    try:
        provider = _get_provider()
        return {
            "available": True,
            "model": "all-MiniLM-L6-v2",
            "dimension": provider.dimension,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}
