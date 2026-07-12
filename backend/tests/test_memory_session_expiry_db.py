"""DB-backed tests for the session-close expiry sweep (v1.1, Phase 1).

Same pgvector-fixture posture as ``tests/test_memory_api_db.py`` (whose
DDL + helpers this reuses): runs against the shared test PostgreSQL,
SKIPS gracefully when Postgres or pgvector is unavailable.

Covers ``memory_store.expire_closed_session_records``:

* a ``scope='session'`` row whose session is closed gets
  ``valid_until = closed_at + 7 days``,
* a row whose session is still active is untouched,
* an orphan row (scope_ref names no session) older than 24h gets
  ``valid_until = created_at + 7 days``,
* a malformed (non-UUID) scope_ref does NOT raise and is treated as an
  orphan,
* a second run is a no-op (idempotent).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Generator
from datetime import UTC, datetime, timedelta
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

from app.services import memory_store as store
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import _SETUP_SQL, _exec, _scalar

NOW = datetime(2026, 7, 10, 12, 0, 0, tzinfo=UTC)


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
    _exec(
        memory_engine,
        [
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.sessions",
        ],
    )
    yield memory_engine


def _run[T](engine: AsyncEngine, fn: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async def _go() -> T:
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as session:
            result = await fn(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def _seed_session(
    engine: AsyncEngine,
    tenant: UUID,
    *,
    state: str,
    closed_days_ago: float | None = None,
) -> UUID:
    session_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.sessions (id, tenant_id, state, closed_at)
            VALUES (:id, :tenant, :state, :closed_at)
            """
        ],
        id=session_id,
        tenant=tenant,
        state=state,
        closed_at=(
            NOW - timedelta(days=closed_days_ago)
            if closed_days_ago is not None
            else None
        ),
    )
    return session_id


def _seed_session_record(
    engine: AsyncEngine,
    tenant: UUID,
    scope_ref: str,
    *,
    created_days_ago: float = 0.0,
    valid_until_days_ago: float | None = None,
) -> UUID:
    memory_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_records
                (memory_id, tenant_id, scope, scope_ref, kind, title,
                 content, content_hash, valid_until, created_at)
            VALUES
                (:memory_id, :tenant, 'session', :scope_ref, 'episode',
                 :title, :content, :content_hash, :valid_until, :created_at)
            """
        ],
        memory_id=memory_id,
        tenant=tenant,
        scope_ref=scope_ref,
        title="session note",
        content=f"session content {memory_id}",
        content_hash=f"hash-{memory_id}",
        valid_until=(
            NOW - timedelta(days=valid_until_days_ago)
            if valid_until_days_ago is not None
            else None
        ),
        created_at=NOW - timedelta(days=created_days_ago),
    )
    return memory_id


def _valid_until(engine: AsyncEngine, memory_id: UUID) -> Any:
    return _scalar(
        engine,
        "SELECT valid_until FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )


def _closed_at(engine: AsyncEngine, session_id: UUID) -> datetime:
    return _scalar(
        engine, "SELECT closed_at FROM coord.sessions WHERE id = :s", s=session_id
    )


class TestSessionExpirySweep:
    def test_closed_session_row_expires_at_close_plus_7d(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        sess = _seed_session(db, tenant, state="closed", closed_days_ago=2)
        row = _seed_session_record(db, tenant, str(sess))

        total = _run(db, lambda s: store.expire_closed_session_records(s, now=NOW))
        assert total == 1

        expected = _closed_at(db, sess) + timedelta(days=7)
        assert _valid_until(db, row) == expected

    def test_active_session_row_untouched(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        sess = _seed_session(db, tenant, state="active")
        row = _seed_session_record(db, tenant, str(sess))

        total = _run(db, lambda s: store.expire_closed_session_records(s, now=NOW))
        assert total == 0
        assert _valid_until(db, row) is None

    def test_orphan_row_expires_at_created_plus_7d(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        # A valid UUID scope_ref that names no session, created 25h ago.
        row = _seed_session_record(db, tenant, str(uuid4()), created_days_ago=25 / 24)
        total = _run(db, lambda s: store.expire_closed_session_records(s, now=NOW))
        assert total == 1

        created = _scalar(
            db,
            "SELECT created_at FROM coord.memory_records WHERE memory_id = :m",
            m=row,
        )
        assert _valid_until(db, row) == created + timedelta(days=7)

    def test_recent_orphan_within_24h_untouched(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        row = _seed_session_record(db, tenant, str(uuid4()), created_days_ago=1 / 24)
        total = _run(db, lambda s: store.expire_closed_session_records(s, now=NOW))
        assert total == 0
        assert _valid_until(db, row) is None

    def test_malformed_scope_ref_is_orphan_and_never_raises(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        # A non-UUID scope_ref must not abort the ::uuid cast — it is
        # simply an orphan.
        row = _seed_session_record(db, tenant, "not-a-uuid", created_days_ago=2)
        total = _run(db, lambda s: store.expire_closed_session_records(s, now=NOW))
        assert total == 1

        created = _scalar(
            db,
            "SELECT created_at FROM coord.memory_records WHERE memory_id = :m",
            m=row,
        )
        assert _valid_until(db, row) == created + timedelta(days=7)

    def test_idempotent_second_run_is_noop(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        sess = _seed_session(db, tenant, state="closed", closed_days_ago=2)
        row = _seed_session_record(db, tenant, str(sess))

        assert _run(db, lambda s: store.expire_closed_session_records(s, now=NOW)) == 1
        first = _valid_until(db, row)
        assert _run(db, lambda s: store.expire_closed_session_records(s, now=NOW)) == 0
        assert _valid_until(db, row) == first
