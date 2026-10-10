"""Structural and round-trip test for alembic ``mdroles_02``.

Plan ``2026-10-02-fleet-machine-roles-workhorse-bench-ci-node`` Amendment
2026-10-10 (A2 / A5 Phase A / A6): the dispatch role ``bench`` is renamed
``testbed``. ``mdroles_02`` swaps ``ck_machine_dispatch_roles_dispatch_role``
to ``('workhorse', 'testbed', 'ci_node')`` and restates the table comment.

Like ``mdroles_01``'s test, this does NOT pin the parent revision
(``down_revision`` is re-pointed at land time); it asserts the chain is
well-formed instead.

Without a database (always runs): chain wiring, one static coord-qualified
``ALTER TABLE`` per direction that drops and re-adds the SAME-named constraint
in a single statement, the exact role set each direction admits, no data DML,
the versions table untouched, both comments name the right role, and the
column-drop guard reading the upgrade as dropping no column.

With a database (``QONTINUI_TEST_PG=host:port``; skipped otherwise — a skip
proves nothing): ``testbed`` admitted and ``bench`` refused (pinned to SQLSTATE
23514 on the named constraint); a ``bench`` row present at ``mdroles_01`` makes
the upgrade FAIL rather than be rewritten; the versions table still accepts a
``bench`` snapshot (history is not value-checked); the comment lands as the
source writes it; idempotent upgrade; and an up/down/up round-trip, with a
``testbed`` row making the downgrade fail.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "mdroles_02"
_REVISION_FILENAME = "mdroles_02_dispatch_role_testbed.py"
_SCHEMA = "coord"
_TABLE = "machine_dispatch_roles"
_VERSIONS = "machine_dispatch_roles_versions"
_CK_ROLE = "ck_machine_dispatch_roles_dispatch_role"
_CHECK = "23514"

_UPGRADE_SET = ("workhorse", "testbed", "ci_node")
_DOWNGRADE_SET = ("workhorse", "bench", "ci_node")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _declared_parent() -> str:
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _function_source(name: str) -> str:
    segment = ast.get_source_segment(_revision_source(), _function(name))
    assert segment
    return segment


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


def _role_set(sql: str) -> tuple[str, ...]:
    match = re.search(
        rf"ADD\s+CONSTRAINT\s+{_CK_ROLE}\s+CHECK\s*\(\s*dispatch_role\s+IN\s*\(([^)]*)\)\s*\)",
        sql,
        re.I,
    )
    assert match, sql
    return tuple(v.strip().strip("'") for v in match.group(1).split(","))


# ---------------------------------------------------------------------------
# without a database
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}_wired")
    assert module.revision == _REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_the_declared_parent_is_exactly_one_real_sibling() -> None:
    parent = _declared_parent()
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_declared_parent())}$", source, re.M)


def test_both_directions_are_static_op_execute() -> None:
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant)


@pytest.mark.parametrize(
    ("direction", "expected"),
    [("upgrade", _UPGRADE_SET), ("downgrade", _DOWNGRADE_SET)],
)
def test_each_direction_swaps_the_named_check_in_one_statement(
    direction: str, expected: tuple[str, ...]
) -> None:
    literals = _sql_literals(_function(direction))
    alters = [s for s in literals if re.search(r"\bALTER\s+TABLE\b", s, re.I)]
    # One statement: the column is never unconstrained between a DROP and an ADD.
    assert len(alters) == 1, alters
    alter = alters[0]
    assert re.search(rf"ALTER\s+TABLE\s+{_SCHEMA}\.{_TABLE}\s", alter, re.I)
    drop = re.search(rf"DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+{_CK_ROLE}\b", alter, re.I)
    add = re.search(rf"ADD\s+CONSTRAINT\s+{_CK_ROLE}\b", alter, re.I)
    assert drop and add and drop.start() < add.start(), alter
    # Validated, not NOT VALID: a stray row must fail the migration loudly.
    assert not re.search(r"\bNOT\s+VALID\b", alter, re.I)
    assert _role_set(alter) == expected


def test_no_data_dml_and_the_versions_table_is_untouched() -> None:
    statements = [
        " ".join(s.split())
        for s in _sql_literals(_function("upgrade"))
        + _sql_literals(_function("downgrade"))
    ]
    # A6: no row can hold 'bench'; a stray one must fail the CHECK, not be
    # rewritten (coord's classifier also refuses data DML). So every statement
    # is the CHECK swap on the live table or its comment — nothing else. (The
    # comment's own text says "INSERT", so a keyword grep would misfire.)
    assert len(statements) == 4, statements
    for stmt in statements:
        assert stmt.startswith(
            (
                f"ALTER TABLE {_SCHEMA}.{_TABLE} ",
                f"COMMENT ON TABLE {_SCHEMA}.{_TABLE} IS ",
            )
        ), stmt
        if stmt.startswith("ALTER"):
            assert _VERSIONS not in stmt
            assert not re.search(r"\bDROP\s+(TABLE|COLUMN)\b", stmt, re.I)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_no_column() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_each_direction_restates_the_table_comment_with_its_role() -> None:
    up = comment_body_from_source(
        _function_source("upgrade"), f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
    )
    down = comment_body_from_source(
        _function_source("downgrade"), f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
    )
    assert "testbed = none" in up and not re.search(r"\bbench\b", up)
    assert "bench = none" in down and "testbed" not in down
    # Everything else the mdroles_01 comment promised is still said.
    for clause in ("SAME", "ON CONFLICT ON CONSTRAINT", "printable"):
        assert clause in up and clause in down, clause


def test_the_downgrade_comment_is_exactly_mdroles_01s() -> None:
    mdroles_01 = (
        backend_root() / "alembic" / "versions" / "mdroles_01_machine_dispatch_roles.py"
    ).read_text(encoding="utf-8")
    assert comment_body_from_source(
        _function_source("downgrade"), f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
    ) == comment_body_from_source(
        mdroles_01, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
    )


# ---------------------------------------------------------------------------
# with a database
# ---------------------------------------------------------------------------


def _insert(engine: Engine, role: str) -> uuid.UUID:
    with engine.begin() as conn:
        return conn.execute(  # type: ignore[no-any-return]
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} "
                "(tenant_id, machine_device_id, dispatch_role) "
                "VALUES (:t, :d, :r) RETURNING id"
            ),
            {"t": uuid.UUID(int=1), "d": uuid.uuid4(), "r": role},
        ).scalar_one()


def _assert_refused_by_role_check(exc: BaseException) -> None:
    orig = getattr(exc, "orig", None)
    assert getattr(orig, "pgcode", None) == _CHECK, str(exc)
    assert orig.diag.constraint_name == _CK_ROLE, str(exc)  # type: ignore[union-attr]


@_needs_pg
def test_testbed_is_admitted_and_bench_is_refused() -> None:
    with ephemeral_database(admin_database_url(), "mdroles02_set") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for role in _UPGRADE_SET:
            _insert(engine, role)
        for bad in ("bench", "Testbed", "test_bed"):
            with pytest.raises(sqlalchemy.exc.IntegrityError) as exc:
                _insert(engine, bad)
            _assert_refused_by_role_check(exc.value)


@_needs_pg
def test_a_bench_row_fails_the_upgrade_instead_of_being_rewritten() -> None:
    with ephemeral_database(admin_database_url(), "mdroles02_stray") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _declared_parent())
        _insert(engine, "bench")
        refused = run_alembic(
            backend_root(), db_url, "upgrade", _REVISION_ID, expect_success=False
        )
        assert _CK_ROLE in refused.stderr, refused.stderr
        # Nothing was rewritten: the row is still 'bench', the revision unapplied.
        assert (
            scalar(engine, f"SELECT dispatch_role FROM {_SCHEMA}.{_TABLE}") == "bench"
        )
        assert scalar(engine, "SELECT version_num FROM alembic_version") == (
            _declared_parent()
        )


@_needs_pg
def test_version_snapshots_are_not_value_checked() -> None:
    """History may still say 'bench'; the swap touches only the live table."""
    with ephemeral_database(admin_database_url(), "mdroles02_hist") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        role_id = _insert(engine, "testbed")
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {_SCHEMA}.{_VERSIONS} "
                    "(role_id, version, tenant_id, dispatch_role, updated_at) "
                    "VALUES (:r, 1, :t, 'bench', now())"
                ),
                {"r": role_id, "t": uuid.UUID(int=1)},
            )
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_VERSIONS}") == 1


@_needs_pg
def test_the_comment_lands_as_the_upgrade_writes_it() -> None:
    with ephemeral_database(admin_database_url(), "mdroles02_cmt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert scalar(
            engine, f"SELECT obj_description('{_SCHEMA}.{_TABLE}'::regclass)"
        ) == comment_body_from_source(
            _function_source("upgrade"), f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )


@_needs_pg
def test_upgrade_is_idempotent_and_up_down_up_round_trips() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "mdroles02_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM pg_constraint WHERE conname = :c",
                c=_CK_ROLE,
            )
            == 1
        )

        # A testbed row has no spelling in the older schema: downgrade refuses.
        testbed = _insert(engine, "testbed")
        blocked = run_alembic(
            backend_root(), db_url, "downgrade", parent, expect_success=False
        )
        assert _CK_ROLE in blocked.stderr, blocked.stderr

        with engine.begin() as conn:
            conn.execute(
                text(f"DELETE FROM {_SCHEMA}.{_TABLE} WHERE id = :id"), {"id": testbed}
            )
        run_alembic(backend_root(), db_url, "downgrade", parent)
        _insert(engine, "bench")
        with pytest.raises(sqlalchemy.exc.IntegrityError) as refused:
            _insert(engine, "testbed")
        _assert_refused_by_role_check(refused.value)

        with engine.begin() as conn:
            conn.execute(text(f"DELETE FROM {_SCHEMA}.{_TABLE}"))
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, "testbed")
