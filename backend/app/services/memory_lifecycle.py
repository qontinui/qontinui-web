"""Pure lifecycle math for the tenant agentic-memory substrate.

Phases 4-5 of ``2026-07-10-tenant-agentic-memory-web-backend``.

Everything here is SQL-free and I/O-free so the lifecycle rules are
unit-testable in isolation (see ``tests/test_memory_lifecycle.py``):

* :func:`retention_score` — the Ebbinghaus importance-weighted decay
  curve. The set-based decay sweep in ``memory_store.decay_invalidate``
  computes the SAME formula in SQL; a DB test asserts the two agree on
  seeded rows.
* :func:`resolve_merges` — greedy near-duplicate pair resolution
  (survivor selection + importance/access folding) over the candidate
  pairs the pgvector self-join returns.
* :func:`greedy_clusters` — the episode-cluster builder feeding LLM
  synthesis (seed = oldest unclustered, members by cosine similarity).
* :class:`MemorySynthesizer` — the injectable synthesis seam. The
  default is :class:`NullMemorySynthesizer`: this backend ships no LLM
  client (no anthropic/openai SDK in its dependency set), so synthesis
  degrades to a logged no-op while near-dup merge stays fully
  functional. Swap in a real implementation via
  :func:`set_synthesizer` when the backend grows an LLM client.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

import structlog

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Decay constants — mirrored by the SQL in memory_store.decay_invalidate.
# ---------------------------------------------------------------------------

# Base retention horizon: an importance-1.0, never-accessed row crosses
# the threshold after a few multiples of this many days.
DECAY_BASE_HORIZON_DAYS = 180.0

# Access counts above this stop extending the half-life further.
DECAY_ACCESS_CAP = 20

# Rows whose retention score falls below this become retrieval-invisible
# (``valid_until = now()``) — never hard-deleted by the decay pass itself.
DECAY_SCORE_THRESHOLD = 0.05

# Grace period past invisibility before the physical prune may delete a
# tombstoned / superseded / decayed row.
DECAY_PRUNE_GRACE_DAYS = 90

# ---------------------------------------------------------------------------
# Consolidation constants.
# ---------------------------------------------------------------------------

# Cosine similarity above which two same-kind rows are near-duplicates.
NEAR_DUP_SIMILARITY = 0.95

# Only rows created inside this window seed the near-dup self-join's
# left side (bounds the O(n^2) pair space).
NEAR_DUP_WINDOW_DAYS = 90

# Max near-dup pairs considered per consolidation run per tenant.
NEAR_DUP_PAIR_LIMIT = 500

# Cosine similarity for episode-cluster membership.
CLUSTER_SIMILARITY = 0.80

# Minimum members for a cluster to be synthesized.
CLUSTER_MIN_SIZE = 5

# Max candidate rows pulled per tenant per synthesis run.
CLUSTER_CANDIDATE_LIMIT = 1000

# Importance bonus a synthesized mental_model gets over its best member.
SYNTHESIS_IMPORTANCE_BONUS = 0.1

# ---------------------------------------------------------------------------
# Reindex constants.
# ---------------------------------------------------------------------------

REINDEX_BATCH_SIZE = 100

# Safety cap: batches per run (the daily beat picks up the remainder).
REINDEX_MAX_BATCHES = 50


def retention_score(importance: float, age_days: float, access_count: int) -> float:
    """Ebbinghaus importance-weighted retention score.

    ``score = importance * exp(-age_days / (180 * (0.5 + min(access, 20)/20)))``

    Importance scales the whole curve; access extends the effective
    half-life (a fully-accessed row decays at 2.5x the horizon of a
    never-accessed one). ``age_days`` is measured against
    ``COALESCE(last_accessed_at, created_at)`` by the caller.

    The SQL sweep in ``memory_store.decay_invalidate`` computes this
    exact formula server-side; ``tests/test_memory_lifecycle_db.py``
    asserts the two implementations agree on seeded rows.
    """
    half_life_factor = 0.5 + min(access_count, DECAY_ACCESS_CAP) / DECAY_ACCESS_CAP
    return importance * math.exp(
        -age_days / (DECAY_BASE_HORIZON_DAYS * half_life_factor)
    )


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two equal-length vectors (0.0 on zero norm)."""
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# Near-duplicate merge resolution
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DupCandidate:
    """One side of a near-duplicate pair, as fetched from the store."""

    memory_id: UUID
    importance: float
    access_count: int
    created_at: datetime


@dataclass(frozen=True)
class MergeDecision:
    """Resolved merge: fold the loser into the survivor."""

    survivor_id: UUID
    loser_id: UUID
    folded_importance: float
    folded_access_count: int


def resolve_merges(
    pairs: list[tuple[DupCandidate, DupCandidate]],
) -> list[MergeDecision]:
    """Greedily resolve near-duplicate pairs into merge decisions.

    Survivor = higher importance; tie → newer ``created_at``; tie →
    lexically smaller id (fully deterministic). A row participates in at
    most ONE merge per run: pairs touching an already-decided row are
    skipped and picked up by the next weekly pass (keeps transitive
    chains A~B~C from double-superseding B).
    """
    decisions: list[MergeDecision] = []
    taken: set[UUID] = set()
    for a, b in pairs:
        if a.memory_id in taken or b.memory_id in taken:
            continue
        survivor, loser = _pick_survivor(a, b)
        decisions.append(
            MergeDecision(
                survivor_id=survivor.memory_id,
                loser_id=loser.memory_id,
                folded_importance=min(1.0, max(a.importance, b.importance)),
                folded_access_count=a.access_count + b.access_count,
            )
        )
        taken.add(a.memory_id)
        taken.add(b.memory_id)
    return decisions


def _survivor_sort_key(c: DupCandidate) -> tuple[float, float, str]:
    """Sort key: importance desc, created_at desc, id asc."""
    return (-c.importance, -c.created_at.timestamp(), str(c.memory_id))


def _pick_survivor(
    a: DupCandidate, b: DupCandidate
) -> tuple[DupCandidate, DupCandidate]:
    """(survivor, loser) — importance desc, created_at desc, id asc."""
    first, second = sorted((a, b), key=_survivor_sort_key)
    return first, second


# ---------------------------------------------------------------------------
# Episode clustering for LLM synthesis
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ClusterItem:
    """One clustering candidate (a live episode/observation row)."""

    memory_id: UUID
    embedding: list[float]
    created_at: datetime


def greedy_clusters(
    items: list[ClusterItem],
    *,
    similarity: float = CLUSTER_SIMILARITY,
    min_size: int = CLUSTER_MIN_SIZE,
) -> list[list[UUID]]:
    """Greedy similarity clustering: seed = oldest unassigned item.

    For each seed (oldest-first), the cluster is the seed plus every
    still-unassigned item with cosine similarity > ``similarity`` to the
    seed. Clusters smaller than ``min_size`` are discarded — only the
    seed is consumed, so its near-misses remain available to later
    seeds. Deterministic given the input.
    """
    ordered = sorted(items, key=lambda i: (i.created_at, str(i.memory_id)))
    assigned: set[UUID] = set()
    clusters: list[list[UUID]] = []
    for seed in ordered:
        if seed.memory_id in assigned:
            continue
        members = [seed.memory_id]
        for other in ordered:
            if other.memory_id in assigned or other.memory_id == seed.memory_id:
                continue
            if cosine_similarity(seed.embedding, other.embedding) > similarity:
                members.append(other.memory_id)
        if len(members) >= min_size:
            clusters.append(members)
            assigned.update(members)
        else:
            assigned.add(seed.memory_id)
    return clusters


# ---------------------------------------------------------------------------
# Synthesis seam
# ---------------------------------------------------------------------------


class MemorySynthesizer(Protocol):
    """Anything that can distill a cluster of memory texts into one."""

    def synthesize(self, cluster_texts: list[str]) -> str | None:
        """Return the synthesized mental-model text, or None to skip."""
        ...


class NullMemorySynthesizer:
    """Degrade-path synthesizer: always skips (returns None).

    This backend has no LLM client dependency (no anthropic/openai SDK
    in its dependency set), so cluster synthesis is a logged no-op until
    one is wired in via :func:`set_synthesizer`. Near-dup merge — the
    other half of consolidation — is unaffected.
    """

    def synthesize(self, cluster_texts: list[str]) -> str | None:
        logger.info(
            "memory_synthesis_skipped_no_llm_client",
            cluster_size=len(cluster_texts),
        )
        return None


_synthesizer: MemorySynthesizer | None = None
_synthesizer_lock = threading.Lock()


def get_synthesizer() -> MemorySynthesizer:
    """Process-wide synthesizer (defaults to the null degrade path)."""
    global _synthesizer
    if _synthesizer is not None:
        return _synthesizer
    with _synthesizer_lock:
        if _synthesizer is None:
            _synthesizer = NullMemorySynthesizer()
        return _synthesizer


def set_synthesizer(synthesizer: MemorySynthesizer | None) -> None:
    """Replace (or clear, with ``None``) the process-wide synthesizer."""
    global _synthesizer
    with _synthesizer_lock:
        _synthesizer = synthesizer


def synthesized_title(text: str, *, max_len: int = 120) -> str:
    """Title for a synthesized mental_model: first line, bounded."""
    first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
    if not first_line:
        return "Consolidated memory"
    if len(first_line) <= max_len:
        return first_line
    return first_line[: max_len - 1] + "…"
