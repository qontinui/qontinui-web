"""Structural and round-trip test for alembic ``coord_proposal_family_comments_01``.

Plan ``2026-09-12-proposal-is-a-family-noun-pin-the-incumbent-qualify-the-newcomers``
Phase 3.

The revision is comment-only: one ``COMMENT ON TABLE`` per proposal-family
table, naming which member the table is. The properties pinned here are the ones
a reviewer cannot see from the diff alone:

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every commented object is ``coord.``-qualified and is one of the family
   tables; the revision drops nothing, and the column-drop guard agrees.
3. Both directions are pure ``op.execute`` with static SQL, which is what the
   coord merge-train classifier can read and what offline ``--sql`` mode needs.
4. Every family table gets exactly one comment on the way up and exactly one
   ``IS NULL`` on the way down, and each comment names its member and points at
   the glossary.

With a database (skipped when none is reachable; a skip proves nothing). The
harness connects with ``DATABASE_URL``, but under pytest ``conftest.py``
overwrites that variable at import time from ``QONTINUI_TEST_PG``, so point the
tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

5. At the parent revision no family table carries a comment, which is what makes
   ``IS NULL`` the correct downgrade.
6. The table comments land as the source writes them.
7. ``upgrade()`` is idempotent, and up, down, up restores exactly the source's
   comments with no residue in between.
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

_REVISION_ID = "coord_proposal_family_comments_01"
_REVISION_FILENAME = "coord_proposal_family_comments_01_table_comments.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "coord_iops_idx_01"

_SCHEMA = "coord"

# table -> the member spelling its comment must name
_FAMILY_TABLES: dict[str, str] = {
    "merge_proposals": "merge member",
    "merge_proposal_repos": "merge member",
    "prompt_document_proposals": "policy_proposal",
    "policy_rule_proposals": "policy_rule_proposal",
    "work_plans": "work_plan_proposal",
}

_GLOSSARY = "coord-merge-train.md, section The word proposal"

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


def _upgrade_source() -> str:
    """The source text of ``upgrade()`` alone.

    ``downgrade()`` writes ``COMMENT ON TABLE <t> IS NULL`` for the same tables,
    and ``comment_body_from_source`` refuses a marker that appears twice, so the
    comment bodies are read from the upgrade half only.
    """
    source = _revision_source()
    segment = ast.get_source_segment(source, _function(_tree(), "upgrade"))
    assert segment is not None
    return segment


def _revision_module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


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


_COMMENT_TARGET = re.compile(r"COMMENT\s+ON\s+TABLE\s+([A-Za-z_.\"]+)\s+IS", re.I)


def _comment_targets(fn_name: str) -> list[str]:
    return [
        target
        for sql in _sql_literals(_function(_tree(), fn_name))
        for target in _COMMENT_TARGET.findall(sql)
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    parent = _PARENT_REVISION_ID

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {parent!r} must name exactly one existing sibling "
        f"(found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified family tables only, and nothing dropped
# ---------------------------------------------------------------------------


def test_every_commented_object_is_a_coord_family_table() -> None:
    allowed = {f"{_SCHEMA}.{t}" for t in _FAMILY_TABLES}
    for fn_name in ("upgrade", "downgrade"):
        for target in _comment_targets(fn_name):
            assert target in allowed, (
                f"{fn_name}(): {target!r} is not a coord proposal-family table"
            )


def test_the_revision_is_comment_only() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            stripped = sql.strip()
            assert re.match(r"COMMENT\s+ON\s+TABLE\b", stripped, re.I), (
                f"{fn_name}(): non-comment SQL {stripped[:60]!r}"
            )
            assert not re.search(r"\bDROP\b", stripped, re.I)
            # One statement per literal: a ';' outside a quoted comment body
            # would smuggle a second statement past the prefix check above.
            unquoted = re.sub(r"'(?:[^']|'')*'", "''", stripped)
            assert ";" not in unquoted, f"{fn_name}(): multi-statement SQL"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = _tree()
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        # coord merge-train classifier: an execute with no static string literal
        # is rejected as dynamic SQL it cannot inspect.
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


# ---------------------------------------------------------------------------
# 4. one comment per family table, each naming its member
# ---------------------------------------------------------------------------


def test_each_family_table_is_commented_once_and_cleared_once() -> None:
    expected = sorted(f"{_SCHEMA}.{t}" for t in _FAMILY_TABLES)
    assert sorted(_comment_targets("upgrade")) == expected
    assert sorted(_comment_targets("downgrade")) == expected
    down = "\n".join(_sql_literals(_function(_tree(), "downgrade")))
    assert len(re.findall(r"\bIS\s+NULL\b", down, re.I)) == len(_FAMILY_TABLES)


def test_each_comment_names_its_member_and_the_glossary() -> None:
    source = _upgrade_source()
    for table, member in _FAMILY_TABLES.items():
        body = comment_body_from_source(
            source, f"{_SCHEMA}.{table}", object_kind="TABLE"
        )
        assert body.startswith("Family: proposal ("), f"{table}: {body[:40]!r}"
        assert member in body, f"{table}: comment does not name {member!r}"
        assert _GLOSSARY in body, f"{table}: comment does not cite the glossary"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _table_comment(engine: Engine, table: str) -> object:
    return scalar(
        engine,
        f"SELECT obj_description('{_SCHEMA}.{table}'::regclass, 'pg_class')",
    )


@_needs_pg
def test_no_family_table_has_a_comment_at_the_parent() -> None:
    with ephemeral_database(admin_database_url(), "ppf01_prior") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        for table in _FAMILY_TABLES:
            assert table_exists(engine, _SCHEMA, table), f"coord.{table} missing"
            assert _table_comment(engine, table) is None, (
                f"coord.{table} already carries a comment; downgrade() must "
                "restore it instead of NULL"
            )


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _upgrade_source()
    with ephemeral_database(admin_database_url(), "ppf01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _FAMILY_TABLES:
            assert _table_comment(engine, table) == comment_body_from_source(
                source, f"{_SCHEMA}.{table}", object_kind="TABLE"
            ), f"comment on coord.{table} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent_and_up_down_up_round_trips() -> None:
    source = _upgrade_source()
    with ephemeral_database(admin_database_url(), "ppf01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table in _FAMILY_TABLES:
            assert table_exists(engine, _SCHEMA, table), (
                f"downgrade removed coord.{table}"
            )
            assert _table_comment(engine, table) is None, (
                f"coord.{table} kept a comment after downgrade"
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _FAMILY_TABLES:
            assert _table_comment(engine, table) == comment_body_from_source(
                source, f"{_SCHEMA}.{table}", object_kind="TABLE"
            )
