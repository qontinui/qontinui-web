"""Structural and round-trip test for alembic ``coordprio_01_queued_at_priority_tier``.

Plan ``2026-09-28-coord-priority-end-to-end-lane-ci-dispatch-and-observability``
Phase 1 + Phase 3 (web DDL half): ``coord.ci_job_observations.queued_at`` and
``coord.ci_dispatches.priority_tier`` / ``priority_reason``.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Coord's merge classifier shape: the upgrade path drops nothing (the coord
   column-drop guard agrees), every statement is a static ``op.execute`` on one
   of the two tables or a ``SET LOCAL lock_timeout``, and no ``DO`` block or
   ``RESET`` appears.
3. The columns are nullable with the declared types and no default, each is
   commented, and the downgrade removes exactly what the upgrade added.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. All three columns land nullable with no default, commented; pre-existing rows
   read NULL.
5. ``upgrade()`` is idempotent; up, down, down, up leaves no residue and keeps
   the rows.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coordprio_01_queued_at_priority_tier"
_REVISION_FILENAME = "coordprio_01_queued_at_priority_tier.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# three places: this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "cinode_03_dispatch_pr_head_base_sha"

# (table, column) -> information_schema data_type
_COLUMNS: dict[tuple[str, str], str] = {
    ("ci_job_observations", "queued_at"): "timestamp with time zone",
    ("ci_dispatches", "priority_tier"): "smallint",
    ("ci_dispatches", "priority_reason"): "text",
}
_TABLES = {"ci_job_observations", "ci_dispatches"}

_SHA = "0123456789abcdef0123456789abcdef01234567"

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


def _function(name: str) -> ast.FunctionDef:
    for node in _tree().body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _normalized(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def _sql(name: str) -> list[str]:
    """Every ``op.execute`` SQL literal inside ``name()`` in source order."""
    calls = sorted(
        (
            node
            for node in ast.walk(_function(name))
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "op"
            and node.func.attr == "execute"
        ),
        key=lambda c: (c.lineno, c.col_offset),
    )
    out = []
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        out.append(_normalized(arg.value))
    return out


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
# 2. additive, static, classifier-shaped
# ---------------------------------------------------------------------------


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_every_op_call_is_a_static_execute_on_our_tables_or_a_timeout() -> None:
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
    for sql in _sql("upgrade") + _sql("downgrade"):
        touches_ours = any(f"coord.{t}" in sql for t in _TABLES)
        assert touches_ours or sql.startswith("SET LOCAL lock_timeout"), sql


def test_upgrade_avoids_every_form_the_classifier_rejects() -> None:
    upgrade = _sql("upgrade")
    for sql in upgrade:
        upper = sql.upper()
        assert "$$" not in sql and not upper.startswith("DO"), sql
        assert not upper.startswith("RESET"), sql
        assert not upper.startswith("DROP") and " DROP " not in f" {upper} ", sql
        assert "DEFAULT" not in upper or upper == "SET LOCAL LOCK_TIMEOUT = DEFAULT", (
            f"no column default is allowed: {sql}"
        )
    assert upgrade[0] == "SET LOCAL lock_timeout = '3s'"
    assert "SET LOCAL lock_timeout = DEFAULT" in upgrade


# ---------------------------------------------------------------------------
# 3. declared shape
# ---------------------------------------------------------------------------


def test_upgrade_adds_the_three_nullable_columns() -> None:
    adds = [s for s in _sql("upgrade") if "ADD COLUMN" in s.upper()]
    assert adds == [
        "ALTER TABLE coord.ci_job_observations "
        "ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ NULL",
        "ALTER TABLE coord.ci_dispatches "
        "ADD COLUMN IF NOT EXISTS priority_tier SMALLINT NULL, "
        "ADD COLUMN IF NOT EXISTS priority_reason TEXT NULL",
    ]


def test_every_column_is_commented() -> None:
    comments = [s for s in _sql("upgrade") if s.upper().startswith("COMMENT ON")]
    assert [c.split(" IS ")[0] for c in comments] == [
        f"COMMENT ON COLUMN coord.{table}.{column}" for table, column in _COLUMNS
    ]


def test_downgrade_removes_exactly_what_upgrade_added() -> None:
    assert _sql("downgrade") == [
        "SET LOCAL lock_timeout = '3s'",
        "ALTER TABLE coord.ci_dispatches "
        "DROP COLUMN IF EXISTS priority_reason, "
        "DROP COLUMN IF EXISTS priority_tier",
        "ALTER TABLE coord.ci_job_observations DROP COLUMN IF EXISTS queued_at",
        "SET LOCAL lock_timeout = DEFAULT",
    ]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _insert_observation(engine: Engine) -> int:
    job_id = int(uuid4().int % 2_000_000_000)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.ci_job_observations "
                "(repo, job_id, run_id, workflow_name, job_name, self_hosted, outcome) "
                "VALUES ('qontinui/qontinui-coord', :j, 1, 'ci', 'build', true, 'success')"
            ),
            {"j": job_id},
        )
    return job_id


def _insert_dispatch(engine: Engine) -> str:
    dispatch_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.ci_dispatches "
                "(dispatch_id, tenant_id, repo, proposal_id, head_sha, device_id, "
                " state, check_name) "
                "VALUES (:d, :t, 'qontinui/qontinui-runner', :p, :h, :dev, "
                " 'queued', 'ci-node')"
            ),
            {
                "d": dispatch_id,
                "t": str(uuid4()),
                "p": str(uuid4()),
                "h": _SHA,
                "dev": str(uuid4()),
            },
        )
    return dispatch_id


def _assert_absent(engine: Engine) -> None:
    for table, column in _COLUMNS:
        assert column_info(engine, table, column) is None, (table, column)


def _assert_present(engine: Engine) -> None:
    for (table, column), data_type in _COLUMNS.items():
        assert column_info(engine, table, column) == (data_type, "YES", None)
        assert column_comment(engine, table, column)


@_needs_pg
def test_columns_land_nullable_and_existing_rows_read_null() -> None:
    with ephemeral_database(admin_database_url(), "coordprio01_cols") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        job = _insert_observation(engine)
        dispatch = _insert_dispatch(engine)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)
        assert (
            scalar(
                engine,
                "SELECT queued_at FROM coord.ci_job_observations WHERE job_id = :j",
                j=job,
            )
            is None
        )
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT priority_tier, priority_reason FROM coord.ci_dispatches "
                    "WHERE dispatch_id = :d"
                ),
                {"d": dispatch},
            ).one()
        assert tuple(row) == (None, None)


@_needs_pg
def test_upgrade_is_idempotent_and_round_trips() -> None:
    with ephemeral_database(admin_database_url(), "coordprio01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        dispatch = _insert_dispatch(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.ci_dispatches SET priority_tier = 0, "
                    "priority_reason = 'label' WHERE dispatch_id = :d"
                ),
                {"d": dispatch},
            )

        # Re-executing the revision over its own columns keeps the data.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert (
            scalar(
                engine,
                "SELECT priority_tier FROM coord.ci_dispatches WHERE dispatch_id = :d",
                d=dispatch,
            )
            == 0
        )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.ci_dispatches WHERE dispatch_id = :d",
                d=dispatch,
            )
            == 1
        )

        # Downgrade twice is harmless (every drop is IF EXISTS).
        run_alembic(backend_root(), db_url, "stamp", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)
