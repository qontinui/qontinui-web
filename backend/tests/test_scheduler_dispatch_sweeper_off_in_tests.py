"""Regression guard: the REAL cron-dispatch sweeper must not run during tests.

`app.core.scheduler.scheduler` is a module-level singleton and the FastAPI
lifespan calls `scheduler.start()` on it. `tests/conftest.py::booted_app` is
**session-scoped and autouse** and enters `TestClient(app)` as a context manager,
which runs that lifespan — so the app's scheduler ticks every 30s for the WHOLE
session, in every run. (Before that fixture existed, boot happened whenever the
first test pulled the lazy `test_client` fixture, so whether the scheduler ran at
all depended on the collected file set.)

The dangerous task in that set is `scheduled_dispatch`. It calls
`poll_and_dispatch_due()`, which claims due rows `FOR UPDATE SKIP LOCKED` from
whatever `app.db.session.async_engine` points at — and `test_scheduler_db.py`
repoints that module global at the test engine. The sweeper then races those
tests for their own seeded rows, claiming one and advancing `next_fire_at`
before the test's own poll runs, which reports `due: 0` instead of `due: 1`.

Timing-dependent (does a tick land inside the test?), so it never reproduces when
the file is run alone — and it used to be order-dependent as well (did a
`test_client` test run earlier?). It reddened unrelated PRs on
`TestDispatchFailure` and `TestNextFireAdvance` while `main` was green.

`tests/conftest.py` therefore sets
`QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED=0`.

Two deliberate constraints on how this file tests that, both learned the hard
way by measuring:

1. **It must not use the app-client fixture.** Back when `test_client` owned the
   lifespan, pulling it from a NEW file changed when app startup happened
   relative to everything else. Startup did real DB work, and moving it made
   `test_memory_api_db.py` fail a varying 1-5 tests per run. Baseline was green
   across two full runs; adding a `test_client`-dependent guard here was the
   only difference. Boot is now pinned (autouse) and its DB-touching side
   effects are gated on `TESTING` — see `app.main._boot_side_effects_disabled` —
   but the rule stands: a guard asserts against the flags and module state the
   app reads, never against a booted app. See
   `test_app_boot_side_effects_inert_in_tests.py` for the boot-inertness half.
2. **It must not reach for the GLOBAL `QONTINUI_SCHEDULER_ENABLED`.** Killing
   the whole scheduler also stops `memory_reindex` / `memory_consolidate` /
   `memory_bridge_sync`, which reds `test_memory_api_db.py` for a different
   reason. Only the one task gets disabled.
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
    """The GLOBAL switch must stay on — other tests depend on the other jobs.

    Pinned because "just disable the scheduler" is the tempting broader fix, and
    it silently reds `test_memory_api_db.py`'s hybrid-query tests.
    """
    assert _env_flag("QONTINUI_SCHEDULER_ENABLED", default=True) is True, (
        "The global scheduler kill switch is off. That also stops "
        "memory_reindex/memory_consolidate/memory_bridge_sync, which "
        "test_memory_api_db.py relies on. Disable only the dispatch task."
    )


def test_dispatch_task_stays_registered() -> None:
    """A disabled task is skipped per tick, NOT unregistered.

    Registration happens at import (`install_default_tasks(scheduler)` at module
    scope), so the inventory stays observable with the switch off — which is
    what keeps `test_no_celery_import.py`'s assertions honest.
    """
    from app.core.scheduler import scheduler

    assert DISPATCH_TASK in scheduler.status()
