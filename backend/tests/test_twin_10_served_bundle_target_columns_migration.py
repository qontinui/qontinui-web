"""Structural and round-trip test for alembic ``twin_10_served_bundle_target_columns``.

Plan ``2026-09-17-twin-observer-genericity-non-release-consumers`` Phase 2 — the
expand step coord's served-bundle observer (Phase 3) reads. The revision is
schema-only so coord's migration classifier can prove it additive; the
``production_url`` seed is a separate revision.

Without a database (always runs):

1. Chain wiring: the parent is a real sibling and the ``Revises:`` header agrees.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are static ``op.execute`` SQL with no bind-parameter
   spelling and no ``op.get_bind()``, the upgrade carries no data DML, and the
   FK is a separate ``ADD CONSTRAINT ... NOT VALID`` rather than an inline
   ``REFERENCES``. These mirror the rules of coord's migration classifier;
   they do not run it, so a classifier change will not show here.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Both columns land nullable with the declared types, the tenant FK is
   ``ON DELETE SET NULL``, and the partial index exists and is ``indisvalid``.
5. A run that died after committing the columns re-runs cleanly.
6. Up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "twin_10_served_bundle_target_columns"
_REVISION_FILENAME = "twin_10_served_bundle_target_columns.py"

# Pinned as a literal, not read back from the module: the head this revision
# was authored against. A moved head is re-pointed in the revision AND here.
_PARENT_REVISION_ID = "plan_library_09_scan_root_refusals"

_TARGETS = "coord.twin_targets"
_OBSERVATIONS = "coord.client_telemetry_observations"
_INDEX = "idx_client_telemetry_observations_tenant_id"
_FK = "fk_client_telemetry_observations_tenant_id"

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


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant (including f-string parts) inside ``fn``, minus its
    docstring, in source order (``ast.walk`` is breadth-first)."""
    doc = ast.get_docstring(fn, clean=False)
    nodes = [
        node
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]
    nodes.sort(key=lambda n: (n.lineno, n.col_offset))
    return [n.value for n in nodes]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
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
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------

# CREATE INDEX names an unqualified index (it lands in its table's schema); the
# table it indexes is caught by the ``ON`` arm.
_OBJECT_RE = re.compile(
    r"(?:ALTER\s+TABLE|DROP\s+INDEX(?:\s+CONCURRENTLY)?|REFERENCES|FROM|\bON)"
    r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    seen = 0
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _OBJECT_RE.findall(sql):
                if obj.upper() in {"DELETE"}:  # "ON DELETE SET NULL"
                    continue
                seen += 1
                assert obj.startswith("coord."), (
                    f"{fn_name}(): object {obj!r} is not coord-qualified"
                )
    assert seen >= 9, "the object regex matched too little; it is not measuring"


def test_the_only_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(
        rf"{_TARGETS}\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+production_url", down
    )
    assert re.search(
        rf"{_OBSERVATIONS}\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+tenant_id", down
    )


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_op_execute_only() -> None:
    """SQL goes through ``op.execute`` with a static literal only (the
    schema-arg gate audits only constant SQL). ``op.get_context`` opens the
    ``autocommit_block`` the CONCURRENTLY index needs. ``op.get_bind`` is
    absent: coord's migration classifier rejects SQL run through it."""
    calls = [
        node
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {  # type: ignore[attr-defined]
        "execute",
        "get_context",
    }
    for call in calls:
        if call.func.attr != "execute":  # type: ignore[attr-defined]
            continue
        assert len(call.args) == 1
        assert isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal "
            "(an f-string escapes the schema-arg gate)"
        )
    # No SQL through any other receiver (``op.get_bind().execute(...)``, a
    # connection): the classifier cannot inspect it and rejects the file.
    foreign = [
        node.lineno
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in {"execute", "exec_driver_sql", "scalar"}
        and not (isinstance(node.func.value, ast.Name) and node.func.value.id == "op")
    ]
    assert not foreign, f"SQL executed outside op.execute at lines {foreign}"


def test_upgrade_is_schema_only() -> None:
    """Data DML is refused by coord's classifier; the seed lives in twin_11."""
    for sql in _sql_literals(_function(_tree(), "upgrade")):
        assert not re.match(r"\s*(?:UPDATE|INSERT|DELETE|MERGE|COPY)\b", sql, re.I), (
            f"data DML in upgrade(): {sql.strip()[:80]!r}"
        )


def test_upgrade_bounds_its_lock_wait() -> None:
    up = _sql_literals(_function(_tree(), "upgrade"))
    assert up and re.match(r"\s*SET\s+LOCAL\s+lock_timeout", up[0], re.I), (
        "the first statement of upgrade() must bound the ACCESS EXCLUSIVE wait"
    )
    # The constraint runs in the fresh transaction after the autocommit block,
    # so it needs its own bound.
    fk_at = next(i for i, sql in enumerate(up) if "ADD CONSTRAINT" in sql)
    assert re.match(r"\s*SET\s+LOCAL\s+lock_timeout", up[fk_at - 1], re.I)


def test_fk_is_a_separate_not_valid_constraint_added_last() -> None:
    """coord's classifier rejects ``ADD COLUMN ... REFERENCES`` (a validated
    FK) and admits ``ADD CONSTRAINT`` only with ``NOT VALID`` as its last two
    tokens. Last, so it commits only with the version stamp."""
    up = _sql_literals(_function(_tree(), "upgrade"))
    for sql in up:
        if re.search(r"ADD\s+COLUMN", sql, re.I):
            assert "REFERENCES" not in sql.upper(), sql
    fk = [sql for sql in up if "ADD CONSTRAINT" in sql.upper()]
    assert len(fk) == 1
    words = fk[0].split()
    assert words[-2:] == ["NOT", "VALID"]
    assert _FK in fk[0]
    assert re.search(r"ON\s+DELETE\s+SET\s+NULL", fk[0])
    ddl = [sql for sql in up if not re.match(r"\s*SET\s", sql, re.I)]
    assert ddl[-1] is fk[0], "the FK must be the last DDL statement of upgrade()"


def test_both_directions_end_by_restoring_the_lock_bound() -> None:
    """env.py runs every pending revision in one transaction; the 3s bound
    must not leak into the next one."""
    for fn_name in ("upgrade", "downgrade"):
        sql = _sql_literals(_function(_tree(), fn_name))
        assert re.fullmatch(
            r"\s*SET\s+LOCAL\s+lock_timeout\s*=\s*DEFAULT\s*", sql[-1], re.I
        ), f"{fn_name}() must end with SET LOCAL lock_timeout = DEFAULT"


def test_downgrade_is_one_bounded_transaction() -> None:
    """An autocommit block would commit part of the downgrade on its own and
    could strand the database at twin_10 without its FK or index. coord's
    classifier skips downgrade(), so only this test guards it."""
    fn = _function(_tree(), "downgrade")
    body = ast.unparse(fn)
    assert "get_context" not in body and "autocommit_block" not in body
    sql = _sql_literals(fn)
    assert not any("CONCURRENTLY" in s.upper() for s in sql)
    assert re.match(r"\s*SET\s+LOCAL\s+lock_timeout\s*=\s*'3s'", sql[0], re.I)


def test_no_sql_body_carries_a_bind_parameter_spelling() -> None:
    """``op.execute`` wraps a string in ``text()``, which reads ``:word`` as a
    bind parameter — ``https://`` is safe (``:`` followed by ``/``)."""
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            hits = re.findall(r"(?<![:\w]):[A-Za-z_]\w*", sql)
            assert not hits, f"{fn_name}(): bind-parameter spelling {hits} in SQL"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _index_is_valid(engine: Engine, index_name: str) -> bool:
    """``indisvalid`` — a half-built CONCURRENTLY index exists but cannot serve."""
    return bool(
        scalar(
            engine,
            "SELECT i.indisvalid FROM pg_index i "
            "JOIN pg_class c ON c.oid = i.indexrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'coord' AND c.relname = :n",
            n=index_name,
        )
    )


def _fk_delete_action(engine: Engine) -> object:
    return scalar(
        engine,
        f"""
        SELECT c.confdeltype
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.conrelid = '{_OBSERVATIONS}'::regclass
           AND c.contype = 'f'
           AND a.attname = 'tenant_id'
        """,
    )


@_needs_pg
def test_columns_fk_and_partial_index() -> None:
    with ephemeral_database(admin_database_url(), "twin10_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert column_info(engine, "twin_targets", "production_url") == (
            "text",
            "YES",
            None,
        )
        assert column_info(engine, "client_telemetry_observations", "tenant_id") == (
            "uuid",
            "YES",
            None,
        )
        assert _fk_delete_action(engine) == "n"  # SET NULL
        assert (
            scalar(
                engine,
                "SELECT confrelid = 'coord.tenants'::regclass "
                "FROM pg_constraint WHERE conname = :n",
                n=_FK,
            )
            is True
        )
        assert index_exists(engine, _INDEX)
        assert _index_is_valid(engine, _INDEX), "a half-built CONCURRENTLY index"
        indexdef = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = :idx",
            idx=_INDEX,
        )
        assert isinstance(indexdef, str) and "WHERE (tenant_id IS NOT NULL)" in indexdef


@_needs_pg
def test_a_run_that_died_after_the_columns_committed_reruns_cleanly() -> None:
    """The columns commit before the index build; if the build (or the FK)
    then fails, the version is not stamped and alembic re-runs upgrade(). The
    re-run must not trip over what the first attempt left behind."""
    with ephemeral_database(admin_database_url(), "twin10_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE coord.twin_targets "
                    "ADD COLUMN IF NOT EXISTS production_url TEXT"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE coord.client_telemetry_observations "
                    "ADD COLUMN IF NOT EXISTS tenant_id UUID"
                )
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _fk_delete_action(engine) == "n"
        assert index_exists(engine, _INDEX)
        assert _index_is_valid(engine, _INDEX)


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "twin10_round") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "twin_targets", "production_url") is None
        assert column_info(engine, "client_telemetry_observations", "tenant_id") is None
        assert not index_exists(engine, _INDEX)
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM pg_constraint WHERE conname = :n",
                n=_FK,
            )
            == 0
        )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, "twin_targets", "production_url") is not None
        assert index_exists(engine, _INDEX)
        assert _index_is_valid(engine, _INDEX)
        assert _fk_delete_action(engine) == "n"
