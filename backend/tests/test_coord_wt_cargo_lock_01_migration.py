"""Structural and round-trip test for alembic ``coord_wt_cargo_lock_01``.

Phase 2 (web half) of plan
``2026-09-19-build-slots-are-not-build-parallelism-cargo-target-lock-and-devops-allocation-stats``.

``coord.worktree_cargo_lock`` is the device-level sibling of
``coord.worktree_volume`` that coord's census ingest writes one row per shared
cargo target dir into. coord and the runner are built against its column
contract in parallel, so the exact names, types, nullability and the
``holder_kind`` CHECK are pinned here.

Without a database (always runs):

1. Chain wiring: the parent is a real sibling and the ``Revises:`` header agrees.
2. Every statement is ``coord.``-qualified raw SQL and the only DROPs are in
   ``downgrade()`` (checked with ``check_coord_column_drops``'s own scanner).
3. The table is built in the transaction and the index CONCURRENTLY inside
   ``autocommit_block()``, with no ``op.get_bind()`` read — the shape coord's
   migration classifier (the auto-land gate) admits.

Against a real Postgres (skipped when none is reachable; a skip proves nothing):

4. Column types, nullability, defaults, and the index definition.
5. The CHECK admits the three holder kinds and NULL (an idle target) and
   refuses anything else; ``waiters`` defaults to 0.
6. Downgrade removes table and index; a re-upgrade restores them.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_wt_cargo_lock_01"
_REVISION_FILENAME = "coord_wt_cargo_lock_01_create.py"

# Pinned as a literal, not read back from the module: the head this revision
# was authored against. A moved head is re-pointed in the revision AND here.
_PARENT_REVISION_ID = "census_idx_01_device_repo_path_observed"

_SCHEMA = "coord"
_TABLE = "worktree_cargo_lock"
_QUALIFIED = f"{_SCHEMA}.{_TABLE}"
_INDEX = "idx_worktree_cargo_lock_device_observed_at"
_CHECK = "ck_worktree_cargo_lock_holder_kind"

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, "nextval"),
    ("device_id", "uuid", False, None),
    ("tenant_id", "uuid", True, None),
    ("target_key", "text", False, None),
    ("holder_pid", "integer", True, None),
    ("holder_kind", "text", True, None),
    ("holder_age_secs", "bigint", True, None),
    ("holder_cmd", "text", True, None),
    ("waiters", "integer", False, "0"),
    ("oldest_wait_secs", "bigint", True, None),
    ("observed_at", "timestamp with time zone", False, "now()"),
)

_DEVICE = uuid.UUID("00000000-0000-4000-8000-00000000c001")

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


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source())
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
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_statement_is_coord_qualified_and_drops_live_in_downgrade() -> None:
    upgrade_sql = _sql_literals(_function("upgrade"))
    downgrade_sql = _sql_literals(_function("downgrade"))
    assert len(upgrade_sql) == 3 and len(downgrade_sql) == 2
    for sql in upgrade_sql:
        assert _QUALIFIED in sql, sql
        assert "DROP" not in sql.upper(), sql
    for sql in downgrade_sql:
        assert sql.startswith("DROP ") and " coord." in sql, sql
    # Index before table, the reverse of upgrade().
    assert "DROP INDEX" in downgrade_sql[0] and "DROP TABLE" in downgrade_sql[1]

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_table_in_transaction_index_concurrently_and_no_bind_reads() -> None:
    fn = _function("upgrade")
    top_level_sql = [
        node.value
        for stmt in fn.body
        if not isinstance(stmt, ast.With)
        for node in ast.walk(stmt)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert any(f"CREATE TABLE IF NOT EXISTS {_QUALIFIED} (" in s for s in top_level_sql)
    assert not any("CREATE INDEX" in s.upper() for s in top_level_sql), (
        "coord's migration classifier rejects a non-concurrent CREATE INDEX"
    )
    withs = [s for s in fn.body if isinstance(s, ast.With)]
    assert len(withs) == 1
    call = withs[0].items[0].context_expr
    assert isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
    assert call.func.attr == "autocommit_block"
    in_block = [
        node.value
        for node in ast.walk(withs[0])
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert len(in_block) == 1
    assert f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX}" in in_block[0]

    attrs = {
        n.attr
        for n in ast.walk(ast.parse(_revision_source()))
        if isinstance(n, ast.Attribute)
    }
    assert "get_bind" not in attrs


def test_no_sql_body_carries_a_bind_parameter_spelling() -> None:
    """``op.execute`` wraps a string in ``text()``, which reads ``:word`` as a
    bind parameter and fails the upgrade for want of a value."""
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(fn_name)):
            hits = re.findall(r"(?<![:\w]):[A-Za-z_]\w*", sql)
            assert not hits, f"{fn_name}(): bind-parameter spelling {hits} in SQL"


# ---------------------------------------------------------------------------
# 4-6. real Postgres
# ---------------------------------------------------------------------------


def _insert(engine: Engine, **cols: object) -> None:
    row: dict[str, object] = {
        "device_id": _DEVICE,
        "target_key": "qontinui-coord/target/debug",
    }
    row.update(cols)
    names = ", ".join(row)
    binds = ", ".join(f":{k}" for k in row)
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO {_QUALIFIED} ({names}) VALUES ({binds})"), row)


@_needs_pg
def test_table_shape_check_and_round_trip() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_wtcl01") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        # Claim 4: shape.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name, data_type, nullable, default in _COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{name} is missing"
            got_type, is_nullable, got_default = info
            assert got_type == data_type, (name, info)
            assert (is_nullable == "YES") is nullable, (name, info)
            if default is None:
                assert got_default is None, (name, info)
            else:
                assert got_default is not None and default in got_default, (name, info)
                if name == "waiters":
                    # Exact, not substring: a default of '10' must not pass.
                    assert got_default.strip() == "0", (name, info)
        n_cols = scalar(
            engine,
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema = :s AND table_name = :t",
            s=_SCHEMA,
            t=_TABLE,
        )
        assert n_cols == len(_COLUMNS)
        assert index_exists(engine, _INDEX)
        index_def = str(
            scalar(
                engine,
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
                "AND indexname = :i",
                i=_INDEX,
            )
        )
        assert "(device_id, observed_at DESC)" in index_def, index_def
        assert scalar(
            engine, f"SELECT obj_description('{_QUALIFIED}'::regclass)"
        ) == comment_body_from_source(
            _revision_source(), _QUALIFIED, object_kind="TABLE"
        )

        # Claim 5: an idle target (holder NULL) and the three kinds are admitted.
        _insert(engine)
        for kind in ("build", "sweep", "unknown"):
            _insert(
                engine,
                holder_pid=4242,
                holder_kind=kind,
                holder_age_secs=325,
                holder_cmd="cargo check --all-targets",
                waiters=17,
                oldest_wait_secs=300,
            )
        assert scalar(engine, f"SELECT count(*) FROM {_QUALIFIED}") == 4
        assert (
            scalar(
                engine, f"SELECT waiters FROM {_QUALIFIED} WHERE holder_kind IS NULL"
            )
            == 0
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            _insert(engine, holder_kind="test")
        orig = excinfo.value.orig
        assert getattr(orig, "pgcode", None) == "23514", f"not a CHECK: {orig!r}"
        assert orig.diag.constraint_name == _CHECK  # type: ignore[union-attr]

        # Claim 6: downgrade removes both; re-upgrade restores both.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _INDEX)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX)
