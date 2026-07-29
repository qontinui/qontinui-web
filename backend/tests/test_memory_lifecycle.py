"""Pure-logic tests for the memory lifecycle math (Phase 4).

No DB, no embedder downloads — covers the Ebbinghaus retention curve,
near-dup merge resolution, greedy episode clustering, and the synthesis
seam's degrade path. The SQL/Python agreement half of the decay contract
lives in ``tests/test_memory_lifecycle_db.py``.

Also carries the event-loop regression suite for plan
``2026-07-28-web-deploy-red-main-memory-consolidate-event-loop-stall``
(:class:`TestClusteringDoesNotStallTheEventLoop`,
:class:`TestGreedyClustersVectorisationEquivalence`): the pure-Python
O(n²) clustering scan blocked the loop for 60-74 s per run in production,
timing out ALB health checks until the ECS circuit breaker rolled every
deploy back. Those tests fail on the pre-fix code and pass on the fix.
They need no DB — the store calls around the clustering step are stubbed —
so they run in the plain unit lane where a regression is caught fast.
"""

from __future__ import annotations

import asyncio
import math
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import numpy as np
import pytest

from app.jobs import memory_lifecycle as memory_jobs
from app.services.memory_lifecycle import (
    CLUSTER_CANDIDATE_LIMIT,
    CLUSTER_MIN_SIZE,
    CLUSTER_SIMILARITY,
    DECAY_SCORE_THRESHOLD,
    ClusterItem,
    DupCandidate,
    greedy_clusters,
    job_input_hash,
    resolve_merges,
    retention_score,
    synthesized_title,
)
from app.services.memory_vectors import EMBEDDING_DIM

_NOW = datetime(2026, 7, 10, 12, 0, 0, tzinfo=UTC)


def _cand(
    importance: float = 0.5,
    access_count: int = 0,
    age_days: float = 0.0,
    memory_id: UUID | None = None,
) -> DupCandidate:
    return DupCandidate(
        memory_id=memory_id or uuid4(),
        importance=importance,
        access_count=access_count,
        created_at=_NOW - timedelta(days=age_days),
    )


class TestRetentionScore:
    def test_fresh_important_row_survives(self) -> None:
        score = retention_score(importance=0.9, age_days=1.0, access_count=0)
        assert score > DECAY_SCORE_THRESHOLD
        assert score < 0.9  # some decay, but negligible

    def test_old_unaccessed_row_decays(self) -> None:
        score = retention_score(importance=0.5, age_days=720.0, access_count=0)
        assert score < DECAY_SCORE_THRESHOLD

    def test_accessed_row_outlives_unaccessed_twin(self) -> None:
        unaccessed = retention_score(importance=0.5, age_days=400.0, access_count=0)
        accessed = retention_score(importance=0.5, age_days=400.0, access_count=20)
        assert accessed > unaccessed
        # At 400 days the access history is the difference between
        # invisible and retained.
        assert unaccessed < DECAY_SCORE_THRESHOLD
        assert accessed > DECAY_SCORE_THRESHOLD

    def test_importance_scales_the_curve(self) -> None:
        low = retention_score(importance=0.2, age_days=90.0, access_count=0)
        high = retention_score(importance=1.0, age_days=90.0, access_count=0)
        assert high == low * 5.0  # importance is a pure multiplier

    def test_access_extension_caps_at_twenty(self) -> None:
        at_cap = retention_score(importance=0.5, age_days=200.0, access_count=20)
        past_cap = retention_score(importance=0.5, age_days=200.0, access_count=500)
        assert at_cap == past_cap

    def test_zero_age_is_full_importance(self) -> None:
        assert retention_score(importance=0.7, age_days=0.0, access_count=0) == 0.7


class TestResolveMerges:
    def test_higher_importance_survives_and_folds(self) -> None:
        strong = _cand(importance=0.8, access_count=3)
        weak = _cand(importance=0.5, access_count=2)
        (decision,) = resolve_merges([(weak, strong)])
        assert decision.survivor_id == strong.memory_id
        assert decision.loser_id == weak.memory_id
        assert decision.folded_importance == 0.8
        assert decision.folded_access_count == 5

    def test_importance_tie_newer_survives(self) -> None:
        older = _cand(importance=0.5, age_days=10.0)
        newer = _cand(importance=0.5, age_days=1.0)
        (decision,) = resolve_merges([(older, newer)])
        assert decision.survivor_id == newer.memory_id

    def test_folded_importance_capped_at_one(self) -> None:
        a = _cand(importance=1.0)
        b = _cand(importance=1.0)
        (decision,) = resolve_merges([(a, b)])
        assert decision.folded_importance == 1.0

    def test_row_participates_in_at_most_one_merge(self) -> None:
        a = _cand(importance=0.9)
        b = _cand(importance=0.5)
        c = _cand(importance=0.4)
        decisions = resolve_merges([(a, b), (b, c)])
        # The (b, c) pair is skipped — b was already consumed.
        assert len(decisions) == 1
        assert decisions[0].survivor_id == a.memory_id
        assert decisions[0].loser_id == b.memory_id

    def test_deterministic_on_full_tie(self) -> None:
        ts = _NOW
        a = DupCandidate(
            memory_id=UUID(int=1), importance=0.5, access_count=0, created_at=ts
        )
        b = DupCandidate(
            memory_id=UUID(int=2), importance=0.5, access_count=0, created_at=ts
        )
        first = resolve_merges([(a, b)])
        second = resolve_merges([(b, a)])
        assert first[0].survivor_id == second[0].survivor_id == a.memory_id


def _axis(i: int, dim: int = 8) -> list[float]:
    v = [0.0] * dim
    v[i] = 1.0
    return v


def _blend(base: int, other: int, w: float, dim: int = 8) -> list[float]:
    """Unit vector with cosine ``w`` to axis ``base`` (rest on ``other``)."""
    v = [0.0] * dim
    v[base] = w
    v[other] = (1.0 - w * w) ** 0.5
    return v


class TestGreedyClusters:
    def _items(self, vectors: list[list[float]]) -> list[ClusterItem]:
        return [
            ClusterItem(
                memory_id=UUID(int=i + 1),
                embedding=vec,
                created_at=_NOW + timedelta(minutes=i),
            )
            for i, vec in enumerate(vectors)
        ]

    def test_five_similar_items_form_one_cluster(self) -> None:
        vectors = [_blend(0, i + 1, 0.93) for i in range(5)] + [_axis(7)]
        items = self._items(vectors)
        clusters = greedy_clusters(items, similarity=0.80, min_size=5)
        assert len(clusters) == 1
        assert set(clusters[0]) == {UUID(int=i) for i in range(1, 6)}

    def test_small_group_is_discarded(self) -> None:
        vectors = [_blend(0, i + 1, 0.93) for i in range(4)]
        clusters = greedy_clusters(self._items(vectors), similarity=0.80, min_size=5)
        assert clusters == []

    def test_seed_is_oldest_unclustered(self) -> None:
        # Two disjoint groups; the older group's seed clusters first.
        group_a = [_blend(0, i + 1, 0.93) for i in range(5)]
        group_b = [_blend(7, i + 1, 0.93) for i in range(5)]
        items = self._items(group_a + group_b)
        clusters = greedy_clusters(items, similarity=0.80, min_size=5)
        assert len(clusters) == 2
        assert clusters[0][0] == UUID(int=1)  # oldest item seeds first

    def test_dissimilar_items_never_cluster(self) -> None:
        vectors = [_axis(i) for i in range(6)]
        clusters = greedy_clusters(self._items(vectors), similarity=0.80, min_size=2)
        assert clusters == []

    def test_production_constants_cluster_three_related_episodes(self) -> None:
        # Regression for plan 2026-07-21-tenant-memory-synthesis-clustering-tune:
        # with the tuned production constants, 3 related-but-distinct episodes
        # (pairwise cosine ~0.865) must form one cluster. This is what unblocked
        # synthesis on realistic single-tenant volumes; it breaks if
        # CLUSTER_MIN_SIZE reverts to 5 or CLUSTER_SIMILARITY rises above ~0.865.
        assert CLUSTER_MIN_SIZE <= 3
        vectors = [_blend(0, i + 1, 0.93) for i in range(3)]
        clusters = greedy_clusters(
            self._items(vectors),
            similarity=CLUSTER_SIMILARITY,
            min_size=CLUSTER_MIN_SIZE,
        )
        assert len(clusters) == 1
        assert set(clusters[0]) == {UUID(int=i) for i in range(1, 4)}


class TestJobInputHash:
    def test_order_independent(self) -> None:
        a, b, c = uuid4(), uuid4(), uuid4()
        assert job_input_hash([a, b, c]) == job_input_hash([c, a, b])

    def test_distinct_sets_differ(self) -> None:
        a, b, c = uuid4(), uuid4(), uuid4()
        assert job_input_hash([a, b]) != job_input_hash([a, b, c])

    def test_stable_hex(self) -> None:
        h = job_input_hash([uuid4()])
        assert len(h) == 64
        int(h, 16)  # sha256 hex digest parses as hex

    def test_model_tag_scopes_the_hash(self) -> None:
        # An embedding job folds the deployed tag in, so a tag change
        # re-opens the same rows for a fresh job even though the earlier
        # job is `done` (and `done` is inside the live dedupe index).
        ids = [uuid4(), uuid4()]
        assert job_input_hash(ids, model_tag="m@v1") != job_input_hash(
            ids, model_tag="m@v2"
        )
        # Synthesis passes no tag — its hash stays byte-identical to the
        # pre-generalization `member_set_hash`, so values migrated across
        # from the old column keep matching.
        assert job_input_hash(ids) != job_input_hash(ids, model_tag="m@v1")


class TestSynthesizedTitle:
    def test_first_line(self) -> None:
        assert synthesized_title("Insight line\nbody text") == "Insight line"

    def test_long_line_is_bounded(self) -> None:
        title = synthesized_title("x" * 500)
        assert len(title) == 120

    def test_empty_text_falls_back(self) -> None:
        assert synthesized_title("   \n  ") == "Consolidated memory"


# ---------------------------------------------------------------------------
# Event-loop stall regression — plan
# 2026-07-28-web-deploy-red-main-memory-consolidate-event-loop-stall
# ---------------------------------------------------------------------------

# Max tolerated inter-tick gap for a 10ms heartbeat running concurrently with a
# full consolidation sweep at the candidate ceiling. Post-fix the clustering is
# vectorised AND dispatched with `asyncio.to_thread`, so the observed max gap is
# a few tens of milliseconds; pre-fix the same corpus blocked the loop for ~17s
# on a desktop core (60-74s on the throttled Fargate vCPU that took prod down).
# 0.5s therefore sits an order of magnitude above the healthy value — a loaded
# CI box cannot flake it — and ~34x below the broken one, so any return of an
# in-loop O(n^2) scan trips it immediately.
_MAX_LOOP_GAP_SECONDS = 1.0

# Wall-clock ceiling for one `greedy_clusters` call at the production ceiling.
# Measured pre-fix on this machine: 17.1s. Post-fix: well under 0.1s. 1.0s is
# the plan's acceptance number and leaves ~10x headroom over the real value.
_CLUSTER_BUDGET_SECONDS = 1.0


def _cosine_similarity_reference(a: list[float], b: list[float]) -> float:
    """The pre-vectorisation scalar kernel, retained here as the oracle.

    This is the exact body of the deleted ``memory_lifecycle.cosine_similarity``.
    It lives in the test rather than the app so the equivalence check has an
    independent reference that cannot drift with the implementation.
    """
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _greedy_clusters_reference(
    items: list[ClusterItem], *, similarity: float, min_size: int
) -> list[list[UUID]]:
    """Verbatim pre-vectorisation ``greedy_clusters`` — the equivalence oracle."""
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
            score = _cosine_similarity_reference(seed.embedding, other.embedding)
            if score > similarity:
                members.append(other.memory_id)
        if len(members) >= min_size:
            clusters.append(members)
            assigned.update(members)
        else:
            assigned.add(seed.memory_id)
    return clusters


def _unit_blend(base: int, other: int, w: float, dim: int) -> list[float]:
    """Unit vector whose cosine to axis ``base`` is (nominally) ``w``."""
    v = [0.0] * dim
    v[base] = w
    v[other] = math.sqrt(max(0.0, 1.0 - w * w))
    return v


def _items_from(vectors: list[list[float]]) -> list[ClusterItem]:
    return [
        ClusterItem(
            memory_id=UUID(int=i + 1),
            embedding=vec,
            created_at=_NOW + timedelta(seconds=i),
        )
        for i, vec in enumerate(vectors)
    ]


def _mixed_corpus_vectors(seed: int, *, dim: int = 32) -> list[list[float]]:
    """Seeded corpus mixing every case the vectorisation could get wrong.

    Clusterable groups (so the greedy assign/discard bookkeeping is really
    exercised), zero-norm rows (the divide-by-zero guard), pairs sitting on
    and astride the 0.75 cut (the float-boundary risk), and random noise.
    """
    rng = np.random.default_rng(seed)
    vectors: list[list[float]] = []

    # Three clusterable groups: members sit at cosine 0.93 to a shared axis,
    # hence ~0.865 to each other — above the 0.75 cut, so clusters form.
    for base in (0, 1, 2):
        for k in range(5):
            vectors.append(_unit_blend(base, 10 + k, 0.93, dim))

    # Zero-norm rows: must score 0.0 against everything, never NaN.
    vectors.extend([0.0] * dim for _ in range(4))

    # Boundary pairs against axis 3: exactly at the cut and either side of it.
    axis3 = [0.0] * dim
    axis3[3] = 1.0
    vectors.append(axis3)
    for offset in (0.0, 1e-12, -1e-12, 1e-9, -1e-9, 1e-7, -1e-7):
        vectors.append(_unit_blend(3, 20, CLUSTER_SIMILARITY + offset, dim))

    # Noise.
    vectors.extend(rng.standard_normal((40, dim)).tolist())
    return vectors


def _ceiling_embeddings() -> list[list[float]]:
    """``CLUSTER_CANDIDATE_LIMIT`` x ``EMBEDDING_DIM`` — the production ceiling.

    Independent gaussian directions cluster into NOTHING at 0.75, which is the
    worst case for the greedy loop rather than the cheapest: ``assigned`` grows
    one seed at a time, so nearly every seed rescans nearly the whole corpus
    (~500k pair comparisons — exactly the prod shape, `clusters=0`).
    """
    rng = np.random.default_rng(20260728)
    matrix = rng.standard_normal((CLUSTER_CANDIDATE_LIMIT, EMBEDDING_DIM))
    embeddings: list[list[float]] = matrix.tolist()
    return embeddings


def _clustered_ceiling_embeddings(seed: int) -> list[list[float]]:
    """Ceiling-sized corpus that ACTUALLY clusters at 0.75.

    ``_ceiling_embeddings`` is the worst case for *cost* (nothing clusters, so
    every seed rescans), but it makes cluster-equality a vacuous ``[] == []``.
    This one draws 40 latent centroids and tight noise around them, so ~40
    clusters of ~30 members form and the greedy assign/discard bookkeeping is
    compared at production dimensionality.
    """
    rng = np.random.default_rng(seed)
    centroids = rng.standard_normal((40, EMBEDDING_DIM))
    centroids /= np.linalg.norm(centroids, axis=1)[:, np.newaxis]
    pick = rng.integers(0, 40, size=CLUSTER_CANDIDATE_LIMIT)
    vectors = (
        centroids[pick]
        + rng.standard_normal((CLUSTER_CANDIDATE_LIMIT, EMBEDDING_DIM)) * 0.025
    )
    vectors[::97] = 0.0  # zero-norm rows scattered through
    vectors[5] = vectors[6]  # an exact duplicate pair
    embeddings: list[list[float]] = vectors.tolist()
    return embeddings


def _ceiling_candidate_rows() -> list[dict[str, Any]]:
    """``fetch_cluster_candidates``-shaped rows at the production ceiling."""
    return [
        {
            "memory_id": UUID(int=i + 1),
            "embedding": vec,
            "created_at": _NOW + timedelta(seconds=i),
            "content": f"episode {i}",
        }
        for i, vec in enumerate(_ceiling_embeddings())
    ]


class TestGreedyClustersVectorisationEquivalence:
    """The numpy rewrite must produce byte-identical clusters to the old loop."""

    @pytest.mark.parametrize("seed", [0, 1, 2, 3, 4])
    def test_identical_clusters_on_mixed_corpora(self, seed: int) -> None:
        items = _items_from(_mixed_corpus_vectors(seed))

        expected = _greedy_clusters_reference(
            items, similarity=CLUSTER_SIMILARITY, min_size=CLUSTER_MIN_SIZE
        )
        actual = greedy_clusters(
            items, similarity=CLUSTER_SIMILARITY, min_size=CLUSTER_MIN_SIZE
        )

        assert actual == expected

    def test_identical_clusters_at_production_scale(self) -> None:
        """Same check at n=1000, dim=384, on a corpus that really clusters.

        Cheap despite the O(n²) oracle: once clusters form, ``assigned`` fills
        fast and the scalar loop short-circuits (~0.6s). It is the NON-clustering
        corpus that costs ~17s, and that one is covered by the perf test.
        """
        items = _items_from(_clustered_ceiling_embeddings(11))

        expected = _greedy_clusters_reference(
            items, similarity=CLUSTER_SIMILARITY, min_size=CLUSTER_MIN_SIZE
        )
        actual = greedy_clusters(
            items, similarity=CLUSTER_SIMILARITY, min_size=CLUSTER_MIN_SIZE
        )

        assert expected, "the corpus must actually cluster or this proves nothing"
        assert actual == expected

    def test_no_boundary_flips_across_every_pair(self) -> None:
        """Quantify the known float risk: normalise-then-dot vs dot-then-divide.

        The two formulas are mathematically identical but not bit-identical, so
        a pair sitting exactly on the cut could in principle land on opposite
        sides. This counts the flips over EVERY pair of a corpus deliberately
        seeded with on-the-cut vectors, and requires the count to be zero.
        """
        vectors = _mixed_corpus_vectors(7)
        matrix = np.asarray(vectors, dtype=np.float64)
        norms = np.linalg.norm(matrix, axis=1)
        zero_norm = norms == 0.0
        norms[zero_norm] = 1.0
        matrix /= norms[:, np.newaxis]
        matrix[zero_norm] = 0.0
        sims = matrix @ matrix.T

        flips = [
            (i, j)
            for i in range(len(vectors))
            for j in range(len(vectors))
            if (
                _cosine_similarity_reference(vectors[i], vectors[j])
                > CLUSTER_SIMILARITY
            )
            != bool(sims[i, j] > CLUSTER_SIMILARITY)
        ]

        assert not flips, f"{len(flips)} boundary flip(s): {flips[:10]}"

    def test_zero_norm_rows_score_zero_not_nan(self) -> None:
        """A zero vector must score 0.0 against everything, never ``NaN``.

        The cut is -1.0, so 0.0 clusters and ``NaN`` does NOT (every NaN
        comparison is False). An unguarded divide-by-zero in the normalisation
        would therefore turn this cluster into ``[]``.
        """
        items = _items_from([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]])

        clusters = greedy_clusters(items, similarity=-1.0, min_size=2)

        assert clusters == [[UUID(int=1), UUID(int=2), UUID(int=3)]]
        assert clusters == _greedy_clusters_reference(
            items, similarity=-1.0, min_size=2
        )

    def test_exactly_at_the_threshold_is_excluded(self) -> None:
        """The comparison is strict ``>``; equality must not cluster.

        ``[3, 4]`` has cosine exactly 0.6 to ``[1, 0]`` — every intermediate
        (norm 5.0, dot 3.0, 3/5) is exact in binary floating point under BOTH
        formulas, so this is a real equality case rather than a near-miss.
        """
        items = _items_from([[1.0, 0.0], [3.0, 4.0], [2.0, 0.0]])

        clusters = greedy_clusters(items, similarity=0.6, min_size=2)

        # The on-the-cut row is excluded; the collinear copy still joins.
        assert clusters == [[UUID(int=1), UUID(int=3)]]

    def test_empty_input_returns_empty(self) -> None:
        assert greedy_clusters([], similarity=CLUSTER_SIMILARITY, min_size=2) == []

    def test_single_item_does_not_self_match(self) -> None:
        """S's diagonal is 1.0 — the seed must not be counted as its own member.

        ``min_size=1`` keeps the cluster alive so the member list itself is
        asserted: a missing self-exclusion would make it length 2.
        """
        items = _items_from([[1.0, 0.0]])

        assert greedy_clusters(items, similarity=0.5, min_size=1) == [[UUID(int=1)]]

    def test_ragged_embeddings_are_skipped_not_raised(self) -> None:
        """Mid-model-migration corpora must degrade, not crash the sweep."""
        items = _items_from([[1.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0]])

        assert greedy_clusters(items, similarity=0.5, min_size=2) == []


class TestGreedyClustersPerformance:
    def test_production_ceiling_is_sub_second(self) -> None:
        """n=1000, dim=384 must complete well inside a second (was ~17s)."""
        items = _items_from(_ceiling_embeddings())

        started = time.perf_counter()
        clusters = greedy_clusters(
            items, similarity=CLUSTER_SIMILARITY, min_size=CLUSTER_MIN_SIZE
        )
        elapsed = time.perf_counter() - started

        assert clusters == []  # independent gaussians never cluster at 0.75
        assert elapsed < _CLUSTER_BUDGET_SECONDS, (
            f"greedy_clusters took {elapsed:.3f}s at n={CLUSTER_CANDIDATE_LIMIT}, "
            f"dim={EMBEDDING_DIM} — budget is {_CLUSTER_BUDGET_SECONDS}s"
        )


class TestClusteringDoesNotStallTheEventLoop:
    """The acceptance test: a consolidation sweep must not seize the loop.

    Drives the REAL ``consolidate_tenant`` call path with the store calls
    around the clustering step stubbed out (no DB), against a synthetic corpus
    at the production ceiling, while a 10ms heartbeat measures how long the
    loop goes unscheduled. On the pre-fix code the heartbeat stops for ~17s
    here; in production it was 60-74s, which timed out the ALB health checks
    and made the ECS circuit breaker roll back every deploy.
    """

    @pytest.mark.asyncio
    async def test_heartbeat_keeps_ticking_at_the_candidate_ceiling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        rows = _ceiling_candidate_rows()

        async def _no_pairs(*args: Any, **kwargs: Any) -> list[Any]:
            return []

        async def _candidates(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
            return rows

        async def _no_enqueue(*args: Any, **kwargs: Any) -> int:
            return 0

        monkeypatch.setattr(memory_jobs.store, "find_near_duplicate_pairs", _no_pairs)
        monkeypatch.setattr(memory_jobs.store, "fetch_cluster_candidates", _candidates)
        monkeypatch.setattr(memory_jobs.store, "enqueue_jobs", _no_enqueue)

        gaps: list[float] = []
        stop = asyncio.Event()

        async def heartbeat() -> None:
            loop = asyncio.get_running_loop()
            last = loop.time()
            while not stop.is_set():
                await asyncio.sleep(0.01)
                now = loop.time()
                gaps.append(now - last)
                last = now

        beat = asyncio.create_task(heartbeat())
        await asyncio.sleep(0.05)  # let the heartbeat settle before the sweep
        session: Any = object()  # every store call that would touch it is stubbed
        stats = await memory_jobs.consolidate_tenant(session, uuid4(), now=_NOW)
        stop.set()
        await beat

        assert stats["cluster_candidates"] == CLUSTER_CANDIDATE_LIMIT
        assert stats["clusters"] == 0
        assert gaps, "the heartbeat never ticked — the measurement is vacuous"
        assert max(gaps) < _MAX_LOOP_GAP_SECONDS, (
            f"the event loop went unscheduled for {max(gaps):.3f}s during "
            f"consolidation (budget {_MAX_LOOP_GAP_SECONDS}s) — the CPU section "
            "is back on the loop"
        )

    @pytest.mark.asyncio
    async def test_ragged_embeddings_skip_the_cluster_arm(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A mixed-width corpus degrades this tenant, it does not kill the sweep.

        ``fetch_cluster_candidates`` filters on ``embedding IS NOT NULL`` only,
        so a tenant mid-model-migration can return rows of differing width.
        """
        rows: list[dict[str, Any]] = [
            {
                "memory_id": UUID(int=i + 1),
                "embedding": [0.0] * width,
                "created_at": _NOW + timedelta(seconds=i),
                "content": f"episode {i}",
            }
            for i, width in enumerate([EMBEDDING_DIM, EMBEDDING_DIM - 1])
        ]

        # A live near-dup pair, so the merge arm has real work to do. The whole
        # point of skipping only the CLUSTER arm is that this survives.
        applied: list[Any] = []

        async def _one_pair(*args: Any, **kwargs: Any) -> list[Any]:
            return [object()]

        def _one_decision(pairs: list[Any]) -> list[Any]:
            return [object()]

        async def _apply_merge(*args: Any, **kwargs: Any) -> None:
            applied.append(args)

        async def _candidates(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
            return rows

        async def _no_enqueue(*args: Any, **kwargs: Any) -> int:
            return 0

        monkeypatch.setattr(memory_jobs.store, "find_near_duplicate_pairs", _one_pair)
        monkeypatch.setattr(memory_jobs, "resolve_merges", _one_decision)
        monkeypatch.setattr(memory_jobs.store, "apply_merge", _apply_merge)
        monkeypatch.setattr(memory_jobs.store, "fetch_cluster_candidates", _candidates)
        monkeypatch.setattr(memory_jobs.store, "enqueue_jobs", _no_enqueue)

        session: Any = object()
        stats = await memory_jobs.consolidate_tenant(session, uuid4(), now=_NOW)

        assert stats["cluster_candidates"] == 2
        assert stats["clusters"] == 0
        assert stats["enqueued"] == 0
        # The headline claim of the degrade path: the near-dup merge STANDS.
        assert stats["merges"] == 1
        assert len(applied) == 1
