"""Structural and round-trip test for alembic ``coord_ci_runs_started_at_01``.

Plan ``2026-09-12-red-main-alert-since-resets-mid-episode-and-a-non-required-gate-reds-main-through-the-fail-closed-arm``
Phase 2.1.

``coord.ci_runs.run_started_at`` is a contract the paired qontinui-coord
change codes against: its ``ci_runs`` upsert will write it with
``COALESCE(existing, new)`` and its ``red_main`` detector will read it to
compute ``detail.red_since``. The properties
pinned here are the ones that would break those readers at runtime while every
migration gate stays green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. The only change is one nullable, default-less ``TIMESTAMPTZ`` column on
   ``coord.ci_runs``; the only DROP is in ``downgrade()``, and the column-drop
   guard reads the upgrade path as dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL, which is what the
   coord merge-train classifier can read and what offline ``--sql`` mode needs.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. The column is ``timestamp with time zone``, nullable, no default, a
   pre-existing row reads NULL, and the comment lands as the source writes it.
5. coord's ``COALESCE(ci_runs.run_started_at, EXCLUDED.run_started_at)``
   upsert keeps the first value across a re-run.
6. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
from datetime import UTC, datetime
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
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_ci_runs_started_at_01"
_REVISION_FILENAME = "coord_ci_runs_started_at_01_add_column.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "coord_iops_idx_01"

_SCHEMA = "coord"
_TABLE = "ci_runs"
_COLUMN = "run_started_at"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant inside ``fn`` except its own docstring."""
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"sibling (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. exactly one nullable column, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------


def test_the_only_change_is_the_one_nullable_column() -> None:
    """One ADD COLUMN, TIMESTAMPTZ, nullable, no default — nothing else is DDL."""
    ddl = [
        " ".join(sql.split())
        for sql in _sql_literals(_function(_tree(), "upgrade"))
        if re.search(r"\b(?:ALTER|CREATE|DROP)\b", sql, re.I)
    ]
    assert ddl == [
        f"ALTER TABLE {_SCHEMA}.{_TABLE} ADD COLUMN IF NOT EXISTS {_COLUMN} TIMESTAMPTZ"
    ], ddl


def test_the_only_drop_is_the_column_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    drops = [
        " ".join(sql.split())
        for sql in _sql_literals(_function(tree, "downgrade"))
        if re.search(r"\bDROP\b", sql, re.I)
    ]
    assert drops == [
        f"ALTER TABLE {_SCHEMA}.{_TABLE} DROP COLUMN IF EXISTS {_COLUMN}"
    ], drops


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    calls = [
        node
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_FIRST_START = datetime(2026, 9, 2, 7, 56, tzinfo=UTC)
_RERUN_START = datetime(2026, 9, 2, 9, 30, tzinfo=UTC)

_COLUMN_SHAPE = ("timestamp with time zone", "YES", None)


def _insert_run(engine: Engine, run_id: int) -> None:
    """A row as it looked before this revision: no run_started_at."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.ci_runs
                    (repo, run_id, workflow_name, head_branch, event, status,
                     conclusion)
                VALUES ('qontinui/qontinui-coord', :run_id, 'ci', 'main', 'push',
                        'completed', 'failure')
                """
            ),
            {"run_id": run_id},
        )


def _upsert_started_at(engine: Engine, run_id: int, started: datetime) -> None:
    """The coord ci_runs upsert shape for this column: keep the first value."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.ci_runs
                    (repo, run_id, workflow_name, head_branch, event, status,
                     conclusion, run_started_at)
                VALUES ('qontinui/qontinui-coord', :run_id, 'ci', 'main', 'push',
                        'completed', 'failure', :started)
                ON CONFLICT (repo, run_id) DO UPDATE SET
                    run_started_at = COALESCE(coord.ci_runs.run_started_at,
                                              EXCLUDED.run_started_at),
                    observed_at = EXCLUDED.observed_at
                """
            ),
            {"run_id": run_id, "started": started},
        )


def _started_at(engine: Engine, run_id: int) -> object:
    return scalar(
        engine,
        "SELECT run_started_at FROM coord.ci_runs WHERE run_id = :run_id",
        run_id=run_id,
    )


@_needs_pg
def test_column_shape_null_backfill_and_comment() -> None:
    with ephemeral_database(admin_database_url(), "cirsa01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _insert_run(engine, 1)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert column_info(engine, _TABLE, _COLUMN) == _COLUMN_SHAPE
        # A pre-existing row reads NULL: the reader falls back to observed_at
        # and says so, rather than a default fabricating a start time.
        assert _started_at(engine, 1) is None

        comment = column_comment(engine, _TABLE, _COLUMN)
        assert comment == comment_body_from_source(
            _revision_source(), f"{_SCHEMA}.{_TABLE}.{_COLUMN}"
        )
        assert "ci_runs upsert" in str(comment), "the comment names its writer"


@_needs_pg
def test_coalesce_upsert_keeps_the_first_start_across_a_rerun() -> None:
    with ephemeral_database(admin_database_url(), "cirsa01_coal") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _upsert_started_at(engine, 2, _FIRST_START)
        _upsert_started_at(engine, 2, _RERUN_START)
        assert _started_at(engine, 2) == _FIRST_START

        # A legacy NULL row takes the first value it is ever given.
        _insert_run(engine, 3)
        _upsert_started_at(engine, 3, _RERUN_START)
        assert _started_at(engine, 3) == _RERUN_START


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "cirsa01_idem") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _upsert_started_at(engine, 4, _FIRST_START)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert column_info(engine, _TABLE, _COLUMN) == _COLUMN_SHAPE
        assert _started_at(engine, 4) == _FIRST_START, (
            "the re-run must not disturb existing values"
        )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "cirsa01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _upsert_started_at(engine, 5, _FIRST_START)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert table_exists(engine, _SCHEMA, _TABLE), (
            "downgrade must not touch ci_runs itself"
        )
        assert scalar(engine, "SELECT count(*) FROM coord.ci_runs") == 1

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == _COLUMN_SHAPE
        assert _started_at(engine, 5) is None, "the column comes back empty"
