"""Behaviour test for the ``coord_fleet_focus_01`` revision.

Phase 1 of plan
``2026-11-16-fleet-focus-prioritize-a-tenant-or-subproject-and-postpone-everything-else``.
Creates ``coord.fleet_focus`` (one row per tenant) and
``coord.fleet_focus_targets`` (its targets). Without a database it pins the
chain wiring and statement shape; against a real Postgres (skipped when none is
reachable) it pins the one-row-per-tenant unique, the target vocabulary, the
per-focus target unique, the cascade on clear, and downgrade/re-upgrade.
"""

from __future__ import annotations

import re
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_fleet_focus_01"
_PARENT_REVISION_ID = "design_refs_01"
_REVISION_FILENAME = "coord_fleet_focus_01_create.py"

_UPGRADE_STATEMENTS: tuple[str, ...] = (
    "CREATE TABLE IF NOT EXISTS coord.fleet_focus (",
    "CREATE TABLE IF NOT EXISTS coord.fleet_focus_targets (",
    "COMMENT ON TABLE coord.fleet_focus IS",
    "COMMENT ON TABLE coord.fleet_focus_targets IS",
    "CREATE INDEX IF NOT EXISTS idx_fleet_focus_targets_tenant "
    "ON coord.fleet_focus_targets (",
)
_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    "DROP INDEX IF EXISTS coord.idx_fleet_focus_targets_tenant",
    "DROP TABLE IF EXISTS coord.fleet_focus_targets",
    "DROP TABLE IF EXISTS coord.fleet_focus",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable at the conftest URL (set QONTINUI_TEST_PG)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _collapsed(sql: str | None) -> str:
    assert sql is not None, "every op.execute takes ONE static string literal"
    return " ".join(sql.split())


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f.name
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, siblings
    assert re.search(
        rf"^Revision ID: {re.escape(_REVISION_ID)}$", _revision_source(), re.M
    )
    assert re.search(
        rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", _revision_source(), re.M
    )


def test_statements_are_static_coord_sql_in_one_transaction() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert len(calls) == len(_UPGRADE_STATEMENTS)
    for call, head in zip(calls, _UPGRADE_STATEMENTS, strict=True):
        sql = _collapsed(call.sql)
        assert sql.startswith(head), (head, sql)
        assert "CONCURRENTLY" not in sql.upper()
        assert "DROP" not in sql.upper()
        assert call.in_autocommit_block is False
    downgrade = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert tuple(_collapsed(c.sql) for c in downgrade) == _DOWNGRADE_STATEMENTS
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops and not scan.unresolved and not scan.violations


def test_no_end_time_or_history_columns() -> None:
    upgrade_body = _revision_source().split("def upgrade", 1)[1]
    for forbidden in ("expires_at", "ends_at", "ended_at", "cleared_at"):
        assert forbidden not in upgrade_body, forbidden


@pytest.fixture(scope="module")
def focus_db() -> Iterator[Engine]:
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_ff01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _focus(conn: Connection, tenant: str) -> str:
    return str(
        conn.execute(
            text(
                "INSERT INTO coord.fleet_focus (tenant_id, set_by) "
                "VALUES (:t, 'op') RETURNING id"
            ),
            {"t": tenant},
        ).scalar_one()
    )


def _target(
    conn: Connection, focus_id: str, kind: str, target: str, tenant: str
) -> None:
    conn.execute(
        text(
            "INSERT INTO coord.fleet_focus_targets "
            "(focus_id, target_kind, target_id, tenant_id) "
            "VALUES (:f, :k, :t, :tn)"
        ),
        {"f": focus_id, "k": kind, "t": target, "tn": tenant},
    )


def _constraint(excinfo: pytest.ExceptionInfo[IntegrityError]) -> str:
    diag = getattr(excinfo.value.orig, "diag", None)
    return str(getattr(diag, "constraint_name", ""))


@_needs_pg
def test_defaults_and_one_focus_per_tenant(focus_db: Engine) -> None:
    tenant = str(uuid.uuid4())
    with focus_db.begin() as conn:
        _focus(conn, tenant)
        row = conn.execute(
            text("SELECT revision, set_at FROM coord.fleet_focus WHERE tenant_id=:t"),
            {"t": tenant},
        ).one()
        assert row.revision == 1 and row.set_at is not None
    with pytest.raises(IntegrityError) as excinfo:
        with focus_db.begin() as conn:
            _focus(conn, tenant)
    assert _constraint(excinfo) == "uq_fleet_focus_tenant"
    with focus_db.begin() as conn:
        _focus(conn, str(uuid.uuid4()))  # another tenant is another key space


@_needs_pg
def test_target_kind_vocabulary_and_per_focus_unique(focus_db: Engine) -> None:
    tenant = str(uuid.uuid4())
    target = str(uuid.uuid4())
    with focus_db.begin() as conn:
        focus_id = _focus(conn, tenant)
        for kind in ("tenant", "subproject"):
            _target(conn, focus_id, kind, target, tenant)
    for kind, constraint in (
        ("project", "ck_fleet_focus_targets_kind"),
        ("subproject", "uq_fleet_focus_targets_focus_target"),
    ):
        with pytest.raises(IntegrityError) as excinfo:
            with focus_db.begin() as conn:
                _target(conn, focus_id, kind, target, tenant)
        assert _constraint(excinfo) == constraint


@_needs_pg
def test_dangling_target_refused_and_clear_cascades(focus_db: Engine) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        with focus_db.begin() as conn:
            _target(
                conn, str(uuid.uuid4()), "tenant", str(uuid.uuid4()), str(uuid.uuid4())
            )
    assert _constraint(excinfo) == "fk_fleet_focus_targets_focus"
    tenant = str(uuid.uuid4())
    with focus_db.begin() as conn:
        focus_id = _focus(conn, tenant)
        _target(conn, focus_id, "tenant", tenant, tenant)
        conn.execute(text("DELETE FROM coord.fleet_focus WHERE id=:f"), {"f": focus_id})
        left = conn.execute(
            text("SELECT count(*) FROM coord.fleet_focus_targets WHERE focus_id=:f"),
            {"f": focus_id},
        ).scalar_one()
        assert left == 0


@_needs_pg
def test_downgrade_removes_tables_and_re_upgrade_restores_them() -> None:
    root = backend_root()
    tables = ("fleet_focus", "fleet_focus_targets")
    with ephemeral_database(admin_database_url(), "coord_ff01d") as (engine, url):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in tables:
            assert table_exists(engine, "coord", table), table
        assert index_exists(engine, "idx_fleet_focus_targets_tenant")
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for table in tables:
            assert not table_exists(engine, "coord", table), table
        assert not index_exists(engine, "idx_fleet_focus_targets_tenant")
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in tables:
            assert table_exists(engine, "coord", table), table
