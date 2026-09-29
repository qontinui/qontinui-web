"""Unit tests for ``app.jobs.journey_edge_retention``.

The test database is built from the SQLAlchemy models, and the journey ledger
has no model (its precedent ``co_occurrence_observations`` has none either), so
it normally starts ABSENT here — which is exactly the absent-table path. The
present-table tests create it inside the test's own transaction from the
``journey_01`` revision's own DDL constant, so the table under test is the
migration's table, not a hand-kept copy; the transaction rollback removes it
again.

Pointed at a database the alembic chain HAS reached, the table already exists:
the absent-table tests then skip (their precondition cannot be arranged), and
the ``ledger`` fixture uses the existing table, emptying it inside the test's
transaction so the rollback restores whatever rows it held.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import ModuleType
from unittest.mock import patch

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs

from app.jobs import journey_edge_retention as retention
from tests._alembic_harness import backend_root, load_revision_module

_NOW = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
_NODE = json.dumps(
    {
        "specId": None,
        "stateIds": [],
        "modelled": False,
        "pathnameTemplate": "/admin/coord/runners",
        "pathname": None,
    }
)
_TRIGGER = json.dumps(
    {
        "actionType": "click",
        "targetFingerprint": None,
        "targetRole": None,
        "declaredEffect": None,
        "navigationTrigger": "affordance",
        "chokePoint": "element_action",
    }
)


def _revision() -> ModuleType:
    return load_revision_module(
        backend_root() / "alembic" / "versions" / "journey_01_edge_ledger.py",
        "journey_01_edge_ledger_under_test",
    )


@pytest_asyncio.fixture
async def ledger(async_db_session: AsyncSession) -> AsyncIterator[AsyncSession]:
    """The test session with an EMPTY journey ledger.

    Created from the revision's DDL when absent; an existing (migrated) table is
    used as-is and emptied — both inside the test transaction, so the rollback
    undoes either.
    """
    if await retention.journey_edge_table_present(async_db_session):
        await async_db_session.execute(text(f"DELETE FROM {retention.TABLE}"))
    else:
        revision = _revision()
        await async_db_session.execute(text(revision.CREATE_EDGE_OBSERVATIONS_SQL))
        for statement in revision.CREATE_EDGE_OBSERVATIONS_INDEXES_SQL:
            await async_db_session.execute(text(statement))
    yield async_db_session


@pytest_asyncio.fixture
async def no_ledger(async_db_session: AsyncSession) -> AsyncIterator[AsyncSession]:
    """The test session on a database WITHOUT the ledger, or a skip."""
    if await retention.journey_edge_table_present(async_db_session):
        pytest.skip(
            f"{retention.TABLE} already exists in this test database (it was "
            "migrated rather than built from the models), so the absent-table "
            "precondition cannot be arranged here"
        )
    yield async_db_session


async def _insert_edge(
    db: AsyncSession, *, age: timedelta, invalidated: bool = False
) -> str:
    result = await db.execute(
        text(
            """
            INSERT INTO project.journey_edge_observations
                (observed_at, app_id, runner_build_id, runner_instance, run_kind,
                 from_node, to_node, trigger, outcome, invalidated_at)
            VALUES (:observed_at, 'qontinui-web', 'build-1', 'primary',
                    'agent_action', CAST(:node AS jsonb), CAST(:node AS jsonb),
                    CAST(:trigger AS jsonb), 'changed', :invalidated_at)
            RETURNING id
            """
        ),
        {
            "observed_at": _NOW - age,
            "node": _NODE,
            "trigger": _TRIGGER,
            "invalidated_at": _NOW if invalidated else None,
        },
    )
    return str(result.scalar_one())


async def _surviving_ids(db: AsyncSession) -> set[str]:
    result = await db.execute(
        text("SELECT id::text FROM project.journey_edge_observations")
    )
    return set(result.scalars().all())


# ---------------------------------------------------------------------------
# Absent table — the scheduler must not crash, and must not report "0 deleted"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absent_table_logs_once_per_pass_and_returns_without_deleting(
    no_ledger: AsyncSession,
):
    with capture_logs() as logs:
        outcome = await retention.delete_journey_edges_older_than_retention(
            no_ledger, now=_NOW
        )

    assert outcome.table_present is False
    assert outcome.deleted_edges == 0
    absent = [
        e
        for e in logs
        if e["event"] == "journey_edge_observations absent — migration not applied"
    ]
    assert len(absent) == 1, logs
    assert absent[0]["log_level"] == "warning"
    # No "Cleaned up" line: an absent table is not a pass that deleted nothing.
    assert not [e for e in logs if e["event"].startswith("Cleaned up")]


@pytest.mark.asyncio
async def test_scheduled_job_survives_an_absent_table(no_ledger: AsyncSession):
    """Drive the REAL scheduler coroutine against a database with no ledger."""
    from app.core.scheduler import _job_journey_edge_retention

    class _SessionCtx:
        async def __aenter__(self):
            return no_ledger

        async def __aexit__(self, *exc):
            return False

    with patch("app.db.session.AsyncSessionLocal", lambda: _SessionCtx()):
        result = await _job_journey_edge_retention()

    assert result["table_present"] is False
    assert result["deleted_edges"] == 0


# ---------------------------------------------------------------------------
# Present table
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deletes_expired_edges_and_keeps_fresh_ones(ledger: AsyncSession):
    expired = await _insert_edge(ledger, age=timedelta(days=91))
    expired_invalidated = await _insert_edge(
        ledger, age=timedelta(days=200), invalidated=True
    )
    fresh = await _insert_edge(ledger, age=timedelta(days=89))
    brand_new = await _insert_edge(ledger, age=timedelta(0))

    with capture_logs() as logs:
        outcome = await retention.delete_journey_edges_older_than_retention(
            ledger, now=_NOW
        )

    assert outcome.table_present is True
    assert outcome.deleted_edges == 2
    assert outcome.cutoff == _NOW - timedelta(days=90)
    survivors = await _surviving_ids(ledger)
    assert survivors == {fresh, brand_new}
    assert expired not in survivors and expired_invalidated not in survivors
    report = [
        e for e in logs if e["event"] == "Cleaned up old journey edge observations"
    ]
    assert len(report) == 1
    assert report[0]["deleted_edges"] == 2
    assert report[0]["retention_days"] == 90
    # The pass duration is logged: a pass over 60 s is the named trigger for
    # revisiting the ledger's missing observed_at index.
    assert isinstance(report[0]["duration_seconds"], float)
    assert report[0]["duration_seconds"] >= 0


@pytest.mark.asyncio
async def test_retention_window_follows_the_setting(ledger: AsyncSession):
    kept = await _insert_edge(ledger, age=timedelta(days=5))
    gone = await _insert_edge(ledger, age=timedelta(days=11))

    with patch.object(retention.settings, "JOURNEY_EDGE_RETENTION_DAYS", 10):
        outcome = await retention.delete_journey_edges_older_than_retention(
            ledger, now=_NOW
        )

    assert outcome.deleted_edges == 1
    assert await _surviving_ids(ledger) == {kept}
    assert gone not in await _surviving_ids(ledger)


@pytest.mark.asyncio
async def test_nothing_expired_deletes_nothing_and_commits_nothing(
    ledger: AsyncSession,
):
    fresh = await _insert_edge(ledger, age=timedelta(days=1))

    with patch.object(ledger, "commit", wraps=ledger.commit) as commit_spy:
        outcome = await retention.delete_journey_edges_older_than_retention(
            ledger, now=_NOW
        )

    assert outcome.table_present is True
    assert outcome.deleted_edges == 0
    assert commit_spy.await_count == 0
    assert await _surviving_ids(ledger) == {fresh}


@pytest.mark.asyncio
async def test_deletes_in_committed_chunks(ledger: AsyncSession):
    for _ in range(5):
        await _insert_edge(ledger, age=timedelta(days=120))
    fresh = await _insert_edge(ledger, age=timedelta(days=1))

    with (
        patch.object(retention, "RETENTION_CHUNK_ROWS", 2),
        patch.object(ledger, "commit", wraps=ledger.commit) as commit_spy,
    ):
        outcome = await retention.delete_journey_edges_older_than_retention(
            ledger, now=_NOW
        )

    assert outcome.deleted_edges == 5
    # Chunks of 2, 2, 1 — each committed; the short last chunk ends the pass
    # without a further (empty) DELETE round-trip being committed.
    assert commit_spy.await_count == 3
    assert await _surviving_ids(ledger) == {fresh}


@pytest.mark.asyncio
async def test_exact_multiple_of_the_chunk_ends_on_an_empty_chunk(ledger: AsyncSession):
    for _ in range(4):
        await _insert_edge(ledger, age=timedelta(days=120))

    with (
        patch.object(retention, "RETENTION_CHUNK_ROWS", 2),
        patch.object(ledger, "commit", wraps=ledger.commit) as commit_spy,
    ):
        outcome = await retention.delete_journey_edges_older_than_retention(
            ledger, now=_NOW
        )

    assert outcome.deleted_edges == 4
    assert commit_spy.await_count == 2
    assert await _surviving_ids(ledger) == set()


@pytest.mark.asyncio
async def test_scheduler_core_reports_the_count(ledger: AsyncSession):
    await _insert_edge(ledger, age=timedelta(days=365))

    result = await retention.run_journey_edge_retention(ledger)

    assert result["table_present"] is True
    assert result["deleted_edges"] == 1
    assert "cutoff" in result


# ---------------------------------------------------------------------------
# Scheduling and settings
# ---------------------------------------------------------------------------


def test_journey_edge_retention_is_scheduled_hourly_and_at_boot():
    from app.core.scheduler import (
        SchedulerService,
        _job_journey_edge_retention,
        install_default_tasks,
    )

    service = SchedulerService()
    install_default_tasks(service)

    task = service._tasks["journey_edge_retention"]
    assert task.coro is _job_journey_edge_retention
    assert task.interval_seconds == 3600.0
    assert task.run_at_boot


def test_retention_days_defaults_to_90():
    from app.core.config import Settings

    assert Settings().JOURNEY_EDGE_RETENTION_DAYS == 90


@pytest.mark.parametrize("days", [0, -1])
def test_retention_days_below_one_is_refused(days):
    from app.core.config import Settings

    with pytest.raises(ValidationError, match="JOURNEY_EDGE_RETENTION_DAYS"):
        Settings(JOURNEY_EDGE_RETENTION_DAYS=days)
