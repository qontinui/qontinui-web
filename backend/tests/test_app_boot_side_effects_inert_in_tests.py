"""Regression guard: app startup must be test-inert, and must boot at a FIXED point.

`TestClient(app)` used as a context manager runs the FastAPI lifespan. While
`tests/conftest.py::test_client` was a lazily-pulled session fixture, *when the
app booted* was a hidden global decided by which collected file happened to
request it first — so the collected file set determined when real DB writes,
network fetches and background loops started relative to every other test.
Measured: adding a single new file that pulled `test_client` made
`test_memory_api_db.py` fail a varying 1-5 tests per run, a different set each
time, with the code under test untouched.

Phase 3 of `2026-08-01-web-tests-global-state-assertions` fixed that from both
ends, and this file pins both:

1. **Boot is pinned.** `conftest.py::booted_app` is session-scoped AND autouse,
   so the app boots once, before any test, in every run — including a run of one
   file. `test_client` is now a thin alias that no longer owns the lifespan, so
   requesting it cannot move boot.
2. **Boot is inert.** `app.main._boot_side_effects_disabled()` (reads `TESTING`,
   the same idiom `app/core/sentry_config.py` uses) gates the boot steps that
   write shared rows, reach the network, or spawn session-long background loops:
   `init_db`, the wrapper-registry sync loop, the strategy service-account mint,
   and the recording-pipeline recovery UPDATE. Each gate's own comment in
   `app/main.py` says why it is safe to skip.

Two deliberate constraints on HOW this file tests that:

* **It must not pull `test_client` / `booted_app`.** A guard against a booted app
  is a guard that participates in the bug it is guarding. This file asserts
  against the flag the gates read and the STRUCTURE of the gates (parsed from
  source with `ast`), so it works with no database, no network, and no lifespan.
  Importing `app.main` is safe and not a boot: module import builds the FastAPI
  object and registers routes; only the lifespan runs startup.
  (`tests/test_security.py` already imports it at module scope.)
* **`scheduler.start()` must stay UNgated.** Disabling the scheduler under tests
  also stops `memory_reindex` / `memory_consolidate` / `memory_bridge_sync`,
  which `test_memory_api_db.py` depends on — it reds a varying 1-5 tests there.
  The one dangerous task is switched off per-task instead; that half is pinned by
  `test_scheduler_dispatch_sweeper_off_in_tests.py` (not duplicated here).
"""

from __future__ import annotations

import ast
import os
from pathlib import Path

import pytest

import app.main as app_main

# Side effects that MUST be skipped when TESTING=1, keyed by the call as it
# appears in `startup_event` (dotted for attribute calls).
GATED_CALLS = (
    "init_db",  # boot-time INSERT+commit of the FIRST_SUPERUSER shell row
    "start_sync_job",  # network fetch + hourly wrapper_entries writer
    "strategy_client.startup",  # coord token mint + session-long refresh task
    "recover_running_runs_on_boot",  # bulk UPDATE over recording_pipeline_runs
)

# The scheduler is the explicit non-goal: it must NOT be gated.
UNGATED_CALL = "scheduler.start"

MAIN_PY = Path(app_main.__file__)
CONFTEST_PY = Path(__file__).with_name("conftest.py")


# --- source-structure helpers (no import of the code under test needed) -----


def _call_name(node: ast.Call) -> str:
    """Dotted name of a call target, e.g. ``strategy_client.startup``."""
    parts: list[str] = []
    func: ast.expr = node.func
    while isinstance(func, ast.Attribute):
        parts.append(func.attr)
        func = func.value
    if isinstance(func, ast.Name):
        parts.append(func.id)
    return ".".join(reversed(parts))


def _guards_by_call(source: str, func_name: str) -> dict[str, list[list[str]]]:
    """Map each call inside ``func_name`` to the ``if`` tests enclosing it.

    Each occurrence contributes one list of guard descriptions, outermost first.
    A guard taken via the ``else`` branch is recorded as ``"else <test>"``.
    """
    tree = ast.parse(source)
    target = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef)
        and node.name == func_name
    )
    found: dict[str, list[list[str]]] = {}

    def visit(node: ast.AST, guards: list[str]) -> None:
        if isinstance(node, ast.If):
            test_src = ast.unparse(node.test)
            visit(node.test, guards)
            for child in node.body:
                visit(child, [*guards, test_src])
            for child in node.orelse:
                visit(child, [*guards, f"else {test_src}"])
            return
        if isinstance(node, ast.Call):
            found.setdefault(_call_name(node), []).append(list(guards))
        # Named `sub`, not `child`: the loops above bind `child` as `ast.stmt`,
        # and `iter_child_nodes` yields the wider `ast.AST`.
        for sub in ast.iter_child_nodes(node):
            visit(sub, guards)

    visit(target, [])
    return found


def _is_skip_guard(guard: str) -> bool:
    """True when this guard makes its branch the NOT-skipping branch.

    Accepts both idioms — ``else skip_side_effects`` and
    ``if not skip_side_effects`` — but rejects the inverted mistake
    (``if skip_side_effects:`` wrapping the side effect itself), which would fail
    OPEN: the side effect would run under tests with no test failing.
    """
    if "skip_side_effects" not in guard:
        return False
    return guard.startswith("else ") or "not skip_side_effects" in guard


@pytest.fixture(scope="module")
def startup_guards() -> dict[str, list[list[str]]]:
    return _guards_by_call(MAIN_PY.read_text(encoding="utf-8"), "startup_event")


# --- the flag itself --------------------------------------------------------


def test_testing_flag_is_set_for_the_suite() -> None:
    """conftest must export TESTING=1 before any app import.

    Pinned separately because this fails OPEN: without it every gate below
    silently evaluates to "run the side effect" and nothing else breaks.
    """
    assert os.environ.get("TESTING") == "1", (
        "tests/conftest.py must set TESTING=1 at import time. The app's "
        "boot-time gates read it, so without it startup does real DB writes, "
        "fetches the wrapper registry over the network, and spawns background "
        "loops inside the test process."
    )


def test_predicate_reads_the_flag() -> None:
    """The predicate the gates call must agree with the flag under pytest."""
    assert app_main._boot_side_effects_disabled() is True


@pytest.mark.parametrize("value", ["0", "", "true", "yes"])
def test_predicate_is_strict_about_the_value(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    """Only the literal ``"1"`` disables side effects.

    Production must never accidentally inherit test inertness — an app whose
    boot skipped `init_db` and the registry sync because some deploy set
    ``TESTING=false`` would be quietly broken.
    """
    monkeypatch.setenv("TESTING", value)
    assert app_main._boot_side_effects_disabled() is False


def test_predicate_is_false_when_the_flag_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TESTING", raising=False)
    assert app_main._boot_side_effects_disabled() is False


# --- the gates -------------------------------------------------------------


def test_startup_derives_its_gate_from_the_predicate(
    startup_guards: dict[str, list[list[str]]],
) -> None:
    """`skip_side_effects` must come from `_boot_side_effects_disabled()`.

    The gates below are matched on that local name, so a rename that kept the
    name but changed its source would slip past them.
    """
    assert "_boot_side_effects_disabled" in startup_guards, (
        "startup_event no longer calls _boot_side_effects_disabled()."
    )
    source = MAIN_PY.read_text(encoding="utf-8")
    assert "skip_side_effects = _boot_side_effects_disabled()" in source


@pytest.mark.parametrize("call", GATED_CALLS)
def test_boot_side_effect_is_gated(
    call: str, startup_guards: dict[str, list[list[str]]]
) -> None:
    """Every occurrence of each side effect must sit behind the skip gate."""
    occurrences = startup_guards.get(call)
    assert occurrences, (
        f"startup_event no longer calls {call}(). If it moved, move its gate "
        "with it — and if it is genuinely gone, drop it from GATED_CALLS with "
        "the reason."
    )
    for guards in occurrences:
        assert any(_is_skip_guard(g) for g in guards), (
            f"{call}() runs unconditionally at app startup (enclosing "
            f"conditions: {guards or 'none'}). Under pytest that side effect "
            "leaks into unrelated tests at a moment decided by the collected "
            "file set. Gate it on `skip_side_effects`."
        )


def test_scheduler_start_is_not_gated(
    startup_guards: dict[str, list[list[str]]],
) -> None:
    """The global scheduler must still start under tests — explicit non-goal.

    `test_memory_api_db.py` depends on `memory_reindex` / `memory_consolidate` /
    `memory_bridge_sync` having run; with the scheduler off it fails a varying
    1-5 tests per run. Only `scheduled_dispatch` is disabled, per-task, in
    conftest.
    """
    occurrences = startup_guards.get(UNGATED_CALL)
    assert occurrences, f"startup_event no longer calls {UNGATED_CALL}()."
    for guards in occurrences:
        assert not any(_is_skip_guard(g) for g in guards), (
            "scheduler.start() was gated out of test runs. That also stops the "
            "memory jobs test_memory_api_db.py relies on. Disable the one "
            "dangerous task via QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED "
            "instead (see test_scheduler_dispatch_sweeper_off_in_tests.py)."
        )


# --- the pinned boot -------------------------------------------------------


def test_app_boot_fixture_is_session_scoped_and_autouse() -> None:
    """`booted_app` must be autouse, so boot cannot move with the file set.

    Read from conftest's source rather than by importing it: this assertion is
    about the fixture's declaration, and parsing keeps the guard independent of
    pytest's import mode and of `tests/` being a package.
    """
    tree = ast.parse(CONFTEST_PY.read_text(encoding="utf-8"))
    booted_app = next(
        (
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "booted_app"
        ),
        None,
    )
    assert booted_app is not None, (
        "tests/conftest.py must define the `booted_app` fixture that owns the "
        "app lifespan. Without it, app startup happens whenever some test first "
        "asks for a client — which is the flake this whole file exists for."
    )
    # `ast.unparse` normalises string literals to single quotes, so compare
    # against a quote-normalised form rather than the source spelling.
    decorators = [
        ast.unparse(dec).replace('"', "'") for dec in booted_app.decorator_list
    ]
    assert any(
        "scope='session'" in dec and "autouse=True" in dec for dec in decorators
    ), (
        "booted_app must be declared @pytest.fixture(scope='session', "
        f"autouse=True); found {decorators}. Dropping autouse restores the "
        "collection-order-dependent boot."
    )


def test_test_client_does_not_own_the_lifespan() -> None:
    """`test_client` must delegate to `booted_app`, not enter TestClient itself.

    Two fixtures that each enter `TestClient(app)` would run the lifespan twice
    and re-introduce a boot whose timing depends on who asked first.
    """
    tree = ast.parse(CONFTEST_PY.read_text(encoding="utf-8"))
    test_client = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "test_client"
    )
    args = [arg.arg for arg in test_client.args.args]
    assert "booted_app" in args, f"test_client must depend on booted_app; got {args}."
    calls = {
        _call_name(node) for node in ast.walk(test_client) if isinstance(node, ast.Call)
    }
    assert "TestClient" not in calls, (
        "test_client constructs its own TestClient again — the lifespan would "
        "run twice. It must return the booted_app client."
    )
