"""Text embedder for the tenant agentic-memory substrate.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

Embeds memory content for the pgvector semantic-retrieval arm of
``coord.memory_records`` (384-dim, HNSW/cosine — see the
``coord_memory_records`` alembic migration). The model is
``sentence-transformers/all-MiniLM-L6-v2`` run through **fastembed**
(Qdrant's ONNX wrapper) — deliberately NOT torch/sentence-transformers,
which would add gigabytes of install weight for the same vectors.

Loading discipline:

* **Never at import time.** fastembed downloads the ONNX model on first
  use; importing this module must stay free of that cost so app startup
  (and every test run) is unaffected.
* **Lazy singleton.** The first ``get_embedder()`` call constructs the
  fastembed model; subsequent calls reuse it.
* **Fail loud, typed.** If fastembed is not installed or the model
  cannot be loaded, ``MemoryEmbedderUnavailableError`` is raised — the
  memory API maps it to 503. The happy path never stores NULL
  embeddings (NULL-embedding rows are a watched drift class in
  ``coord.memory_observations``).
* **Injectable.** Tests replace the singleton with a deterministic stub
  via ``set_embedder()`` (or by monkeypatching ``get_embedder``).
"""

from __future__ import annotations

import threading
from typing import Protocol

import structlog

logger = structlog.get_logger(__name__)

# Stored in ``coord.memory_records.embedding_model`` on every write and
# used as the reindex key: rows whose ``embedding_model`` differs from
# the deployed tag are re-embedding candidates.
EMBEDDING_MODEL_TAG = "minilm-l6-v2-onnx@fastembed"

# The fastembed model identifier for the tag above.
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Dimensionality of the model output — must match the ``vector(384)``
# column in ``coord.memory_records``. The write path asserts every
# produced vector has exactly this many components before insert.
EMBEDDING_DIM = 384


class MemoryEmbedderUnavailableError(RuntimeError):
    """fastembed (or its model) is unavailable at runtime.

    The memory API maps this to ``503 Service Unavailable`` — the write
    is rejected rather than silently stored without an embedding.
    """


class MemoryEmbeddingDimensionError(RuntimeError):
    """The embedder produced vectors of the wrong dimensionality."""


class TextEmbedder(Protocol):
    """Anything that can batch-embed texts into 384-dim vectors."""

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed ``texts``; returns one vector per input, in order."""
        ...


class FastembedTextEmbedder:
    """fastembed-backed embedder for ``EMBEDDING_MODEL_NAME``.

    Construction loads the ONNX model (downloading it on first ever use
    of the process's cache) — construct via :func:`get_embedder`, never
    at import time.
    """

    def __init__(self) -> None:
        try:
            from fastembed import TextEmbedding
        except ImportError as exc:
            raise MemoryEmbedderUnavailableError(
                "fastembed is not installed — the tenant-memory embedder "
                "cannot run. Install the backend's dependencies "
                "(poetry install) to enable memory writes."
            ) from exc

        try:
            self._model = TextEmbedding(model_name=EMBEDDING_MODEL_NAME)
        except Exception as exc:
            raise MemoryEmbedderUnavailableError(
                f"failed to load embedding model {EMBEDDING_MODEL_NAME!r} "
                f"via fastembed: {exc}"
            ) from exc

        logger.info(
            "memory_embedder_loaded",
            model=EMBEDDING_MODEL_NAME,
            tag=EMBEDDING_MODEL_TAG,
            dim=EMBEDDING_DIM,
        )

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed ``texts`` in one fastembed batch, preserving order."""
        if not texts:
            return []
        try:
            return [[float(v) for v in vector] for vector in self._model.embed(texts)]
        except Exception as exc:
            raise MemoryEmbedderUnavailableError(
                f"embedding batch of {len(texts)} text(s) failed: {exc}"
            ) from exc


_embedder: TextEmbedder | None = None
_embedder_lock = threading.Lock()


def get_embedder() -> TextEmbedder:
    """Return the process-wide embedder, constructing it on first use.

    Raises:
        MemoryEmbedderUnavailableError: fastembed missing or the model
            failed to load. Callers (the memory API) map this to 503.
    """
    global _embedder
    if _embedder is not None:
        return _embedder
    with _embedder_lock:
        if _embedder is None:
            _embedder = FastembedTextEmbedder()
        return _embedder


def set_embedder(embedder: TextEmbedder | None) -> None:
    """Replace (or clear, with ``None``) the process-wide embedder.

    Test seam: inject a deterministic stub so no test ever downloads the
    real model.
    """
    global _embedder
    with _embedder_lock:
        _embedder = embedder


def ensure_embedding_dims(embeddings: list[list[float]]) -> None:
    """Assert every vector is exactly ``EMBEDDING_DIM`` components.

    The write path calls this on the embedder's output BEFORE any insert
    — a wrong-dimensional vector must never reach the ``vector(384)``
    column (pgvector would reject it with an opaque error; this raises a
    typed one first).

    Raises:
        MemoryEmbeddingDimensionError: any vector has the wrong length.
    """
    for i, vector in enumerate(embeddings):
        if len(vector) != EMBEDDING_DIM:
            raise MemoryEmbeddingDimensionError(
                f"embedder returned a {len(vector)}-dim vector at index {i}; "
                f"the memory-record embedding column requires {EMBEDDING_DIM}"
            )
