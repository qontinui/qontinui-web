"""Unit tests for the in-process asyncio scheduler (:mod:`app.core.scheduler`).

This is the substrate that replaced Celery + RedBeat. It is the *only* thing
that makes periodic work run at all now, so the invariants below are the ones
that keep a silently-dead schedule from shipping again:

* **cron maths** — the four ported cadences fire at the times the old beat
  schedule fired.
* **honest observability** — a never-run task reports ``last_run_at=None`` with
  the key PRESENT. Absence of evidence must stay visible; that's how you notice
  a schedule that isn't firing.
* **failure isolation** — one task raising must not kill the loop.
* **timeout** — a wedged core is cancelled and recorded, and its advisory lock
  is released (else the next replica's tick blocks forever).
* **no self-overlap** — a slow task is not re-fired on top of itself.
* **concurrency** — a long task must NOT starve a short-cadence one. This is the
  regression that would silently stop the 30s dispatch poll behind a 10-minute
  memory consolidation.

**No Postgres needed.** ``_run_under_lock`` reaches the DB through a *lazy*
``from app.db.session import async_engine``, so monkeypatching that module
attribute with :class:`_FakeLockEngine` lets these tests exercise the REAL
locking code path (including the unlock-in-``finally``) against a fake
connection. The genuine ``pg_try_advisory_lock`` mutual-exclusion semantics are
covered against live Postgres in ``tests/test_scheduler_db.py``.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.core.scheduler import (
    INTERVAL_JITTER_SECONDS,
    ScheduledTask,
    SchedulerService,
    _env_token,
    install_default_tasks,
    scheduler_status,
)

# A Monday, so the "Sunday" cron has an unambiguous next slot.
NOW = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Fake advisory-lock engine
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, value: bool) -> None:
        self._value = value

    def scalar(self) -> bool:
        return self._value


class _FakeConn:
    def __init__(self, engine: _FakeLockEngine) -> None:
        self._engine = engine

    async def execution_options(self, **kwargs) -> _FakeConn:
        self._engine.isolation_levels.append(kwargs.get("isolation_level"))
        return self

    async def execute(self, stmt, params=None) -> _FakeResult:
        sql = str(stmt)
        name = str((params or {}).get("name"))
        if "pg_try_advisory_lock" in sql:
            self._engine.lock_calls.append(name)
            granted = self._engine.grant
            if granted:
                self._engine.held.add(name)
            return _FakeResult(granted)
        if "pg_advisory_unlock" in sql:
            self._engine.unlock_calls.append(name)
            self._engine.held.discard(name)
            return _FakeResult(True)
        raise AssertionError(f"unexpected SQL in scheduler lock path: {sql!r}")


class _FakeConnCtx:
    def __init__(self, engine: _FakeLockEngine) -> None:
        self._engine = engine

    async def __aenter__(self) -> _FakeConn:
        self._engine.connects += 1
        return _FakeConn(self._engine)

    async def __aexit__(self, *exc) -> bool:
        return False


class _FakeLockEngine:
    """Stands in for ``app.db.session.async_engine`` in the lock path."""

    def __init__(self, *, grant: bool = True) -> None:
        self.grant = grant
        self.connects = 0
        self.lock_calls: list[str] = []
        self.unlock_calls: list[str] = []
        self.isolation_levels: list[str | None] = []
        self.held: set[str] = set()

    def connect(self) -> _FakeConnCtx:
        return _FakeConnCtx(self)


@pytest.fixture
def lock_engine(monkeypatch) -> _FakeLockEngine:
    """Patch the scheduler's advisory-lock engine; always grants the lock."""
    engine = _FakeLockEngine(grant=True)
    monkeypatch.setattr("app.db.session.async_engine", engine)
    return engine


class _EveryTick(ScheduledTask):
    """A task whose next fire is always ~immediately.

    The loop's own floor (``max(0.5, ...)``) keeps the real cadence at ~0.5s.
    Overriding ``compute_next`` removes the ±30s interval jitter, which would
    otherwise make loop timing untestable — the jitter maths itself is covered
    by :class:`TestIntervalJitter`.
    """

    def compute_next(self, now: datetime) -> datetime:
        return now + timedelta(seconds=0.01)


def _due_now(task: ScheduledTask) -> ScheduledTask:
    """Mark ``task`` due, so the loop fires it on its very first tick.

    ``_run_loop`` only seeds ``next_run_at`` when it is ``None``, so a
    pre-set past value survives and makes the first tick deterministic.
    """
    task.next_run_at = datetime.now(UTC) - timedelta(seconds=1)
    return task


async def _wait_for(predicate, *, timeout: float = 5.0) -> bool:
    """Poll ``predicate`` until true or ``timeout`` elapses."""
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.02)
    return False


# ---------------------------------------------------------------------------
# Cron next-fire maths — the four ported cadences
# ---------------------------------------------------------------------------


class TestQueueLivenessCadence:
    """The job reaper must never inherit a retention cadence.

    It is the only path that returns an abandoned ``claimed`` job to the
    queue — nothing hands out a claimed row and nothing re-enqueues over
    it — so a slow cadence silently strands work rather than merely
    delaying cleanup.
    """

    def test_memory_reap_is_registered_frequently_and_at_boot(self) -> None:
        service = SchedulerService()
        install_default_tasks(service)

        task = service._tasks["memory_reap"]

        assert task.cron == "*/10 * * * *", (
            "memory_reap fell back to a slow cadence — an abandoned claim "
            "blocks both claim and re-enqueue until it is reaped"
        )
        assert task.run_at_boot, (
            "a deploy that kills a runner mid-claim must not need a full "
            "cron slot before the queue self-heals"
        )


class TestCronNextFire:
    """``compute_next`` must reproduce the former Celery beat schedule exactly."""

    @pytest.mark.parametrize(
        ("cron", "expected"),
        [
            # memory_decay — daily 03:10 UTC.
            ("10 3 * * *", datetime(2026, 7, 14, 3, 10, tzinfo=UTC)),
            # memory_reindex — every 10 minutes (was daily 03:40; corrected so
            # API-written rows get embedded within a tick, not up to ~24h later).
            ("*/10 * * * *", datetime(2026, 7, 13, 12, 10, tzinfo=UTC)),
            # memory_consolidate — every 10 minutes (was weekly Sundays 04:20;
            # corrected so the memory feedback loop stays prompt).
            ("*/10 * * * *", datetime(2026, 7, 13, 12, 10, tzinfo=UTC)),
            # memory_reap — every 10 minutes (was bundled into the daily
            # memory_decay; split out so an abandoned claim is requeued within
            # a tick of going stale rather than up to ~24h later).
            ("*/10 * * * *", datetime(2026, 7, 13, 12, 10, tzinfo=UTC)),
            # memory_bridge_sync — every 15 minutes.
            ("*/15 * * * *", datetime(2026, 7, 13, 12, 15, tzinfo=UTC)),
        ],
    )
    def test_ported_cadences(self, cron: str, expected: datetime):
        task = ScheduledTask(name="t", coro=_noop, cron=cron)

        assert task.compute_next(NOW) == expected

    def test_next_fire_is_utc_aware(self):
        task = ScheduledTask(name="t", coro=_noop, cron="*/15 * * * *")

        nxt = task.compute_next(NOW)

        assert nxt.tzinfo is not None
        assert nxt.utcoffset() == timedelta(0)

    def test_just_before_boundary_fires_this_slot(self):
        """23:59:59-style edge: the imminent slot is still ahead, not skipped."""
        task = ScheduledTask(name="t", coro=_noop, cron="10 3 * * *")
        just_before = datetime(2026, 7, 13, 3, 9, 59, tzinfo=UTC)

        assert task.compute_next(just_before) == datetime(
            2026, 7, 13, 3, 10, tzinfo=UTC
        )

    def test_exactly_on_boundary_fires_next_slot(self):
        """Sitting exactly on a slot yields the NEXT one — never re-fires now."""
        task = ScheduledTask(name="t", coro=_noop, cron="*/15 * * * *")
        on_slot = datetime(2026, 7, 13, 12, 15, tzinfo=UTC)

        nxt = task.compute_next(on_slot)

        assert nxt == datetime(2026, 7, 13, 12, 30, tzinfo=UTC)
        assert nxt > on_slot


async def _noop() -> None:
    """A do-nothing coro for tasks whose body is irrelevant to the test."""
    return None


# ---------------------------------------------------------------------------
# Interval + jitter
# ---------------------------------------------------------------------------


class TestIntervalJitter:
    """Interval cadences land within ±30s of the nominal interval."""

    def test_next_fire_within_jitter_band(self):
        task = ScheduledTask(name="t", coro=_noop, interval_seconds=60.0)
        low = NOW + timedelta(seconds=60.0 - INTERVAL_JITTER_SECONDS)
        high = NOW + timedelta(seconds=60.0 + INTERVAL_JITTER_SECONDS)

        for _ in range(200):
            nxt = task.compute_next(NOW)
            assert low <= nxt <= high
            assert nxt > NOW

    def test_jitter_is_actually_applied(self):
        """Two draws must differ — a fixed delay would thundering-herd."""
        task = ScheduledTask(name="t", coro=_noop, interval_seconds=60.0)

        draws = {task.compute_next(NOW) for _ in range(50)}

        assert len(draws) > 1

    def test_short_interval_never_lands_in_the_past(self):
        """The 1s floor holds even when jitter would go negative."""
        task = ScheduledTask(name="t", coro=_noop, interval_seconds=5.0)

        for _ in range(200):
            assert task.compute_next(NOW) > NOW


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidation:
    """Exactly one cadence, and it must be a real cron."""

    def test_both_cadences_rejected(self):
        with pytest.raises(ValueError, match="exactly one"):
            ScheduledTask(
                name="t", coro=_noop, cron="*/15 * * * *", interval_seconds=30.0
            )

    def test_neither_cadence_rejected(self):
        with pytest.raises(ValueError, match="exactly one"):
            ScheduledTask(name="t", coro=_noop)

    def test_invalid_cron_rejected(self):
        with pytest.raises(ValueError, match="invalid cron"):
            ScheduledTask(name="t", coro=_noop, cron="not a cron")

    def test_duplicate_registration_rejected(self):
        service = SchedulerService()
        service.register(ScheduledTask(name="dupe", coro=_noop, interval_seconds=30.0))

        with pytest.raises(ValueError, match="duplicate"):
            service.register(
                ScheduledTask(name="dupe", coro=_noop, interval_seconds=30.0)
            )

    def test_env_token_mapping(self):
        """``<TASK>`` in the kill-switch env var is upper-snake."""
        assert _env_token("memory_bridge_sync") == "MEMORY_BRIDGE_SYNC"
        assert _env_token("scheduled-dispatch") == "SCHEDULED_DISPATCH"


# ---------------------------------------------------------------------------
# Observability — a dead schedule must be VISIBLE
# ---------------------------------------------------------------------------


class TestObservability:
    def test_never_run_task_reports_null_last_run_at(self):
        """The key is PRESENT with a None value — not absent.

        This is the whole point of the status map: you can tell "registered but
        never fired" apart from "not registered", which is exactly the failure
        that hid the dead Celery schedule.
        """
        service = SchedulerService()
        service.register(
            ScheduledTask(name="never_ran", coro=_noop, cron="*/15 * * * *")
        )

        snap = service.status()["never_ran"]

        assert "last_run_at" in snap
        assert snap["last_run_at"] is None
        assert snap["last_status"] is None
        assert snap["last_duration_ms"] is None
        assert snap["enabled"] is True
        assert snap["cadence"] == "cron:*/15 * * * *"

    def test_status_reports_interval_cadence(self):
        service = SchedulerService()
        service.register(ScheduledTask(name="t", coro=_noop, interval_seconds=30.0))

        assert service.status()["t"]["cadence"] == "interval:30.0s"

    def test_module_scheduler_status_shape(self):
        """``/health`` payload carries enabled/running/tasks."""
        status = scheduler_status()

        assert set(status) == {"enabled", "running", "tasks"}
        assert "scheduled_dispatch" in status["tasks"]


# ---------------------------------------------------------------------------
# Kill-switches
# ---------------------------------------------------------------------------


class TestKillSwitches:
    @pytest.mark.asyncio
    async def test_global_kill_switch_no_ops_start(self, monkeypatch, lock_engine):
        """QONTINUI_SCHEDULER_ENABLED=0 → start() does nothing at all."""
        monkeypatch.setenv("QONTINUI_SCHEDULER_ENABLED", "0")
        ran = []
        service = SchedulerService()

        async def _job() -> None:
            ran.append(1)

        service.register(
            _due_now(_EveryTick(name="t", coro=_job, interval_seconds=0.01))
        )

        await service.start()
        await asyncio.sleep(0.6)

        assert service.running is False
        assert service.enabled is False
        assert ran == []
        assert lock_engine.lock_calls == []
        await service.stop()

    @pytest.mark.asyncio
    async def test_per_task_kill_switch_keeps_task_registered_but_idle(
        self, monkeypatch, lock_engine
    ):
        """A disabled task stays visible in status() but never fires."""
        monkeypatch.setenv("QONTINUI_SCHEDULER_OFF_TASK_ENABLED", "0")
        off_ran: list[int] = []
        on_ran: list[int] = []

        async def _off() -> None:
            off_ran.append(1)

        async def _on() -> None:
            on_ran.append(1)

        service = SchedulerService()
        service.register(
            _due_now(_EveryTick(name="off_task", coro=_off, interval_seconds=0.01))
        )
        service.register(
            _due_now(_EveryTick(name="on_task", coro=_on, interval_seconds=0.01))
        )

        await service.start()
        try:
            assert await _wait_for(lambda: len(on_ran) >= 2)
        finally:
            await service.stop()

        status = service.status()
        assert status["off_task"]["enabled"] is False
        assert status["on_task"]["enabled"] is True
        # Registered, visible — and never ran.
        assert off_ran == []
        assert status["off_task"]["last_run_at"] is None
        assert "off_task" not in lock_engine.lock_calls


# ---------------------------------------------------------------------------
# Locking behaviour (against the fake engine)
# ---------------------------------------------------------------------------


class TestLockGating:
    @pytest.mark.asyncio
    async def test_lock_taken_and_released_on_autocommit_conn(self, lock_engine):
        ran: list[int] = []

        async def _job() -> None:
            ran.append(1)

        service = SchedulerService()
        service.register(
            _due_now(_EveryTick(name="locked", coro=_job, interval_seconds=0.01))
        )

        await service.start()
        try:
            assert await _wait_for(lambda: len(ran) >= 1)
        finally:
            await service.stop()

        assert "locked" in lock_engine.lock_calls
        # Released in the finally — a leaked lock would wedge every replica.
        assert "locked" in lock_engine.unlock_calls
        assert lock_engine.held == set()
        assert "AUTOCOMMIT" in lock_engine.isolation_levels

    @pytest.mark.asyncio
    async def test_losing_the_lock_skips_the_tick(self, monkeypatch):
        """Another replica holds the lock → we skip silently, recording nothing."""
        engine = _FakeLockEngine(grant=False)
        monkeypatch.setattr("app.db.session.async_engine", engine)
        ran: list[int] = []

        async def _job() -> None:
            ran.append(1)

        service = SchedulerService()
        service.register(
            _due_now(_EveryTick(name="contended", coro=_job, interval_seconds=0.01))
        )

        await service.start()
        try:
            assert await _wait_for(lambda: len(engine.lock_calls) >= 1)
            await asyncio.sleep(0.3)
        finally:
            await service.stop()

        assert ran == []
        assert service.status()["contended"]["last_run_at"] is None


# ---------------------------------------------------------------------------
# Failure isolation / timeout / overlap / concurrency
# ---------------------------------------------------------------------------


class TestRunSemantics:
    @pytest.mark.asyncio
    async def test_failing_task_is_recorded_and_loop_survives(self, lock_engine):
        """One task raising must not kill the loop or its siblings."""
        ok_ran: list[int] = []

        async def _boom() -> None:
            raise RuntimeError("job exploded")

        async def _ok() -> None:
            ok_ran.append(1)

        service = SchedulerService()
        service.register(
            _due_now(_EveryTick(name="boom", coro=_boom, interval_seconds=0.01))
        )
        service.register(
            _due_now(_EveryTick(name="fine", coro=_ok, interval_seconds=0.01))
        )

        await service.start()
        try:
            assert await _wait_for(
                lambda: service.status()["boom"]["last_status"] == "failed"
            )
            # The loop keeps ticking: the healthy task fires again AFTER the
            # failure was recorded.
            fired_at_failure = len(ok_ran)
            assert await _wait_for(lambda: len(ok_ran) > fired_at_failure)

            assert service.running is True
            assert service.status()["fine"]["last_status"] == "ok"
        finally:
            await service.stop()

        # Even a failed run releases its advisory lock.
        assert "boom" in lock_engine.unlock_calls
        assert lock_engine.held == set()

    @pytest.mark.asyncio
    async def test_timeout_is_recorded_and_lock_released(self, lock_engine):
        """A wedged core is cancelled, recorded ``timeout``, and unlocked."""

        async def _wedged() -> None:
            await asyncio.sleep(30)

        service = SchedulerService()
        service.register(
            _due_now(
                _EveryTick(
                    name="wedged",
                    coro=_wedged,
                    interval_seconds=0.01,
                    timeout_seconds=0.05,
                )
            )
        )

        await service.start()
        try:
            assert await _wait_for(
                lambda: service.status()["wedged"]["last_status"] == "timeout"
            )
        finally:
            await service.stop()

        snap = service.status()["wedged"]
        assert snap["last_status"] == "timeout"
        assert snap["last_run_at"] is not None
        # The lock MUST come back — otherwise the next tick (on any replica)
        # blocks behind a core that is already dead.
        assert "wedged" in lock_engine.unlock_calls
        assert lock_engine.held == set()

    @pytest.mark.asyncio
    async def test_slow_task_does_not_overlap_itself(self, lock_engine):
        """A still-running task is not re-fired by a later tick."""
        starts: list[int] = []
        release = asyncio.Event()

        async def _slow() -> None:
            starts.append(1)
            await release.wait()

        service = SchedulerService()
        service.register(
            _due_now(_EveryTick(name="slow", coro=_slow, interval_seconds=0.01))
        )

        await service.start()
        try:
            assert await _wait_for(lambda: len(starts) == 1)
            # Several loop ticks elapse (the loop floor is 0.5s) while the run
            # is still in flight. It must NOT be started a second time.
            await asyncio.sleep(1.6)
            assert starts == [1]

            release.set()
            # Once it completes, the task becomes eligible again.
            assert await _wait_for(lambda: len(starts) >= 2)
        finally:
            release.set()
            await service.stop()

    @pytest.mark.asyncio
    async def test_long_task_does_not_starve_short_cadence_task(self, lock_engine):
        """Starvation regression: due tasks fire CONCURRENTLY, not serially.

        If the loop awaited each due task in turn, a 10-minute
        ``memory_consolidate`` would block the 30s ``scheduled_dispatch`` poll
        for its whole duration — the schedule would look alive while dispatch
        was dead. The short task must keep firing while the long one runs.
        """
        long_started = asyncio.Event()
        long_finished = asyncio.Event()
        release_long = asyncio.Event()
        short_runs: list[int] = []

        async def _long() -> None:
            long_started.set()
            try:
                await release_long.wait()
            finally:
                long_finished.set()

        async def _short() -> None:
            short_runs.append(1)

        service = SchedulerService()
        service.register(
            _due_now(_EveryTick(name="long", coro=_long, interval_seconds=0.01))
        )
        service.register(
            _due_now(_EveryTick(name="short", coro=_short, interval_seconds=0.01))
        )

        await service.start()
        try:
            assert await _wait_for(long_started.is_set)
            # The short task fires repeatedly WHILE the long one is in flight.
            assert await _wait_for(lambda: len(short_runs) >= 2, timeout=4.0)

            assert not long_finished.is_set(), (
                "the long task finished before the assertion — it was not "
                "actually still in flight, so this proves nothing"
            )
            assert service.status()["short"]["last_status"] == "ok"
            # The long task is still holding its slot, un-recorded.
            assert service.status()["long"]["last_run_at"] is None
        finally:
            release_long.set()
            await service.stop()
