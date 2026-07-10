"""DB-backed tests for the memory lifecycle sweeps (Phase 4).

Same pgvector fixture posture as ``tests/test_memory_api_db.py`` (whose
DDL + stub embedder this module reuses): runs against the shared test
PostgreSQL, SKIPS gracefully when Postgres or pgvector is unavailable.
Covers:

* SQL/Python agreement of the decay retention-score formula,
* the decay invalidate sweep + the grace-period prune,
* near-duplicate merge (fold, threshold, tenant isolation),
* the synthesis pipeline with a stub synthesizer (and the None path),
* reindex-on-model-bump (stale tag + NULL embedding healed).
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
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.services import memory_embedder
from app.services import memory_store as store
from app.services.memory_embedder import EMBEDDING_DIM, EMBEDDING_MODEL_TAG
from app.services.memory_lifecycle import retention_score, set_synthesizer
from app.tasks.memory_lifecycle import consolidate_tenant, decay_once, reindex_once
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import _SETUP_SQL, HashingStubEmbedder, _exec, _scalar

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
            "DELETE FROM coord.tenant_policies",
        ],
    )
    yield memory_engine


@pytest.fixture(autouse=True)
def _stub_embedder() -> Generator[None, None, None]:
    memory_embedder.set_embedder(HashingStubEmbedder())
    yield
    memory_embedder.set_embedder(None)


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
# Consolidation — synthesis pipeline
# ---------------------------------------------------------------------------


class StubSynthesizer:
    def __init__(self, result: str | None) -> None:
        self.result = result
        self.calls: list[list[str]] = []

    def synthesize(self, cluster_texts: list[str]) -> str | None:
        self.calls.append(cluster_texts)
        return self.result


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


class TestSynthesisPipeline:
    def test_cluster_synthesized_into_mental_model(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_episode_cluster(db, tenant)
        synth = StubSynthesizer("Distilled insight\nfrom five episodes")

        stats = _run(
            db,
            lambda s: consolidate_tenant(s, tenant, synthesizer=synth, now=NOW),
        )
        assert stats["clusters"] == 1
        assert stats["synthesized"] == 1
        assert len(synth.calls) == 1
        assert len(synth.calls[0]) == 5

        new_id = _scalar(
            db,
            "SELECT memory_id FROM coord.memory_records "
            "WHERE tenant_id = :t AND kind = 'mental_model'",
            t=tenant,
        )
        assert new_id is not None
        new_uuid = UUID(str(new_id))
        assert _row(db, new_uuid, "title") == "Distilled insight"
        assert float(_row(db, new_uuid, "importance")) == pytest.approx(0.7, abs=1e-6)
        assert _row(db, new_uuid, "source->>'consolidation_run'") is not None
        consolidated_from = _row(db, new_uuid, "consolidated_from")
        assert {UUID(str(u)) for u in consolidated_from} == set(members)
        assert _row(db, new_uuid, "embedding") is not None

        for member in members:
            assert _row(db, member, "superseded_by") == new_uuid
            assert _row(db, member, "valid_until") is not None

    def test_none_synthesis_leaves_members_untouched(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_episode_cluster(db, tenant)
        synth = StubSynthesizer(None)

        stats = _run(
            db,
            lambda s: consolidate_tenant(s, tenant, synthesizer=synth, now=NOW),
        )
        assert stats["clusters"] == 1
        assert stats["synthesized"] == 0

        count = _scalar(
            db,
            "SELECT count(*) FROM coord.memory_records "
            "WHERE tenant_id = :t AND kind = 'mental_model'",
            t=tenant,
        )
        assert count == 0
        for member in members:
            assert _row(db, member, "superseded_by") is None
            assert _row(db, member, "valid_until") is None

    def test_default_synthesizer_degrades_to_skip(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        _seed_episode_cluster(db, tenant)
        set_synthesizer(None)  # force the Null default
        try:
            stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        finally:
            set_synthesizer(None)
        assert stats["clusters"] == 1
        assert stats["synthesized"] == 0


# ---------------------------------------------------------------------------
# Reindex on model bump
# ---------------------------------------------------------------------------


class TestReindex:
    def test_stale_tag_and_null_embedding_healed(self, db: AsyncEngine) -> None:
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
        assert stats["reindexed"] == 2

        for memory_id in (stale, null_emb):
            assert _row(db, memory_id, "embedding_model") == EMBEDDING_MODEL_TAG
            assert _row(db, memory_id, "embedding") is not None
        # The current row is untouched.
        assert _row(db, current, "CAST(embedding AS text)") == current_vec_before

        # Second run is a clean no-op.
        stats = _run(db, lambda s: reindex_once(s, now=NOW))
        assert stats["reindexed"] == 0

    def test_tombstones_never_reindexed(self, db: AsyncEngine) -> None:
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
        assert stats["reindexed"] == 0
        assert _row(db, dead, "embedding") is None
