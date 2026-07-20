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

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
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
