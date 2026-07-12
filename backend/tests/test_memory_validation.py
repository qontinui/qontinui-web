"""Validation + embedder-contract tests for the memory API — no DB.

Covers the request-shape 422s (batch cap, content byte cap, query limit
cap), the embedding dimensionality assertion on the write path, and the
503 mapping when the embedder is unavailable. DB access is stubbed at
the ``memory_store`` layer; the embedder is always a deterministic stub.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
from app.services import memory_embedder, memory_store
from app.services.memory_embedder import (
    EMBEDDING_DIM,
    MemoryEmbeddingDimensionError,
    ensure_embedding_dims,
)


class StubEmbedder:
    """Deterministic constant-vector embedder (configurable dim)."""

    def __init__(self, dim: int = EMBEDDING_DIM) -> None:
        self.dim = dim

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * self.dim for _ in texts]


@pytest.fixture(autouse=True)
def _stub_embedder():
    memory_embedder.set_embedder(StubEmbedder())
    yield
    memory_embedder.set_embedder(None)


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


def test_write_path_rejects_wrong_dim_embedder_before_insert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A wrong-dimensional embedder must 500 BEFORE any insert runs."""
    memory_embedder.set_embedder(StubEmbedder(dim=8))
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

    client = _build_client()
    resp = client.post("/api/v1/memory/records", json={"records": [_record()]})
    assert resp.status_code == 500
    assert "384" in resp.json()["detail"]
    insert.assert_not_awaited()
    insert_batch.assert_not_awaited()


def test_write_path_maps_unavailable_embedder_to_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No embedder → 503, never a silent NULL-embedding insert."""

    def _unavailable():
        raise memory_embedder.MemoryEmbedderUnavailableError("no model")

    memory_embedder.set_embedder(None)
    monkeypatch.setattr("app.api.v1.endpoints.memory.get_embedder", _unavailable)
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

    client = _build_client()
    resp = client.post("/api/v1/memory/records", json={"records": [_record()]})
    assert resp.status_code == 503
    insert.assert_not_awaited()
    insert_batch.assert_not_awaited()
