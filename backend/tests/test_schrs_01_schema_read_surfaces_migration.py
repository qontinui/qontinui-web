"""Structural and round-trip test for the ``schrs_01`` revision.

Phase 1b of plan ``2026-09-03-coord-column-drop-guard-on-web-migrations``
creates ``coord.schema_read_surfaces`` — the durable ``main`` half of the
coord column-drop guard, designed in the peer plan
``2026-09-06-devops-coord-column-drop-guard-has-no-served-manifest`` §5b.

What is asserted, and why each one can fail silently otherwise
==============================================================

Without a database (always runs, including on a box with no Postgres):

1. **Chain wiring.** ``revision`` and ``down_revision`` are what this test pins.
   A stale pin rewinds too far in the round-trip below and replays unrelated
   non-idempotent revisions as someone else's ``DuplicateTable``.
2. **Every ``op.*`` call carries ``schema="coord"``.** The pre-commit
   ``alembic-schema-arg-gate`` enforces this locally, but a ``--no-verify``
   commit skips it and nothing server-side re-runs it for
   ``backend/alembic/versions/`` (``forbid-public-schema`` excludes that
   directory wholesale). Asserted here so CI catches it.
3. **The only DROP lives inside ``downgrade()``.** The revision's central
   structural claim: ``scripts/ci/check_coord_column_drops.py`` scans the whole
   module MINUS the ``downgrade()`` body, so a hoisted drop (a helper, a
   module-level SQL string) would make this revision block on the very gate the
   table is served from. Asserted two ways — by walking the AST for
   ``op.drop_table`` / ``DROP`` tokens outside ``downgrade()``, and by running
   the guard's own scanner and asserting it reads the upgrade path as dropping
   nothing.
4. **The primary key is exactly ``(repo, branch)``** and the column set is
   exactly §5b's five columns, by name. The coord route that consumes this table
   is written from §5b's text, so a renamed column is an interface break that
   nothing else would catch until the route 500s in production.

With a database (skipped when none is reachable — see the warning below):

5. **The table lands with the declared types, nullability and default.**
   ``surfaces`` is ``jsonb`` (not ``json``: the reader needs ``jsonb_typeof``),
   ``pushed_at`` is ``timestamptz NOT NULL DEFAULT now()``.
6. **Latest-row-per-``(repo, branch)`` semantics actually hold.** A second
   INSERT for the same key fails on the PK, and an ``ON CONFLICT (repo, branch)
   DO UPDATE`` replaces the row rather than adding one — which is the ingest's
   whole contract.
7. **The CHECKs reject what the ingest must never store.** A short sha, an
   uppercase sha, an empty ``surfaces`` array, and a ``surfaces`` that is an
   object rather than an array are each refused.
8. **Up → down → up leaves no residue.** The table goes on downgrade and comes
   back on re-upgrade, and a row seeded in a NEIGHBOURING ``coord.*`` table is
   untouched by the walk.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials. Use that variable, **not** ``DATABASE_URL``:
``conftest.py`` overwrites ``os.environ["DATABASE_URL"]`` unconditionally at
import time from ``QONTINUI_TEST_PG``.
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
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

# Pinned explicitly rather than "head"; the first test enforces that it equals
# the revision's own `down_revision`.
_REVISION_ID = "schrs_01"
_PARENT_REVISION_ID = "fleet_res_tel_05_socket_census"
_REVISION_FILENAME = "schrs_01_coord_schema_read_surfaces.py"

_SCHEMA = "coord"
_TABLE = "schema_read_surfaces"

# §5b's column set, spelled as LITERALS rather than read from the revision, so
# a rename in the revision reddens this test instead of moving with it.
_PK_COLUMNS = ("repo", "branch")
_ALL_COLUMNS = ("repo", "branch", "sha", "surfaces", "pushed_at")

_GOOD_SHA = "0123456789abcdef0123456789abcdef01234567"
_GOOD_SURFACES = '[["repo_branches", "head_sha", "ci_routes.rs:230"]]'

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _module_tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _op_calls(node: ast.AST) -> list[ast.Call]:
    """Every ``op.<something>(...)`` call under ``node``."""
    calls: list[ast.Call] = []
    for sub in ast.walk(node):
        if (
            isinstance(sub, ast.Call)
            and isinstance(sub.func, ast.Attribute)
            and isinstance(sub.func.value, ast.Name)
            and sub.func.value.id == "op"
        ):
            calls.append(sub)
    return calls


def _kwarg(call: ast.Call, name: str) -> ast.expr | None:
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_as_pinned() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision's down_revision moved; update _PARENT_REVISION_ID so the "
        "round-trip below rewinds to the right place"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. every op.* carries schema="coord"
# ---------------------------------------------------------------------------


def test_every_op_call_names_the_coord_schema() -> None:
    tree = _module_tree()
    calls = _op_calls(tree)
    assert calls, "no op.* calls found — the revision does nothing"
    for call in calls:
        schema = _kwarg(call, "schema")
        assert isinstance(schema, ast.Constant) and schema.value == _SCHEMA, (
            f"op.{call.func.attr} at line {call.lineno} does not carry "  # type: ignore[attr-defined]
            f'schema="{_SCHEMA}" as a literal'
        )


def test_upgrade_creates_exactly_one_table_and_no_index() -> None:
    tree = _module_tree()
    upgrade_calls = [c.func.attr for c in _op_calls(_function(tree, "upgrade"))]  # type: ignore[attr-defined]
    assert upgrade_calls == ["create_table"], (
        "§5b names one table and no secondary index; the PK serves the only "
        f"query the reader makes. upgrade() now calls: {upgrade_calls}"
    )


# ---------------------------------------------------------------------------
# 3. the only DROP lives inside downgrade()
# ---------------------------------------------------------------------------


def test_the_only_drop_is_a_literal_op_drop_table_inside_downgrade() -> None:
    tree = _module_tree()
    downgrade = _function(tree, "downgrade")

    # Inside downgrade(): exactly one op call, and it is the direct drop.
    inner = _op_calls(downgrade)
    assert [c.func.attr for c in inner] == ["drop_table"], (  # type: ignore[attr-defined]
        "downgrade() must be a single literal op.drop_table call — no helper, "
        f"no loop over a template. Found: {[c.func.attr for c in inner]}"  # type: ignore[attr-defined]
    )
    (drop,) = inner
    first = drop.args[0]
    table_name = first.value if isinstance(first, ast.Constant) else None
    if table_name is None and isinstance(first, ast.Name):
        # `_TABLE` — resolve the module-level constant it names.
        table_name = getattr(_revision_module(), first.id, None)
    assert table_name == _TABLE

    # Outside downgrade(): no op.drop_* call and no DROP token in any string
    # constant. Docstrings are prose and are excluded the way the guard excludes
    # them; every other string is code the guard would scan.
    downgrade_span = range(downgrade.lineno, downgrade.end_lineno + 1)  # type: ignore[operator]
    docstring_nodes = {
        id(node.body[0].value)
        for node in [tree, *[n for n in tree.body if isinstance(n, ast.FunctionDef)]]
        if node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
        and isinstance(node.body[0].value.value, str)
    }
    for node in ast.walk(tree):
        if getattr(node, "lineno", None) in downgrade_span:
            continue
        if isinstance(node, ast.Call) and node in _op_calls(tree):
            assert not node.func.attr.startswith("drop"), (  # type: ignore[attr-defined]
                f"op.{node.func.attr} at line {node.lineno} is outside downgrade()"  # type: ignore[attr-defined]
            )
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in docstring_nodes
        ):
            # The guard's own SQL spellings (check_coord_column_drops.py:
            # `_DROP_TABLE`, `_DROP_COLUMN_CLAUSE`, `_ANY_DROP_COLUMN`, the
            # RENAME arms) — not a bare DROP, which the prose in a COMMENT is
            # free to use.
            assert not re.search(
                r"\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE|RENAME\s+(COLUMN|TO)|SET\s+SCHEMA)\b",
                node.value,
                re.I,
            ), (
                f"a DROP/RENAME SQL token outside downgrade() at line {node.lineno}: "
                "the column-drop guard would read it as an upgrade-path drop"
            )


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    """The revision's own structural claim, checked with the guard's own scanner."""
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, (
        "the guard now reads an upgrade-path coord drop in this revision: "
        f"{[(d.table, d.column) for d in scan.drops]}"
    )
    assert not scan.unresolved, (
        "the guard now reads an UNRESOLVED drop site here, which is a violation "
        f"on its own before any manifest is consulted: {scan.unresolved}"
    )
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 4. the interface: (repo, branch) PK and §5b's five columns, by name
# ---------------------------------------------------------------------------


def _create_table_call() -> ast.Call:
    tree = _module_tree()
    (call,) = [
        c
        for c in _op_calls(_function(tree, "upgrade"))
        if c.func.attr == "create_table"
    ]  # type: ignore[attr-defined]
    return call


def _constant_str(node: ast.expr, module) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        value = getattr(module, node.id, None)
        return value if isinstance(value, str) else None
    return None


def test_primary_key_is_repo_branch_and_columns_are_5b_verbatim() -> None:
    module = _revision_module()
    call = _create_table_call()
    assert _constant_str(call.args[0], module) == _TABLE

    columns: list[str] = []
    pk: tuple[str, ...] | None = None
    for arg in call.args[1:]:
        if not isinstance(arg, ast.Call) or not isinstance(arg.func, ast.Attribute):
            continue
        if arg.func.attr == "Column":
            name = _constant_str(arg.args[0], module)
            assert name is not None
            columns.append(name)
        elif arg.func.attr == "PrimaryKeyConstraint":
            assert pk is None, "two PrimaryKeyConstraint arguments"
            pk = tuple(
                _constant_str(a, module) or ""
                for a in arg.args
                if isinstance(a, ast.Constant)
            )
    assert tuple(columns) == _ALL_COLUMNS, (
        f"§5b's column set is {_ALL_COLUMNS}; found {columns}"
    )
    assert pk == _PK_COLUMNS, f"§5b's PK is {_PK_COLUMNS}; found {pk}"


# ---------------------------------------------------------------------------
# 5–8. against a real Postgres
# ---------------------------------------------------------------------------


def _insert(engine: Engine, *, repo: str, branch: str, sha: str, surfaces: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} (repo, branch, sha, surfaces) "
                "VALUES (:repo, :branch, :sha, CAST(:surfaces AS jsonb))"
            ),
            {"repo": repo, "branch": branch, "sha": sha, "surfaces": surfaces},
        )


def _row_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text(f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}")).scalar_one()
        )


@_needs_pg
def test_table_lands_with_the_declared_shape() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "schrs01_shape") as (engine, db_url):
        result = run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert result.returncode == 0, result.stderr
        assert table_exists(engine, _SCHEMA, _TABLE)
        with engine.connect() as conn:
            pk_cols = (
                conn.execute(
                    text(
                        """
                    SELECT a.attname
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                      JOIN pg_attribute a
                        ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
                     WHERE i.indisprimary AND n.nspname = :schema AND c.relname = :table
                     ORDER BY array_position(i.indkey, a.attnum)
                    """
                    ),
                    {"schema": _SCHEMA, "table": _TABLE},
                )
                .scalars()
                .all()
            )
        assert tuple(pk_cols) == _PK_COLUMNS

        for name, expected_type, nullable in (
            ("repo", "text", False),
            ("branch", "text", False),
            ("sha", "text", False),
            ("surfaces", "jsonb", False),
            ("pushed_at", "timestamp with time zone", False),
        ):
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{name} is missing"
            data_type, is_nullable, _default = info
            assert data_type == expected_type, (name, info)
            assert (is_nullable == "YES") is nullable, (name, info)
        pushed = column_info(engine, _TABLE, "pushed_at", schema=_SCHEMA)
        assert pushed is not None and "now()" in str(pushed[2])


@_needs_pg
def test_latest_row_per_repo_branch_semantics_hold() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "schrs01") as (engine, db_url):
        assert (
            run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID).returncode == 0
        )
        _insert(
            engine,
            repo="qontinui/qontinui-coord",
            branch="main",
            sha=_GOOD_SHA,
            surfaces=_GOOD_SURFACES,
        )
        # A second row for the same (repo, branch) is a PK violation...
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(
                engine,
                repo="qontinui/qontinui-coord",
                branch="main",
                sha="f" * 40,
                surfaces=_GOOD_SURFACES,
            )
        # ...and the ingest's UPSERT replaces it rather than adding one.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    INSERT INTO {_SCHEMA}.{_TABLE} (repo, branch, sha, surfaces)
                    VALUES (:repo, :branch, :sha, CAST(:surfaces AS jsonb))
                    ON CONFLICT (repo, branch) DO UPDATE
                       SET sha = EXCLUDED.sha,
                           surfaces = EXCLUDED.surfaces,
                           pushed_at = now()
                    """
                ),
                {
                    "repo": "qontinui/qontinui-coord",
                    "branch": "main",
                    "sha": "f" * 40,
                    "surfaces": _GOOD_SURFACES,
                },
            )
        assert _row_count(engine) == 1
        with engine.connect() as conn:
            sha = conn.execute(
                text(f"SELECT sha FROM {_SCHEMA}.{_TABLE} WHERE branch = 'main'")
            ).scalar_one()
        assert sha == "f" * 40


@_needs_pg
@pytest.mark.parametrize(
    ("sha", "surfaces"),
    [
        pytest.param("abc123", _GOOD_SURFACES, id="short-sha"),
        pytest.param(_GOOD_SHA.upper(), _GOOD_SURFACES, id="uppercase-sha"),
        pytest.param(_GOOD_SHA, "[]", id="empty-surfaces"),
        pytest.param(_GOOD_SHA, '{"table": "x"}', id="surfaces-not-an-array"),
    ],
)
def test_checks_reject_what_the_ingest_must_never_store(
    sha: str, surfaces: str
) -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "schrs01") as (engine, db_url):
        assert (
            run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID).returncode == 0
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(
                engine,
                repo="qontinui/qontinui-coord",
                branch="main",
                sha=sha,
                surfaces=surfaces,
            )
        assert _row_count(engine) == 0


@_needs_pg
def test_up_down_up_leaves_no_residue_and_spares_neighbours() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "schrs01") as (engine, db_url):
        assert (
            run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID).returncode == 0
        )
        # A neighbouring coord.* table the walk must not touch. page_spec_paths
        # is the DDL model this revision copied and predates it in the chain.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.page_spec_paths (repo, page_id, covered_path, head_sha)
                    VALUES ('qontinui-web', 'p', 'src/', :sha)
                    """
                ),
                {"sha": _GOOD_SHA},
            )

        down = run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert down.returncode == 0, down.stderr
        assert not table_exists(engine, _SCHEMA, _TABLE)

        up = run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert up.returncode == 0, up.stderr
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 0

        with engine.connect() as conn:
            neighbour = conn.execute(
                text("SELECT count(*) FROM coord.page_spec_paths")
            ).scalar_one()
        assert neighbour == 1
