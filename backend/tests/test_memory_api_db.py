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
import json
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
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    # Legacy shape from an older run of this suite against a persistent
    # test DB — the table-level UNIQUE was replaced by the partial index.
    """
    ALTER TABLE coord.memory_records
        DROP CONSTRAINT IF EXISTS memory_records_tenant_content_hash_key
    """,
    # Live-row dedup key — mirrors the migration's partial unique index:
    # dead rows (tombstoned / superseded / validity-ended) release their
    # content_hash for a fresh write.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS
        uq_memory_records_tenant_content_hash_live
        ON coord.memory_records (tenant_id, content_hash)
        WHERE is_tombstone = false
          AND superseded_by IS NULL
          AND valid_until IS NULL
    """,
    """
    CREATE TABLE IF NOT EXISTS coord.tenant_policies (
        tenant_id          UUID PRIMARY KEY,
        memory_quota_bytes BIGINT NOT NULL DEFAULT 268435456,
        memory_row_quota   BIGINT NOT NULL DEFAULT 500000
    )
    """,
    # Minimal coord.sessions (sans the tenants/devices FKs the isolated
    # test DB doesn't carry) — only the columns the session-close expiry
    # sweep touches: id / state / closed_at / started_at.
    """
    CREATE TABLE IF NOT EXISTS coord.sessions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL,
        state       TEXT NOT NULL DEFAULT 'active'
            CHECK (state IN ('active', 'pending_resolution', 'stale', 'closed')),
        closed_at   TIMESTAMPTZ,
        started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    # Mirrors alembic/versions/coord_memory_synthesis_jobs.py (sans the
    # tenants FK).
    """
    CREATE TABLE IF NOT EXISTS coord.memory_synthesis_jobs (
        job_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL,
        member_ids      UUID[] NOT NULL,
        member_texts    JSONB NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
        claimed_by      TEXT,
        claimed_at      TIMESTAMPTZ,
        finished_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        result_text     TEXT,
        attempt         INTEGER NOT NULL DEFAULT 0,
        member_set_hash TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_memory_synthesis_jobs_pending
        ON coord.memory_synthesis_jobs (tenant_id, created_at)
        WHERE status = 'pending'
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS
        uq_memory_synthesis_jobs_live_member_set
        ON coord.memory_synthesis_jobs (tenant_id, member_set_hash)
        WHERE status IN ('pending', 'claimed', 'done')
    """,
    # Librarian Phase 4: widen the kind CHECK to admit 'library'. Mirrors
    # the coord_memory_links migration's drop+recreate — also upgrades a
    # persistent test DB whose table predates the widening.
    """
    ALTER TABLE coord.memory_records
        DROP CONSTRAINT IF EXISTS memory_records_kind_check
    """,
    """
    ALTER TABLE coord.memory_records
        ADD CONSTRAINT memory_records_kind_check
            CHECK (kind IN (
                'observation', 'fact', 'mental_model', 'episode',
                'feedback', 'reference', 'rule', 'library'
            ))
    """,
    # Mirrors alembic/versions/coord_memory_links.py (sans the tenants FK).
    """
    CREATE TABLE IF NOT EXISTS coord.memory_links (
        link_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL,
        source_id   UUID NOT NULL
            REFERENCES coord.memory_records(memory_id) ON DELETE CASCADE,
        target_id   UUID NOT NULL
            REFERENCES coord.memory_records(memory_id) ON DELETE CASCADE,
        relation    TEXT NOT NULL
            CHECK (relation IN (
                'depends_on', 'implements', 'supersedes', 'related'
            )),
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_links_edge
        ON coord.memory_links (tenant_id, source_id, target_id, relation)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_memory_links_tenant_source
        ON coord.memory_links (tenant_id, source_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_memory_links_tenant_target
        ON coord.memory_links (tenant_id, target_id)
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
            "DELETE FROM coord.memory_synthesis_jobs",
            "DELETE FROM coord.memory_links",
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
            "DELETE FROM coord.sessions",
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

    def test_batch_mixed_new_dup_and_intra_dup_preserves_order(
        self, mc: MemoryClient
    ) -> None:
        """Set-based batch insert: request order + dedup flags survive a
        mix of new rows, a pre-existing duplicate, and an intra-batch
        duplicate (first occurrence wins)."""
        pre = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("previously stored heron fact")]},
        )
        pre_id = pre.json()["records"][0]["memory_id"]

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("brand new ibis fact"),
                    _record("previously stored heron fact"),
                    _record("brand new ibis fact"),
                    _record("brand new jackdaw fact"),
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        records = body["records"]
        assert [r["deduped"] for r in records] == [False, True, True, False]
        assert records[1]["memory_id"] == pre_id
        assert records[2]["memory_id"] == records[0]["memory_id"]
        assert records[3]["memory_id"] != records[0]["memory_id"]
        assert body["deduped_count"] == 2
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 3


# ---------------------------------------------------------------------------
# Liveness dedup — dead rows release their content_hash (partial index)
# ---------------------------------------------------------------------------


class TestLivenessDedup:
    def test_tombstoned_content_can_be_rewritten(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """write → tombstone → identical re-write is a NEW live row, not a
        silent ``deduped=true`` ack against unretrievable content."""
        first = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the phoenix rises from its ashes")]},
        )
        old_id = first.json()["records"][0]["memory_id"]
        assert mc.client.delete(f"/api/v1/memory/records/{old_id}").status_code == 204

        second = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the phoenix rises from its ashes")]},
        )
        assert second.status_code == 200
        (rec,) = second.json()["records"]
        assert rec["deduped"] is False
        assert rec["memory_id"] != old_id

        # The re-written content is retrievable again.
        hits = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "phoenix rises ashes"}
        ).json()["hits"]
        assert [h["memory_id"] for h in hits] == [rec["memory_id"]]
        # Two physical rows (tombstone + live), one live.
        count = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_records WHERE tenant_id = :t",
            t=mc.tenant_id,
        )
        assert count == 2

    def test_superseded_original_content_can_be_rewritten(
        self, mc: MemoryClient
    ) -> None:
        """write A → supersede with B → re-write of A's content succeeds
        as a fresh live row (the superseded row released its hash)."""
        first = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the griffin guards the gold")]},
        )
        old_id = first.json()["records"][0]["memory_id"]
        superseded = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "note", "content": "the griffin abandoned the gold"},
        )
        assert superseded.status_code == 200

        rewrite = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the griffin guards the gold")]},
        )
        assert rewrite.status_code == 200
        (rec,) = rewrite.json()["records"]
        assert rec["deduped"] is False
        assert rec["memory_id"] != old_id


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

    def test_tombstone_frees_usage_in_stats(self, mc: MemoryClient) -> None:
        """Deleted (tombstoned) rows stop counting against usage."""
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("short-lived pelican note")]},
        )
        memory_id = write.json()["records"][0]["memory_id"]
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 1
        assert stats["bytes"] > 0

        assert (
            mc.client.delete(f"/api/v1/memory/records/{memory_id}").status_code == 204
        )
        stats = mc.client.get("/api/v1/memory/stats").json()
        assert stats["row_count"] == 0
        assert stats["bytes"] == 0

    def test_delete_frees_row_quota_for_new_writes(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Row quota is a LIVE-row budget: delete → the slot is reusable."""
        _exec(
            db,
            [
                "INSERT INTO coord.tenant_policies "
                "(tenant_id, memory_quota_bytes, memory_row_quota) "
                "VALUES (:t, 1000000, 1)"
            ],
            t=mc.tenant_id,
        )
        first = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record("row one")]}
        )
        assert first.status_code == 200
        memory_id = first.json()["records"][0]["memory_id"]
        over = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record("row two")]}
        )
        assert over.status_code == 429

        mc.client.delete(f"/api/v1/memory/records/{memory_id}")
        retry = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record("row two")]}
        )
        assert retry.status_code == 200


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
        # Synthesis-job backlog fields (v1.1) present, zeroed when idle.
        assert stats["synthesis_jobs_pending"] == 0
        assert stats["synthesis_jobs_done"] == 0


class TestSynthesisEndpoints:
    """The claim/result wire contract a runner poller builds against."""

    @staticmethod
    def _seed_job(engine: AsyncEngine, tenant: UUID, texts: list[str]) -> UUID:
        job_id = uuid4()
        _exec(
            engine,
            [
                """
                INSERT INTO coord.memory_synthesis_jobs
                    (job_id, tenant_id, member_ids, member_texts,
                     member_set_hash)
                VALUES
                    (:job_id, :tenant, CAST(:member_ids AS uuid[]),
                     CAST(:member_texts AS jsonb), :hash)
                """
            ],
            job_id=job_id,
            tenant=tenant,
            member_ids=[str(uuid4())],
            member_texts=json.dumps(texts),
            hash=f"h-{job_id}",
        )
        return job_id

    def test_claim_returns_job_id_and_member_texts(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["alpha", "beta"])
        resp = mc.client.post("/api/v1/memory/synthesis-jobs/claim", json={"limit": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["jobs"]) == 1
        assert body["jobs"][0]["job_id"] == str(job_id)
        assert body["jobs"][0]["member_texts"] == ["alpha", "beta"]

    def test_result_success_applies(self, mc: MemoryClient, db: AsyncEngine) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["one", "two"])
        # A result is only accepted for a job the runner holds a claim on.
        mc.client.post("/api/v1/memory/synthesis-jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/synthesis-jobs/{job_id}/result",
            json={"result_text": "a distilled mental model"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "applied"}
        assert (
            _scalar(
                db,
                "SELECT status FROM coord.memory_synthesis_jobs WHERE job_id = :j",
                j=job_id,
            )
            == "done"
        )

    def test_result_failure_records(self, mc: MemoryClient, db: AsyncEngine) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["x"])
        mc.client.post("/api/v1/memory/synthesis-jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/synthesis-jobs/{job_id}/result",
            json={"failure": "could not synthesize"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "recorded"}

    def test_result_on_unclaimed_job_is_409(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # Posting a result for a job that was never claimed (or was requeued
        # by the reaper) is rejected — the runner must hold a live claim.
        job_id = self._seed_job(db, mc.tenant_id, ["a", "b"])
        resp = mc.client.post(
            f"/api/v1/memory/synthesis-jobs/{job_id}/result",
            json={"result_text": "text"},
        )
        assert resp.status_code == 409

    def test_foreign_tenant_job_cannot_be_claimed_or_resulted(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # A job belonging to a different tenant is invisible to claim and
        # its id is never resolvable on the result path (404, not 409 —
        # existence is not disclosed across the tenant boundary).
        foreign_job = self._seed_job(db, uuid4(), ["secret", "cluster"])
        claimed = mc.client.post(
            "/api/v1/memory/synthesis-jobs/claim", json={"limit": 4}
        ).json()["jobs"]
        assert all(j["job_id"] != str(foreign_job) for j in claimed)

        resp = mc.client.post(
            f"/api/v1/memory/synthesis-jobs/{foreign_job}/result",
            json={"result_text": "text"},
        )
        assert resp.status_code == 404
        # Untouched in its own tenant.
        assert (
            _scalar(
                db,
                "SELECT status FROM coord.memory_synthesis_jobs WHERE job_id = :j",
                j=foreign_job,
            )
            == "pending"
        )

    def test_result_requires_exactly_one_field(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            f"/api/v1/memory/synthesis-jobs/{uuid4()}/result", json={}
        )
        assert resp.status_code == 422

    def test_result_unknown_job_is_404(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            f"/api/v1/memory/synthesis-jobs/{uuid4()}/result",
            json={"result_text": "text"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Librarian Phase 4 — graph links on write
# ---------------------------------------------------------------------------


def _content_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _write_one(mc: MemoryClient, content: str, **extra: Any) -> str:
    """Write one record, return its memory_id."""
    resp = mc.client.post(
        "/api/v1/memory/records", json={"records": [_record(content, **extra)]}
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["records"][0]["memory_id"])


class TestLinksOnWrite:
    def test_links_by_memory_id_and_sibling_content_hash(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """target_ref resolves as memory_id (pre-existing row) AND as the
        content_hash of a sibling record written in the same batch."""
        existing_id = _write_one(mc, "the anchor tortoise fact")
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("the sibling manatee fact"),
                    {
                        **_record("the linking capybara entry", kind="library"),
                        "links": [
                            {"target_ref": existing_id, "relation": "depends_on"},
                            {
                                "target_ref": _content_sha256(
                                    "the sibling manatee fact"
                                ),
                                "relation": "related",
                                "description": "batch sibling",
                            },
                        ],
                    },
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["dropped_links_count"] == 0
        source_id = body["records"][1]["memory_id"]
        sibling_id = body["records"][0]["memory_id"]

        rows = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_links WHERE tenant_id = :t",
            t=mc.tenant_id,
        )
        assert rows == 2
        by_id_target = _scalar(
            db,
            "SELECT target_id FROM coord.memory_links "
            "WHERE source_id = :s AND relation = 'depends_on'",
            s=source_id,
        )
        assert str(by_id_target) == existing_id
        by_hash_target = _scalar(
            db,
            "SELECT target_id FROM coord.memory_links "
            "WHERE source_id = :s AND relation = 'related'",
            s=source_id,
        )
        assert str(by_hash_target) == sibling_id
        description = _scalar(
            db,
            "SELECT description FROM coord.memory_links "
            "WHERE source_id = :s AND relation = 'related'",
            s=source_id,
        )
        assert description == "batch sibling"

    def test_duplicate_edges_dedup_on_conflict(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Re-declaring the same edge (same relation) is a no-op; a
        different relation between the same pair is a distinct edge."""
        target_id = _write_one(mc, "the target ibex fact")
        write = {
            "records": [
                {
                    **_record("the repeating lynx entry"),
                    "links": [
                        {"target_ref": target_id, "relation": "implements"},
                        # Intra-batch repeat of the identical edge.
                        {"target_ref": target_id, "relation": "implements"},
                    ],
                }
            ]
        }
        first = mc.client.post("/api/v1/memory/records", json=write)
        assert first.status_code == 200
        assert first.json()["dropped_links_count"] == 0
        # Cross-request repeat (the record dedups; the edge conflicts).
        second = mc.client.post("/api/v1/memory/records", json=write)
        assert second.status_code == 200
        assert second.json()["dropped_links_count"] == 0
        assert (
            _scalar(
                db,
                "SELECT count(*) FROM coord.memory_links WHERE tenant_id = :t",
                t=mc.tenant_id,
            )
            == 1
        )

        # A different relation between the same pair is a new edge.
        third = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the repeating lynx entry"),
                        "links": [{"target_ref": target_id, "relation": "related"}],
                    }
                ]
            },
        )
        assert third.status_code == 200
        assert (
            _scalar(
                db,
                "SELECT count(*) FROM coord.memory_links WHERE tenant_id = :t",
                t=mc.tenant_id,
            )
            == 2
        )

    def test_unresolved_targets_are_dropped_and_counted(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Unknown memory_id, unknown hash, cross-tenant id: dropped (and
        counted), never rejected — the record itself still lands."""
        foreign = MemoryClient(db)
        foreign_id = _write_one(foreign, "foreign tenant walrus fact")

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the optimistic osprey entry"),
                        "links": [
                            {"target_ref": str(uuid4()), "relation": "depends_on"},
                            {
                                "target_ref": _content_sha256("no such content"),
                                "relation": "related",
                            },
                            {"target_ref": foreign_id, "relation": "implements"},
                        ],
                    }
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["dropped_links_count"] == 3
        assert body["records"][0]["deduped"] is False
        assert (
            _scalar(
                db,
                "SELECT count(*) FROM coord.memory_links WHERE tenant_id = :t",
                t=mc.tenant_id,
            )
            == 0
        )

    def test_dead_targets_do_not_resolve(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A tombstoned record is not a linkable target (live rows only)."""
        dead_id = _write_one(mc, "the ephemeral moth fact")
        assert mc.client.delete(f"/api/v1/memory/records/{dead_id}").status_code == 204
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the surviving beetle entry"),
                        "links": [{"target_ref": dead_id, "relation": "related"}],
                    }
                ]
            },
        )
        assert resp.json()["dropped_links_count"] == 1

    def test_kind_library_accepted_and_stored(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("curated library entry on merge wedges", kind="library")
                ]
            },
        )
        assert resp.status_code == 200
        memory_id = resp.json()["records"][0]["memory_id"]
        assert (
            _scalar(
                db,
                "SELECT kind FROM coord.memory_records WHERE memory_id = :m",
                m=memory_id,
            )
            == "library"
        )


# ---------------------------------------------------------------------------
# Librarian Phase 4 — POST /memory/graph traversal
# ---------------------------------------------------------------------------


def _link_records(mc: MemoryClient, edges: list[tuple[str, str, str]]) -> None:
    """Declare edges between already-written records by memory_id.

    Each edge is ``(source_content, target_id, relation)`` — re-writing
    the source content dedups onto the existing row and attaches links.
    """
    for source_content, target_id, relation in edges:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record(source_content),
                        "links": [{"target_ref": target_id, "relation": relation}],
                    }
                ]
            },
        )
        assert resp.status_code == 200
        assert resp.json()["dropped_links_count"] == 0


class TestGraphTraversal:
    def test_chain_traversal_respects_depth(self, mc: MemoryClient) -> None:
        """A→B→C→D: depth=3 sees the whole chain, depth=1 only A→B."""
        ids = {c: _write_one(mc, f"chain node {c}") for c in "abcd"}
        _link_records(
            mc,
            [
                ("chain node a", ids["b"], "depends_on"),
                ("chain node b", ids["c"], "depends_on"),
                ("chain node c", ids["d"], "depends_on"),
            ],
        )
        full = mc.client.post(
            "/api/v1/memory/graph",
            json={"root_memory_id": ids["a"], "depth": 3},
        )
        assert full.status_code == 200
        body = full.json()
        assert {n["memory_id"] for n in body["nodes"]} == set(ids.values())
        assert {(e["source_id"], e["target_id"]) for e in body["edges"]} == {
            (ids["a"], ids["b"]),
            (ids["b"], ids["c"]),
            (ids["c"], ids["d"]),
        }

        shallow = mc.client.post(
            "/api/v1/memory/graph",
            json={"root_memory_id": ids["a"], "depth": 1},
        ).json()
        assert {n["memory_id"] for n in shallow["nodes"]} == {ids["a"], ids["b"]}
        assert len(shallow["edges"]) == 1

    def test_diamond_collects_all_paths(self, mc: MemoryClient) -> None:
        """A→B, A→C, B→D, C→D: every node once, all four edges."""
        ids = {c: _write_one(mc, f"diamond node {c}") for c in "abcd"}
        _link_records(
            mc,
            [
                ("diamond node a", ids["b"], "related"),
                ("diamond node a", ids["c"], "related"),
                ("diamond node b", ids["d"], "implements"),
                ("diamond node c", ids["d"], "implements"),
            ],
        )
        body = mc.client.post(
            "/api/v1/memory/graph",
            json={"root_memory_id": ids["a"], "depth": 3},
        ).json()
        assert {n["memory_id"] for n in body["nodes"]} == set(ids.values())
        assert len(body["edges"]) == 4
        # D appears as one node even though two paths reach it.
        assert len(body["nodes"]) == 4

    def test_cycle_is_safe_under_depth_cap(self, mc: MemoryClient) -> None:
        """A→B→C→A at max depth terminates with each edge exactly once."""
        ids = {c: _write_one(mc, f"cycle node {c}") for c in "abc"}
        _link_records(
            mc,
            [
                ("cycle node a", ids["b"], "related"),
                ("cycle node b", ids["c"], "related"),
                ("cycle node c", ids["a"], "related"),
            ],
        )
        body = mc.client.post(
            "/api/v1/memory/graph",
            json={"root_memory_id": ids["a"], "depth": 5},
        ).json()
        assert {n["memory_id"] for n in body["nodes"]} == set(ids.values())
        assert len(body["edges"]) == 3

    def test_relation_filter_narrows_traversal(self, mc: MemoryClient) -> None:
        """Only edges in relation_filter are followed (and returned)."""
        ids = {c: _write_one(mc, f"filter node {c}") for c in "abc"}
        _link_records(
            mc,
            [
                ("filter node a", ids["b"], "depends_on"),
                ("filter node a", ids["c"], "related"),
            ],
        )
        body = mc.client.post(
            "/api/v1/memory/graph",
            json={
                "root_memory_id": ids["a"],
                "depth": 3,
                "relation_filter": ["depends_on"],
            },
        ).json()
        assert {n["memory_id"] for n in body["nodes"]} == {ids["a"], ids["b"]}
        assert [e["relation"] for e in body["edges"]] == ["depends_on"]

    def test_root_without_edges_returns_lone_node(self, mc: MemoryClient) -> None:
        root = _write_one(mc, "isolated hermit crab fact")
        body = mc.client.post(
            "/api/v1/memory/graph", json={"root_memory_id": root}
        ).json()
        assert [n["memory_id"] for n in body["nodes"]] == [root]
        assert body["edges"] == []
        # Node payload carries the query-hit field shape.
        node = body["nodes"][0]
        for field in (
            "memory_id",
            "title",
            "content",
            "kind",
            "scope",
            "importance",
            "created_at",
            "source",
        ):
            assert field in node

    def test_depth_over_cap_is_422_and_foreign_root_is_404(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        root = _write_one(mc, "capped narwhal fact")
        over = mc.client.post(
            "/api/v1/memory/graph",
            json={"root_memory_id": root, "depth": 6},
        )
        assert over.status_code == 422

        foreign = MemoryClient(db)
        foreign_root = _write_one(foreign, "foreign badger fact")
        resp = mc.client.post(
            "/api/v1/memory/graph", json={"root_memory_id": foreign_root}
        )
        assert resp.status_code == 404
        unknown = mc.client.post(
            "/api/v1/memory/graph", json={"root_memory_id": str(uuid4())}
        )
        assert unknown.status_code == 404


# ---------------------------------------------------------------------------
# Librarian Phase 4 — GET /memory/records (paginated sync-pull list)
# ---------------------------------------------------------------------------


class TestListRecords:
    def test_pagination_walks_all_live_records_newest_first(
        self, mc: MemoryClient
    ) -> None:
        written = {_write_one(mc, f"paginated stork fact {i}") for i in range(5)}
        seen: list[dict[str, Any]] = []
        cursor: str | None = None
        pages = 0
        while True:
            params: dict[str, Any] = {"limit": 2}
            if cursor:
                params["cursor"] = cursor
            resp = mc.client.get("/api/v1/memory/records", params=params)
            assert resp.status_code == 200
            body = resp.json()
            assert len(body["records"]) <= 2
            seen.extend(body["records"])
            pages += 1
            cursor = body["next_cursor"]
            if cursor is None:
                break
            assert pages < 10, "cursor loop did not terminate"
        assert {r["memory_id"] for r in seen} == written
        assert len(seen) == 5
        # Newest-first-stable: (created_at, memory_id) strictly decreasing.
        keys = [(r["created_at"], r["memory_id"]) for r in seen]
        assert all(a > b for a, b in zip(keys, keys[1:], strict=False))

    def test_since_filter_returns_only_newer_rows(self, mc: MemoryClient) -> None:
        _write_one(mc, "older heron fact")
        first_page = mc.client.get("/api/v1/memory/records").json()["records"]
        assert len(first_page) == 1
        watermark = first_page[0]["updated_at"]

        newer_id = _write_one(mc, "newer egret fact")
        body = mc.client.get(
            "/api/v1/memory/records", params={"since": watermark}
        ).json()
        assert [r["memory_id"] for r in body["records"]] == [newer_id]

    def test_kinds_filter_csv_and_repeated(self, mc: MemoryClient) -> None:
        _write_one(mc, "fact about the mole", kind="fact")
        _write_one(mc, "rule about the vole", kind="rule")
        _write_one(mc, "episode about the shrew", kind="episode")

        csv = mc.client.get(
            "/api/v1/memory/records", params={"kinds": "fact,rule"}
        ).json()
        assert {r["kind"] for r in csv["records"]} == {"fact", "rule"}

        repeated = mc.client.get(
            "/api/v1/memory/records", params=[("kinds", "fact"), ("kinds", "rule")]
        ).json()
        assert {r["kind"] for r in repeated["records"]} == {"fact", "rule"}

        unknown = mc.client.get(
            "/api/v1/memory/records", params={"kinds": "not_a_kind"}
        )
        assert unknown.status_code == 422

    def test_dead_rows_are_excluded(self, mc: MemoryClient) -> None:
        live_id = _write_one(mc, "the enduring albatross fact")
        dead_id = _write_one(mc, "the doomed dodo fact")
        mc.client.delete(f"/api/v1/memory/records/{dead_id}")
        superseded_id = _write_one(mc, "the outdated auk fact")
        superseded = mc.client.post(
            f"/api/v1/memory/records/{superseded_id}/supersede",
            json={"title": "note", "content": "the corrected auk fact"},
        )
        successor_id = superseded.json()["memory_id"]

        body = mc.client.get("/api/v1/memory/records").json()
        ids = {r["memory_id"] for r in body["records"]}
        assert ids == {live_id, successor_id}

    def test_records_carry_outbound_links_and_sync_fields(
        self, mc: MemoryClient
    ) -> None:
        target_id = _write_one(mc, "the linked kestrel fact")
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the linking merlin entry", kind="library"),
                        "links": [
                            {
                                "target_ref": target_id,
                                "relation": "depends_on",
                                "description": "hunts with",
                            }
                        ],
                    }
                ]
            },
        )
        source_id = resp.json()["records"][0]["memory_id"]

        body = mc.client.get("/api/v1/memory/records").json()
        by_id = {r["memory_id"]: r for r in body["records"]}
        source = by_id[source_id]
        assert [
            (link["target_id"], link["relation"], link["description"])
            for link in source["links"]
        ] == [(target_id, "depends_on", "hunts with")]
        assert by_id[target_id]["links"] == []
        # Sync-relevant fields present on every record.
        for field in (
            "memory_id",
            "title",
            "content",
            "kind",
            "scope",
            "scope_ref",
            "importance",
            "content_hash",
            "created_at",
            "updated_at",
            "source",
            "links",
        ):
            assert field in source
        assert source["content_hash"] == _content_sha256("the linking merlin entry")

    def test_tenant_isolation_and_malformed_cursor(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        foreign = MemoryClient(db)
        _write_one(foreign, "foreign wombat fact")
        assert mc.client.get("/api/v1/memory/records").json()["records"] == []

        bad = mc.client.get("/api/v1/memory/records", params={"cursor": "not-a-cursor"})
        assert bad.status_code == 400
