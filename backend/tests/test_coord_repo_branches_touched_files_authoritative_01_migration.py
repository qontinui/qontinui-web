"""Pins for alembic revision ``coord_repo_branches_touched_files_authoritative_01``.

Plan ``2026-09-10-citation-reenrich-is-unrunnable-and-plan-pr-is-unclassifiable``
Phase 1: one nullable ``TIMESTAMPTZ`` column on ``coord.repo_branches`` that
coord's citation re-enrich pass stamps as its durable skip rule. What is pinned:

1. the chain is wired (``down_revision`` names exactly one real sibling);
2. ``upgrade()`` adds exactly that column (no default, no backfill) plus its
   comment, idempotently; ``downgrade()`` drops exactly that column;
3. live: the column exists nullable with no default and carries the comment
   the source authors, and up/down/up leaves no residue. "No backfill" is
   pinned structurally (upgrade() has exactly the ADD COLUMN and the COMMENT,
   no UPDATE); the fresh test database has no rows to read back.

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

_REVISION_ID = "coord_repo_branches_touched_files_authoritative_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
# The single head of origin/main when this revision was authored. If coord's
# land-time re-point moves down_revision, update this literal with it.
_PARENT_REVISION_ID = "coord_ci_job_observations_02"

_SCHEMA = "coord"
_TABLE = "repo_branches"
_COLUMN = "touched_files_authoritative_at"

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


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    versions_dir = backend_root() / "alembic" / "versions"
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]
    assert module.branch_labels is None
    assert module.depends_on is None
    src = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in src
    assert f"Revises: {_PARENT_REVISION_ID}" in src


def test_upgrade_adds_exactly_the_column_and_its_comment() -> None:
    literals = _execute_literals(_function("upgrade"))
    assert len(literals) == 2, literals
    add, comment = literals
    assert re.fullmatch(
        rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+"
        rf"ADD COLUMN IF NOT EXISTS {_COLUMN} TIMESTAMPTZ\s*",
        add,
    ), add
    assert re.match(
        rf"\s*COMMENT ON COLUMN {_SCHEMA}\.{_TABLE}\.{_COLUMN} IS\s", comment
    ), comment


def test_downgrade_drops_exactly_the_column() -> None:
    literals = _execute_literals(_function("downgrade"))
    assert len(literals) == 1, literals
    assert re.fullmatch(
        rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+DROP COLUMN IF EXISTS {_COLUMN}\s*",
        literals[0],
    ), literals[0]


def test_comment_states_the_skip_contract() -> None:
    body = comment_body_from_source(_revision_source(), f"{_SCHEMA}.{_TABLE}.{_COLUMN}")
    assert body == (
        "Set by coord's citation re-enrich pass when touched_files on a "
        "TERMINAL PR row was hydrated from GitHub's PR-files API; a "
        "stamped row is never re-selected."
    )


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


@_needs_pg
def test_column_shape_and_comment_after_upgrade() -> None:
    with ephemeral_database(admin_database_url(), "rbtfa01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == (
            "timestamp with time zone",
            "YES",
            None,
        )
        assert column_comment(engine, _TABLE, _COLUMN) == comment_body_from_source(
            _revision_source(), f"{_SCHEMA}.{_TABLE}.{_COLUMN}"
        )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "rbtfa01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is not None
        # IF NOT EXISTS exercised for real: re-run the module's upgrade SQL.
        for sql in _execute_literals(_function("upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        assert column_info(engine, _TABLE, _COLUMN) is not None
