"""Bound disclosure on ``POST /memory/query`` — no DB.

Plan ``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``,
Phase 3: the route serves the shared bounded-read envelope
(``BoundedReadMeta``, generated in ``qontinui_schemas``) beside ``hits``, so a
capped ranking can no longer read as the corpus. The arms are stubbed at the
``memory_store`` layer, which is what lets these tests control each arm's raw
candidate count exactly — including a saturated ``ARM_LIMIT`` arm, which a DB
fixture would need 50+ matching rows to produce.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
from app.core import bounded_read
from app.services import memory_store
from app.services.memory_vectors import EMBEDDING_DIM, EMBEDDING_MODEL_TAG

META_KEYS = {
    "count",
    "limit",
    "shown",
    "total",
    "truncated",
    "bound_kind",
    "next_cursor",
    "available",
    "filter_narrowed",
    "enumerate_via",
}
LEGACY_KEYS = {
    "hits",
    "vector_arm",
    "link_arm",
    "anchored_arm",
    "anchored_hits",
    "anchored_hit_count",
    "live_row_count",
    "query_echo",
}
LIVE_ROWS = 6489


def _row(memory_id: UUID) -> dict[str, Any]:
    return {
        "title": f"t-{memory_id}",
        "content": "c",
        "kind": "fact",
        "scope": "tenant",
        "importance": 0.5,
        "created_at": datetime(2026, 9, 26, tzinfo=UTC),
        "source": {},
        "anchor_state": "none",
    }


def _client(
    monkeypatch: pytest.MonkeyPatch,
    fts_ids: list[UUID],
    *,
    vector_ids: list[UUID] | None = None,
    link_ids: list[UUID] | None = None,
    missing: frozenset[UUID] = frozenset(),
) -> TestClient:
    """A client whose FTS arm returns ``fts_ids``.

    ``vector_ids`` stubs the vector arm (the request must then carry a
    ``query_embedding``; see :func:`_query`), ``link_ids`` stubs the link
    arm (the request must set ``link_expansion``), and ``missing`` names
    pooled ids whose row ``fetch_records`` does not return — a record
    tombstoned between the arm and the fetch.
    """

    async def _fts_search(*_a: Any, **_k: Any) -> list[UUID]:
        return list(fts_ids)

    async def _has_unmigrated_vectors(*_a: Any, **_k: Any) -> bool:
        return False

    async def _vector_search(*_a: Any, **_k: Any) -> list[tuple[UUID, float]]:
        return [(i, 0.9) for i in vector_ids or []]

    async def _link_expansion(*_a: Any, **_k: Any) -> list[UUID]:
        return list(link_ids or [])

    async def _fetch_records(
        _db: Any, _tenant: UUID, ids: list[UUID]
    ) -> dict[UUID, dict[str, Any]]:
        return {i: _row(i) for i in ids if i not in missing}

    async def _bump_access(*_a: Any, **_k: Any) -> None:
        return None

    async def _live_row_count(*_a: Any, **_k: Any) -> int:
        return LIVE_ROWS

    monkeypatch.setattr(memory_store, "fts_search", _fts_search)
    monkeypatch.setattr(memory_store, "has_unmigrated_vectors", _has_unmigrated_vectors)
    monkeypatch.setattr(memory_store, "vector_search", _vector_search)
    monkeypatch.setattr(memory_store, "link_expansion", _link_expansion)
    monkeypatch.setattr(memory_store, "fetch_records", _fetch_records)
    monkeypatch.setattr(memory_store, "bump_access", _bump_access)
    monkeypatch.setattr(memory_store, "live_row_count", _live_row_count)

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/memory")
    principal = MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor="device")
    app.dependency_overrides[get_memory_tenant] = lambda: principal

    async def _stub_db():
        yield MagicMock()

    app.dependency_overrides[get_async_db] = _stub_db
    return TestClient(app)


def _query(
    client: TestClient,
    limit: int,
    *,
    with_embedding: bool = False,
    link_expansion: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {"query_text": "anything", "limit": limit}
    if with_embedding:
        body["query_embedding"] = [0.0] * EMBEDDING_DIM
        body["query_embedding_model"] = EMBEDDING_MODEL_TAG
    if link_expansion:
        body["link_expansion"] = True
    resp = client.post("/api/v1/memory/query", json=body)
    assert resp.status_code == 200, resp.text
    answer: dict[str, Any] = resp.json()
    return answer


def test_uncapped_pool_larger_than_limit_is_exact_and_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = [uuid4() for _ in range(12)]
    assert len(pool) < memory_store.ARM_LIMIT
    body = _query(_client(monkeypatch, pool), limit=5)
    assert len(body["hits"]) == 5
    assert body["truncated"] is True
    assert body["bound_kind"] == "exact"
    assert body["total"] == 12
    assert body["count"] == body["shown"] == 5
    assert body["limit"] == 5
    assert body["next_cursor"] is None
    assert body["enumerate_via"] == "GET /api/v1/memory/records"
    assert body["available"] is True


def test_saturated_arm_is_at_least_with_null_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = [uuid4() for _ in range(memory_store.ARM_LIMIT)]
    body = _query(_client(monkeypatch, pool), limit=8)
    assert body["bound_kind"] == "at_least"
    assert body["total"] is None
    assert body["truncated"] is True
    assert body["next_cursor"] is None


def test_saturated_arm_shown_whole_is_unknown_not_complete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # limit == ARM_LIMIT == pool: the page shows the whole pool, but the arm
    # was capped, so "no more exist" was never measured.
    pool = [uuid4() for _ in range(memory_store.ARM_LIMIT)]
    body = _query(_client(monkeypatch, pool), limit=memory_store.ARM_LIMIT)
    assert body["bound_kind"] == "unknown"
    assert body["truncated"] is None
    assert body["total"] is None
    assert body["next_cursor"] is None
    assert body["enumerate_via"] == "GET /api/v1/memory/records"


def test_pool_within_limit_is_not_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    pool = [uuid4() for _ in range(3)]
    body = _query(_client(monkeypatch, pool), limit=8)
    assert len(body["hits"]) == 3
    assert body["truncated"] is False
    assert body["bound_kind"] == "exact"
    assert body["total"] == 3
    assert body["count"] == body["shown"] == 3


def test_empty_result_is_exact_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _query(_client(monkeypatch, []), limit=8)
    assert body["hits"] == []
    assert body["total"] == 0
    assert body["truncated"] is False
    assert body["bound_kind"] == "exact"


def test_every_key_is_present_and_legacy_fields_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = [uuid4() for _ in range(memory_store.ARM_LIMIT)]
    body = _query(_client(monkeypatch, pool), limit=4)
    # null is a VALUE on this wire, never an absence.
    assert META_KEYS <= body.keys()
    assert body["total"] is None
    assert body["next_cursor"] is None
    assert body["filter_narrowed"] is None
    # Additive only: the pre-existing fields keep their names and values.
    assert LEGACY_KEYS <= body.keys()
    assert body["vector_arm"] == "skipped_no_embedding"
    assert body["link_arm"] == "skipped_disabled"
    assert body["anchored_arm"] == "not_requested"
    assert body["anchored_hits"] == []
    assert body["anchored_hit_count"] == 0
    assert body["live_row_count"] == LIVE_ROWS
    assert body["query_echo"]["limit"] == 4
    assert [h["memory_id"] for h in body["hits"]] == [str(i) for i in pool[:4]]
    assert body["enumerate_via"] == "GET /api/v1/memory/records"
    assert body.keys() == META_KEYS | LEGACY_KEYS


def test_saturated_vector_arm_is_at_least(monkeypatch: pytest.MonkeyPatch) -> None:
    # The FTS arm is small; only the VECTOR arm filled ARM_LIMIT.
    vector = [uuid4() for _ in range(memory_store.ARM_LIMIT)]
    fts = [uuid4() for _ in range(3)]
    body = _query(
        _client(monkeypatch, fts, vector_ids=vector), limit=10, with_embedding=True
    )
    assert body["vector_arm"] == "hybrid"
    assert body["bound_kind"] == "at_least"
    assert body["total"] is None
    assert body["truncated"] is True
    assert body["next_cursor"] is None
    assert body["enumerate_via"] == "GET /api/v1/memory/records"


def test_expanded_link_arm_is_at_least_even_when_small(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Every arm is far below ARM_LIMIT, which WOULD read exact — but the link
    # arm cuts each seed's fan-out before filtering, so a capped seed cannot
    # be seen in its list, and an expanded query must not claim exactness.
    fts = [uuid4() for _ in range(6)]
    links = [uuid4() for _ in range(2)]
    body = _query(
        _client(monkeypatch, fts, link_ids=links), limit=3, link_expansion=True
    )
    assert body["link_arm"] == "expanded"
    assert body["bound_kind"] == "at_least"
    assert body["total"] is None
    assert body["truncated"] is True


def test_expanded_link_arm_shown_whole_is_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fts = [uuid4() for _ in range(2)]
    links = [uuid4()]
    body = _query(
        _client(monkeypatch, fts, link_ids=links), limit=10, link_expansion=True
    )
    assert body["link_arm"] == "expanded"
    assert len(body["hits"]) == 3
    assert body["bound_kind"] == "unknown"
    assert body["truncated"] is None
    assert body["total"] is None


def test_link_arm_without_seeds_does_not_force_capped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No seeds -> no expansion query ran -> nothing was cut unseen.
    body = _query(_client(monkeypatch, []), limit=5, link_expansion=True)
    assert body["link_arm"] == "skipped_no_seeds"
    assert body["bound_kind"] == "exact"
    assert body["total"] == 0


def test_total_is_the_deduplicated_union_across_arms(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    shared = [uuid4() for _ in range(3)]
    vector_only = [uuid4() for _ in range(2)]
    fts_only = [uuid4() for _ in range(4)]
    body = _query(
        _client(monkeypatch, shared + fts_only, vector_ids=shared + vector_only),
        limit=50,
        with_embedding=True,
    )
    # 5 vector + 7 FTS returned ids, 3 in both: the pool is 9, not 12.
    assert body["bound_kind"] == "exact"
    assert body["total"] == 9
    assert len(body["hits"]) == 9
    assert len({h["memory_id"] for h in body["hits"]}) == 9
    assert body["truncated"] is False


def test_truncated_is_judged_against_limit_not_shown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The pool is exactly `limit`; one pooled row vanished before the fetch,
    # so `shown` is limit - 1. Nothing lies past the cut, so not truncated.
    pool = [uuid4() for _ in range(5)]
    body = _query(_client(monkeypatch, pool, missing=frozenset({pool[2]})), limit=5)
    assert len(body["hits"]) == 4
    assert body["shown"] == 4
    assert body["total"] == 5
    assert body["bound_kind"] == "exact"
    assert body["truncated"] is False


# ---------------------------------------------------------------------------
# The builders themselves (app.core.bounded_read)
# ---------------------------------------------------------------------------


def test_from_probe_mirrors_rust_page_from_probe() -> None:
    fired = bounded_read.from_probe(11, 10, next_cursor="tok", enumerate_via=None)
    assert (fired.shown, fired.truncated, fired.total) == (10, True, None)
    assert fired.bound_kind == bounded_read.BoundKind.at_least
    assert fired.next_cursor == "tok"
    full = bounded_read.from_probe(10, 10, next_cursor="tok", enumerate_via=None)
    assert full.bound_kind == bounded_read.BoundKind.complete
    assert full.truncated is False
    assert full.next_cursor is None  # no next position: the cursor is unused
    assert fired.enumerate_via is None and full.enumerate_via is None  # a walk


def test_from_probe_fired_with_no_way_forward_is_refused() -> None:
    with pytest.raises(ValueError, match="needs a next_cursor"):
        bounded_read.from_probe(11, 10, next_cursor=None, enumerate_via=None)


def test_from_probe_takes_no_positional_or_defaulted_cursor() -> None:
    with pytest.raises(TypeError):
        bounded_read.from_probe(11, 10, "tok")  # type: ignore[misc]
    with pytest.raises(TypeError):
        bounded_read.from_probe(11, 10, next_cursor="tok")  # type: ignore[call-arg]


def test_not_pageable_mirrors_rust_page_not_pageable() -> None:
    more = bounded_read.not_pageable(6, 5, "GET /memory/records")
    assert (more.shown, more.truncated, more.total) == (5, True, None)
    assert more.bound_kind == bounded_read.BoundKind.at_least
    assert more.next_cursor is None
    assert more.enumerate_via == "GET /memory/records"
    # Set on every page of the read, truncated or not.
    all_ = bounded_read.not_pageable(3, 5, "GET /memory/records")
    assert (all_.shown, all_.truncated) == (3, False)
    assert all_.bound_kind == bounded_read.BoundKind.complete
    assert all_.enumerate_via == "GET /memory/records"


def _raw_meta(
    *, truncated: bool | None, next_cursor: str | None, enumerate_via: str | None
) -> bounded_read.BoundedReadMeta:
    return bounded_read._meta(
        shown=1,
        limit=1,
        total=None,
        truncated=truncated,
        bound_kind=bounded_read.BoundKind.at_least,
        next_cursor=next_cursor,
        enumerate_via=enumerate_via,
    )


def test_cursor_beside_enumerate_via_is_refused() -> None:
    with pytest.raises(ValueError, match="cannot name enumerate_via"):
        _raw_meta(truncated=True, next_cursor="tok", enumerate_via="door")


@pytest.mark.parametrize("truncated", [False, None])
def test_cursor_beside_untruncated_is_refused(truncated: bool | None) -> None:
    with pytest.raises(ValueError, match="only sit beside truncated=True"):
        _raw_meta(truncated=truncated, next_cursor="tok", enumerate_via=None)


def test_truncated_with_no_way_forward_is_refused() -> None:
    with pytest.raises(ValueError, match="needs a next_cursor"):
        _raw_meta(truncated=True, next_cursor=None, enumerate_via=None)


@pytest.mark.parametrize(
    ("truncated", "next_cursor", "enumerate_via"),
    [
        (True, "tok", None),  # a walk
        (True, None, "door"),  # a ranking
        (False, None, None),
        (False, None, "door"),
        (None, None, None),
        (None, None, "door"),
    ],
)
def test_consistent_states_are_accepted(
    truncated: bool | None, next_cursor: str | None, enumerate_via: str | None
) -> None:
    meta = _raw_meta(
        truncated=truncated, next_cursor=next_cursor, enumerate_via=enumerate_via
    )
    assert (meta.truncated, meta.next_cursor, meta.enumerate_via) == (
        truncated,
        next_cursor,
        enumerate_via,
    )


def test_from_count_requires_a_way_forward_when_truncated() -> None:
    with pytest.raises(ValueError, match="needs a next_cursor"):
        bounded_read.from_count(5, 5, 9, next_cursor=None, enumerate_via=None)
    walk = bounded_read.from_count(5, 5, 9, next_cursor="tok", enumerate_via=None)
    assert (walk.truncated, walk.total, walk.next_cursor) == (True, 9, "tok")
    ranked = bounded_read.from_count(5, 5, 9, next_cursor=None, enumerate_via="door")
    assert (ranked.truncated, ranked.next_cursor, ranked.enumerate_via) == (
        True,
        None,
        "door",
    )
    assert ranked.bound_kind == bounded_read.BoundKind.exact


def test_from_count_unknown_and_unavailable() -> None:
    exact = bounded_read.from_count(5, 5, 5, next_cursor="tok", enumerate_via=None)
    assert (exact.truncated, exact.total) == (False, 5)
    assert exact.next_cursor is None  # not truncated: the cursor is unused
    unk = bounded_read.unknown(2, 10)
    assert unk.truncated is None and unk.total is None
    assert unk.bound_kind == bounded_read.BoundKind.unknown
    down = bounded_read.unavailable(10)
    assert down.available is False and down.shown == 0 and down.truncated is None


def test_from_ranked_pool_truncated_compares_pool_to_limit() -> None:
    # A dropped row makes shown < pool == limit: nothing past the cut.
    meta = bounded_read.from_ranked_pool(
        shown=4, limit=5, pool_size=5, pool_capped=False, enumerate_via="door"
    )
    assert (meta.truncated, meta.total) == (False, 5)
    over = bounded_read.from_ranked_pool(
        shown=5, limit=5, pool_size=6, pool_capped=False, enumerate_via="door"
    )
    assert (over.truncated, over.total, over.next_cursor) == (True, 6, None)


def test_merge_into_serializes_every_key() -> None:
    target: dict[str, Any] = {"records": [], "count": 999}
    bounded_read.merge_into(target, bounded_read.unknown(0, 10))
    assert target["records"] == []
    assert target["count"] == 0
    assert META_KEYS <= target.keys()
    assert target["bound_kind"] == "unknown"
