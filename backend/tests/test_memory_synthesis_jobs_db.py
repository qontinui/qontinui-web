"""DB-backed tests for the runner-paid synthesis-job flow (v1.1, Phase 2).

Same pgvector-fixture posture as ``tests/test_memory_api_db.py`` (whose
DDL + client-side vector helper this reuses): runs against the shared
test PostgreSQL, SKIPS gracefully when Postgres or pgvector is
unavailable. The store never embeds — the runner's vector is a parameter
(``2026-07-13-runner-paid-embedding`` Phase 1), so there is no embedder
to stub here.

Covers ``memory_store``'s synthesis-job DAL:

* enqueue dedupe by ``member_set_hash``,
* claim atomicity (two concurrent claims split the queue, no
  double-claim — ``FOR UPDATE SKIP LOCKED``),
* result → ``mental_model`` inserted (consolidated_from + members
  superseded) + job done,
* failure path,
* the reaper (stale claim → pending + attempt bump; attempt>3 → failed),
* redaction applied to result_text before insert.
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
from app.services.memory_embedder import EMBEDDING_MODEL_TAG
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import _SETUP_SQL, _client_vector, _exec, _scalar

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
            "DELETE FROM coord.memory_synthesis_jobs",
            "DELETE FROM coord.memory_records",
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


def _seed_member(engine: AsyncEngine, tenant: UUID, importance: float) -> UUID:
    """One live episode member row (embedding NULL — irrelevant here)."""
    memory_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_records
                (memory_id, tenant_id, scope, kind, title, content,
                 content_hash, importance, created_at)
            VALUES
                (:memory_id, :tenant, 'tenant', 'episode', :title, :content,
                 :content_hash, :importance, :created_at)
            """
        ],
        memory_id=memory_id,
        tenant=tenant,
        title="episode",
        content=f"episode content {memory_id}",
        content_hash=f"hash-{memory_id}",
        importance=importance,
        created_at=NOW,
    )
    return memory_id


def _seed_job(
    engine: AsyncEngine,
    tenant: UUID,
    member_ids: list[UUID],
    *,
    status: str = "pending",
    claimed_minutes_ago: float | None = None,
    attempt: int = 0,
) -> UUID:
    job_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_synthesis_jobs
                (job_id, tenant_id, member_ids, member_texts, status,
                 claimed_at, attempt, member_set_hash)
            VALUES
                (:job_id, :tenant, CAST(:member_ids AS uuid[]),
                 CAST(:member_texts AS jsonb), :status, :claimed_at,
                 :attempt, :hash)
            """
        ],
        job_id=job_id,
        tenant=tenant,
        member_ids=[str(m) for m in member_ids],
        member_texts='["a", "b"]',
        status=status,
        claimed_at=(
            NOW - timedelta(minutes=claimed_minutes_ago)
            if claimed_minutes_ago is not None
            else None
        ),
        attempt=attempt,
        hash=store.member_set_hash(member_ids) if member_ids else f"h-{job_id}",
    )
    return job_id


def _job_field(engine: AsyncEngine, job_id: UUID, column: str) -> Any:
    return _scalar(
        engine,
        f"SELECT {column} FROM coord.memory_synthesis_jobs WHERE job_id = :j",
        j=job_id,
    )


def _row(engine: AsyncEngine, memory_id: UUID, column: str) -> Any:
    return _scalar(
        engine,
        f"SELECT {column} FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )


# ---------------------------------------------------------------------------
# Enqueue
# ---------------------------------------------------------------------------


class TestEnqueue:
    def test_dedupe_by_member_set_hash(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = [uuid4(), uuid4(), uuid4()]
        cluster = store.SynthesisClusterInput(
            member_ids=members, member_texts=["x", "y", "z"]
        )
        # Same member set, reversed order — same hash → deduped.
        dup = store.SynthesisClusterInput(
            member_ids=list(reversed(members)), member_texts=["z", "y", "x"]
        )
        other = store.SynthesisClusterInput(
            member_ids=[uuid4(), uuid4()], member_texts=["p", "q"]
        )

        first = _run(db, lambda s: store.enqueue_synthesis_jobs(s, tenant, [cluster]))
        assert first == 1
        # Re-enqueue the same set + a genuinely new one → only the new one.
        second = _run(
            db, lambda s: store.enqueue_synthesis_jobs(s, tenant, [dup, other])
        )
        assert second == 1

        count = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_synthesis_jobs WHERE tenant_id = :t",
            t=tenant,
        )
        assert count == 2


# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------


class TestClaim:
    def test_claim_returns_texts_and_flips_status(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [uuid4(), uuid4()])

        claimed = _run(
            db,
            lambda s: store.claim_synthesis_jobs(s, tenant, limit=4, worker="runner-1"),
        )
        assert len(claimed) == 1
        assert claimed[0].job_id == job_id
        assert claimed[0].member_texts == ["a", "b"]
        assert _job_field(db, job_id, "status") == "claimed"
        assert _job_field(db, job_id, "claimed_by") == "runner-1"

    def test_concurrent_claims_never_double_claim(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_ids = {_seed_job(db, tenant, [uuid4(), uuid4()]) for _ in range(4)}

        async def _go() -> tuple[list[UUID], list[UUID]]:
            maker = async_sessionmaker(db, class_=AsyncSession, expire_on_commit=False)
            async with maker() as s1, maker() as s2:
                r1, r2 = await asyncio.gather(
                    store.claim_synthesis_jobs(s1, tenant, limit=2, worker="a"),
                    store.claim_synthesis_jobs(s2, tenant, limit=2, worker="b"),
                )
                await s1.commit()
                await s2.commit()
            return [j.job_id for j in r1], [j.job_id for j in r2]

        got1, got2 = asyncio.run(_go())
        # No job appears in both claims, and every claimed job is real.
        assert set(got1).isdisjoint(set(got2))
        assert set(got1) | set(got2) <= job_ids


# ---------------------------------------------------------------------------
# Result — success
# ---------------------------------------------------------------------------


class TestResult:
    def test_result_inserts_mental_model_and_supersedes(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = [
            _seed_member(db, tenant, 0.5),
            _seed_member(db, tenant, 0.6),
            _seed_member(db, tenant, 0.7),
        ]
        job_id = _seed_job(db, tenant, members)
        _run(
            db,
            lambda s: store.claim_synthesis_jobs(s, tenant, limit=4, worker="r"),
        )

        new_id = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                tenant,
                job_id,
                "Distilled model\nsecond line",
                embedding=_client_vector("Distilled model second line"),
                embedding_model=EMBEDDING_MODEL_TAG,
                now=NOW,
            ),
        )
        assert new_id is not None

        assert _row(db, new_id, "kind") == "mental_model"
        assert _row(db, new_id, "title") == "Distilled model"
        # best member 0.7 + 0.1 bonus.
        assert float(_row(db, new_id, "importance")) == pytest.approx(0.8, abs=1e-6)
        assert _row(db, new_id, "source->>'synthesis_job'") == str(job_id)
        assert _row(db, new_id, "embedding") is not None
        consolidated_from = _row(db, new_id, "consolidated_from")
        assert {UUID(str(u)) for u in consolidated_from} == set(members)

        for member in members:
            assert _row(db, member, "superseded_by") == new_id
            assert _row(db, member, "valid_until") is not None

        assert _job_field(db, job_id, "status") == "done"
        assert _job_field(db, job_id, "finished_at") is not None

    def test_result_redacts_secrets_before_insert(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = [_seed_member(db, tenant, 0.5)]
        job_id = _seed_job(db, tenant, members)
        _run(db, lambda s: store.claim_synthesis_jobs(s, tenant, limit=4, worker="r"))

        new_id = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                tenant,
                job_id,
                "Model referencing AKIAIOSFODNN7EXAMPLE key",
                embedding=_client_vector("Model referencing a key"),
                embedding_model=EMBEDDING_MODEL_TAG,
                now=NOW,
            ),
        )
        assert new_id is not None
        stored = _row(db, new_id, "content")
        assert "AKIAIOSFODNN7EXAMPLE" not in stored
        assert "[REDACTED:aws_key]" in stored
        # The failed/leaked secret also never lands in the job's result_text.
        assert "AKIAIOSFODNN7EXAMPLE" not in _job_field(db, job_id, "result_text")

    def test_result_without_embedding_stores_null(self, db: AsyncEngine) -> None:
        """The store NEVER embeds: no runner vector → a NULL-embedding
        mental_model that the reindex sweep will vectorize later."""
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [_seed_member(db, tenant, 0.5)])
        _run(db, lambda s: store.claim_synthesis_jobs(s, tenant, limit=4, worker="r"))
        new_id = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                tenant,
                job_id,
                "An unvectorized distilled model",
                embedding=None,
                embedding_model=None,
                now=NOW,
            ),
        )
        assert new_id is not None
        assert _row(db, new_id, "embedding") is None
        assert _row(db, new_id, "embedding_model") is None

    def test_result_unknown_job_returns_none(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        got = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                tenant,
                uuid4(),
                "text",
                embedding=None,
                embedding_model=None,
                now=NOW,
            ),
        )
        assert got is None

    def test_result_cross_tenant_job_returns_none(self, db: AsyncEngine) -> None:
        owner, other = uuid4(), uuid4()
        job_id = _seed_job(db, owner, [uuid4()])
        got = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                other,
                job_id,
                "text",
                embedding=None,
                embedding_model=None,
                now=NOW,
            ),
        )
        assert got is None
        assert _job_field(db, job_id, "status") == "pending"

    def test_result_on_unclaimed_job_raises_not_claimed(self, db: AsyncEngine) -> None:
        # A result on a job that was never claimed (still pending) is
        # rejected — the endpoint maps this to 409, and no mental_model is
        # created / no member is superseded.
        tenant = uuid4()
        member = _seed_member(db, tenant, 0.5)
        job_id = _seed_job(db, tenant, [member])
        with pytest.raises(store.SynthesisJobNotClaimedError):
            _run(
                db,
                lambda s: store.record_synthesis_result(
                    s,
                    tenant,
                    job_id,
                    "text",
                    embedding=None,
                    embedding_model=None,
                    now=NOW,
                ),
            )
        assert _job_field(db, job_id, "status") == "pending"
        assert _row(db, member, "superseded_by") is None


# ---------------------------------------------------------------------------
# Result — failure
# ---------------------------------------------------------------------------


class TestFailure:
    def test_failure_marks_job_failed(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [uuid4()])
        _run(db, lambda s: store.claim_synthesis_jobs(s, tenant, limit=4, worker="r"))
        ok = _run(
            db,
            lambda s: store.record_synthesis_failure(s, tenant, job_id, "LLM refused"),
        )
        assert ok is True
        assert _job_field(db, job_id, "status") == "failed"
        assert _job_field(db, job_id, "result_text") == "LLM refused"
        assert (
            _scalar(
                db,
                "SELECT count(*) FROM coord.memory_records "
                "WHERE tenant_id = :t AND kind = 'mental_model'",
                t=tenant,
            )
            == 0
        )

    def test_failure_unknown_job_returns_false(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        ok = _run(
            db,
            lambda s: store.record_synthesis_failure(s, tenant, uuid4(), "x"),
        )
        assert ok is False

    def test_failure_on_unclaimed_job_raises_not_claimed(self, db: AsyncEngine) -> None:
        # A failure posted for a still-pending job is rejected (→ 409); the
        # job stays pending for a later claim rather than being terminated.
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [uuid4()])
        with pytest.raises(store.SynthesisJobNotClaimedError):
            _run(
                db,
                lambda s: store.record_synthesis_failure(s, tenant, job_id, "reason"),
            )
        assert _job_field(db, job_id, "status") == "pending"


# ---------------------------------------------------------------------------
# Reaper
# ---------------------------------------------------------------------------


class TestReaper:
    def test_stale_claim_requeued_with_attempt_bump(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(
            db, tenant, [uuid4()], status="claimed", claimed_minutes_ago=45
        )
        counts = _run(db, lambda s: store.reap_stale_synthesis_claims(s, now=NOW))
        assert counts == {"requeued": 1, "failed": 0}
        assert _job_field(db, job_id, "status") == "pending"
        assert _job_field(db, job_id, "attempt") == 1
        assert _job_field(db, job_id, "claimed_at") is None

    def test_fresh_claim_not_reaped(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(
            db, tenant, [uuid4()], status="claimed", claimed_minutes_ago=5
        )
        counts = _run(db, lambda s: store.reap_stale_synthesis_claims(s, now=NOW))
        assert counts == {"requeued": 0, "failed": 0}
        assert _job_field(db, job_id, "status") == "claimed"

    def test_exhausted_attempts_become_failed(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        # attempt=3: the next reap makes attempt 4 (> max 3) → failed.
        job_id = _seed_job(
            db,
            tenant,
            [uuid4()],
            status="claimed",
            claimed_minutes_ago=45,
            attempt=3,
        )
        counts = _run(db, lambda s: store.reap_stale_synthesis_claims(s, now=NOW))
        assert counts == {"requeued": 0, "failed": 1}
        assert _job_field(db, job_id, "status") == "failed"
        assert _job_field(db, job_id, "attempt") == 4
