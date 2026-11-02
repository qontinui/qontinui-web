"""The taste inbox's calibration batch — which pairs to ask first.

Phase 23 step 3 of plan ``2026-10-13-image-generation-and-visual-judgment``:
the first batch is "a calibration set across deliberately diverse
directions, plus an upload slot for the operator's own reference images". The
taste twin (Phase 24) learns the most from early labels that span the space,
so the batch pairs images of DIFFERENT directions before it pairs two of the
same one, and it spreads over the pool (every image's first pairing comes
before any image's second) instead of exhausting one image.

Pure: no database, no clock. ``app.api.v1.endpoints.taste`` reads the pool and
the pairs already queued, calls :func:`plan_calibration_pairs`, and writes
what it returns.

Where a direction comes from: the image's ``provenance.direction`` (the style
direction a generator was asked for). An image with none is ``undeclared`` —
or ``reference`` when it entered as an ``exemplar`` (an operator's own
reference upload), so the operator's references are compared against every
generated direction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.taste import (
    DIRECTION_KEY,
    REFERENCE_DIRECTION,
    UNDECLARED_DIRECTION,
)

#: The most images one batch considers (the newest), bounding the pair space.
MAX_POOL_IMAGES = 500
#: The longest direction name kept; a longer one is cut, not refused.
MAX_DIRECTION_CHARS = 80


def direction_of(kind: str, provenance: dict[str, Any]) -> str:
    """The direction an image belongs to for calibration."""
    raw = provenance.get(DIRECTION_KEY)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:MAX_DIRECTION_CHARS]
    return REFERENCE_DIRECTION if kind == "exemplar" else UNDECLARED_DIRECTION


def declared_direction(provenance: dict[str, Any]) -> str | None:
    """``provenance.direction`` when declared, for display; else None."""
    raw = provenance.get(DIRECTION_KEY)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:MAX_DIRECTION_CHARS]
    return None


@dataclass(frozen=True)
class PoolImage:
    sha256: str
    direction: str


def unordered(a: str, b: str) -> tuple[str, str]:
    """The pair's identity: (A, B) and (B, A) are one question."""
    return (a, b) if a < b else (b, a)


@dataclass(frozen=True)
class CalibrationPlan:
    #: Pairs to create, in the order they should be asked.
    new_pairs: list[tuple[PoolImage, PoolImage]]
    #: Pairs the plan reached that the queue already held.
    already_queued: int
    shortfall: Literal["pool_too_small", "pool_exhausted"] | None


def _ordered_candidates(
    pool: list[PoolImage],
) -> list[tuple[PoolImage, PoolImage]]:
    """Every pairing of the pool, cross-direction first, spread over images.

    Within a direction the images keep the pool's order (callers pass oldest
    first). The sort key is ``(same_direction, max(rank_a, rank_b),
    direction-pair index, rank_a, rank_b)``: every cross-direction pair before
    any same-direction one, and, among those, an image's rank-0 pairings
    before anyone's rank-1 pairing — so the first labels touch as many images
    and directions as the batch size allows.
    """
    groups: dict[str, list[PoolImage]] = {}
    for image in pool:
        groups.setdefault(image.direction, []).append(image)
    names = sorted(groups)
    keyed: list[tuple[tuple[int, int, int, int, int], PoolImage, PoolImage]] = []
    pair_index = 0
    for i, left_name in enumerate(names):
        for right_name in names[i:]:
            left, right = groups[left_name], groups[right_name]
            same = left_name == right_name
            for ra, a in enumerate(left):
                start = ra + 1 if same else 0
                for rb in range(start, len(right)):
                    b = right[rb]
                    key = (int(same), max(ra, rb), pair_index, ra, rb)
                    keyed.append((key, a, b))
            pair_index += 1
    keyed.sort(key=lambda entry: entry[0])
    return [(a, b) for _, a, b in keyed]


def plan_calibration_pairs(
    pool: list[PoolImage],
    size: int,
    queued: set[tuple[str, str]],
) -> CalibrationPlan:
    """Up to ``size`` new pairs from ``pool``, skipping ``queued`` ones.

    ``queued`` holds the :func:`unordered` identity of every slot-less pair the
    tenant's queue already has (labelled or not): a calibration question is
    asked once.
    """
    distinct: dict[str, PoolImage] = {}
    for image in pool:
        distinct.setdefault(image.sha256, image)
    images = list(distinct.values())
    if len(images) < 2:
        return CalibrationPlan(
            new_pairs=[], already_queued=0, shortfall="pool_too_small"
        )

    chosen: list[tuple[PoolImage, PoolImage]] = []
    already = 0
    for a, b in _ordered_candidates(images):
        if len(chosen) >= size:
            break
        if unordered(a.sha256, b.sha256) in queued:
            already += 1
            continue
        chosen.append((a, b))
    shortfall: Literal["pool_exhausted"] | None = (
        "pool_exhausted" if len(chosen) < size else None
    )
    return CalibrationPlan(
        new_pairs=chosen, already_queued=already, shortfall=shortfall
    )
