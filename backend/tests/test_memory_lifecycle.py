"""Pure-logic tests for the memory lifecycle math (Phase 4).

No DB, no embedder downloads — covers the Ebbinghaus retention curve,
near-dup merge resolution, greedy episode clustering, and the synthesis
seam's degrade path. The SQL/Python agreement half of the decay contract
lives in ``tests/test_memory_lifecycle_db.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.services.memory_lifecycle import (
    CLUSTER_MIN_SIZE,
    CLUSTER_SIMILARITY,
    DECAY_SCORE_THRESHOLD,
    ClusterItem,
    DupCandidate,
    cosine_similarity,
    greedy_clusters,
    job_input_hash,
    resolve_merges,
    retention_score,
    synthesized_title,
)

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


class TestCosineSimilarity:
    def test_identical_is_one(self) -> None:
        v = [0.6, 0.8, 0.0]
        assert abs(cosine_similarity(v, v) - 1.0) < 1e-12

    def test_orthogonal_is_zero(self) -> None:
        assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_zero_norm_is_zero(self) -> None:
        assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


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
