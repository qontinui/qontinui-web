"""Structural and round-trip test for alembic ``coord_ci_runner_scope_listings_01``.

Plan
``2026-11-09-ci-registration-presence-persisted-listing-stamp-and-slot-row-followups``
Phase 3.

``coord.ci_runner_scope_listings`` is the per-scope listing stamp coord's
registrar writes and its registration-presence classifier reads. Two CHECKs
carry the contract: ``ci_rsl_outcome_check`` keeps ``outcome`` to the two
values the classifier branches on, and ``ci_rsl_measured_check`` lets a
partial FIRST write insert with ``listed_at`` NULL while refusing a row that
records neither a complete nor a partial listing.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling, and the ``Revises:``
   header agrees.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, the column-drop guard reads the upgrade path as dropping
   nothing, and the table carries no ``tenant_id`` (fleet-wide by design).
3. Both directions are pure ``op.execute`` with static SQL.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability, defaults and the primary key.
5. Both CHECKs refuse what they exist to refuse and admit the two legal row
   shapes (a complete stamp, a partial first write).
6. The table and column comments land as the source writes them.
7. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
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
    column_comment,
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

_REVISION_ID = "coord_ci_runner_scope_listings_01"
_REVISION_FILENAME = "coord_ci_runner_scope_listings_01_create.py"

# Pinned as a literal, not read back from the module: the single head when the
# revision was written. A moved head re-points both together.
_PARENT_REVISION_ID = "fpl_02b"

_SCHEMA = "coord"
_TABLE = "ci_runner_scope_listings"
_QUALIFIED = f"{_SCHEMA}.{_TABLE}"
_OUTCOME_CHECK = "ci_rsl_outcome_check"
_MEASURED_CHECK = "ci_rsl_measured_check"

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("scope", "text", False, None),
    ("listed_at", "timestamp with time zone", True, None),
    ("outcome", "text", True, None),
    ("listed_runners", "integer", True, None),
    ("incomplete_since", "timestamp with time zone", True, None),
    ("updated_at", "timestamp with time zone", False, "now()"),
)

_COMMENTED = ("listed_at", "outcome", "incomplete_since", "updated_at")

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


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
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
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"sibling (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, DROP only in downgrade(), no tenant_id
# ---------------------------------------------------------------------------

_TABLE_OBJECT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
    r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                assert obj.startswith(_QUALIFIED), (
                    f"{fn_name}(): object {obj!r} is not {_QUALIFIED}"
                )


def test_the_only_drop_is_the_table_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(
        rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{re.escape(_QUALIFIED)}\b", down, re.I
    ), "downgrade() must drop the table IF EXISTS"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_the_table_is_fleet_wide_with_no_tenant_column() -> None:
    literals = _sql_literals(_function(_tree(), "upgrade"))
    up = "\n".join(literals)
    creates = [
        sql
        for sql in literals
        if re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{re.escape(_QUALIFIED)}\s*\(",
            sql,
        )
    ]
    assert len(creates) == 1, "upgrade() must CREATE TABLE IF NOT EXISTS the table once"
    # The table comment may name tenant_id to explain its absence; the column
    # list (the CREATE TABLE literal) must not.
    assert "tenant_id" not in creates[0], (
        "the listing stamp is fleet-wide by design (see the revision docstring)"
    )
    assert "tenant_id" in _revision_source(), (
        "the docstring must say why there is no tenant_id"
    )
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"
    assert not re.search(r"\bREFERENCES\b", up, re.I), "the stamp takes no FK"


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
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


# ---------------------------------------------------------------------------
# live database
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


def _insert(engine: Engine, **params: object) -> None:
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO {_QUALIFIED} ({cols}) VALUES ({binds})"), params
        )


def _assert_check_violation(engine: Engine, constraint: str, **params: object) -> None:
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, **params)
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == "23514", f"not a CHECK: {orig!r}"
    assert orig.diag.constraint_name == constraint  # type: ignore[union-attr]


def _row(engine: Engine, scope: str) -> tuple[object, ...] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"""
                SELECT listed_at IS NOT NULL, outcome, listed_runners,
                       incomplete_since IS NOT NULL, updated_at IS NOT NULL
                  FROM {_QUALIFIED}
                 WHERE scope = :scope
                """
            ),
            {"scope": scope},
        ).one_or_none()
    return None if row is None else tuple(row)


@_needs_pg
def test_table_shape_and_primary_key() -> None:
    with ephemeral_database(admin_database_url(), "crsl01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable, default in _COLUMNS:
            assert name in got, f"{_QUALIFIED} is missing {name}"
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: unexpected {got_default}"
            else:
                assert got_default is not None and default in got_default, (
                    f"{name}: default {got_default!r} lacks {default!r}"
                )
        assert set(got) == {c[0] for c in _COLUMNS}, f"unexpected {set(got)}"

        pk = scalar(
            engine,
            """
            SELECT string_agg(a.attname, ',')
              FROM pg_constraint c
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
             WHERE c.conrelid = 'coord.ci_runner_scope_listings'::regclass
               AND c.contype = 'p'
            """,
        )
        assert pk == "scope"


@_needs_pg
def test_both_checks_refuse_what_they_exist_to_refuse() -> None:
    with ephemeral_database(admin_database_url(), "crsl01_check") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # The two legal shapes: a complete stamp, and a partial FIRST write
        # (listed_at, outcome and listed_runners all NULL).
        _insert(
            engine,
            scope="qontinui/qontinui-coord",
            listed_at="2026-11-09T12:00:00Z",
            outcome="refreshed",
            listed_runners=3,
        )
        _insert(engine, scope="org:qontinui", incomplete_since="2026-11-09T12:00:00Z")
        _insert(
            engine,
            scope="qontinui/qontinui-web",
            listed_at="2026-11-09T12:00:00Z",
            outcome="refreshed_empty",
            listed_runners=0,
        )
        assert _row(engine, "qontinui/qontinui-coord") == (
            True,
            "refreshed",
            3,
            False,
            True,
        )
        assert _row(engine, "org:qontinui") == (False, None, None, True, True)
        assert _row(engine, "qontinui/qontinui-web") == (
            True,
            "refreshed_empty",
            0,
            False,
            True,
        )

        # ci_rsl_outcome_check: an outcome outside the two-value contract.
        _assert_check_violation(
            engine,
            _OUTCOME_CHECK,
            scope="qontinui/bad-outcome",
            listed_at="2026-11-09T12:00:00Z",
            outcome="page_failure",
            listed_runners=1,
        )
        # ci_rsl_measured_check: a row recording neither a complete nor a
        # partial listing.
        _assert_check_violation(engine, _MEASURED_CHECK, scope="qontinui/neither")
        assert _row(engine, "qontinui/bad-outcome") is None
        assert _row(engine, "qontinui/neither") is None

        # The primary key refuses a second row for one scope.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as dup:
            _insert(
                engine, scope="org:qontinui", incomplete_since="2026-11-09T13:00:00Z"
            )
        assert getattr(dup.value.orig, "pgcode", None) == "23505"


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "crsl01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('{_QUALIFIED}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, _QUALIFIED, object_kind="TABLE"
        )
        assert "ci_runner_registrar" in str(table_comment)
        for column in _COMMENTED:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_QUALIFIED}.{column}"
            ), f"comment on {_TABLE}.{column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "crsl01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, scope="org:qontinui", incomplete_since="2026-11-09T12:00:00Z")

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row(engine, "org:qontinui") == (False, None, None, True, True)


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "crsl01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, scope="org:qontinui", incomplete_since="2026-11-09T12:00:00Z")

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row(engine, "org:qontinui") is None
