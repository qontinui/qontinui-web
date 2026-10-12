"""Pins for alembic revision ``coord_agent_sessions_context_01``.

Plan ``2026-10-02-a-red-or-conflicting-pr-cannot-trigger-a-gate-continuation-and-delivery-ignores-context-cost``
Phase 3 item 1 (design decision D3): two nullable columns on
``coord.agent_sessions`` -- ``context_tokens INTEGER`` and
``last_turn_at TIMESTAMPTZ`` -- written by coord's session-context route (fed
by the ``session-context-report.sh`` Stop hook) and read by coord's
``choose_delivery``. What is pinned:

1. the chain is wired (``down_revision`` names a parent defined in exactly one
   file);
2. ``upgrade()`` adds exactly those two columns (no default, no backfill) plus
   one comment per column, idempotently; ``downgrade()`` drops exactly those
   columns. ``NULL`` is the UNKNOWN arm the reader keeps today's behaviour on,
   so a ``DEFAULT 0`` or ``DEFAULT now()`` would forge a small context or a
   warm cache onto every session -- the literal-shape assertions refuse it;
3. both directions bound the DDL's lock wait and restore the default, because
   env.py runs the batch in one transaction;
4. every SQL string is one static literal (offline ``--sql`` mode renders it);
5. live: both columns exist nullable with no default and carry the comments
   the source authors, and up/down/up leaves no residue.

Structural tests always run; the live ones self-skip without a test Postgres
(``QONTINUI_TEST_PG=host:port``) and REPORT the skip.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
from sqlalchemy import text

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
)

_REVISION_ID = "coord_agent_sessions_context_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
# The single head of origin/main when this revision was authored. If coord's
# land-time re-point moves down_revision, update this literal with it.
_PARENT_REVISION_ID = "coord_pr_state_observed_at_01"

_SCHEMA = "coord"
_TABLE = "agent_sessions"
# (column, SQL type in the DDL, information_schema data_type)
_COLUMNS = (
    ("context_tokens", "INTEGER", "integer"),
    ("last_turn_at", "TIMESTAMPTZ", "timestamp with time zone"),
)
_PLAN_STEM = (
    "2026-10-02-a-red-or-conflicting-pr-cannot-trigger-a-gate-continuation-"
    "and-delivery-ignores-context-cost"
)

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


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level def {name}()")


_LOCK_TIMEOUT_SET = "SET LOCAL lock_timeout = '3s'"
_LOCK_TIMEOUT_RESTORE = "SET LOCAL lock_timeout = DEFAULT"


def _execute_literals(fn: ast.FunctionDef) -> list[str]:
    """The SQL of every ``op.execute`` call in ``fn``; each must be one literal."""
    literals: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            assert len(node.args) == 1 and isinstance(node.args[0], ast.Constant), (
                f"op.execute at line {node.lineno} must take one static SQL literal"
            )
            assert isinstance(node.args[0].value, str)
            literals.append(node.args[0].value)
    return literals


def _op_attrs_used(fn: ast.FunctionDef) -> set[str]:
    """Every ``op.<attr>(...)`` called directly in ``fn``'s own body."""
    return {
        node.func.attr
        for node in ast.walk(fn)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    }


def _ddl_literals(fn: ast.FunctionDef) -> list[str]:
    """``_execute_literals`` minus the lock-wait bracket."""
    return [
        sql
        for sql in _execute_literals(fn)
        if sql not in (_LOCK_TIMEOUT_SET, _LOCK_TIMEOUT_RESTORE)
    ]


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_defined_exactly_once() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    versions_dir = backend_root() / "alembic" / "versions"
    parent_definitions = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parent_definitions) == 1, [f.name for f in parent_definitions]
    assert module.branch_labels is None
    assert module.depends_on is None
    src = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in src
    assert f"Revises: {_PARENT_REVISION_ID}" in src


def test_upgrade_adds_exactly_the_columns_and_their_comments() -> None:
    literals = _ddl_literals(_function("upgrade"))
    assert len(literals) == 1 + len(_COLUMNS), literals
    add, *comments = literals
    adds = r",\s*".join(
        rf"ADD COLUMN IF NOT EXISTS {col} {sql_type}" for col, sql_type, _ in _COLUMNS
    )
    assert re.fullmatch(rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+{adds}\s*", add), add
    for comment, (col, _, _) in zip(comments, _COLUMNS, strict=True):
        assert re.match(
            rf"\s*COMMENT ON COLUMN {_SCHEMA}\.{_TABLE}\.{col} IS\s", comment
        ), comment


def test_downgrade_drops_exactly_the_columns_in_reverse_order() -> None:
    literals = _ddl_literals(_function("downgrade"))
    assert len(literals) == 1, literals
    drops = r",\s*".join(
        rf"DROP COLUMN IF EXISTS {col}" for col, _, _ in reversed(_COLUMNS)
    )
    assert re.fullmatch(
        rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+{drops}\s*", literals[0]
    ), literals[0]


def test_neither_direction_reaches_past_op_execute() -> None:
    """No ``op.add_column`` / ``op.create_index`` / ``op.bulk_insert``.

    The reader looks a row up by primary key, so an index here would be pure
    write amplification on a table coord writes every heartbeat; a backfill
    would forge a reading the hook never made.
    """
    for name in ("upgrade", "downgrade"):
        assert _op_attrs_used(_function(name)) == {"execute"}, name


def test_both_directions_bound_the_lock_wait_and_restore_it() -> None:
    """``SET LOCAL lock_timeout`` first, ``DEFAULT`` last, in both directions.

    coord writes ``coord.agent_sessions`` on every session heartbeat, so an
    unbounded ACCESS EXCLUSIVE wait queues in front of it. The restore matters
    because env.py runs the batch in ONE transaction.
    """
    for name in ("upgrade", "downgrade"):
        literals = _execute_literals(_function(name))
        assert literals[0] == _LOCK_TIMEOUT_SET, (name, literals[0])
        assert literals[-1] == _LOCK_TIMEOUT_RESTORE, (name, literals[-1])
        assert literals.count(_LOCK_TIMEOUT_SET) == 1, (name, literals)
        assert literals.count(_LOCK_TIMEOUT_RESTORE) == 1, (name, literals)


def test_comments_name_the_writer_the_reader_and_the_unknown_arm() -> None:
    src = _revision_source()
    for col, _, _ in _COLUMNS:
        body = comment_body_from_source(src, f"{_SCHEMA}.{_TABLE}.{col}")
        assert "session-context-report.sh" in body, col
        assert "coord session-context route" in body, col
        assert "choose_delivery" in body, col
        assert _PLAN_STEM in body, col
        assert "NULL = the hook never reported; read as UNKNOWN" in body, col
        # No doubled apostrophe: the comment bodies stay plain literals.
        assert "'" not in body, col


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


@_needs_pg
def test_column_shape_and_comment_after_upgrade() -> None:
    with ephemeral_database(admin_database_url(), "asctx01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col, _, data_type in _COLUMNS:
            assert column_info(engine, _TABLE, col) == (data_type, "YES", None), col
            assert column_comment(engine, _TABLE, col) == comment_body_from_source(
                _revision_source(), f"{_SCHEMA}.{_TABLE}.{col}"
            ), col


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "asctx01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for col, _, _ in _COLUMNS:
            assert column_info(engine, _TABLE, col) is None, col
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for col, _, _ in _COLUMNS:
            assert column_info(engine, _TABLE, col) is not None, col
        # IF NOT EXISTS exercised for real: re-run the module's upgrade DDL.
        for sql in _ddl_literals(_function("upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        for col, _, _ in _COLUMNS:
            assert column_info(engine, _TABLE, col) is not None, col
