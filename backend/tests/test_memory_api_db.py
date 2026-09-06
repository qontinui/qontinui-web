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
sequential scan is exact at test sizes).

Embeddings are CLIENT-supplied over this API (the backend does not embed
on the request path), so these tests act as the client: ``_record`` and
the query helpers compute vectors with a deterministic hashing stub and
send them, exactly as a runner would. The stub stands in for the RUNNER's
model — the real one is never downloaded, and the server loads no model
at all.

Loop discipline: all direct DB access goes through ``asyncio.run`` on a
NullPool engine, so no asyncpg connection ever crosses event loops (the
TestClient-driven app code runs its own portal loop; NullPool gives it
fresh per-request connections there too).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
from app.schemas.memory import (
    DEFAULT_QUERY_LIMIT,
    MAX_QUERY_LIMIT,
    RECENT_TITLES_SAMPLE,
)
from app.services import memory_store as store
from app.services.memory_vectors import EMBEDDING_DIM, EMBEDDING_MODEL_TAG
from tests.conftest import TEST_DATABASE_URL

# ---------------------------------------------------------------------------
# Deterministic stub embedder standing in for the CLIENT's model — hashed
# bag-of-words, so lexically similar texts land near each other in vector
# space (enough signal for ranking assertions) with zero model downloads
# and full determinism.
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
    # Mirrors alembic/versions/coord_memory_jobs_01_generic_job_queue.py
    # (sans the tenants FK). The pre-generalization table is dropped first:
    # this suite runs against a PERSISTENT test DB, so an older run's
    # `memory_synthesis_jobs` would otherwise linger and the `IF NOT
    # EXISTS` below would be a no-op against a stale shape.
    "DROP TABLE IF EXISTS coord.memory_synthesis_jobs",
    """
    CREATE TABLE IF NOT EXISTS coord.memory_jobs (
        job_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL,
        kind        TEXT NOT NULL
            CONSTRAINT memory_jobs_kind_check
            CHECK (kind IN ('synthesis', 'embedding')),
        target_ids  UUID[] NOT NULL,
        input_texts JSONB NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
        claimed_by  TEXT,
        claimed_at  TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        result      JSONB,
        attempt     INTEGER NOT NULL DEFAULT 0,
        input_hash  TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_pending
        ON coord.memory_jobs (tenant_id, kind, created_at)
        WHERE status = 'pending'
    """,
    # The load-bearing dedupe: at most one LIVE job per (tenant, kind,
    # input set), so the bridge's 15-minute cadence and the reindex sweep
    # cannot pile up duplicate work between runner drains. Kind-aware on
    # `done` (mirrors memory_jobs_02_kind_aware_dedupe): a done SYNTHESIS
    # job keeps blocking (never redo a completed cluster), but a done
    # EMBEDDING job does NOT (a done-but-unapplied embedding must be able
    # to re-queue, since fetch_reindex_batch gates re-embedding).
    # DROP first (not just IF NOT EXISTS) so a PERSISTENT test DB whose
    # index predates the kind-aware predicate is upgraded — otherwise the
    # ON CONFLICT ... WHERE clause would not match the stale index. Same
    # upgrade-a-persistent-DB reasoning as the kind CHECK drop+re-add below.
    # The WHERE predicate is interpolated from the SAME constant
    # ``enqueue_jobs`` uses for its ON CONFLICT clause, so the test index
    # and the runtime conflict target can never drift apart.
    "DROP INDEX IF EXISTS coord.uq_memory_jobs_live_input",
    f"""
    CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_jobs_live_input
        ON coord.memory_jobs (tenant_id, kind, input_hash)
        WHERE {store._LIVE_JOB_INPUT_DEDUP_PREDICATE}
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
    # Mirrors alembic/versions/coord_memory_anchors.py. Written as ALTERs
    # rather than folded into the CREATE TABLE above so a PERSISTENT test
    # DB whose table predates the anchors migration is upgraded in place —
    # the `IF NOT EXISTS` on the CREATE would otherwise make the widened
    # shape a no-op, exactly the trap the kind-CHECK drop+re-add above
    # already works around.
    """
    ALTER TABLE coord.memory_records
        ADD COLUMN IF NOT EXISTS anchors JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS anchor_state TEXT NOT NULL DEFAULT 'none'
    """,
    """
    ALTER TABLE coord.memory_records
        DROP CONSTRAINT IF EXISTS memory_records_anchor_state_check
    """,
    """
    ALTER TABLE coord.memory_records
        ADD CONSTRAINT memory_records_anchor_state_check
            CHECK (anchor_state IN ('none', 'fresh', 'moved', 'gone'))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_memory_records_anchors_gin
        ON coord.memory_records USING gin (anchors)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_anchor_state
        ON coord.memory_records (tenant_id, anchor_state)
        WHERE anchors <> '[]'::jsonb
    """,
    # Mirrors alembic/versions/memseq_01_memory_records_seq.py — the
    # monotone write-order key the recency tiebreaks sort on. Written as
    # ALTERs for the same persistent-test-DB reason the anchors block
    # above is: a table created by an older run must be upgraded in place.
    # The five steps are the migration's five steps, in its order (add
    # nullable, backfill, NOT NULL, identity + setval, unique index) — see
    # that file for why each is load-bearing.
    """
    ALTER TABLE coord.memory_records
        ADD COLUMN IF NOT EXISTS seq BIGINT
    """,
    """
    WITH ordered AS (
        SELECT memory_id,
               row_number() OVER (ORDER BY created_at, memory_id) AS rn
        FROM coord.memory_records
        WHERE seq IS NULL
    )
    UPDATE coord.memory_records r
       SET seq = ordered.rn
      FROM ordered
     WHERE r.memory_id = ordered.memory_id
    """,
    """
    ALTER TABLE coord.memory_records
        ALTER COLUMN seq SET NOT NULL
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_attribute
            WHERE attrelid = 'coord.memory_records'::regclass
              AND attname = 'seq'
              AND attidentity <> ''
        ) THEN
            ALTER TABLE coord.memory_records
                ALTER COLUMN seq ADD GENERATED BY DEFAULT AS IDENTITY;
        END IF;
    END $$
    """,
    """
    SELECT setval(
        pg_get_serial_sequence('coord.memory_records', 'seq'),
        COALESCE((SELECT max(seq) FROM coord.memory_records), 0) + 1,
        false
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_records_seq
        ON coord.memory_records (seq)
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
            "DELETE FROM coord.memory_jobs",
            "DELETE FROM coord.memory_links",
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
            "DELETE FROM coord.sessions",
        ],
    )
    yield memory_engine


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


def _client_vector(text_: str) -> list[float]:
    """The vector a client (the runner) would compute for ``text_``."""
    return HashingStubEmbedder._vec(text_)


def _record(
    content: str, title: str = "note", kind: str = "fact", **extra: Any
) -> dict[str, Any]:
    """A write-record payload carrying its own client-computed vector.

    Mirrors the runner's posture (it embeds, then sends). Pass
    ``embedding=None`` for the unvectorized path.
    """
    body: dict[str, Any] = {
        "title": title,
        "content": content,
        "kind": kind,
        "embedding": _client_vector(content),
        "embedding_model": EMBEDDING_MODEL_TAG,
        **extra,
    }
    if body.get("embedding") is None:
        body.pop("embedding_model", None)
    return body


def _unembedded_record(content: str, **extra: Any) -> dict[str, Any]:
    """A write-record payload with NO vector — the degradation path."""
    return _record(content, embedding=None, **extra)


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
# Clock-source independence
# ---------------------------------------------------------------------------


class TestValidityIsClockIndependent:
    """Retrieval visibility must not turn on a wall-clock reading taken
    AFTER the write.

    ``valid_from`` / ``valid_until`` are stamped exclusively by the
    writing transaction (column DEFAULT ``now()``; the supersede and
    tombstone writers ``SET valid_until = now(), updated_at = now()``).
    Nothing lets a caller set either. Comparing them to a clock read
    later — on the API host, or on the same server after time sync
    steps it BACKWARD — made freshly written rows briefly unretrievable
    and freshly superseded rows briefly retrievable.

    Each test below models a writer whose clock ran an hour ahead of the
    reader's by moving the row's own timestamps together, exactly as a
    skewed writing transaction would have stamped them. An hour is far
    beyond any real skew, so these are deterministic: they do not wait
    for a clock to misbehave, they encode the shape of it having done so.
    """

    def test_future_stamped_write_is_still_retrievable(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A row whose writing transaction stamped it an hour into the
        reader's future is visible IMMEDIATELY — read-your-own-write."""
        content = "the axolotl regrows its limbs"
        resp = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record(content)]}
        )
        memory_id = resp.json()["records"][0]["memory_id"]

        # The writer's clock ran ahead: valid_from, created_at and
        # updated_at all carry ITS now(), an hour past the reader's.
        _exec(
            db,
            [
                """
                UPDATE coord.memory_records
                SET valid_from = now() + interval '1 hour',
                    created_at = now() + interval '1 hour',
                    updated_at = now() + interval '1 hour'
                WHERE tenant_id = :t
                """
            ],
            t=str(mc.tenant_id),
        )

        hits = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "axolotl limbs"}
        ).json()["hits"]
        assert [h["memory_id"] for h in hits] == [memory_id]

    def test_future_stamped_supersede_hides_the_old_row_immediately(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The symmetric direction: a row whose validity ENDED an hour
        into the reader's future is invisible IMMEDIATELY.

        Supersede is the load-bearing case — unlike a tombstone it sets
        no ``is_tombstone`` flag, and the retrieval filter carries no
        ``superseded_by`` clause, so the old row's invisibility rests
        entirely on ``valid_until``.
        """
        old_content = "the pangolin curls into a ball"
        first = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record(old_content)]}
        )
        old_id = first.json()["records"][0]["memory_id"]
        assert (
            mc.client.post(
                f"/api/v1/memory/records/{old_id}/supersede",
                json={"title": "note", "content": "the numbat eats termites"},
            ).status_code
            == 200
        )

        # The superseding writer's clock ran ahead: valid_until and
        # updated_at both carry ITS now().
        _exec(
            db,
            [
                """
                UPDATE coord.memory_records
                SET valid_until = now() + interval '1 hour',
                    updated_at = now() + interval '1 hour'
                WHERE memory_id = :m
                """
            ],
            m=old_id,
        )

        hits = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "pangolin ball"}
        ).json()["hits"]
        assert hits == [], "a superseded row must not resurface on clock skew"

    def test_explicit_as_of_still_time_travels(self, mc: MemoryClient) -> None:
        """The caller-named instant is untouched by the above.

        ``as_of`` asks "what did the corpus look like at X" — a genuine
        wall-clock question — so a row written after X must NOT appear.
        Guards against 'fixing' clock skew by dropping the predicate.
        """
        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the quokka smiles for photographs")]},
        )
        body = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "quokka photographs",
                "as_of": "2000-01-01T00:00:00Z",
            },
        ).json()
        assert body["hits"] == [], "the row did not exist in the year 2000"


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
        query = "postgres connection pool exhausted"
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": query,
                "query_embedding": _client_vector(query),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
                "limit": 2,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["vector_arm"] == "hybrid"
        hits = body["hits"]
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


# One dossier slug, three rows that all match the FTS key: the HEAD plus a
# contribution and a delta whose titles deliberately do NOT carry the
# head's ``DOSSIER <slug> —`` prefix. This is the shape
# ``title_prefix`` exists for (plan
# ``2026-09-02-steering-layers-unreadable-without-a-credential`` Phase 2):
# FTS on the bare key finds all three and cannot tell the head apart.
_DOSSIER_HEAD_TITLE = "DOSSIER x-slug — head"
_DOSSIER_HEAD_PREFIX = "DOSSIER x-slug —"
_DOSSIER_ROWS: list[tuple[str, str]] = [
    (_DOSSIER_HEAD_TITLE, "dossier x-slug head statement of the issue"),
    ("DOSSIER-CONTRIB x-slug — c1", "dossier x-slug contribution one"),
    ("DELTA on dossier x-slug", "dossier x-slug delta since last read"),
]
_DOSSIER_QUERY = "dossier x-slug"


class TestTitlePrefix:
    """``title_prefix`` narrows EVERY arm to titles starting with it."""

    def _seed(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(content, title=title, kind="mental_model")
                    for title, content in _DOSSIER_ROWS
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["deduped_count"] == 0

    def _query(self, mc: MemoryClient, **extra: Any) -> dict[str, Any]:
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": _DOSSIER_QUERY, **extra},
        )
        assert resp.status_code == 200, resp.text
        body: dict[str, Any] = resp.json()
        return body

    def test_omitted_prefix_returns_all_three(self, mc: MemoryClient) -> None:
        self._seed(mc)
        titles = {h["title"] for h in self._query(mc)["hits"]}
        assert titles == {title for title, _content in _DOSSIER_ROWS}

    def test_prefix_returns_only_the_head_fts_only(self, mc: MemoryClient) -> None:
        self._seed(mc)
        body = self._query(mc, title_prefix=_DOSSIER_HEAD_PREFIX)
        assert body["vector_arm"] == "skipped_no_embedding"
        assert [h["title"] for h in body["hits"]] == [_DOSSIER_HEAD_TITLE]

    def test_prefix_filters_the_vector_arm_too(self, mc: MemoryClient) -> None:
        # With a query vector the semantic arm runs, and under the
        # hashing stub it returns EVERY row by cosine order (no floor).
        # If the filter lived only beside the tsquery, the two
        # non-head rows would still arrive through this arm and the
        # RRF fuse would surface them. They must not.
        self._seed(mc)
        body = self._query(
            mc,
            title_prefix=_DOSSIER_HEAD_PREFIX,
            query_embedding=_client_vector(_DOSSIER_QUERY),
            query_embedding_model=EMBEDDING_MODEL_TAG,
        )
        assert body["vector_arm"] == "hybrid"
        assert [h["title"] for h in body["hits"]] == [_DOSSIER_HEAD_TITLE]
        assert body["hits"][0]["vector_rank"] == 1
        assert body["hits"][0]["fts_rank"] == 1

    def test_prefix_filters_the_link_arm_too(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # Link the head to the contribution, then expand: the neighbour
        # matches the FTS key and is one hop from the seed, so without
        # the filter on the graph arm it would come back with link_rank.
        self._seed(mc)
        ids = {
            str(title): memory_id
            for title, memory_id in asyncio.run(_dossier_ids(db, mc.tenant_id))
        }
        asyncio.run(
            _link(
                db,
                mc.tenant_id,
                ids[_DOSSIER_HEAD_TITLE],
                ids["DOSSIER-CONTRIB x-slug — c1"],
            )
        )
        body = self._query(mc, title_prefix=_DOSSIER_HEAD_PREFIX, link_expansion=True)
        assert body["link_arm"] == "expanded"
        assert [h["title"] for h in body["hits"]] == [_DOSSIER_HEAD_TITLE]

    def test_percent_in_prefix_is_literal_not_a_wildcard(
        self, mc: MemoryClient
    ) -> None:
        # ``DOSSIER%`` would match all "DOSSIER…" titles under a raw LIKE
        # (the head AND the contribution). Escaped, it matches nothing.
        self._seed(mc)
        assert self._query(mc, title_prefix="DOSSIER%")["hits"] == []
        # ``_`` is LIKE's single-character wildcard; ``DOSSIER_x-slug``
        # would otherwise match the head through its space.
        assert self._query(mc, title_prefix="DOSSIER_x-slug")["hits"] == []
        # And a literal ``%`` in a real title IS matched by a literal
        # ``%`` in the prefix.
        mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "dossier x-slug percent-titled row",
                        title="100% dossier x-slug",
                    )
                ]
            },
        )
        hits = self._query(mc, title_prefix="100% dossier")["hits"]
        assert [h["title"] for h in hits] == ["100% dossier x-slug"]

    def test_prefix_is_case_sensitive(self, mc: MemoryClient) -> None:
        self._seed(mc)
        assert self._query(mc, title_prefix="dossier x-slug —")["hits"] == []

    def test_prefix_is_a_prefix_not_a_substring(self, mc: MemoryClient) -> None:
        self._seed(mc)
        assert self._query(mc, title_prefix="x-slug —")["hits"] == []


async def _dossier_ids(engine: AsyncEngine, tenant_id: UUID) -> list[tuple[str, str]]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT title, memory_id FROM coord.memory_records WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
        return [(str(r.title), str(r.memory_id)) for r in rows]


async def _link(engine: AsyncEngine, tenant_id: UUID, src: str, dst: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO coord.memory_links "
                "(tenant_id, source_id, target_id, relation) "
                "VALUES (:t, CAST(:s AS uuid), CAST(:d AS uuid), 'related')"
            ),
            {"t": tenant_id, "s": src, "d": dst},
        )


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
        # Nothing held on a fresh tenant.
        assert stats["lifecycle_held"] == 0


# ---------------------------------------------------------------------------
# The lifecycle hold — PUT/DELETE /records/{id}/hold
#
# `source.lifecycle_hold` takes a record out of every automatic lifecycle
# sweep. The gates themselves are covered in test_memory_lifecycle_db /
# test_memory_session_expiry_db / test_memory_bridge_db, which set the flag
# by hand-written SQL. What is covered HERE is the API writer: that the
# value it produces is the one those gates actually honour, that release
# writes an explicit `false` rather than dropping the key, and that a hold
# can be applied to an already-superseded row — the case the flag exists
# for and the one a liveness filter would have refused.
# ---------------------------------------------------------------------------


def _hold_json(engine: AsyncEngine, memory_id: str) -> Any:
    """``source->'lifecycle_hold'`` as a JSON value (type-preserving)."""
    return _scalar(
        engine,
        "SELECT source->'lifecycle_hold' FROM coord.memory_records"
        " WHERE memory_id = :m",
        m=memory_id,
    )


def _hold_jsonb_type(engine: AsyncEngine, memory_id: str) -> str | None:
    """The JSONB *type name* of the stored flag — 'boolean', not 'string'."""
    return _scalar(
        engine,
        "SELECT jsonb_typeof(source->'lifecycle_hold')"
        " FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )


def _exists(engine: AsyncEngine, memory_id: str) -> bool:
    return bool(
        _scalar(
            engine,
            "SELECT count(*) FROM coord.memory_records WHERE memory_id = :m",
            m=memory_id,
        )
    )


def _prune(engine: AsyncEngine, *, now: datetime, grace_days: int) -> int:
    """Run the real physical prune sweep against the test DB."""

    async def _go() -> int:
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as session:
            pruned = await store.decay_prune(session, now=now, grace_days=grace_days)
            await session.commit()
            return pruned

    return asyncio.run(_go())


class TestLifecycleHoldApi:
    def _write(self, mc: MemoryClient, content: str) -> str:
        resp = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record(content)]}
        )
        assert resp.status_code == 200
        return resp.json()["records"][0]["memory_id"]

    def test_put_stores_a_real_json_boolean_not_a_string(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The property that makes the gates' case-folding moot on this path.

        A hold written as the STRING ``"True"`` reads as protected while
        leaving the record fully collectable — the hazard
        ``_not_lifecycle_held``'s ``lower()`` exists to absorb. The API
        writer must not be able to produce it.
        """
        memory_id = self._write(mc, "held record alpha")

        resp = mc.client.put(f"/api/v1/memory/records/{memory_id}/hold")

        assert resp.status_code == 200
        assert resp.json() == {"memory_id": memory_id, "held": True}
        assert _hold_jsonb_type(db, memory_id) == "boolean"
        assert _hold_json(db, memory_id) is True

    def test_release_writes_explicit_false_not_a_missing_key(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """``false`` means "adjudicated and released" — a distinct state."""
        memory_id = self._write(mc, "held record beta")
        mc.client.put(f"/api/v1/memory/records/{memory_id}/hold")

        resp = mc.client.delete(f"/api/v1/memory/records/{memory_id}/hold")

        assert resp.status_code == 200
        assert resp.json() == {"memory_id": memory_id, "held": False}
        assert _hold_jsonb_type(db, memory_id) == "boolean"
        assert _hold_json(db, memory_id) is False

    def test_hold_preserves_other_source_keys(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A shallow merge — ``origin`` is how the sidecar set is selected."""
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "sidecar loser content",
                        source={"origin": "sync-conflict-sidecar"},
                    )
                ]
            },
        )
        memory_id = resp.json()["records"][0]["memory_id"]

        mc.client.put(f"/api/v1/memory/records/{memory_id}/hold")

        origin = _scalar(
            db,
            "SELECT source->>'origin' FROM coord.memory_records WHERE memory_id = :m",
            m=memory_id,
        )
        assert origin == "sync-conflict-sidecar"
        assert _hold_json(db, memory_id) is True

    def test_both_verbs_are_idempotent(self, mc: MemoryClient, db: AsyncEngine) -> None:
        memory_id = self._write(mc, "held record gamma")

        for _ in range(2):
            assert (
                mc.client.put(f"/api/v1/memory/records/{memory_id}/hold").status_code
                == 200
            )
        assert _hold_json(db, memory_id) is True

        for _ in range(2):
            assert (
                mc.client.delete(f"/api/v1/memory/records/{memory_id}/hold").status_code
                == 200
            )
        assert _hold_json(db, memory_id) is False

    def test_unknown_id_is_404_on_both_verbs(self, mc: MemoryClient) -> None:
        ghost = uuid4()
        assert mc.client.put(f"/api/v1/memory/records/{ghost}/hold").status_code == 404
        assert (
            mc.client.delete(f"/api/v1/memory/records/{ghost}/hold").status_code == 404
        )

    def test_other_tenant_cannot_hold_or_release(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """404, and — the part worth asserting — no write leaks across."""
        memory_id = self._write(mc, "tenant A holdable row")
        mc.client.put(f"/api/v1/memory/records/{memory_id}/hold")

        mc.as_tenant(uuid4())  # tenant B

        assert (
            mc.client.delete(f"/api/v1/memory/records/{memory_id}/hold").status_code
            == 404
        )
        assert _hold_json(db, memory_id) is True  # untouched

    def test_stats_count_tracks_holds_and_is_tenant_scoped(
        self, mc: MemoryClient
    ) -> None:
        """``lifecycle_held`` is the adjudication backlog measure."""
        first = self._write(mc, "backlog row one")
        second = self._write(mc, "backlog row two")
        tenant_a = mc.tenant_id

        mc.client.put(f"/api/v1/memory/records/{first}/hold")
        mc.client.put(f"/api/v1/memory/records/{second}/hold")
        assert mc.client.get("/api/v1/memory/stats").json()["lifecycle_held"] == 2

        mc.as_tenant(uuid4())
        assert mc.client.get("/api/v1/memory/stats").json()["lifecycle_held"] == 0

        mc.as_tenant(tenant_a)
        mc.client.delete(f"/api/v1/memory/records/{first}/hold")
        assert mc.client.get("/api/v1/memory/stats").json()["lifecycle_held"] == 1

    def test_a_superseded_row_can_still_be_held_and_survives_the_prune(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The case the writer exists for, proven against the real sweep.

        A record wrongly folded away by consolidation is the usual reason
        to apply a hold, and ``decay_prune`` PHYSICALLY deletes such a row
        once its grace window passes. So the hold has to be appliable
        AFTER supersession (no liveness filter on the writer) and the
        value the API writes has to be one ``decay_prune`` honours. This
        asserts both, end to end, rather than trusting the unit-level
        flag shape.
        """
        memory_id = self._write(mc, "wrongly consolidated original")
        superseded = mc.client.post(
            f"/api/v1/memory/records/{memory_id}/supersede",
            json={"title": "replacement", "content": "the surviving version"},
        )
        assert superseded.status_code == 200

        # Holdable even though it is no longer live.
        hold = mc.client.put(f"/api/v1/memory/records/{memory_id}/hold")
        assert hold.status_code == 200
        assert mc.client.get("/api/v1/memory/stats").json()["lifecycle_held"] == 1

        # Well past any grace window — this row is otherwise a victim.
        far_future = datetime(2030, 1, 1, tzinfo=UTC)
        _prune(db, now=far_future, grace_days=0)

        assert _exists(db, memory_id)

    def test_positive_control_an_unheld_superseded_row_is_pruned(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Without the hold the same row IS destroyed — the sweep works.

        Without this control the test above would pass just as well
        against a prune that never deletes anything.
        """
        memory_id = self._write(mc, "unprotected consolidated original")
        assert (
            mc.client.post(
                f"/api/v1/memory/records/{memory_id}/supersede",
                json={"title": "replacement", "content": "the surviving version"},
            ).status_code
            == 200
        )

        far_future = datetime(2030, 1, 1, tzinfo=UTC)
        _prune(db, now=far_future, grace_days=0)

        assert not _exists(db, memory_id)

    def test_a_released_row_is_pruned_again(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Release genuinely returns the row to lifecycle management.

        The explicit ``false`` must read as NOT held, not merely as
        "different from true" — otherwise adjudicated records would stay
        pinned forever and the backlog count would never mean anything.
        """
        memory_id = self._write(mc, "adjudicated then released original")
        assert (
            mc.client.post(
                f"/api/v1/memory/records/{memory_id}/supersede",
                json={"title": "replacement", "content": "the surviving version"},
            ).status_code
            == 200
        )
        mc.client.put(f"/api/v1/memory/records/{memory_id}/hold")
        mc.client.delete(f"/api/v1/memory/records/{memory_id}/hold")

        far_future = datetime(2030, 1, 1, tzinfo=UTC)
        _prune(db, now=far_future, grace_days=0)

        assert not _exists(db, memory_id)


# ---------------------------------------------------------------------------
# Client-supplied embeddings (2026-07-13-runner-paid-embedding, Phase 1)
# ---------------------------------------------------------------------------


def _stored_vector(engine: AsyncEngine, memory_id: str) -> list[float] | None:
    """The embedding actually persisted for ``memory_id``, or None."""
    raw = _scalar(
        engine,
        "SELECT embedding::text FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )
    return None if raw is None else [float(x) for x in raw.strip("[]").split(",")]


def _stored_model(engine: AsyncEngine, memory_id: str) -> str | None:
    return _scalar(
        engine,
        "SELECT embedding_model FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )


class TestClientSuppliedEmbeddings:
    """The backend stores the caller's vector verbatim, or NULL — never one
    it computed itself."""

    def test_supplied_vector_is_stored_verbatim(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        content = "the caller embedded this itself"
        write = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record(content)]}
        )
        assert write.status_code == 200
        memory_id = write.json()["records"][0]["memory_id"]

        stored = _stored_vector(db, memory_id)
        assert stored == pytest.approx(_client_vector(content), abs=1e-6)
        assert _stored_model(db, memory_id) == EMBEDDING_MODEL_TAG

    def test_write_without_embedding_lands_with_null(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Graceful degradation: no vector → the write still SUCCEEDS, the
        row is stored unvectorized, and it stays FTS-retrievable."""
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_unembedded_record("unvectorized narwhal note")]},
        )
        assert resp.status_code == 200
        memory_id = resp.json()["records"][0]["memory_id"]

        assert _stored_vector(db, memory_id) is None
        assert _stored_model(db, memory_id) is None

        # Immediately retrievable through the lexical arm regardless.
        hits = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "unvectorized narwhal"}
        ).json()["hits"]
        assert [h["memory_id"] for h in hits] == [memory_id]

    def test_mixed_batch_stores_per_record_vectors(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """One batch, one row with a vector and one without — the set-based
        insert must not smear either onto the other."""
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("vectorized quokka fact"),
                    _unembedded_record("bare wombat fact"),
                ]
            },
        )
        assert resp.status_code == 200
        with_vec, without_vec = (r["memory_id"] for r in resp.json()["records"])
        assert _stored_vector(db, with_vec) == pytest.approx(
            _client_vector("vectorized quokka fact"), abs=1e-6
        )
        assert _stored_model(db, with_vec) == EMBEDDING_MODEL_TAG
        assert _stored_vector(db, without_vec) is None
        assert _stored_model(db, without_vec) is None

    def test_wrong_dim_vector_is_422(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("short vector", embedding=[0.1] * (EMBEDDING_DIM - 1))
                ]
            },
        )
        assert resp.status_code == 422
        assert "383" in json.dumps(resp.json())

    def test_unknown_model_tag_is_422(self, mc: MemoryClient) -> None:
        rec = _record("tagged with a foreign model")
        rec["embedding_model"] = "some-other-model@v9"
        resp = mc.client.post("/api/v1/memory/records", json={"records": [rec]})
        assert resp.status_code == 422

    def test_vector_without_model_tag_is_422(self, mc: MemoryClient) -> None:
        rec = _record("vector with no tag")
        del rec["embedding_model"]
        resp = mc.client.post("/api/v1/memory/records", json={"records": [rec]})
        assert resp.status_code == 422

    def test_query_without_embedding_is_fts_only(self, mc: MemoryClient) -> None:
        """No query vector → the cosine arm is SKIPPED and the response SAYS
        so. FTS-only results must never masquerade as hybrid."""
        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the okapi hides in dense forest")]},
        )
        resp = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "okapi forest"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["vector_arm"] == "skipped_no_embedding"
        assert body["hits"], "the lexical arm still retrieves"
        for hit in body["hits"]:
            assert hit["vector_rank"] is None
            assert hit["cosine_similarity"] is None
            assert hit["fts_rank"] is not None

    def test_query_with_embedding_is_hybrid(self, mc: MemoryClient) -> None:
        content = "the okapi hides in dense forest"
        mc.client.post("/api/v1/memory/records", json={"records": [_record(content)]})
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": content,
                "query_embedding": _client_vector(content),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["vector_arm"] == "hybrid"
        assert body["hits"][0]["vector_rank"] == 1
        assert body["hits"][0]["cosine_similarity"] is not None

    def test_query_wrong_dim_embedding_is_422(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "anything",
                "query_embedding": [0.1] * 383,
                "query_embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 422


class TestAtomicModelMigration:
    """A query vector is never scored against a corpus in another space.

    Phase 0 measured the fastembed-128 and sentence-transformers-256
    spaces as NOT interchangeable (min cosine 0.71, k=10 exact-order
    agreement 0%), so the model transition is ATOMIC per tenant: while a
    tenant still holds vectors at a non-deployed tag, the cosine arm is
    skipped entirely rather than allowed to compare across spaces.
    """

    def test_query_is_hybrid_once_the_tenant_is_fully_migrated(
        self, mc: MemoryClient
    ) -> None:
        """The steady state: every vector at the deployed tag -> hybrid."""
        content = "the okapi hides in dense forest"
        mc.client.post("/api/v1/memory/records", json={"records": [_record(content)]})
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": content,
                "query_embedding": _client_vector(content),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["vector_arm"] == "hybrid"

    def test_old_tag_rows_degrade_the_query_to_fts_only(
        self, mc: MemoryClient, db: AsyncEngine, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One un-reindexed row is enough to skip the arm for the tenant.

        The vector arm is proved NOT to run by making any call to it an
        error: asserting on absent ``cosine_similarity`` alone could not
        distinguish "the arm was skipped" from "the arm ran and returned
        nothing".
        """
        content = "the okapi hides in dense forest"
        mc.client.post("/api/v1/memory/records", json={"records": [_record(content)]})
        # Simulate the corpus mid-flip: this row predates the tag change
        # and the runner-paid reindex has not rewritten it yet.
        _exec(
            db,
            [
                """
                UPDATE coord.memory_records
                SET embedding_model = 'minilm-l6-v2-onnx@fastembed'
                WHERE tenant_id = :t
                """
            ],
            t=str(mc.tenant_id),
        )

        async def _boom(*_a: Any, **_k: Any) -> None:
            raise AssertionError(
                "vector_search ran while the tenant was mid-migration — an "
                "ST-256 query must never be scored against fastembed-128 docs"
            )

        monkeypatch.setattr(store, "vector_search", _boom)

        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": content,
                "query_embedding": _client_vector(content),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["vector_arm"] == "skipped_migrating"
        assert body["hits"], "the lexical arm still retrieves during migration"
        for hit in body["hits"]:
            assert hit["vector_rank"] is None
            assert hit["cosine_similarity"] is None
            assert hit["fts_rank"] is not None

    def test_arm_recovers_when_the_reindex_drains(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The degrade is driven off corpus state, so it self-clears.

        No timer, no flag: rewriting the last foreign-tag vector is what
        restores the arm.
        """
        content = "the okapi hides in dense forest"
        mc.client.post("/api/v1/memory/records", json={"records": [_record(content)]})
        query = {
            "query_text": content,
            "query_embedding": _client_vector(content),
            "query_embedding_model": EMBEDDING_MODEL_TAG,
        }
        _exec(
            db,
            [
                """
                UPDATE coord.memory_records
                SET embedding_model = 'minilm-l6-v2-onnx@fastembed'
                WHERE tenant_id = :t
                """
            ],
            t=str(mc.tenant_id),
        )
        assert (
            mc.client.post("/api/v1/memory/query", json=query).json()["vector_arm"]
            == "skipped_migrating"
        )
        # The runner posts the re-embedded vector back at the new tag.
        _exec(
            db,
            [
                """
                UPDATE coord.memory_records
                SET embedding_model = :tag
                WHERE tenant_id = :t
                """
            ],
            t=str(mc.tenant_id),
            tag=EMBEDDING_MODEL_TAG,
        )
        assert (
            mc.client.post("/api/v1/memory/query", json=query).json()["vector_arm"]
            == "hybrid"
        )

    def test_unvectorized_rows_do_not_count_as_migrating(
        self, mc: MemoryClient
    ) -> None:
        """A NULL-embedding row must NOT degrade the arm.

        The cosine arm never scores a NULL-embedding row, so such a row
        cannot contaminate anything. This matters because the bridge sweep
        lands rows unvectorized BY DESIGN — counting them as unmigrated
        would pin every tenant to ``skipped_migrating`` permanently and
        silently kill the semantic arm forever.
        """
        mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("the okapi hides in dense forest"),
                    _unembedded_record("an unvectorized note awaiting the sweep"),
                ]
            },
        )
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "okapi forest",
                "query_embedding": _client_vector("okapi forest"),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["vector_arm"] == "hybrid"

    def test_migration_state_is_per_tenant(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Another tenant's un-reindexed rows must not degrade this one."""
        content = "the okapi hides in dense forest"
        mc.client.post("/api/v1/memory/records", json={"records": [_record(content)]})
        clean_tenant = mc.tenant_id

        stale_tenant = uuid4()
        mc.as_tenant(stale_tenant).client.post(
            "/api/v1/memory/records", json={"records": [_record("a stale note")]}
        )
        _exec(
            db,
            [
                """
                UPDATE coord.memory_records
                SET embedding_model = 'minilm-l6-v2-onnx@fastembed'
                WHERE tenant_id = :t
                """
            ],
            t=str(stale_tenant),
        )

        query = {
            "query_text": content,
            "query_embedding": _client_vector(content),
            "query_embedding_model": EMBEDDING_MODEL_TAG,
        }
        assert (
            mc.as_tenant(stale_tenant)
            .client.post("/api/v1/memory/query", json=query)
            .json()["vector_arm"]
            == "skipped_migrating"
        )
        assert (
            mc.as_tenant(clean_tenant)
            .client.post("/api/v1/memory/query", json=query)
            .json()["vector_arm"]
            == "hybrid"
        )

    def test_supersede_without_embedding_lands_null(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the tapir sleeps at noon")]},
        )
        old_id = write.json()["records"][0]["memory_id"]
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "note", "content": "the tapir sleeps at dusk"},
        )
        assert resp.status_code == 200
        new_id = resp.json()["memory_id"]
        # The OLD row's vector is never inherited by the successor.
        assert _stored_vector(db, new_id) is None
        assert _stored_model(db, new_id) is None

    def test_supersede_with_embedding_stores_it(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the tapir sleeps at noon")]},
        )
        old_id = write.json()["records"][0]["memory_id"]
        replacement = "the tapir sleeps at dusk"
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "note",
                "content": replacement,
                "embedding": _client_vector(replacement),
                "embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 200
        new_id = resp.json()["memory_id"]
        assert _stored_vector(db, new_id) == pytest.approx(
            _client_vector(replacement), abs=1e-6
        )
        assert _stored_model(db, new_id) == EMBEDDING_MODEL_TAG

    def test_supersede_wrong_dim_is_422(self, mc: MemoryClient) -> None:
        write = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the tapir sleeps at noon")]},
        )
        old_id = write.json()["records"][0]["memory_id"]
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "note",
                "content": "the tapir sleeps at dusk",
                "embedding": [0.1] * 383,
                "embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 422


class TestJobEndpoints:
    """The claim/result wire contract a runner poller builds against."""

    @staticmethod
    def _seed_job(
        engine: AsyncEngine,
        tenant: UUID,
        texts: list[str],
        *,
        kind: str = "synthesis",
        targets: list[UUID] | None = None,
    ) -> UUID:
        job_id = uuid4()
        _exec(
            engine,
            [
                """
                INSERT INTO coord.memory_jobs
                    (job_id, tenant_id, kind, target_ids, input_texts,
                     input_hash)
                VALUES
                    (:job_id, :tenant, :kind, CAST(:target_ids AS uuid[]),
                     CAST(:input_texts AS jsonb), :hash)
                """
            ],
            job_id=job_id,
            tenant=tenant,
            kind=kind,
            target_ids=[str(t) for t in (targets or [uuid4()])],
            input_texts=json.dumps(texts),
            hash=f"h-{job_id}",
        )
        return job_id

    def _seed_unvectorized(
        self, engine: AsyncEngine, tenant: UUID, content: str
    ) -> UUID:
        """A live row with embedding = NULL — what the enqueuers now land."""
        memory_id = uuid4()
        _exec(
            engine,
            [
                """
                INSERT INTO coord.memory_records
                    (memory_id, tenant_id, scope, kind, title, content,
                     content_hash, importance)
                VALUES
                    (:memory_id, :tenant, 'tenant', 'reference', 'bridged',
                     :content, :content_hash, 0.5)
                """
            ],
            memory_id=memory_id,
            tenant=tenant,
            content=content,
            content_hash=f"hash-{memory_id}",
        )
        return memory_id

    def _job_status(self, db: AsyncEngine, job_id: UUID) -> Any:
        return _scalar(
            db,
            "SELECT status FROM coord.memory_jobs WHERE job_id = :j",
            j=job_id,
        )

    # -- claim -----------------------------------------------------------

    def test_claim_returns_job_shape(self, mc: MemoryClient, db: AsyncEngine) -> None:
        targets = [uuid4()]
        job_id = self._seed_job(db, mc.tenant_id, ["alpha", "beta"], targets=targets)
        resp = mc.client.post(
            "/api/v1/memory/jobs/claim",
            json={"limit": 4, "kinds": ["synthesis", "embedding"]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["jobs"]) == 1
        job = body["jobs"][0]
        assert job["job_id"] == str(job_id)
        assert job["kind"] == "synthesis"
        assert job["input_texts"] == ["alpha", "beta"]
        assert job["target_ids"] == [str(t) for t in targets]

    def test_claim_kinds_filter(self, mc: MemoryClient, db: AsyncEngine) -> None:
        synth = self._seed_job(db, mc.tenant_id, ["a"], kind="synthesis")
        embed = self._seed_job(db, mc.tenant_id, ["b"], kind="embedding")
        body = mc.client.post(
            "/api/v1/memory/jobs/claim", json={"limit": 4, "kinds": ["embedding"]}
        ).json()
        assert [j["job_id"] for j in body["jobs"]] == [str(embed)]
        assert self._job_status(db, synth) == "pending"

    def test_claim_defaults_to_all_kinds(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        self._seed_job(db, mc.tenant_id, ["a"], kind="synthesis")
        self._seed_job(db, mc.tenant_id, ["b"], kind="embedding")
        body = mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4}).json()
        assert {j["kind"] for j in body["jobs"]} == {"synthesis", "embedding"}

    # -- result: synthesis -----------------------------------------------

    def test_synthesis_result_applies(self, mc: MemoryClient, db: AsyncEngine) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["one", "two"])
        # A result is only accepted for a job the runner holds a claim on.
        mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={"result": {"result_text": "a distilled mental model"}},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "applied"}
        assert self._job_status(db, job_id) == "done"

    def test_synthesis_result_with_runner_embedding_stores_it(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The runner pays for the mental_model's vector too."""
        job_id = self._seed_job(db, mc.tenant_id, ["one", "two"])
        mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4})
        model_text = "a distilled mental model of the cluster"
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "result_text": model_text,
                    "embedding": _client_vector(model_text),
                    "embedding_model": EMBEDDING_MODEL_TAG,
                }
            },
        )
        assert resp.status_code == 200
        stored = _scalar(
            db,
            "SELECT embedding::text FROM coord.memory_records "
            "WHERE kind = 'mental_model' AND tenant_id = :t",
            t=mc.tenant_id,
        )
        assert stored is not None
        got = [float(x) for x in stored.strip("[]").split(",")]
        assert got == pytest.approx(_client_vector(model_text), abs=1e-6)

    def test_synthesis_result_without_embedding_lands_null(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """No runner vector → the mental_model is stored unvectorized (the
        reindex sweep enqueues it); the backend never embeds it itself."""
        job_id = self._seed_job(db, mc.tenant_id, ["one", "two"])
        mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={"result": {"result_text": "an unvectorized distilled model"}},
        )
        assert resp.status_code == 200
        assert (
            _scalar(
                db,
                "SELECT embedding IS NULL FROM coord.memory_records "
                "WHERE kind = 'mental_model' AND tenant_id = :t",
                t=mc.tenant_id,
            )
            is True
        )

    def test_synthesis_result_wrong_dim_embedding_is_422(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["a"])
        mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "result_text": "text",
                    "embedding": [0.1] * 383,
                    "embedding_model": EMBEDDING_MODEL_TAG,
                }
            },
        )
        assert resp.status_code == 422
        assert self._job_status(db, job_id) == "claimed"

    def test_synthesis_result_unknown_model_tag_is_422(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["a"])
        mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "result_text": "text",
                    "embedding": [0.1] * EMBEDDING_DIM,
                    "embedding_model": "not-our-model@v1",
                }
            },
        )
        assert resp.status_code == 422
        assert self._job_status(db, job_id) == "claimed"

    # -- result: embedding -----------------------------------------------

    def _claimed_embedding_job(
        self, mc: MemoryClient, db: AsyncEngine, contents: list[str]
    ) -> tuple[UUID, list[UUID]]:
        targets = [self._seed_unvectorized(db, mc.tenant_id, c) for c in contents]
        job_id = self._seed_job(
            db, mc.tenant_id, contents, kind="embedding", targets=targets
        )
        mc.client.post(
            "/api/v1/memory/jobs/claim", json={"limit": 4, "kinds": ["embedding"]}
        )
        return job_id, targets

    def test_embedding_result_writes_vectors(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        contents = ["first content", "second content"]
        job_id, targets = self._claimed_embedding_job(mc, db, contents)
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "embeddings": [_client_vector(c) for c in contents],
                    "embedding_model": EMBEDDING_MODEL_TAG,
                }
            },
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "applied"}
        assert self._job_status(db, job_id) == "done"
        for target, content in zip(targets, contents, strict=True):
            stored = _scalar(
                db,
                "SELECT embedding::text FROM coord.memory_records WHERE memory_id = :m",
                m=target,
            )
            got = [float(x) for x in str(stored).strip("[]").split(",")]
            assert got == pytest.approx(_client_vector(content), abs=1e-6)
            assert (
                _scalar(
                    db,
                    "SELECT embedding_model FROM coord.memory_records "
                    "WHERE memory_id = :m",
                    m=target,
                )
                == EMBEDDING_MODEL_TAG
            )

    def test_embedding_result_wrong_count_is_422_and_not_done(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # One vector short: without the arity check the vectors would
        # silently mis-map onto rows. The job must stay claimable.
        contents = ["one", "two", "three"]
        job_id, targets = self._claimed_embedding_job(mc, db, contents)
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "embeddings": [_client_vector("one")],
                    "embedding_model": EMBEDDING_MODEL_TAG,
                }
            },
        )
        assert resp.status_code == 422
        assert self._job_status(db, job_id) == "claimed"
        for target in targets:
            assert (
                _scalar(
                    db,
                    "SELECT embedding IS NULL FROM coord.memory_records "
                    "WHERE memory_id = :m",
                    m=target,
                )
                is True
            )

    def test_embedding_result_wrong_dim_is_422_and_not_done(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        job_id, targets = self._claimed_embedding_job(mc, db, ["one"])
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "embeddings": [[0.1] * 383],
                    "embedding_model": EMBEDDING_MODEL_TAG,
                }
            },
        )
        assert resp.status_code == 422
        assert self._job_status(db, job_id) == "claimed"
        assert (
            _scalar(
                db,
                "SELECT embedding IS NULL FROM coord.memory_records "
                "WHERE memory_id = :m",
                m=targets[0],
            )
            is True
        )

    def test_embedding_result_bad_tag_is_422_and_not_done(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # A vector from an unrecognized model lives in a different space
        # and would silently poison the cosine arm.
        job_id, targets = self._claimed_embedding_job(mc, db, ["one"])
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={
                "result": {
                    "embeddings": [[0.1] * EMBEDDING_DIM],
                    "embedding_model": "not-our-model@v1",
                }
            },
        )
        assert resp.status_code == 422
        assert self._job_status(db, job_id) == "claimed"
        assert (
            _scalar(
                db,
                "SELECT embedding IS NULL FROM coord.memory_records "
                "WHERE memory_id = :m",
                m=targets[0],
            )
            is True
        )

    def test_synthesis_payload_against_embedding_job_is_422(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        job_id, _ = self._claimed_embedding_job(mc, db, ["one"])
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={"result": {"result_text": "a synthesized model"}},
        )
        assert resp.status_code == 422
        assert self._job_status(db, job_id) == "claimed"

    # -- result: failure + errors ----------------------------------------

    def test_result_failure_records(self, mc: MemoryClient, db: AsyncEngine) -> None:
        job_id = self._seed_job(db, mc.tenant_id, ["x"])
        mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4})
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={"failure": "could not synthesize"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "recorded"}
        assert self._job_status(db, job_id) == "failed"

    def test_result_on_unclaimed_job_is_409(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # Posting a result for a job that was never claimed (or was requeued
        # by the reaper) is rejected — the runner must hold a live claim.
        job_id = self._seed_job(db, mc.tenant_id, ["a", "b"])
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{job_id}/result",
            json={"result": {"result_text": "text"}},
        )
        assert resp.status_code == 409

    def test_foreign_tenant_job_cannot_be_claimed_or_resulted(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        # A job belonging to a different tenant is invisible to claim and
        # its id is never resolvable on the result path (404, not 409 —
        # existence is not disclosed across the tenant boundary).
        foreign_job = self._seed_job(db, uuid4(), ["secret", "cluster"])
        claimed = mc.client.post("/api/v1/memory/jobs/claim", json={"limit": 4}).json()[
            "jobs"
        ]
        assert all(j["job_id"] != str(foreign_job) for j in claimed)

        resp = mc.client.post(
            f"/api/v1/memory/jobs/{foreign_job}/result",
            json={"result": {"result_text": "text"}},
        )
        assert resp.status_code == 404
        # Untouched in its own tenant.
        assert self._job_status(db, foreign_job) == "pending"

    def test_result_requires_exactly_one_field(self, mc: MemoryClient) -> None:
        resp = mc.client.post(f"/api/v1/memory/jobs/{uuid4()}/result", json={})
        assert resp.status_code == 422

    def test_result_rejects_both_fields(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{uuid4()}/result",
            json={"result": {"result_text": "t"}, "failure": "also failed"},
        )
        assert resp.status_code == 422

    def test_result_unknown_job_is_404(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            f"/api/v1/memory/jobs/{uuid4()}/result",
            json={"result": {"result_text": "text"}},
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


class TestLinkTargetByTitle:
    """``target_ref`` as an exact title — plan 2026-08-08-memory-graph-has-no-writer.

    This is the resolution mode that makes the graph writable at all. An agent
    recording a memory knows the TITLE of the record it is superseding (it just
    read it) and knows neither that record's ``memory_id`` nor the sha256 of
    its content, which is why ``coord.memory_links`` had no writer before this.
    """

    def test_title_resolves_for_a_preexisting_and_a_sibling_record(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        target_id = _write_one(
            mc, "the elder pangolin claim", title="pangolin-claim-v1"
        )
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("a batch sibling okapi note", title="okapi-note"),
                    {
                        **_record("the correcting pangolin claim", title="whatever"),
                        "links": [
                            {
                                "target_ref": "pangolin-claim-v1",
                                "relation": "supersedes",
                            },
                            # Same batch: records are all inserted before any
                            # ref is resolved, so a sibling's title resolves
                            # exactly like a pre-existing row's.
                            {"target_ref": "okapi-note", "relation": "related"},
                        ],
                    },
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["dropped_links_count"] == 0
        source_id = body["records"][1]["memory_id"]
        sibling_id = body["records"][0]["memory_id"]

        assert (
            str(
                _scalar(
                    db,
                    "SELECT target_id FROM coord.memory_links "
                    "WHERE source_id = :s AND relation = 'supersedes'",
                    s=source_id,
                )
            )
            == target_id
        )
        assert (
            str(
                _scalar(
                    db,
                    "SELECT target_id FROM coord.memory_links "
                    "WHERE source_id = :s AND relation = 'related'",
                    s=source_id,
                )
            )
            == sibling_id
        )

    def test_an_ambiguous_title_drops_rather_than_picking_one(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Two LIVE records sharing a title resolve to NOTHING.

        Binding to "the newest" would make the edge assert a target the author
        never named. Dropping is the existing contract for an unresolvable
        ref, so ambiguity costs callers no new failure mode.

        Carries an unambiguous POSITIVE control in the same write, so the drop
        is attributable to the ambiguity rather than to title resolution being
        absent.
        """
        _write_one(mc, "first tapir body", title="contested-title")
        _write_one(mc, "second tapir body", title="contested-title")
        clear_id = _write_one(mc, "lone tapir body", title="uncontested-title")
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the hopeful tapir entry"),
                        "links": [
                            {"target_ref": "contested-title", "relation": "related"},
                            {
                                "target_ref": "uncontested-title",
                                "relation": "depends_on",
                            },
                        ],
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dropped_links_count"] == 1
        source_id = resp.json()["records"][0]["memory_id"]
        assert (
            str(
                _scalar(
                    db,
                    "SELECT target_id FROM coord.memory_links WHERE source_id = :s",
                    s=source_id,
                )
            )
            == clear_id
        )

    def test_ambiguity_clears_once_the_duplicate_stops_being_live(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The ``count(*) = 1`` guard is over LIVE rows, not all rows.

        Without this, a tombstoned namesake would poison a title forever and
        the drop above would be indistinguishable from a permanent one.
        """
        doomed = _write_one(mc, "first quoll body", title="reused-title")
        _write_one(mc, "second quoll body", title="reused-title")
        assert mc.client.delete(f"/api/v1/memory/records/{doomed}").status_code == 204

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the patient quoll entry"),
                        "links": [
                            {"target_ref": "reused-title", "relation": "related"}
                        ],
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dropped_links_count"] == 0

    def test_dead_and_cross_tenant_titles_do_not_resolve(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Title resolution inherits the liveness and tenant bounds exactly.

        A title is a far weaker identifier than a UUID, so the interesting
        failure is a title leaking ACROSS tenants — asserted against a real
        second tenant, not by reading the SQL.

        Carries a POSITIVE control (``reachable-title``) in the same write:
        without it, every ref would drop simply because title resolution does
        not exist, and the test would pass against an implementation that
        resolves nothing at all.
        """
        dead_id = _write_one(mc, "the doomed vaquita fact", title="doomed-title")
        assert mc.client.delete(f"/api/v1/memory/records/{dead_id}").status_code == 204

        foreign = MemoryClient(db)
        _write_one(foreign, "a foreign narwhal fact", title="foreign-title")
        reachable_id = _write_one(mc, "a live manatee fact", title="reachable-title")

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the surviving vaquita entry"),
                        "links": [
                            {"target_ref": "doomed-title", "relation": "related"},
                            {"target_ref": "foreign-title", "relation": "depends_on"},
                            {"target_ref": "reachable-title", "relation": "implements"},
                        ],
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dropped_links_count"] == 2
        source_id = resp.json()["records"][0]["memory_id"]
        assert (
            str(
                _scalar(
                    db,
                    "SELECT target_id FROM coord.memory_links WHERE source_id = :s",
                    s=source_id,
                )
            )
            == reachable_id
        )

    def test_exact_identifiers_win_over_a_colliding_title(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A record TITLED as another record's memory_id must not shadow it.

        UUID and content_hash are exact identifiers; titles are caller prose.
        The ordering that protects them is only observable when a title
        actually collides with one, which is what this constructs.
        """
        real_id = _write_one(mc, "the genuine axolotl fact")
        # A decoy whose *title* is the other record's id.
        _write_one(mc, "the decoy axolotl fact", title=real_id)

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the disambiguating axolotl entry"),
                        "links": [{"target_ref": real_id, "relation": "related"}],
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dropped_links_count"] == 0
        source_id = resp.json()["records"][0]["memory_id"]
        assert (
            str(
                _scalar(
                    db,
                    "SELECT target_id FROM coord.memory_links WHERE source_id = :s",
                    s=source_id,
                )
            )
            == real_id
        )

    def test_resolution_is_exact_not_fuzzy(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """No trimming, no case folding, no prefix match.

        An edge is an assertion; resolving it approximately would make the
        graph assert things nobody wrote.

        The exact spelling is included as a POSITIVE control so the three
        near-misses are shown to drop *because they are near-misses*, not
        because nothing resolves by title at all.
        """
        exact_id = _write_one(mc, "the precise dugong fact", title="Dugong Fact")
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        **_record("the approximate dugong entry"),
                        "links": [
                            {"target_ref": "dugong fact", "relation": "related"},
                            {"target_ref": " Dugong Fact ", "relation": "depends_on"},
                            {"target_ref": "Dugong", "relation": "supersedes"},
                            {"target_ref": "Dugong Fact", "relation": "implements"},
                        ],
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dropped_links_count"] == 3
        source_id = resp.json()["records"][0]["memory_id"]
        assert (
            str(
                _scalar(
                    db,
                    "SELECT target_id FROM coord.memory_links WHERE source_id = :s",
                    s=source_id,
                )
            )
            == exact_id
        )


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

        # Well-formed base64 whose `seq` half is a plain integer Python
        # accepts but bigint cannot hold. It must be rejected at DECODE
        # (400), not carried into `CAST(:cursor_seq AS bigint)` where
        # asyncpg raises an uncaught DataError and the caller gets a 500.
        # Same for the shapes `int()` silently normalizes — whitespace, a
        # sign, PEP-515 underscores, non-ASCII digits — which would make
        # the cursor codec a non-inverse.
        for seq_half in ("9" * 25, " 1", "+1", "1_0", "٣"):
            token = base64.urlsafe_b64encode(
                f"2026-08-19T00:00:00+00:00|{seq_half}".encode()
            ).decode("ascii")
            resp = mc.client.get("/api/v1/memory/records", params={"cursor": token})
            assert resp.status_code == 400, (seq_half, resp.status_code)


# ---------------------------------------------------------------------------
# Link-expansion retrieval arm
# (2026-07-29-memory-link-expansion-retrieval-arm.md, Phase 2)
# ---------------------------------------------------------------------------


def _insert_fanout(
    engine: AsyncEngine,
    *,
    tenant_id: UUID,
    source_id: str,
    target_ids: list[str],
    relation: str = "related",
) -> None:
    """Insert many outbound edges from one source in a single statement.

    The fan-out fixture needs more neighbours than ``store.ARM_LIMIT``, and
    one round trip per edge would dominate the test's runtime. Targets are
    passed as a comma-joined string and re-split server-side so no array
    bind type is needed.
    """
    _exec(
        engine,
        [
            "INSERT INTO coord.memory_links "
            "(tenant_id, source_id, target_id, relation) "
            "SELECT CAST(:t AS uuid), CAST(:s AS uuid), CAST(g AS uuid), :rel "
            "FROM unnest(string_to_array(:targets, ',')) AS g"
        ],
        t=str(tenant_id),
        s=source_id,
        rel=relation,
        targets=",".join(target_ids),
    )


def _insert_edge(
    engine: AsyncEngine,
    *,
    tenant_id: UUID,
    source_id: str,
    target_id: str,
    relation: str = "depends_on",
) -> None:
    """Insert an edge straight into ``coord.memory_links``.

    The write API deliberately refuses to resolve a link whose target is
    dead or belongs to another tenant (``resolve_link_targets``) — which
    is exactly the fixture state the validity/scope guard below has to
    exercise. So these tests declare edges directly, then assert on the
    QUERY response: the whole bug class here is a filter that was written
    but not joined, and it can only be caught from the outside.
    """
    _exec(
        engine,
        [
            "INSERT INTO coord.memory_links "
            "(tenant_id, source_id, target_id, relation) VALUES "
            "(CAST(:t AS uuid), CAST(:s AS uuid), CAST(:g AS uuid), :rel)"
        ],
        t=str(tenant_id),
        s=source_id,
        g=target_id,
        rel=relation,
    )


class TestLinkExpansionArm:
    """One-hop ``coord.memory_links`` expansion as a third RRF arm.

    Every query here is deliberately EMBEDDING-LESS. ``vector_search``
    has no similarity floor (``ORDER BY ... LIMIT arm_limit``), so at
    test corpus sizes the semantic arm returns *every* row — which would
    make a "reachable only by edge" record indistinguishable from a
    weak cosine hit. FTS-only keeps the arm attribution honest.
    """

    SEED = "postgres connection pool exhausted under load"
    NEIGHBOUR = "the marmoset ledger tallies quarterly returns"
    QUERY = "postgres connection pool exhausted"

    def _query(
        self, mc: MemoryClient, *, expansion: bool, **extra: Any
    ) -> dict[str, Any]:
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": self.QUERY, "link_expansion": expansion, **extra},
        )
        assert resp.status_code == 200, resp.text
        body: dict[str, Any] = resp.json()
        return body

    def _seed_and_neighbour(
        self,
        mc: MemoryClient,
        db: AsyncEngine,
        *,
        reverse: bool = False,
        relation: str = "depends_on",
        **neighbour_extra: Any,
    ) -> tuple[str, str]:
        """Write the text-matching seed + a non-matching neighbour, edge them."""
        seed_id = _write_one(mc, self.SEED)
        neighbour_id = _write_one(mc, self.NEIGHBOUR, **neighbour_extra)
        source, target = (neighbour_id, seed_id) if reverse else (seed_id, neighbour_id)
        _insert_edge(
            db,
            tenant_id=mc.tenant_id,
            source_id=source,
            target_id=target,
            relation=relation,
        )
        return seed_id, neighbour_id

    def test_link_only_neighbour_surfaces_only_with_expansion(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        seed_id, neighbour_id = self._seed_and_neighbour(mc, db)

        off = self._query(mc, expansion=False)
        assert off["link_arm"] == "skipped_disabled"
        assert [h["memory_id"] for h in off["hits"]] == [seed_id]

        on = self._query(mc, expansion=True)
        assert on["link_arm"] == "expanded"
        by_id = {h["memory_id"]: h for h in on["hits"]}
        assert set(by_id) == {seed_id, neighbour_id}

        # Reached purely by association: marked as such, and NOT given a
        # fabricated cosine score.
        neighbour = by_id[neighbour_id]
        assert neighbour["link_rank"] == 1
        assert neighbour["vector_rank"] is None
        assert neighbour["fts_rank"] is None
        assert neighbour["cosine_similarity"] is None
        # Hydrated like any other hit (fetch_records ran for it).
        assert neighbour["content"] == self.NEIGHBOUR

        # The seed is NOT re-emitted by the link arm (it would otherwise
        # double-count itself in the fuse).
        assert by_id[seed_id]["fts_rank"] == 1
        assert by_id[seed_id]["link_rank"] is None

    def test_link_only_hit_bumps_access_like_any_other(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        _seed_id, neighbour_id = self._seed_and_neighbour(mc, db)
        self._query(mc, expansion=True)
        assert (
            _scalar(
                db,
                "SELECT access_count FROM coord.memory_records WHERE memory_id = :m",
                m=neighbour_id,
            )
            == 1
        )

    def test_expansion_is_bidirectional(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The edge points neighbour -> seed; the neighbour still surfaces."""
        _seed_id, neighbour_id = self._seed_and_neighbour(mc, db, reverse=True)
        on = self._query(mc, expansion=True)
        assert on["link_arm"] == "expanded"
        hit = next(h for h in on["hits"] if h["memory_id"] == neighbour_id)
        assert hit["link_rank"] == 1
        assert hit["fts_rank"] is None

    def test_cross_tenant_edges_never_expand(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Neither a foreign NEIGHBOUR nor a foreign-stamped EDGE expands."""
        seed_id = _write_one(mc, self.SEED)

        foreign = MemoryClient(db)
        foreign_id = _write_one(foreign, self.NEIGHBOUR)
        # (a) Edge stamped with OUR tenant, pointing at THEIR record.
        _insert_edge(
            db, tenant_id=mc.tenant_id, source_id=seed_id, target_id=foreign_id
        )
        # (b) Edge stamped with THEIR tenant, pointing at one of OURS.
        mine_id = _write_one(mc, "an unrelated pangolin ledger entry")
        _insert_edge(
            db,
            tenant_id=foreign.tenant_id,
            source_id=seed_id,
            target_id=mine_id,
            relation="related",
        )

        on = self._query(mc, expansion=True)
        assert on["link_arm"] == "expanded"
        assert [h["memory_id"] for h in on["hits"]] == [seed_id]

    # -- The validity / scope guard: a leak here is cross-principal, not
    # -- staleness. All four neighbours must stay absent WITH expansion on.

    def test_tombstoned_neighbour_never_expands(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        _seed_id, neighbour_id = self._seed_and_neighbour(mc, db)
        assert (
            mc.client.delete(f"/api/v1/memory/records/{neighbour_id}").status_code
            == 204
        )
        on = self._query(mc, expansion=True)
        assert on["link_arm"] == "expanded"
        assert neighbour_id not in {h["memory_id"] for h in on["hits"]}

    def test_validity_expired_neighbour_never_expands(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        _seed_id, neighbour_id = self._seed_and_neighbour(mc, db)
        _exec(
            db,
            [
                "UPDATE coord.memory_records "
                "SET valid_until = now() - interval '1 day' "
                "WHERE memory_id = CAST(:m AS uuid)"
            ],
            m=neighbour_id,
        )
        on = self._query(mc, expansion=True)
        assert on["link_arm"] == "expanded"
        assert neighbour_id not in {h["memory_id"] for h in on["hits"]}

    def test_session_scoped_neighbour_needs_the_matching_scope_ref(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        _seed_id, neighbour_id = self._seed_and_neighbour(
            mc, db, scope="session", scope_ref="sess-999"
        )
        # Default scopes — the narrow row is another session's business.
        assert neighbour_id not in {
            h["memory_id"] for h in self._query(mc, expansion=True)["hits"]
        }
        # Scope named, ref withheld: still invisible.
        named = self._query(mc, expansion=True, scopes=["tenant", "session"])
        assert neighbour_id not in {h["memory_id"] for h in named["hits"]}
        # Positive control — the row IS reachable to the session that owns
        # it, so the assertions above are testing the guard, not a typo.
        owned = self._query(
            mc,
            expansion=True,
            scopes=["tenant", "session"],
            scope_ref="sess-999",
        )
        assert neighbour_id in {h["memory_id"] for h in owned["hits"]}

    def test_kind_filtered_neighbour_never_expands(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        _seed_id, neighbour_id = self._seed_and_neighbour(mc, db, kind="rule")
        filtered = self._query(mc, expansion=True, kinds=["fact"])
        assert filtered["link_arm"] == "expanded"
        assert neighbour_id not in {h["memory_id"] for h in filtered["hits"]}
        # Positive control: without the filter it expands.
        assert neighbour_id in {
            h["memory_id"] for h in self._query(mc, expansion=True)["hits"]
        }

    def test_link_arm_reports_no_seeds_when_nothing_matched(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Requested, but the vector+FTS fuse gave nothing to hop from."""
        self._seed_and_neighbour(mc, db)
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "nothing whatsoever matches this quokka",
                "link_expansion": True,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["hits"] == []
        assert body["link_arm"] == "skipped_no_seeds"

    def test_link_arm_defaults_to_skipped_disabled(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The field is opt-in: omitting it must not run the arm."""
        _seed_id, neighbour_id = self._seed_and_neighbour(mc, db)
        resp = mc.client.post("/api/v1/memory/query", json={"query_text": self.QUERY})
        assert resp.status_code == 200
        body = resp.json()
        assert body["link_arm"] == "skipped_disabled"
        assert neighbour_id not in {h["memory_id"] for h in body["hits"]}

    def test_stronger_relation_and_nearer_seed_rank_first(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Ranking is (seed_rank, relation_weight), de-duplicated to the best."""
        seed_id = _write_one(mc, self.SEED)
        weak_id = _write_one(mc, "the marmoset ledger tallies quarterly returns")
        strong_id = _write_one(mc, "the aardwolf ledger tallies monthly returns")
        _insert_edge(
            db,
            tenant_id=mc.tenant_id,
            source_id=seed_id,
            target_id=weak_id,
            relation="related",  # weight 0.4
        )
        _insert_edge(
            db,
            tenant_id=mc.tenant_id,
            source_id=strong_id,
            target_id=seed_id,
            relation="supersedes",  # weight 1.0, inbound half
        )
        # A second, weaker edge to the SAME neighbour: it must not be
        # emitted twice, and must keep its best (strongest) pairing.
        _insert_edge(
            db,
            tenant_id=mc.tenant_id,
            source_id=seed_id,
            target_id=strong_id,
            relation="related",
        )

        on = self._query(mc, expansion=True)
        assert on["link_arm"] == "expanded"
        by_id = {h["memory_id"]: h for h in on["hits"]}
        assert by_id[strong_id]["link_rank"] == 1
        assert by_id[weak_id]["link_rank"] == 2

    def test_hub_seed_does_not_starve_the_other_seeds(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A seed with more neighbours than the arm cap must not drain it.

        Regression for the seed-major ordering the arm shipped with:
        ``ORDER BY seed_rank, relation_weight DESC, neighbour_id`` let seed
        #1 take every one of the ``ARM_LIMIT`` slots before seed #2 got
        one — so a hub returned ``ARM_LIMIT`` neighbours ordered by lowest
        UUID (uncorrelated with relevance) and every other seed contributed
        nothing. The hub here is the *strongest* lexical match (it repeats
        the query phrase, so it takes ``fts_rank`` 1 — asserted below,
        because the whole fixture is vacuous if it doesn't) and owns
        ``ARM_LIMIT + 5`` neighbours, so under seed-major order it drains
        every slot and BOTH thin seeds are starved. Round-robin ordering
        gives every seed its best neighbour before any seed's second, so
        both thin neighbours survive.
        """
        hub_seed = _write_one(mc, f"{self.SEED}; {self.SEED} again and again")
        thin_a_seed = _write_one(mc, self.SEED + " while retrying with backoff")
        thin_b_seed = _write_one(mc, self.SEED + " during a sizing review")

        # The hub's fan-out exceeds the arm's total capacity on its own.
        # One batched write: 55 round trips would dominate the runtime.
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(f"unrelated hub neighbour {i} about wombat husbandry")
                    for i in range(store.ARM_LIMIT + 5)
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        fanout = [str(r["memory_id"]) for r in resp.json()["records"]]
        assert len(fanout) == store.ARM_LIMIT + 5
        _insert_fanout(
            db, tenant_id=mc.tenant_id, source_id=hub_seed, target_ids=fanout
        )

        thin_a_neighbour = _write_one(mc, "the lone quokka almanac of tidal charts")
        thin_b_neighbour = _write_one(mc, "the lone tapir almanac of lunar charts")
        _insert_edge(
            db,
            tenant_id=mc.tenant_id,
            source_id=thin_a_seed,
            target_id=thin_a_neighbour,
            relation="related",
        )
        _insert_edge(
            db,
            tenant_id=mc.tenant_id,
            source_id=thin_b_seed,
            target_id=thin_b_neighbour,
            relation="related",
        )

        on = self._query(mc, expansion=True, limit=MAX_QUERY_LIMIT)
        assert on["link_arm"] == "expanded"
        by_id = {h["memory_id"]: h for h in on["hits"]}

        # All three seeds are in the fuse head, so all three feed the arm —
        # and the HUB is seed #1, which is what makes seed-major ordering
        # starve the other two rather than merely reorder them.
        assert {hub_seed, thin_a_seed, thin_b_seed} <= set(by_id)
        assert by_id[hub_seed]["fts_rank"] == 1

        # The starvation assertion: neither thin seed's only neighbour was
        # crowded out by the hub, and both were reached ONLY by the graph.
        for neighbour in (thin_a_neighbour, thin_b_neighbour):
            assert neighbour in by_id, "a thin seed's neighbour was starved"
            assert by_id[neighbour]["link_rank"] is not None
            assert by_id[neighbour]["vector_rank"] is None
            assert by_id[neighbour]["fts_rank"] is None

        # Round-robin means every seed's BEST neighbour outranks any seed's
        # second, so the thin neighbours (each its seed's only, hence best)
        # land ahead of all but the hub's own first.
        hub_ranks = sorted(by_id[n]["link_rank"] for n in fanout if n in by_id)
        assert len(hub_ranks) >= 2, "the hub barely contributed — fixture is wrong"
        for neighbour in (thin_a_neighbour, thin_b_neighbour):
            assert by_id[neighbour]["link_rank"] <= hub_ranks[1], (
                "a thin seed's best neighbour ranked below the hub's second"
            )

        # And the arm still respects its overall cap.
        link_hits = [h for h in on["hits"] if h["link_rank"] is not None]
        assert len(link_hits) <= store.ARM_LIMIT


# ---------------------------------------------------------------------------
# GET /stats content facets — "what is IN the corpus", not "is the plumbing ok"
#
# The rest of /stats reports storage, queue and adjudication posture. These
# tests cover the content half, and specifically the three ways it can lie:
# a missing bucket read as "unknown", a dead row counted as retrievable, and
# a degraded read read as a small corpus.
# ---------------------------------------------------------------------------

# The full CHECK-mirrored value sets, spelled out rather than imported from
# app.schemas.memory: importing the very tuples the implementation zero-fills
# FROM would make the exhaustiveness assertion tautological.
_ALL_KINDS = {
    "observation",
    "fact",
    "mental_model",
    "episode",
    "feedback",
    "reference",
    "rule",
    "library",
}
_ALL_SCOPES = {"tenant", "runner", "agent", "session"}


def _facets(mc: MemoryClient) -> dict[str, Any]:
    """The facets block off a HEALTHY /stats read.

    Asserts ``corpus_complete`` on the way through, so no test below can
    accidentally make its assertions against a degraded payload.
    """
    body = mc.client.get("/api/v1/memory/stats").json()
    assert body["corpus_complete"] is True, body
    facets = body["facets"]
    assert facets is not None, body
    return cast(dict[str, Any], facets)


def _backdate(engine: AsyncEngine, memory_id: str, days: int) -> None:
    _exec(
        engine,
        [
            "UPDATE coord.memory_records SET created_at = now() - "
            "make_interval(days => :d) WHERE memory_id = :m"
        ],
        m=memory_id,
        d=days,
    )


class TestStatsContentFacets:
    def test_by_kind_and_by_scope_are_exhaustive_and_zero_filled(
        self, mc: MemoryClient
    ) -> None:
        """Every kind and scope has a bucket, including the empty ones.

        The zeros are the assertion: a caller must be able to read "no
        `feedback` records exist" off the payload, and an omitted key
        says only "not measured".
        """
        _write_one(mc, "observation one about the tapir", kind="observation")
        _write_one(mc, "observation two about the okapi", kind="observation")
        _write_one(mc, "a feedback note about the ibex", kind="feedback")
        _write_one(mc, "runner-scoped fact about the saiga", scope="runner")
        _write_one(mc, "agent-scoped fact about the dhole", scope="agent")

        facets = _facets(mc)
        assert set(facets["by_kind"]) == _ALL_KINDS
        assert facets["by_kind"] == {
            "observation": 2,
            "fact": 2,
            "feedback": 1,
            "mental_model": 0,
            "episode": 0,
            "reference": 0,
            "rule": 0,
            "library": 0,
        }
        assert set(facets["by_scope"]) == _ALL_SCOPES
        assert facets["by_scope"] == {
            "tenant": 3,
            "runner": 1,
            "agent": 1,
            "session": 0,
        }
        assert facets["live_row_count"] == 5

    def test_empty_corpus_is_a_confident_zero_not_a_blind_spot(
        self, mc: MemoryClient
    ) -> None:
        """Zero rows still yields every bucket, null percentiles, and
        ``corpus_complete=True`` — "there is nothing here" is a real
        answer, distinct from "I could not look"."""
        body = mc.client.get("/api/v1/memory/stats").json()
        assert body["corpus_complete"] is True
        facets = body["facets"]
        assert facets["live_row_count"] == 0
        assert set(facets["by_kind"]) == _ALL_KINDS
        assert set(facets["by_kind"].values()) == {0}
        assert set(facets["by_scope"]) == _ALL_SCOPES
        assert set(facets["by_scope"].values()) == {0}
        # Null, not a fabricated 0 — nothing has a median age.
        assert facets["age"] == {
            "p50_days": None,
            "p90_days": None,
            "oldest_days": None,
        }
        assert facets["importance"]["p50"] is None
        assert facets["importance"]["p90"] is None
        # A count, though, is honestly zero.
        assert facets["importance"]["above_0_8"] == 0
        assert facets["recent_titles"] == []

    def test_tombstoned_superseded_and_expired_rows_are_never_counted(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """All three flavours of dead row are excluded — the facets
        describe what retrieval can actually return."""
        _write_one(mc, "the enduring vicuna fact")

        tombstoned = _write_one(mc, "the doomed dodo fact")
        mc.client.delete(f"/api/v1/memory/records/{tombstoned}")

        outdated = _write_one(mc, "the outdated auk fact")
        assert (
            mc.client.post(
                f"/api/v1/memory/records/{outdated}/supersede",
                json={"title": "note", "content": "the corrected auk fact"},
            ).status_code
            == 200
        )

        # Validity simply ENDED: no tombstone, no successor. This is the
        # arm neither of the other two covers.
        expired = _write_one(mc, "the lapsed quagga fact")
        _exec(
            db,
            [
                "UPDATE coord.memory_records "
                "SET valid_until = now() - interval '1 hour' "
                "WHERE memory_id = :m"
            ],
            m=expired,
        )

        facets = _facets(mc)
        # The enduring row plus the supersede successor, nothing else.
        assert facets["live_row_count"] == 2
        assert facets["by_kind"]["fact"] == 2
        assert facets["by_scope"]["tenant"] == 2
        titles = facets["recent_titles"]
        assert len(titles) == 2

    def test_future_dated_validity_is_counted_and_agrees_with_get_records(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A row whose validity ends in the FUTURE is still retrievable,
        so the facets must still count it.

        This is the ``expire_closed_session_records`` shape: the daily
        sweep stamps ``valid_until = closed_at + interval '7 days'`` on
        session-scoped rows, so for up to a week those rows are returned
        by ``/memory/query`` and listed by ``GET /records``. Dedup
        liveness (``valid_until IS NULL``) would count them dead and
        report ``by_scope["session"] == 0`` to a caller whose very next
        query returns them — absence read as a value, the exact failure
        this surface exists to prevent.

        The two existing expiry fixtures both date ``valid_until`` into
        the PAST, which is why neither caught it. ``GET /records`` is
        asserted alongside because "the facets and the listing disagree
        for the same tenant" is the observable symptom.
        """
        _write_one(mc, "the plainly live pika fact")
        pending = _write_one(
            mc,
            "the seven-days-left session note about the markhor",
            title="expiring-soon",
            scope="session",
            scope_ref=str(uuid4()),
        )
        _exec(
            db,
            [
                "UPDATE coord.memory_records "
                "SET valid_until = now() + interval '7 days' "
                "WHERE memory_id = :m"
            ],
            m=pending,
        )

        facets = _facets(mc)
        assert facets["live_row_count"] == 2
        assert facets["by_scope"]["session"] == 1
        assert facets["by_scope"]["tenant"] == 1
        assert "expiring-soon" in facets["recent_titles"]

        listed_ids = {
            r["memory_id"]
            for r in mc.client.get("/api/v1/memory/records").json()["records"]
        }
        assert pending in listed_ids
        assert len(listed_ids) == facets["live_row_count"]

    def test_facets_are_tenant_scoped(self, mc: MemoryClient, db: AsyncEngine) -> None:
        foreign = MemoryClient(db)
        _write_one(foreign, "foreign wombat observation", kind="observation")

        mine = _facets(mc)
        assert mine["live_row_count"] == 0
        assert mine["by_kind"]["observation"] == 0
        assert mine["recent_titles"] == []

        theirs = _facets(foreign)
        assert theirs["live_row_count"] == 1
        assert theirs["by_kind"]["observation"] == 1

    def test_denominator_invariant_holds_and_the_two_predicates_differ(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """``sum(by_kind) == sum(by_scope) == live_row_count < row_count``.

        The STRICT inequality is the point. ``row_count`` filters on
        ``is_tombstone = false`` alone (superseded and validity-ended rows
        still charge quota); the facets use the full live predicate. On a
        fixture carrying one of each dead-but-not-tombstoned flavour the
        two numbers MUST diverge — an equality here would mean the facets
        had quietly adopted the quota predicate.
        """
        _write_one(mc, "the standing saola fact")

        outdated = _write_one(mc, "the superseded serval fact")
        assert (
            mc.client.post(
                f"/api/v1/memory/records/{outdated}/supersede",
                json={"title": "note", "content": "the corrected serval fact"},
            ).status_code
            == 200
        )
        expired = _write_one(mc, "the lapsed lynx fact")
        _exec(
            db,
            [
                "UPDATE coord.memory_records "
                "SET valid_until = now() - interval '1 hour' "
                "WHERE memory_id = :m"
            ],
            m=expired,
        )

        body = mc.client.get("/api/v1/memory/stats").json()
        facets = body["facets"]
        assert sum(facets["by_kind"].values()) == facets["live_row_count"]
        assert sum(facets["by_scope"].values()) == facets["live_row_count"]
        assert facets["live_row_count"] < body["row_count"]
        # Concretely: standing + successor are live; the superseded
        # original and the lapsed row still count against quota.
        assert facets["live_row_count"] == 2
        assert body["row_count"] == 4

    def test_degraded_facet_read_is_not_a_silently_smaller_corpus(
        self, mc: MemoryClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A facet read that fails returns ``corpus_complete=False`` and a
        null block — never smaller numbers under a confident flag."""
        _write_one(mc, "the measurable markhor fact")
        healthy = mc.client.get("/api/v1/memory/stats").json()
        assert healthy["corpus_complete"] is True
        assert healthy["facets"]["live_row_count"] == 1

        async def _boom(*_args: Any, **_kwargs: Any) -> None:
            raise OperationalError(
                "SELECT ...", {}, Exception("canceling statement due to timeout")
            )

        monkeypatch.setattr(store, "facets", _boom)
        degraded = mc.client.get("/api/v1/memory/stats").json()
        assert degraded["corpus_complete"] is False
        assert degraded["facets"] is None
        # The plumbing half is read before the facets and is unaffected —
        # the degradation is named and scoped, never a quiet undercount.
        assert degraded["row_count"] == healthy["row_count"]
        assert degraded["quota_bytes"] == healthy["quota_bytes"]

    def test_a_broken_facets_query_raises_instead_of_degrading(
        self, mc: MemoryClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``ProgrammingError`` is a BUG, not degradation.

        An undefined column, a bad function name, or schema drift after a
        migration would otherwise null the facets on every ``/stats`` call
        for every tenant, permanently, with a log line as the only trace.
        The handler must let it out — same reasoning that keeps
        ``TypeError`` uncaught there.
        """
        _write_one(mc, "the measurable muntjac fact")

        async def _boom(*_args: Any, **_kwargs: Any) -> None:
            raise ProgrammingError(
                "SELECT ...", {}, Exception('column "kind_libary" does not exist')
            )

        monkeypatch.setattr(store, "facets", _boom)
        with pytest.raises(ProgrammingError):
            mc.client.get("/api/v1/memory/stats")

    def test_recent_titles_are_a_capped_newest_first_sample(
        self, mc: MemoryClient
    ) -> None:
        """A bounded vocabulary sample, not a listing (GET /records is)."""
        total = RECENT_TITLES_SAMPLE + 5
        for i in range(total):
            _write_one(mc, f"sampled saola fact {i}", title=f"title-{i:02d}")

        facets = _facets(mc)
        assert facets["live_row_count"] == total
        assert len(facets["recent_titles"]) == RECENT_TITLES_SAMPLE
        # Newest first: the last RECENT_TITLES_SAMPLE written, most
        # recent leading. Titles sort in write order, so descending
        # lexical order is descending recency.
        assert facets["recent_titles"] == sorted(facets["recent_titles"], reverse=True)
        assert set(facets["recent_titles"]) == {
            f"title-{i:02d}" for i in range(5, total)
        }

    def test_recent_titles_follow_write_order_within_a_tied_batch(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """Under tied ``created_at``, the sample is the LAST ones WRITTEN.

        The sibling test above writes one record per request, so its rows
        carry distinct timestamps and ``created_at DESC`` alone decides the
        order — it cannot see the tiebreak at all. This one writes a single
        ``POST /memory/records`` batch, which ``insert_records_batch`` lands
        as ONE ``INSERT … FROM unnest(…)`` in ONE transaction, so every row
        shares the transaction-start ``now()`` to the microsecond and the
        tiebreak decides everything: which ``RECENT_TITLES_SAMPLE`` of the
        batch the ``LIMIT`` admits, and in what order they come back.

        Against the pre-``seq`` ``memory_id DESC`` tiebreak this is a random
        permutation of a random subset — measured on a throwaway pg16: one
        25-record batch produced 1 distinct ``created_at``, and the facet
        dropped ``title-23`` (the second-newest) while keeping ``title-00``
        (the oldest). Hence exact list equality, not a set: a set assertion
        would pass on ``[00..19]`` reversed, which is precisely the wrong
        twenty.
        """
        total = RECENT_TITLES_SAMPLE + 5
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(f"batched binturong fact {i}", title=f"title-{i:02d}")
                    for i in range(total)
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        # The premise, asserted rather than assumed: if the batch path ever
        # stops tying, this test silently stops testing the tiebreak.
        assert (
            _scalar(
                db,
                "SELECT count(DISTINCT created_at) FROM coord.memory_records"
                " WHERE tenant_id = :t",
                t=mc.tenant_id,
            )
            == 1
        )

        facets = _facets(mc)
        assert facets["live_row_count"] == total
        assert facets["recent_titles"] == [
            f"title-{i:02d}" for i in reversed(range(5, total))
        ]

    def test_age_and_importance_describe_the_live_corpus(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        old = _write_one(mc, "a low-importance takin note", importance=0.2)
        _write_one(mc, "a high-importance kouprey note", importance=0.9)
        _backdate(db, old, days=10)

        facets = _facets(mc)
        assert facets["age"]["oldest_days"] == pytest.approx(10.0, abs=0.1)
        assert facets["age"]["p50_days"] == pytest.approx(5.0, abs=0.1)
        assert facets["age"]["p90_days"] == pytest.approx(9.0, abs=0.2)
        assert facets["importance"]["p50"] == pytest.approx(0.55, abs=0.01)
        assert facets["importance"]["above_0_8"] == 1

    def test_importance_of_exactly_0_8_is_not_above_0_8(self, mc: MemoryClient) -> None:
        """``importance`` is REAL, so the threshold is compared in REAL
        precision. Against a float8 ``0.8`` literal the column promotes to
        0.80000001..., and a record stored at exactly 0.8 would be counted
        as above it."""
        _write_one(mc, "a boundary-valued binturong note", importance=0.8)
        _write_one(mc, "a just-over binturong note", importance=0.81)

        facets = _facets(mc)
        assert facets["live_row_count"] == 2
        assert facets["importance"]["above_0_8"] == 1


# ---------------------------------------------------------------------------
# Anchors — write path, dedup-merge, read path, proactive recall
# (plan 2026-07-29-memory-anchored-derived-records, Phases 2/5/6)
# ---------------------------------------------------------------------------

_STORE_BLOB = {
    "type": "blob",
    "repo": "qontinui-web",
    "path": "backend/app/services/memory_store.py",
    "sha": "a" * 40,
}
_ENDPOINT_BLOB = {
    "type": "blob",
    "repo": "qontinui-web",
    "path": "backend/app/api/v1/endpoints/memory.py",
    "sha": "b" * 40,
}
_COORD_BLOB = {
    "type": "blob",
    "repo": "qontinui-coord",
    "path": "src/memory_observer.rs",
    "sha": "c" * 40,
}
_PR_ANCHOR = {"type": "pr", "repo": "qontinui-runner", "number": 832}


def _anchors_of(mc: MemoryClient, memory_id: str) -> list[dict[str, Any]]:
    """The stored anchor array of one record, via the LIST (sync) shape."""
    body = mc.client.get("/api/v1/memory/records").json()
    by_id = {r["memory_id"]: r for r in body["records"]}
    return list(by_id[memory_id]["anchors"])


def _set_anchor_state(engine: AsyncEngine, memory_id: str, state: str) -> None:
    """Stand in for the coord watcher, which owns this column."""
    _exec(
        engine,
        [
            "UPDATE coord.memory_records SET anchor_state = :s "
            "WHERE memory_id = CAST(:m AS uuid)"
        ],
        s=state,
        m=memory_id,
    )


@pytest.fixture()
def anchored_recall_on() -> Generator[None, None, None]:
    """Turn Phase 5's default-OFF flag on for the duration of one test.

    Patched rather than set in the environment because ``settings`` is a
    process-wide singleton read at request time: leaving it flipped would
    silently enable proactive recall for every later test in the session.
    """
    from app.core.config import settings

    previous = settings.MEMORY_ANCHORED_RECALL_ENABLED
    settings.MEMORY_ANCHORED_RECALL_ENABLED = True
    try:
        yield
    finally:
        settings.MEMORY_ANCHORED_RECALL_ENABLED = previous


class TestAnchorWritePath:
    def test_anchors_round_trip_through_the_sync_shape(self, mc: MemoryClient) -> None:
        memory_id = _write_one(
            mc, "the anchored pelican fact", anchors=[_STORE_BLOB, _PR_ANCHOR]
        )
        body = mc.client.get("/api/v1/memory/records").json()
        (record,) = body["records"]
        assert record["memory_id"] == memory_id
        assert sorted(record["anchors"], key=lambda a: a["type"]) == sorted(
            [_STORE_BLOB, _PR_ANCHOR], key=lambda a: a["type"]
        )
        # The watcher has not run, so the roll-up is still the default.
        assert record["anchor_state"] == "none"

    def test_anchorless_write_stores_the_empty_array(self, mc: MemoryClient) -> None:
        memory_id = _write_one(mc, "the plain marmot fact")
        assert _anchors_of(mc, memory_id) == []

    def test_unknown_anchor_type_is_422(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "the bogus anchor fact",
                        anchors=[{"type": "symbol", "symbol": "observe_tick"}],
                    )
                ]
            },
        )
        # `symbol` was cut in vetting — coord has no symbol index and no
        # parser, so an accepted symbol anchor would be unresolvable.
        assert resp.status_code == 422, resp.text
        assert "symbol" in resp.text

    def test_malformed_anchor_of_a_known_type_is_422(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    # A blob anchor with no sha: the watcher would have
                    # nothing to compare against.
                    _record(
                        "the shaless fact",
                        anchors=[{"type": "blob", "repo": "r", "path": "p"}],
                    )
                ]
            },
        )
        assert resp.status_code == 422, resp.text

    def test_writer_supplied_anchor_state_is_422(self, mc: MemoryClient) -> None:
        """anchor_state is derived — the watcher's, never a writer's.

        Pydantic's default for an unknown key is to IGNORE it, which would
        let a writer believe it pinned a record to fresh while nothing
        happened. A loud 422 is the only honest answer.
        """
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "the self-certifying fact",
                        anchors=[_STORE_BLOB],
                        anchor_state="fresh",
                    )
                ]
            },
        )
        assert resp.status_code == 422, resp.text
        assert "anchor_state" in resp.text
        # And nothing was written.
        assert mc.client.get("/api/v1/memory/records").json()["records"] == []

    def test_anchor_state_is_rejected_even_without_anchors(
        self, mc: MemoryClient
    ) -> None:
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("plain fact", anchor_state="gone")]},
        )
        assert resp.status_code == 422, resp.text


class TestDedupPreservesAnchors:
    """Verification 7.5c — and the whole of Phase 6's backfill strategy.

    Before this, dedup was ``ON CONFLICT ... DO NOTHING``: re-writing an
    identical record in order to attach an anchor was a silent no-op, so
    "anchors are added when a record is next written" attached nothing.
    """

    def test_rewriting_verbatim_with_an_anchor_attaches_it(
        self, mc: MemoryClient
    ) -> None:
        content = "the runner reaps abandoned claims every 60 seconds"
        first_id = _write_one(mc, content)
        assert _anchors_of(mc, first_id) == []

        second = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record(content, anchors=[_STORE_BLOB])]},
        )
        assert second.status_code == 200, second.text
        body = second.json()
        # Still a dedup in every observable respect: same row, same id.
        assert body["deduped_count"] == 1
        (result,) = body["records"]
        assert result["deduped"] is True
        assert result["memory_id"] == first_id

        page = mc.client.get("/api/v1/memory/records").json()["records"]
        assert len(page) == 1
        assert page[0]["anchors"] == [_STORE_BLOB]

    def test_merge_is_a_union_never_a_replace(self, mc: MemoryClient) -> None:
        """A second writer must not be able to drop a first writer's anchor."""
        content = "the supervisor publishes on 9875"
        memory_id = _write_one(mc, content, anchors=[_STORE_BLOB])
        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record(content, anchors=[_ENDPOINT_BLOB])]},
        )
        anchors = _anchors_of(mc, memory_id)
        assert sorted(anchors, key=lambda a: a["path"]) == sorted(
            [_STORE_BLOB, _ENDPOINT_BLOB], key=lambda a: a["path"]
        )

    def test_merge_dedupes_by_anchor_identity_and_is_idempotent(
        self, mc: MemoryClient
    ) -> None:
        content = "gitleaks red means it ran"
        memory_id = _write_one(mc, content, anchors=[_STORE_BLOB])
        for _ in range(3):
            mc.client.post(
                "/api/v1/memory/records",
                json={"records": [_record(content, anchors=[_STORE_BLOB])]},
            )
        assert _anchors_of(mc, memory_id) == [_STORE_BLOB]

    def test_anchorless_rewrite_leaves_existing_anchors_alone(
        self, mc: MemoryClient
    ) -> None:
        """The overwhelmingly common write must stay pure DO NOTHING."""
        content = "coord is the sole merge authority"
        memory_id = _write_one(mc, content, anchors=[_STORE_BLOB])
        resp = mc.client.post(
            "/api/v1/memory/records", json={"records": [_record(content)]}
        )
        assert resp.json()["records"][0]["memory_id"] == memory_id
        assert resp.json()["deduped_count"] == 1
        assert _anchors_of(mc, memory_id) == [_STORE_BLOB]

    def test_merge_is_tenant_scoped(self, mc: MemoryClient, db: AsyncEngine) -> None:
        """Identical content in another tenant is a different record."""
        content = "the same sentence in two tenants"
        mine = _write_one(mc, content, anchors=[_STORE_BLOB])

        foreign = MemoryClient(db)
        theirs = _write_one(foreign, content, anchors=[_COORD_BLOB])
        assert theirs != mine
        assert _anchors_of(mc, mine) == [_STORE_BLOB]
        assert _anchors_of(foreign, theirs) == [_COORD_BLOB]

    def test_a_batch_carrying_new_and_anchor_bearing_duplicates(
        self, mc: MemoryClient
    ) -> None:
        """The set-based path merges too, in one statement."""
        existing = _write_one(mc, "an established fact about the train")
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "an established fact about the train", anchors=[_STORE_BLOB]
                    ),
                    _record("a brand new fact about the train", anchors=[_PR_ANCHOR]),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        first, second = resp.json()["records"]
        assert first["memory_id"] == existing
        assert first["deduped"] is True
        assert second["deduped"] is False
        assert _anchors_of(mc, existing) == [_STORE_BLOB]
        assert _anchors_of(mc, second["memory_id"]) == [_PR_ANCHOR]


class TestAnchorStateOnQueryHits:
    def test_moved_is_carried_on_the_hit_and_the_record_still_returns(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """3.2 — moved is ADVISORY: flagged, retrievable, normally ranked."""
        memory_id = _write_one(
            mc, "the moved cormorant fact", anchors=[_STORE_BLOB, _PR_ANCHOR]
        )
        _set_anchor_state(db, memory_id, "moved")

        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "moved cormorant",
                "query_embedding": _client_vector("the moved cormorant fact"),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
            },
        )
        assert resp.status_code == 200, resp.text
        (hit,) = resp.json()["hits"]
        assert hit["memory_id"] == memory_id
        assert hit["anchor_state"] == "moved"

    def test_anchorless_hits_report_none(self, mc: MemoryClient) -> None:
        _write_one(mc, "the unanchored heron fact")
        resp = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "unanchored heron"}
        )
        (hit,) = resp.json()["hits"]
        assert hit["anchor_state"] == "none"


class TestAnchoredProactiveRecall:
    """Phase 5 — shipped DEFAULT-OFF; the flag is the contract."""

    def test_default_off_reports_skipped_disabled(self, mc: MemoryClient) -> None:
        _write_one(mc, "the store anchored fact", anchors=[_STORE_BLOB])
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "irrelevant",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # Never silently empty: the arm says it did not run.
        assert body["anchored_arm"] == "skipped_disabled"
        assert body["anchored_hits"] == []

    def test_not_requested_when_no_clauses_are_sent(self, mc: MemoryClient) -> None:
        resp = mc.client.post("/api/v1/memory/query", json={"query_text": "anything"})
        assert resp.json()["anchored_arm"] == "not_requested"

    def test_enabled_arm_returns_records_anchored_to_the_glob(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        store_fact = _write_one(mc, "the store anchored fact", anchors=[_STORE_BLOB])
        endpoint_fact = _write_one(
            mc, "the endpoint anchored fact", anchors=[_ENDPOINT_BLOB]
        )
        coord_fact = _write_one(mc, "the coord anchored fact", anchors=[_COORD_BLOB])
        pr_fact = _write_one(mc, "the pr anchored fact", anchors=[_PR_ANCHOR])
        plain_fact = _write_one(mc, "the plain unanchored fact")

        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["anchored_arm"] == "ran"
        assert [h["memory_id"] for h in body["anchored_hits"]] == [store_fact]
        # The glob narrows within the repo, the repo narrows across repos,
        # and a path-less anchor type on a matching repo is not a path hit.
        returned = {h["memory_id"] for h in body["anchored_hits"]}
        assert endpoint_fact not in returned
        assert coord_fact not in returned
        assert pr_fact not in returned
        assert plain_fact not in returned
        # It is a SEPARATE arm — hits keeps its RRF meaning.
        assert body["hits"] == []

    def test_multiple_clauses_union(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        store_fact = _write_one(mc, "the store anchored fact", anchors=[_STORE_BLOB])
        coord_fact = _write_one(mc, "the coord anchored fact", anchors=[_COORD_BLOB])
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/**"},
                    {"repo": "qontinui-coord", "path_glob": "src/*.rs"},
                ],
            },
        )
        assert {h["memory_id"] for h in resp.json()["anchored_hits"]} == {
            store_fact,
            coord_fact,
        }

    def test_a_clause_must_match_repo_and_path_on_the_same_anchor(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        """Two anchors must not combine into a match neither one is."""
        _write_one(mc, "the cross-matched fact", anchors=[_STORE_BLOB, _COORD_BLOB])
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                # qontinui-web (from _STORE_BLOB) + src/*.rs (from
                # _COORD_BLOB) describes no anchor this record has.
                "anchored_to": [{"repo": "qontinui-web", "path_glob": "src/*.rs"}],
            },
        )
        assert resp.json()["anchored_hits"] == []

    def test_invisible_records_never_surface(
        self, mc: MemoryClient, db: AsyncEngine, anchored_recall_on: None
    ) -> None:
        """The arm reuses the shipped validity filter, so gone stays gone."""
        memory_id = _write_one(mc, "the hidden anchored fact", anchors=[_STORE_BLOB])
        _exec(
            db,
            [
                "UPDATE coord.memory_records SET valid_until = now() "
                "WHERE memory_id = CAST(:m AS uuid)"
            ],
            m=memory_id,
        )
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
                ],
            },
        )
        assert resp.json()["anchored_hits"] == []

    def test_ranked_by_importance_times_freshness(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        low = _write_one(
            mc,
            "the low importance anchored fact",
            anchors=[_STORE_BLOB],
            importance=0.1,
        )
        high = _write_one(
            mc,
            "the high importance anchored fact",
            anchors=[_STORE_BLOB],
            importance=0.9,
        )
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
                ],
            },
        )
        # Same age, so importance decides.
        assert [h["memory_id"] for h in resp.json()["anchored_hits"]] == [high, low]

    def test_tenant_isolation(
        self, mc: MemoryClient, db: AsyncEngine, anchored_recall_on: None
    ) -> None:
        foreign = MemoryClient(db)
        foreign_id = _write_one(
            foreign, "another tenant's anchored fact", anchors=[_STORE_BLOB]
        )
        mine = _write_one(mc, "my own anchored fact", anchors=[_STORE_BLOB])

        clause = {
            "query_text": "zzzznothinglexicallymatching",
            "anchored_to": [
                {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
            ],
        }
        mine_body = mc.client.post("/api/v1/memory/query", json=clause).json()
        assert [h["memory_id"] for h in mine_body["anchored_hits"]] == [mine]

        their_body = foreign.client.post("/api/v1/memory/query", json=clause).json()
        assert [h["memory_id"] for h in their_body["anchored_hits"]] == [foreign_id]

    def test_too_many_clauses_is_422(self, mc: MemoryClient) -> None:
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "x",
                "anchored_to": [
                    {"repo": f"repo-{i}", "path_glob": "*"} for i in range(17)
                ],
            },
        )
        assert resp.status_code == 422


class TestGlobTranslation:
    """Pure-function cover for the glob -> POSIX ARE translation."""

    @pytest.mark.parametrize(
        ("glob", "path", "matches"),
        [
            ("backend/app/services/*", "backend/app/services/memory_store.py", True),
            ("backend/app/services/*", "backend/app/api/memory.py", False),
            # `*` crosses `/` on purpose — the forgiving direction.
            ("backend/*", "backend/app/services/memory_store.py", True),
            ("backend/**", "backend/app/services/memory_store.py", True),
            ("*.py", "memory_store.py", True),
            ("*.py", "memory_store.rs", False),
            ("src/?.rs", "src/a.rs", True),
            ("src/?.rs", "src/ab.rs", False),
            ("src/[am]ain.rs", "src/main.rs", True),
            ("src/[!m]ain.rs", "src/main.rs", False),
            # Regex metacharacters in a glob are literals, not patterns.
            ("a.b", "axb", False),
            ("a.b", "a.b", True),
            ("a+b", "a+b", True),
            # An unterminated class must not blow up.
            ("src/[unterminated", "src/[unterminated", True),
        ],
    )
    def test_translation(
        self, db: AsyncEngine, glob: str, path: str, matches: bool
    ) -> None:
        # Asserted against POSTGRES's regex engine, not Python's — the
        # translation's only consumer is the `~` operator.
        got = _scalar(
            db,
            "SELECT CAST(:p AS text) ~ CAST(:re AS text)",
            p=path,
            re=store.glob_to_posix_regex(glob),
        )
        assert got is matches


class TestSupersedeCarriesAnchors:
    """Phase 6's "superseded, or corrected" arm.

    A correction is the single highest-value moment to carry an anchor:
    it is exactly what the anchor discipline exists to make mechanical.
    """

    def test_successor_inherits_anchors_when_none_are_supplied(
        self, mc: MemoryClient
    ) -> None:
        """THE decision, pinned by assertion: omission INHERITS.

        Dropping them here would silently demote an anchored record back
        onto the time-decay curve, whose terminus is a hard delete —
        unbounded and invisible. A wrongly-inherited anchor is bounded
        and reversible by comparison.
        """
        old_id = _write_one(
            mc, "the reaper runs every 60 seconds", anchors=[_STORE_BLOB, _PR_ANCHOR]
        )
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "corrected",
                "content": "the reaper runs every 30 seconds",
            },
        )
        assert resp.status_code == 200, resp.text
        new_id = resp.json()["memory_id"]
        assert new_id != old_id

        anchors = _anchors_of(mc, new_id)
        assert sorted(anchors, key=lambda a: a["type"]) == sorted(
            [_STORE_BLOB, _PR_ANCHOR], key=lambda a: a["type"]
        )

    def test_inherited_successor_is_decay_exempt(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """The inheritance is load-bearing, not cosmetic.

        An anchorless successor would be swept onto the Ebbinghaus curve;
        this asserts the successor actually lands in the exempt class, by
        asking `decay_invalidate`'s own exemption predicate.
        """
        old_id = _write_one(mc, "an anchored claim", anchors=[_STORE_BLOB])
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "corrected", "content": "a corrected anchored claim"},
        )
        new_id = resp.json()["memory_id"]
        exempt = _scalar(
            db,
            "SELECT anchors <> '[]'::jsonb FROM coord.memory_records "
            "WHERE memory_id = CAST(:m AS uuid)",
            m=new_id,
        )
        assert exempt is True

    def test_explicit_empty_array_deliberately_un_anchors(
        self, mc: MemoryClient
    ) -> None:
        """The escape hatch that makes inheriting safe.

        A rewrite that genuinely no longer asserts anything about the old
        artifact can say so — and that must be distinguishable from
        simply not mentioning anchors.
        """
        old_id = _write_one(mc, "a claim about a file", anchors=[_STORE_BLOB])
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "now about something else",
                "content": "a claim that changed subject entirely",
                "anchors": [],
            },
        )
        assert resp.status_code == 200, resp.text
        assert _anchors_of(mc, resp.json()["memory_id"]) == []

    def test_supplied_anchors_replace_rather_than_merge(self, mc: MemoryClient) -> None:
        """Supersede is the explicit human path: authoritative, not additive."""
        old_id = _write_one(mc, "the original claim", anchors=[_STORE_BLOB])
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "retargeted",
                "content": "the retargeted claim",
                "anchors": [_COORD_BLOB],
            },
        )
        assert resp.status_code == 200, resp.text
        assert _anchors_of(mc, resp.json()["memory_id"]) == [_COORD_BLOB]

    def test_anchorless_predecessor_yields_anchorless_successor(
        self, mc: MemoryClient
    ) -> None:
        """Inheritance of nothing is nothing — no accidental anchoring."""
        old_id = _write_one(mc, "a plain unanchored claim")
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "corrected", "content": "a corrected plain claim"},
        )
        assert _anchors_of(mc, resp.json()["memory_id"]) == []

    def test_successor_can_anchor_a_previously_unanchored_record(
        self, mc: MemoryClient
    ) -> None:
        """The other half of Phase 6: correction is also a place to ADD one."""
        old_id = _write_one(mc, "an unanchored claim about the store")
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "now anchored",
                "content": "a corrected claim about the store",
                "anchors": [_STORE_BLOB],
            },
        )
        assert _anchors_of(mc, resp.json()["memory_id"]) == [_STORE_BLOB]

    def test_anchor_state_is_not_inherited(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A verdict about the OLD row must not be asserted about the new one."""
        old_id = _write_one(mc, "a moved claim", anchors=[_STORE_BLOB])
        _set_anchor_state(db, old_id, "moved")
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={"title": "corrected", "content": "a corrected moved claim"},
        )
        new_id = resp.json()["memory_id"]
        page = mc.client.get("/api/v1/memory/records").json()["records"]
        (successor,) = [r for r in page if r["memory_id"] == new_id]
        # Anchors carried, verdict reset for the watcher to re-resolve.
        assert successor["anchors"] == [_STORE_BLOB]
        assert successor["anchor_state"] == "none"

    def test_writer_supplied_anchor_state_is_422_on_supersede_too(
        self, mc: MemoryClient
    ) -> None:
        """The derived-column wall has no hole in the supersede shape."""
        old_id = _write_one(mc, "a claim to correct", anchors=[_STORE_BLOB])
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "corrected",
                "content": "a corrected claim",
                "anchor_state": "fresh",
            },
        )
        assert resp.status_code == 422, resp.text
        assert "anchor_state" in resp.text

    def test_unknown_anchor_type_is_422_on_supersede_too(
        self, mc: MemoryClient
    ) -> None:
        old_id = _write_one(mc, "a claim to retarget")
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "retargeted",
                "content": "a retargeted claim",
                "anchors": [{"type": "symbol", "symbol": "observe_tick"}],
            },
        )
        assert resp.status_code == 422, resp.text

    def test_too_many_anchors_is_422_on_both_write_shapes(
        self, mc: MemoryClient
    ) -> None:
        """The same cap, from the same constant, on both write shapes."""
        from app.schemas.memory import MAX_ANCHORS_PER_RECORD

        over_cap = [
            {"type": "flag", "name": f"flag-{i}"}
            for i in range(MAX_ANCHORS_PER_RECORD + 1)
        ]
        fresh = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("an over-anchored new fact", anchors=over_cap)]},
        )
        assert fresh.status_code == 422, fresh.text

        old_id = _write_one(mc, "a claim to over-anchor")
        resp = mc.client.post(
            f"/api/v1/memory/records/{old_id}/supersede",
            json={
                "title": "over-anchored",
                "content": "an over-anchored claim",
                "anchors": over_cap,
            },
        )
        assert resp.status_code == 422, resp.text

    def test_inheritance_is_tenant_bound(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A foreign record is a 404, so there is nothing to inherit from."""
        foreign = MemoryClient(db)
        foreign_id = _write_one(
            foreign, "another tenant's anchored claim", anchors=[_STORE_BLOB]
        )
        resp = mc.client.post(
            f"/api/v1/memory/records/{foreign_id}/supersede",
            json={"title": "hijack", "content": "hijacked content"},
        )
        assert resp.status_code == 404
        assert _anchors_of(foreign, foreign_id) == [_STORE_BLOB]


class TestGlobTranslationIsAlwaysValidARE:
    """F3 — an invalid pattern here is a 500, not a bad match.

    Both reproducers below are ORDINARY glob syntax a caller can send:
    ``[[:alpha:]]`` is a correct POSIX class, and ``[z-a]`` is a plain
    typo. The first cut of the translator consumed the class's own ``]``
    as its terminator (``brackets [] not balanced``) and passed reversed
    ranges straight through (``invalid character range``).
    """

    NASTY = [
        "[z-a]",
        "[[:alpha:]]",
        "[[:alpha:][:digit:]]",
        "[[:nosuchclass:]]",
        "[]",
        "[!]",
        "[^]",
        "[a\\b]",
        "[[=a=]]",
        "[[.hyphen.]]",
        "src/[unterminated",
        "src/[[:alpha:]",
        "[]]",
        "[!]]",
        "[-a]",
        "[a-]",
        "[--0]",
        "**/[a-z]*.py",
        "[\\]",
        "[a-b-c]",
        "*[",
        "[[",
        "]]",
        "a{b,c}d",
        "(a|b)",
        "^$.|+()",
    ]

    @pytest.mark.parametrize("glob", NASTY)
    def test_postgres_accepts_every_emitted_pattern(
        self, db: AsyncEngine, glob: str
    ) -> None:
        """Postgres — not Python's `re` — is the authority on `~`."""
        regex = store.glob_to_posix_regex(glob)
        # Must not raise. The value is irrelevant; acceptance is the point.
        _scalar(
            db,
            "SELECT CAST(:p AS text) ~ CAST(:re AS text)",
            p="backend/app/services/memory_store.py",
            re=regex,
        )

    @pytest.mark.parametrize(
        ("glob", "path", "matches"),
        [
            # A well-formed POSIX class now WORKS rather than exploding.
            ("[[:alpha:]]", "a", True),
            ("[[:alpha:]]", "1", False),
            ("[[:digit:]][[:digit:]]", "42", True),
            ("src/[[:lower:]]ain.rs", "src/main.rs", True),
            # A rejected group degrades to LITERAL text, never to a 500
            # and never to a silent match-everything.
            ("[z-a]", "[z-a]", True),
            ("[z-a]", "a", False),
            ("[[:nosuchclass:]]", "[[:nosuchclass:]]", True),
            ("[[=a=]]", "[[=a=]]", True),
            ("[]", "[]", True),
            # Still-correct behaviour for the shapes that always worked.
            ("src/[am]ain.rs", "src/main.rs", True),
            ("src/[!m]ain.rs", "src/main.rs", False),
            ("src/[!m]ain.rs", "src/rain.rs", True),
            ("[a-z]*.py", "memory_store.py", True),
        ],
    )
    def test_semantics_of_the_repaired_and_degraded_groups(
        self, db: AsyncEngine, glob: str, path: str, matches: bool
    ) -> None:
        got = _scalar(
            db,
            "SELECT CAST(:p AS text) ~ CAST(:re AS text)",
            p=path,
            re=store.glob_to_posix_regex(glob),
        )
        assert got is matches

    def test_a_rejected_group_cannot_5xx_the_query_endpoint(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        """End to end: the reproducer reaches `~` through a real request."""
        _write_one(mc, "the store anchored fact", anchors=[_STORE_BLOB])
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/[z-a]pp/**"},
                    {"repo": "qontinui-web", "path_glob": "backend/[[:alpha:]]pp/**"},
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["anchored_arm"] == "ran"


class TestBatchToleratesIntraBatchDuplicates:
    """F5 — `ON CONFLICT DO UPDATE` cannot touch one row twice.

    Where `DO NOTHING` silently ignored a repeated content_hash, the merge
    raises `ON CONFLICT DO UPDATE command cannot affect row a second
    time`. The store collapses duplicates itself rather than leaving that
    as an unasserted precondition on a public function.
    """

    def _insert(
        self, db: AsyncEngine, tenant: UUID, items: list[Any]
    ) -> list[tuple[Any, bool]]:
        """Drive the store function directly — this is a store contract."""

        async def _go() -> list[tuple[Any, bool]]:
            maker = async_sessionmaker(db, class_=AsyncSession, expire_on_commit=False)
            async with maker() as session:
                out = await store.insert_records_batch(
                    session, tenant_id=tenant, items=items
                )
                await session.commit()
                return out

        return asyncio.run(_go())

    def _item(self, content_hash: str, title: str, anchors: list[Any]) -> Any:
        return store.MemoryRecordInsert(
            scope="tenant",
            scope_ref=None,
            kind="fact",
            title=title,
            content="the duplicated content",
            content_hash=content_hash,
            embedding=None,
            embedding_model=None,
            importance=0.5,
            source={},
            anchors=anchors,
        )

    def test_duplicate_hashes_do_not_raise_and_map_to_one_row(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        results = self._insert(
            db,
            tenant,
            [
                self._item("dup", "first", [_STORE_BLOB]),
                self._item("dup", "second", [_PR_ANCHOR]),
            ],
        )
        assert len(results) == 2
        first, second = results
        assert first[0] == second[0]
        assert first[1] is False
        assert second[1] is True

        rows = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_records WHERE tenant_id = :t",
            t=tenant,
        )
        assert rows == 1

    def test_collapsed_duplicates_union_their_anchors(self, db: AsyncEngine) -> None:
        """Dropping the later item's anchors would be the same silent loss
        the ON CONFLICT merge exists to prevent, moved one layer out."""
        tenant = uuid4()
        self._insert(
            db,
            tenant,
            [
                self._item("dup", "first", [_STORE_BLOB]),
                self._item("dup", "second", [_PR_ANCHOR]),
                self._item("dup", "third", [_STORE_BLOB]),
            ],
        )
        stored = _scalar(
            db,
            "SELECT anchors FROM coord.memory_records WHERE tenant_id = :t",
            t=tenant,
        )
        stored = json.loads(stored) if isinstance(stored, str) else stored
        assert sorted(stored, key=lambda a: a["type"]) == sorted(
            [_STORE_BLOB, _PR_ANCHOR], key=lambda a: a["type"]
        )

    def test_first_occurrence_supplies_every_other_column(
        self, db: AsyncEngine
    ) -> None:
        """Matches the write endpoint's own first-occurrence-wins rule."""
        tenant = uuid4()
        self._insert(
            db,
            tenant,
            [
                self._item("dup", "the winning title", []),
                self._item("dup", "the losing title", []),
            ],
        )
        title = _scalar(
            db,
            "SELECT title FROM coord.memory_records WHERE tenant_id = :t",
            t=tenant,
        )
        assert title == "the winning title"

    def test_duplicates_against_an_existing_live_row_still_merge(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        self._insert(db, tenant, [self._item("dup", "original", [])])
        results = self._insert(
            db,
            tenant,
            [
                self._item("dup", "again", [_STORE_BLOB]),
                self._item("dup", "again too", [_PR_ANCHOR]),
            ],
        )
        assert all(deduped for _mid, deduped in results)
        stored = _scalar(
            db,
            "SELECT anchors FROM coord.memory_records WHERE tenant_id = :t",
            t=tenant,
        )
        stored = json.loads(stored) if isinstance(stored, str) else stored
        assert len(stored) == 2


class TestMergeMovesUpdatedAt:
    """F4 — a backfilled anchor an incremental sync never sees is inert."""

    def test_backfilled_anchor_is_visible_to_an_incremental_pull(
        self, mc: MemoryClient
    ) -> None:
        content = "the fact a mirror already holds"
        memory_id = _write_one(mc, content)
        before = mc.client.get("/api/v1/memory/records").json()["records"][0]
        watermark = before["updated_at"]

        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record(content, anchors=[_STORE_BLOB])]},
        )

        # Exactly the query a sync mirror issues after `watermark`.
        page = mc.client.get(
            "/api/v1/memory/records", params={"since": watermark}
        ).json()["records"]
        assert [r["memory_id"] for r in page] == [memory_id]
        assert page[0]["anchors"] == [_STORE_BLOB]

    def test_a_no_op_merge_causes_no_churn(self, mc: MemoryClient) -> None:
        """Re-writing an anchor the row already has must not touch the row."""
        content = "the already-anchored fact"
        _write_one(mc, content, anchors=[_STORE_BLOB])
        before = mc.client.get("/api/v1/memory/records").json()["records"][0]

        mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record(content, anchors=[_STORE_BLOB])]},
        )
        after = mc.client.get("/api/v1/memory/records").json()["records"][0]
        assert after["updated_at"] == before["updated_at"]
        # ...and an incremental pull at that watermark sees nothing new.
        page = mc.client.get(
            "/api/v1/memory/records", params={"since": before["updated_at"]}
        ).json()["records"]
        assert page == []


class TestBatchAnchorsUnionAcrossOccurrences:
    """F10 — the endpoint must not drop anchors before the store sees them.

    Intra-batch duplicates collapse to the FIRST occurrence for every
    column, which is right for all of them except anchors: two records
    with identical content are two writers making the same claim, and the
    second naming its ground truth does not make the first's naming
    wrong. Taking only the first occurrence's anchors defeated the
    store's ON CONFLICT union and its intra-batch collapse from one layer
    above, before either could see the anchor.
    """

    def test_anchor_on_the_second_occurrence_is_not_dropped(
        self, mc: MemoryClient
    ) -> None:
        content = "the twice-written fact"
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(content),
                    _record(content, anchors=[_STORE_BLOB]),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        first, second = resp.json()["records"]
        assert first["memory_id"] == second["memory_id"]
        assert second["deduped"] is True
        assert _anchors_of(mc, first["memory_id"]) == [_STORE_BLOB]

    def test_anchors_union_across_every_occurrence(self, mc: MemoryClient) -> None:
        content = "the thrice-written fact"
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(content, anchors=[_STORE_BLOB]),
                    _record(content),
                    _record(content, anchors=[_PR_ANCHOR, _STORE_BLOB]),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        memory_id = resp.json()["records"][0]["memory_id"]
        anchors = _anchors_of(mc, memory_id)
        assert sorted(anchors, key=lambda a: a["type"]) == sorted(
            [_STORE_BLOB, _PR_ANCHOR], key=lambda a: a["type"]
        )

    def test_first_occurrence_still_wins_every_other_column(
        self, mc: MemoryClient
    ) -> None:
        """Only anchors union; the long-standing rule is otherwise unchanged."""
        content = "the fact with two titles"
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(content, title="the winning title", importance=0.9),
                    _record(
                        content,
                        title="the losing title",
                        importance=0.1,
                        anchors=[_STORE_BLOB],
                    ),
                ]
            },
        )
        memory_id = resp.json()["records"][0]["memory_id"]
        (row,) = mc.client.get("/api/v1/memory/records").json()["records"]
        assert row["memory_id"] == memory_id
        assert row["title"] == "the winning title"
        assert row["importance"] == pytest.approx(0.9)
        assert row["anchors"] == [_STORE_BLOB]

    def test_backfill_fires_when_the_anchor_arrives_on_a_later_duplicate(
        self, mc: MemoryClient
    ) -> None:
        """The `write_hashes` predicate must key on the UNION.

        A known-duplicate hash only enters the batch when it has an anchor
        to contribute. Keying that on the FIRST occurrence meant an anchor
        arriving on a later duplicate never reached Postgres at all — the
        Phase 6 backfill silently did not happen, which is the exact
        failure the dedup-merge was built to fix.
        """
        content = "the already-stored fact"
        memory_id = _write_one(mc, content)
        assert _anchors_of(mc, memory_id) == []

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(content),
                    _record(content, anchors=[_STORE_BLOB]),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert all(r["memory_id"] == memory_id for r in resp.json()["records"])
        assert _anchors_of(mc, memory_id) == [_STORE_BLOB]

    def test_an_all_anchorless_duplicate_group_still_writes_nothing_extra(
        self, mc: MemoryClient
    ) -> None:
        """Negative control: no anchors anywhere → no batch entry, no churn."""
        content = "the plain repeated fact"
        memory_id = _write_one(mc, content)
        before = mc.client.get("/api/v1/memory/records").json()["records"][0]

        resp = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record(content), _record(content)]},
        )
        assert resp.json()["deduped_count"] == 2
        after = mc.client.get("/api/v1/memory/records").json()["records"][0]
        assert after["memory_id"] == memory_id
        assert after["updated_at"] == before["updated_at"]

    def test_union_is_visible_to_an_incremental_sync(self, mc: MemoryClient) -> None:
        """End to end with F4: the unioned anchor reaches a mirror."""
        content = "the fact a mirror already holds"
        memory_id = _write_one(mc, content)
        watermark = mc.client.get("/api/v1/memory/records").json()["records"][0][
            "updated_at"
        ]

        mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(content),
                    _record(content, anchors=[_PR_ANCHOR]),
                ]
            },
        )
        page = mc.client.get(
            "/api/v1/memory/records", params={"since": watermark}
        ).json()["records"]
        assert [r["memory_id"] for r in page] == [memory_id]
        assert page[0]["anchors"] == [_PR_ANCHOR]


class TestAnchorUnionRespectsTheCap:
    """The cross-record union must not defeat ``MAX_ANCHORS_PER_RECORD``.

    The cap is enforced on the pydantic request model, i.e. per INCOMING
    RECORD. The union crosses records, and nothing below it re-checks:
    ``MemoryRecordInsert.anchors`` is a bare ``list[dict]``,
    ``insert_records_batch`` binds it verbatim, and the column has no
    length CHECK. So a request whose every record is individually legal
    could land an arbitrarily long array on one row — at zero quota cost,
    because none of those records creates a row.

    That matters because the cap's reason is per-tick fan-out: the array
    is re-resolved by the watcher on every tick, so its length is a
    standing multiplier on GitHub/twin reads for that row.
    """

    def test_worst_case_request_lands_within_the_cap(self, mc: MemoryClient) -> None:
        """MAX_RECORDS_PER_REQUEST records x MAX_ANCHORS_PER_RECORD distinct.

        Measured 1600 on one row (100x the cap) before the re-cap.
        """
        from app.schemas.memory import MAX_ANCHORS_PER_RECORD, MAX_RECORDS_PER_REQUEST

        records = [
            _record(
                "one identical body",
                anchors=[
                    {"type": "flag", "name": f"flag-{r}-{k}"}
                    for k in range(MAX_ANCHORS_PER_RECORD)
                ],
            )
            for r in range(MAX_RECORDS_PER_REQUEST)
        ]
        resp = mc.client.post("/api/v1/memory/records", json={"records": records})
        # Every record is individually legal, so the request is accepted...
        assert resp.status_code == 200, resp.text
        page = mc.client.get("/api/v1/memory/records").json()["records"]
        assert len(page) == 1
        # ...and the union it collapses to is still capped.
        assert len(page[0]["anchors"]) <= MAX_ANCHORS_PER_RECORD

    def test_truncation_keeps_the_first_anchors_seen(self, mc: MemoryClient) -> None:
        """Same first-occurrence-wins rule the rest of the collapse uses."""
        from app.schemas.memory import MAX_ANCHORS_PER_RECORD

        first = [
            {"type": "flag", "name": f"early-{k}"}
            for k in range(MAX_ANCHORS_PER_RECORD)
        ]
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("one body", anchors=first),
                    _record("one body", anchors=[{"type": "flag", "name": "late"}]),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        (row,) = mc.client.get("/api/v1/memory/records").json()["records"]
        assert row["anchors"] == first
        assert {"type": "flag", "name": "late"} not in row["anchors"]

    def test_union_below_the_cap_is_untouched(self, mc: MemoryClient) -> None:
        """Positive control — the re-cap must not clip an ordinary union."""
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("a body", anchors=[_STORE_BLOB]),
                    _record("a body", anchors=[_PR_ANCHOR]),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        (row,) = mc.client.get("/api/v1/memory/records").json()["records"]
        assert sorted(row["anchors"], key=lambda a: a["type"]) == sorted(
            [_STORE_BLOB, _PR_ANCHOR], key=lambda a: a["type"]
        )

    def test_duplicates_across_records_do_not_consume_cap_budget(
        self, mc: MemoryClient
    ) -> None:
        """Identity dedup happens before the cap, so repeats are free."""
        from app.schemas.memory import MAX_ANCHORS_PER_RECORD

        full = [
            {"type": "flag", "name": f"f-{k}"} for k in range(MAX_ANCHORS_PER_RECORD)
        ]
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("a body", anchors=full) for _ in range(5)]},
        )
        assert resp.status_code == 200, resp.text
        (row,) = mc.client.get("/api/v1/memory/records").json()["records"]
        assert len(row["anchors"]) == MAX_ANCHORS_PER_RECORD
        assert row["anchors"] == full

    def test_backfill_onto_an_existing_row_is_capped_too(
        self, mc: MemoryClient
    ) -> None:
        """The known-duplicate path reaches the same bucket."""
        from app.schemas.memory import MAX_ANCHORS_PER_RECORD

        content = "an already-stored body"
        memory_id = _write_one(mc, content)
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        content,
                        anchors=[
                            {"type": "flag", "name": f"g-{r}-{k}"}
                            for k in range(MAX_ANCHORS_PER_RECORD)
                        ],
                    )
                    for r in range(8)
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert len(_anchors_of(mc, memory_id)) <= MAX_ANCHORS_PER_RECORD


# ---------------------------------------------------------------------------
# A self-describing zero — plan
# 2026-08-31-memory-search-zero-hit-is-not-self-describing, Phase 2.
#
# ``hits: []`` used to be the identical answer for an empty corpus, a
# mistyped filter, a wrong tenant and a retrieval that landed in the
# anchored arm. These cover the three fields (plus the 422) that make the
# four distinguishable in ONE call.
# ---------------------------------------------------------------------------


class TestQueryZeroIsSelfDescribing:
    def test_unrecognized_request_key_is_422_naming_the_field(
        self, mc: MemoryClient
    ) -> None:
        """``extra="forbid"``: the misspelling is rejected, not absorbed."""
        resp = mc.client.post(
            "/api/v1/memory/query",
            # The singular of a real field — the exact class of typo that
            # used to run a WIDER query and answer with an empty list.
            json={"query_text": "anything", "scope": "tenant"},
        )
        assert resp.status_code == 422, resp.text
        detail = resp.json()["detail"]
        offending = {d["loc"][-1] for d in detail}
        assert "scope" in offending, detail
        assert any(d["type"] == "extra_forbidden" for d in detail), detail

    def test_a_field_this_build_does_not_have_is_also_422(
        self, mc: MemoryClient
    ) -> None:
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "anything", "semantic_only": True},
        )
        assert resp.status_code == 422, resp.text
        assert "semantic_only" in {d["loc"][-1] for d in resp.json()["detail"]}

    def test_every_valid_field_still_round_trips(self, mc: MemoryClient) -> None:
        """Negative control: forbidding extras must not reject the contract."""
        resp = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "kitchen sink",
                "query_embedding": _client_vector("kitchen sink"),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
                "kinds": ["fact"],
                "scopes": ["tenant"],
                "scope_ref": None,
                "since": "2020-01-01T00:00:00Z",
                "as_of": "2999-01-01T00:00:00Z",
                "min_importance": 0.1,
                "limit": 7,
                "link_expansion": True,
                "anchored_to": [{"repo": "qontinui-web", "path_glob": "backend/*"}],
            },
        )
        assert resp.status_code == 200, resp.text

    def test_no_match_reports_a_non_zero_live_row_count(self, mc: MemoryClient) -> None:
        """The whole point: zero hits against a corpus that HAS rows."""
        for content in (
            "the aardwolf termite fact",
            "the basilisk lizard fact",
            "the caracal ear fact",
        ):
            _write_one(mc, content)

        resp = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "zzzznothinglexicallymatching"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["hits"] == []
        # "You matched none of 3" — not "there is nothing here".
        assert body["live_row_count"] == 3

    def test_an_actually_empty_corpus_reports_zero(self, mc: MemoryClient) -> None:
        """The other diagnosis, and it must NOT look like the one above."""
        body = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "anything at all"}
        ).json()
        assert body["hits"] == []
        assert body["live_row_count"] == 0

    def test_live_row_count_is_tenant_scoped(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """A wrong-tenant query is a THIRD diagnosis the denominator shows."""
        foreign = MemoryClient(db)
        for content in ("another tenant's first fact", "another tenant's second fact"):
            _write_one(foreign, content)
        _write_one(mc, "my own solitary fact")

        mine = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "zzzznothinglexicallymatching"}
        ).json()
        theirs = foreign.client.post(
            "/api/v1/memory/query", json={"query_text": "zzzznothinglexicallymatching"}
        ).json()
        assert mine["live_row_count"] == 1
        assert theirs["live_row_count"] == 2

    def test_live_row_count_excludes_dead_rows(
        self, mc: MemoryClient, db: AsyncEngine
    ) -> None:
        """It is the RETRIEVAL-live predicate, so it can never over-promise."""
        keep = _write_one(mc, "the surviving quokka fact")
        doomed = _write_one(mc, "the doomed dodo fact")
        expired = _write_one(mc, "the expired mayfly fact")

        assert (
            mc.client.delete(f"/api/v1/memory/records/{doomed}").status_code == 204
        ), doomed
        _exec(
            db,
            [
                "UPDATE coord.memory_records SET valid_until = now() "
                "WHERE memory_id = CAST(:m AS uuid)"
            ],
            m=expired,
        )

        body = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "surviving quokka"}
        ).json()
        assert [h["memory_id"] for h in body["hits"]] == [keep]
        assert body["live_row_count"] == 1

    def test_live_row_count_agrees_with_the_stats_facet(self, mc: MemoryClient) -> None:
        """One definition of "live", two publishers — they must not drift."""
        for content in ("alpha fact", "beta fact", "gamma fact", "delta fact"):
            _write_one(mc, content)
        query_side = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "alpha"}
        ).json()["live_row_count"]
        stats_side = mc.client.get("/api/v1/memory/stats").json()["facets"][
            "live_row_count"
        ]
        assert query_side == stats_side == 4


class TestQueryEcho:
    def test_echo_shows_resolved_defaults_the_caller_never_sent(
        self, mc: MemoryClient
    ) -> None:
        """A parameter the caller omitted comes back with its RESOLVED value."""
        body = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "minimal request"}
        ).json()
        echo = body["query_echo"]
        assert echo["query_text"] == "minimal request"
        # Never sent — the endpoint's default scope pair, made visible.
        assert echo["scopes"] == ["tenant", "runner"]
        assert echo["limit"] == DEFAULT_QUERY_LIMIT
        assert echo["link_expansion"] is False
        assert echo["kinds"] is None
        assert echo["scope_ref"] is None
        assert echo["min_importance"] is None
        assert echo["since"] is None
        # No caller-named instant: echoing a synthesized "now" would
        # report a filter that never ran.
        assert echo["as_of"] is None
        assert echo["anchored_to_count"] == 0

    def test_echo_is_of_resolved_values_not_raw_input(self, mc: MemoryClient) -> None:
        """An empty ``kinds``/``scopes`` list is NOT what the query ran with."""
        body = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "empty filters", "kinds": [], "scopes": []},
        ).json()
        echo = body["query_echo"]
        # `[]` collapses to "no kind filter" in the filter builder; the
        # echo reports what filtered, not what was typed.
        assert echo["kinds"] is None
        assert echo["scopes"] == ["tenant", "runner"]

    def test_echo_reflects_what_the_caller_did_send(self, mc: MemoryClient) -> None:
        body = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "explicit request",
                "kinds": ["fact", "rule"],
                "scopes": ["agent"],
                "scope_ref": "agent-42",
                "limit": 3,
                "link_expansion": True,
                "min_importance": 0.25,
                "since": "2021-02-03T04:05:06Z",
                "as_of": "2022-03-04T05:06:07Z",
            },
        ).json()
        echo = body["query_echo"]
        assert echo["kinds"] == ["fact", "rule"]
        assert echo["scopes"] == ["agent"]
        assert echo["scope_ref"] == "agent-42"
        assert echo["limit"] == 3
        assert echo["link_expansion"] is True
        assert echo["min_importance"] == 0.25
        assert echo["since"].startswith("2021-02-03T04:05:06")
        assert echo["as_of"].startswith("2022-03-04T05:06:07")

    def test_echo_makes_a_self_inflicted_zero_readable(self, mc: MemoryClient) -> None:
        """A well-formed request whose own filter excluded everything."""
        _write_one(mc, "the visible ocelot fact", importance=0.2)
        body = mc.client.post(
            "/api/v1/memory/query",
            json={"query_text": "visible ocelot", "min_importance": 0.9},
        ).json()
        assert body["hits"] == []
        # Non-zero corpus + the offending filter, in the same payload.
        assert body["live_row_count"] == 1
        assert body["query_echo"]["min_importance"] == 0.9

    def test_echo_counts_anchored_clauses(self, mc: MemoryClient) -> None:
        body = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "anything",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/**"},
                    {"repo": "qontinui-coord", "path_glob": "src/*.rs"},
                ],
            },
        ).json()
        assert body["query_echo"]["anchored_to_count"] == 2


class TestAnchoredHitCount:
    def test_empty_hits_beside_populated_anchored_hits_counts_them(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        """The FOURTH diagnosis: zero ``hits`` on a response that retrieved."""
        store_fact = _write_one(mc, "the store anchored fact", anchors=[_STORE_BLOB])
        body = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
                ],
            },
        ).json()
        assert body["hits"] == []
        assert body["anchored_arm"] == "ran"
        assert [h["memory_id"] for h in body["anchored_hits"]] == [store_fact]
        # A caller reading `hits` alone cannot now read zero off this.
        assert body["anchored_hit_count"] == 1

    def test_count_tracks_the_list(
        self, mc: MemoryClient, anchored_recall_on: None
    ) -> None:
        for content in ("first anchored fact", "second anchored fact"):
            _write_one(mc, content, anchors=[_STORE_BLOB])
        body = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "zzzznothinglexicallymatching",
                "anchored_to": [
                    {"repo": "qontinui-web", "path_glob": "backend/app/services/*"}
                ],
            },
        ).json()
        assert body["anchored_hit_count"] == len(body["anchored_hits"]) == 2

    def test_zero_when_the_arm_never_ran(self, mc: MemoryClient) -> None:
        body = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "anything"}
        ).json()
        assert body["anchored_arm"] == "not_requested"
        assert body["anchored_hit_count"] == 0


class TestSelfDescribingFieldsAreRequired:
    """Un-defaulted, so an old backend fails loudly instead of reading 0."""

    def test_the_three_fields_have_no_defaults(self) -> None:
        from app.schemas.memory import MemoryQueryResponse

        for name in ("query_echo", "live_row_count", "anchored_hit_count"):
            field = MemoryQueryResponse.model_fields[name]
            assert field.is_required(), (
                f"{name} must stay REQUIRED: an optional field is absent on "
                "an old backend, which reproduces exactly the ambiguity this "
                "change removes — and reproduces it invisibly."
            )

    def test_the_arms_are_unchanged(self, mc: MemoryClient) -> None:
        """C: no ranking/arm/key change rides along with the new fields."""
        _write_one(mc, "the unchanged armadillo fact")
        fts_only = mc.client.post(
            "/api/v1/memory/query", json={"query_text": "unchanged armadillo"}
        ).json()
        assert fts_only["vector_arm"] == "skipped_no_embedding"
        assert fts_only["link_arm"] == "skipped_disabled"
        assert [h["memory_id"] for h in fts_only["hits"]]

        hybrid = mc.client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "unchanged armadillo",
                "query_embedding": _client_vector("the unchanged armadillo fact"),
                "query_embedding_model": EMBEDDING_MODEL_TAG,
                "link_expansion": True,
            },
        ).json()
        assert hybrid["vector_arm"] == "hybrid"
        assert hybrid["link_arm"] == "expanded"
        # `hits` keeps its name and its meaning.
        assert [h["memory_id"] for h in hybrid["hits"]] == [
            h["memory_id"] for h in fts_only["hits"]
        ]
