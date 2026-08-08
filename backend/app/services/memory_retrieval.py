"""Pure retrieval-fusion math for the tenant agentic-memory query path.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

Reciprocal Rank Fusion (RRF) over N **named** retrieval arms run against
``coord.memory_records``. Arms are keyed by name rather than by argument
position so provenance can never be silently re-attributed when a caller
drops an arm instead of passing it empty. The arms in use today:

* ``"vector"`` — the pgvector HNSW cosine arm (semantic),
* ``"fts"`` — the ``tsvector``/``websearch_to_tsquery`` arm (lexical), and
* ``"link"`` — one-hop expansion over the ``coord.memory_links`` graph
  (``2026-07-29-memory-link-expansion-retrieval-arm.md``).

Nothing here is limited to those three: any name-keyed mapping fuses, and
the tie-break stays total and reproducible for unknown arm names.

Kept free of SQL and I/O so the fusion math is unit-testable in
isolation (see ``tests/test_memory_rrf.py``).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

# Standard RRF smoothing constant (Cormack et al.): score contribution
# of a rank-r hit is 1 / (K + r) with 1-based ranks.
RRF_K = 60

# Tie-break arm precedence. Arms named here sort in *this* order (not in
# ``dict`` insertion order); any other arm name follows, sorted
# alphabetically, so an unknown future arm still yields a total,
# reproducible ordering.
CANONICAL_ARMS = ("vector", "fts", "link")

# Sentinel rank for "this document is absent from this arm" — sorts last.
_ABSENT_RANK = 1 << 30


@dataclass(frozen=True)
class FusedHit[IdT]:
    """One fused result: the id plus its per-arm provenance.

    ``ranks`` holds an entry only for the arms the document actually
    appeared in — an absent arm is an absent key, never a ``None`` value.

    ``frozen=True`` here means "no attribute rebinding", NOT hashable and
    NOT deeply immutable: the ``ranks`` dict makes instances unhashable
    (``set(fused)`` / using a hit as a dict key raises ``TypeError``) and
    leaves the mapping itself mutable. Nothing hashes a ``FusedHit``
    today; de-duplicate on ``hit.id`` if you ever need to.
    """

    id: IdT
    rrf_score: float
    ranks: dict[str, int]

    @property
    def vector_rank(self) -> int | None:
        """1-based rank in the semantic arm, or ``None`` if absent."""
        return self.ranks.get("vector")

    @property
    def fts_rank(self) -> int | None:
        """1-based rank in the lexical arm, or ``None`` if absent."""
        return self.ranks.get("fts")

    @property
    def link_rank(self) -> int | None:
        """1-based rank in the graph-expansion arm, or ``None`` if absent."""
        return self.ranks.get("link")


def _tie_break_arm_order(arm_names: Sequence[str]) -> tuple[str, ...]:
    """Canonical arms first (in ``CANONICAL_ARMS`` order), then the rest sorted."""
    present = set(arm_names)
    known = [name for name in CANONICAL_ARMS if name in present]
    unknown = sorted(present.difference(CANONICAL_ARMS))
    return (*known, *unknown)


def rrf_fuse[IdT](
    arms: Mapping[str, Sequence[IdT]],
    *,
    k: int = RRF_K,
    weights: Mapping[str, float] | None = None,
) -> list[FusedHit[IdT]]:
    """Fuse N named ranked id lists with weighted Reciprocal Rank Fusion.

    ``score(d) = Σ_arms w_arm / (k + rank_arm(d))`` with 1-based ranks; a
    document absent from an arm simply contributes nothing for that arm.
    An arm with no declared weight has weight ``1.0``, so an unweighted
    call is textbook RRF.

    **Why weights exist.** Plain RRF assumes every arm's rank-1 means about
    the same thing, because the only signal it keeps is position. That holds
    for the vector and FTS arms and fails badly for ``link``: "one hop from a
    seed" is a much weaker claim than "nearest neighbour in the embedding
    space", yet both score ``1/(k+1)``. Measured on the golden set
    (``2026-08-08-memory-graph-has-no-writer`` §4a), giving ``link`` an equal
    vote cost **MRR 0.8306 → 0.2918** and nDCG@10 0.8412 → 0.4402 while
    recall@20 stayed at 1.0 — a ranking collapse the widest metric hid.

    Args:
        arms: ranked id lists keyed by arm name, each best-first (e.g.
            ``{"vector": [...], "fts": [...], "link": [...]}``). Empty
            arms are permitted and contribute nothing.
        k: RRF smoothing constant (60 per the plan).
        weights: per-arm multipliers on the rank contribution, keyed by arm
            name. Absent arms default to ``1.0``. Scores stay comparable
            only within one query — they are not calibrated across queries
            either way, which is already true of unweighted RRF.

    Returns:
        All distinct ids, sorted by fused score descending. Ties break by
        each arm's rank ascending, arms considered in ``CANONICAL_ARMS``
        order followed by any remaining arm names alphabetically — i.e.
        deterministic and favoring the semantically closer document —
        with absent ranks sorting last.
    """
    arm_order = _tie_break_arm_order(list(arms))
    arm_weights = weights or {}

    def weight_of(name: str) -> float:
        return arm_weights.get(name, 1.0)

    ranks_by_arm: dict[str, dict[IdT, int]] = {
        name: {doc_id: i + 1 for i, doc_id in enumerate(arms[name])}
        for name in arm_order
    }

    # Seed the id set in a deterministic order (arm precedence, then
    # within-arm rank) so the sort below never depends on set iteration.
    ordered_ids: dict[IdT, None] = {}
    for name in arm_order:
        for doc_id in arms[name]:
            ordered_ids.setdefault(doc_id, None)

    hits: list[FusedHit[IdT]] = []
    for doc_id in ordered_ids:
        doc_ranks = {
            name: rank
            for name in arm_order
            if (rank := ranks_by_arm[name].get(doc_id)) is not None
        }
        score = sum(weight_of(name) / (k + rank) for name, rank in doc_ranks.items())
        hits.append(FusedHit(id=doc_id, rrf_score=score, ranks=doc_ranks))

    def _sort_key(hit: FusedHit[IdT]) -> tuple[float, ...]:
        return (
            -hit.rrf_score,
            *(float(hit.ranks.get(name, _ABSENT_RANK)) for name in arm_order),
        )

    hits.sort(key=_sort_key)
    return hits
