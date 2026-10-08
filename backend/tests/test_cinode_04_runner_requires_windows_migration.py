"""Structural and round-trip test for alembic ``cinode_04_runner_requires_windows``.

Plan ``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``
Phase 4b, data half: seed ``qontinui/qontinui-runner``'s
``coord.canonical_repos.ci_node_required_capabilities`` to ``["os:windows"]``.

Without a database (always runs):

1. Chain wiring: the parent is ``coord_devices_ui_thread_01`` (main's head
   when this landed; ``cinode_02`` is further down the chain) and the
   ``Revises:`` header agrees with ``down_revision``.
2. Each direction is exactly one guarded ``UPDATE`` of the runner row: the
   upgrade writes only over the default ``[]``, the downgrade resets only the
   exact seeded value. No DDL rides along (the DDL is ``cinode_02``'s, and must
   stay classifier-clean there).

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

3. The runner row is seeded and no other row changes.
4. A re-run never overwrites a value set since, and a downgrade never resets
   one; up, down, up round-trips.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

_REVISION_ID = "cinode_04_runner_requires_windows"
_REVISION_FILENAME = "cinode_04_runner_requires_windows.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# this line, the assignment, and the Revises header together.
_PARENT_REVISION_ID = "coord_devices_ui_thread_01"

_TABLE = "canonical_repos"
_COLUMN = "ci_node_required_capabilities"
_RUNNER_REPO = "qontinui/qontinui-runner"
_SEED = ["os:windows"]

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
# 2. one guarded UPDATE each way
# ---------------------------------------------------------------------------


def test_upgrade_seeds_only_the_runner_row_over_the_default() -> None:
    assert _sql_literals("upgrade") == [
        f"UPDATE coord.{_TABLE} SET {_COLUMN} = '{json.dumps(_SEED)}'::jsonb "
        f"WHERE repo = '{_RUNNER_REPO}' AND {_COLUMN} = '[]'::jsonb"
    ]


def test_downgrade_resets_only_the_exact_seeded_value() -> None:
    assert _sql_literals("downgrade") == [
        f"UPDATE coord.{_TABLE} SET {_COLUMN} = '[]'::jsonb "
        f"WHERE repo = '{_RUNNER_REPO}' AND {_COLUMN} = '{json.dumps(_SEED)}'::jsonb"
    ]


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
def test_the_runner_row_is_seeded_and_no_other_row_changes() -> None:
    with ephemeral_database(admin_database_url(), "cinode04_seed") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _insert_repo(engine, _RUNNER_REPO)
        _insert_repo(engine, "qontinui/qontinui-coord")
        assert _caps(engine, _RUNNER_REPO) == []

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _caps(engine, _RUNNER_REPO) == _SEED
        assert _caps(engine, "qontinui/qontinui-coord") == []

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _caps(engine, _RUNNER_REPO) == []
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _caps(engine, _RUNNER_REPO) == _SEED


@_needs_pg
def test_a_value_set_since_survives_both_directions() -> None:
    with ephemeral_database(admin_database_url(), "cinode04_keep") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _insert_repo(engine, _RUNNER_REPO)
        custom = ["os:windows", "shell:powershell"]
        _set_caps(engine, _RUNNER_REPO, json.dumps(custom))

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _caps(engine, _RUNNER_REPO) == custom

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _caps(engine, _RUNNER_REPO) == custom


@_needs_pg
def test_upgrade_on_a_database_without_the_runner_row_touches_nothing() -> None:
    with ephemeral_database(admin_database_url(), "cinode04_empty") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert (
            scalar(
                engine,
                f"SELECT count(*) FROM coord.{_TABLE} WHERE {_COLUMN} <> '[]'::jsonb",
            )
            == 0
        )
