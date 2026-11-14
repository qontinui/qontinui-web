"""Schema + round-trip test for the ``lacap_01`` revision.

Phase 1 of plan
``2026-11-14-coord-spawn-admission-uses-the-runners-own-launch-ceiling`` adds
five nullable launch-capacity columns to ``coord.device_resource_samples`` and
a partial index on ``coord.agent_logs`` for the deferred-load retire hold.

What is asserted, and the mutation each assertion catches
==========================================================

Source-level (never skip):

* the pinned parent equals ``down_revision`` (re-point one without the other);
* the column list is the interface coord reads (rename / retype a column);
* the CHECK's IN list equals ``_LAUNCH_VERDICTS`` (drop or add a verdict word);
* every column ADD carries no NOT NULL / DEFAULT, and only ``launch_verdict``
  carries a CHECK (add ``DEFAULT 0`` to ``launch_headroom``);
* downgrade drops exactly the five columns and the index (forget one);
* every ``op.execute`` is a static literal (an f-string), and the CONCURRENTLY
  build/drop sit inside ``autocommit_block()`` (move one out).

Live (skip without a reachable Postgres; a skip proves nothing — set
``QONTINUI_TEST_PG=host:port``):

* after upgrade each column exists, is nullable, has no default, carries the
  COMMENT its revision emits; a row omitting the fields reads NULL;
* the CHECK admits every verdict word and NULL, refuses an unknown word;
* the index is VALID, non-unique, keyed ``(device_id, occurred_at DESC)`` with
  predicate ``event = 'spawn_deferred_load_retire'``, and coord's hold read
  plans on it (drop the WHERE, or key on ``occurred_at`` alone);
* up -> down -> up removes the five columns and the index, keeps pre-existing
  sample and log rows, and re-applies cleanly.
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
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    index_definition,
    index_exists,
    index_oid,
    index_state,
    invalidate_index,
    is_superuser,
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. MUST equal the revision's own
# down_revision (the first test enforces it); re-point BOTH together.
_REVISION_ID = "lacap_01"
_PARENT_REVISION_ID = "coord_agent_status_session_02"
_REVISION_FILENAME = "lacap_01_launch_capacity_columns.py"

_TABLE = "device_resource_samples"
_QUALIFIED = f"coord.{_TABLE}"
_INDEX_NAME = "idx_agent_logs_deferred_load_retire_device"
_RETIRE_EVENT = "spawn_deferred_load_retire"

# (column, DDL type as the revision spells it, information_schema.data_type)
_EXPECTED: tuple[tuple[str, str, str], ...] = (
    ("launch_headroom", "INTEGER", "integer"),
    ("launch_verdict", "TEXT", "text"),
    ("thread_graded", "INTEGER", "integer"),
    ("thread_warn_ceiling", "INTEGER", "integer"),
    ("thread_critical_ceiling", "INTEGER", "integer"),
)

_VERDICTS: tuple[str, ...] = (
    "proceed",
    "warn",
    "critical",
    "guard_disabled",
    "unreadable",
)


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _source() -> str:
    return _path().read_text(encoding="utf-8")


def _module() -> ModuleType:
    return load_revision_module(_path(), f"_rev_{_REVISION_ID}")


def _recorded(
    monkeypatch: pytest.MonkeyPatch, step: str, *, index_invalid: bool = False
) -> list[str]:
    """Run ``upgrade``/``downgrade`` against a recording ``op``.

    The harness's ``recorded_sql`` stubs only ``execute``; this revision also
    calls ``op.get_context().autocommit_block()`` and ``op.get_bind()`` (the
    invalid-index probe), so both are stubbed here. ``index_invalid`` is what
    the probe answers: True takes the failed-build repair branch.
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
            executed.append(str(sql))

        @staticmethod
        def get_context() -> _Context:
            return _Context()

        @staticmethod
        def get_bind() -> _Bind:
            return _Bind()

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def _column_add_statement(statements: list[str]) -> str:
    found = [
        s
        for s in statements
        if re.match(rf"^\s*ALTER TABLE {re.escape(_QUALIFIED)}\s", s)
        and "ADD COLUMN" in s.upper()
    ]
    assert len(found) == 1, f"expected ONE ADD ALTER on {_QUALIFIED}, got {len(found)}"
    return found[0]


def _constraint_statement(statements: list[str]) -> str:
    """The ONE recorded statement adding the launch_verdict CHECK, collapsed."""
    found = [collapsed_upper(s) for s in statements if "ADD CONSTRAINT" in s.upper()]
    assert len(found) == 1, f"expected ONE ADD CONSTRAINT, got {len(found)}"
    return found[0]


def _add_clause(add: str, column: str) -> str:
    """The text of one ``ADD COLUMN IF NOT EXISTS <column> ...`` clause."""
    collapsed = collapsed_upper(add)
    match = re.search(
        rf"ADD COLUMN IF NOT EXISTS {column.upper()} (.*?)(?=, ADD COLUMN|$)",
        collapsed,
    )
    assert match, f"no ADD clause for {column}"
    return match.group(0)


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


def test_the_column_list_is_the_interface_coord_reads() -> None:
    module = _module()
    assert tuple(module._LAUNCH_CAPACITY_COLUMNS) == tuple(
        (name, ddl) for name, ddl, _ in _EXPECTED
    ), (
        "coord reads these names over a 42703-swallowing degrade path and as "
        "Option<i32>; a rename or retype breaks it silently"
    )
    assert module._TABLE == _QUALIFIED


def test_the_check_names_exactly_the_runner_verdict_vocabulary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    assert tuple(module._LAUNCH_VERDICTS) == _VERDICTS
    clause = _constraint_statement(_recorded(monkeypatch, "upgrade"))
    in_list = re.search(r"CHECK \(LAUNCH_VERDICT IN \((.*?)\)\s*\)", clause)
    assert in_list, f"launch_verdict carries no IN-list CHECK: {clause}"
    words = tuple(w.strip().strip("'").lower() for w in in_list.group(1).split(","))
    assert words == _VERDICTS
    assert f"ADD CONSTRAINT {module._VERDICT_CHECK_NAME.upper()}" in clause


def test_the_check_is_not_valid_and_guarded_against_a_rerun(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NOT VALID skips the ACCESS EXCLUSIVE scan of existing rows; the guard
    keeps a re-run from failing on the existing constraint name.

    Mutations: drop ``NOT VALID`` (the scan returns), or drop the
    ``pg_constraint`` lookup (a re-run raises duplicate_object).
    """
    clause = _constraint_statement(_recorded(monkeypatch, "upgrade"))
    assert re.search(r"\)\s*NOT VALID\s*;", clause), clause
    assert "IF NOT EXISTS ( SELECT 1 FROM PG_CONSTRAINT" in clause
    assert f"CONNAME = '{_module()._VERDICT_CHECK_NAME.upper()}'" in clause
    assert f"CONRELID = '{_QUALIFIED.upper()}'::REGCLASS" in clause


def test_the_add_is_nullable_with_no_default_and_no_constraint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NULL means 'publisher predates this'; a DEFAULT 0 would refuse every device."""
    add = _column_add_statement(_recorded(monkeypatch, "upgrade"))
    assert collapsed_upper(add).count("ADD COLUMN IF NOT EXISTS") == len(_EXPECTED)
    for name, ddl, _ in _EXPECTED:
        clause = _add_clause(add, name)
        assert clause.startswith(f"ADD COLUMN IF NOT EXISTS {name.upper()} {ddl}")
        for forbidden in ("NOT NULL", "DEFAULT", "REFERENCES", "UNIQUE"):
            assert not re.search(rf"\b{forbidden}\b", clause), (
                f"{name} carries {forbidden}; NULL is load-bearing"
            )
        assert not re.search(r"\b(CHECK|CONSTRAINT)\b", clause), (
            f"{name}: no constraint rides the ADD COLUMN -- an inline CHECK "
            "validates every existing row under ACCESS EXCLUSIVE; the "
            "launch_verdict CHECK is a separate NOT VALID constraint"
        )


def test_upgrade_writes_no_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    for sql in _recorded(monkeypatch, "upgrade"):
        if re.match(r"\s*COMMENT\s+ON\b", sql, re.I):
            continue
        assert not re.search(r"\b(UPDATE|INSERT|DELETE|COPY|DROP)\b", sql, re.I), sql


def test_every_column_carries_a_comment_stating_what_null_means() -> None:
    source = _source()
    for name, _, _ in _EXPECTED:
        body = comment_body_from_source(source, f"{_QUALIFIED}.{name}")
        assert "NULL" in body, f"{name}'s comment must state what NULL means"


def test_upgrade_builds_the_partial_retire_index_concurrently(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    creates = [
        s
        for s in _recorded(monkeypatch, "upgrade")
        if "CREATE INDEX" in collapsed_upper(s)
    ]
    assert len(creates) == 1
    create = collapsed_upper(creates[0])
    assert "CONCURRENTLY IF NOT EXISTS" in create
    assert _INDEX_NAME.upper() in create
    assert "ON COORD.AGENT_LOGS (DEVICE_ID, OCCURRED_AT DESC)" in create
    assert f"WHERE EVENT = '{_RETIRE_EVENT.upper()}'" in create
    assert _module()._RETIRE_INDEX_NAME == _INDEX_NAME


def test_upgrade_builds_the_index_before_the_transactional_part(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Index first, so a re-run after a failed column step finds it VALID.

    Mutation: move the autocommit block after the column ALTER.
    """
    statements = [collapsed_upper(s) for s in _recorded(monkeypatch, "upgrade")]
    create = next(i for i, s in enumerate(statements) if "CREATE INDEX" in s)
    add = next(i for i, s in enumerate(statements) if "ADD COLUMN" in s)
    check = next(i for i, s in enumerate(statements) if "ADD CONSTRAINT" in s)
    assert create < add < check


def test_an_invalid_index_is_dropped_before_the_create(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed CONCURRENTLY build is dropped, then rebuilt -- not kept.

    Mutation: delete the ``_index_is_invalid`` branch (no DROP recorded), or
    make it drop after the CREATE.
    """
    statements = [
        collapsed_upper(s)
        for s in _recorded(monkeypatch, "upgrade", index_invalid=True)
    ]
    drop = [
        i
        for i, s in enumerate(statements)
        if f"DROP INDEX CONCURRENTLY IF EXISTS COORD.{_INDEX_NAME.upper()}" in s
    ]
    create = [i for i, s in enumerate(statements) if "CREATE INDEX" in s]
    assert len(drop) == 1 and len(create) == 1
    assert drop[0] < create[0]

    healthy = _recorded(monkeypatch, "upgrade", index_invalid=False)
    assert not any("DROP INDEX" in collapsed_upper(s) for s in healthy), (
        "a VALID index must be left alone"
    )


def test_downgrade_drops_exactly_the_index_and_the_five_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    down = _recorded(monkeypatch, "downgrade")
    joined = collapsed_upper("\n".join(down))
    assert f"DROP INDEX CONCURRENTLY IF EXISTS COORD.{_INDEX_NAME.upper()}" in joined
    assert f"ALTER TABLE {_QUALIFIED.upper()}" in joined
    for name, _, _ in _EXPECTED:
        assert f"DROP COLUMN IF EXISTS {name.upper()}" in joined
    assert joined.count("DROP COLUMN") == len(_EXPECTED)
    assert "DROP TABLE" not in joined


def test_every_op_execute_is_static_and_concurrent_ddl_is_autocommitted() -> None:
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
        concurrent = [e for e in executes if e.sql and "CONCURRENTLY" in e.sql.upper()]
        assert concurrent, f"{function}() has no CONCURRENTLY statement"
        assert all(e.in_autocommit_block for e in concurrent), function
        column_ddl = [
            e
            for e in executes
            if e.sql and ("COLUMN" in e.sql.upper() or "CONSTRAINT" in e.sql.upper())
        ]
        assert column_ddl and not any(e.in_autocommit_block for e in column_ddl), (
            f"{function}(): the column ALTER belongs in the migration transaction"
        )


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def _assert_columns_present(engine: Engine) -> None:
    source = _source()
    for name, _, pg_type in _EXPECTED:
        info = column_info(engine, _TABLE, name)
        assert info is not None, f"{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == pg_type, f"{name} is {data_type}, expected {pg_type}"
        assert is_nullable == "YES", f"{name} is NOT NULL"
        assert default is None, f"{name} carries DEFAULT {default!r}"
        assert column_comment(engine, _TABLE, name) == comment_body_from_source(
            source, f"{_QUALIFIED}.{name}"
        )


def _assert_index_present(engine: Engine) -> None:
    assert index_exists(engine, _INDEX_NAME)
    valid, unique, predicate = index_state(engine, _INDEX_NAME)
    assert valid, "the retire index is INVALID"
    assert not unique, "the retire index is an access path, not a constraint"
    assert _RETIRE_EVENT in predicate and "event" in predicate, predicate
    definition = index_definition(engine, _INDEX_NAME)
    assert "(device_id, occurred_at DESC)" in definition, definition


def _insert_sample(engine: Engine, device: uuid.UUID, verdict: str | None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.device_resource_samples
                    (device_id, lane, sampled_at, source, launch_verdict)
                VALUES (:d, 'host', now(), 'test', :v)
                """
            ),
            {"d": str(device), "v": verdict},
        )


def test_live_columns_check_and_null_semantics() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "lacap01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        older = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:d, 'host', now(), 'test')
                    """
                ),
                {"d": str(older)},
            )
            row = conn.execute(
                text(
                    """
                    SELECT launch_headroom, launch_verdict, thread_graded,
                           thread_warn_ceiling, thread_critical_ceiling
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(older)},
            ).one()
        assert tuple(row) == (None,) * 5, (
            "a row from a runner that omits the fields must read NULL (UNKNOWN), "
            "never a fabricated 0"
        )

        for verdict in _VERDICTS:
            _insert_sample(engine, uuid.uuid4(), verdict)
        _insert_sample(engine, uuid.uuid4(), None)
        with pytest.raises(Exception, match="(?i)check"):
            _insert_sample(engine, uuid.uuid4(), "admit")

        with engine.connect() as conn:
            validated = conn.execute(
                text(
                    """
                    SELECT convalidated FROM pg_constraint
                     WHERE conname = :c
                       AND conrelid = 'coord.device_resource_samples'::regclass
                    """
                ),
                {"c": _module()._VERDICT_CHECK_NAME},
            ).scalar_one()
        assert validated is False, (
            "the CHECK must be added NOT VALID (no scan of existing rows under "
            "ACCESS EXCLUSIVE)"
        )


def test_live_rerun_repairs_an_invalid_index_and_skips_the_existing_check() -> None:
    """Stamp back and re-run upgrade over an INVALID index and the existing CHECK.

    The re-run must (a) drop and rebuild the INVALID index -- VALID, new oid --
    and (b) not fail on the constraint name that already exists. Mutations:
    delete the invalid-index branch (index stays INVALID), or the
    pg_constraint guard (duplicate_object on re-run).
    """
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "lacap01v") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_index_present(engine)
        if not is_superuser(engine):
            pytest.skip("the test role cannot write pg_index to invalidate an index")
        before = index_oid(engine, _INDEX_NAME)
        invalidate_index(engine, _INDEX_NAME)
        assert not index_state(engine, _INDEX_NAME)[0]

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _assert_index_present(engine)
        assert index_oid(engine, _INDEX_NAME) != before, (
            "the INVALID index must be dropped and rebuilt, not kept by IF NOT EXISTS"
        )
        _assert_columns_present(engine)


def _insert_tenant(conn: Connection) -> str:
    """``coord.agent_logs.tenant_id`` is NOT NULL and references coord.tenants."""
    tenant = str(uuid.uuid4())
    conn.execute(
        text(
            """
            INSERT INTO coord.tenants (tenant_id, slug, display_name)
            VALUES (:t, :slug, 'lacap_01 test tenant')
            """
        ),
        {"t": tenant, "slug": f"lacap-test-{uuid.uuid4().hex[:12]}"},
    )
    return tenant


def test_live_retire_index_serves_the_hold_read() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "lacap01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_index_present(engine)

        devices = [uuid.uuid4() for _ in range(50)]
        with engine.begin() as conn:
            tenant = _insert_tenant(conn)
            # The bulk of the log: other events, which the partial index omits.
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
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.agent_logs
                            (agent_id, tenant_id, device_id, level, event,
                             occurred_at)
                        SELECT gen_random_uuid(), :t, :d, 'warn', :e,
                               now() - (g || ' minutes')::interval
                          FROM generate_series(1, 20) AS g
                        """
                    ),
                    {"t": tenant, "d": str(device), "e": _RETIRE_EVENT},
                )
            conn.execute(text("ANALYZE coord.agent_logs"))

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            plan = "\n".join(
                str(r[0])
                for r in conn.execute(
                    text(
                        """
                        EXPLAIN SELECT occurred_at FROM coord.agent_logs
                         WHERE event = 'spawn_deferred_load_retire'
                           AND device_id = :d
                         ORDER BY occurred_at DESC LIMIT 1
                        """
                    ),
                    {"d": str(devices[7])},
                )
            )
        assert _INDEX_NAME in plan, plan


def test_live_up_down_up_keeps_rows_and_leaves_no_residue() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "lacap01r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        device = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:d, 'host', now(), 'test')
                    """
                ),
                {"d": str(device)},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_logs
                        (agent_id, tenant_id, device_id, level, event)
                    VALUES (gen_random_uuid(), :t, :d, 'warn', :e)
                    """
                ),
                {"t": _insert_tenant(conn), "d": str(device), "e": _RETIRE_EVENT},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_index_present(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for name, _, _ in _EXPECTED:
            assert column_info(engine, _TABLE, name) is None, f"{name} survived"
        assert not index_exists(engine, _INDEX_NAME)
        assert table_exists(engine, "coord", _TABLE)
        assert table_exists(engine, "coord", "agent_logs")
        with engine.connect() as conn:
            for table in ("device_resource_samples", "agent_logs"):
                kept = conn.execute(
                    text(f"SELECT count(*) FROM coord.{table} WHERE device_id = :d"),
                    {"d": str(device)},
                ).scalar_one()
                assert kept == 1, f"downgrade destroyed a pre-existing {table} row"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_index_present(engine)
