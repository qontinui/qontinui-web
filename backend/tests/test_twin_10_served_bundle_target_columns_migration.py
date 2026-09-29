"""Structural and round-trip test for alembic ``twin_10_served_bundle_target_columns``.

Plan ``2026-09-17-twin-observer-genericity-non-release-consumers`` Phase 2 — the
expand step coord's served-bundle observer (Phase 3) reads.

Without a database (always runs):

1. Chain wiring: the parent is a real sibling and the ``Revises:`` header agrees.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are static ``op.execute`` SQL with no bind-parameter spelling.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Both columns land nullable with the declared types, the tenant FK is
   ``ON DELETE SET NULL``, and the partial index exists and is ``indisvalid``
   (a killed ``CONCURRENTLY`` build leaves an invalid one ``IF NOT EXISTS``
   would skip).
5. The seed fills only the bootstrap tenant's ``vercel``/``qontinui-web`` row —
   not another tenant's, not another bootstrap vercel target, not a non-vercel
   row named ``qontinui-web`` — and never overwrites an operator-set value.
6. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
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
_PARENT_REVISION_ID = "coord_dp_write_auth_daily_01"

_TARGETS = "coord.twin_targets"
_OBSERVATIONS = "coord.client_telemetry_observations"
_INDEX = "idx_client_telemetry_observations_tenant_id"
_SEED_URL = "https://qontinui.io/"
_BOOTSTRAP_SLUG = "personal-jspinak"

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
    """Every string constant (including f-string parts) inside ``fn``, minus its docstring."""
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
    r"(?:ALTER\s+TABLE|UPDATE|DROP\s+INDEX(?:\s+CONCURRENTLY)?|REFERENCES|FROM|\bON)"
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
    assert seen >= 8, "the object regex matched too little; it is not measuring"


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
    ``autocommit_block`` the CONCURRENTLY index needs; ``op.get_bind`` is the
    post-build ``indisvalid`` read in ``_require_valid``."""
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
        "get_bind",
    }
    for call in calls:
        if call.func.attr != "execute":  # type: ignore[attr-defined]
            continue
        assert len(call.args) == 1
        assert isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal "
            "(an f-string escapes the schema-arg gate)"
        )


def test_upgrade_bounds_its_lock_wait_and_checks_the_concurrent_build() -> None:
    tree = _tree()
    up = _sql_literals(_function(tree, "upgrade"))
    assert up and re.match(r"\s*SET\s+LOCAL\s+lock_timeout", up[0], re.I), (
        "the first statement of upgrade() must bound the ACCESS EXCLUSIVE wait"
    )
    body = ast.unparse(_function(tree, "upgrade"))
    assert "_require_valid(_INDEX)" in body, (
        "a killed CONCURRENTLY build leaves an INVALID index IF NOT EXISTS skips"
    )


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


def _bootstrap_tenant(engine: Engine) -> uuid.UUID | None:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT tenant_id FROM coord.tenants WHERE slug = :slug"),
            {"slug": _BOOTSTRAP_SLUG},
        ).fetchone()
    return row[0] if row else None


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
def test_seed_targets_only_the_bootstrap_row_and_never_overwrites() -> None:
    with ephemeral_database(admin_database_url(), "twin10_seed") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)

        bootstrap = _bootstrap_tenant(engine)
        other = uuid.uuid4()
        with engine.begin() as conn:
            if bootstrap is None:
                bootstrap = uuid.uuid4()
                conn.execute(
                    text(
                        "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                        "VALUES (:id, :slug, :slug)"
                    ),
                    {"id": bootstrap, "slug": _BOOTSTRAP_SLUG},
                )
            conn.execute(
                text(
                    "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                    "VALUES (:id, 'twin10-other', 'twin10-other')"
                ),
                {"id": other},
            )
            # The row the seed targets, plus three near-misses it must leave
            # NULL: another tenant's qontinui-web, another bootstrap vercel
            # target, and a non-vercel bootstrap row named qontinui-web (the
            # surface CHECK admits 'ecs'). Each near-miss fails a different
            # filter of the seed's WHERE.
            for tenant, surface, target in (
                (bootstrap, "vercel", "qontinui-web"),
                (other, "vercel", "qontinui-web"),
                (bootstrap, "vercel", "twin10-other-project"),
                (bootstrap, "ecs", "qontinui-web"),
            ):
                conn.execute(
                    text(
                        "INSERT INTO coord.twin_targets (tenant_id, surface, target) "
                        "VALUES (:t, :s, :g) "
                        "ON CONFLICT (tenant_id, surface, target) DO NOTHING"
                    ),
                    {"t": tenant, "s": surface, "g": target},
                )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        def url_for(
            tenant: uuid.UUID, surface: str = "vercel", target: str = "qontinui-web"
        ) -> object:
            return scalar(
                engine,
                "SELECT production_url FROM coord.twin_targets WHERE tenant_id = :t "
                "AND surface = :s AND target = :g",
                t=tenant,
                s=surface,
                g=target,
            )

        assert url_for(bootstrap) == _SEED_URL
        assert url_for(other) is None
        assert url_for(bootstrap, target="twin10-other-project") is None
        assert url_for(bootstrap, surface="ecs") is None
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.twin_targets WHERE production_url IS NOT NULL",
            )
            == 1
        ), "the seed must fill exactly one row"

        # An operator-set value survives a re-run of upgrade(): the seed only
        # fills a NULL, and every DDL statement is IF NOT EXISTS.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.twin_targets SET production_url = 'https://example.test/' "
                    "WHERE tenant_id = :t AND surface = 'vercel' AND target = 'qontinui-web'"
                ),
                {"t": bootstrap},
            )
        _rerun_upgrade(engine)
        assert url_for(bootstrap) == "https://example.test/"
        assert url_for(other) is None


def _rerun_upgrade(engine: Engine) -> None:
    """Execute the revision's ``upgrade()`` again against an already-upgraded DB."""
    module = load_revision_module(_revision_path(), f"_rerun_{_REVISION_ID}")
    # The migration context owns the transaction (as alembic's env.py does), so
    # the revision's autocommit_block() can commit it before the CONCURRENTLY
    # index build.
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx), ctx.begin_transaction():
            module.upgrade()


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "twin10_round") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "twin_targets", "production_url") is None
        assert column_info(engine, "client_telemetry_observations", "tenant_id") is None
        assert not index_exists(engine, _INDEX)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, "twin_targets", "production_url") is not None
        assert index_exists(engine, _INDEX)
