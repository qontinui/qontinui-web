"""Unit tests for the RRF fusion math (``app/services/memory_retrieval.py``).

Pure-function tests — no DB, no embedder.
"""

from __future__ import annotations

from app.services.memory_retrieval import RRF_K, rrf_fuse


def test_known_ranks_produce_known_scores() -> None:
    """score(d) = Σ 1/(60 + rank_i) across arms, 1-based ranks."""
    fused = rrf_fuse(["a", "b", "c"], ["c", "b"], k=60)
    scores = {h.id: h.rrf_score for h in fused}

    assert abs(scores["a"] - 1 / 61) < 1e-12
    assert abs(scores["b"] - (1 / 62 + 1 / 62)) < 1e-12
    assert abs(scores["c"] - (1 / 63 + 1 / 61)) < 1e-12


def test_ordering_is_by_fused_score_desc() -> None:
    fused = rrf_fuse(["a", "b", "c"], ["c", "b"])
    # c: 1/63 + 1/61 > b: 2/62 > a: 1/61
    assert [h.id for h in fused] == ["c", "b", "a"]


def test_per_arm_rank_provenance() -> None:
    fused = rrf_fuse(["a", "b"], ["b"])
    by_id = {h.id: h for h in fused}

    assert by_id["a"].vector_rank == 1
    assert by_id["a"].fts_rank is None
    assert by_id["b"].vector_rank == 2
    assert by_id["b"].fts_rank == 1


def test_single_arm_preserves_arm_order() -> None:
    fused = rrf_fuse(["x", "y", "z"], [])
    assert [h.id for h in fused] == ["x", "y", "z"]
    assert all(h.fts_rank is None for h in fused)


def test_both_arms_empty() -> None:
    assert rrf_fuse([], []) == []


def test_tie_breaks_deterministically_by_vector_rank() -> None:
    # a: vector rank 1 + fts rank 2; b: vector rank 2 + fts rank 1 —
    # identical fused scores; the vector-closer doc must come first.
    fused = rrf_fuse(["a", "b"], ["b", "a"])
    assert abs(fused[0].rrf_score - fused[1].rrf_score) < 1e-15
    assert [h.id for h in fused] == ["a", "b"]


def test_default_k_is_60() -> None:
    assert RRF_K == 60
    (only,) = rrf_fuse(["a"], [])
    assert abs(only.rrf_score - 1 / 61) < 1e-12
