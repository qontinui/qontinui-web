"""Structural and round-trip test for alembic ``coord_pr_holds_02_safety_loosening``.

Plan ``2026-10-28-one-session-lifecycle-authority`` Phase 142 step (0): the
``coord.pr_holds`` kind CHECK admits ``safety_loosening``.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Both directions are static ``op.execute`` on ``coord.pr_holds`` only, the
   upgrade drops nothing but the CHECK it recreates, and the column-drop guard
   reads it as dropping no column.
3. The kind set the upgrade writes is the five kinds of ``coord_pr_holds_01``
   plus ``safety_loosening``, and the downgrade restores exactly those five.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``:

4. After upgrade every one of the six kinds is storable and an unknown kind is
   still refused by ``pr_holds_kind_check``; before it, ``safety_loosening`` is
   refused.
5. The downgrade refuses while a ``safety_loosening`` row exists (released or
   not) and leaves the six-kind CHECK in place; with none it restores the
   five-kind CHECK, and up again re-admits the kind. The upgrade is idempotent.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from datetime import UTC, datetime
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
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_pr_holds_02_safety_loosening"
_REVISION_FILENAME = "coord_pr_holds_02_safety_loosening.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "overview_07_schedule_last_known"

_OLD_KINDS = ("manual", "security_tier", "migration_order", "create", "coord_proposal")
_NEW_KIND = "safety_loosening"
_NEW_KINDS = (*_OLD_KINDS, _NEW_KIND)

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


def _check_kinds(sql: str) -> tuple[str, ...]:
    match = re.search(r"CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)", sql, re.I)
    assert match, f"no kind CHECK in {sql!r}"
    return tuple(re.findall(r"'([^']+)'", match.group(1)))


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
# 2. static op.execute on coord.pr_holds only
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


def test_every_ddl_object_is_coord_pr_holds() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:ALTER\s+TABLE|COMMENT\s+ON\s+COLUMN|FROM)\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert re.fullmatch(r"coord\.pr_holds(\.\w+)?", obj), (
                    f"{fn_name}(): object {obj!r} is not coord.pr_holds"
                )


def test_upgrade_drops_only_the_constraint_it_recreates() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    drops = re.findall(r"\bDROP\b[^\n]*", up, re.I)
    assert drops == ["DROP CONSTRAINT IF EXISTS pr_holds_kind_check"], drops
    assert re.search(r"ADD\s+CONSTRAINT\s+pr_holds_kind_check\b", up)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. the kind sets
# ---------------------------------------------------------------------------


def test_upgrade_writes_the_six_kinds_and_downgrade_restores_the_five() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert _check_kinds(up) == _NEW_KINDS
    assert _check_kinds(down) == _OLD_KINDS


def test_the_old_kind_set_is_the_one_coord_pr_holds_01_created() -> None:
    source = (
        backend_root() / "alembic" / "versions" / "coord_pr_holds_01_create.py"
    ).read_text(encoding="utf-8")
    assert _check_kinds(source) == _OLD_KINDS


def test_downgrade_guards_before_it_narrows() -> None:
    literals = _sql_literals(_function(_tree(), "downgrade"))
    guard_at = next(i for i, s in enumerate(literals) if "RAISE EXCEPTION" in s)
    narrow_at = next(i for i, s in enumerate(literals) if "ADD CONSTRAINT" in s)
    assert guard_at < narrow_at
    assert f"kind = '{_NEW_KIND}'" in literals[guard_at]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000c0de2")
_REPO = "qontinui/prh02-test-repo"


def _insert(engine: Engine, **overrides: object) -> None:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "repo": _REPO,
        "head_branch": "agent/prh02",
        "kind": _NEW_KIND,
        "reason": "landing would loosen a served safety condition",
        "held_by": "agent:test",
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.pr_holds ({cols}) VALUES ({binds})"), params
        )


def _assert_kind_refused(engine: Engine, kind: str, branch: str) -> None:
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, kind=kind, head_branch=branch)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None, f"driver error carries no diag: {excinfo.value.orig!r}"
    assert diag.constraint_name == "pr_holds_kind_check"


def _constraint_def(engine: Engine) -> str:
    value = scalar(
        engine,
        """
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname = 'pr_holds_kind_check'
           AND conrelid = 'coord.pr_holds'::regclass
        """,
    )
    assert isinstance(value, str)
    return value


@_needs_pg
def test_upgrade_admits_safety_loosening_and_still_refuses_unknown_kinds() -> None:
    with ephemeral_database(admin_database_url(), "prh02_up") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_kind_refused(engine, _NEW_KIND, "before")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for kind in _NEW_KINDS:
            _insert(engine, kind=kind)
        _assert_kind_refused(engine, "draft", "unknown")
        assert _NEW_KIND in _constraint_def(engine)


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "prh02_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _NEW_KIND in _constraint_def(engine)


@_needs_pg
@pytest.mark.parametrize("released", [False, True], ids=["live", "released"])
def test_downgrade_refuses_while_a_safety_loosening_row_exists(released: bool) -> None:
    with ephemeral_database(admin_database_url(), "prh02_refuse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        # A RELEASED row counts too: it is still the audit record of a hold
        # placed under the license.
        if released:
            _insert(engine, released_at=datetime.now(UTC), released_by="operator")
        else:
            _insert(engine)

        proc = run_alembic(
            backend_root(),
            db_url,
            "downgrade",
            _PARENT_REVISION_ID,
            expect_success=False,
        )
        assert "cannot downgrade coord_pr_holds_02_safety_loosening" in (
            proc.stdout + proc.stderr
        )
        assert _NEW_KIND in _constraint_def(engine), "the refusal must narrow nothing"
        version = scalar(engine, "SELECT version_num FROM alembic_version")
        assert version == _REVISION_ID


@_needs_pg
def test_down_restores_the_five_kinds_and_up_readmits() -> None:
    with ephemeral_database(admin_database_url(), "prh02_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, kind="manual", head_branch="kept")

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _NEW_KIND not in _constraint_def(engine)
        _assert_kind_refused(engine, _NEW_KIND, "after-down")
        _insert(engine, kind="coord_proposal", head_branch="old-kind")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, head_branch="after-up")
        count = scalar(
            engine,
            "SELECT count(*) FROM coord.pr_holds WHERE repo = :repo",
            repo=_REPO,
        )
        assert count == 3
