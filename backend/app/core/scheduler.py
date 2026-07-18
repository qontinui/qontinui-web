"""In-process asyncio scheduler — the substrate that replaced Celery + RedBeat.

Prod runs a single ``web: uvicorn`` process and never deployed a Celery worker
or beat, so every Celery-beat task historically never fired. This module runs
the same task *cores* directly from FastAPI's lifecycle: :func:`SchedulerService.start`
launches one background asyncio task that wakes when the next registered job is
due and runs it. If uvicorn is up, the schedule is live — zero extra processes.

Multi-replica safety
====================

Every tick that fires a task first tries a **Postgres session-level advisory
lock** keyed on the task name (``pg_try_advisory_lock(hashtext('sched:'||name))``)
on a dedicated AUTOCOMMIT connection. Exactly one replica wins the lock for a
given task at a given moment; the losers skip that tick silently. The lock is
released in a ``finally`` — including when the core times out — so a wedged
core can never hold its lock indefinitely.

Cadences
========

* **cron** — a 5-field cron string (``"10 3 * * *"``, ``"*/15 * * * *"``)
  evaluated with :mod:`croniter` in UTC. Ports the former Celery
  ``crontab(...)`` beat entries verbatim.
* **interval** — a fixed number of seconds (cleanups: 60 / 3600 / 3600, the
  dispatch poll: 30) with proportional jitter (±10% of the cadence, capped at
  ±30s) so restarts across replicas don't all fire the same second
  (thundering-herd avoidance) without distorting short cadences.

Observability
=============

An in-process status map records ``last_run_at`` / ``last_status`` /
``last_duration_ms`` per task. A task that has *never* run keeps those keys
present with ``None`` values — absence of evidence stays visible. Surfaced on
``/health`` under the ``scheduler`` key.

Kill-switches
=============

* ``QONTINUI_SCHEDULER_ENABLED`` (default on) — when off, :func:`start` no-ops.
* ``QONTINUI_SCHEDULER_<TASK>_ENABLED`` (default on) — a disabled task stays
  registered but is skipped every tick (mirrors coord's ``*_OBSERVER_ENABLED``
  idiom). ``<TASK>`` is the task name upper-cased with non-alphanumerics mapped
  to ``_`` (e.g. ``memory_bridge_sync`` → ``QONTINUI_SCHEDULER_MEMORY_BRIDGE_SYNC_ENABLED``).
"""

from __future__ import annotations

import asyncio
import os
import random
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from croniter import croniter  # type: ignore[import-untyped]

logger = structlog.get_logger(__name__)

# ±jitter applied to interval cadences (seconds).
INTERVAL_JITTER_SECONDS = 30.0
# Generous per-run wall-clock cap; a task wedged past this is cancelled and its
# advisory lock released so the next tick can retry on another replica.
DEFAULT_TIMEOUT_SECONDS = 600.0
# Longest the loop sleeps before re-evaluating (keeps shutdown responsive and
# tolerates clock skew / newly-registered work).
_MAX_SLEEP_SECONDS = 30.0

_JobCoro = Callable[[], Awaitable[Any]]


def _env_flag(key: str, *, default: bool) -> bool:
    """Read a boolean env kill-switch; unset falls back to ``default``."""
    raw = os.getenv(key)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off", "")


def _env_token(name: str) -> str:
    """``memory_bridge_sync`` → ``MEMORY_BRIDGE_SYNC`` (env-var-safe)."""
    return re.sub(r"[^0-9A-Za-z]+", "_", name).strip("_").upper()


@dataclass
class ScheduledTask:
    """A single registered job.

    Exactly one of ``cron`` / ``interval_seconds`` must be set.
    """

    name: str
    coro: _JobCoro
    cron: str | None = None
    interval_seconds: float | None = None
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    # Run once shortly after boot instead of waiting out a full interval first.
    # The cleanup loops this replaced were `while True: await cleanup(); sleep(n)`
    # — they swept at startup. Without this, a backend that restarts more often
    # than its cleanup interval would NEVER sweep (a redeploy every <1h means
    # clipboard/file cleanup, both hourly, never run at all).
    run_at_boot: bool = False
    # Runtime state (populated by the scheduler).
    enabled: bool = True
    next_run_at: datetime | None = field(default=None, compare=False)

    def __post_init__(self) -> None:
        if (self.cron is None) == (self.interval_seconds is None):
            raise ValueError(
                f"ScheduledTask {self.name!r}: set exactly one of "
                "cron / interval_seconds"
            )
        if self.cron is not None and not croniter.is_valid(self.cron):
            raise ValueError(f"ScheduledTask {self.name!r}: invalid cron {self.cron!r}")

    def first_run_at(self, now: datetime) -> datetime:
        """When this task should first fire after the scheduler starts."""
        if self.run_at_boot:
            # Not exactly `now`: a small jittered delay lets boot finish and
            # keeps N replicas from all contending for the lock the same instant.
            return now + timedelta(seconds=random.uniform(1.0, 10.0))
        return self.compute_next(now)

    def compute_next(self, now: datetime) -> datetime:
        """Next due time strictly after ``now``."""
        if self.cron is not None:
            nxt: datetime = croniter(self.cron, now).get_next(datetime)
            return nxt
        assert self.interval_seconds is not None
        # Jitter is PROPORTIONAL (capped at ±30s), not a flat ±30s: a flat band
        # on the 30s dispatch poll would give a real period anywhere in
        # [1s, 60s] — i.e. up to 30x more often than nominal — and lean on the
        # max(1.0) floor to stay positive. 10% keeps the thundering-herd spread
        # while holding each cadence close to what it says on the tin.
        band = min(INTERVAL_JITTER_SECONDS, self.interval_seconds * 0.1)
        jitter = random.uniform(-band, band)
        delay = max(1.0, self.interval_seconds + jitter)
        return now + timedelta(seconds=delay)


class SchedulerService:
    """Registry-driven asyncio scheduler with advisory-lock multi-replica gating."""

    def __init__(self) -> None:
        self._tasks: dict[str, ScheduledTask] = {}
        self._status: dict[str, dict[str, Any]] = {}
        self._loop_task: asyncio.Task[None] | None = None
        self._globally_enabled: bool = True
        # Names of tasks whose run is still in flight — prevents a slow task from
        # being re-fired by a later tick while its previous run is still going.
        self._inflight: set[str] = set()
        # Strong refs to detached per-run tasks (else the GC may collect them).
        self._runners: set[asyncio.Task[None]] = set()

    # -- registration ----------------------------------------------------

    def register(self, task: ScheduledTask) -> None:
        if task.name in self._tasks:
            raise ValueError(f"duplicate scheduled task name: {task.name!r}")
        self._tasks[task.name] = task
        self._status[task.name] = {
            "last_run_at": None,
            "last_status": None,
            "last_duration_ms": None,
        }

    # -- lifecycle -------------------------------------------------------

    async def start(self) -> None:
        """Launch the scheduler loop unless disabled by env."""
        if self._loop_task is not None:
            logger.debug("scheduler_already_started")
            return

        self._globally_enabled = _env_flag("QONTINUI_SCHEDULER_ENABLED", default=True)
        if not self._globally_enabled:
            logger.info(
                "scheduler_disabled_by_env",
                env="QONTINUI_SCHEDULER_ENABLED",
                registered_tasks=list(self._tasks),
            )
            return

        for name, task in self._tasks.items():
            task.enabled = _env_flag(
                f"QONTINUI_SCHEDULER_{_env_token(name)}_ENABLED", default=True
            )

        self._loop_task = asyncio.create_task(
            self._run_loop(), name="qontinui-scheduler"
        )
        logger.info(
            "scheduler_started",
            tasks=list(self._tasks),
            disabled=[n for n, t in self._tasks.items() if not t.enabled],
        )

    async def stop(self) -> None:
        """Cancel the loop + any in-flight runs and await a clean shutdown."""
        if self._loop_task is None:
            return
        self._loop_task.cancel()
        try:
            await self._loop_task
        except asyncio.CancelledError:
            pass
        finally:
            self._loop_task = None

        # Cancel in-flight runs and await them, so each one's `finally` releases
        # its advisory lock before the process exits (a lock leaked on a pooled
        # connection would block the next replica's tick).
        runners = list(self._runners)
        for runner in runners:
            runner.cancel()
        if runners:
            await asyncio.gather(*runners, return_exceptions=True)
        self._runners.clear()
        self._inflight.clear()
        logger.info("scheduler_stopped")

    # -- introspection ---------------------------------------------------

    @property
    def running(self) -> bool:
        return self._loop_task is not None and not self._loop_task.done()

    @property
    def enabled(self) -> bool:
        return self._globally_enabled

    def status(self) -> dict[str, Any]:
        """Per-task observability snapshot for ``/health``."""
        out: dict[str, Any] = {}
        for name, task in self._tasks.items():
            snap = dict(self._status[name])
            snap["enabled"] = task.enabled
            snap["cadence"] = (
                f"cron:{task.cron}"
                if task.cron is not None
                else f"interval:{task.interval_seconds}s"
            )
            snap["next_run_at"] = (
                task.next_run_at.isoformat() if task.next_run_at is not None else None
            )
            out[name] = snap
        return out

    # -- internals -------------------------------------------------------

    def _record(self, name: str, status: str, started: float) -> None:
        self._status[name] = {
            "last_run_at": datetime.now(UTC).isoformat(),
            "last_status": status,
            "last_duration_ms": round((time.perf_counter() - started) * 1000, 1),
        }

    async def _run_loop(self) -> None:
        now = datetime.now(UTC)
        for task in self._tasks.values():
            if task.next_run_at is None:
                task.next_run_at = task.first_run_at(now)

        while True:
            try:
                now = datetime.now(UTC)
                due = [
                    t
                    for t in self._tasks.values()
                    if t.enabled
                    and t.next_run_at is not None
                    and t.next_run_at <= now
                    and t.name not in self._inflight
                ]
                # Fire due tasks CONCURRENTLY, not sequentially: a long job (a
                # 10-minute `memory_consolidate`) must never starve a short-cadence
                # one (the 30s `scheduled_dispatch` poll). Each runs detached and
                # reschedules itself on completion; `_inflight` keeps a still-running
                # task from being re-fired by a later tick (a self-overlap the
                # advisory lock would not catch — that lock only excludes *other*
                # replicas, and it is re-entrant within one connection-per-run).
                for task in due:
                    task.next_run_at = task.compute_next(now)
                    self._inflight.add(task.name)
                    runner = asyncio.create_task(
                        self._run_and_release(task), name=f"sched:{task.name}"
                    )
                    self._runners.add(runner)
                    runner.add_done_callback(self._runners.discard)

                upcoming = [
                    t.next_run_at
                    for t in self._tasks.values()
                    if t.enabled and t.next_run_at is not None
                ]
                if upcoming:
                    sleep_s = (min(upcoming) - datetime.now(UTC)).total_seconds()
                else:
                    sleep_s = _MAX_SLEEP_SECONDS
                await asyncio.sleep(max(0.5, min(sleep_s, _MAX_SLEEP_SECONDS)))
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - loop must never die
                logger.exception("scheduler_loop_error")
                await asyncio.sleep(1.0)

    async def _run_and_release(self, task: ScheduledTask) -> None:
        """Run one task under its lock, then clear its in-flight marker."""
        try:
            await self._run_under_lock(task)
        finally:
            self._inflight.discard(task.name)

    async def _run_under_lock(self, task: ScheduledTask) -> None:
        """Run ``task`` iff we win its advisory lock; always release it."""
        from sqlalchemy import text

        from app.db.session import async_engine

        lock_sql = text(
            "SELECT pg_try_advisory_lock(hashtext('sched:' || :name)) AS locked"
        )
        unlock_sql = text("SELECT pg_advisory_unlock(hashtext('sched:' || :name))")

        try:
            async with async_engine.connect() as conn:
                conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
                got = await conn.execute(lock_sql, {"name": task.name})
                if not bool(got.scalar()):
                    logger.debug("scheduler_task_skipped_locked", task=task.name)
                    return

                started = time.perf_counter()
                try:
                    await asyncio.wait_for(task.coro(), timeout=task.timeout_seconds)
                    self._record(task.name, "ok", started)
                    logger.info(
                        "scheduler_task_ok",
                        task=task.name,
                        duration_ms=self._status[task.name]["last_duration_ms"],
                    )
                except TimeoutError:
                    self._record(task.name, "timeout", started)
                    logger.error(
                        "scheduler_task_timeout",
                        task=task.name,
                        timeout_s=task.timeout_seconds,
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 - one bad run must not kill loop
                    self._record(task.name, "failed", started)
                    logger.exception("scheduler_task_failed", task=task.name)
                finally:
                    await conn.execute(unlock_sql, {"name": task.name})
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - lock/connection error, retry next tick
            logger.exception("scheduler_task_lock_error", task=task.name)


# ---------------------------------------------------------------------------
# Job coroutines. Each opens its own DB session via the shared pooled engine
# (we're already on the app's event loop — unlike the old sync Celery workers,
# there is no fresh-loop / NullPool dance). Cores are lazy-imported so this
# module stays free of a DB handshake at import time.
# ---------------------------------------------------------------------------


async def _run_committed(
    core: Callable[[Any], Awaitable[Any]],
) -> Any:
    """Run ``core(session)`` against one fresh committed session."""
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        result = await core(session)
        await session.commit()
        return result


async def _job_memory_decay() -> Any:
    from app.jobs.memory_lifecycle import decay_once

    return await _run_committed(decay_once)


async def _job_memory_reindex() -> Any:
    from app.jobs.memory_lifecycle import reindex_once

    return await _run_committed(reindex_once)


async def _job_memory_consolidate() -> Any:
    from app.db.session import AsyncSessionLocal
    from app.jobs.memory_lifecycle import _async_consolidate_all

    return await _async_consolidate_all(AsyncSessionLocal)


async def _job_memory_bridge_sync() -> Any:
    from app.db.session import AsyncSessionLocal
    from app.jobs.memory_bridge import _async_bridge_sync

    return await _async_bridge_sync(AsyncSessionLocal)


async def _job_scheduled_dispatch() -> Any:
    from app.jobs.scheduled_dispatch import poll_and_dispatch_due

    return await poll_and_dispatch_due()


async def _job_devenv_config_history_prune() -> Any:
    from app.jobs.devenv_history_prune import prune_config_history

    return await prune_config_history()


async def _job_connection_cleanup() -> Any:
    from app.jobs.connection_cleanup import cleanup_stale_connections

    return await cleanup_stale_connections()


async def _job_clipboard_cleanup() -> Any:
    from app.jobs.clipboard_cleanup import cleanup_expired_clipboard

    return await cleanup_expired_clipboard()


async def _job_file_cleanup() -> Any:
    from app.jobs.file_cleanup import cleanup_expired_files

    return await cleanup_expired_files()


def install_default_tasks(service: SchedulerService) -> None:
    """Register the canonical Qontinui schedule on ``service``.

    Cron cadences are ported verbatim from the former Celery beat schedule;
    interval cadences match the former asyncio cleanup loops and the new
    due-row dispatch poll.
    """
    from app.core.config import settings

    # Tenant agentic-memory lifecycle + MEMORY.md bridge (formerly celery beat).
    service.register(
        ScheduledTask(name="memory_decay", coro=_job_memory_decay, cron="10 3 * * *")
    )
    service.register(
        ScheduledTask(
            name="memory_reindex", coro=_job_memory_reindex, cron="40 3 * * *"
        )
    )
    service.register(
        ScheduledTask(
            name="memory_consolidate",
            coro=_job_memory_consolidate,
            cron="20 4 * * 0",
            timeout_seconds=600.0,
        )
    )
    service.register(
        ScheduledTask(
            name="memory_bridge_sync",
            coro=_job_memory_bridge_sync,
            cron="*/15 * * * *",
        )
    )

    # Devenv config-history retention — daily cap of the append-only capture
    # timeline at the newest 500 rows per (environment, machine) pair. Off-peak
    # like the other daily crons, offset so it never contends with them.
    service.register(
        ScheduledTask(
            name="devenv_config_history_prune",
            coro=_job_devenv_config_history_prune,
            cron="25 4 * * *",
        )
    )

    # Scheduled workflow dispatch — poll due rows every 30s. Runs at boot too,
    # so rows left unscheduled (next_fire_at NULL) get anchored onto their cron
    # promptly rather than up to 30s late.
    service.register(
        ScheduledTask(
            name="scheduled_dispatch",
            coro=_job_scheduled_dispatch,
            interval_seconds=30.0,
            run_at_boot=True,
        )
    )

    # Cleanup loops (formerly asyncio.create_task in main.startup). They ran a
    # sweep at boot (`while True: await cleanup(); sleep(n)`), so `run_at_boot`
    # preserves that: an hourly cleanup on a backend that redeploys more often
    # than hourly would otherwise never run at all.
    # Connection cleanup depends on the Redis-backed WS registry — skip it
    # when Redis is disabled, matching the former REDIS_ENABLED guard.
    if settings.REDIS_ENABLED:
        service.register(
            ScheduledTask(
                name="connection_cleanup",
                coro=_job_connection_cleanup,
                interval_seconds=60.0,
                run_at_boot=True,
            )
        )
    service.register(
        ScheduledTask(
            name="clipboard_cleanup",
            coro=_job_clipboard_cleanup,
            interval_seconds=3600.0,
            run_at_boot=True,
        )
    )
    service.register(
        ScheduledTask(
            name="file_cleanup",
            coro=_job_file_cleanup,
            interval_seconds=3600.0,
            run_at_boot=True,
        )
    )


# Module-level singleton wired into FastAPI's lifecycle in ``app.main``.
scheduler = SchedulerService()
install_default_tasks(scheduler)


def scheduler_status() -> dict[str, Any]:
    """Health-endpoint view of the scheduler and its per-task status."""
    return {
        "enabled": scheduler.enabled,
        "running": scheduler.running,
        "tasks": scheduler.status(),
    }
