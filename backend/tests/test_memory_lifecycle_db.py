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
    anchors: list[dict[str, Any]] | None = None,
    anchor_state: str = "none",
    content_hash: str | None = None,
) -> UUID:
    """Insert one row with full control over lifecycle-relevant columns.

    ``content_hash`` defaults to a per-row unique value; pass it
    explicitly to build the CONTENT TWIN the restore's live-twin guard
    exists to detect (that guard is about two rows sharing a hash, which
    the default deliberately makes impossible).
    """
    memory_id = uuid4()
    _exec(
        engine,
        [
            """
            INSERT INTO coord.memory_records
                (memory_id, tenant_id, scope, kind, title, content,
                 content_hash, embedding, embedding_model, importance,
                 access_count, last_accessed_at, valid_until,
                 superseded_by, is_tombstone, source, created_at,
                 anchors, anchor_state)
            VALUES
                (:memory_id, :tenant_id, 'tenant', :kind, :title, :content,
                 :content_hash, CAST(:embedding AS vector), :embedding_model,
                 :importance, :access_count, :last_accessed_at, :valid_until,
                 :superseded_by, :is_tombstone, CAST(:source AS jsonb),
                 :created_at, CAST(:anchors AS jsonb), :anchor_state)
            """
        ],
        memory_id=memory_id,
        tenant_id=tenant_id,
        kind=kind,
        title=content[:40],
        content=content,
        content_hash=content_hash if content_hash is not None else f"hash-{memory_id}",
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
        anchors=json.dumps(anchors or []),
        anchor_state=anchor_state,
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
# Anchors — decay exemption, the gone sweep, un-invalidation
# (plan 2026-07-29-memory-anchored-derived-records, Phase 3)
# ---------------------------------------------------------------------------

_BLOB_ANCHOR = {
    "type": "blob",
    "repo": "qontinui-web",
    "path": "backend/app/services/memory_store.py",
    "sha": "0" * 40,
}
_FLAG_ANCHOR = {"type": "flag", "name": "merge_rollout"}
_MIGRATION_ANCHOR = {"type": "migration", "revision": "coord_memory_links"}


def _visible_ids(engine: AsyncEngine, tenant_id: UUID) -> set[UUID]:
    """Ids the RETRIEVAL-visibility predicate currently admits.

    ``list_records_page``'s liveness is the same not-tombstoned /
    not-superseded / validity-not-ended rule the query arms apply, so
    "left retrieval" and "came back to retrieval" are asserted against
    the shipped predicate rather than against a hand-rolled copy of it.
    """
    rows = _run(
        engine,
        lambda s: store.list_records_page(
            s,
            tenant_id=tenant_id,
            kinds=None,
            since=None,
            cursor=None,
            limit=100,
            now=None,
        ),
    )
    return {row["memory_id"] for row in rows}


class TestAnchorMigrationIsInert:
    """Verification §7.1 — the added columns change nothing for old rows."""

    def test_existing_rows_read_back_empty_anchors_and_none_state(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        # Seeded WITHOUT touching either new column: this is what every
        # pre-migration row looks like once the ADD COLUMN defaults land.
        legacy = _seed(db, tenant, content="pre-anchor row", importance=0.9)
        # Asserted as ::text so the check is on the STORED value, not on
        # whatever the driver's jsonb codec happens to hand back.
        assert _row(db, legacy, "anchors::text") == "[]"
        assert _row(db, legacy, "anchor_state") == "none"
        # ...and it still behaves exactly as it did: fresh, visible,
        # untouched by the sweep.
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["invalidated"] == 0
        assert stats["anchor_gone_hidden"] == 0
        assert stats["anchor_gone_restored"] == 0
        assert _visible_ids(db, tenant) == {legacy}
        assert _row(db, legacy, "valid_until") is None


class TestAnchoredRowsAreDecayExempt:
    """Verification §7.2 — age is not evidence about an anchored record."""

    def test_anchored_row_survives_decay_its_twin_does_not(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        # Identical rows in every decay-relevant respect (importance 0.5,
        # 720 days old, never accessed => score well under 0.05). The ONLY
        # difference is the anchor array.
        anchorless = _seed(
            db, tenant, content="unanchored", importance=0.5, age_days=720
        )
        anchored = _seed(
            db,
            tenant,
            content="anchored",
            importance=0.5,
            age_days=720,
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["invalidated"] == 1

        assert _row(db, anchorless, "valid_until") is not None
        assert _row(db, anchorless, "source->>'decayed_at'") is not None
        # The anchored twin is untouched: no valid_until, no decay stamp.
        assert _row(db, anchored, "valid_until") is None
        assert _row(db, anchored, "source->>'decayed_at'") is None
        assert _visible_ids(db, tenant) == {anchored}

    def test_exemption_survives_a_second_pass(self, db: AsyncEngine) -> None:
        """The sweep is daily; exemption that only held once is no exemption."""
        tenant = uuid4()
        anchored = _seed(
            db,
            tenant,
            content="anchored, ancient",
            importance=0.1,
            age_days=3000,
            anchors=[_FLAG_ANCHOR],
            anchor_state="fresh",
        )
        for _ in range(3):
            _run(db, lambda s: decay_once(s, now=NOW))
        assert _row(db, anchored, "valid_until") is None
        assert _visible_ids(db, tenant) == {anchored}


class TestAnchorGoneSweep:
    """Verification §7.5b — gone hides, un-gone restores, prune never bites."""

    def test_gone_row_leaves_retrieval_and_carries_its_own_marker(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        gone = _seed(
            db,
            tenant,
            content="anchored at a deleted file",
            anchors=[_BLOB_ANCHOR],
            anchor_state="gone",
        )
        keeper = _seed(
            db,
            tenant,
            content="anchored at a live file",
            anchors=[_FLAG_ANCHOR],
            anchor_state="fresh",
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_hidden"] == 1
        assert _visible_ids(db, tenant) == {keeper}
        assert _row(db, gone, "valid_until") is not None
        assert _row(db, gone, "source->>'anchor_gone_at'") is not None
        # THE constraint: never the prune's marker. Reusing decayed_at
        # would make one watcher misfire a permanent delete 90 days on.
        assert _row(db, gone, "source->>'decayed_at'") is None
        assert _exists(db, gone)

    def test_hide_is_idempotent(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        gone = _seed(
            db,
            tenant,
            content="stays gone",
            anchors=[_BLOB_ANCHOR],
            anchor_state="gone",
        )
        first = _run(db, lambda s: decay_once(s, now=NOW))
        second = _run(db, lambda s: decay_once(s, now=NOW))
        assert first["anchor_gone_hidden"] == 1
        assert second["anchor_gone_hidden"] == 0
        assert _exists(db, gone)

    def test_flipping_back_to_fresh_restores_retrieval_and_nulls_valid_until(
        self, db: AsyncEngine
    ) -> None:
        tenant = uuid4()
        record = _seed(
            db,
            tenant,
            content="a file that came back",
            anchors=[_BLOB_ANCHOR],
            anchor_state="gone",
        )
        _run(db, lambda s: decay_once(s, now=NOW))
        assert _visible_ids(db, tenant) == set()

        # The watcher re-resolves the anchor and withdraws its verdict.
        _exec(
            db,
            [
                "UPDATE coord.memory_records SET anchor_state = 'fresh' "
                "WHERE memory_id = :m"
            ],
            m=record,
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restored"] == 1
        assert _visible_ids(db, tenant) == {record}
        assert _row(db, record, "valid_until") is None
        # The provenance token is consumed, so a later pass is a no-op.
        assert _row(db, record, "source->>'anchor_gone_at'") is None
        again = _run(db, lambda s: decay_once(s, now=NOW))
        assert again["anchor_gone_restored"] == 0

    def test_restore_never_touches_a_user_set_valid_until(
        self, db: AsyncEngine
    ) -> None:
        """The marker, not ``valid_until``, is what makes un-hiding safe."""
        tenant = uuid4()
        user_scheduled = _seed(
            db,
            tenant,
            content="explicitly time-boxed by a human",
            valid_until_days_ago=1,
            anchors=[_MIGRATION_ANCHOR],
            anchor_state="fresh",
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restored"] == 0
        # Still ended, still invisible — the sweep has no business
        # resurrecting a boundary it did not set.
        assert _row(db, user_scheduled, "valid_until") is not None
        assert _visible_ids(db, tenant) == set()

    def test_gone_row_is_never_pruned_past_the_grace_window(
        self, db: AsyncEngine
    ) -> None:
        """A watcher verdict must never reach a hard delete."""
        tenant = uuid4()
        long_gone = _seed(
            db,
            tenant,
            content="hidden by the watcher months ago",
            # Well past DECAY_PRUNE_GRACE_DAYS (90).
            valid_until_days_ago=400,
            anchors=[_BLOB_ANCHOR],
            anchor_state="gone",
            source={"anchor_gone_at": "2025-06-01T00:00:00+00:00"},
        )
        # Positive control: same age, but a genuine terminal marker.
        decayed = _seed(
            db,
            tenant,
            content="decayed months ago",
            valid_until_days_ago=400,
            source={"decayed_at": "2025-06-01T00:00:00+00:00"},
        )

        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["pruned"] == 1
        assert not _exists(db, decayed)
        assert _exists(db, long_gone)
        # And it is still recoverable: flip the verdict, get it back.
        _exec(
            db,
            [
                "UPDATE coord.memory_records SET anchor_state = 'fresh' "
                "WHERE memory_id = :m"
            ],
            m=long_gone,
        )
        _run(db, lambda s: decay_once(s, now=NOW))
        assert _visible_ids(db, tenant) == {long_gone}

    def test_moved_record_stays_retrievable(self, db: AsyncEngine) -> None:
        """Verification §7.5d — partial invalidation must not hide.

        Three anchors, one of them dead: the roll-up is ``moved`` (gone
        only on unanimity, §3.2), and the web side's whole job is to NOT
        hide it. ``moved`` is advisory — the reader is told, not denied.
        """
        tenant = uuid4()
        partly = _seed(
            db,
            tenant,
            content="two anchors live, one deleted",
            importance=0.5,
            age_days=720,  # also old enough to decay, were it not anchored
            anchors=[_BLOB_ANCHOR, _FLAG_ANCHOR, _MIGRATION_ANCHOR],
            anchor_state="moved",
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_hidden"] == 0
        assert stats["invalidated"] == 0
        assert _visible_ids(db, tenant) == {partly}
        assert _row(db, partly, "valid_until") is None
        assert _row(db, partly, "anchor_state") == "moved"

    def test_lifecycle_hold_defers_both_halves(self, db: AsyncEngine) -> None:
        """The hold is honoured symmetrically, and strands nothing."""
        tenant = uuid4()
        held = _seed(
            db,
            tenant,
            content="held while a human adjudicates",
            anchors=[_BLOB_ANCHOR],
            anchor_state="gone",
            source={"lifecycle_hold": True},
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_hidden"] == 0
        assert _visible_ids(db, tenant) == {held}

        # Releasing the hold hands the row back to the sweep.
        _exec(
            db,
            [
                "UPDATE coord.memory_records "
                "SET source = source || '{\"lifecycle_hold\": false}'::jsonb "
                "WHERE memory_id = :m"
            ],
            m=held,
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_hidden"] == 1
        assert _visible_ids(db, tenant) == set()


class TestAnchorRestoreCannotBreakTheSweep:
    """F1 — the restore is the only writer that re-enters the live-dedup index.

    ``uq_memory_records_tenant_content_hash_live`` is partial on
    ``valid_until IS NULL``: ending validity FREES a content hash, so
    un-ending it can collide with whatever took the hash meanwhile. The
    whole daily pass is one transaction, so an uncaught collision would
    roll back the decay sweep, skip the prune and the session expiry, and
    re-raise at 03:10 every night forever.
    """

    def _hidden_with_twin(
        self, db: AsyncEngine, tenant: UUID, *, shared_hash: str = "shared-hash"
    ) -> tuple[UUID, UUID]:
        """A restorable hidden row plus a LIVE row holding its hash."""
        hidden = _seed(
            db,
            tenant,
            content="the hidden original",
            content_hash=shared_hash,
            valid_until_days_ago=1,
            anchors=[_BLOB_ANCHOR],
            # The watcher has already withdrawn the verdict: this row is
            # restorable in every respect except the twin.
            anchor_state="fresh",
            source={"anchor_gone_at": "2026-06-01T00:00:00+00:00"},
        )
        twin = _seed(
            db,
            tenant,
            content="the hidden original",
            content_hash=shared_hash,
        )
        return hidden, twin

    def test_live_twin_does_not_abort_the_daily_pass(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        hidden, twin = self._hidden_with_twin(db, tenant)
        # A row the decay half must still invalidate, to prove the rest of
        # the pass actually ran rather than being rolled back.
        stale = _seed(db, tenant, content="stale", importance=0.5, age_days=720)

        stats = _run(db, lambda s: decay_once(s, now=NOW))

        assert stats["anchor_gone_restored"] == 0
        assert stats["anchor_gone_restore_blocked"] == 1
        # The rest of the pass completed.
        assert stats["invalidated"] == 1
        assert _row(db, stale, "valid_until") is not None
        # Both rows survive; only the twin is retrievable.
        assert _exists(db, hidden)
        assert _visible_ids(db, tenant) == {twin}

    def test_blocked_row_keeps_its_marker_and_restores_once_the_twin_goes(
        self, db: AsyncEngine
    ) -> None:
        """Skip means WAIT, not give up — dropping the marker would be fatal."""
        tenant = uuid4()
        hidden, twin = self._hidden_with_twin(db, tenant)
        _run(db, lambda s: decay_once(s, now=NOW))
        # The provenance token is intact, so the row is still restorable.
        assert _row(db, hidden, "source->>'anchor_gone_at'") is not None
        assert _row(db, hidden, "valid_until") is not None

        # The twin is tombstoned, which frees the hash again.
        _exec(
            db,
            [
                "UPDATE coord.memory_records SET is_tombstone = true WHERE memory_id = :m"
            ],
            m=twin,
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restore_blocked"] == 0
        assert stats["anchor_gone_restored"] == 1
        assert _row(db, hidden, "valid_until") is None
        assert _row(db, hidden, "source->>'anchor_gone_at'") is None
        assert _visible_ids(db, tenant) == {hidden}

    def test_a_dead_twin_does_not_block(self, db: AsyncEngine) -> None:
        """The guard tracks the INDEX predicate, not merely "a row exists"."""
        tenant = uuid4()
        hidden = _seed(
            db,
            tenant,
            content="the hidden original",
            content_hash="dead-twin-hash",
            valid_until_days_ago=1,
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
            source={"anchor_gone_at": "2026-06-01T00:00:00+00:00"},
        )
        # Same hash, but superseded => outside the partial unique index.
        _seed(
            db,
            tenant,
            content="the hidden original",
            content_hash="dead-twin-hash",
            valid_until_days_ago=2,
            superseded_by=hidden,
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restore_blocked"] == 0
        assert stats["anchor_gone_restored"] == 1
        assert _row(db, hidden, "valid_until") is None

    def test_a_twin_in_another_tenant_does_not_block(self, db: AsyncEngine) -> None:
        """The unique index is per-tenant; the guard must be too."""
        tenant = uuid4()
        other = uuid4()
        hidden = _seed(
            db,
            tenant,
            content="the hidden original",
            content_hash="cross-tenant-hash",
            valid_until_days_ago=1,
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
            source={"anchor_gone_at": "2026-06-01T00:00:00+00:00"},
        )
        _seed(
            db,
            other,
            content="the hidden original",
            content_hash="cross-tenant-hash",
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restore_blocked"] == 0
        assert stats["anchor_gone_restored"] == 1
        assert _visible_ids(db, tenant) == {hidden}


class TestAnchorRestoreRespectsTerminalStates:
    """F2 — un-hiding a WATCHER verdict, never resurrecting a dead row.

    ``_validity_filters`` enforces supersession purely through
    ``valid_until`` and never looks at ``superseded_by``, so NULLing
    ``valid_until`` on a superseded row would put it back into retrieval
    competing with its own successor — and leave it unprunable forever.
    """

    def test_superseded_row_is_never_restored(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        successor = _seed(db, tenant, content="the corrected claim")
        superseded = _seed(
            db,
            tenant,
            content="the original claim",
            valid_until_days_ago=1,
            superseded_by=successor,
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
            source={"anchor_gone_at": "2026-06-01T00:00:00+00:00"},
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restored"] == 0
        # Still terminated, still invisible, still not competing.
        assert _row(db, superseded, "valid_until") is not None
        assert _row(db, superseded, "superseded_by") is not None
        assert _visible_ids(db, tenant) == {successor}

    def test_tombstoned_row_is_never_restored(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        deleted = _seed(
            db,
            tenant,
            content="the deleted claim",
            valid_until_days_ago=1,
            is_tombstone=True,
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
            source={"anchor_gone_at": "2026-06-01T00:00:00+00:00"},
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restored"] == 0
        assert _row(db, deleted, "valid_until") is not None
        assert _row(db, deleted, "is_tombstone") is True
        assert _visible_ids(db, tenant) == set()

    def test_an_anchorless_row_is_never_restored(self, db: AsyncEngine) -> None:
        """Tightening predicate: no anchors, nothing for this sweep to say."""
        tenant = uuid4()
        stray = _seed(
            db,
            tenant,
            content="a marker with no anchors",
            valid_until_days_ago=1,
            anchor_state="fresh",
            source={"anchor_gone_at": "2026-06-01T00:00:00+00:00"},
        )
        stats = _run(db, lambda s: decay_once(s, now=NOW))
        assert stats["anchor_gone_restored"] == 0
        assert _row(db, stray, "valid_until") is not None


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


def _seed_observation_cluster(db: AsyncEngine, tenant: UUID) -> list[UUID]:
    """`_seed_episode_cluster`'s geometry, seeded as ``observation``.

    Identical similarity, importance and ages — the ONLY difference is the
    kind. That is what makes the pair of tests below a control: if the
    observation cluster stopped being enqueued for any reason other than the
    kind (bad embeddings, a threshold change, a broken fixture), the episode
    test would fail too and the pair would not read as a passing guard.
    """
    return [
        _seed(
            db,
            tenant,
            content=f"observation number {i}",
            kind="observation",
            importance=0.4 + i * 0.05,
            age_days=float(30 - i),
            embedding=_blend(0, i + 1, 0.93),
        )
        for i in range(5)
    ]


class TestConsolidationConsumesEpisodesOnly:
    """Distillation supersedes its members, so it must only reach ``episode``.

    `record_synthesis_result` points every cluster member at the distilled
    ``mental_model``, and ``superseded_by`` is a `decay_prune` terminal marker
    — so a consumed member is DELETED 90 days later. That endpoint is correct
    for episodes and wrong for a durable authored record.

    The 2026-07-28 sweep consumed 597 imported topic-file documents this way,
    filed as ``kind='observation'`` by the memory cutover. ``observation`` is
    also the DEFAULT kind for `coord_memory_record`, so leaving it in the
    selector pointed a summarizer at the general case rather than the episodic
    one.
    """

    def test_observation_cluster_is_never_enqueued(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_observation_cluster(db, tenant)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))

        assert stats["cluster_candidates"] == 0
        assert stats["clusters"] == 0
        assert stats["enqueued"] == 0
        assert _job_rows(db, tenant) == []
        _assert_live(db, *members)

    def test_episode_cluster_still_enqueues(self, db: AsyncEngine) -> None:
        """The positive control — same geometry, kind=episode."""
        tenant = uuid4()
        _seed_episode_cluster(db, tenant)

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))

        assert stats["cluster_candidates"] == 5
        assert stats["clusters"] == 1
        assert stats["enqueued"] == 1


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
        # Reported ONCE, not twice: a cycle satisfies the symmetric join from
        # both ends, and a double-counted cycle inflates any alert built on it.
        assert len(cycles) == 1
        assert {cycles[0]["a_id"], cycles[0]["b_id"]} == {a, b}

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


class TestSupersedeGuardCorrelation:
    """The back-edge arm must be CORRELATED to the row being updated.

    An earlier draft defaulted ``subject`` to a bare ``memory_id``. Inside the
    subquery that resolves against the INNERMOST range table (``back``), so the
    clause collapsed to ``back.superseded_by = back.memory_id`` - "does the
    target point at ITSELF" - which is never true. Postgres then plans it as an
    uncorrelated InitPlan that never reads the outer row, and the guard reads
    as present while doing nothing.

    That bug is invisible to a behavioural test, because under today's liveness
    definition a row B with ``B.superseded_by = A`` is already not live, so the
    liveness arm refuses the write regardless and every end-to-end assertion
    still passes. So this asserts the SQL semantics directly.
    """

    def test_back_edge_arm_reads_the_outer_row(self, db: AsyncEngine) -> None:
        """Evaluate the rendered back-edge arm against a real A<-B pair.

        Seeds B.superseded_by = A, then asks the arm about (subject=A,
        target=B) and (subject=C, target=B). A correlated clause answers TRUE
        then FALSE. The uncorrelated bug answers FALSE for both, because
        ``back.superseded_by`` (=A) never equals ``back.memory_id`` (=B).
        """
        tenant = uuid4()
        a = _seed(db, tenant, content="back-edge target of b")
        c = _seed(db, tenant, content="unrelated third row")
        b = _seed(db, tenant, content="points at a", superseded_by=a)

        sql = """
            SELECT EXISTS (
                SELECT 1 FROM coord.memory_records back
                 WHERE back.memory_id = :target
                   AND back.superseded_by = memory_records.memory_id
            ) AS hit
              FROM coord.memory_records
             WHERE memory_records.memory_id = :subject
        """
        hit_a = _scalar(db, sql, target=b, subject=a)
        hit_c = _scalar(db, sql, target=b, subject=c)

        assert hit_a is True, (
            "the back-edge arm must SEE the outer row: B points at A, so asking "
            "about subject=A must be a hit. FALSE here means the clause "
            "collapsed to back.superseded_by = back.memory_id and the guard is "
            "inert."
        )
        assert hit_c is False, (
            "and it must DISCRIMINATE: B does not point at C, so subject=C is "
            "not a hit. Equal results for both subjects would mean the clause "
            "never read the outer row at all."
        )

    def test_guard_rejects_a_non_identifier_subject(self) -> None:
        """The fragment is f-string-interpolated, so it must not accept data."""
        with pytest.raises(ValueError):
            store._supersede_target_is_safe(
                target="t", subject="memory_id; DROP TABLE coord.memory_records"
            )
        with pytest.raises(ValueError):
            store._supersede_target_is_safe(target="not a bind name")

    def test_default_subject_is_qualified(self) -> None:
        """Cheap, deterministic guard against re-introducing the bare name."""
        rendered = store._supersede_target_is_safe(target="new_memory_id")
        assert "back.superseded_by = memory_records.memory_id" in rendered


def _seed_anchor_cluster(
    db: AsyncEngine,
    tenant: UUID,
    *,
    anchored: set[int],
) -> list[UUID]:
    """``_seed_hold_cluster`` geometry, anchoring ``anchored`` indices.

    Deliberately the SAME geometry the hold tests use, so the only
    variable between an excluded and an included member is the array the
    exemption keys on.
    """
    return [
        _seed(
            db,
            tenant,
            content=f"episode number {i}",
            kind="episode",
            importance=0.4 + i * 0.05,
            age_days=float(30 - i),
            embedding=_blend(0, i + 1, 0.93),
            anchors=[_BLOB_ANCHOR] if i in anchored else None,
            anchor_state="fresh" if i in anchored else "none",
        )
        for i in range(5)
    ]


class TestAnchoredRowsAreConsolidationExempt:
    """The decay exemption is worthless if clustering supersedes the row.

    Phase 3 makes an anchored record immune to ``decay_invalidate``; the
    synthesis path would then supersede it anyway — and supersession is
    STRICTLY worse than decay, because ``superseded_by`` IS one of
    ``decay_prune``'s terminal markers and therefore ends in a physical
    delete after the grace window. "Invalidate by ground truth, not by
    clock" fails if a clustering job is the thing that kills the record.
    """

    def test_anchored_candidate_is_excluded_and_its_twin_is_not(
        self, db: AsyncEngine
    ) -> None:
        """The direct assertion — one selector, two otherwise-identical rows."""
        tenant = uuid4()
        anchored = _seed(
            db,
            tenant,
            content="an anchored observation",
            kind="observation",
            embedding=_axis(3),
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
        )
        twin = _seed(
            db,
            tenant,
            content="an anchorless observation",
            kind="observation",
            embedding=_axis(3),
        )

        candidates = _run(
            db,
            lambda s: store.fetch_cluster_candidates(s, tenant, now=NOW, limit=1000),
        )
        ids = {c["memory_id"] for c in candidates}
        assert twin in ids
        assert anchored not in ids

    def test_an_all_anchored_cluster_enqueues_nothing(self, db: AsyncEngine) -> None:
        tenant = uuid4()
        members = _seed_anchor_cluster(db, tenant, anchored=set(range(5)))

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["cluster_candidates"] == 0
        assert stats["clusters"] == 0
        assert stats["enqueued"] == 0
        assert _job_rows(db, tenant) == []
        _assert_live(db, *members)

    def test_unanchored_cluster_still_enqueues(self, db: AsyncEngine) -> None:
        """Positive control: identical geometry, no anchors → a job appears."""
        tenant = uuid4()
        _seed_anchor_cluster(db, tenant, anchored=set())

        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["cluster_candidates"] == 5
        assert stats["clusters"] == 1
        assert stats["enqueued"] == 1

    def test_in_flight_job_cannot_supersede_a_later_anchored_member(
        self, db: AsyncEngine
    ) -> None:
        """The race the selector alone cannot close.

        Consolidation enqueues every 10 minutes, so a job that named a row
        while it was still anchorless is almost always in flight when
        Phase 6's dedup-merge backfills an anchor onto it.
        ``supersede_many`` re-checks — the same two-gate idiom the
        lifecycle hold uses, for the same reason.
        """
        tenant = uuid4()
        # 1. Enqueue with every member ANCHORLESS, so target_ids names all five.
        members = _seed_anchor_cluster(db, tenant, anchored=set())
        stats = _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        assert stats["enqueued"] == 1
        job_id = UUID(str(_job_rows(db, tenant)[0]["job_id"]))
        _run(
            db,
            lambda s: store.claim_jobs(
                s, tenant, limit=4, kinds=["synthesis"], worker="r"
            ),
        )

        # 2. Backfill an anchor onto one member AFTER the job exists.
        anchored = members[0]
        _exec(
            db,
            [
                "UPDATE coord.memory_records "
                "SET anchors = CAST(:a AS jsonb), anchor_state = 'fresh' "
                "WHERE memory_id = :m"
            ],
            a=json.dumps([_BLOB_ANCHOR]),
            m=anchored,
        )
        assert {UUID(str(m)) for m in _job_rows(db, tenant)[0]["target_ids"]} == set(
            members
        ), "the in-flight job still names the newly-anchored member"

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
        assert new_id is not None

        # The synthesis is not cancelled — the anchorless members are
        # superseded exactly as before.
        for member in members[1:]:
            assert _row(db, member, "superseded_by") == new_id

        # The anchored member survives its own already-enqueued job, and
        # so never acquires the `superseded_by` terminal marker that would
        # make decay_prune delete it 90 days on.
        _assert_live(db, anchored)
        assert _row(db, anchored, "superseded_by") is None
        assert _row(db, anchored, "valid_until") is None

    def test_exemption_survives_the_whole_daily_pass(self, db: AsyncEngine) -> None:
        """Both mechanisms together: neither the clock nor the clusterer."""
        tenant = uuid4()
        anchored = _seed(
            db,
            tenant,
            content="an old anchored observation",
            kind="observation",
            importance=0.5,
            age_days=720,
            embedding=_axis(4),
            anchors=[_BLOB_ANCHOR],
            anchor_state="fresh",
        )
        _run(db, lambda s: consolidate_tenant(s, tenant, now=NOW))
        _run(db, lambda s: decay_once(s, now=NOW))

        _assert_live(db, anchored)
        assert _row(db, anchored, "superseded_by") is None
        assert _row(db, anchored, "valid_until") is None
        assert _row(db, anchored, "source->>'decayed_at'") is None
