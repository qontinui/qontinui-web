"""Structural and round-trip test for alembic ``ci_measure_01_dispatch_measurement``.

Plan ``2026-11-22-phase1-envelope-frozen-and-measurement-dispatch-proven``
Phase 4 (web DDL half): ``coord.ci_dispatches.measurement`` (the declaration
snapshot of a measurement dispatch) and the comments on ``coord.run_outcomes``
naming ``qontinui-measurement`` as the third lane.

Without a database (always runs):

1. Chain wiring: the parent is pinned and the ``Revises:`` header agrees with
   ``down_revision``.
2. Coord's merge classifier shape: the upgrade drops nothing (the coord
   column-drop guard agrees), the ALTER is an exact static literal carrying the
   inline CHECK, and the ``lock_timeout`` is put back.
3. The lane comments name all three lanes, and the downgrade restores
   ``run_outcomes_01``'s two-lane text byte for byte and drops the column.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``:

4. The column lands nullable ``jsonb`` with no default and a comment; a
   pre-existing row reads NULL; an object is accepted and an array refused.
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
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

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

_REVISION_ID = "ci_measure_01_dispatch_measurement"
_REVISION_FILENAME = "ci_measure_01_dispatch_measurement.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# this line, the assignment, and the Revises header together.
_PARENT_REVISION_ID = "coord_maint_agent_req_01"

_TABLE = "ci_dispatches"
_COLUMN = "measurement"
_CONSTRAINT = "ci_dispatches_measurement_is_object"
_COMMENT_HINT = "Declaration snapshot at dispatch time"
_LANES = ("qontinui-ci-node", "qontinui-ci-node/shadow", "qontinui-measurement")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _versions() -> Path:
    return backend_root() / "alembic" / "versions"


def _revision_path() -> Path:
    return _versions() / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _sql_literals(name: str, path: Path | None = None) -> list[str]:
    """Every string constant inside ``name()`` except its own docstring."""
    source = (path or _revision_path()).read_text(encoding="utf-8")
    tree = ast.parse(source)
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


def _comment_on(sql: list[str], target: str) -> str:
    return next(s for s in sql if s.startswith(f"{target} IS "))


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


def test_upgrade_is_static_literals_with_an_inline_check() -> None:
    sql = _sql_literals("upgrade")
    assert sql[0] == "SET LOCAL lock_timeout = '3s'"
    assert sql[1] == (
        "ALTER TABLE coord.ci_dispatches "
        "ADD COLUMN IF NOT EXISTS measurement JSONB NULL "
        f"CONSTRAINT {_CONSTRAINT} "
        "CHECK (measurement IS NULL OR jsonb_typeof(measurement) = 'object')"
    )
    assert sql[2] == "SET LOCAL lock_timeout = DEFAULT"
    column = _comment_on(sql, "COMMENT ON COLUMN coord.ci_dispatches.measurement")
    assert _COMMENT_HINT in column
    assert "proposal_id holds a deterministic UUIDv5" in column
    assert "executed_case_count" in column
    for s in sql:
        assert "DO $" not in s and "RESET" not in s.upper()


# ---------------------------------------------------------------------------
# 3. lane comments, and the downgrade restores the two-lane text
# ---------------------------------------------------------------------------


def test_upgrade_comments_name_all_three_lanes() -> None:
    sql = _sql_literals("upgrade")
    check_name = _comment_on(sql, "COMMENT ON COLUMN coord.run_outcomes.check_name")
    for lane in _LANES:
        assert lane in check_name
    table = _comment_on(sql, "COMMENT ON TABLE coord.run_outcomes")
    assert "qontinui-measurement" in table


def test_downgrade_restores_run_outcomes_01_text_and_drops_the_column() -> None:
    original = _sql_literals(
        "upgrade", _versions() / "run_outcomes_01_coord_run_outcomes.py"
    )
    down = _sql_literals("downgrade")
    for target in (
        "COMMENT ON TABLE coord.run_outcomes",
        "COMMENT ON COLUMN coord.run_outcomes.check_name",
    ):
        assert _comment_on(down, target) == _comment_on(original, target)
    # The upgrade keeps the original table text and extends it.
    up_table = _comment_on(
        _sql_literals("upgrade"), "COMMENT ON TABLE coord.run_outcomes"
    )
    original_table = _comment_on(original, "COMMENT ON TABLE coord.run_outcomes")
    assert up_table.startswith(original_table.removesuffix("'"))
    assert down[-3:] == [
        "SET LOCAL lock_timeout = '3s'",
        "ALTER TABLE coord.ci_dispatches DROP COLUMN IF EXISTS measurement",
        "SET LOCAL lock_timeout = DEFAULT",
    ]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _insert_dispatch(conn: Connection, dispatch_id: str) -> None:
    conn.execute(
        text(
            "INSERT INTO coord.ci_dispatches "
            "(dispatch_id, tenant_id, repo, proposal_id, head_sha, device_id, "
            " state, check_name) "
            "VALUES (:d, :t, 'qontinui/qontinui-runner', :p, :h, :dev, "
            " 'queued', 'qontinui-measurement')"
        ),
        {
            "d": dispatch_id,
            "t": str(uuid4()),
            "p": str(uuid4()),
            "h": "a" * 40,
            "dev": str(uuid4()),
        },
    )


def _constraint_exists(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            "SELECT EXISTS (SELECT 1 FROM pg_constraint "
            "WHERE conname = :c AND conrelid = 'coord.ci_dispatches'::regclass)",
            c=_CONSTRAINT,
        )
    )


def _run_outcomes_table_comment(engine: Engine) -> str:
    comment = scalar(
        engine, "SELECT obj_description('coord.run_outcomes'::regclass, 'pg_class')"
    )
    return str(comment or "")


@_needs_pg
def test_column_lands_nullable_jsonb_and_refuses_a_non_object() -> None:
    with ephemeral_database(admin_database_url(), "cimeasure01_col") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        prior = str(uuid4())
        with engine.begin() as conn:
            _insert_dispatch(conn, prior)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == ("jsonb", "YES", None)
        assert _COMMENT_HINT in (column_comment(engine, _TABLE, _COLUMN) or "")
        assert (
            scalar(
                engine,
                "SELECT measurement IS NULL FROM coord.ci_dispatches WHERE dispatch_id = :d",
                d=prior,
            )
            is True
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.ci_dispatches SET measurement = "
                    '\'{"name": "unit", "source": "s", "subject": "x", '
                    '"task": "t"}\'::jsonb WHERE dispatch_id = :d'
                ),
                {"d": prior},
            )
        with pytest.raises(IntegrityError, match=_CONSTRAINT):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.ci_dispatches SET measurement = '[]'::jsonb "
                        "WHERE dispatch_id = :d"
                    ),
                    {"d": prior},
                )


@_needs_pg
def test_upgrade_is_idempotent_and_round_trips() -> None:
    with ephemeral_database(admin_database_url(), "cimeasure01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        # Re-executing the revision over its own column is a no-op.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == ("jsonb", "YES", None)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert not _constraint_exists(engine)
        assert "qontinui-measurement" not in (
            column_comment(engine, "run_outcomes", "check_name") or ""
        )
        assert "qontinui-measurement" not in _run_outcomes_table_comment(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == ("jsonb", "YES", None)
        assert _constraint_exists(engine)
        assert "qontinui-measurement" in (
            column_comment(engine, "run_outcomes", "check_name") or ""
        )
        assert "qontinui-measurement" in _run_outcomes_table_comment(engine)
        # The re-applied CHECK still refuses a non-object.
        dispatch_id = str(uuid4())
        with engine.begin() as conn:
            _insert_dispatch(conn, dispatch_id)
        with pytest.raises(IntegrityError, match=_CONSTRAINT):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.ci_dispatches SET measurement = '[]'::jsonb "
                        "WHERE dispatch_id = :d"
                    ),
                    {"d": dispatch_id},
                )
