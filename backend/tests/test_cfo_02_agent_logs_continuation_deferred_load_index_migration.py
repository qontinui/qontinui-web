"""Source-level + live test for the ``cfo_02_continuation_deferred_load_index`` revision.

Phase 2 of plan
``2026-11-15-gate-continuations-fail-over-off-a-device-that-refuses-them-for-load``
rebuilds ``coord.idx_agent_logs_deferred_load_retire_device`` (``lacap_01``)
so its partial predicate covers ``continuation_deferred_load`` beside
``spawn_deferred_load_retire``.

What is asserted, and the mutation each assertion catches
==========================================================

Source-level (never skip):

* the pinned parent equals ``down_revision`` (re-point one without the other);
* upgrade's predicate is exactly ``_HOLD_EVENTS``, downgrade's is lacap_01's
  single event, and both keep ``(device_id, occurred_at DESC)`` (drop an event,
  or change the key);
* each direction builds its temporary index BEFORE it drops the original and
  renames AFTER (drop first -> a window with no index);
* the two directions use different temporary names, each renamed onto the
  original name;
* an INVALID temporary index is dropped before the CREATE, a VALID one kept;
* both timeouts are zeroed before the first CONCURRENTLY step and RESET after
  the last; every ``op.execute`` is a static literal inside
  ``autocommit_block()``.

Live (skip without a reachable Postgres; a skip proves nothing — set
``DATABASE_URL``):

* after upgrade the index is VALID under the original name, keyed
  ``(device_id, occurred_at DESC)``, with both events in its predicate, no
  temporary index survives, and coord's IN-list hold read plans on it;
* downgrade restores lacap_01's predicate under the original name; up -> down
  -> up re-applies cleanly; a stamp-back re-run converges.
"""

from __future__ import annotations

import ast
import contextlib
import re
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    collapsed_upper,
    ephemeral_database,
    index_definition,
    index_exists,
    index_state,
    load_revision_module,
    run_alembic,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. MUST equal the revision's own
# down_revision (the first test enforces it); re-point BOTH together.
_REVISION_ID = "cfo_02_continuation_deferred_load_index"
_PARENT_REVISION_ID = "coord_topics_01"
_REVISION_FILENAME = "cfo_02_agent_logs_continuation_deferred_load_index.py"

_INDEX_NAME = "idx_agent_logs_deferred_load_retire_device"
_HOLD_EVENTS = ("spawn_deferred_load_retire", "continuation_deferred_load")
_LACAP_01_EVENT = "spawn_deferred_load_retire"
_KEY = "ON COORD.AGENT_LOGS (DEVICE_ID, OCCURRED_AT DESC)"


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _source() -> str:
    return _path().read_text(encoding="utf-8")


def _module() -> ModuleType:
    return load_revision_module(_path(), f"_rev_{_REVISION_ID}")


def _temp_name(step: str) -> str:
    module = _module()
    return str(
        module._UPGRADE_TEMP_INDEX_NAME
        if step == "upgrade"
        else module._DOWNGRADE_TEMP_INDEX_NAME
    )


def _recorded(
    monkeypatch: pytest.MonkeyPatch, step: str, *, index_invalid: bool = False
) -> list[str]:
    """Run ``upgrade``/``downgrade`` against a recording ``op``, collapsed upper.

    ``index_invalid`` is what the ``pg_index.indisvalid`` probe answers: True
    takes the failed-build repair branch.
    """
    module = _module()
    executed: list[str] = []

    class _Bind:
        @staticmethod
        def execute(*_args: object, **_kwargs: object) -> object:
            class _Result:
                @staticmethod
                def scalar() -> bool:
                    return index_invalid

            return _Result()

    class _Context:
        @staticmethod
        @contextlib.contextmanager
        def autocommit_block() -> Iterator[None]:
            yield

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(collapsed_upper(str(sql)))

        @staticmethod
        def get_context() -> _Context:
            return _Context()

        @staticmethod
        def get_bind() -> _Bind:
            return _Bind()

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def _one(statements: list[str], needle: str) -> int:
    hits = [i for i, s in enumerate(statements) if needle in s]
    assert len(hits) == 1, (needle, statements)
    return hits[0]


def _predicate_events(create: str) -> tuple[str, ...]:
    in_list = re.search(r"WHERE EVENT IN \((.*?)\)", create)
    if in_list:
        return tuple(w.strip().strip("'").lower() for w in in_list.group(1).split(","))
    single = re.search(r"WHERE EVENT = '([A-Z_]+)'", create)
    assert single, f"no event predicate: {create}"
    return (single.group(1).lower(),)


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )
    assert module._INDEX_NAME == _INDEX_NAME
    assert tuple(module._HOLD_EVENTS) == _HOLD_EVENTS
    assert module._LACAP_01_EVENT == _LACAP_01_EVENT


@pytest.mark.parametrize(
    ("step", "events"),
    [("upgrade", _HOLD_EVENTS), ("downgrade", (_LACAP_01_EVENT,))],
)
def test_each_direction_builds_the_right_predicate_on_the_same_key(
    monkeypatch: pytest.MonkeyPatch, step: str, events: tuple[str, ...]
) -> None:
    statements = _recorded(monkeypatch, step)
    create = statements[_one(statements, "CREATE INDEX")]
    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS" in create
    assert _temp_name(step).upper() in create
    assert _KEY in create, create
    assert _predicate_events(create) == events


@pytest.mark.parametrize("step", ["upgrade", "downgrade"])
def test_the_swap_builds_before_it_drops_and_renames_last(
    monkeypatch: pytest.MonkeyPatch, step: str
) -> None:
    """Mutation: drop the original before the CREATE (a window with no index),
    or rename before the drop (the name is still taken)."""
    statements = _recorded(monkeypatch, step)
    temp = _temp_name(step).upper()
    create = _one(statements, "CREATE INDEX")
    drop = _one(
        statements, f"DROP INDEX CONCURRENTLY IF EXISTS COORD.{_INDEX_NAME.upper()}"
    )
    rename = _one(statements, "RENAME TO")
    assert create < drop < rename
    assert statements[rename] == (
        f"ALTER INDEX IF EXISTS COORD.{temp} RENAME TO {_INDEX_NAME.upper()}"
    )


def test_the_two_directions_use_different_temporary_names() -> None:
    module = _module()
    names = {
        module._UPGRADE_TEMP_INDEX_NAME,
        module._DOWNGRADE_TEMP_INDEX_NAME,
        _INDEX_NAME,
    }
    assert len(names) == 3
    assert all(len(n) <= 63 for n in names), "Postgres truncates names past 63"


@pytest.mark.parametrize("step", ["upgrade", "downgrade"])
def test_an_invalid_temporary_index_is_dropped_before_the_create(
    monkeypatch: pytest.MonkeyPatch, step: str
) -> None:
    """Mutation: delete the ``_index_is_invalid`` branch, or move it after the CREATE."""
    temp_drop = f"DROP INDEX CONCURRENTLY IF EXISTS COORD.{_temp_name(step).upper()}"
    invalid = _recorded(monkeypatch, step, index_invalid=True)
    assert _one(invalid, temp_drop) < _one(invalid, "CREATE INDEX")
    healthy = _recorded(monkeypatch, step, index_invalid=False)
    assert not any(temp_drop in s for s in healthy), "a VALID temp index is reused"


@pytest.mark.parametrize("step", ["upgrade", "downgrade"])
@pytest.mark.parametrize("invalid", [False, True])
def test_the_swap_runs_with_no_timeout_and_resets_after(
    monkeypatch: pytest.MonkeyPatch, step: str, invalid: bool
) -> None:
    """Mutations: delete either SET (a timeout can fail the build and leave an
    INVALID index), or a RESET (statement_timeout = 0 leaks into later
    revisions; env.py does not reset it)."""
    statements = _recorded(monkeypatch, step, index_invalid=invalid)
    ddl = [
        i for i, s in enumerate(statements) if "CONCURRENTLY" in s or "RENAME TO" in s
    ]
    assert statements.index("SET LOCK_TIMEOUT = 0") < min(ddl)
    assert statements.index("SET STATEMENT_TIMEOUT = 0") < min(ddl)
    assert statements.index("RESET STATEMENT_TIMEOUT") > max(ddl)
    assert statements.index("RESET LOCK_TIMEOUT") > max(ddl)


def test_upgrade_writes_no_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    for sql in _recorded(monkeypatch, "upgrade"):
        assert not re.search(r"\b(UPDATE|INSERT|DELETE|COPY)\b", sql), sql


def test_every_op_execute_is_static_and_autocommitted() -> None:
    """coord's migration classifier reads only static literals, and a
    CONCURRENTLY statement inside the migration transaction fails outright."""
    tree = ast.parse(_source())
    calls = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "execute"
        and isinstance(n.func.value, ast.Name)
        and n.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        assert isinstance(call.args[0], ast.Constant)
        assert isinstance(call.args[0].value, str)

    for function in ("upgrade", "downgrade"):
        executes = upgrade_execute_calls(_path(), function=function)
        assert executes, function
        assert all(e.in_autocommit_block for e in executes), function


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set DATABASE_URL")
    return url


def _assert_index(engine: Engine, events: tuple[str, ...]) -> None:
    assert index_exists(engine, _INDEX_NAME)
    valid, unique, predicate = index_state(engine, _INDEX_NAME)
    assert valid, "the hold index is INVALID"
    assert not unique
    for event in _HOLD_EVENTS:
        assert (event in predicate) == (event in events), predicate
    assert "(device_id, occurred_at DESC)" in index_definition(engine, _INDEX_NAME)
    module = _module()
    for temp in (module._UPGRADE_TEMP_INDEX_NAME, module._DOWNGRADE_TEMP_INDEX_NAME):
        assert not index_exists(engine, temp), f"{temp} survived the swap"


def _insert_tenant(conn: Connection) -> str:
    """``coord.agent_logs.tenant_id`` is NOT NULL and references coord.tenants."""
    tenant = str(uuid.uuid4())
    conn.execute(
        text(
            """
            INSERT INTO coord.tenants (tenant_id, slug, display_name)
            VALUES (:t, :slug, 'cfo_02 test tenant')
            """
        ),
        {"t": tenant, "slug": f"cfo02-test-{uuid.uuid4().hex[:12]}"},
    )
    return tenant


def test_live_up_down_up_and_rerun_converge() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "cfo02r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_index(engine, (_LACAP_01_EVENT,))

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_index(engine, _HOLD_EVENTS)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_index(engine, (_LACAP_01_EVENT,))

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_index(engine, _HOLD_EVENTS)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_index(engine, _HOLD_EVENTS)


def test_live_the_in_list_hold_read_plans_on_the_index() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "cfo02i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_index(engine, _HOLD_EVENTS)

        devices = [uuid.uuid4() for _ in range(50)]
        with engine.begin() as conn:
            tenant = _insert_tenant(conn)
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_logs
                        (agent_id, tenant_id, device_id, level, event, occurred_at)
                    SELECT gen_random_uuid(), :t, NULL, 'info', 'tool_call',
                           now() - (g || ' seconds')::interval
                      FROM generate_series(1, 20000) AS g
                    """
                ),
                {"t": tenant},
            )
            for device in devices:
                for event in _HOLD_EVENTS:
                    conn.execute(
                        text(
                            """
                            INSERT INTO coord.agent_logs
                                (agent_id, tenant_id, device_id, level, event,
                                 occurred_at)
                            SELECT gen_random_uuid(), :t, :d, 'warn', :e,
                                   now() - (g || ' minutes')::interval
                              FROM generate_series(1, 10) AS g
                            """
                        ),
                        {"t": tenant, "d": str(device), "e": event},
                    )
            conn.execute(text("ANALYZE coord.agent_logs"))

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            for where in (
                "event IN ('spawn_deferred_load_retire', 'continuation_deferred_load')",
                "event = 'spawn_deferred_load_retire'",
            ):
                plan = "\n".join(
                    str(r[0])
                    for r in conn.execute(
                        text(
                            "EXPLAIN SELECT occurred_at FROM coord.agent_logs "
                            f"WHERE {where} AND device_id = :d "
                            "ORDER BY occurred_at DESC LIMIT 1"
                        ),
                        {"d": str(devices[7])},
                    )
                )
                assert _INDEX_NAME in plan, (where, plan)
