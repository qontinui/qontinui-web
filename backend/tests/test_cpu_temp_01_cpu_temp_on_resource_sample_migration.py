"""Schema + round-trip test for the ``cpu_temp_01`` revision.

Phase 1 of plan ``2026-10-13-cpu-temperature-in-fleet-resource-telemetry``
adds one ``cpu_temp_c REAL`` column to ``coord.device_resource_samples``. The
contract is everything around the single ALTER:

1. **The column NAME and TYPE are an interface** (``IF NOT EXISTS`` is
   type-blind, and coord reads ``Option<f32>``).
2. **Nullable with no DEFAULT.** NULL is "not measured"; a default of 0 would
   fabricate "cool" into every row a publisher without a sensor sends.
3. **NULL and a real 0.0 stay distinct.**
4. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
5. **The column carries its ``COMMENT``.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing: point
it at a live instance with ``QONTINUI_TEST_PG=host:port``.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST
# equal the revision's own `down_revision` — the first test below enforces
# it. If the alembic head moves before landing, re-point BOTH together.
_REVISION_ID = "cpu_temp_01"
_PARENT_REVISION_ID = "coord_ci_runs_schedule_01"
_REVISION_FILENAME = "cpu_temp_01_cpu_temp_on_resource_sample.py"

_TABLE = "device_resource_samples"
_QUALIFIED = f"coord.{_TABLE}"

# (column, information_schema.data_type) — PostgreSQL's own spellings.
_EXPECTED: tuple[tuple[str, str], ...] = (("cpu_temp_c", "real"),)

# The same column, spelled as the revision's own DDL spells it. Only THIS
# tuple is pinned to the revision's `_CPU_TEMP_COLUMNS`; the two are
# reconciled by `test_the_two_column_tables_describe_the_same_column`.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (("cpu_temp_c", "REAL"),)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    """The comment body the REVISION emits, read out of its own source."""
    return comment_body_from_source(_revision_source(), f"{_QUALIFIED}.{column}")


def _revision_module():
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """The walk target below is only correct while this equality holds."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )


def test_the_revision_names_the_column_coord_reads_from_one_list() -> None:
    """The static SQL is checked against this list, so it IS the interface."""
    module = _revision_module()
    assert tuple(module._CPU_TEMP_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list changed; coord reads this name over a "
        "42703-swallowing degrade path, so a rename idles forever with no error"
    )
    assert module._TABLE == _QUALIFIED


def test_the_two_column_tables_describe_the_same_column() -> None:
    """`_EXPECTED` and `_EXPECTED_DDL` cannot drift into different sets."""
    assert [name for name, _ in _EXPECTED] == [name for name, _ in _EXPECTED_DDL]
    for (name, pg_type), (_, ddl_type) in zip(_EXPECTED, _EXPECTED_DDL, strict=True):
        assert ddl_type.lower() == pg_type, (
            f"{name}: the DDL says {ddl_type} and the schema assertion expects "
            f"{pg_type}; IF NOT EXISTS is type-blind"
        )


def test_the_revision_comments_the_column_it_adds() -> None:
    """One generated ADD, one hand-written COMMENT — pinned together."""
    source = _revision_source()
    for name, _ in _EXPECTED_DDL:
        marker = f"COMMENT ON COLUMN {_QUALIFIED}.{name} IS"
        assert marker in source, f"{name} is added but carries no COMMENT"
        assert "NULL" in _expected_comment(name), (
            f"{name}'s comment must state what NULL means"
        )


def test_the_comment_states_null_is_unmeasured_and_reporting_only() -> None:
    """NULL is 'not measured', never 0 or 'cool'; the value is display-only."""
    body = _expected_comment("cpu_temp_c")
    assert "NOT MEASURED" in body
    assert "REPORTING ONLY" in body
    assert "Celsius" in body


def test_the_revision_docstring_states_the_retention_posture() -> None:
    module = _revision_module()
    doc = module.__doc__ or ""
    assert "prune_samples" in doc
    assert "COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS" in doc


def _recorded_sql(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    """Run ``upgrade`` or ``downgrade`` against a recording ``op`` stub."""
    module = _revision_module()
    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def _add_statement(monkeypatch: pytest.MonkeyPatch) -> str:
    """The one ``ALTER TABLE … ADD COLUMN`` statement ``upgrade()`` emits."""
    adds = [
        sql
        for sql in _recorded_sql(monkeypatch, "upgrade")
        if "ADD COLUMN" in sql.upper()
    ]
    assert len(adds) == 1, f"expected one ADD COLUMN statement, got {len(adds)}"
    return adds[0]


def test_the_static_add_and_drop_cover_exactly_the_one_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Upgrade ADDs and downgrade DROPs exactly the one listed column."""
    add = _add_statement(monkeypatch)
    drops = "\n".join(_recorded_sql(monkeypatch, "downgrade"))

    assert f"ALTER TABLE {_QUALIFIED}" in add
    assert f"ALTER TABLE {_QUALIFIED}" in drops, (
        "downgrade() must ALTER the qualified table; an unqualified name would "
        "hit whatever `search_path` happens to be"
    )
    for name, sql_type in _EXPECTED_DDL:
        assert f"ADD COLUMN IF NOT EXISTS {name} {sql_type}" in add
        assert f"DROP COLUMN IF EXISTS {name}" in drops
    assert add.count("ADD COLUMN") == len(_EXPECTED_DDL), (
        "the static ADD names a column the list does not"
    )
    assert drops.count("DROP COLUMN") == len(_EXPECTED_DDL), (
        "the static DROP names a column the list does not"
    )


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier cannot read a dynamic ``op.execute`` argument.

    ``qontinui-coord`` ``pr_merge/migration_classifier.rs`` (``classify_op``,
    the ``"execute"`` arm) rejects an ``op.execute`` whose argument carries no
    string literal: "op.execute with no static SQL string literal (dynamic =
    unsafe)". An f-string or a helper call reintroduced here would hold the PR
    on the merge train again.
    """
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "the revision makes no op.execute calls at all"
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} is not a static string literal"
        )


def test_no_module_level_drop_template_reappears() -> None:
    """No DROP COLUMN text outside downgrade(), where the drop guard reads it."""
    tree = ast.parse(_revision_source())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring is prose
        for literal in (
            n.value
            for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        ):
            assert "DROP COLUMN" not in literal.upper(), (
                "a DROP COLUMN template reappeared OUTSIDE downgrade()"
            )


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_columns_present(engine: Engine) -> None:
    for name, pg_type in _EXPECTED:
        info = column_info(engine, _TABLE, name)
        assert info is not None, f"{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == pg_type, f"{name} is {data_type}, expected {pg_type}"
        assert is_nullable == "YES", f"{name} is NOT NULL; NULL must mean not measured"
        assert default is None, (
            f"{name} carries DEFAULT {default!r}; that fabricates a reading into every row a publisher without a sensor sends"
        )


def _assert_columns_commented(engine: Engine) -> None:
    for name, _ in _EXPECTED:
        live = column_comment(engine, _TABLE, name)
        assert live == _expected_comment(name), (
            f"{name}'s live comment differs from the one its revision emits"
        )


def _assert_columns_absent(engine: Engine) -> None:
    for name, _ in _EXPECTED:
        assert column_info(engine, _TABLE, name) is None, f"{name} survived downgrade"


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_an_unmeasured_row_reads_null_and_a_real_zero_round_trips() -> None:
    """A row omitting the field stays NULL; 0.0 and 71.5 round-trip as numbers."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "cputemp01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        unmeasured = uuid.uuid4()
        zero = uuid.uuid4()
        hot = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:unmeasured, 'host', now(), 'test')
                    """
                ),
                {"unmeasured": str(unmeasured)},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source, cpu_temp_c)
                    VALUES
                        (:zero, 'host', now(), 'test', 0.0),
                        (:hot, 'host', now(), 'test', 71.5)
                    """
                ),
                {"zero": str(zero), "hot": str(hot)},
            )
            rows = {
                str(r[0]): r[1]
                for r in conn.execute(
                    text(
                        """
                        SELECT device_id, cpu_temp_c
                          FROM coord.device_resource_samples
                         WHERE device_id IN (:unmeasured, :zero, :hot)
                        """
                    ),
                    {
                        "unmeasured": str(unmeasured),
                        "zero": str(zero),
                        "hot": str(hot),
                    },
                )
            }

        assert rows[str(unmeasured)] is None, (
            "a row from a publisher that omits the field must read NULL "
            "(not measured), never a fabricated 0"
        )
        assert rows[str(zero)] is not None and rows[str(zero)] == 0.0
        assert rows[str(hot)] == 71.5


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row() -> None:
    """Downgrade drops the one column and touches nothing else."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "cputemp01r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        device_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:device_id, 'host', now(), 'test')
                    """
                ),
                {"device_id": str(device_id)},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _TABLE), (
            "downgrade dropped the TABLE; it belongs to fleet_res_tel_01"
        )
        with engine.connect() as conn:
            survived = conn.execute(
                text(
                    "SELECT count(*) FROM coord.device_resource_samples "
                    "WHERE device_id = :device_id"
                ),
                {"device_id": str(device_id)},
            ).scalar_one()
        assert survived == 1, "downgrade destroyed a pre-existing sample row"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)


def test_upgrade_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-running the revision's own ADD is a no-op, not an error."""
    add = _add_statement(monkeypatch)
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "cputemp01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        with engine.begin() as conn:
            conn.execute(text(add))

        _assert_columns_present(engine)
        _assert_columns_commented(engine)
