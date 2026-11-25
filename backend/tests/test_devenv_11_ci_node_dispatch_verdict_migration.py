"""Structural and round-trip test for alembic ``devenv_11_ci_node_dispatch_verdict``.

Plan ``2026-11-25-ci-node-dispatch-verdict-survives-reload`` Phase 1: three
nullable columns on ``devenv.machines`` that persist the last CI-node dispatch
verdict (HTTP status, error code, detail). NULL means "no verdict recorded",
never "delivered".

Without a database (always runs):

1. Chain wiring: the parent is pinned and the ``Revises:`` header agrees with
   ``down_revision``.
2. Coord's merge classifier shape: the upgrade drops nothing, the ALTER is an
   exact static literal naming ``devenv.machines``, every COMMENT targets it,
   and the ``lock_timeout`` is put back.
3. The downgrade removes exactly the three columns the upgrade adds.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. The columns land nullable with the right types, no default and a comment; a
   pre-existing row reads NULL.
5. ``upgrade()`` is idempotent; up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import Engine, text

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "devenv_11_ci_node_dispatch_verdict"
_REVISION_FILENAME = "devenv_11_ci_node_dispatch_verdict.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# this line, the assignment, and the Revises header together.
_PARENT_REVISION_ID = "coord_subprojects_05_note_events"

_SCHEMA = "devenv"
_TABLE = "machines"
_COLUMNS = (
    "ci_node_dispatch_status",
    "ci_node_dispatch_error",
    "ci_node_dispatch_detail",
)
_TYPES = {
    "ci_node_dispatch_status": "integer",
    "ci_node_dispatch_error": "text",
    "ci_node_dispatch_detail": "text",
}
# A phrase each column's COMMENT must carry, so a swapped or emptied comment fails.
_COMMENT_HINTS = {
    "ci_node_dispatch_status": "HTTP status coord answered",
    "ci_node_dispatch_error": "Outcome code of the last non-delivered",
    "ci_node_dispatch_detail": "Human-readable detail",
}

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
    """Every string constant inside ``name()`` except its own docstring."""
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
# 2. classifier shape
# ---------------------------------------------------------------------------


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_upgrade_is_static_literals_on_devenv_machines() -> None:
    sql = _sql_literals("upgrade")
    assert sql[0] == "SET LOCAL lock_timeout = '3s'"
    assert sql[2] == "SET LOCAL lock_timeout = DEFAULT"
    assert sql[1] == (
        "ALTER TABLE devenv.machines "
        "ADD COLUMN IF NOT EXISTS ci_node_dispatch_status INTEGER NULL, "
        "ADD COLUMN IF NOT EXISTS ci_node_dispatch_error TEXT NULL, "
        "ADD COLUMN IF NOT EXISTS ci_node_dispatch_detail TEXT NULL"
    )
    comments = [s for s in sql if s.startswith("COMMENT ON COLUMN")]
    assert [c.split(" IS ")[0] for c in comments] == [
        f"COMMENT ON COLUMN {_SCHEMA}.{_TABLE}.{c}" for c in _COLUMNS
    ]
    for s in sql:
        assert "DO $" not in s and "RESET" not in s.upper()


# ---------------------------------------------------------------------------
# 3. downgrade mirrors upgrade
# ---------------------------------------------------------------------------


def test_downgrade_drops_exactly_the_three_columns() -> None:
    assert _sql_literals("downgrade") == [
        "SET LOCAL lock_timeout = '3s'",
        "ALTER TABLE devenv.machines "
        "DROP COLUMN IF EXISTS ci_node_dispatch_detail, "
        "DROP COLUMN IF EXISTS ci_node_dispatch_error, "
        "DROP COLUMN IF EXISTS ci_node_dispatch_status",
        "SET LOCAL lock_timeout = DEFAULT",
    ]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _col(engine: Engine, col: str) -> tuple[str, str, str | None] | None:
    return column_info(engine, _TABLE, col, schema=_SCHEMA)


@_needs_pg
def test_columns_land_nullable_and_a_prior_row_reads_null() -> None:
    with ephemeral_database(admin_database_url(), "devenv11_cols") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        machine_id = str(uuid4())
        with engine.begin() as conn:
            # The owner FK targets auth.users; this test is about the new
            # columns, so skip FK enforcement for the seed row only.
            conn.execute(text("SET LOCAL session_replication_role = replica"))
            conn.execute(
                text(
                    "INSERT INTO devenv.machines (id, owner_user_id, name) "
                    "VALUES (:i, :o, 'm')"
                ),
                {"i": machine_id, "o": str(uuid4())},
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert _col(engine, col) == (_TYPES[col], "YES", None)
            comment = column_comment(engine, _TABLE, col, schema=_SCHEMA) or ""
            assert _COMMENT_HINTS[col] in comment
            assert "never delivered" in comment
            assert (
                scalar(
                    engine,
                    f"SELECT {col} IS NULL FROM devenv.{_TABLE} WHERE id = :i",
                    i=machine_id,
                )
                is True
            )


@_needs_pg
def test_upgrade_is_idempotent_and_round_trips() -> None:
    with ephemeral_database(admin_database_url(), "devenv11_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        # Re-executing the revision over its own columns is a no-op.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert _col(engine, col) == (_TYPES[col], "YES", None)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for col in _COLUMNS:
            assert _col(engine, col) is None
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert _col(engine, col) == (_TYPES[col], "YES", None)
