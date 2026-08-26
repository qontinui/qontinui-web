"""DB-backed tests for the scheduler's Postgres-side invariants.

These need a real Postgres (they use the shared ``test_engine`` fixture from
``tests/conftest.py``). Two things can only be proven against a live server:

1. **Advisory-lock mutual exclusion.** ``pg_try_advisory_lock`` is what makes
   the in-process scheduler safe to run on N replicas: every replica ticks, but
   exactly one wins the lock and actually runs the task. If this ever became
   re-entrant across connections, every replica would fire every task.

2. **Due-row polling.** ``poll_and_dispatch_due`` claims rows with
   ``FOR UPDATE SKIP LOCKED`` and advances ``next_fire_at`` **from now(), not
   from the missed slot** — the at-most-once-per-window rule. Advancing from the
   missed slot would leave ``next_fire_at`` in the past after any downtime, so
   the row would re-fire on every 30s tick until it caught up (a backlog storm).

Both job entry points take an explicit ``engine`` keyword, so these tests hand
them ``test_engine`` directly. They deliberately do NOT rebind
``app.db.session.async_engine``: that is a process global, and repointing it
aimed the app's own live cron sweeper at the test database (web#901), where it
raced these tests for their own seeded rows. Rows are still seeded on
**committed** sessions (the transactional ``async_db_session`` fixture is
invisible to another connection) and cleaned up in the fixture teardown.

``poll_and_dispatch_due`` has no user filter — it claims *every* due row in the
table — so its ``stats`` dict is a whole-table count by construction. Assertions
here therefore key off **this fixture's own rows** (reload by id, or filter the
patched dispatcher's awaits by ``workflow_id``) and never compare ``stats`` to a
literal histogram, which any concurrently-seeded row would break.

The dispatcher is always patched — these tests never touch a real runner.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from croniter import croniter  # type: ignore[import-untyped]
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.jobs import scheduled_dispatch as scheduled_dispatch_mod
from app.jobs.scheduled_dispatch import fire_scheduled_run, poll_and_dispatch_due
from app.models.scheduled_workflow_run import ScheduledWorkflowRun
from app.models.unified_workflow import UnifiedWorkflow
from app.models.user import User
from app.services.workflow_dispatcher import DispatchError

# ---------------------------------------------------------------------------
# Advisory lock — the multi-replica invariant
# ---------------------------------------------------------------------------

_LOCK_SQL = text("SELECT pg_try_advisory_lock(hashtext('sched:' || :name)) AS locked")
_UNLOCK_SQL = text("SELECT pg_advisory_unlock(hashtext('sched:' || :name))")


@pytest.mark.asyncio
async def test_advisory_lock_grants_exactly_one_of_two_concurrent_replicas(
    test_engine,
):
    """Two replicas tick at once; exactly one runs the task.

    This is the whole reason the in-process scheduler is safe to deploy on more
    than one uvicorn process: the loser skips its tick silently instead of
    double-firing the job.
    """
    # Unique per run so a concurrently-running suite can't collide with us.
    name = f"test-lock-{uuid4()}"

    async with test_engine.connect() as conn_a, test_engine.connect() as conn_b:
        await conn_a.execution_options(isolation_level="AUTOCOMMIT")
        await conn_b.execution_options(isolation_level="AUTOCOMMIT")

        async def _try(conn, label: str) -> tuple[str, bool]:
            result = await conn.execute(_LOCK_SQL, {"name": name})
            return label, bool(result.scalar())

        outcomes = dict(await asyncio.gather(_try(conn_a, "a"), _try(conn_b, "b")))

        # Exactly one winner — never both, never neither.
        assert sorted(outcomes.values()) == [False, True], outcomes

        winner_conn = conn_a if outcomes["a"] else conn_b
        loser_conn = conn_b if outcomes["a"] else conn_a

        # The loser stays locked out while the winner holds it.
        again = await loser_conn.execute(_LOCK_SQL, {"name": name})
        assert bool(again.scalar()) is False

        # The scheduler releases in a `finally`; after that the next tick — on
        # any replica — can acquire. (A leaked lock would wedge the task forever.)
        await winner_conn.execute(_UNLOCK_SQL, {"name": name})

        retry = await loser_conn.execute(_LOCK_SQL, {"name": name})
        assert bool(retry.scalar()) is True

        await loser_conn.execute(_UNLOCK_SQL, {"name": name})


@pytest.mark.asyncio
async def test_advisory_lock_keys_are_per_task(test_engine):
    """Different task names don't contend — a slow job locks only itself."""
    name_a = f"test-lock-a-{uuid4()}"
    name_b = f"test-lock-b-{uuid4()}"

    async with test_engine.connect() as conn_a, test_engine.connect() as conn_b:
        await conn_a.execution_options(isolation_level="AUTOCOMMIT")
        await conn_b.execution_options(isolation_level="AUTOCOMMIT")

        got_a = await conn_a.execute(_LOCK_SQL, {"name": name_a})
        got_b = await conn_b.execute(_LOCK_SQL, {"name": name_b})

        assert bool(got_a.scalar()) is True
        assert bool(got_b.scalar()) is True

        await conn_a.execute(_UNLOCK_SQL, {"name": name_a})
        await conn_b.execute(_UNLOCK_SQL, {"name": name_b})


# ---------------------------------------------------------------------------
# Committed-row fixture for the due-row poll
# ---------------------------------------------------------------------------


@dataclass
class _FakeDispatchResponse:
    """Stand-in for ``WorkflowDispatchResponse``."""

    execution_id: str
    runner_id: UUID


@pytest_asyncio.fixture
async def sched_db(test_engine):
    """A committed user + workflow, plus the engine to hand the job under test.

    ``poll_and_dispatch_due`` / ``fire_scheduled_run`` open their OWN sessions,
    so these rows must be committed. The engine is passed to them explicitly
    (``engine=sched_db.engine``) rather than monkeypatched onto
    ``app.db.session``, so nothing outside the call under test is redirected.
    """
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async with maker() as session:
        user = User(
            email=f"sched_{uuid4()}@example.com",
            username=f"sched_{uuid4().hex[:8]}",
            full_name="Scheduler Test User",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        workflow = UnifiedWorkflow(created_by_user_id=user.id, name="sched-wf")
        session.add(workflow)
        await session.commit()
        await session.refresh(workflow)

    yield SimpleNamespace(maker=maker, engine=test_engine, user=user, workflow=workflow)

    # Scoped to rows this fixture owns. An unfiltered DELETE here would wipe the
    # schedule rows of every other test sharing this database.
    async with maker() as session:
        await session.execute(
            delete(ScheduledWorkflowRun).where(
                ScheduledWorkflowRun.workflow_id == workflow.id
            )
        )
        await session.execute(
            delete(UnifiedWorkflow).where(UnifiedWorkflow.id == workflow.id)
        )
        await session.execute(delete(User).where(User.id == user.id))
        await session.commit()


async def _seed(
    sched_db,
    *,
    cron: str = "*/15 * * * *",
    enabled: bool = True,
    next_fire_at: datetime | None,
    name: str = "row",
) -> ScheduledWorkflowRun:
    """Insert a committed schedule row with an exact ``next_fire_at``."""
    async with sched_db.maker() as session:
        row = ScheduledWorkflowRun(
            user_id=sched_db.user.id,
            workflow_id=sched_db.workflow.id,
            name=name,
            cron_expression=cron,
            target="auto",
            enabled=enabled,
            next_fire_at=next_fire_at,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def _reload(sched_db, row_id: UUID) -> ScheduledWorkflowRun:
    async with sched_db.maker() as session:
        fresh: ScheduledWorkflowRun | None = await session.get(
            ScheduledWorkflowRun, row_id
        )
        assert fresh is not None
        return fresh


def _patch_dispatcher(monkeypatch, *, raises: Exception | None = None) -> AsyncMock:
    """Patch the dispatcher on the job module. Never hits a real runner."""
    mock = AsyncMock()
    if raises is not None:
        mock.side_effect = raises
    else:
        mock.return_value = _FakeDispatchResponse(
            execution_id=str(uuid4()), runner_id=uuid4()
        )
    monkeypatch.setattr("app.jobs.scheduled_dispatch.dispatch_workflow_to_runner", mock)
    return mock


def _own_dispatches(dispatch: AsyncMock, sched_db) -> list:
    """The patched dispatcher's awaits for THIS fixture's workflow only.

    The poll has no user filter, so a row seeded by another test can be claimed
    in the same sweep and would inflate a bare ``await_count``.
    """
    return [
        call
        for call in dispatch.await_args_list
        if call.kwargs.get("workflow_id") == sched_db.workflow.id
    ]


# ---------------------------------------------------------------------------
# poll_and_dispatch_due — row selection
# ---------------------------------------------------------------------------


class TestDueRowSelection:
    @pytest.mark.asyncio
    async def test_only_enabled_and_due_rows_fire(self, sched_db, monkeypatch):
        """Disabled, future, and NULL-next_fire_at rows are all skipped."""
        dispatch = _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)

        due = await _seed(sched_db, next_fire_at=now - timedelta(minutes=1), name="due")
        disabled_but_due = await _seed(
            sched_db,
            enabled=False,
            next_fire_at=now - timedelta(minutes=1),
            name="disabled",
        )
        not_yet = await _seed(
            sched_db, next_fire_at=now + timedelta(hours=1), name="future"
        )
        never = await _seed(sched_db, next_fire_at=None, name="null")

        stats = await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # `stats` counts the whole table, so assert on OUR rows: of the four
        # seeded, exactly one — the due, enabled one — reached the dispatcher.
        assert stats["dispatched"] >= 1
        own = _own_dispatches(dispatch, sched_db)
        assert len(own) == 1
        assert own[0].kwargs["workflow_id"] == sched_db.workflow.id

        # Only the due row moved.
        fired = await _reload(sched_db, due.id)
        assert fired.last_status == "dispatched"
        assert fired.last_fired_at is not None
        assert fired.next_fire_at is not None and fired.next_fire_at > now

        for untouched_id in (disabled_but_due.id, not_yet.id, never.id):
            row = await _reload(sched_db, untouched_id)
            assert row.last_status is None
            assert row.last_fired_at is None

        # A disabled row and a future row keep their seeded next_fire_at.
        assert (await _reload(sched_db, disabled_but_due.id)).next_fire_at is not None
        future_row = await _reload(sched_db, not_yet.id)
        assert future_row.next_fire_at is not None
        assert future_row.next_fire_at > now + timedelta(minutes=30)

        # The enabled row with a NULL next_fire_at is *anchored* onto its cron —
        # it is not fired (asserted above: no last_status), and it is not left
        # NULL either, or it would never fire again. See TestAnchoring.
        anchored = await _reload(sched_db, never.id)
        assert anchored.next_fire_at is not None
        assert anchored.next_fire_at > now

    @pytest.mark.asyncio
    async def test_no_due_rows_is_a_no_op(self, sched_db, monkeypatch):
        dispatch = _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)
        future = now + timedelta(hours=1)
        row = await _seed(sched_db, next_fire_at=future)

        await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # Nothing of OURS was due, so the sweep left the row completely alone —
        # not dispatched, and `next_fire_at` not advanced. (A bare
        # `stats == {"due": 0, ...}` asserted that about the whole table.)
        assert _own_dispatches(dispatch, sched_db) == []
        fresh = await _reload(sched_db, row.id)
        assert fresh.last_status is None
        assert fresh.last_fired_at is None
        assert fresh.next_fire_at == future


# ---------------------------------------------------------------------------
# poll_and_dispatch_due — at-most-once-per-window
# ---------------------------------------------------------------------------


class TestNextFireAdvance:
    @pytest.mark.asyncio
    async def test_overdue_row_advances_from_now_not_from_missed_slot(
        self, sched_db, monkeypatch
    ):
        """After downtime, a badly-overdue row fires ONCE and resumes on-cadence.

        Regression: advancing from the missed slot (``old + 15min``) would leave
        ``next_fire_at`` still hours in the past, so the row would re-fire on
        every 30s tick until it had replayed every missed window.
        """
        dispatch = _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)
        missed = now - timedelta(hours=3)

        row = await _seed(sched_db, cron="*/15 * * * *", next_fire_at=missed)

        await poll_and_dispatch_due(now=now, engine=sched_db.engine)
        assert len(_own_dispatches(dispatch, sched_db)) == 1

        fresh = await _reload(sched_db, row.id)
        assert fresh.next_fire_at is not None
        # Strictly in the FUTURE — the whole point.
        assert fresh.next_fire_at > now
        # ...and within one cron window of now, not of the missed slot.
        assert fresh.next_fire_at <= now + timedelta(minutes=15)
        assert fresh.next_fire_at > missed + timedelta(hours=2)

        # A second poll at the same instant does not re-claim OUR row — at most
        # once per window. (`stats["due"]` counts the whole table, so a foreign
        # due row would break an `== 0` here without saying anything about us.)
        await poll_and_dispatch_due(now=now, engine=sched_db.engine)
        assert len(_own_dispatches(dispatch, sched_db)) == 1
        assert (await _reload(sched_db, row.id)).next_fire_at == fresh.next_fire_at

    @pytest.mark.asyncio
    async def test_corrupt_cron_is_disabled_not_fired_and_never_loop_fires(
        self, sched_db, monkeypatch
    ):
        """A corrupt cron disables the row — it is never fired, and never loops.

        (The visible-death rationale, and the *syntactically valid but impossible*
        cron case, are covered in TestAnchoring.)
        """
        dispatch = _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)
        # Bypass the pydantic layer: this models a row corrupted in the DB.
        row = await _seed(
            sched_db, cron="not a cron", next_fire_at=now - timedelta(minutes=1)
        )

        await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # Not claimed, not dispatched — we cannot know when it should have run.
        assert _own_dispatches(dispatch, sched_db) == []

        fresh = await _reload(sched_db, row.id)
        assert fresh.enabled is False
        assert fresh.next_fire_at is None
        assert fresh.last_error is not None

        # It is now inert — no infinite re-fire loop.
        await poll_and_dispatch_due(now=now, engine=sched_db.engine)
        assert _own_dispatches(dispatch, sched_db) == []
        again = await _reload(sched_db, row.id)
        assert again.enabled is False
        assert again.next_fire_at is None


# ---------------------------------------------------------------------------
# Dispatch failure handling
# ---------------------------------------------------------------------------


class TestDispatchFailure:
    @pytest.mark.asyncio
    async def test_dispatch_error_records_failure_and_still_advances(
        self, sched_db, monkeypatch
    ):
        """A DispatchError is recorded, not raised — the next window is the retry.

        Crucially ``next_fire_at`` advances anyway. If a failing dispatch left
        the old (past) ``next_fire_at`` in place, the row would be re-claimed on
        every 30s tick and hammer the runner forever.
        """
        _patch_dispatcher(
            monkeypatch,
            raises=DispatchError(
                status_code=503,
                code="no_healthy_runner",
                detail={"message": "no runners online"},
            ),
        )
        now = datetime.now(UTC)
        row = await _seed(
            sched_db, cron="*/15 * * * *", next_fire_at=now - timedelta(minutes=1)
        )

        stats = await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # A failure was counted, and the row assertions below prove it was OURS —
        # recorded as `failed`, not swallowed as `skipped` and not raised.
        # (`stats` is a whole-table histogram: a concurrently-seeded row would
        # break an equality against a literal without changing this test's
        # meaning, so only the lower bound is asserted here.)
        assert stats["failed"] >= 1

        fresh = await _reload(sched_db, row.id)
        assert fresh.last_status == "failed"
        assert fresh.last_fired_at is not None
        assert fresh.last_error is not None
        assert "no_healthy_runner" in fresh.last_error
        assert "no runners online" in fresh.last_error
        # Advanced despite the failure.
        assert fresh.next_fire_at is not None
        assert fresh.next_fire_at > now

    @pytest.mark.asyncio
    async def test_row_disabled_between_claim_and_fire_counts_as_skipped(
        self, sched_db, monkeypatch
    ):
        """A row disabled mid-window is `skipped`, NOT `failed`.

        The poll claims due rows and commits, then fires them. A row disabled in
        that gap is a benign race. Folding it into `failed` would contaminate the
        one metric an operator alerts on, manufacturing phantom dispatch failures
        out of ordinary user edits.
        """
        _patch_dispatcher(monkeypatch)  # would succeed if it ever got called
        now = datetime.now(UTC)
        row = await _seed(
            sched_db, cron="*/15 * * * *", next_fire_at=now - timedelta(minutes=1)
        )

        # Disable the row *after* the poll claims it but *before* it fires.
        # Only OUR row: a concurrently-seeded row from another test must not be
        # disabled as a side effect of this one.
        real_fire = scheduled_dispatch_mod.fire_scheduled_run
        outcomes: dict[str, dict] = {}

        async def _disable_then_fire(run_id: str, **kwargs):
            if run_id == str(row.id):
                async with sched_db.maker() as other:
                    target = await other.get(ScheduledWorkflowRun, UUID(run_id))
                    target.enabled = False
                    await other.commit()
            result = await real_fire(run_id, **kwargs)
            outcomes[run_id] = result
            return result

        monkeypatch.setattr(
            scheduled_dispatch_mod, "fire_scheduled_run", _disable_then_fire
        )

        stats = await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # OUR row landed in the `skipped` bucket — the bucket, and the reason,
        # are read off its own fire result rather than off a whole-table
        # histogram equality that a foreign due row would break.
        assert outcomes[str(row.id)] == {"status": "skipped", "reason": "disabled"}
        assert stats["skipped"] >= 1

        fresh = await _reload(sched_db, row.id)
        assert fresh.last_status is None  # never actually fired
        assert fresh.last_error is None  # and NOT recorded as an error

    @pytest.mark.asyncio
    async def test_fire_scheduled_run_does_not_raise_on_dispatch_error(
        self, sched_db, monkeypatch
    ):
        """The core swallows DispatchError — an unhandled raise would kill the tick."""
        _patch_dispatcher(
            monkeypatch,
            raises=DispatchError(
                status_code=404, code="runner_offline", detail="runner is gone"
            ),
        )
        row = await _seed(sched_db, next_fire_at=datetime.now(UTC))

        result = await fire_scheduled_run(str(row.id), engine=sched_db.engine)

        assert result["status"] == "failed"
        assert result["reason"] == "dispatch_error"
        # The dispatcher's own status/code ride along, so the interactive
        # run-now endpoint can re-raise the REAL cause instead of a fake 200.
        assert result["status_code"] == 404
        assert result["code"] == "runner_offline"
        assert "runner is gone" in result["error"]


# ---------------------------------------------------------------------------
# fire_scheduled_run — guard rails
# ---------------------------------------------------------------------------


class TestFireGuards:
    @pytest.mark.asyncio
    async def test_missing_row_is_skipped(self, sched_db, monkeypatch):
        """Row deleted since it was claimed → skip, don't crash."""
        dispatch = _patch_dispatcher(monkeypatch)

        result = await fire_scheduled_run(str(uuid4()), engine=sched_db.engine)

        assert result == {"status": "skipped", "reason": "row_missing"}
        dispatch.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_disabled_row_is_skipped(self, sched_db, monkeypatch):
        """Disabled between claim and fire → skip without dispatching."""
        dispatch = _patch_dispatcher(monkeypatch)
        row = await _seed(sched_db, enabled=False, next_fire_at=None)

        result = await fire_scheduled_run(str(row.id), engine=sched_db.engine)

        assert result == {"status": "skipped", "reason": "disabled"}
        dispatch.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_successful_fire_records_execution_id(self, sched_db, monkeypatch):
        dispatch = _patch_dispatcher(monkeypatch)
        row = await _seed(sched_db, next_fire_at=datetime.now(UTC))

        result = await fire_scheduled_run(str(row.id), engine=sched_db.engine)

        assert result["status"] == "dispatched"
        expected = dispatch.return_value
        assert result["execution_id"] == expected.execution_id

        fresh = await _reload(sched_db, row.id)
        assert fresh.last_status == "dispatched"
        assert fresh.last_execution_id == expected.execution_id
        assert fresh.last_error is None

    @pytest.mark.asyncio
    async def test_manual_fire_does_not_touch_next_fire_at(self, sched_db, monkeypatch):
        """``run-now`` calls this directly — it must not shift the cron schedule."""
        _patch_dispatcher(monkeypatch)
        pinned = datetime.now(UTC) + timedelta(hours=2)
        row = await _seed(sched_db, next_fire_at=pinned)

        await fire_scheduled_run(str(row.id), engine=sched_db.engine)

        fresh = await _reload(sched_db, row.id)
        assert fresh.next_fire_at == pinned


# ---------------------------------------------------------------------------
# Anchoring + visible bad-cron death
# ---------------------------------------------------------------------------


class TestAnchoring:
    """NULL next_fire_at means 'enabled but unscheduled' — anchor, don't fire.

    The migration deliberately does NOT backfill `next_fire_at = now()`. Doing so
    would make every dormant enabled schedule due at once, and the first tick
    after deploy would dispatch the lot off-cron — real GUI automation firing
    unattended on users' desktops at deploy time. Since RedBeat never actually
    fired, the population of enabled-but-never-run schedules is exactly what that
    would have hit.
    """

    @pytest.mark.asyncio
    async def test_null_next_fire_at_is_anchored_not_fired(self, sched_db, monkeypatch):
        dispatch = _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)
        # A legacy row as the migration leaves it: enabled, never scheduled.
        row = await _seed(sched_db, cron="0 3 * * *", next_fire_at=None)

        await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # Anchored onto its cron — and emphatically NOT dispatched.
        assert _own_dispatches(dispatch, sched_db) == []

        fresh = await _reload(sched_db, row.id)
        assert fresh.next_fire_at is not None
        assert fresh.next_fire_at > now
        assert fresh.next_fire_at == croniter("0 3 * * *", now).get_next(datetime)
        assert fresh.last_status is None  # never fired

    @pytest.mark.asyncio
    async def test_disabled_null_row_is_left_alone(self, sched_db, monkeypatch):
        """Anchoring only touches ENABLED rows."""
        _patch_dispatcher(monkeypatch)
        row = await _seed(sched_db, cron="0 3 * * *", enabled=False, next_fire_at=None)

        await poll_and_dispatch_due(now=datetime.now(UTC), engine=sched_db.engine)

        fresh = await _reload(sched_db, row.id)
        assert fresh.next_fire_at is None

    @pytest.mark.asyncio
    async def test_unsatisfiable_cron_disables_the_row_visibly(
        self, sched_db, monkeypatch
    ):
        """A cron croniter cannot advance DISABLES the row, with the reason.

        Nulling next_fire_at and leaving `enabled=True` would be a silent death:
        the poll's `next_fire_at IS NOT NULL` predicate excludes the row forever
        while the API still reports a live schedule. That is precisely the
        invisible-no-op this whole change exists to abolish — so the row is
        disabled and the error recorded where the user can see it.
        """
        _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)
        # Valid syntax (croniter.is_valid is True), but February has no 30th.
        row = await _seed(
            sched_db, cron="0 0 30 2 *", next_fire_at=now - timedelta(minutes=1)
        )

        await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        fresh = await _reload(sched_db, row.id)
        assert fresh.enabled is False  # visibly dead, not silently
        assert fresh.next_fire_at is None
        assert fresh.last_status == "failed"
        assert fresh.last_error is not None
        assert "0 0 30 2 *" in fresh.last_error

        # And being disabled, it is not re-anchored on the next tick either.
        await poll_and_dispatch_due(now=now, engine=sched_db.engine)
        again = await _reload(sched_db, row.id)
        assert again.enabled is False
        assert again.next_fire_at is None


# ---------------------------------------------------------------------------
# The engine seam — no process-global rebinding
# ---------------------------------------------------------------------------


class TestEngineInjection:
    @pytest.mark.asyncio
    async def test_both_halves_of_the_poll_use_the_injected_engine(
        self, sched_db, monkeypatch
    ):
        """The claim AND the fire run on the engine handed in, not the global one.

        ``poll_and_dispatch_due`` claims rows on one session, then fires each
        claimed row through ``fire_scheduled_run``, which opens a session of its
        OWN. Threading the engine into the claim but not the fire would be worse
        than not threading it at all: the claim would hit the test database while
        the fire hit the process-global engine, where this row does not exist —
        so the fire would return ``skipped``/``row_missing`` and never write
        ``last_status``.

        Reading the dispatch back OFF the row THROUGH the test engine is
        therefore the proof that both halves landed on the injected engine, and
        nothing rebound ``app.db.session.async_engine`` to get there.
        """
        dispatch = _patch_dispatcher(monkeypatch)
        now = datetime.now(UTC)
        row = await _seed(sched_db, next_fire_at=now - timedelta(minutes=1))

        stats = await poll_and_dispatch_due(now=now, engine=sched_db.engine)

        # The CLAIM half saw the row on the injected engine...
        assert stats["dispatched"] >= 1
        assert len(_own_dispatches(dispatch, sched_db)) == 1

        fresh = await _reload(sched_db, row.id)
        assert fresh.next_fire_at is not None and fresh.next_fire_at > now

        # ...and the FIRE half wrote its outcome there too.
        assert fresh.last_status == "dispatched"
        assert fresh.last_fired_at is not None
        assert fresh.last_execution_id == dispatch.return_value.execution_id
        assert fresh.last_error is None

    @pytest.mark.asyncio
    async def test_fixture_leaves_the_process_global_engine_alone(self, sched_db):
        """The fixture must not repoint ``app.db.session.async_engine``.

        Rebinding it is what aimed the app's own live cron sweeper at the test
        database (web#901). This asserts the seam is the ONLY mechanism in play.
        """
        from app.db import session as db_session

        assert db_session.async_engine is not sched_db.engine
