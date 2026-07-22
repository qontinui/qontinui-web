"""Vector-space constants for the tenant agentic-memory substrate.

Phase 4 of ``D:/qontinui-root/plans/2026-07-13-runner-paid-embedding.md``.

This module is the successor to ``memory_embedder.py``, which was DELETED
along with the ``fastembed`` dependency: the backend no longer embeds on
any path — request or background. Every vector in
``coord.memory_records.embedding`` is now computed by a runner that pays
for its own compute (the request path takes client-supplied vectors;
background work is enqueued on ``coord.memory_jobs`` for a runner to
claim).

What survives is only the part the backend still genuinely needs: the
NAME of the space its vectors live in, that space's dimensionality, and
the validation that keeps foreign vectors out of it. There is
deliberately **no model here, no fastembed import, and nothing that loads
weights** — importing this module must never cost more than importing a
few constants. The import-ban regression test
(``tests/test_no_fastembed_import.py``) enforces that the model cannot
come back.
"""

from __future__ import annotations

# The deployed model tag. Stamped into
# ``coord.memory_records.embedding_model`` on every write, and the key
# the whole migration machinery turns on:
#
# * ``fetch_reindex_batch`` sweeps every live row whose tag DIFFERS from
#   this one into the runner-paid embedding queue, so changing this
#   constant IS the migration trigger.
# * ``has_unmigrated_vectors`` refuses to run the cosine arm for a tenant
#   that still holds vectors at a different tag (see below).
#
# It names ``-256`` because the 256-token window is what changed. A
# Phase 0 probe compared fastembed's ONNX MiniLM against
# sentence-transformers' and found the spaces NOT interchangeable —
# min cosine 0.71, k=10 exact-order agreement 0% — because fastembed
# truncates inputs at 128 tokens while sentence-transformers uses the
# model's native 256. The divergence is the WINDOW, not quantization, so
# the tag names the window. The operator chose to adopt the native 256.
EMBEDDING_MODEL_TAG = "minilm-l6-v2-256@sentence-transformers"

# The model tags whose vectors this server accepts into
# ``coord.memory_records.embedding``. ONE named constant — a vector from
# any other model lives in a different space and would silently poison
# the cosine arm, so an unrecognized tag is rejected outright rather than
# stored and quietly cosine-compared against MiniLM vectors.
#
# This set is intentionally a SINGLETON and not a compatibility window:
# the Phase 0 verdict was "not interchangeable", so two tags being
# accepted at once would be exactly the mixed-space corpus the
# ``skipped_migrating`` degrade exists to prevent.
ACCEPTED_EMBEDDING_MODEL_TAGS: frozenset[str] = frozenset({EMBEDDING_MODEL_TAG})

# Dimensionality of the accepted space — must match the ``vector(384)``
# column in ``coord.memory_records``. Every inbound vector is checked
# against this before insert.
EMBEDDING_DIM = 384


class MemoryEmbeddingDimensionError(RuntimeError):
    """A vector has the wrong dimensionality for the memory store."""


def ensure_embedding_dims(embeddings: list[list[float]]) -> None:
    """Assert every vector is exactly ``EMBEDDING_DIM`` components.

    A wrong-dimensional vector must never reach the ``vector(384)``
    column — pgvector would reject it with an opaque driver error; this
    raises a typed one first, naming the offending index.

    Raises:
        MemoryEmbeddingDimensionError: any vector has the wrong length.
    """
    for i, vector in enumerate(embeddings):
        if len(vector) != EMBEDDING_DIM:
            raise MemoryEmbeddingDimensionError(
                f"got a {len(vector)}-dim vector at index {i}; "
                f"the memory-record embedding column requires {EMBEDDING_DIM}"
            )
