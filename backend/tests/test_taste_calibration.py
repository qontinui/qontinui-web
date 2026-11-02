"""The calibration batch planner — which pairs the taste inbox asks first.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 23 step 3: a
calibration set "across deliberately diverse directions". Pure; no database.
"""

from __future__ import annotations

from itertools import combinations

from app.services.taste_calibration import (
    MAX_DIRECTION_CHARS,
    PoolImage,
    declared_direction,
    direction_of,
    plan_calibration_pairs,
    unordered,
)


def _pool(spec: dict[str, int]) -> list[PoolImage]:
    """``{"warm": 2, "cool": 1}`` → warm-0, warm-1, cool-0 (hex-safe shas)."""
    images: list[PoolImage] = []
    for direction, count in spec.items():
        for i in range(count):
            images.append(PoolImage(sha256=f"{direction}-{i}", direction=direction))
    return images


def _directions(pair: tuple[PoolImage, PoolImage]) -> frozenset[str]:
    return frozenset({pair[0].direction, pair[1].direction})


def test_direction_comes_from_provenance_and_falls_back_by_kind() -> None:
    assert (
        direction_of("candidate", {"direction": " editorial-warm "}) == "editorial-warm"
    )
    assert direction_of("candidate", {}) == "undeclared"
    assert direction_of("candidate", {"direction": "   "}) == "undeclared"
    assert direction_of("candidate", {"direction": 7}) == "undeclared"
    # An operator's reference upload is its own direction, so it is compared
    # against every generated one.
    assert direction_of("exemplar", {}) == "reference"
    assert direction_of("exemplar", {"direction": "flat"}) == "flat"
    assert (
        len(direction_of("candidate", {"direction": "x" * 500})) == MAX_DIRECTION_CHARS
    )
    assert declared_direction({}) is None
    assert declared_direction({"direction": "flat"}) == "flat"


def test_cross_direction_pairs_come_before_any_same_direction_pair() -> None:
    pool = _pool({"warm": 3, "cool": 3, "reference": 2})
    plan = plan_calibration_pairs(pool, size=100, queued=set())
    kinds = [len(_directions(p)) for p in plan.new_pairs]
    first_same = kinds.index(1)
    assert all(k == 2 for k in kinds[:first_same])
    assert all(k == 1 for k in kinds[first_same:])
    # Every pairing the pool allows, exactly once.
    expected = {unordered(a.sha256, b.sha256) for a, b in combinations(pool, 2)}
    got = [unordered(a.sha256, b.sha256) for a, b in plan.new_pairs]
    assert len(got) == len(set(got)) == len(expected)
    assert set(got) == expected
    assert plan.shortfall == "pool_exhausted"


def test_a_small_batch_spans_every_direction_pair_and_spreads_over_images() -> None:
    pool = _pool({"a": 3, "b": 3, "c": 3})
    plan = plan_calibration_pairs(pool, size=3, queued=set())
    # Three pairs: one per direction pair — not three of a × b.
    assert {_directions(p) for p in plan.new_pairs} == {
        frozenset({"a", "b"}),
        frozenset({"a", "c"}),
        frozenset({"b", "c"}),
    }
    assert plan.shortfall is None
    # Twelve pairs reach every image before any image's rank-2 pairing.
    wide = plan_calibration_pairs(pool, size=12, queued=set())
    touched = {img.sha256 for pair in wide.new_pairs for img in pair}
    assert len(touched) == 6  # ranks 0 and 1 of each direction
    assert all(
        int(img.sha256.rsplit("-", 1)[1]) <= 1
        for pair in wide.new_pairs
        for img in pair
    )


def test_queued_pairs_are_skipped_in_either_order() -> None:
    pool = _pool({"a": 1, "b": 1, "c": 1})
    queued = {unordered("b-0", "a-0")}
    plan = plan_calibration_pairs(pool, size=3, queued=queued)
    got = {unordered(a.sha256, b.sha256) for a, b in plan.new_pairs}
    assert unordered("a-0", "b-0") not in got
    assert len(got) == 2
    assert plan.already_queued == 1
    assert plan.shortfall == "pool_exhausted"


def test_building_twice_adds_nothing_the_first_build_queued() -> None:
    pool = _pool({"a": 2, "b": 2})
    first = plan_calibration_pairs(pool, size=4, queued=set())
    queued = {unordered(a.sha256, b.sha256) for a, b in first.new_pairs}
    second = plan_calibration_pairs(pool, size=4, queued=queued)
    again = {unordered(a.sha256, b.sha256) for a, b in second.new_pairs}
    assert not (again & queued)
    assert len(again) == 2  # the two same-direction pairs left
    assert second.already_queued == 4


def test_one_direction_still_pairs_within_it() -> None:
    plan = plan_calibration_pairs(_pool({"undeclared": 3}), size=10, queued=set())
    assert len(plan.new_pairs) == 3
    assert plan.shortfall == "pool_exhausted"


def test_fewer_than_two_images_is_named_not_empty() -> None:
    for pool in ([], _pool({"a": 1}), [PoolImage("x", "a"), PoolImage("x", "b")]):
        plan = plan_calibration_pairs(pool, size=5, queued=set())
        assert plan.new_pairs == []
        assert plan.shortfall == "pool_too_small"


def test_never_pairs_an_image_with_itself() -> None:
    pool = _pool({"a": 4, "b": 4})
    plan = plan_calibration_pairs(pool, size=100, queued=set())
    assert all(a.sha256 != b.sha256 for a, b in plan.new_pairs)
