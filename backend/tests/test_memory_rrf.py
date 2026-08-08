"""Unit tests for the RRF fusion math (``app/services/memory_retrieval.py``).

Pure-function tests — no DB, no embedder.
"""

from __future__ import annotations

import pytest

from app.services.memory_retrieval import RRF_K, rrf_fuse


def test_known_ranks_produce_known_scores() -> None:
    """score(d) = Σ 1/(60 + rank_i) across arms, 1-based ranks."""
    fused = rrf_fuse({"vector": ["a", "b", "c"], "fts": ["c", "b"]}, k=60)
    scores = {h.id: h.rrf_score for h in fused}

    assert abs(scores["a"] - 1 / 61) < 1e-12
    assert abs(scores["b"] - (1 / 62 + 1 / 62)) < 1e-12
    assert abs(scores["c"] - (1 / 63 + 1 / 61)) < 1e-12


def test_ordering_is_by_fused_score_desc() -> None:
    fused = rrf_fuse({"vector": ["a", "b", "c"], "fts": ["c", "b"]})
    # c: 1/63 + 1/61 > b: 2/62 > a: 1/61
    assert [h.id for h in fused] == ["c", "b", "a"]


def test_per_arm_rank_provenance() -> None:
    fused = rrf_fuse({"vector": ["a", "b"], "fts": ["b"]})
    by_id = {h.id: h for h in fused}

    assert by_id["a"].vector_rank == 1
    assert by_id["a"].fts_rank is None
    assert by_id["b"].vector_rank == 2
    assert by_id["b"].fts_rank == 1


def test_single_arm_preserves_arm_order() -> None:
    fused = rrf_fuse({"vector": ["x", "y", "z"], "fts": []})
    assert [h.id for h in fused] == ["x", "y", "z"]
    assert all(h.fts_rank is None for h in fused)


def test_both_arms_empty() -> None:
    assert rrf_fuse({"vector": [], "fts": []}) == []


def test_tie_breaks_deterministically_by_vector_rank() -> None:
    # a: vector rank 1 + fts rank 2; b: vector rank 2 + fts rank 1 —
    # identical fused scores; the vector-closer doc must come first.
    fused = rrf_fuse({"vector": ["a", "b"], "fts": ["b", "a"]})
    assert abs(fused[0].rrf_score - fused[1].rrf_score) < 1e-15
    assert [h.id for h in fused] == ["a", "b"]


def test_default_k_is_60() -> None:
    assert RRF_K == 60
    (only,) = rrf_fuse({"vector": ["a"], "fts": []})
    assert abs(only.rrf_score - 1 / 61) < 1e-12


# --- N-arm cases (link-expansion arm, plan 2026-07-29) -------------------


def test_empty_third_arm_changes_nothing() -> None:
    two = rrf_fuse({"vector": ["a", "b", "c"], "fts": ["c", "b"]})
    three = rrf_fuse({"vector": ["a", "b", "c"], "fts": ["c", "b"], "link": []})

    assert [h.id for h in three] == [h.id for h in two]
    assert [h.rrf_score for h in three] == [h.rrf_score for h in two]
    assert all(h.link_rank is None for h in three)


def test_third_arm_with_all_new_ids_contributes_at_its_scores() -> None:
    fused = rrf_fuse(
        {"vector": ["a"], "fts": ["a"], "link": ["p", "q"]},
    )
    scores = {h.id: h.rrf_score for h in fused}

    assert abs(scores["a"] - (1 / 61 + 1 / 61)) < 1e-12
    assert abs(scores["p"] - 1 / 61) < 1e-12
    assert abs(scores["q"] - 1 / 62) < 1e-12
    # a (two arms) outranks the link-only pair, which keep their arm order.
    assert [h.id for h in fused] == ["a", "p", "q"]


def test_third_arm_overlapping_ids_sum_across_all_three_arms() -> None:
    fused = rrf_fuse({"vector": ["a", "b"], "fts": ["b"], "link": ["b"]})
    by_id = {h.id: h for h in fused}

    assert abs(by_id["b"].rrf_score - (1 / 62 + 1 / 61 + 1 / 61)) < 1e-12
    assert by_id["b"].vector_rank == 2
    assert by_id["b"].fts_rank == 1
    assert by_id["b"].link_rank == 1
    assert by_id["b"].ranks == {"vector": 2, "fts": 1, "link": 1}
    assert [h.id for h in fused] == ["b", "a"]


def test_link_only_hit_has_no_vector_or_fts_rank() -> None:
    """The §3 commitment: a purely-associative hit must say so."""
    fused = rrf_fuse({"vector": ["a"], "fts": ["a"], "link": ["a", "z"]})
    by_id = {h.id: h for h in fused}

    assert by_id["z"].vector_rank is None
    assert by_id["z"].fts_rank is None
    assert by_id["z"].link_rank == 2
    assert by_id["z"].ranks == {"link": 2}
    # ...and a hit found by every arm still reports all three.
    assert by_id["a"].vector_rank == 1
    assert by_id["a"].fts_rank == 1
    assert by_id["a"].link_rank == 1


def test_single_non_vector_arm_preserves_arm_order() -> None:
    fused = rrf_fuse({"link": ["x", "y", "z"]})
    assert [h.id for h in fused] == ["x", "y", "z"]
    assert all(h.vector_rank is None and h.fts_rank is None for h in fused)
    assert [h.link_rank for h in fused] == [1, 2, 3]


def test_unknown_arm_names_tie_break_alphabetically_not_by_insertion() -> None:
    """Arms outside the canonical three fall back to alphabetical order.

    ``a`` and ``b`` fuse to identical scores. Insertion order would put
    ``a`` first (it is rank 1 in the first-inserted arm ``zeta``);
    alphabetical arm order consults ``alpha`` first, where ``b`` is rank 1.
    """
    fused = rrf_fuse({"zeta": ["a", "b"], "alpha": ["b", "a"]})

    assert abs(fused[0].rrf_score - fused[1].rrf_score) < 1e-15
    assert [h.id for h in fused] == ["b", "a"]
    # Same arms, opposite insertion order — same result.
    flipped = rrf_fuse({"alpha": ["b", "a"], "zeta": ["a", "b"]})
    assert [h.id for h in flipped] == ["b", "a"]


def test_canonical_arms_outrank_unknown_arms_in_tie_break() -> None:
    """Canonical arms are consulted before alphabetically-sorted extras."""
    fused = rrf_fuse({"aaa": ["b", "a"], "vector": ["a", "b"]})

    assert abs(fused[0].rrf_score - fused[1].rrf_score) < 1e-15
    # "aaa" sorts before "vector" alphabetically, but "vector" is canonical.
    assert [h.id for h in fused] == ["a", "b"]


def test_no_arms_at_all() -> None:
    assert rrf_fuse({}) == []


# ---------------------------------------------------------------------------
# Per-arm weights (plan 2026-08-08-memory-graph-has-no-writer, Phase 5)
# ---------------------------------------------------------------------------


def test_omitting_weights_is_textbook_rrf() -> None:
    """The default path must be byte-identical to unweighted RRF.

    Every existing caller and every prior measurement depends on this, so a
    weights parameter that quietly changed the default would invalidate the
    recorded baselines rather than extend them.
    """
    arms = {"vector": ["a", "b", "c"], "fts": ["b", "a"], "link": ["c", "d"]}
    plain = rrf_fuse(arms)

    assert [h.rrf_score for h in rrf_fuse(arms, weights={})] == [
        h.rrf_score for h in plain
    ]
    assert [h.rrf_score for h in rrf_fuse(arms, weights=None)] == [
        h.rrf_score for h in plain
    ]


def test_an_unlisted_arm_weighs_one() -> None:
    """Weighting one arm must not silently zero the others."""
    arms = {"vector": ["a"], "link": ["b"]}
    fused = {h.id: h.rrf_score for h in rrf_fuse(arms, weights={"link": 0.25})}

    assert fused["a"] == pytest.approx(1 / (RRF_K + 1))
    assert fused["b"] == pytest.approx(0.25 / (RRF_K + 1))


def test_weight_scales_only_its_own_arms_contribution() -> None:
    """A document in two arms keeps the unweighted arm's share intact."""
    arms = {"vector": ["a"], "link": ["a"]}
    (hit,) = rrf_fuse(arms, weights={"link": 0.5})

    assert hit.rrf_score == pytest.approx(1 / (RRF_K + 1) + 0.5 / (RRF_K + 1))
    # Provenance is untouched by weighting — a damped hit is still a hit.
    assert hit.vector_rank == 1
    assert hit.link_rank == 1


def test_damping_can_reorder_but_never_drops_a_document() -> None:
    """The superset property the end-to-end suite deliberately does not assert.

    A weight changes scores and so can change order; what it must never do
    is remove an id some arm returned.
    """
    arms = {"vector": ["x", "y"], "link": ["y", "z"]}
    heavy = rrf_fuse(arms, weights={"link": 1.0})
    light = rrf_fuse(arms, weights={"link": 0.01})

    assert {h.id for h in heavy} == {"x", "y", "z"} == {h.id for h in light}
    # Under an equal vote, y (in both arms) outranks x; damped hard enough,
    # the vector arm's ordering wins back.
    assert [h.id for h in heavy][0] == "y"
    assert [h.id for h in light][0] == "x"


def test_a_zero_weight_arm_contributes_nothing_but_still_reports_rank() -> None:
    """Zero weight is 'no influence on score', NOT 'not retrieved'.

    Keeping the rank visible is what lets a caller see that the graph found
    a document even when the fusion chose to ignore it.
    """
    (hit,) = rrf_fuse({"link": ["a"]}, weights={"link": 0.0})

    assert hit.rrf_score == 0.0
    assert hit.link_rank == 1
