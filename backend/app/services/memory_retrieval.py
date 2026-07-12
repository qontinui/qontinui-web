"""Pure retrieval-fusion math for the tenant agentic-memory query path.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

Reciprocal Rank Fusion (RRF) over the two retrieval arms the memory API
runs against ``coord.memory_records``:

* the pgvector HNSW cosine arm (semantic), and
* the ``tsvector``/``websearch_to_tsquery`` arm (lexical).

Kept free of SQL and I/O so the fusion math is unit-testable in
isolation (see ``tests/test_memory_rrf.py``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

# Standard RRF smoothing constant (Cormack et al.): score contribution
# of a rank-r hit is 1 / (K + r) with 1-based ranks.
RRF_K = 60


@dataclass(frozen=True)
class FusedHit[IdT]:
    """One fused result: the id plus its per-arm provenance."""

    id: IdT
    rrf_score: float
    vector_rank: int | None
    fts_rank: int | None


def rrf_fuse[IdT](
    vector_ids: Sequence[IdT],
    fts_ids: Sequence[IdT],
    *,
    k: int = RRF_K,
) -> list[FusedHit[IdT]]:
    """Fuse two ranked id lists with Reciprocal Rank Fusion.

    ``score(d) = Σ_arms 1 / (k + rank_arm(d))`` with 1-based ranks; a
    document absent from an arm simply contributes nothing for that arm.

    Args:
        vector_ids: ids from the semantic arm, best-first.
        fts_ids: ids from the lexical arm, best-first.
        k: RRF smoothing constant (60 per the plan).

    Returns:
        All distinct ids, sorted by fused score descending. Ties break
        by (vector_rank, fts_rank) ascending — i.e. deterministic and
        favoring the semantically closer document — with absent ranks
        sorting last.
    """
    vector_rank = {doc_id: i + 1 for i, doc_id in enumerate(vector_ids)}
    fts_rank = {doc_id: i + 1 for i, doc_id in enumerate(fts_ids)}

    hits: list[FusedHit] = []
    for doc_id in {*vector_rank, *fts_rank}:
        vr = vector_rank.get(doc_id)
        fr = fts_rank.get(doc_id)
        score = 0.0
        if vr is not None:
            score += 1.0 / (k + vr)
        if fr is not None:
            score += 1.0 / (k + fr)
        hits.append(FusedHit(id=doc_id, rrf_score=score, vector_rank=vr, fts_rank=fr))

    _absent = 1 << 30
    hits.sort(
        key=lambda h: (
            -h.rrf_score,
            h.vector_rank if h.vector_rank is not None else _absent,
            h.fts_rank if h.fts_rank is not None else _absent,
        )
    )
    return hits
