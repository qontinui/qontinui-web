"""DB-backed tests for the runner-paid job queue (``coord.memory_jobs``).

Same pgvector-fixture posture as ``tests/test_memory_api_db.py`` (whose
DDL + client-side vector helper this reuses): runs against the shared
test PostgreSQL, SKIPS gracefully when Postgres or pgvector is
unavailable. The store never embeds and never calls an LLM — both are the
runner's to pay for (``2026-07-13-runner-paid-embedding``), so there is no
embedder to stub here.

Covers ``memory_store``'s job-queue DAL, across both kinds:

* enqueue dedupe by ``input_hash`` — including the 15-minute bridge tick
  re-enqueueing the same rows, which MUST be a no-op,
* ``kind`` scoping: the same target set under a different kind is a
  distinct job, and the claim's ``kinds`` filter actually filters,
* claim atomicity (two concurrent claims split the queue, no
  double-claim — ``FOR UPDATE SKIP LOCKED``),
* synthesis result → ``mental_model`` inserted (consolidated_from +
  members superseded) + job done,
* embedding result → vectors written onto the target rows + job done,
  and a malformed result (wrong vector count) leaves the job NOT done,
* failure path,
* the reaper (stale claim → pending + attempt bump; attempt>3 → failed),
* redaction applied to the synthesized text before insert.
"""

from __future__ import annotations

import asyncio
import json
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
from app.services.memory_vectors import EMBEDDING_MODEL_TAG
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import _SETUP_SQL, _client_vector, _exec, _scalar

NOW = datetime(2026, 7, 10, 12, 0, 0, tzinfo=UTC)

# The deployed tag — the only one this server accepts a vector under.
TAG = EMBEDDING_MODEL_TAG


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
            "DELETE FROM coord.memory_jobs",
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
    target_ids: list[UUID],
    *,
    kind: str = "synthesis",
    input_texts: list[str] | None = None,
    status: str = "pending",
    claimed_minutes_ago: float | None = None,
    attempt: int = 0,
) -> UUID:
    job_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_jobs
                (job_id, tenant_id, kind, target_ids, input_texts, status,
                 claimed_at, attempt, input_hash)
            VALUES
                (:job_id, :tenant, :kind, CAST(:target_ids AS uuid[]),
                 CAST(:input_texts AS jsonb), :status, :claimed_at,
                 :attempt, :hash)
            """
        ],
        job_id=job_id,
        tenant=tenant,
        kind=kind,
        target_ids=[str(m) for m in target_ids],
        input_texts=json.dumps(input_texts if input_texts is not None else ["a", "b"]),
        status=status,
        claimed_at=(
            NOW - timedelta(minutes=claimed_minutes_ago)
            if claimed_minutes_ago is not None
            else None
        ),
        attempt=attempt,
        # `kind` is part of the live-input dedupe key, so the same targets
        # under both kinds are still distinct rows. Targetless seeds get a
        # per-job hash so several can coexist in one test.
        hash=store.job_input_hash(target_ids) if target_ids else f"h-{job_id}",
    )
    return job_id


def _job_field(engine: AsyncEngine, job_id: UUID, column: str) -> Any:
    return _scalar(
        engine,
        f"SELECT {column} FROM coord.memory_jobs WHERE job_id = :j",
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
    def test_dedupe_by_input_hash(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = [uuid4(), uuid4(), uuid4()]
        cluster = store.synthesis_job_input(members, ["x", "y", "z"])
        # Same member set, reversed order — same hash → deduped.
        dup = store.synthesis_job_input(list(reversed(members)), ["z", "y", "x"])
        other = store.synthesis_job_input([uuid4(), uuid4()], ["p", "q"])

        first = _run(db, lambda s: store.enqueue_jobs(s, tenant, [cluster]))
        assert first == 1
        # Re-enqueue the same set + a genuinely new one → only the new one.
        second = _run(db, lambda s: store.enqueue_jobs(s, tenant, [dup, other]))
        assert second == 1

        count = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_jobs WHERE tenant_id = :t",
            t=tenant,
        )
        assert count == 2

    def test_repeated_bridge_tick_enqueue_is_a_noop(self, db: AsyncEngine) -> None:
        """The 15-minute cadence must not pile up duplicate work.

        ``memory_bridge_sync`` runs every 15 minutes and enqueues the rows
        it just landed. Simulate two ticks over the SAME rows: the second
        must insert nothing, or the queue would grow without bound between
        runner drains. This dedupe is load-bearing, not hygiene.
        """
        tenant = uuid4()
        rows = [(uuid4(), "bridged one"), (uuid4(), "bridged two")]

        tick1 = _run(
            db,
            lambda s: store.enqueue_jobs(
                s, tenant, [store.embedding_job_input(rows, model_tag=TAG)]
            ),
        )
        assert tick1 == 1

        tick2 = _run(
            db,
            lambda s: store.enqueue_jobs(
                s, tenant, [store.embedding_job_input(rows, model_tag=TAG)]
            ),
        )
        assert tick2 == 0

        assert (
            _scalar(
                db,
                "SELECT count(*) FROM coord.memory_jobs "
                "WHERE tenant_id = :t AND kind = 'embedding'",
                t=tenant,
            )
            == 1
        )

    def test_same_targets_under_different_kind_is_a_distinct_job(
        self, db: AsyncEngine
    ) -> None:
        # `kind` is IN the dedupe key: the same rows can carry both a
        # synthesis job and an embedding job.
        tenant = uuid4()
        ids = [uuid4(), uuid4()]
        inserted = _run(
            db,
            lambda s: store.enqueue_jobs(
                s,
                tenant,
                [
                    store.synthesis_job_input(ids, ["a", "b"]),
                    store.embedding_job_input(
                        [(ids[0], "a"), (ids[1], "b")], model_tag=TAG
                    ),
                ],
            ),
        )
        assert inserted == 2

    def test_failed_job_does_not_block_reenqueue(self, db: AsyncEngine) -> None:
        # A failed job sits OUTSIDE the partial index, so the same work can
        # be retried after a permanent failure.
        tenant = uuid4()
        members = [uuid4(), uuid4()]
        _exec(
            db,
            [
                """
                INSERT INTO coord.memory_jobs
                    (tenant_id, kind, target_ids, input_texts, status, input_hash)
                VALUES
                    (:tenant, 'synthesis', CAST(:ids AS uuid[]),
                     CAST('["a","b"]' AS jsonb), 'failed', :hash)
                """
            ],
            tenant=tenant,
            ids=[str(m) for m in members],
            hash=store.job_input_hash(members),
        )
        inserted = _run(
            db,
            lambda s: store.enqueue_jobs(
                s, tenant, [store.synthesis_job_input(members, ["a", "b"])]
            ),
        )
        assert inserted == 1

    def test_embedding_hash_is_tag_scoped(self, db: AsyncEngine) -> None:
        # A deployed-tag change must re-open the same rows for a fresh job
        # even though the earlier job is `done` — and `done` is INSIDE the
        # live dedupe index. Without this, the tag-drift class the reindex
        # sweep exists to heal would be permanently unhealable.
        tenant = uuid4()
        rows = [(uuid4(), "content")]
        _run(
            db,
            lambda s: store.enqueue_jobs(
                s, tenant, [store.embedding_job_input(rows, model_tag=TAG)]
            ),
        )
        again = _run(
            db,
            lambda s: store.enqueue_jobs(
                s,
                tenant,
                [store.embedding_job_input(rows, model_tag="some-new-model")],
            ),
        )
        assert again == 1


# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------


class TestClaim:
    def test_claim_returns_texts_and_flips_status(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [uuid4(), uuid4()])

        claimed = _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="runner-1"
            ),
        )
        assert len(claimed) == 1
        assert claimed[0].job_id == job_id
        assert claimed[0].input_texts == ["a", "b"]
        assert _job_field(db, job_id, "status") == "claimed"
        assert _job_field(db, job_id, "claimed_by") == "runner-1"

    def test_concurrent_claims_never_double_claim(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_ids = {_seed_job(db, tenant, [uuid4(), uuid4()]) for _ in range(4)}

        async def _go() -> tuple[list[UUID], list[UUID]]:
            maker = async_sessionmaker(db, class_=AsyncSession, expire_on_commit=False)
            async with maker() as s1, maker() as s2:
                r1, r2 = await asyncio.gather(
                    store.claim_jobs(
                        s1, tenant, limit=2, kinds=["synthesis"], worker="a"
                    ),
                    store.claim_jobs(
                        s2, tenant, limit=2, kinds=["synthesis"], worker="b"
                    ),
                )
                await s1.commit()
                await s2.commit()
            return [j.job_id for j in r1], [j.job_id for j in r2]

        got1, got2 = asyncio.run(_go())
        # No job appears in both claims, and every claimed job is real.
        assert set(got1).isdisjoint(set(got2))
        assert set(got1) | set(got2) <= job_ids

    def test_kinds_filter_excludes_other_kinds(self, db: AsyncEngine) -> None:
        # A runner declares what it can execute; it must never be handed a
        # kind it did not ask for.
        tenant = uuid4()
        synth = _seed_job(db, tenant, [uuid4()], kind="synthesis")
        embed = _seed_job(db, tenant, [uuid4()], kind="embedding")

        claimed = _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["embedding"], worker="r"
            ),
        )
        assert [j.job_id for j in claimed] == [embed]
        assert claimed[0].kind == "embedding"
        # The synthesis job was left alone for a runner that wants it.
        assert _job_field(db, synth, "status") == "pending"

    def test_claim_can_span_both_kinds(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _seed_job(db, tenant, [uuid4()], kind="synthesis")
        _seed_job(db, tenant, [uuid4()], kind="embedding")
        claimed = _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis", "embedding"], worker="r"
            ),
        )
        assert {j.kind for j in claimed} == {"synthesis", "embedding"}

    def test_claim_carries_target_ids(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        targets = [uuid4(), uuid4()]
        _seed_job(db, tenant, targets, kind="embedding")
        claimed = _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["embedding"], worker="r"
            ),
        )
        assert claimed[0].target_ids == targets


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
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
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
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
        )

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
        # The leaked secret also never lands in the job's stored result.
        assert "AKIAIOSFODNN7EXAMPLE" not in _job_field(
            db, job_id, "result->>'result_text'"
        )

    def test_result_without_embedding_stores_null(self, db: AsyncEngine) -> None:
        """The store NEVER embeds: no runner vector → a NULL-embedding
        mental_model that the reindex sweep will vectorize later."""
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [_seed_member(db, tenant, 0.5)])
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
        )
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
        with pytest.raises(store.JobNotClaimedError):
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
# Result — embedding
# ---------------------------------------------------------------------------


def _stored_vector(engine: AsyncEngine, memory_id: UUID) -> list[float]:
    """The row's pgvector, parsed back to floats ('[1,2,...]' -> [1.0, ...])."""
    raw = _scalar(
        engine,
        "SELECT embedding::text FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )
    return [float(x) for x in str(raw).strip("[]").split(",")]


def _seed_unvectorized(engine: AsyncEngine, tenant: UUID, content: str) -> UUID:
    """One live row with embedding = NULL (what the enqueuers now land)."""
    memory_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_records
                (memory_id, tenant_id, scope, kind, title, content,
                 content_hash, importance, created_at)
            VALUES
                (:memory_id, :tenant, 'tenant', 'reference', :title, :content,
                 :content_hash, 0.5, :created_at)
            """
        ],
        memory_id=memory_id,
        tenant=tenant,
        title="bridged",
        content=content,
        content_hash=f"hash-{memory_id}",
        created_at=NOW,
    )
    return memory_id


class TestEmbeddingResult:
    def _claimed_embedding_job(
        self, db: AsyncEngine, tenant: UUID, contents: list[str]
    ) -> tuple[UUID, list[UUID]]:
        targets = [_seed_unvectorized(db, tenant, c) for c in contents]
        job_id = _seed_job(db, tenant, targets, kind="embedding", input_texts=contents)
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["embedding"], worker="r"
            ),
        )
        return job_id, targets

    def test_vectors_written_onto_target_rows(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        contents = ["first content", "second content"]
        job_id, targets = self._claimed_embedding_job(db, tenant, contents)

        applied = _run(
            db,
            lambda s: store.record_embedding_result(
                s,
                tenant,
                job_id,
                embeddings=[_client_vector(c) for c in contents],
                embedding_model=TAG,
                now=NOW,
            ),
        )
        assert applied is True
        for target in targets:
            assert _row(db, target, "embedding") is not None
            assert _row(db, target, "embedding_model") == TAG
        assert _job_field(db, job_id, "status") == "done"
        assert _job_field(db, job_id, "finished_at") is not None

    def test_vectors_map_by_position(self, db: AsyncEngine) -> None:
        """``embeddings[i]`` lands on ``target_ids[i]`` — order IS the map."""
        tenant = uuid4()
        contents = ["alpha", "beta"]
        job_id, targets = self._claimed_embedding_job(db, tenant, contents)
        vectors = [_client_vector(c) for c in contents]

        _run(
            db,
            lambda s: store.record_embedding_result(
                s,
                tenant,
                job_id,
                embeddings=vectors,
                embedding_model=TAG,
                now=NOW,
            ),
        )
        # Each row carries the vector of ITS OWN content, not its
        # neighbour's. A transposition would pass a count-only assertion
        # while quietly poisoning the cosine arm, so compare the actual
        # stored vectors against the expected ones per row.
        for target, expected in zip(targets, vectors, strict=True):
            assert _stored_vector(db, target) == pytest.approx(expected, abs=1e-5)

    def test_wrong_vector_count_rejected_and_job_not_done(
        self, db: AsyncEngine
    ) -> None:
        # A short list would silently mis-map vectors onto rows. The job
        # stays `claimed` so the runner can still post a correct result.
        tenant = uuid4()
        contents = ["one", "two", "three"]
        job_id, targets = self._claimed_embedding_job(db, tenant, contents)

        with pytest.raises(store.JobResultShapeError):
            _run(
                db,
                lambda s: store.record_embedding_result(
                    s,
                    tenant,
                    job_id,
                    embeddings=[_client_vector("one")],
                    embedding_model=TAG,
                    now=NOW,
                ),
            )
        assert _job_field(db, job_id, "status") == "claimed"
        for target in targets:
            assert _row(db, target, "embedding") is None

    def test_synthesis_payload_against_embedding_job_rejected(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        job_id, _ = self._claimed_embedding_job(db, tenant, ["x"])
        with pytest.raises(store.JobKindMismatchError):
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
        assert _job_field(db, job_id, "status") == "claimed"

    def test_embedding_result_on_unclaimed_job_raises(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        target = _seed_unvectorized(db, tenant, "x")
        job_id = _seed_job(db, tenant, [target], kind="embedding", input_texts=["x"])
        with pytest.raises(store.JobNotClaimedError):
            _run(
                db,
                lambda s: store.record_embedding_result(
                    s,
                    tenant,
                    job_id,
                    embeddings=[_client_vector("x")],
                    embedding_model=TAG,
                    now=NOW,
                ),
            )
        assert _job_field(db, job_id, "status") == "pending"
        assert _row(db, target, "embedding") is None

    def test_embedding_result_unknown_job_returns_none(self, db: AsyncEngine) -> None:
        got = _run(
            db,
            lambda s: store.record_embedding_result(
                s,
                uuid4(),
                uuid4(),
                embeddings=[_client_vector("x")],
                embedding_model=TAG,
                now=NOW,
            ),
        )
        assert got is None


# ---------------------------------------------------------------------------
# Result — failure
# ---------------------------------------------------------------------------


class TestFailure:
    def test_failure_marks_job_failed(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [uuid4()])
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
        )
        ok = _run(
            db,
            lambda s: store.record_job_failure(s, tenant, job_id, "LLM refused"),
        )
        assert ok is True
        assert _job_field(db, job_id, "status") == "failed"
        assert _job_field(db, job_id, "result->>'failure'") == "LLM refused"
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
            lambda s: store.record_job_failure(s, tenant, uuid4(), "x"),
        )
        assert ok is False

    def test_failure_on_unclaimed_job_raises_not_claimed(self, db: AsyncEngine) -> None:
        # A failure posted for a still-pending job is rejected (→ 409); the
        # job stays pending for a later claim rather than being terminated.
        tenant = uuid4()
        job_id = _seed_job(db, tenant, [uuid4()])
        with pytest.raises(store.JobNotClaimedError):
            _run(
                db,
                lambda s: store.record_job_failure(s, tenant, job_id, "reason"),
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
        counts = _run(db, lambda s: store.reap_stale_claims(s, now=NOW))
        assert counts == {"requeued": 1, "failed": 0}
        assert _job_field(db, job_id, "status") == "pending"
        assert _job_field(db, job_id, "attempt") == 1
        assert _job_field(db, job_id, "claimed_at") is None

    def test_fresh_claim_not_reaped(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        job_id = _seed_job(
            db, tenant, [uuid4()], status="claimed", claimed_minutes_ago=5
        )
        counts = _run(db, lambda s: store.reap_stale_claims(s, now=NOW))
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
        counts = _run(db, lambda s: store.reap_stale_claims(s, now=NOW))
        assert counts == {"requeued": 0, "failed": 1}
        assert _job_field(db, job_id, "status") == "failed"
        assert _job_field(db, job_id, "attempt") == 4


class TestReaperIsNotBundledIntoDecay:
    """The reaper runs on its own frequent cadence, not the daily sweep.

    A claimed row is invisible to both sides of the queue (``claim_jobs``
    hands out only ``pending``; ``enqueue_jobs`` counts ``claimed`` as
    live), so the reaper is the queue's only self-healing path. While it
    was bundled into the daily ``memory_decay`` pass, a job abandoned by a
    halted runner stayed stranded for up to ~24h despite a 30-minute
    staleness bound.
    """

    def test_reap_once_requeues_stale_claim(self, db: AsyncEngine) -> None:
        from app.jobs.memory_lifecycle import reap_once

        tenant = uuid4()
        job_id = _seed_job(
            db, tenant, [uuid4()], status="claimed", claimed_minutes_ago=45
        )

        stats = _run(db, lambda s: reap_once(s, now=NOW))

        assert stats == {"requeued": 1, "failed": 0}
        assert _job_field(db, job_id, "status") == "pending"

    def test_decay_once_no_longer_reaps(self, db: AsyncEngine) -> None:
        from app.jobs.memory_lifecycle import decay_once

        tenant = uuid4()
        job_id = _seed_job(
            db, tenant, [uuid4()], status="claimed", claimed_minutes_ago=45
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))

        assert "synthesis_requeued" not in stats
        assert _job_field(db, job_id, "status") == "claimed"
