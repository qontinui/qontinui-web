"""Validation tests for the memory API — no DB.

Covers the request-shape 422s (batch cap, content byte cap, query limit
cap) and the client-supplied-embedding contract
(``2026-07-13-runner-paid-embedding`` Phase 1): a vector must be
``EMBEDDING_DIM``-dimensional and carry an accepted model tag, or the
request is rejected outright — a wrong-space vector must never reach
pgvector. DB access is stubbed at the ``memory_store`` layer.

The request path does NOT embed, so there is no embedder to stub here and
no 503/500 embedder-failure mapping left to test: a caller that sends no
vector gets a NULL-embedding row (see ``test_memory_api_db.py``), never a
server-side embed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.deps import get_async_db
from app.api.strict_query import (
    UNKNOWN_QUERY_PARAMETER,
    StrictQueryRoute,
    accepted_query_keys,
)
from app.api.v1.endpoints.memory import (
    MemoryPrincipal,
    _encode_cursor,
    get_memory_tenant,
    router,
)
from app.schemas.memory import ACCEPTED_EMBEDDING_MODEL_TAGS
from app.services import memory_store
from app.services.memory_vectors import (
    EMBEDDING_DIM,
    EMBEDDING_MODEL_TAG,
    MemoryEmbeddingDimensionError,
    ensure_embedding_dims,
)


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/memory")
    principal = MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor="device")
    app.dependency_overrides[get_memory_tenant] = lambda: principal

    async def _stub_db():
        yield MagicMock()

    app.dependency_overrides[get_async_db] = _stub_db
    return TestClient(app)


def _record(content: str = "some memory content") -> dict:
    return {"title": "a memory", "content": content, "kind": "fact"}


def test_batch_over_100_records_is_422() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={"records": [_record(f"content {i}") for i in range(101)]},
    )
    assert resp.status_code == 422


def test_empty_batch_is_422() -> None:
    client = _build_client()
    resp = client.post("/api/v1/memory/records", json={"records": []})
    assert resp.status_code == 422


def test_content_over_32kb_is_422() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={"records": [_record("x" * (32 * 1024 + 1))]},
    )
    assert resp.status_code == 422


def test_unknown_kind_is_422() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={"records": [{"title": "t", "content": "c", "kind": "not-a-kind"}]},
    )
    assert resp.status_code == 422


def test_query_limit_over_cap_is_422() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/query",
        json={"query_text": "anything", "limit": 51},
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("title_prefix", ["", "x" * 201])
def test_query_title_prefix_empty_or_over_cap_is_422(title_prefix: str) -> None:
    # An empty prefix would silently mean "no filter"; it is rejected so
    # a caller who meant to resolve a head cannot fall through to the
    # unfiltered result.
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/query",
        json={"query_text": "anything", "title_prefix": title_prefix},
    )
    assert resp.status_code == 422


def test_ensure_embedding_dims_accepts_384() -> None:
    ensure_embedding_dims([[0.0] * EMBEDDING_DIM])


def test_ensure_embedding_dims_rejects_wrong_dim() -> None:
    with pytest.raises(MemoryEmbeddingDimensionError):
        ensure_embedding_dims([[0.0] * EMBEDDING_DIM, [0.0] * 3])


def test_accepted_tags_seeded_from_the_deployed_model() -> None:
    """The accepted-tag set is ONE named constant, seeded from the tag the
    server itself stamps — not a scattered literal."""
    assert EMBEDDING_MODEL_TAG in ACCEPTED_EMBEDDING_MODEL_TAGS


def test_deployed_tag_is_the_runners_tag() -> None:
    """The deployed tag must be the one the RUNNER actually stamps.

    Regression guard for the integration defect that made the whole stack
    unshippable: the backend accepted only ``minilm-l6-v2-onnx@fastembed``
    while the runner — now the sole producer of every vector — stamps
    ``minilm-l6-v2-256@sentence-transformers``, so EVERY runner write
    422'd on the model tag. The tag is a cross-repo contract, so it is
    pinned here as a literal rather than derived: an assertion that reads
    the constant back from the module it is defined in would have passed
    against the broken value too.
    """
    assert EMBEDDING_MODEL_TAG == "minilm-l6-v2-256@sentence-transformers"
    assert ACCEPTED_EMBEDDING_MODEL_TAGS == frozenset(
        {"minilm-l6-v2-256@sentence-transformers"}
    )


def test_write_accepts_a_record_stamped_with_the_runners_tag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A record carrying the RUNNER's tag is accepted, end to end.

    The A1 regression test: this is the exact request shape the runner
    sends, and it 422'd before the tag flip.
    """
    _, insert_batch = _stub_store(monkeypatch)
    # Unlike the rejection tests, this one reaches the insert — so the
    # batch stub has to honour its contract: one (memory_id, deduped)
    # outcome per item, in order.
    insert_batch.side_effect = lambda *_a, **kw: [(uuid4(), False) for _ in kw["items"]]
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={
            "records": [
                {
                    "title": "runner-written",
                    "content": "a vector the runner paid for",
                    "kind": "fact",
                    "embedding": [0.1] * EMBEDDING_DIM,
                    "embedding_model": "minilm-l6-v2-256@sentence-transformers",
                }
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    # The runner's vector reached the store verbatim, tag and all.
    stored = insert_batch.call_args.kwargs["items"][0]
    assert stored.embedding_model == "minilm-l6-v2-256@sentence-transformers"


@pytest.mark.parametrize(
    ("body", "why"),
    [
        (
            {"query_text": "q", "query_embedding": [0.1] * EMBEDDING_DIM},
            "vector with no model tag — server cannot tell which space it is in",
        ),
        (
            {
                "query_text": "q",
                "query_embedding": [0.1] * EMBEDDING_DIM,
                "query_embedding_model": "text-embedding-3-small",
            },
            "foreign model tag — a 384-dim vector in a different space",
        ),
        (
            {"query_text": "q", "query_embedding_model": EMBEDDING_MODEL_TAG},
            "tag with no vector",
        ),
    ],
)
def test_query_rejects_untagged_or_foreign_query_vector(
    body: dict[str, object], why: str
) -> None:
    """``query_embedding_model`` is required whenever a vector is sent.

    Validating the vector's DIMENSION is not enough — every 384-dim model
    passes that check while living in a different space, so an untagged or
    foreign query vector would be silently cosine-compared against MiniLM
    vectors. That is the silent-wrong-space class this plan exists to kill.
    """
    client = _build_client()
    resp = client.post("/api/v1/memory/query", json=body)
    assert resp.status_code == 422, f"{why}: {resp.text}"


def _stub_store(monkeypatch: pytest.MonkeyPatch) -> tuple[AsyncMock, AsyncMock]:
    """Stub every store call the write path makes; return the insert mocks."""
    monkeypatch.setattr(memory_store, "existing_hashes", AsyncMock(return_value=set()))
    monkeypatch.setattr(
        memory_store,
        "get_usage",
        AsyncMock(
            return_value=memory_store.TenantMemoryUsage(
                row_count=0, bytes=0, quota_bytes=10_000, quota_rows=100
            )
        ),
    )
    insert = AsyncMock()
    insert_batch = AsyncMock()
    monkeypatch.setattr(memory_store, "insert_record", insert)
    monkeypatch.setattr(memory_store, "insert_records_batch", insert_batch)
    return insert, insert_batch


@pytest.mark.parametrize(
    ("embedding", "embedding_model", "why"),
    [
        ([0.1] * (EMBEDDING_DIM - 1), EMBEDDING_MODEL_TAG, "one component short"),
        ([0.1] * (EMBEDDING_DIM + 1), EMBEDDING_MODEL_TAG, "one component long"),
        ([], EMBEDDING_MODEL_TAG, "empty vector"),
        ([0.1] * EMBEDDING_DIM, "text-embedding-3-small", "foreign model tag"),
        ([0.1] * EMBEDDING_DIM, None, "vector without its tag"),
        (None, EMBEDDING_MODEL_TAG, "tag without a vector"),
    ],
)
def test_write_rejects_bad_embedding_before_any_insert(
    monkeypatch: pytest.MonkeyPatch,
    embedding: list[float] | None,
    embedding_model: str | None,
    why: str,
) -> None:
    """Every malformed embedding pair is a 422 and reaches NO insert — a
    wrong-dim / wrong-space vector must never touch pgvector."""
    insert, insert_batch = _stub_store(monkeypatch)
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={
            "records": [
                {
                    **_record(),
                    "embedding": embedding,
                    "embedding_model": embedding_model,
                }
            ]
        },
    )
    assert resp.status_code == 422, why
    insert.assert_not_awaited()
    insert_batch.assert_not_awaited()


def test_wrong_dim_422_names_the_received_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_store(monkeypatch)
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={
            "records": [
                {
                    **_record(),
                    "embedding": [0.1] * 383,
                    "embedding_model": EMBEDDING_MODEL_TAG,
                }
            ]
        },
    )
    assert resp.status_code == 422
    detail = str(resp.json())
    assert "383" in detail and "384" in detail


def test_query_rejects_wrong_dim_embedding() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/query",
        json={
            "query_text": "anything",
            "query_embedding": [0.1] * 383,
            "query_embedding_model": EMBEDDING_MODEL_TAG,
        },
    )
    assert resp.status_code == 422


def test_supersede_rejects_foreign_model_tag() -> None:
    client = _build_client()
    resp = client.post(
        f"/api/v1/memory/records/{uuid4()}/supersede",
        json={
            "title": "t",
            "content": "c",
            "embedding": [0.1] * EMBEDDING_DIM,
            "embedding_model": "text-embedding-3-small",
        },
    )
    assert resp.status_code == 422


def test_job_result_with_both_result_and_failure_is_422() -> None:
    """A job either produced a result or it failed — never both.

    (The old "a stray embedding on a failure report is 422" check is gone
    because that shape is now UNREPRESENTABLE rather than merely rejected:
    a vector lives inside ``result``, so it cannot be attached to a
    failure at all.)
    """
    client = _build_client()
    resp = client.post(
        f"/api/v1/memory/jobs/{uuid4()}/result",
        json={
            "failure": "LLM refused",
            "result": {
                "result_text": "but also a result",
                "embedding": [0.1] * EMBEDDING_DIM,
                "embedding_model": EMBEDDING_MODEL_TAG,
            },
        },
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Plan ``2026-09-03-wrong-key-reads-cannot-yield-a-silent-zero`` Phase 4:
# an unknown query NAME or body KEY is a 422 naming the key, and every list
# page says how long it is.
# ---------------------------------------------------------------------------


def _detail(resp) -> Any:
    return resp.json()["detail"]


def _extra_forbidden_locs(resp) -> list[tuple[object, ...]]:
    """The ``loc`` of every ``extra_forbidden`` error in a pydantic 422."""
    return [
        tuple(err["loc"]) for err in _detail(resp) if err["type"] == "extra_forbidden"
    ]


def test_every_memory_route_is_strict() -> None:
    """The route class is installed on the ROUTER, so every route — not
    only ``GET /records`` — refuses an unknown query name."""
    routes = [r for r in router.routes if isinstance(r, APIRoute)]
    assert routes
    for route in routes:
        assert isinstance(route, StrictQueryRoute), route.path


def test_list_with_kind_instead_of_kinds_is_422_naming_kinds() -> None:
    """The dossier's exact call: ``?kind=feedback`` on a door whose filter
    is ``kinds``. FastAPI's default ignored the key and answered EVERY
    kind, which was read as "no feedback records". Now the answer is the
    accepted set, with ``kinds`` in it."""
    client = _build_client()
    resp = client.get("/api/v1/memory/records", params={"kind": "feedback"})
    assert resp.status_code == 422, resp.text
    detail = _detail(resp)
    assert detail["error"] == UNKNOWN_QUERY_PARAMETER
    assert detail["unknown"] == ["kind"]
    assert "kinds" in detail["accepted"]
    assert "kind" not in detail["accepted"]
    assert detail["route"] == "/api/v1/memory/records"


def test_stats_with_a_stray_key_is_422() -> None:
    """A route with NO query parameters refuses every key: ``accepted`` is
    empty, which is the honest answer rather than a silent 200."""
    client = _build_client()
    resp = client.get("/api/v1/memory/stats", params={"kinds": "fact"})
    assert resp.status_code == 422, resp.text
    detail = _detail(resp)
    assert detail["unknown"] == ["kinds"]
    assert detail["accepted"] == []


def _list_row(seq: int, created_at: datetime) -> dict:
    return {
        "memory_id": uuid4(),
        "title": f"row {seq}",
        "content": f"content {seq}",
        "kind": "fact",
        "scope": "tenant",
        "scope_ref": None,
        "importance": 0.5,
        "content_hash": "0" * 64,
        "created_at": created_at,
        "updated_at": created_at,
        "source": {},
        "anchors": [],
        "anchor_state": "none",
        "seq": seq,
    }


def _stub_list(monkeypatch: pytest.MonkeyPatch, rows: list[dict]) -> AsyncMock:
    page = AsyncMock(return_value=rows)
    monkeypatch.setattr(memory_store, "list_records_page", page)
    monkeypatch.setattr(
        memory_store, "fetch_outbound_links", AsyncMock(return_value={})
    )
    return page


def test_list_with_every_declared_key_is_still_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The strict class refuses UNKNOWN names only. Every key the handler
    declares — read from the mounted route, not retyped — still reaches
    the store with its parsed value."""
    now = datetime.now(UTC)
    page = _stub_list(monkeypatch, [_list_row(1, now)])
    client = _build_client()
    route = next(
        r
        for r in router.routes
        if isinstance(r, APIRoute) and r.path == "/records" and "GET" in r.methods
    )
    declared = accepted_query_keys(route.dependant)
    sent = {
        "kinds": "fact,feedback",
        "since": (now - timedelta(days=1)).isoformat(),
        "cursor": _encode_cursor(now, 7),
        "limit": "1",
    }
    assert set(sent) == set(declared), declared
    resp = client.get("/api/v1/memory/records", params=sent)
    assert resp.status_code == 200, resp.text
    kwargs = page.call_args.kwargs
    assert kwargs["kinds"] == ["fact", "feedback"]
    assert kwargs["limit"] == 1
    assert kwargs["cursor"] == (now, 7)
    assert kwargs["since"] is not None


@pytest.mark.parametrize("n", [0, 1, 3])
def test_list_page_carries_count_equal_to_its_length(
    monkeypatch: pytest.MonkeyPatch, n: int
) -> None:
    """``count`` is the page length, including ``0`` on an empty page —
    the envelope key a reader checks before trusting ``records: []``."""
    now = datetime.now(UTC)
    _stub_list(monkeypatch, [_list_row(i, now) for i in range(n)])
    client = _build_client()
    resp = client.get("/api/v1/memory/records", params={"limit": "10"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == len(body["records"]) == n


def test_write_with_supersedes_inside_a_record_is_422_naming_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The dossier's occurrence: ``supersedes`` inside a record (the real
    door is ``POST /records/{id}/supersede``). Pydantic's default dropped
    the key and the write "succeeded" without the field that was its
    whole point. Now it is a 422 that names the key, and NO insert runs."""
    insert, insert_batch = _stub_store(monkeypatch)
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={"records": [{**_record(), "supersedes": str(uuid4())}]},
    )
    assert resp.status_code == 422, resp.text
    assert _extra_forbidden_locs(resp) == [("body", "records", 0, "supersedes")]
    insert.assert_not_awaited()
    insert_batch.assert_not_awaited()


def test_write_with_an_unknown_top_level_key_is_422() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/records",
        json={"records": [_record()], "record": _record()},
    )
    assert resp.status_code == 422, resp.text
    assert _extra_forbidden_locs(resp) == [("body", "record")]


def test_supersede_with_an_unknown_key_is_422_naming_it() -> None:
    """A misspelled field on a supersede would otherwise be dropped and
    the successor would INHERIT the value the caller meant to replace."""
    client = _build_client()
    resp = client.post(
        f"/api/v1/memory/records/{uuid4()}/supersede",
        json={"title": "t", "content": "c", "kinds": ["fact"]},
    )
    assert resp.status_code == 422, resp.text
    assert _extra_forbidden_locs(resp) == [("body", "kinds")]


def test_graph_with_relation_instead_of_relation_filter_is_422() -> None:
    client = _build_client()
    resp = client.post(
        "/api/v1/memory/graph",
        json={"root_memory_id": str(uuid4()), "relation": ["supports"]},
    )
    assert resp.status_code == 422, resp.text
    assert _extra_forbidden_locs(resp) == [("body", "relation")]
