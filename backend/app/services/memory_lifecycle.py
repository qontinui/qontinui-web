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
* :func:`greedy_clusters` — the episode-cluster builder feeding
  synthesis (seed = oldest unclustered, members by cosine similarity).
* :func:`job_input_hash` — the order-independent dedupe key for a
  ``coord.memory_jobs`` row's input set. Neither synthesis nor embedding
  is performed in-process: this backend ships no LLM client and (as of
  ``2026-07-13-runner-paid-embedding``) loads no embedding model on any
  live path, so the sweeps ENQUEUE (see ``memory_store.enqueue_jobs``)
  for a runner to compute and post back. ``job_input_hash`` is the stable
  key that keeps the same work from being enqueued twice while a live job
  for it exists — an in-flight (pending/claimed) job of either kind, plus
  a done SYNTHESIS job (a done embedding does not dedupe; see the
  kind-aware ``enqueue_jobs``). This is what makes the 15-minute bridge
  and reindex cadences idempotent rather than accumulating.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

# numpy is relied on via its TRANSITIVE pin in poetry.lock (2.4.5, required by
# both `pandas` and `opencv-python-headless`, which are direct deps) rather than
# a direct `[tool.poetry.dependencies]` entry: adding one makes `poetry check
# --lock` and `poetry install` fail with "pyproject.toml changed significantly
# since poetry.lock was last generated", which would red every backend CI job.
# Declaring it directly needs a companion `poetry lock` in a separate change.
# Same precedent as app/services/frame_extraction.py.
import numpy as np
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

# Cosine similarity for episode-cluster membership (seed-radius: a member is
# any row within this cosine of the seed). 0.80 was too tight for a single
# sparse tenant — no 5 rows sat within 0.80 of a common seed, so synthesis
# never fired. 0.75 is still "clearly related" for MiniLM-L6 (unrelated pairs
# sit ~0.3-0.5). See plan 2026-07-21-tenant-memory-synthesis-clustering-tune.
CLUSTER_SIMILARITY = 0.75

# Minimum members for a cluster to be synthesized. Lowered 5 -> 3: a synthesized
# mental_model from 3 related episodes is meaningful, and 5 was unreachable at
# realistic single-tenant episode volumes (kept above the hard floor
# _MIN_SYNTHESIS_CLUSTER=2 so a 2-row "cluster" is still not distilled).
CLUSTER_MIN_SIZE = 3

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
    """One clustering candidate (a live episode row)."""

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

    The similarity scan is vectorised: the ordered embeddings are
    L2-normalised into one ``float64`` matrix ``M`` and the FULL pairwise
    matrix ``S = M @ M.T`` is computed in a single BLAS matmul, after
    which the greedy loop only reads precomputed rows of ``S``. The
    outer seed/assign sequence is unchanged — only the inner O(n·dim)
    Python scan is replaced. This is what keeps the job off the
    "60-second event-loop stall" path: the pure-Python form cost ~17 s at
    ``CLUSTER_CANDIDATE_LIMIT`` rows × ``EMBEDDING_DIM`` components (see
    plan ``2026-07-28-web-deploy-red-main-memory-consolidate-event-loop-stall``).
    ``S`` is bounded by ``CLUSTER_CANDIDATE_LIMIT`` — 1000² float64 = 8 MB;
    **if that limit is ever raised, revisit this**, since ``S`` grows as
    O(limit²).

    Zero-norm vectors score 0.0 against everything (never ``NaN``),
    matching the scalar formula this replaced.

    Equivalence to the scalar formula is exact at every threshold this is
    used with — differential fuzzing found 0 divergences in 600 trials at
    ``CLUSTER_SIMILARITY`` (0.75), including pairs seeded at 0.75 ± 1e-16.
    The ONE known exception is ``similarity >= 1.0`` on exact-duplicate
    vectors, where normalise-then-dot and dot-then-divide can straddle
    1.0 by a single ulp in either direction; that threshold selects only
    perfect duplicates and is not a configuration this ships with.

    Total by construction: an
    empty input returns ``[]``, and ragged input (embeddings of differing
    width — possible mid-model-migration, since
    ``fetch_cluster_candidates`` does not filter by model tag) is logged
    and yields ``[]`` rather than raising. Callers should reject ragged
    input up front with
    :func:`app.services.memory_vectors.ensure_embedding_dims`.
    """
    ordered = sorted(items, key=lambda i: (i.created_at, str(i.memory_id)))
    if not ordered:
        return []

    width = len(ordered[0].embedding)
    if any(len(item.embedding) != width for item in ordered):
        logger.warning(
            "greedy_clusters_ragged_embeddings",
            items=len(ordered),
            expected_dim=width,
        )
        return []

    matrix = np.asarray([item.embedding for item in ordered], dtype=np.float64)
    norms: np.ndarray = np.linalg.norm(matrix, axis=1)
    zero_norm = norms == 0.0
    # Guard the divide, then zero those rows outright: a zero vector must
    # score 0.0 against everything (the scalar formula's zero-norm arm),
    # never NaN.
    norms[zero_norm] = 1.0
    matrix /= norms[:, np.newaxis]
    matrix[zero_norm] = 0.0
    sims: np.ndarray = matrix @ matrix.T

    ids = [item.memory_id for item in ordered]
    assigned: set[UUID] = set()
    clusters: list[list[UUID]] = []
    for seed_index, seed_id in enumerate(ids):
        if seed_id in assigned:
            continue
        members = [seed_id]
        # Strictly ``>``, and ``flatnonzero`` yields ascending indices, so
        # members land in the same order the scalar inner loop produced.
        for other_index in np.flatnonzero(sims[seed_index] > similarity):
            other_id = ids[int(other_index)]
            if other_id in assigned or other_id == seed_id:
                continue
            members.append(other_id)
        if len(members) >= min_size:
            clusters.append(members)
            assigned.update(members)
        else:
            assigned.add(seed_id)
    return clusters


# ---------------------------------------------------------------------------
# Synthesis job dedupe key
# ---------------------------------------------------------------------------


def job_input_hash(target_ids: list[UUID], *, model_tag: str | None = None) -> str:
    """Stable, order-independent hash of a job's input set.

    The ``coord.memory_jobs.input_hash`` dedupe key: the same set of
    target ids always hashes identically regardless of order, so a job
    whose inputs already have a live job (an in-flight pending/claimed job
    of either kind, or a done SYNTHESIS job — the kind-aware
    ``enqueue_jobs`` dedupe) is never enqueued twice. sha256 hex over the
    comma-joined sorted ids.

    ``model_tag`` (embedding jobs) is folded in so a job's dedupe key is
    scoped to the tag it will be embedded under: a DEPLOYED-TAG CHANGE
    yields a distinct hash and so a distinct job regardless of any earlier
    same-rows job. (A done embedding job no longer participates in the
    live-input index at all — the kind-aware fix lets a done-but-unapplied
    embedding re-queue under the SAME tag too — but keeping the tag in the
    key keeps distinct-tag jobs cleanly distinct.) Synthesis passes no
    tag, which keeps its hash byte-identical to the pre-generalization
    ``member_set_hash`` — the values migrated across from
    ``member_set_hash`` stay valid rather than silently missing.
    """
    joined = ",".join(sorted(str(m) for m in target_ids))
    if model_tag is not None:
        joined = f"{joined}|{model_tag}"
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def synthesized_title(text: str, *, max_len: int = 120) -> str:
    """Title for a synthesized mental_model: first line, bounded."""
    first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
    if not first_line:
        return "Consolidated memory"
    if len(first_line) <= max_len:
        return first_line
    return first_line[: max_len - 1] + "…"
