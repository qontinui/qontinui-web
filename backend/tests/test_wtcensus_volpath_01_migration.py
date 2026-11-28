"""Structural and round-trip test for alembic ``wtcensus_volpath_01_resolved_volume_paths``.

Plan ``2026-11-22-coord-charges-a-build-in-a-symlinked-agent-worktree-to-root``
Phase 1 (web half).

Without a database (always runs):

1. Chain wiring: the parent is pinned and the ``Revises:`` header agrees with
   ``down_revision``.
2. Both resolved-path columns are added to EACH of the three census tables (the
   split tables mirror the oplog column-for-column), the upgrade drops nothing,
   and the column-drop guard reads the upgrade path as dropping nothing.
3. Both directions bound their lock wait first and reset ``lock_timeout`` to
   DEFAULT as their LAST statement.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. At this revision every census table carries both columns as nullable TEXT
   with no default; ``upgrade()`` is idempotent; down removes them; up again
   restores them.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "wtcensus_volpath_01_resolved_volume_paths"
_REVISION_FILENAME = "wtcensus_volpath_01_resolved_volume_paths.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# this line, the assignment, and the Revises header together.
_PARENT_REVISION_ID = "ci_measure_01_dispatch_measurement"

_TABLES = ("worktree_census", "worktree_census_latest", "worktree_census_history")
_COLUMNS = ("build_target_volume_path", "worktree_volume_path")

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


def _sql_literals(name: str) -> list[str]:
    """Every string constant inside ``name()`` except its docstring, whitespace-folded."""
    tree = ast.parse(_revision_source())
    fn = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    )
    doc = ast.get_docstring(fn, clean=False)
    return [
        re.sub(r"\s+", " ", node.value).strip()
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_chains_off_its_parent() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. every table gets both columns; nothing is dropped on the way up
# ---------------------------------------------------------------------------


def test_upgrade_adds_both_columns_to_every_census_table() -> None:
    up = "\n".join(_sql_literals("upgrade"))
    for table in _TABLES:
        for column in _COLUMNS:
            pattern = (
                rf"ALTER TABLE coord\.{table} [^;]*?"
                rf"ADD COLUMN IF NOT EXISTS {column} TEXT\b"
            )
            assert re.search(pattern, up), f"upgrade() does not add {table}.{column}"
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"


def test_downgrade_drops_both_columns_from_every_census_table() -> None:
    down = "\n".join(_sql_literals("downgrade"))
    for table in _TABLES:
        for column in _COLUMNS:
            pattern = (
                rf"ALTER TABLE coord\.{table} [^;]*?DROP COLUMN IF EXISTS {column}\b"
            )
            assert re.search(pattern, down), f"downgrade() keeps {table}.{column}"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. lock_timeout bounded first and reset last
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
def test_lock_timeout_is_bounded_then_reset(direction: str) -> None:
    literals = _sql_literals(direction)
    assert literals[0] == "SET LOCAL lock_timeout = '3s'"
    assert literals[-1] == "SET LOCAL lock_timeout = DEFAULT"


# ---------------------------------------------------------------------------
# 4. live database round trip
# ---------------------------------------------------------------------------


def _assert_columns(engine: Engine, present: bool) -> None:
    for table in _TABLES:
        for column in _COLUMNS:
            info = column_info(engine, table, column)
            if present:
                assert info == ("text", "YES", None), f"coord.{table}.{column}: {info}"
            else:
                assert info is None, f"coord.{table}.{column} survived: {info}"


@_needs_pg
def test_round_trip_and_idempotent_upgrade() -> None:
    with ephemeral_database(admin_database_url(), "wtvp01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_columns(engine, present=False)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)

        # Re-running the upgrade over columns that already exist is a no-op
        # (ADD COLUMN IF NOT EXISTS): stamp back to the parent and upgrade again.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns(engine, present=False)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)
