"""Structural and round-trip test for alembic ``coord_pr_holds_01``.

Plan ``2026-10-04-coord-pr-hold-without-github-drafts`` Phase 1.

``coord.pr_holds`` is the contract coord's ``pr_hold.rs`` (Phase 2) codes
against: ``place_hold`` relies on the partial unique index for an idempotent
re-place, and the train probes live holds by ``(repo, pr_number)``.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types and nullability, the partial unique index (one live hold per
   kind per branch, released history unconstrained), each CHECK rejecting what
   it names, and the two indexes being partial on ``released_at IS NULL``.
5. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy
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
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_pr_holds_01"
_REVISION_FILENAME = "coord_pr_holds_01_create.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "coord_ci_pool_observations_01"

_SCHEMA = "coord"
_TABLE = "pr_holds"
_INDEXES = ("uq_pr_holds_live_branch_kind", "idx_pr_holds_live_repo_pr")

# (name, information_schema data_type, nullable)
_COLUMNS: tuple[tuple[str, str, bool], ...] = (
    ("id", "uuid", False),
    ("tenant_id", "uuid", False),
    ("repo", "text", False),
    ("head_branch", "text", False),
    ("pr_number", "integer", True),
    ("kind", "text", False),
    ("reason", "text", False),
    ("held_by", "text", False),
    ("gate_id", "uuid", True),
    ("created_at", "timestamp with time zone", False),
    ("released_at", "timestamp with time zone", True),
    ("released_by", "text", True),
    ("release_note", "text", True),
)

_KINDS = ("manual", "security_tier", "migration_order", "create", "coord_proposal")

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
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN|INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON)"
                r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert re.fullmatch(rf"{_SCHEMA}\.{_TABLE}(\.\w+)?", obj), (
                    f"{fn_name}(): object {obj!r} is not coord.{_TABLE}"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
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
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def test_upgrade_ddl_is_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}", up)
    for index in _INDEXES:
        assert re.search(rf"INDEX\s+IF\s+NOT\s+EXISTS\s+{index}\b", up), index
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000c0de1")
_REPO = "qontinui/prh01-test-repo"


def _insert(engine: Engine, **overrides: object) -> None:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "repo": _REPO,
        "head_branch": "agent/prh01",
        "kind": "manual",
        "reason": "waiting on the schema half",
        "held_by": "agent:test",
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds})"), params
        )


def _assert_rejected_by(engine: Engine, constraint: str, **overrides: object) -> None:
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, **overrides)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None, f"driver error carries no diag: {excinfo.value.orig!r}"
    assert diag.constraint_name == constraint, (
        f"{overrides}: rejected by {diag.constraint_name!r}, expected {constraint!r}"
    )


def _row_count(engine: Engine) -> int:
    value = scalar(
        engine, f"SELECT count(*) FROM coord.{_TABLE} WHERE repo = :repo", repo=_REPO
    )
    assert isinstance(value, int)
    return value


@_needs_pg
def test_table_shape_and_indexes() -> None:
    with ephemeral_database(admin_database_url(), "prh01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT column_name, data_type, is_nullable
                      FROM information_schema.columns
                     WHERE table_schema = :schema AND table_name = :table
                    """
                ),
                {"schema": _SCHEMA, "table": _TABLE},
            ).all()
            got = {r[0]: (r[1], r[2] == "YES") for r in rows}
            indexes = dict(
                conn.execute(
                    text(
                        """
                        SELECT indexname, indexdef FROM pg_indexes
                         WHERE schemaname = :schema AND tablename = :table
                        """
                    ),
                    {"schema": _SCHEMA, "table": _TABLE},
                ).all()
            )
        assert got == {name: (t, n) for name, t, n in _COLUMNS}

        unique = indexes["uq_pr_holds_live_branch_kind"]
        assert "UNIQUE" in unique
        assert "(tenant_id, repo, head_branch, kind)" in unique
        assert "WHERE (released_at IS NULL)" in unique
        live = indexes["idx_pr_holds_live_repo_pr"]
        assert "UNIQUE" not in live
        assert "(repo, pr_number)" in live
        assert "WHERE (released_at IS NULL)" in live


@_needs_pg
def test_live_uniqueness_and_checks() -> None:
    with ephemeral_database(admin_database_url(), "prh01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # Every kind is storable, one live hold each on the same branch.
        for kind in _KINDS:
            _insert(engine, kind=kind)
        # A second live hold of the same kind on the same branch is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            _insert(engine)
        assert getattr(excinfo.value.orig, "pgcode", None) == "23505"
        assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
            "uq_pr_holds_live_branch_kind"
        )
        # Released holds do not count: release, then place again, then keep a
        # second released row of the same key.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    UPDATE coord.{_TABLE}
                       SET released_at = now(), released_by = 'agent:test'
                     WHERE repo = :repo AND kind = 'manual'
                    """
                ),
                {"repo": _REPO},
            )
        _insert(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.{_TABLE}
                        (tenant_id, repo, head_branch, kind, reason, held_by,
                         released_at, released_by, release_note)
                    VALUES (:tenant, :repo, 'agent/prh01', 'manual', 'r', 'a',
                            now(), 'coord', 'create_failed')
                    """
                ),
                {"tenant": _TENANT, "repo": _REPO},
            )
        # The same key under another tenant is a different hold.
        _insert(engine, tenant_id=uuid.uuid4())
        assert _row_count(engine) == len(_KINDS) + 3

        for expected, bad in (
            ("pr_holds_kind_check", {"head_branch": "k", "kind": "draft"}),
            ("pr_holds_reason_nonblank_check", {"head_branch": "r", "reason": "  "}),
            ("pr_holds_held_by_nonblank_check", {"head_branch": "h", "held_by": ""}),
            (
                "pr_holds_released_coherent_check",
                {"head_branch": "c", "released_by": "operator"},
            ),
        ):
            _assert_rejected_by(engine, expected, **bad)

        for column in ("tenant_id", "repo", "head_branch", "kind", "reason", "held_by"):
            with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
                _insert(engine, **{"head_branch": f"nn-{column}", column: None})
            orig = excinfo.value.orig
            assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
            assert orig.diag.column_name == column  # type: ignore[union-attr]


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "prh01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "prh01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 0, "the table comes back empty, not restored"
