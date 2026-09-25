"""Pins for alembic revision ``coord_repo_branches_touched_files_authoritative_01``.

Plan ``2026-09-10-citation-reenrich-is-unrunnable-and-plan-pr-is-unclassifiable``
Phase 1: one nullable ``TIMESTAMPTZ`` column on ``coord.repo_branches`` that
coord's citation re-enrich pass stamps as its durable skip rule. What is pinned:

1. the chain is wired (``down_revision`` names a parent defined in exactly one
   file);
2. ``upgrade()`` adds exactly that column (no default, no backfill) plus its
   comment, idempotently; ``downgrade()`` drops exactly that column;
3. both directions bound the DDL's lock wait and restore the default, because
   env.py runs the batch in one transaction;
4. live: the column exists nullable with no default and carries the comment
   the source authors, and up/down/up leaves no residue. "No backfill" is
   pinned structurally, and pinned against the ``op.<attr>`` API rather than
   against ``op.execute`` alone: ``_op_attrs_used`` asserts neither function
   reaches for ``op.add_column``/``op.create_index``/``op.bulk_insert``/
   ``op.alter_column``. Its reach is the SPELLING, not the semantics -- it
   walks only the function body and only ``op.<attr>(...)``, so an aliased
   import (``from alembic import op as o``), a bare
   ``from alembic.op import ...`` or a module-level helper would slip past it.
   None of those spellings appears in this tree, and an index added the
   ordinary way (``op.execute("CREATE INDEX ...")``) is caught by the literal
   count instead. The fresh test database has no rows to read back.

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


def test_upgrade_adds_exactly_the_column_and_its_comment() -> None:
    literals = _ddl_literals(_function("upgrade"))
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
    literals = _ddl_literals(_function("downgrade"))
    assert len(literals) == 1, literals
    assert re.fullmatch(
        rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+DROP COLUMN IF EXISTS {_COLUMN}\s*",
        literals[0],
    ), literals[0]


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

    ``coord.repo_branches`` is upserted on every push and pull_request
    webhook, so an unbounded ACCESS EXCLUSIVE wait queues in front of coord's
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
        # IF NOT EXISTS exercised for real: re-run the module's upgrade DDL.
        # The lock-wait bracket is skipped because `engine.begin()` below opens
        # a fresh transaction PER STATEMENT, so a `SET LOCAL` would expire at
        # the end of its own and constrain nothing. It contributes nothing to
        # idempotency, which is the only property this loop pins.
        for sql in _ddl_literals(_function("upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        assert column_info(engine, _TABLE, _COLUMN) is not None
