"""Pins for alembic revision ``coord_pr_state_observed_at_01``.

Plan ``2026-10-01-the-shipped-demotion-hold-has-no-pr-state-clock-so-stale-open-citations-pin-false-shipped``
Phase 1: one nullable ``TIMESTAMPTZ`` column, ``pr_state_observed_at``, on BOTH
``coord.repo_branches`` and ``coord.displaced_pr_rows`` (the delivery reader's
two row sources, joined by ``UNION ALL``), which only PR-state authorities in
coord stamp. What is pinned:

1. the chain is wired (``down_revision`` names a parent defined in exactly one
   file);
2. ``upgrade()`` adds exactly that column to each table (no default, no
   backfill) plus a comment per table, idempotently; ``downgrade()`` drops
   exactly those columns. ``NULL`` is the conservative arm coord falls back
   on, so a ``DEFAULT now()`` here would forge a fresh observation onto every
   row -- the literal-shape assertions refuse it;
3. both directions bound the DDL's lock wait and restore the default, because
   env.py runs the batch in one transaction;
4. live: both columns exist nullable with no default and carry the comments
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

_REVISION_ID = "coord_pr_state_observed_at_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
# The single head of origin/main when this revision was authored. If coord's
# land-time re-point moves down_revision, update this literal with it.
_PARENT_REVISION_ID = "overlord_01_interventions"

_SCHEMA = "coord"
# Order matters: upgrade() adds to repo_branches first, downgrade() drops in
# the reverse order.
_TABLES = ("repo_branches", "displaced_pr_rows")
_COLUMN = "pr_state_observed_at"

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
    """Every ``op.<attr>(...)`` called directly in ``fn``'s own body.

    ``_execute_literals`` sees only ``op.execute``, so on its own it cannot
    pin "adds exactly the column": ``op.create_index`` or ``op.bulk_insert``
    would be invisible to it and to the live tests, which assert the target
    column's shape and never the absence of other catalogue changes.

    Bounded, deliberately: the walk is scoped to ``fn`` and matches the literal
    name ``op``, so a module-level helper's body and an aliased import are out
    of reach. coord's own migration classifier inlines module-level helpers for
    exactly this reason (``migration_classifier.rs``); replicating that here
    would buy little, because no revision in this tree uses either spelling.
    """
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
    # Files that DEFINE the parent revision — not files that share it as a
    # parent. Forks off one parent are pinned globally by
    # scripts/ci/count_alembic_heads.py, not here.
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
    assert len(literals) == 2 * len(_TABLES), literals
    for i, table in enumerate(_TABLES):
        add, comment = literals[2 * i], literals[2 * i + 1]
        assert re.fullmatch(
            rf"\s*ALTER TABLE {_SCHEMA}\.{table}\s+"
            rf"ADD COLUMN IF NOT EXISTS {_COLUMN} TIMESTAMPTZ\s*",
            add,
        ), add
        assert re.match(
            rf"\s*COMMENT ON COLUMN {_SCHEMA}\.{table}\.{_COLUMN} IS\s", comment
        ), comment


def test_downgrade_drops_exactly_the_columns_in_reverse_order() -> None:
    literals = _ddl_literals(_function("downgrade"))
    assert len(literals) == len(_TABLES), literals
    for sql, table in zip(literals, reversed(_TABLES), strict=True):
        assert re.fullmatch(
            rf"\s*ALTER TABLE {_SCHEMA}\.{table}\s+DROP COLUMN IF EXISTS {_COLUMN}\s*",
            sql,
        ), sql


def test_neither_direction_reaches_past_op_execute() -> None:
    """No ``op.add_column`` / ``op.create_index`` / ``op.bulk_insert``.

    Without this, "adds exactly the column (no default, no backfill)" is
    pinned only against ``op.execute``-spelled SQL: a later edit could add an
    index — reversing this revision's deliberate no-index decision — or a
    backfill, and every other test here would stay green.
    """
    for name in ("upgrade", "downgrade"):
        assert _op_attrs_used(_function(name)) == {"execute"}, name


def test_both_directions_bound_the_lock_wait_and_restore_it() -> None:
    """``SET LOCAL lock_timeout`` first, ``DEFAULT`` last, in both directions.

    Both tables are written by coord's webhook ingest (``coord.repo_branches``
    on every push and pull_request webhook), so an unbounded ACCESS EXCLUSIVE wait queues in front of coord's
    ingest. The restore matters because env.py runs the batch in ONE
    transaction: a ``SET LOCAL`` left set leaks into the next revision.
    """
    for name in ("upgrade", "downgrade"):
        literals = _execute_literals(_function(name))
        assert literals[0] == _LOCK_TIMEOUT_SET, (name, literals[0])
        assert literals[-1] == _LOCK_TIMEOUT_RESTORE, (name, literals[-1])
        # Exactly one pair: `_ddl_literals` filters the bracket by VALUE, so a
        # second pair inserted mid-function would be stripped from the DDL
        # count and still satisfy the first/last assertions above.
        assert literals.count(_LOCK_TIMEOUT_SET) == 1, (name, literals)
        assert literals.count(_LOCK_TIMEOUT_RESTORE) == 1, (name, literals)


def test_comments_state_the_observation_contract() -> None:
    src = _revision_source()
    live = comment_body_from_source(src, f"{_SCHEMA}.repo_branches.{_COLUMN}")
    assert "PR-state authority" in live
    assert "NULL = not observed since the column existed" in live
    assert "a non-authority pr_state write clears it" in live
    archived = comment_body_from_source(src, f"{_SCHEMA}.displaced_pr_rows.{_COLUMN}")
    assert "carried from coord.repo_branches on rebind" in archived
    assert "NULL = not observed since the column existed" in archived


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


@_needs_pg
def test_column_shape_and_comment_after_upgrade() -> None:
    with ephemeral_database(admin_database_url(), "prso01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert column_info(engine, table, _COLUMN) == (
                "timestamp with time zone",
                "YES",
                None,
            ), table
            assert column_comment(engine, table, _COLUMN) == comment_body_from_source(
                _revision_source(), f"{_SCHEMA}.{table}.{_COLUMN}"
            ), table


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "prso01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert column_info(engine, table, _COLUMN) is None, table
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert column_info(engine, table, _COLUMN) is not None, table
        # IF NOT EXISTS exercised for real: re-run the module's upgrade DDL.
        # The lock-wait bracket is skipped because `engine.begin()` below opens
        # a fresh transaction PER STATEMENT, so a `SET LOCAL` would expire at
        # the end of its own and constrain nothing.
        for sql in _ddl_literals(_function("upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        for table in _TABLES:
            assert column_info(engine, table, _COLUMN) is not None, table
