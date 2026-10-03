"""DB-backed tests for ``GET /api/v1/memory/records/{memory_id}``.

The read-back half of a memory write receipt (plan
``2026-09-21-a-memory-write-receipt-cannot-be-read-back-by-any-door-a-degraded-session-holds``
Phase 1(a)). The route returns ONE row in whatever state it is in — live,
superseded or tombstoned — tenant-scoped, and answers an identical 404 for
an unknown id and for another tenant's id.

Reuses the schema DDL and the switchable-principal ``MemoryClient`` from
``test_memory_api_db``; SKIPS when the test PostgreSQL (or pgvector) is
unreachable, same posture as that suite.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import _SETUP_SQL, MemoryClient, _exec, _record

_CONTRACT_KEYS = {
    "memory_id",
    "tenant_id",
    "title",
    "content",
    "kind",
    "scope",
    "scope_ref",
    "importance",
    "created_at",
    "state",
    "superseded_by",
    "valid_until",
}

_NOT_FOUND = {"detail": "memory record not found in your tenant"}


@pytest.fixture(scope="module")
def memory_engine() -> Generator[AsyncEngine, None, None]:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
    try:
        _exec(engine, ["SELECT 1"])
    except Exception as exc:  # pragma: no cover — infra-dependent
        asyncio.run(engine.dispose())
        pytest.skip(f"test PostgreSQL unavailable: {exc}")
    try:
        _exec(engine, ["CREATE EXTENSION IF NOT EXISTS vector"])
    except Exception as exc:  # pragma: no cover — infra-dependent
        asyncio.run(engine.dispose())
        pytest.skip(f"pgvector unavailable in test PostgreSQL: {exc}")
    _exec(engine, _SETUP_SQL)
    yield engine
    asyncio.run(engine.dispose())


@pytest.fixture()
def mc(memory_engine: AsyncEngine) -> MemoryClient:
    _exec(
        memory_engine,
        [
            "DELETE FROM coord.memory_jobs",
            "DELETE FROM coord.memory_links",
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
            "DELETE FROM coord.sessions",
        ],
    )
    return MemoryClient(memory_engine)


def _write(mc: MemoryClient, content: str, **extra: Any) -> str:
    resp = mc.client.post(
        "/api/v1/memory/records", json={"records": [_record(content, **extra)]}
    )
    assert resp.status_code == 200, resp.text
    memory_id: str = resp.json()["records"][0]["memory_id"]
    return memory_id


def _get(mc: MemoryClient, memory_id: str) -> Any:
    return mc.client.get(f"/api/v1/memory/records/{memory_id}")


class TestGetRecordById:
    def test_live_row_returns_every_contract_field(self, mc: MemoryClient) -> None:
        memory_id = _write(
            mc,
            "the receipt read-back resolves by id",
            title="receipt",
            kind="observation",
            scope="agent",
            scope_ref="agent-xyz",
            importance=0.75,
        )

        resp = _get(mc, memory_id)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == _CONTRACT_KEYS
        assert body["memory_id"] == memory_id
        assert body["tenant_id"] == str(mc.tenant_id)
        assert body["title"] == "receipt"
        assert body["content"] == "the receipt read-back resolves by id"
        assert body["kind"] == "observation"
        assert body["scope"] == "agent"
        assert body["scope_ref"] == "agent-xyz"
        assert body["importance"] == pytest.approx(0.75)
        datetime.fromisoformat(body["created_at"])
        assert body["state"] == "live"
        assert body["superseded_by"] is None
        assert body["valid_until"] is None

    def test_superseded_row_reports_state_and_successor(self, mc: MemoryClient) -> None:
        old_id = _write(mc, "original content that gets corrected")
        sup = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "corrected", "content": "corrected replacement content"},
        )
        assert sup.status_code == 200, sup.text
        new_id = sup.json()["memory_id"]

        old = _get(mc, old_id)
        assert old.status_code == 200, old.text
        body = old.json()
        assert body["state"] == "superseded"
        assert body["superseded_by"] == new_id
        assert body["valid_until"] is not None
        datetime.fromisoformat(body["valid_until"])
        assert body["content"] == "original content that gets corrected"

        new = _get(mc, new_id).json()
        assert new["state"] == "live"
        assert new["superseded_by"] is None

    def test_deleted_row_is_returned_tombstoned(self, mc: MemoryClient) -> None:
        memory_id = _write(mc, "content that a peer later deletes")
        deleted = mc.client.delete(f"/api/v1/memory/records/{memory_id}")
        assert deleted.status_code == 204

        resp = _get(mc, memory_id)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["state"] == "tombstoned"
        assert body["superseded_by"] is None
        assert body["valid_until"] is not None

    def test_other_tenants_id_is_404_without_disclosure(self, mc: MemoryClient) -> None:
        memory_id = _write(mc, "tenant A private knowledge for by-id read")
        mc.as_tenant(uuid4())

        resp = _get(mc, memory_id)

        assert resp.status_code == 404
        assert resp.json() == _NOT_FOUND

    def test_unknown_id_is_the_same_404(self, mc: MemoryClient) -> None:
        resp = _get(mc, str(uuid4()))

        assert resp.status_code == 404
        assert resp.json() == _NOT_FOUND

    def test_malformed_id_is_422(self, mc: MemoryClient) -> None:
        resp = _get(mc, "not-a-uuid")

        assert resp.status_code == 422

    def test_tenant_id_echoes_the_serving_principal(self, mc: MemoryClient) -> None:
        tenant = UUID(int=0x2026_0921)
        mc.as_tenant(tenant)
        memory_id = _write(mc, "echo the tenant that served this read")

        assert _get(mc, memory_id).json()["tenant_id"] == str(tenant)
