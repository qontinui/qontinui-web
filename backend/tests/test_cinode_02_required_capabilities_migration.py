"""Structural and round-trip test for alembic ``cinode_02_required_capabilities``.

Plan ``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``
Phase 4b: ``coord.canonical_repos.ci_node_required_capabilities``, the per-repo
capability tokens coord's ``select_ci_node_device`` (Phase 4c) filters on with
``d.capabilities @> <column>``.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. The upgrade path drops nothing (the coord column-drop guard agrees), every
   statement is a static ``op.execute`` on ``coord.canonical_repos``, and the
   column is declared ``JSONB NOT NULL DEFAULT '[]'`` — additive, so a coord
   build that never reads it is unaffected.
3. The seed targets ``qontinui/qontinui-runner`` with ``["os:windows"]`` only,
   and is guarded on the default so a re-run never overwrites a set value.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port`` (``conftest.py``
derives ``DATABASE_URL`` from it at import time):

4. The column lands with the declared type, nullability and default, and every
   pre-existing row backfills to ``[]`` except the seeded runner row.
5. The CHECK refuses a non-array and an array holding a non-string, and admits
   an array of strings.
6. ``upgrade()`` is idempotent and preserves a value set after the first run;
   up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
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

_REVISION_ID = "cinode_02_required_capabilities"
_REVISION_FILENAME = "cinode_02_ci_node_required_capabilities.py"

# Pinned as a literal so a re-point of down_revision is a deliberate two-file
# change: this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "overview_03_documents_and_wiki"

_TABLE = "canonical_repos"
_COLUMN = "ci_node_required_capabilities"
_CONSTRAINT = "ck_canonical_repos_ci_node_required_capabilities"
_SEEDED_REPO = "qontinui/qontinui-runner"
_SEED = ["os:windows"]

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


def _function(name: str) -> ast.FunctionDef:
    for node in _tree().body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(name: str) -> list[str]:
    """Every string constant inside ``name()`` except its own docstring."""
    fn = _function(name)
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


def _normalized(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


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
    assert len(siblings) == 1, [f.name for f in siblings]
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. additive, static, coord-qualified
# ---------------------------------------------------------------------------


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_both_directions_are_static_op_execute_on_canonical_repos() -> None:
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
        # coord merge-train classifier: dynamic SQL is uninspectable.
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)
        assert f"coord.{_TABLE}" in call.args[0].value, (
            f"op.execute at line {call.lineno} touches something other than "
            f"coord.{_TABLE}"
        )


def test_upgrade_adds_the_column_jsonb_not_null_default_empty_array() -> None:
    adds = [
        _normalized(sql)
        for sql in _sql_literals("upgrade")
        if "ADD COLUMN" in sql.upper()
    ]
    assert adds == [
        f"ALTER TABLE coord.{_TABLE} ADD COLUMN IF NOT EXISTS {_COLUMN} "
        "JSONB NOT NULL DEFAULT '[]'::jsonb"
    ]


def test_the_check_pins_an_array_of_strings() -> None:
    upgrade_sql = "\n".join(_sql_literals("upgrade"))
    assert _CONSTRAINT in upgrade_sql
    assert f"jsonb_typeof({_COLUMN}) = 'array'" in upgrade_sql
    # STRICT mode: a lax filter unwraps a nested array item before testing
    # it, so '[["os:windows"]]' would pass a lax check.
    assert 'strict $[*] ? (@.type() != "string")' in upgrade_sql


def test_downgrade_removes_exactly_the_constraint_and_the_column() -> None:
    down = [_normalized(sql) for sql in _sql_literals("downgrade")]
    assert down == [
        f"ALTER TABLE coord.{_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}",
        f"ALTER TABLE coord.{_TABLE} DROP COLUMN IF EXISTS {_COLUMN}",
    ]


# ---------------------------------------------------------------------------
# 3. the seed
# ---------------------------------------------------------------------------


def test_the_seed_is_the_runner_windows_leg_and_guarded_on_the_default() -> None:
    updates = [
        _normalized(sql)
        for sql in _sql_literals("upgrade")
        if sql.strip().upper().startswith("UPDATE")
    ]
    assert updates == [
        f"UPDATE coord.{_TABLE} SET {_COLUMN} = '{json.dumps(_SEED)}'::jsonb "
        f"WHERE repo = '{_SEEDED_REPO}' AND {_COLUMN} = '[]'::jsonb"
    ]
    # The allowlist is matched from the device's ci_repo:<repo> token against
    # the row's own repo (Phase 4c); storing it here would duplicate ``repo``.
    assert not any("ci_repo:" in sql for sql in updates)


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _insert_repo(engine: Engine, repo: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.canonical_repos (repo, github_remote) "
                "VALUES (:repo, :remote)"
            ),
            {"repo": repo, "remote": f"https://github.com/{repo}.git"},
        )


def _caps(engine: Engine, repo: str) -> object:
    return scalar(
        engine,
        f"SELECT {_COLUMN} FROM coord.{_TABLE} WHERE repo = :repo",
        repo=repo,
    )


def _set_caps(engine: Engine, repo: str, value: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"UPDATE coord.{_TABLE} SET {_COLUMN} = CAST(:v AS jsonb) "
                "WHERE repo = :repo"
            ),
            {"v": value, "repo": repo},
        )


@_needs_pg
def test_column_lands_backfilled_and_the_runner_row_is_seeded() -> None:
    with ephemeral_database(admin_database_url(), "cinode02_seed") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        _insert_repo(engine, _SEEDED_REPO)
        _insert_repo(engine, "qontinui/qontinui-coord")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        info = column_info(engine, _TABLE, _COLUMN)
        assert info is not None
        data_type, nullable, default = info
        assert data_type == "jsonb"
        assert nullable == "NO"
        assert default == "'[]'::jsonb"
        assert column_comment(engine, _TABLE, _COLUMN)
        assert _caps(engine, _SEEDED_REPO) == _SEED
        assert _caps(engine, "qontinui/qontinui-coord") == []

        # A row inserted after the migration takes the default.
        _insert_repo(engine, "qontinui/qontinui-web")
        assert _caps(engine, "qontinui/qontinui-web") == []


@_needs_pg
def test_the_check_refuses_a_malformed_value() -> None:
    with ephemeral_database(admin_database_url(), "cinode02_ck") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert_repo(engine, "qontinui/qontinui-web")
        for bad in ('{"os": "windows"}', '"os:windows"', '["os:windows", 1]', "[[]]", '[["os:windows"]]'):
            with pytest.raises(IntegrityError):
                _set_caps(engine, "qontinui/qontinui-web", bad)
        _set_caps(engine, "qontinui/qontinui-web", '["os:linux", "runtime:docker"]')
        assert _caps(engine, "qontinui/qontinui-web") == ["os:linux", "runtime:docker"]


@_needs_pg
def test_upgrade_is_idempotent_keeps_a_set_value_and_round_trips() -> None:
    with ephemeral_database(admin_database_url(), "cinode02_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _insert_repo(engine, _SEEDED_REPO)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # An operator changes the runner's requirement; a re-run must keep it.
        _set_caps(engine, _SEEDED_REPO, '["os:windows", "shell:powershell"]')
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _caps(engine, _SEEDED_REPO) == ["os:windows", "shell:powershell"]

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM pg_constraint WHERE conname = :c",
                c=_CONSTRAINT,
            )
            == 0
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _caps(engine, _SEEDED_REPO) == _SEED
