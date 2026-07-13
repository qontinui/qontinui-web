"""DB-backed tests for the MEMORY.md bridge indexer (Phase 5).

Same pgvector fixture posture as ``tests/test_memory_api_db.py``, plus a
test-local mirror of the ``coord.memories`` table and the
``coord.memories_latest`` view (per the ``coord_memories`` +
``coord_tenant_scope_columns`` alembic migrations). Covers: initial
mirror, idempotent re-run, version-bump supersede, content-neutral
version bump (dedup, no churn), removal → tombstone, and the
NULL-tenant skip.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable, Callable, Generator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.jobs.memory_bridge import bridge_sync_once
from app.services import memory_embedder
from app.services import memory_store as store
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import _SETUP_SQL, HashingStubEmbedder, _exec, _scalar

# Mirrors alembic ``coord_memories`` (+ the tenant_id column and the
# tenant-aware view projection from ``coord_tenant_scope_columns``).
_MEMORIES_SQL = [
    """
    CREATE TABLE IF NOT EXISTS coord.memories (
        memory_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name               TEXT NOT NULL,
        version            BIGINT NOT NULL,
        content            TEXT NOT NULL,
        description        TEXT,
        type               TEXT,
        written_by_agent   UUID,
        written_by_device  UUID,
        written_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        is_tombstone       BOOLEAN NOT NULL DEFAULT FALSE,
        tenant_id          UUID,
        UNIQUE (name, version)
    )
    """,
    """
    CREATE OR REPLACE VIEW coord.memories_latest AS
        SELECT DISTINCT ON (name)
            memory_id, name, version, content, description, type,
            written_by_agent, written_by_device, written_at, is_tombstone,
            tenant_id
        FROM coord.memories
        WHERE NOT is_tombstone
        ORDER BY name, version DESC
    """,
]


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
    _exec(engine, _MEMORIES_SQL)
    yield engine
    asyncio.run(engine.dispose())


@pytest.fixture()
def db(memory_engine: AsyncEngine) -> Generator[AsyncEngine, None, None]:
    _exec(
        memory_engine,
        [
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
            "DELETE FROM coord.memories",
        ],
    )
    yield memory_engine


@pytest.fixture(autouse=True)
def _stub_embedder() -> Generator[None, None, None]:
    memory_embedder.set_embedder(HashingStubEmbedder())
    yield
    memory_embedder.set_embedder(None)


def _run[T](engine: AsyncEngine, fn: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async def _go() -> T:
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as session:
            result = await fn(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def _sync(engine: AsyncEngine) -> dict[str, int]:
    return _run(engine, bridge_sync_once)


def _write_memory(
    engine: AsyncEngine,
    tenant_id: UUID | None,
    name: str,
    version: int,
    content: str,
    *,
    is_tombstone: bool = False,
) -> None:
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memories
                (name, version, content, is_tombstone, tenant_id)
            VALUES (:name, :version, :content, :is_tombstone, :tenant_id)
            """
        ],
        name=name,
        version=version,
        content=content,
        is_tombstone=is_tombstone,
        tenant_id=tenant_id,
    )


def _bridged(engine: AsyncEngine, tenant_id: UUID) -> list[dict[str, Any]]:
    """Live bridged records for a tenant, as plain dicts."""

    async def _go(session: AsyncSession) -> list[dict[str, Any]]:
        records = await store.list_bridged_records(session, now=datetime.now(UTC))
        return [
            {"name": name, "memory_id": memory_id, "version": version}
            for (t, name), (memory_id, version) in records.items()
            if t == tenant_id
        ]

    return _run(engine, _go)


def _record_field(engine: AsyncEngine, memory_id: UUID, column: str) -> Any:
    return _scalar(
        engine,
        f"SELECT {column} FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )


class TestBridgeUpsert:
    def test_initial_mirror_and_idempotent_rerun(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _write_memory(db, tenant, "proj_alpha_notes", 1, "alpha memory body")
        _write_memory(db, tenant, "feedback_beta", 1, "beta memory body")

        stats = _sync(db)
        assert stats == {"upserted": 2, "superseded": 0, "tombstoned": 0}

        bridged = {r["name"]: r for r in _bridged(db, tenant)}
        assert set(bridged) == {"proj_alpha_notes", "feedback_beta"}
        record_id = bridged["proj_alpha_notes"]["memory_id"]
        assert _record_field(db, record_id, "kind") == "reference"
        assert _record_field(db, record_id, "scope") == "tenant"
        assert _record_field(db, record_id, "title") == "proj_alpha_notes"
        assert _record_field(db, record_id, "content") == "alpha memory body"
        assert _record_field(db, record_id, "source->>'bridge'") == "coord.memories"
        assert (
            _record_field(db, record_id, "source->>'memory_name'") == "proj_alpha_notes"
        )
        assert _record_field(db, record_id, "source->>'version'") == "1"
        assert _record_field(db, record_id, "embedding") is not None

        # Re-run: nothing to do, and no duplicate rows.
        stats = _sync(db)
        assert stats == {"upserted": 0, "superseded": 0, "tombstoned": 0}
        count = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_records WHERE tenant_id = :t",
            t=tenant,
        )
        assert count == 2

    def test_version_bump_supersedes_prior_record(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _write_memory(db, tenant, "proj_alpha_notes", 1, "first body")
        _sync(db)
        (old,) = _bridged(db, tenant)

        _write_memory(db, tenant, "proj_alpha_notes", 2, "second body, revised")
        stats = _sync(db)
        assert stats["upserted"] == 1
        assert stats["superseded"] == 1

        (live,) = _bridged(db, tenant)
        assert live["version"] == 2
        assert live["memory_id"] != old["memory_id"]
        assert _record_field(db, old["memory_id"], "superseded_by") == live["memory_id"]
        assert _record_field(db, old["memory_id"], "valid_until") is not None

    def test_content_neutral_version_bump_dedups(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _write_memory(db, tenant, "feedback_beta", 1, "unchanged body")
        _sync(db)
        (before,) = _bridged(db, tenant)

        _write_memory(db, tenant, "feedback_beta", 2, "unchanged body")
        stats = _sync(db)
        assert stats["upserted"] == 1
        assert stats["superseded"] == 0  # same row, just a refreshed stamp

        (after,) = _bridged(db, tenant)
        assert after["memory_id"] == before["memory_id"]
        assert after["version"] == 2

        # Converged: the next run is a no-op.
        stats = _sync(db)
        assert stats == {"upserted": 0, "superseded": 0, "tombstoned": 0}

    def test_tenants_are_isolated(self, db: AsyncEngine) -> None:
        tenant_a, tenant_b = uuid4(), uuid4()
        _write_memory(db, tenant_a, "a_memory", 1, "body for tenant a")
        _write_memory(db, tenant_b, "b_memory", 1, "body for tenant b")
        _sync(db)
        assert [r["name"] for r in _bridged(db, tenant_a)] == ["a_memory"]
        assert [r["name"] for r in _bridged(db, tenant_b)] == ["b_memory"]


class TestBridgeTombstone:
    def test_removed_memory_tombstones_bridged_record(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _write_memory(db, tenant, "proj_alpha_notes", 1, "alpha body")
        _sync(db)
        (bridged,) = _bridged(db, tenant)

        # Coord retracts the memory. NOTE the view's semantics: the
        # ``WHERE NOT is_tombstone`` filter drops tombstone ROWS before
        # DISTINCT ON, so a name only vanishes from ``memories_latest``
        # once every version is tombstoned (a lone tombstone version
        # would just re-expose the previous live one).
        _write_memory(
            db, tenant, "proj_alpha_notes", 2, "alpha body", is_tombstone=True
        )
        _exec(
            db,
            ["UPDATE coord.memories SET is_tombstone = true WHERE name = :name"],
            name="proj_alpha_notes",
        )
        stats = _sync(db)
        assert stats["tombstoned"] == 1

        assert _record_field(db, bridged["memory_id"], "is_tombstone") is True
        assert _bridged(db, tenant) == []

        # Idempotent afterwards.
        stats = _sync(db)
        assert stats == {"upserted": 0, "superseded": 0, "tombstoned": 0}


class TestBridgeRedaction:
    def test_planted_secret_is_redacted_before_storage(self, db: AsyncEngine) -> None:
        """Bridged coord.memories content passes through redact_text —
        the secret never lands in coord.memory_records, and the stored
        content_hash covers the REDACTED text (dedup keys line up with
        API-written rows)."""
        tenant = uuid4()
        _write_memory(
            db,
            tenant,
            "ops_creds_note",
            1,
            "the deploy key AKIAIOSFODNN7EXAMPLE was rotated yesterday",
        )
        stats = _sync(db)
        assert stats["upserted"] == 1

        (bridged,) = _bridged(db, tenant)
        content = _record_field(db, bridged["memory_id"], "content")
        assert "AKIAIOSFODNN7EXAMPLE" not in content
        assert "[REDACTED:aws_key]" in content
        stored_hash = _record_field(db, bridged["memory_id"], "content_hash")
        assert stored_hash == hashlib.sha256(str(content).encode("utf-8")).hexdigest()

        # Converged: the next run is a no-op (the version stamp matches).
        assert _sync(db) == {"upserted": 0, "superseded": 0, "tombstoned": 0}


class TestBridgeSkips:
    def test_null_tenant_memories_are_skipped(self, db: AsyncEngine) -> None:
        _write_memory(db, None, "unbound_memory", 1, "no tenant binding")
        stats = _sync(db)
        assert stats == {"upserted": 0, "superseded": 0, "tombstoned": 0}
        count = _scalar(db, "SELECT count(*) FROM coord.memory_records")
        assert count == 0
