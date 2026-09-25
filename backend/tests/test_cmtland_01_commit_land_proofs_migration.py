"""Structural and round-trip test for alembic ``cmtland_01``.

Plan ``2026-09-24-agents-cannot-record-delivery-for-a-landed-plan-coord-never-saw-land``
Phase 3. ``coord.commit_land_proofs`` is the contract coord's commit prover and
delivery read (plan Phases 4 and 5) code against.

Like ``phaseatt_01``'s test, this deliberately does NOT pin the parent
revision: ``down_revision`` is re-pointed at the merged head at land time. It
asserts the chain is WELL-FORMED instead.

Without a database (always runs): chain wiring, coord-qualified static
``op.execute`` DDL, ``IF NOT EXISTS`` upgrade, DROP only in downgrade, and the
column-drop guard reading the upgrade as dropping nothing.

With a database (``QONTINUI_TEST_PG=host:port``; skipped otherwise): column
shape, the ``(repo, commit_sha)`` primary key, both CHECKs, the table comment,
idempotent upgrade and an up/down/up round-trip.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
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

_REVISION_ID = "cmtland_01"
_REVISION_FILENAME = "cmtland_01_commit_land_proofs.py"
_SCHEMA = "coord"
_TABLE = "commit_land_proofs"

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("repo", "text", False, None),
    ("commit_sha", "text", False, None),
    ("verdict", "text", False, None),
    ("method", "text", True, None),
    ("landed_sha", "text", True, None),
    ("trunk", "text", False, None),
    ("trunk_tip", "text", True, None),
    ("patch_id", "text", True, None),
    ("changed_lines", "integer", True, None),
    ("touched_files", "ARRAY", True, None),
    ("abstain_reason", "text", True, None),
    ("detail", "text", True, None),
    ("proven_at", "timestamp with time zone", False, "now()"),
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


def _declared_parent() -> str:
    parent = load_revision_module(
        _revision_path(), f"_test_{_REVISION_ID}"
    ).down_revision
    assert isinstance(parent, str) and parent, f"down_revision is {parent!r}"
    return parent


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# without a database
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}_wired")
    assert module.revision == _REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_the_declared_parent_is_exactly_one_real_sibling() -> None:
    parent = _declared_parent()
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_declared_parent())}$", source, re.M)


def test_ddl_is_coord_qualified_idempotent_and_drops_only_in_downgrade() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    down = "\n".join(_sql_literals(_function("downgrade")))
    assert not re.search(r"\bDROP\b", up, re.I)
    assert re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", up, re.I
    )
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down)
    for obj in re.findall(
        r"(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?"
        r"|COMMENT\s+ON\s+(?:TABLE|COLUMN))\s+([A-Za-z_.\"]+)",
        up + "\n" + down,
        re.I,
    ):
        assert obj.startswith(f"{_SCHEMA}.{_TABLE}"), obj
    # tenant-less by design (plan §4.3)
    assert "tenant_id" not in up


def test_both_directions_are_static_op_execute() -> None:
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# with a database
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _insert(engine: Engine, **overrides: object) -> None:
    params: dict[str, object] = {
        "repo": "qontinui/qontinui-web",
        "commit_sha": "a" * 40,
        "verdict": "landed",
        "method": "ancestor",
        "trunk": "main",
    }
    params.update(overrides)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} "
                "(repo, commit_sha, verdict, method, trunk) "
                "VALUES (:repo, :commit_sha, :verdict, :method, :trunk)"
            ),
            params,
        )


@_needs_pg
def test_table_shape_primary_key_and_checks() -> None:
    with ephemeral_database(admin_database_url(), "cmtland01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        assert set(got) == {c[0] for c in _COLUMNS}, set(got)
        for name, data_type, nullable, default in _COLUMNS:
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: {got_default}"
            else:
                assert got_default is not None and default in got_default

        assert (
            scalar(
                engine,
                f"""
                SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                  FROM pg_constraint c
                  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                 WHERE c.conrelid = 'coord.{_TABLE}'::regclass
                   AND c.contype = 'p'
                """,
            )
            == "repo,commit_sha"
        )

        _insert(engine)
        _insert(engine, commit_sha="b" * 40, verdict="abstain", method=None)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine)  # same (repo, commit_sha)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, commit_sha="c" * 40, verdict="maybe")
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, commit_sha="d" * 40, method="rebase")


@_needs_pg
def test_table_comment_lands_as_the_source_writes_it() -> None:
    with ephemeral_database(admin_database_url(), "cmtland01_cmt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        comment = scalar(engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)")
        assert comment == comment_body_from_source(
            _revision_source(), f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        assert "SOLE writer" in str(comment)
        assert "tenant-less" in str(comment)


@_needs_pg
def test_upgrade_is_idempotent_and_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "cmtland01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 1

        run_alembic(backend_root(), db_url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 0
