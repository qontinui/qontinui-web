"""DB-backed tests for the memory API — dedup, quota, isolation, hybrid query.

Runs against the same PostgreSQL test database the rest of the suite
uses (``qontinui_test``, see ``tests/conftest.py``). Requires the
pgvector extension — the ``coord.memory_records`` substrate is
vector-typed by design (its migration hard-requires pgvector >= 0.5.0).
When Postgres is unreachable or pgvector is unavailable, this module
SKIPS (same graceful-degrade posture as conftest's vector-table
handling); the pure-logic suites (rrf/redaction/auth/validation) still
run everywhere.

The schema is created directly from test DDL mirroring the
``coord_memory_records`` migration (minus the FK to ``coord.tenants``,
which the isolated test DB doesn't carry, and the HNSW index — a
sequential scan is exact at test sizes). The embedder is a
deterministic hashing stub — the real model is never downloaded.

Loop discipline: all direct DB access goes through ``asyncio.run`` on a
NullPool engine, so no asyncpg connection ever crosses event loops (the
TestClient-driven app code runs its own portal loop; NullPool gives it
fresh per-request connections there too).
"""

from __future__ import annotations

import asyncio
import hashlib
import math
from collections.abc import AsyncGenerator, Generator
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
from app.services import memory_embedder
from app.services.memory_embedder import EMBEDDING_DIM
from tests.conftest import TEST_DATABASE_URL

# ---------------------------------------------------------------------------
# Deterministic stub embedder — hashed bag-of-words, so lexically similar
# texts land near each other in vector space (enough signal for ranking
# assertions) with zero model downloads and full determinism.
# ---------------------------------------------------------------------------


class HashingStubEmbedder:
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    @staticmethod
    def _vec(text_: str) -> list[float]:
        v = [0.0] * EMBEDDING_DIM
        for word in text_.lower().split():
            bucket = int.from_bytes(
                hashlib.sha256(word.encode("utf-8")).digest()[:4], "big"
            )
            v[bucket % EMBEDDING_DIM] += 1.0
        norm = math.sqrt(sum(x * x for x in v))
        return [x / norm for x in v] if norm > 0 else v


# ---------------------------------------------------------------------------
# Test DDL — mirrors alembic/versions/coord_memory_records.py (sans the
# tenants FK; HNSW index omitted, sequential scan is exact for test sizes).
# ---------------------------------------------------------------------------

_SETUP_SQL = [
    "CREATE SCHEMA IF NOT EXISTS coord",
    """
    CREATE TABLE IF NOT EXISTS coord.memory_records (
        memory_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          UUID NOT NULL,
        scope              TEXT NOT NULL DEFAULT 'tenant'
            CHECK (scope IN ('tenant', 'runner', 'agent', 'session')),
        scope_ref          TEXT,
        kind               TEXT NOT NULL
            CHECK (kind IN (
                'observation', 'fact', 'mental_model', 'episode',
                'feedback', 'reference', 'rule'
            )),
        title              TEXT NOT NULL,
        content            TEXT NOT NULL,
        content_hash       TEXT NOT NULL,
        embedding          vector(384),
        embedding_model    TEXT,
        content_tsv        tsvector GENERATED ALWAYS AS (
            to_tsvector('english', title || ' ' || content)
        ) STORED,
        importance         REAL NOT NULL DEFAULT 0.5,
        access_count       INTEGER NOT NULL DEFAULT 0,
        last_accessed_at   TIMESTAMPTZ,
        valid_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
        valid_until        TIMESTAMPTZ,
        superseded_by      UUID REFERENCES coord.memory_records(memory_id),
        consolidated_from  UUID[],
        source             JSONB NOT NULL DEFAULT '{}',
        is_tombstone       BOOLEAN NOT NULL DEFAULT false,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT memory_records_tenant_content_hash_key
            UNIQUE (tenant_id, content_hash)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS coord.tenant_policies (
        tenant_id          UUID PRIMARY KEY,
        memory_quota_bytes BIGINT NOT NULL DEFAULT 268435456,
        memory_row_quota   BIGINT NOT NULL DEFAULT 500000
    )
    """,
]


def _exec(engine: AsyncEngine, statements: list[str], **params: Any) -> None:
    async def _go() -> None:
        async with engine.begin() as conn:
            for stmt in statements:
                await conn.execute(text(stmt), params or {})

    asyncio.run(_go())


def _scalar(engine: AsyncEngine, sql: str, **params: Any) -> Any:
    async def _go() -> Any:
        async with engine.connect() as conn:
            return (await conn.execute(text(sql), params)).scalar()

    return asyncio.run(_go())


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
def db(memory_engine: AsyncEngine) -> Generator[AsyncEngine, None, None]:
    """Per-test clean slate over the module-scoped engine."""
    _exec(
        memory_engine,
        [
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
        ],
    )
    yield memory_engine


@pytest.fixture(autouse=True)
def _stub_embedder() -> Generator[None, None, None]:
    memory_embedder.set_embedder(HashingStubEmbedder())
    yield
    memory_embedder.set_embedder(None)


class MemoryClient:
    """TestClient wrapper with a switchable tenant principal."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._principal = MemoryPrincipal(
            tenant_id=uuid4(), device_id=None, actor="device"
        )
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async def _get_db() -> AsyncGenerator[AsyncSession, None]:
            async with maker() as session:
                yield session
                await session.commit()

        app = FastAPI()
        app.include_router(router, prefix="/api/v1/memory")
        app.dependency_overrides[get_memory_tenant] = lambda: self._principal
        app.dependency_overrides[get_async_db] = _get_db
        self.client = TestClient(app)

    @property
    def tenant_id(self) -> UUID:
        return self._principal.tenant_id

    def as_tenant(self, tenant_id: UUID) -> MemoryClient:
        self._principal = MemoryPrincipal(
            tenant_id=tenant_id, device_id=None, actor="device"
        )
        return self


def _record(
    content: str, title: str = "note", kind: str = "fact", **extra: Any
) -> dict[str, Any]:
    return {"title": title, "content": content, "kind": kind, **extra}


@pytest.fixture()
def mc(db: AsyncEngine) -> MemoryClient:
    return MemoryClient(db)


# ---------------------------------------------------------------------------
# Dedup
# ---------------------------------------------------------------------------


class TestHashDedup:
    def test_same_content_twice_is_one_row(self, mc: MemoryClient) -> None:
        first = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the runner retries three times")]},
        )
        assert first.status_code == 200
        body1 = first.json()
        assert body1["deduped_count"] == 0
        (r1,) = body1["records"]
        assert r1["deduped"] is False

        second = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the runner retries three times")]},
        )
        assert second.status_code == 200
        body2 = second.json()
        assert body2["deduped_count"] == 1
        (r2,) = body2["records"]
        assert r2["deduped"] is True
        # Same underlying row.
        assert r2["memory_id"] == r1["memory_id"]

        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 1

    def test_intra_batch_duplicates_dedup(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("duplicate content in one batch"),
                    _record("duplicate content in one batch"),
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deduped_count"] == 1
        assert body["records"][0]["memory_id"] == body["records"][1]["memory_id"]
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 1


# ---------------------------------------------------------------------------
# Quota
# ---------------------------------------------------------------------------


class TestQuota:
    def test_byte_quota_exceeded_is_429(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        _exec(
            db,
            [
                "INSERT INTO coord.tenant_policies "
                "(tenant_id, memory_quota_bytes, memory_row_quota) "
                "VALUES (:t, 16, 1000)"
            ],
            t=mc.tenant_id,
        )
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [_record("this content is far longer than sixteen bytes")]
            },
        )
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "memory_quota_exceeded"
        assert body["quota_bytes"] == 16
        assert body["used_bytes"] == 0
        assert "quota_rows" in body and "used_rows" in body
        # Nothing was inserted.
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 0

    def test_row_quota_exceeded_is_429(self, mc: MemoryClient, db: AsyncEngine) -> None:
        _exec(
            db,
            [
                "INSERT INTO coord.tenant_policies "
                "(tenant_id, memory_quota_bytes, memory_row_quota) "
                "VALUES (:t, 1000000, 1)"
            ],
            t=mc.tenant_id,
        )
        ok = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record("row one")]}
        )
        assert ok.status_code == 200
        over = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record("row two")]}
        )
        assert over.status_code == 429
        assert over.json()["error"] == "memory_quota_exceeded"

    def test_missing_policy_row_uses_defaults(self, mc: MemoryClient) -> None:
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["quota_bytes"] == 256 * 1024 * 1024
        assert stats["quota_rows"] == 500_000


# ---------------------------------------------------------------------------
# Cross-tenant isolation
# ---------------------------------------------------------------------------


class TestTenantIsolation:
    def test_other_tenant_cannot_read_supersede_or_delete(
        self, mc: MemoryClient
    ) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("tenant A private knowledge zebra")]},
        )
        assert write.status_code == 200
        memory_id = write.json()["records"][0]["memory_id"]

        mc.as_tenant(uuid4())  # tenant B

        query = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "tenant A private knowledge zebra"},
        )
        assert query.status_code == 200
        assert query.json()["hits"] == []

        supersede = mc.client.post(
            f"/api/v1/memory/records/{memory_id}/supersede",
            json={"title": "hijack", "content": "hijacked content"},
        )
        assert supersede.status_code == 404

        delete = mc.client.delete(f"/api/v1/memory/records/{memory_id}")
        assert delete.status_code == 404

    def test_stats_are_tenant_scoped(self, mc: MemoryClient) -> None:
        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("tenant A row")]},
        )
        assert mc.client.get("/api/v1/memory/stats").json()["row_count"] == 1
        mc.as_tenant(uuid4())
        assert mc.client.get("/api/v1/memory/stats").json()["row_count"] == 0


# ---------------------------------------------------------------------------
# Hybrid query
# ---------------------------------------------------------------------------


class TestHybridQuery:
    def test_query_returns_relevant_hit_with_fusion_metadata(
        self, mc: MemoryClient
    ) -> None:
        mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "postgres connection pool exhausted under load",
                        title="db incident",
                        kind="episode",
                    ),
                    _record(
                        "the dashboard sidebar uses tailwind grid",
                        title="frontend note",
                    ),
                    _record(
                        "rotate the staging certificates every ninety days",
                        title="ops rule",
                        kind="rule",
                    ),
                ]
            },
        )
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "postgres connection pool exhausted", "limit": 2},
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert hits, "expected at least one hit"
        top = hits[0]
        assert top["title"] == "db incident"
        assert top["rrf_score"] > 0
        # The matching doc should surface in both arms.
        assert top["vector_rank"] == 1
        assert top["fts_rank"] == 1
        assert top["cosine_similarity"] is not None
        assert len(hits) <= 2

    def test_query_bumps_access_count(self, mc: MemoryClient, db: AsyncEngine) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("unique aardvark fact")]},
        )
        memory_id = write.json()["records"][0]["memory_id"]
        mc.client.post(
            "/api/v1/memory/query", json={"query_text": "unique aardvark fact"}
        )
        count = _scalar(
            db,
            "SELECT access_count FROM coord.memory_records WHERE memory_id = :m",
            m=memory_id,
        )
        assert count == 1

    def test_kind_filter(self, mc: MemoryClient) -> None:
        mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("gazelle sighting on the savanna", kind="observation"),
                    _record("gazelle migration is seasonal", kind="rule"),
                ]
            },
        )
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "gazelle", "kinds": ["rule"]},
        )
        hits = resp.json()["hits"]
        assert hits
        assert all(h["kind"] == "rule" for h in hits)

    def test_narrow_scope_requires_scope_ref(self, mc: MemoryClient) -> None:
        mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "session-scoped kangaroo detail",
                        scope="session",
                        scope_ref="sess-123",
                    )
                ]
            },
        )
        # Default scopes: narrow rows invisible.
        default = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "kangaroo detail"}
        )
        assert default.json()["hits"] == []
        # Scope named but no scope_ref: still invisible.
        no_ref = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "kangaroo detail", "scopes": ["session"]},
        )
        assert no_ref.json()["hits"] == []
        # Scope + matching ref: visible.
        with_ref = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "kangaroo detail",
                "scopes": ["session"],
                "scope_ref": "sess-123",
            },
        )
        assert len(with_ref.json()["hits"]) == 1


# ---------------------------------------------------------------------------
# Supersede / delete lifecycle
# ---------------------------------------------------------------------------


class TestLifecycle:
    def test_supersede_replaces_and_invalidates_old(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the flamingo cluster has four nodes")]},
        )
        old_id = write.json()["records"][0]["memory_id"]

        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "note",
                "content": "the flamingo cluster has six nodes now",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        new_id = body["memory_id"]
        assert body["superseded_memory_id"] == old_id
        assert new_id != old_id

        superseded_by = _scalar(
            db,
            "SELECT superseded_by FROM coord.memory_records WHERE memory_id = :m",
            m=old_id,
        )
        assert str(superseded_by) == new_id
        valid_until = _scalar(
            db,
            "SELECT valid_until FROM coord.memory_records WHERE memory_id = :m",
            m=old_id,
        )
        assert valid_until is not None

        # Query only surfaces the successor.
        hits = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "flamingo cluster nodes"},
        ).json()["hits"]
        assert [h["memory_id"] for h in hits] == [new_id]

    def test_supersede_with_identical_content_is_409(self, mc: MemoryClient) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("immutable truth about the walrus")]},
        )
        old_id = write.json()["records"][0]["memory_id"]
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "note", "content": "immutable truth about the walrus"},
        )
        assert resp.status_code == 409

    def test_delete_tombstones_and_hides(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("obsolete ostrich observation")]},
        )
        memory_id = write.json()["records"][0]["memory_id"]

        resp = mc.client.delete(f"/api/v1/memory/records/{memory_id}")
        assert resp.status_code == 204

        is_tombstone = _scalar(
            db,
            "SELECT is_tombstone FROM coord.memory_records WHERE memory_id = :m",
            m=memory_id,
        )
        assert is_tombstone is True

        hits = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "obsolete ostrich"}
        ).json()["hits"]
        assert hits == []

    def test_delete_unknown_id_is_404(self, mc: MemoryClient) -> None:
        resp = mc.client.delete(f"/api/v1/memory/records/{uuid4()}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Redaction lands in storage + stats coverage
# ---------------------------------------------------------------------------


class TestStorageEffects:
    def test_secrets_are_redacted_before_storage(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the deploy key was AKIAIOSFODNN7EXAMPLE oops")]},
        )
        memory_id = write.json()["records"][0]["memory_id"]
        stored = _scalar(
            db,
            "SELECT content FROM coord.memory_records WHERE memory_id = :m",
            m=memory_id,
        )
        assert "AKIAIOSFODNN7EXAMPLE" not in stored
        assert "[REDACTED:aws_key]" in stored

    def test_stats_shape_and_coverage(self, mc: MemoryClient) -> None:
        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("coverage check content")]},
        )
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 1
        assert stats["bytes"] > 0
        assert stats["embedding_coverage"] == 1.0
        assert 0 < stats["quota_utilization"] < 1
