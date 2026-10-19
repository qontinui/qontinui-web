"""Regression guard: the app's REAL scheduler must not run during tests.

`app.core.scheduler.scheduler` is a module-level singleton and the FastAPI
lifespan calls `scheduler.start()` on it. `tests/conftest.py::booted_app` is
**session-scoped and autouse** and enters `TestClient(app)` as a context manager,
which runs that lifespan — so, left alone, the app's scheduler would tick for the
WHOLE session on the TestClient portal thread, concurrently with every test.
`booted_app` therefore stops it straight after boot, and
`test_app_scheduler_loop_is_stopped_for_the_session` below pins that.

Why it matters, measured: the loop's `asyncio.sleep(next_due - now)` was
recorded by a process-wide `asyncio.sleep` mock in
`test_coord_proxy_contract.py` as `0.7789, 0.7788, ...` (qontinui-web#1718, CI
run 37519038790, shard 6/6; coord finding 171089df) — the mock returned at once,
so the loop spun with each delay a few microseconds shorter. (That mock is now
scoped to coord_proxy by `tests/_coord_proxy_sleep.py`.) And the sweeper race
below.

The most dangerous task in the set is `scheduled_dispatch`. It calls
`poll_and_dispatch_due()`, which claims due rows `FOR UPDATE SKIP LOCKED` from
whatever `app.db.session.async_engine` points at — and `test_scheduler_db.py`
repoints that module global at the test engine. The sweeper then races those
tests for their own seeded rows, claiming one and advancing `next_fire_at`
before the test's own poll runs, which reports `due: 0` instead of `due: 1`.

Timing-dependent (does a tick land inside the test?), so it never reproduces when
the file is run alone — and it used to be order-dependent as well (did a
`test_client` test run earlier?). It reddened unrelated PRs on
`TestDispatchFailure` and `TestNextFireAdvance` while `main` was green.

Stopping the loop in `booted_app` is the fix; `tests/conftest.py` ALSO sets
`QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED=0` as defense in depth, so the
task that claims rows other tests seeded stays off if the stop ever regresses.

Two deliberate constraints on how this file tests that, both learned the hard
way by measuring:

1. **It must not use the app-client fixture.** Back when `test_client` owned the
   lifespan, pulling it from a NEW file changed when app startup happened
   relative to everything else. Startup did real DB work, and moving it made
   `test_memory_api_db.py` fail a varying 1-5 tests per run (history from the
   old `test_client`-owned startup, not re-measured since). Baseline was green
   across two full runs; adding a `test_client`-dependent guard here was the
   only difference. Boot is now pinned (autouse) and its DB-touching side
   effects are gated on `TESTING` — see `app.main._boot_side_effects_disabled` —
   but the rule stands: a guard asserts against the flags and module state the
   app reads, never against a booted app (through its client). Reading the
   scheduler singleton's own state, as
   `test_app_scheduler_loop_is_stopped_for_the_session` does, is module state.
   See
   `test_app_boot_side_effects_inert_in_tests.py` for the boot-inertness half.
2. **It must not reach for the GLOBAL `QONTINUI_SCHEDULER_ENABLED`.** That
   switch is read by EVERY `SchedulerService.start()`, including the private
   instances `tests/test_scheduler.py` builds to exercise the loop, so setting
   it suite-wide reds those tests. The singleton is stopped by `booted_app`
   instead, which touches no other instance.
"""

from __future__ import annotations

import os

from app.core.scheduler import _env_flag, _env_token

DISPATCH_TASK = "scheduled_dispatch"
DISPATCH_ENV = f"QONTINUI_SCHEDULER_{_env_token(DISPATCH_TASK)}_ENABLED"


def test_env_var_name_matches_the_scheduler_contract() -> None:
    """The name conftest sets must be the one `start()` actually reads.

    Pinned separately because a typo here fails OPEN: the sweeper would simply
    stay enabled and the flake would return with no test failing.
    """
    assert DISPATCH_ENV == "QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED"


def test_dispatch_sweeper_is_disabled_for_the_suite() -> None:
    """conftest must disable the cron-dispatch task for the whole session."""
    assert os.environ.get(DISPATCH_ENV) == "0", (
        f"tests/conftest.py must set {DISPATCH_ENV}=0. Without it the app "
        "scheduler sweeps poll_and_dispatch_due() against the test database and "
        "steals rows seeded by tests/test_scheduler_db.py."
    )
    # The value must actually READ as false through the scheduler's own helper,
    # not merely be present — `_env_flag` treats several strings as off.
    assert _env_flag(DISPATCH_ENV, default=True) is False


def test_global_scheduler_switch_is_left_alone() -> None:
    """The GLOBAL switch must stay on — `tests/test_scheduler.py` needs it.

    Every `SchedulerService.start()` reads it, including the private instances
    the scheduler unit tests start; with it off they never launch a loop.
    """
    assert _env_flag("QONTINUI_SCHEDULER_ENABLED", default=True) is True, (
        "The global scheduler kill switch is off. That disables every "
        "SchedulerService the scheduler unit tests start. The app singleton is "
        "stopped by conftest.py::booted_app instead."
    )


def test_app_scheduler_loop_is_stopped_for_the_session() -> None:
    """The app singleton's loop must not be running while tests run.

    `booted_app` (autouse, session-scoped) boots the app — whose lifespan calls
    `scheduler.start()` — and then stops the singleton. If that stop regresses,
    the loop ticks for the whole session on the TestClient portal thread and
    every `asyncio.sleep` it awaits lands in any process-wide sleep mock a test
    installs, and every job it fires races the tests for shared rows.
    """
    from app.core.scheduler import scheduler

    assert not scheduler.running, (
        "The app's scheduler loop is running during the test session. "
        "tests/conftest.py::booted_app must stop it after boot."
    )
    in_flight = sorted(t.get_name() for t in scheduler._runners)
    assert not in_flight, f"Scheduled job runs are still in flight: {in_flight}"


def test_dispatch_task_stays_registered() -> None:
    """A disabled task is skipped per tick, NOT unregistered.

    Registration happens at import (`install_default_tasks(scheduler)` at module
    scope), so the inventory stays observable with the switch off — which is
    what keeps `test_no_celery_import.py`'s assertions honest.
    """
    from app.core.scheduler import scheduler

    assert DISPATCH_TASK in scheduler.status()
