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


def _client(monkeypatch: pytest.MonkeyPatch, fts_ids: list[UUID]) -> TestClient:
    """A client whose FTS arm returns ``fts_ids`` (the vector arm is skipped:
    no query embedding is sent, so ``vector_arm`` is ``skipped_no_embedding``)."""

    async def _fts_search(*_a: Any, **_k: Any) -> list[UUID]:
        return list(fts_ids)

    async def _fetch_records(
        _db: Any, _tenant: UUID, ids: list[UUID]
    ) -> dict[UUID, dict[str, Any]]:
        return {i: _row(i) for i in ids}

    async def _bump_access(*_a: Any, **_k: Any) -> None:
        return None

    async def _live_row_count(*_a: Any, **_k: Any) -> int:
        return LIVE_ROWS

    monkeypatch.setattr(memory_store, "fts_search", _fts_search)
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


def _query(client: TestClient, limit: int) -> dict[str, Any]:
    resp = client.post(
        "/api/v1/memory/query", json={"query_text": "anything", "limit": limit}
    )
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    return body


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


# ---------------------------------------------------------------------------
# The builders themselves (app.core.bounded_read)
# ---------------------------------------------------------------------------


def test_from_probe_mirrors_rust_page_from_probe() -> None:
    fired = bounded_read.from_probe(11, 10, "tok")
    assert (fired.shown, fired.truncated, fired.total) == (10, True, None)
    assert fired.bound_kind == bounded_read.BoundKind.at_least
    assert fired.next_cursor == "tok"
    full = bounded_read.from_probe(10, 10, "tok")
    assert full.bound_kind == bounded_read.BoundKind.complete
    assert full.truncated is False
    assert full.next_cursor is None  # never beside truncated: false
    assert fired.enumerate_via is None and full.enumerate_via is None  # a walk


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


def test_cursor_beside_enumerate_via_is_refused() -> None:
    with pytest.raises(ValueError):
        bounded_read._meta(
            shown=1,
            limit=1,
            total=None,
            truncated=True,
            bound_kind=bounded_read.BoundKind.at_least,
            next_cursor="tok",
            enumerate_via="door",
        )


def test_from_count_unknown_and_unavailable() -> None:
    exact = bounded_read.from_count(5, 5, 5)
    assert (exact.truncated, exact.total) == (False, 5)
    unk = bounded_read.unknown(2, 10)
    assert unk.truncated is None and unk.total is None
    assert unk.bound_kind == bounded_read.BoundKind.unknown
    down = bounded_read.unavailable(10)
    assert down.available is False and down.shown == 0 and down.truncated is None


def test_merge_into_serializes_every_key() -> None:
    target: dict[str, Any] = {"records": [], "count": 999}
    bounded_read.merge_into(target, bounded_read.unknown(0, 10))
    assert target["records"] == []
    assert target["count"] == 0
    assert META_KEYS <= target.keys()
    assert target["bound_kind"] == "unknown"
