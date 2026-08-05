"""DB-backed tests for the memory lifecycle sweeps (Phase 4).

Same pgvector fixture posture as ``tests/test_memory_api_db.py`` (whose
DDL this module reuses): runs against the shared test PostgreSQL, SKIPS
gracefully when Postgres or pgvector is unavailable. Nothing under test
loads an embedding model any more, so there is no embedder to stub —
vectors are seeded directly and the sweeps only ENQUEUE
(``2026-07-13-runner-paid-embedding`` Phase 2). Covers:

* SQL/Python agreement of the decay retention-score formula,
* the decay invalidate sweep + the grace-period prune,
* near-duplicate merge (fold, threshold, tenant isolation),
* the ``source.lifecycle_hold`` exclusion on BOTH supersede paths, each
  with its unheld positive control — including the in-flight arm, where
  a synthesis job enqueued BEFORE the flag was set still cannot end the
  row when its result lands,
* the same hold on BOTH decay halves — invalidate (hides the row) and
  prune (DELETES it), the latter standing on its own for rows superseded
  before the hold was applied,
* consolidation ENQUEUEING synthesis jobs (dedupe on re-run),
* reindex-on-model-bump ENQUEUEING embedding jobs for stale-tag + NULL
  rows rather than embedding them.
"""

from __future__ import annotations

import asyncio
import json
import math
from collections.abc import Awaitable, Callable, Generator
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.jobs.memory_lifecycle import consolidate_tenant, decay_once, reindex_once
from app.services import memory_store as store
from app.services.memory_lifecycle import job_input_hash, retention_score
from app.services.memory_vectors import EMBEDDING_DIM, EMBEDDING_MODEL_TAG
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
            "DELETE FROM coord.memory_jobs",
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
            "DELETE FROM coord.sessions",
        ],
    )
    yield memory_engine


def _run[T](engine: AsyncEngine, fn: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run an async store/task core against a fresh committed session."""

    async def _go() -> T:
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as session:
            result = await fn(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def _axis(i: int) -> list[float]:
    v = [0.0] * EMBEDDING_DIM
    v[i] = 1.0
    return v


def _blend(base: int, other: int, w: float) -> list[float]:
    """Unit vector with cosine ``w`` to ``_axis(base)``."""
    v = [0.0] * EMBEDDING_DIM
    v[base] = w
    v[other] = math.sqrt(1.0 - w * w)
    return v


def _seed(
    engine: AsyncEngine,
    tenant_id: UUID,
    *,
    content: str,
    kind: str = "fact",
    importance: float = 0.5,
    access_count: int = 0,
    age_days: float = 0.0,
    last_accessed_days: float | None = None,
    embedding: list[float] | None = None,
    embedding_model: str | None = EMBEDDING_MODEL_TAG,
    valid_until_days_ago: float | None = None,
    is_tombstone: bool = False,
    superseded_by: UUID | None = None,
    source: dict[str, Any] | None = None,
) -> UUID:
    """Insert one row with full control over lifecycle-relevant columns."""
    memory_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_records
                (memory_id, tenant_id, scope, kind, title, content,
                 content_hash, embedding, embedding_model, importance,
                 access_count, last_accessed_at, valid_until,
                 superseded_by, is_tombstone, source, created_at)
            VALUES
                (:memory_id, :tenant_id, 'tenant', :kind, :title, :content,
                 :content_hash, CAST(:embedding AS vector), :embedding_model,
                 :importance, :access_count, :last_accessed_at, :valid_until,
                 :superseded_by, :is_tombstone, CAST(:source AS jsonb),
                 :created_at)
            """
        ],
        memory_id=memory_id,
        tenant_id=tenant_id,
        kind=kind,
        title=content[:40],
        content=content,
        content_hash=f"hash-{memory_id}",
        embedding=store.format_pgvector(embedding) if embedding else None,
        embedding_model=embedding_model,
        importance=importance,
        access_count=access_count,
        last_accessed_at=(
            NOW - timedelta(days=last_accessed_days)
            if last_accessed_days is not None
            else None
        ),
        valid_until=(
            NOW - timedelta(days=valid_until_days_ago)
            if valid_until_days_ago is not None
            else None
        ),
        superseded_by=superseded_by,
        is_tombstone=is_tombstone,
        source=json.dumps(source or {}),
        created_at=NOW - timedelta(days=age_days),
    )
    return memory_id


def _row(engine: AsyncEngine, memory_id: UUID, column: str) -> Any:
    return _scalar(
        engine,
        f"SELECT {column} FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )


def _exists(engine: AsyncEngine, memory_id: UUID) -> bool:
    count = _scalar(
        engine,
        "SELECT count(*) FROM coord.memory_records WHERE memory_id = :m",
        m=memory_id,
    )
    return bool(count == 1)


async def _consolidate_for(tenant_id: UUID, session: AsyncSession) -> dict[str, int]:
    """Partial-friendly wrapper: consolidate one tenant at NOW."""
    return await consolidate_tenant(session, tenant_id, now=NOW)


# ---------------------------------------------------------------------------
# Decay
# ---------------------------------------------------------------------------


class TestDecayScoreAgreement:
    def test_sql_and_python_scores_agree_on_seeded_rows(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        cases = [
            # (importance, age_days, access_count, last_accessed_days)
            (0.9, 1.0, 0, None),
            (0.5, 720.0, 0, None),
            (0.5, 400.0, 20, None),
            (0.2, 100.0, 5, None),
            # Accessed row: age measured against last_accessed_at.
            (0.7, 500.0, 3, 50.0),
        ]
        expected: dict[UUID, float] = {}
        for importance, age_days, access_count, last_accessed_days in cases:
            memory_id = _seed(
                db,
                tenant,
                content=f"row {uuid4()}",
                importance=importance,
                age_days=age_days,
                access_count=access_count,
                last_accessed_days=last_accessed_days,
            )
            effective_age = (
                last_accessed_days if last_accessed_days is not None else age_days
            )
            expected[memory_id] = retention_score(
                importance, effective_age, access_count
            )

        sql_scores = _run(
            db, lambda s: store.compute_retention_scores(s, tenant, now=NOW)
        )
        assert set(sql_scores) == set(expected)
        for memory_id, want in expected.items():
            # importance is REAL (float4) in PG — allow its precision.
            assert sql_scores[memory_id] == pytest.approx(want, rel=1e-5)


class TestDecaySweep:
    def test_old_row_invalidated_not_deleted(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        stale = _seed(db, tenant, content="stale", importance=0.5, age_days=720)
        fresh = _seed(db, tenant, content="fresh", importance=0.9, age_days=1)

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["invalidated"] == 1
        assert stats["pruned"] == 0

        assert _exists(db, stale)  # invisible, NOT deleted
        assert _row(db, stale, "valid_until") is not None
        assert _row(db, stale, "is_tombstone") is False
        assert _row(db, stale, "source->>'decayed_at'") is not None
        assert _row(db, fresh, "valid_until") is None

    def test_accessed_twin_outlives_unaccessed(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        unaccessed = _seed(db, tenant, content="twin a", importance=0.5, age_days=400)
        accessed = _seed(
            db,
            tenant,
            content="twin b",
            importance=0.5,
            age_days=400,
            access_count=20,
            last_accessed_days=400.0,
        )
        _run(db, lambda s: decay_once(s, now=NOW))
        assert _row(db, unaccessed, "valid_until") is not None
        assert _row(db, accessed, "valid_until") is None

    def test_prune_requires_grace_and_terminal_marker(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        decayed_old = _seed(
            db,
            tenant,
            content="decayed old",
            valid_until_days_ago=100,
            source={"decayed_at": "2026-03-01T00:00:00+00:00"},
        )
        decayed_recent = _seed(
            db,
            tenant,
            content="decayed recent",
            valid_until_days_ago=10,
            source={"decayed_at": "2026-06-30T00:00:00+00:00"},
        )
        # Explicit (user-set) valid_until, no terminal marker: never pruned.
        temporal_only = _seed(
            db, tenant, content="temporal only", valid_until_days_ago=100
        )
        tombstoned_old = _seed(
            db,
            tenant,
            content="tombstoned old",
            valid_until_days_ago=100,
            is_tombstone=True,
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["pruned"] == 2
        assert not _exists(db, decayed_old)
        assert not _exists(db, tombstoned_old)
        assert _exists(db, decayed_recent)
        assert _exists(db, temporal_only)

    def test_prune_clears_inbound_supersede_refs(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        victim = _seed(
            db,
            tenant,
            content="victim",
            valid_until_days_ago=100,
            is_tombstone=True,
        )
        # Recently-superseded row pointing at the victim: inside grace,
        # so it survives — with its dangling ref cleared.
        referrer = _seed(
            db,
            tenant,
            content="referrer",
            valid_until_days_ago=10,
            superseded_by=victim,
        )
        _run(db, lambda s: decay_once(s, now=NOW))
        assert not _exists(db, victim)
        assert _exists(db, referrer)
        assert _row(db, referrer, "superseded_by") is None


# ---------------------------------------------------------------------------
# Consolidation — near-duplicate merge
# ---------------------------------------------------------------------------


class TestNearDupMerge:
    def test_merges_above_threshold_and_folds(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        # cosine(strong, weak) = 0.99^2 = 0.9801 > 0.95
        strong = _seed(
            db,
            tenant,
            content="strong dup",
            importance=0.8,
            access_count=3,
            embedding=_blend(0, 1, 0.99),
        )
        weak = _seed(
            db,
            tenant,
            content="weak dup",
            importance=0.5,
            access_count=2,
            age_days=1,
            embedding=_blend(0, 2, 0.99),
        )
        unrelated = _seed(db, tenant, content="unrelated", embedding=_axis(5))

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 1

        assert _row(db, weak, "superseded_by") == strong
        assert _row(db, weak, "valid_until") is not None
        assert float(_row(db, strong, "importance")) == pytest.approx(0.8)
        assert _row(db, strong, "access_count") == 5
        assert _row(db, strong, "superseded_by") is None
        assert _row(db, unrelated, "superseded_by") is None

    def test_below_threshold_pair_untouched(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        # cosine = 0.9^2 = 0.81 < 0.95
        a = _seed(db, tenant, content="a", embedding=_blend(0, 1, 0.9))
        b = _seed(db, tenant, content="b", embedding=_blend(0, 2, 0.9))
        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 0
        assert _row(db, a, "superseded_by") is None
        assert _row(db, b, "superseded_by") is None

    def test_cross_tenant_pairs_never_merge(self, db: AsyncEngine) -> None:
        tenant_a, tenant_b = uuid4(), uuid4()
        a = _seed(db, tenant_a, content="same", embedding=_blend(0, 1, 0.99))
        b = _seed(db, tenant_b, content="same", embedding=_blend(0, 2, 0.99))
        for tenant in (tenant_a, tenant_b):
            stats = _run(db, partial(_consolidate_for, tenant))
            assert stats["merges"] == 0
        assert _row(db, a, "superseded_by") is None
        assert _row(db, b, "superseded_by") is None

    def test_different_kind_pairs_never_merge(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        a = _seed(db, tenant, content="a", kind="fact", embedding=_blend(0, 1, 0.99))
        b = _seed(db, tenant, content="b", kind="rule", embedding=_blend(0, 2, 0.99))
        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 0
        assert _row(db, a, "superseded_by") is None
        assert _row(db, b, "superseded_by") is None


# ---------------------------------------------------------------------------
# Consolidation — synthesis-job enqueue (backend clusters, runner synthesizes)
# ---------------------------------------------------------------------------


def _seed_episode_cluster(db: AsyncEngine, tenant: UUID) -> list[UUID]:
    """Five episodes pairwise ~0.865 similar (>0.80 cluster, <0.95 dup)."""
    return [
        _seed(
            db,
            tenant,
            content=f"episode number {i}",
            kind="episode",
            importance=0.4 + i * 0.05,  # max member importance = 0.6
            age_days=float(30 - i),
            embedding=_blend(0, i + 1, 0.93),
        )
        for i in range(5)
    ]


def _job_rows(db: AsyncEngine, tenant: UUID) -> list[dict[str, Any]]:
    async def _go() -> list[dict[str, Any]]:
        async with db.connect() as conn:
            rows = await conn.execute(
                text(
                    "SELECT job_id, kind, target_ids, input_texts, status, "
                    "input_hash FROM coord.memory_jobs "
                    "WHERE tenant_id = :t"
                ),
                {"t": tenant},
            )
            return [dict(r) for r in rows.mappings()]

    return asyncio.run(_go())


class TestConsolidationEnqueue:
    def test_cluster_enqueues_one_pending_job(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_episode_cluster(db, tenant)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["clusters"] == 1
        assert stats["enqueued"] == 1

        jobs = _job_rows(db, tenant)
        assert len(jobs) == 1
        job = jobs[0]
        assert job["status"] == "pending"
        assert {UUID(str(m)) for m in job["target_ids"]} == set(members)
        assert len(job["input_texts"]) == 5
        assert job["kind"] == "synthesis"
        assert job["input_hash"] == job_input_hash(members)

        # Synthesis is deferred to the runner: no mental_model yet, and
        # the members are still live (not superseded).
        assert (
            _scalar(
                db,
                "SELECT count(*) FROM coord.memory_records "
                "WHERE tenant_id = :t AND kind = 'mental_model'",
                t=tenant,
            )
            == 0
        )
        for member in members:
            assert _row(db, member, "superseded_by") is None
            assert _row(db, member, "valid_until") is None

    def test_reconsolidation_is_deduped(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _seed_episode_cluster(db, tenant)

        first = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert first["enqueued"] == 1
        second = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        # Same cluster, live job already present → input_hash dedupe.
        assert second["clusters"] == 1
        assert second["enqueued"] == 0
        assert len(_job_rows(db, tenant)) == 1


# ---------------------------------------------------------------------------
# Lifecycle hold — records withheld from automatic consolidation
# ---------------------------------------------------------------------------
#
# `source.lifecycle_hold = true` takes one record out of every automatic
# supersede path while a human adjudicates it. Two independent paths can
# supersede a row, so each class below pairs its held assertion with an
# UNHELD positive control on identical geometry: without that control the
# held test would pass vacuously against a no-op fix (or against rows that
# were never candidates in the first place).

HELD: dict[str, Any] = {"lifecycle_hold": True}
RELEASED: dict[str, Any] = {"lifecycle_hold": False}


def _seed_dup_pair(
    db: AsyncEngine,
    tenant: UUID,
    *,
    source_a: dict[str, Any] | None = None,
    source_b: dict[str, Any] | None = None,
) -> tuple[UUID, UUID]:
    """Two ``observation`` rows at cosine 0.99^2 = 0.9801 (> the 0.95 dup bar).

    Same geometry and same fold ordering as
    ``TestNearDupMerge.test_merges_above_threshold_and_folds``: ``a`` is
    the survivor (higher importance + access), ``b`` the loser.
    """
    a = _seed(
        db,
        tenant,
        content="sidecar winner",
        kind="observation",
        importance=0.8,
        access_count=3,
        embedding=_blend(0, 1, 0.99),
        source=source_a,
    )
    b = _seed(
        db,
        tenant,
        content="sidecar loser",
        kind="observation",
        importance=0.5,
        access_count=2,
        age_days=1,
        embedding=_blend(0, 2, 0.99),
        source=source_b,
    )
    return a, b


def _assert_live(db: AsyncEngine, *memory_ids: UUID) -> None:
    for memory_id in memory_ids:
        assert _row(db, memory_id, "superseded_by") is None
        assert _row(db, memory_id, "valid_until") is None


class TestLifecycleHoldNearDup:
    """Path 1 — ``find_near_duplicate_pairs`` → ``apply_merge`` (1 per pair)."""

    def test_held_pair_survives_the_merge(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        a, b = _seed_dup_pair(db, tenant, source_a=HELD, source_b=HELD)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["candidate_pairs"] == 0
        assert stats["merges"] == 0
        _assert_live(db, a, b)

    def test_unheld_pair_collapses(self, db: AsyncEngine) -> None:
        """Positive control: the identical geometry, no flag → one dies."""
        tenant = uuid4()
        a, b = _seed_dup_pair(db, tenant)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 1
        assert _row(db, b, "superseded_by") == a
        assert _row(db, b, "valid_until") is not None
        assert _row(db, a, "superseded_by") is None

    def test_holding_either_join_side_protects_the_pair(self, db: AsyncEngine) -> None:
        """The predicate is on BOTH join sides, addressed by JOIN ORDER.

        Which seeded row is SQL-``a`` and which is SQL-``b`` is decided by
        ``b.memory_id > a.memory_id`` over random ``uuid4()``s — NOT by
        the importance ordering this suite otherwise picks rows with. So
        holding "the winner" then "the loser" does not reliably exercise
        both arms: it lands on whichever side the shuffle put them, and a
        fix applied to only ONE arm passes ~25% of runs (measured: 1 of 12
        silent passes against a neutered ``b.`` arm).

        Sorting the ids and holding ``min`` in one arm and ``max`` in the
        other pins the hold to a known join side every run, so a
        half-applied predicate fails 100% of the time.
        """
        for hold_the_max in (False, True):
            tenant = uuid4()
            a, b = _seed_dup_pair(db, tenant)
            lo, hi = sorted((a, b))
            # lo is SQL-`a` (the join's left side), hi is SQL-`b`.
            _set_hold(db, hi if hold_the_max else lo)

            stats = _run(db, partial(_consolidate_for, tenant))
            assert stats["candidate_pairs"] == 0, (
                f"held join side {'b' if hold_the_max else 'a'} still paired"
            )
            assert stats["merges"] == 0
            _assert_live(db, a, b)

    def test_explicit_false_is_not_held(self, db: AsyncEngine) -> None:
        """``lifecycle_hold: false`` records "adjudicated and released"."""
        tenant = uuid4()
        a, b = _seed_dup_pair(db, tenant, source_a=RELEASED, source_b=RELEASED)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 1
        assert _row(db, b, "superseded_by") == a

    def test_uppercase_true_is_held(self, db: AsyncEngine) -> None:
        """``"True"`` holds too — the comparison is case-insensitive.

        There is no API for setting this flag: every hold is applied by
        hand-written SQL, so Python-cased ``"True"`` is a likely value. A
        case-sensitive comparison would leave that record fully
        collectable while reading, to the person who typed it, as held.
        """
        tenant = uuid4()
        upper: dict[str, Any] = {"lifecycle_hold": "True"}
        a, b = _seed_dup_pair(db, tenant, source_a=upper, source_b=None)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 0
        _assert_live(db, a, b)

    def test_malformed_hold_value_fails_open_and_never_aborts(
        self, db: AsyncEngine
    ) -> None:
        """A junk value must not raise — the whole sweep rides on it.

        A ``::boolean`` cast would raise on ``"yes"`` and take down the
        consolidation pass for EVERY tenant; the text comparison cannot
        throw, so the sweep completes and the record merely stays
        eligible (fails open).
        """
        tenant = uuid4()
        junk: dict[str, Any] = {"lifecycle_hold": "yes"}
        a, b = _seed_dup_pair(db, tenant, source_a=junk, source_b=junk)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["merges"] == 1
        assert _row(db, b, "superseded_by") == a


def _seed_hold_cluster(
    db: AsyncEngine,
    tenant: UUID,
    *,
    held: set[int],
    hold_source: dict[str, Any] | None = None,
) -> list[UUID]:
    """``_seed_episode_cluster`` geometry, with a hold on ``held`` indices."""
    return [
        _seed(
            db,
            tenant,
            content=f"episode number {i}",
            kind="episode",
            importance=0.4 + i * 0.05,
            age_days=float(30 - i),
            embedding=_blend(0, i + 1, 0.93),
            source=(hold_source if hold_source is not None else HELD)
            if i in held
            else None,
        )
        for i in range(5)
    ]


class TestLifecycleHoldClustering:
    """Path 2 — ``fetch_cluster_candidates`` (the DOMINANT one: N-1/cluster).

    Supersession here is deferred: the runner posts a synthesis result and
    ``supersede_many`` ends exactly the job's ``target_ids``. So keeping a
    held row out of the candidate set — and therefore out of every job's
    ``target_ids`` — is what makes it unreachable by this path at all.
    """

    def test_held_rows_never_reach_the_candidate_set(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_hold_cluster(db, tenant, held=set(range(5)))

        candidates = _run(
            db,
            lambda s: store.fetch_cluster_candidates(s, tenant, now=NOW, limit=1000),
        )
        assert candidates == []

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["cluster_candidates"] == 0
        assert stats["clusters"] == 0
        assert stats["enqueued"] == 0
        assert _job_rows(db, tenant) == []
        _assert_live(db, *members)

    def test_unheld_cluster_still_enqueues(self, db: AsyncEngine) -> None:
        """Positive control: identical geometry, no flag → a job appears."""
        tenant = uuid4()
        members = _seed_hold_cluster(db, tenant, held=set())

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["cluster_candidates"] == 5
        assert stats["clusters"] == 1
        assert stats["enqueued"] == 1
        jobs = _job_rows(db, tenant)
        assert {UUID(str(m)) for m in jobs[0]["target_ids"]} == set(members)

    def test_held_members_are_omitted_from_the_synthesis_job(
        self, db: AsyncEngine
    ) -> None:
        """A partial hold shrinks the cluster; it does not cancel it."""
        tenant = uuid4()
        members = _seed_hold_cluster(db, tenant, held={0, 1})

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["cluster_candidates"] == 3
        assert stats["clusters"] == 1
        assert stats["enqueued"] == 1

        jobs = _job_rows(db, tenant)
        targets = {UUID(str(m)) for m in jobs[0]["target_ids"]}
        assert targets == set(members[2:])
        # `supersede_many` only ever ends rows named in a job's target_ids,
        # so the held pair is unreachable by this path.
        assert targets.isdisjoint(members[:2])
        _assert_live(db, *members[:2])

    def test_explicit_false_is_not_held(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_hold_cluster(
            db, tenant, held=set(range(5)), hold_source=RELEASED
        )

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["cluster_candidates"] == 5
        assert stats["clusters"] == 1
        jobs = _job_rows(db, tenant)
        assert {UUID(str(m)) for m in jobs[0]["target_ids"]} == set(members)


def _set_hold(db: AsyncEngine, memory_id: UUID, held: bool = True) -> None:
    """Flip ``source.lifecycle_hold`` on one existing row (post-seed)."""
    _exec(
        db,
        [
            """
            UPDATE coord.memory_records
            SET source = COALESCE(source, '{}'::jsonb)
                         || jsonb_build_object(
                                'lifecycle_hold', CAST(:held AS boolean))
            WHERE memory_id = :m
            """
        ],
        m=memory_id,
        held=held,
    )


class TestLifecycleHoldInFlightSynthesis:
    """The race: a synthesis job already enqueued when the hold is set.

    ``fetch_cluster_candidates`` only keeps a held row out of NEW
    clusters. Consolidation enqueues every 10 minutes, so at the moment a
    hold is set there is almost always a ``pending``/``claimed`` job whose
    ``target_ids`` already name the row. ``supersede_many`` re-checks the
    hold so that job cannot end it — otherwise the hold would read as
    protection while silently failing inside its race window.
    """

    def test_enqueued_job_cannot_supersede_a_later_held_member(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        # 1. Seed + enqueue with every member UNHELD (so the job's
        #    target_ids name all five, exactly as in production).
        members = _seed_hold_cluster(db, tenant, held=set())
        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["enqueued"] == 1
        job_id = UUID(str(_job_rows(db, tenant)[0]["job_id"]))
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
        )

        # 2. Hold one member AFTER the job exists and is claimed.
        held = members[0]
        _set_hold(db, held)
        assert {UUID(str(m)) for m in _job_rows(db, tenant)[0]["target_ids"]} == set(
            members
        ), "the in-flight job still names the held member"

        # 3. The runner posts its result against that stale target set.
        new_id = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                tenant,
                job_id,
                "Distilled model for the cluster",
                embedding=None,
                embedding_model=None,
                now=NOW,
            ),
        )

        # The synthesis itself is NOT cancelled: the mental_model lands and
        # the unheld members are superseded by it. `consolidated_from` is
        # provenance, not an exclusivity claim, so it may cite the still-
        # live held row — that is the pre-supersession state, and it
        # self-corrects when the hold is released.
        assert new_id is not None
        assert _row(db, new_id, "kind") == "mental_model"
        for member in members[1:]:
            assert _row(db, member, "superseded_by") == new_id
            assert _row(db, member, "valid_until") is not None

        # The held member survives its own already-enqueued job.
        _assert_live(db, held)

    def test_released_member_is_still_superseded_by_an_inflight_job(
        self, db: AsyncEngine
    ) -> None:
        """Positive control: identical flow, ``lifecycle_hold: false``."""
        tenant = uuid4()
        members = _seed_hold_cluster(db, tenant, held=set())
        _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        job_id = UUID(str(_job_rows(db, tenant)[0]["job_id"]))
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
        )
        _set_hold(db, members[0], held=False)

        new_id = _run(
            db,
            lambda s: store.record_synthesis_result(
                s,
                tenant,
                job_id,
                "Distilled model for the cluster",
                embedding=None,
                embedding_model=None,
                now=NOW,
            ),
        )
        assert new_id is not None
        for member in members:
            assert _row(db, member, "superseded_by") == new_id


class TestLifecycleHoldDecay:
    """Decay — the only sweeps that can PERMANENTLY destroy a held record.

    ``decay_once`` is fully automatic (``cron="10 3 * * *"``). Its two
    halves are gated independently because they fail differently: an
    ungated ``decay_invalidate`` hides the record mid-adjudication, an
    ungated ``decay_prune`` DELETES it. Each held assertion is paired with
    an unheld positive control on identical geometry — without the
    control, a held test passes vacuously on rows that were never
    eligible.
    """

    def test_held_row_is_not_decay_invalidated(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        held = _seed(
            db, tenant, content="held stale", importance=0.5, age_days=720, source=HELD
        )
        # Positive control: identical decay geometry, no flag.
        unheld = _seed(db, tenant, content="unheld stale", importance=0.5, age_days=720)

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["invalidated"] == 1

        assert _row(db, held, "valid_until") is None
        assert _row(db, held, "source->>'decayed_at'") is None
        assert _row(db, unheld, "valid_until") is not None
        assert _row(db, unheld, "source->>'decayed_at'") is not None

    def test_held_superseded_row_past_grace_is_not_pruned(
        self, db: AsyncEngine
    ) -> None:
        """The half that matters most, and it stands on its own.

        These rows were superseded BEFORE the hold was applied — the
        common case, since a bad auto-supersede is what prompts a hold.
        ``decay_invalidate``'s gate cannot help them (their ``valid_until``
        is already set); only the prune gate keeps the adjudicator's
        evidence alive past the 90-day grace.
        """
        tenant = uuid4()
        survivor = _seed(db, tenant, content="survivor", importance=0.9)
        held = _seed(
            db,
            tenant,
            content="held superseded",
            valid_until_days_ago=100,
            superseded_by=survivor,
            source=HELD,
        )
        # Positive control: identical terminal state, no flag.
        unheld = _seed(
            db,
            tenant,
            content="unheld superseded",
            valid_until_days_ago=100,
            superseded_by=survivor,
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["pruned"] == 1

        assert _exists(db, held)
        assert _row(db, held, "superseded_by") == survivor
        assert not _exists(db, unheld)

    def test_held_decayed_and_tombstoned_rows_survive_the_prune(
        self, db: AsyncEngine
    ) -> None:
        """The other two terminal markers are gated by the same predicate."""
        tenant = uuid4()
        held_decayed = _seed(
            db,
            tenant,
            content="held decayed",
            valid_until_days_ago=100,
            source={"decayed_at": "2026-03-01T00:00:00+00:00", **HELD},
        )
        held_tombstoned = _seed(
            db,
            tenant,
            content="held tombstoned",
            valid_until_days_ago=100,
            is_tombstone=True,
            source=HELD,
        )
        unheld_decayed = _seed(
            db,
            tenant,
            content="unheld decayed",
            valid_until_days_ago=100,
            source={"decayed_at": "2026-03-01T00:00:00+00:00"},
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["pruned"] == 1
        assert _exists(db, held_decayed)
        assert _exists(db, held_tombstoned)
        assert not _exists(db, unheld_decayed)


class TestLifecycleHoldPredicateShape:
    """Ungated (no ``db`` fixture) — runs even where Postgres is absent."""

    def test_predicate_is_a_text_comparison_never_a_cast(self) -> None:
        for prefix in ("", "a.", "b."):
            sql = store._not_lifecycle_held(prefix)
            assert sql == (
                f"lower({prefix}source->>'lifecycle_hold') IS DISTINCT FROM 'true'"
            )
            # A cast is the failure class this predicate exists to avoid:
            # it raises on a malformed value and aborts the sweep for every
            # tenant. `->` (jsonb) would also mistype the comparison.
            # `lower()` is case folding on TEXT — it cannot throw either.
            assert "::" not in sql
            assert "CAST" not in sql.upper()
            assert "->>" in sql


# ---------------------------------------------------------------------------
# Reindex on model bump
# ---------------------------------------------------------------------------


class TestReindex:
    """The sweep ENQUEUES; it never embeds (the runner pays for that)."""

    def test_stale_tag_and_null_embedding_are_enqueued_not_embedded(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        stale = _seed(
            db,
            tenant,
            content="stale model row",
            embedding=_axis(0),
            embedding_model="old-model@v0",
        )
        null_emb = _seed(
            db,
            tenant,
            content="null embedding row",
            embedding=None,
            embedding_model=None,
        )
        current = _seed(db, tenant, content="current row", embedding=_axis(1))
        current_vec_before = _row(db, current, "CAST(embedding AS text)")

        stats = _run(db, lambda s: reindex_once(s, now=NOW))
        assert stats["enqueued_rows"] == 2
        assert stats["enqueued_jobs"] == 1

        # One embedding job covering exactly the two stale/NULL rows.
        jobs = _job_rows(db, tenant)
        assert len(jobs) == 1
        assert jobs[0]["kind"] == "embedding"
        assert jobs[0]["status"] == "pending"
        assert {UUID(str(t)) for t in jobs[0]["target_ids"]} == {stale, null_emb}

        # Nothing was embedded in-process: the rows are untouched, still
        # carrying their old (or absent) vectors, awaiting a runner.
        assert _row(db, null_emb, "embedding") is None
        assert _row(db, stale, "embedding_model") == "old-model@v0"
        # The already-current row is not enqueued and not touched.
        assert _row(db, current, "CAST(embedding AS text)") == current_vec_before

        # Second run is a no-op: the rows now have an in-flight job, so
        # they are excluded from the batch entirely (this is what makes
        # the enqueue loop terminate rather than re-select them forever).
        stats = _run(db, lambda s: reindex_once(s, now=NOW))
        assert stats["enqueued_rows"] == 0
        assert stats["enqueued_jobs"] == 0
        assert len(_job_rows(db, tenant)) == 1

    def test_tombstones_never_enqueued(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        dead = _seed(
            db,
            tenant,
            content="tombstoned stale",
            embedding=None,
            embedding_model="old-model@v0",
            is_tombstone=True,
        )
        stats = _run(db, lambda s: reindex_once(s, now=NOW))
        assert stats["enqueued_rows"] == 0
        assert _job_rows(db, tenant) == []
        assert _row(db, dead, "embedding") is None

    def test_rows_are_enqueued_per_tenant(self, db: AsyncEngine) -> None:
        # The batch sweep is tenant-agnostic but a claim is tenant-bound,
        # so a batch spanning tenants must split into one job per tenant.
        tenant_a, tenant_b = uuid4(), uuid4()
        _seed(db, tenant_a, content="a row", embedding=None, embedding_model=None)
        _seed(db, tenant_b, content="b row", embedding=None, embedding_model=None)

        stats = _run(db, lambda s: reindex_once(s, now=NOW))
        assert stats["enqueued_rows"] == 2
        assert stats["enqueued_jobs"] == 2
        assert len(_job_rows(db, tenant_a)) == 1
        assert len(_job_rows(db, tenant_b)) == 1


class TestSupersedeGuard:
    """The back-edge / dead-target guard on every ``superseded_by`` writer.

    `memhold_adjudicate_01` treated a winner's liveness as an ``ORDER BY`` key
    and never checked the reverse edge, so it pointed A at B while B already
    pointed at A. That 2-cycle failed `memhold_adjudicate_02`'s ``not_live``
    invariant, held ``applied_head`` behind ``chain_head``, and — via coord's
    ``touches_migration`` deferral — deferred EVERY migration PR fleet-wide for
    more than 5h on 2026-08-04.

    A ranking cannot express "never": with a single candidate it returns that
    candidate whatever its state. Only a WHERE predicate can, which is what
    ``_supersede_target_is_safe`` adds to all three writers.
    """

    def test_back_edge_is_refused(self, db: AsyncEngine) -> None:
        """A to B exists; attempting B to A must be refused, not written.

        This is the exact construction that produced the 2026-08-04 cycle.
        """
        tenant = uuid4()
        a = _seed(db, tenant, content="cycle side a")
        b = _seed(db, tenant, content="cycle side b")

        # A->B lands: B is live and does not point back.
        _run(
            db,
            lambda s: store.mark_superseded(
                s, tenant_id=tenant, old_memory_id=a, new_memory_id=b
            ),
        )
        assert _row(db, a, "superseded_by") is not None

        # B->A must NOT land: A already points at B.
        with pytest.raises(store.SupersedeRefused) as excinfo:
            _run(
                db,
                lambda s: store.mark_superseded(
                    s, tenant_id=tenant, old_memory_id=b, new_memory_id=a
                ),
            )
        assert "cycle" in str(excinfo.value)

        # B is untouched - no cycle exists.
        assert _row(db, b, "superseded_by") is None
        assert _row(db, b, "valid_until") is None

    def test_supersede_onto_a_dead_target_is_refused(self, db: AsyncEngine) -> None:
        """The shape that orphaned ``4a14e94e``.

        Its chain was part 1/2 -> a sync-conflict sidecar that was ITSELF not
        live -> the live part 2/2. Pointing at a dead row buries the lineage:
        the subject leaves retrieval and its replacement is not in retrieval
        either, so the document is simply gone.
        """
        tenant = uuid4()
        subject = _seed(db, tenant, content="subject")
        dead = _seed(db, tenant, content="already retired", valid_until_days_ago=1)

        with pytest.raises(store.SupersedeRefused):
            _run(
                db,
                lambda s: store.mark_superseded(
                    s, tenant_id=tenant, old_memory_id=subject, new_memory_id=dead
                ),
            )
        _assert_live(db, subject)

    def test_live_target_still_supersedes(self, db: AsyncEngine) -> None:
        """Positive control: the guard must not block the ordinary path."""
        tenant = uuid4()
        old = _seed(db, tenant, content="old")
        new = _seed(db, tenant, content="new")

        _run(
            db,
            lambda s: store.mark_superseded(
                s, tenant_id=tenant, old_memory_id=old, new_memory_id=new
            ),
        )
        assert _row(db, old, "superseded_by") is not None
        assert _row(db, old, "valid_until") is not None

    def test_supersede_many_skips_a_dead_target_without_raising(
        self, db: AsyncEngine
    ) -> None:
        """The AUTOMATIC path skips and reports - it must never abort a sweep.

        A raising sweep is how a data defect becomes a fleet-wide outage
        (qontinui-web#904, ~25h). The asymmetry with ``mark_superseded`` is
        deliberate: explicit callers get an error, scheduled ones get a log.
        """
        tenant = uuid4()
        members = [_seed(db, tenant, content=f"member {i}") for i in range(3)]
        dead = _seed(db, tenant, content="dead synthesis", valid_until_days_ago=1)

        _run(db, lambda s: store.supersede_many(s, tenant, members, dead, now=NOW))
        # No exception, and nothing was superseded onto the dead row.
        _assert_live(db, *members)

    def test_supersede_many_still_works_for_a_live_target(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        members = [_seed(db, tenant, content=f"m{i}") for i in range(3)]
        summary = _seed(db, tenant, content="the synthesis")

        _run(db, lambda s: store.supersede_many(s, tenant, members, summary, now=NOW))
        for m in members:
            assert _row(db, m, "superseded_by") is not None


class TestCorruptionDetection:
    """The Change 4 read-only detection surface."""

    def test_finds_a_cycle_and_a_dead_edge(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        a = _seed(db, tenant, content="cyc a")
        b = _seed(db, tenant, content="cyc b", superseded_by=a)
        _exec(
            db,
            ["UPDATE coord.memory_records SET superseded_by = :b WHERE memory_id = :a"],
            a=a,
            b=b,
        )

        cycles = _run(db, lambda s: store.find_supersede_cycles(s, tenant_id=tenant))
        assert {r["a_id"] for r in cycles} == {a, b}

        edges = _run(
            db,
            lambda s: store.find_supersede_edges_into_non_live(s, tenant_id=tenant),
        )
        # Both ends of a cycle are superseded onto a non-live row.
        assert {r["memory_id"] for r in edges} == {a, b}

    def test_clean_corpus_reports_nothing(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        old = _seed(db, tenant, content="old")
        new = _seed(db, tenant, content="new")
        _run(
            db,
            lambda s: store.mark_superseded(
                s, tenant_id=tenant, old_memory_id=old, new_memory_id=new
            ),
        )
        assert (
            _run(db, lambda s: store.find_supersede_cycles(s, tenant_id=tenant)) == []
        )
        assert (
            _run(
                db,
                lambda s: store.find_supersede_edges_into_non_live(s, tenant_id=tenant),
            )
            == []
        )

    def test_finds_an_orphaned_document_part(self, db: AsyncEngine) -> None:
        """Non-live part-1 of a live document, superseded CROSS-document."""
        tenant = uuid4()
        other = _seed(db, tenant, content="beta-doc (part 1/2)")
        orphan = _seed(
            db,
            tenant,
            content="alpha-doc (part 1/2)",
            superseded_by=other,
            valid_until_days_ago=1,
        )
        _seed(db, tenant, content="alpha-doc (part 2/2)")

        found = _run(
            db, lambda s: store.find_orphaned_document_parts(s, tenant_id=tenant)
        )
        assert [r["memory_id"] for r in found] == [orphan]

    def test_same_document_reimport_is_not_reported(self, db: AsyncEngine) -> None:
        """The false positive that a shape-only sweep would revive.

        ``f689235f`` - part 1 of an import superseded onto part 1 of a LATER
        import of the SAME file - is ordinary dedup. Reviving it resurrects a
        duplicate, so the detector must not name it.
        """
        tenant = uuid4()
        newer = _seed(db, tenant, content="alpha-doc (part 1/5)")
        _seed(
            db,
            tenant,
            content="alpha-doc (part 1/2)",
            superseded_by=newer,
            valid_until_days_ago=1,
        )
        _seed(db, tenant, content="alpha-doc (part 2/2)")

        found = _run(
            db, lambda s: store.find_orphaned_document_parts(s, tenant_id=tenant)
        )
        assert found == []
