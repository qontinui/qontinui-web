"""Structural and round-trip test for alembic ``cinode_05_dispatch_model_access_and_ledger``.

Plan ``2026-10-13-ci-node-runs-model-dependent-eval-steps`` Phase 3 item 1
(web DDL half): ``coord.ci_dispatches.model_access`` (coord's per-dispatch
model grant) and ``coord.ci_dispatches.model_ledger`` (the per-dispatch
model-call ledger the CI node reports with its result).

Without a database (always runs):

1. Chain wiring: the parent is pinned and the ``Revises:`` header agrees with
   ``down_revision``.
2. Coord's merge classifier shape: the upgrade drops nothing (the coord
   column-drop guard agrees), the ALTER is an exact static literal, both
   COMMENTs target ``coord.ci_dispatches``, and the ``lock_timeout`` is put back.
3. The downgrade removes exactly the two columns the upgrade adds.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Both columns land nullable ``jsonb`` with no default and a comment; a
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
from sqlalchemy import text

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

_REVISION_ID = "cinode_05_dispatch_model_access_and_ledger"
_REVISION_FILENAME = "cinode_05_dispatch_model_access_and_ledger.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# this line, the assignment, and the Revises header together.
_PARENT_REVISION_ID = "cpu_temp_01"

_TABLE = "ci_dispatches"
_COLUMNS = ("model_access", "model_ledger")
# A phrase each column's COMMENT must carry, so a swapped or emptied comment fails.
_COMMENT_HINTS = {
    "model_access": "Coord grant for brokered model calls",
    "model_ledger": "Per-dispatch model-call ledger",
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


def test_upgrade_is_static_literals_on_coord_ci_dispatches() -> None:
    sql = _sql_literals("upgrade")
    assert sql[0] == "SET LOCAL lock_timeout = '3s'"
    assert sql[-3] == "SET LOCAL lock_timeout = DEFAULT"
    assert sql[1] == (
        "ALTER TABLE coord.ci_dispatches "
        "ADD COLUMN IF NOT EXISTS model_access JSONB NULL, "
        "ADD COLUMN IF NOT EXISTS model_ledger JSONB NULL"
    )
    comments = [s for s in sql if s.startswith("COMMENT ON COLUMN")]
    assert [c.split(" IS ")[0] for c in comments] == [
        f"COMMENT ON COLUMN coord.{_TABLE}.{c}" for c in _COLUMNS
    ]
    for s in sql:
        assert "DO $" not in s and "RESET" not in s.upper()


# ---------------------------------------------------------------------------
# 3. downgrade mirrors upgrade
# ---------------------------------------------------------------------------


def test_downgrade_drops_exactly_the_two_columns() -> None:
    assert _sql_literals("downgrade") == [
        "SET LOCAL lock_timeout = '3s'",
        "ALTER TABLE coord.ci_dispatches "
        "DROP COLUMN IF EXISTS model_ledger, "
        "DROP COLUMN IF EXISTS model_access",
        "SET LOCAL lock_timeout = DEFAULT",
    ]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


@_needs_pg
def test_columns_land_nullable_jsonb_and_a_prior_row_reads_null() -> None:
    with ephemeral_database(admin_database_url(), "cinode05_cols") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        dispatch_id = str(uuid4())
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.ci_dispatches "
                    "(dispatch_id, tenant_id, repo, proposal_id, head_sha, device_id, "
                    " state, check_name) "
                    "VALUES (:d, :t, 'qontinui/qontinui-runner', :p, :h, :dev, "
                    " 'queued', 'ci-node')"
                ),
                {
                    "d": dispatch_id,
                    "t": str(uuid4()),
                    "p": str(uuid4()),
                    "h": "a" * 40,
                    "dev": str(uuid4()),
                },
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, _TABLE, col) == ("jsonb", "YES", None)
            assert _COMMENT_HINTS[col] in (column_comment(engine, _TABLE, col) or "")
            assert (
                scalar(
                    engine,
                    f"SELECT {col} IS NULL FROM coord.{_TABLE} WHERE dispatch_id = :d",
                    d=dispatch_id,
                )
                is True
            )


@_needs_pg
def test_upgrade_is_idempotent_and_round_trips() -> None:
    with ephemeral_database(admin_database_url(), "cinode05_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        # Re-executing the revision over its own columns is a no-op.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, _TABLE, col) == ("jsonb", "YES", None)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, _TABLE, col) is None
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, _TABLE, col) == ("jsonb", "YES", None)
            assert _COMMENT_HINTS[col] in (column_comment(engine, _TABLE, col) or "")
