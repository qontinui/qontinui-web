"""Structural and round-trip test for alembic ``cinode_03_dispatch_pr_head_base_sha``.

Plan ``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``
Phase 2 (web DDL half): ``coord.ci_dispatches.pr_head_sha`` / ``base_sha`` so
coord can tell "a newer PR head" from "the same PR re-rebased" (``head_sha``
is the dry-rebased tip and changes every merge tick), plus the partial index
serving the per-device ``no_subscriber`` throttle probe.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Coord's merge classifier shape: the upgrade path drops nothing (the coord
   column-drop guard agrees), every statement is a static ``op.execute`` on
   ``coord.ci_dispatches``, no dollar-quoted ``DO`` block and no ``RESET``
   appear (both reject), and the index is ``CONCURRENTLY IF NOT EXISTS``
   inside an ``autocommit_block``.
3. The columns are nullable ``TEXT`` with the 40-hex CHECK inline, the index
   has the intended keys and predicate, and the downgrade removes exactly what
   the upgrade built.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Both columns land nullable ``TEXT``; a pre-existing row reads NULL.
5. Each CHECK refuses an abbreviated, upper-case, too-long and non-hex value,
   and admits NULL and a full lowercase sha.
6. The index is valid, and the planner serves the throttle probe from it —
   while a ``cancelled`` row with another reason is not in it.
7. ``upgrade()`` is idempotent; up, down, up leaves no residue.

Not covered: the idempotency test re-runs the upgrade over a VALID index only.
The INVALID-index re-run path (a killed ``CONCURRENTLY`` build that
``IF NOT EXISTS`` then keeps, as the revision's docstring documents) is not
exercised here; producing an INVALID index needs a superuser-only fixture.
"""

from __future__ import annotations

import ast
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
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

_REVISION_ID = "cinode_03_dispatch_pr_head_base_sha"
_REVISION_FILENAME = "cinode_03_dispatch_pr_head_base_sha.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# three places: this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "coord_sessev_interact_idx_01"

_TABLE = "ci_dispatches"
_COLUMNS = ("pr_head_sha", "base_sha")
_CONSTRAINTS = {
    "pr_head_sha": "ck_ci_dispatches_pr_head_sha_hex40",
    "base_sha": "ck_ci_dispatches_base_sha_hex40",
}
_INDEX = "idx_ci_dispatches_no_subscriber_device"

_GOOD_SHA = "0123456789abcdef0123456789abcdef01234567"

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


def _executes(name: str) -> list[ast.Call]:
    """``op.execute`` calls inside ``name()`` in SOURCE order (``ast.walk`` is BFS)."""
    calls = [
        node
        for node in ast.walk(_function(name))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
        and node.func.attr == "execute"
    ]
    return sorted(calls, key=lambda c: (c.lineno, c.col_offset))


def _sql(name: str) -> list[str]:
    """Every ``op.execute`` SQL literal inside ``name()``, whitespace-collapsed."""
    out = []
    for call in _executes(name):
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str)
        out.append(_normalized(arg.value))
    return out


def _normalized(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def _in_autocommit_block(name: str) -> list[str]:
    """SQL of the ``op.execute`` calls nested in an ``autocommit_block`` ``with``."""
    out = []
    for node in ast.walk(_function(name)):
        if not isinstance(node, ast.With):
            continue
        if not any(
            isinstance(item.context_expr, ast.Call)
            and isinstance(item.context_expr.func, ast.Attribute)
            and item.context_expr.func.attr == "autocommit_block"
            for item in node.items
        ):
            continue
        for inner in ast.walk(node):
            if (
                isinstance(inner, ast.Call)
                and isinstance(inner.func, ast.Attribute)
                and inner.func.attr == "execute"
            ):
                arg = inner.args[0]
                assert isinstance(arg, ast.Constant) and isinstance(arg.value, str)
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


def test_every_op_call_is_a_static_execute_on_ci_dispatches_or_a_timeout() -> None:
    calls = [
        node
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    # ``get_context`` is only the ``autocommit_block()`` entry point.
    attrs = {c.func.attr for c in calls}  # type: ignore[attr-defined]
    assert attrs == {"execute", "get_context"}, attrs
    for call in calls:
        if call.func.attr == "get_context":  # type: ignore[attr-defined]
            assert not call.args and not call.keywords
            continue
        # coord merge-train classifier: dynamic SQL is uninspectable.
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        sql = _normalized(arg.value)
        touches_ours = f"coord.{_TABLE}" in sql or f"coord.{_INDEX}" in sql
        assert touches_ours or sql.startswith("SET LOCAL lock_timeout"), (
            f"op.execute at line {call.lineno} touches something other than "
            f"coord.{_TABLE}"
        )


def test_upgrade_avoids_every_form_the_classifier_rejects() -> None:
    for sql in _sql("upgrade"):
        upper = sql.upper()
        # A dollar-quoted DO block: "lexer cannot delimit; fail-closed".
        assert "$$" not in sql and not upper.startswith("DO"), sql
        # Only SET LOCAL lock_timeout/statement_timeout is admitted.
        assert not upper.startswith("RESET"), sql
        assert not upper.startswith("DROP") and " DROP " not in f" {upper} ", sql
        # A bare ADD CONSTRAINT must be NOT VALID; the CHECKs ride on ADD COLUMN.
        assert "ADD CONSTRAINT" not in upper, sql
        if upper.startswith("CREATE"):
            assert "CONCURRENTLY IF NOT EXISTS" in upper, sql
    # The timeout is put back before the autocommit block, so it cannot leak.
    upgrade = _sql("upgrade")
    assert upgrade[0] == "SET LOCAL lock_timeout = '3s'"
    assert "SET LOCAL lock_timeout = DEFAULT" in upgrade


def test_the_index_is_built_concurrently_in_an_autocommit_block() -> None:
    assert _in_autocommit_block("upgrade") == [
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX} "
        f"ON coord.{_TABLE} (device_id, completed_at) INCLUDE (tenant_id) "
        "WHERE state = 'cancelled' AND summary ->> 'reason' = 'no_subscriber'"
    ]


# ---------------------------------------------------------------------------
# 3. declared shape
# ---------------------------------------------------------------------------


def test_upgrade_adds_both_columns_nullable_text_with_the_inline_check() -> None:
    adds = [s for s in _sql("upgrade") if "ADD COLUMN" in s.upper()]
    assert adds == [
        f"ALTER TABLE coord.{_TABLE} "
        "ADD COLUMN IF NOT EXISTS pr_head_sha TEXT NULL "
        f"CONSTRAINT {_CONSTRAINTS['pr_head_sha']} "
        "CHECK (pr_head_sha IS NULL OR pr_head_sha ~ '^[0-9a-f]{40}$'), "
        "ADD COLUMN IF NOT EXISTS base_sha TEXT NULL "
        f"CONSTRAINT {_CONSTRAINTS['base_sha']} "
        "CHECK (base_sha IS NULL OR base_sha ~ '^[0-9a-f]{40}$')"
    ]


def test_both_columns_are_commented() -> None:
    comments = [s for s in _sql("upgrade") if s.upper().startswith("COMMENT ON")]
    assert [c.split(" IS ")[0] for c in comments] == [
        f"COMMENT ON COLUMN coord.{_TABLE}.{col}" for col in _COLUMNS
    ]


def test_downgrade_removes_exactly_what_upgrade_built() -> None:
    assert _in_autocommit_block("downgrade") == [
        f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_INDEX}"
    ]
    assert _sql("downgrade") == [
        f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_INDEX}",
        "SET LOCAL lock_timeout = '3s'",
        f"ALTER TABLE coord.{_TABLE} "
        f"DROP CONSTRAINT IF EXISTS {_CONSTRAINTS['base_sha']}, "
        f"DROP CONSTRAINT IF EXISTS {_CONSTRAINTS['pr_head_sha']}, "
        "DROP COLUMN IF EXISTS base_sha, "
        "DROP COLUMN IF EXISTS pr_head_sha",
        "SET LOCAL lock_timeout = DEFAULT",
    ]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _insert_dispatch(
    engine: Engine,
    *,
    device_id: str,
    state: str = "queued",
    reason: str | None = None,
    completed_at: datetime | None = None,
) -> str:
    dispatch_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.ci_dispatches "
                "(dispatch_id, tenant_id, repo, proposal_id, head_sha, device_id, "
                " state, check_name, completed_at, summary) "
                "VALUES (:d, :t, 'qontinui/qontinui-runner', :p, :h, :dev, "
                " :state, 'ci-node', :completed, "
                " CASE WHEN CAST(:reason AS text) IS NULL THEN NULL "
                "      ELSE jsonb_build_object('reason', CAST(:reason AS text)) END)"
            ),
            {
                "d": dispatch_id,
                "t": str(uuid4()),
                "p": str(uuid4()),
                "h": _GOOD_SHA,
                "dev": device_id,
                "state": state,
                "completed": completed_at,
                "reason": reason,
            },
        )
    return dispatch_id


def _set(engine: Engine, dispatch_id: str, column: str, value: str | None) -> None:
    assert column in _COLUMNS
    with engine.begin() as conn:
        conn.execute(
            text(f"UPDATE coord.{_TABLE} SET {column} = :v WHERE dispatch_id = :d"),
            {"v": value, "d": dispatch_id},
        )


def _get(engine: Engine, dispatch_id: str, column: str) -> object:
    assert column in _COLUMNS
    return scalar(
        engine,
        f"SELECT {column} FROM coord.{_TABLE} WHERE dispatch_id = :d",
        d=dispatch_id,
    )


def _index_is_valid(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            "SELECT i.indisvalid FROM pg_index i "
            "JOIN pg_class c ON c.oid = i.indexrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'coord' AND c.relname = :idx",
            idx=_INDEX,
        )
    )


def _constraint_count(engine: Engine) -> int:
    count = scalar(
        engine,
        "SELECT count(*) FROM pg_constraint WHERE conname = ANY(:c)",
        c=list(_CONSTRAINTS.values()),
    )
    assert isinstance(count, int)
    return count


@_needs_pg
def test_columns_land_nullable_and_an_existing_row_reads_null() -> None:
    with ephemeral_database(admin_database_url(), "cinode03_cols") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_info(engine, _TABLE, column) is None
        existing = _insert_dispatch(engine, device_id=str(uuid4()))

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for column in _COLUMNS:
            assert column_info(engine, _TABLE, column) == ("text", "YES", None)
            assert column_comment(engine, _TABLE, column)
            assert _get(engine, existing, column) is None
        assert _constraint_count(engine) == 2


@_needs_pg
def test_each_check_admits_only_null_or_a_full_lowercase_sha() -> None:
    with ephemeral_database(admin_database_url(), "cinode03_ck") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        row = _insert_dispatch(engine, device_id=str(uuid4()))
        for column in _COLUMNS:
            for bad in (
                _GOOD_SHA[:7],  # abbreviated
                _GOOD_SHA.upper(),  # upper-case never equals coord's form
                _GOOD_SHA + "0",  # too long
                _GOOD_SHA[:-1] + "g",  # non-hex
                "",
                f" {_GOOD_SHA[1:]}",
            ):
                with pytest.raises(IntegrityError):
                    _set(engine, row, column, bad)
            _set(engine, row, column, _GOOD_SHA)
            assert _get(engine, row, column) == _GOOD_SHA
            _set(engine, row, column, None)
            assert _get(engine, row, column) is None


@_needs_pg
def test_the_index_is_valid_and_serves_the_no_subscriber_probe() -> None:
    with ephemeral_database(admin_database_url(), "cinode03_idx") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX)
        assert _index_is_valid(engine)

        device = str(uuid4())
        now = datetime.now(UTC)
        hit = _insert_dispatch(
            engine,
            device_id=device,
            state="cancelled",
            reason="no_subscriber",
            completed_at=now - timedelta(seconds=5),
        )
        # Same device, cancelled for another reason: must not be in the index.
        other = _insert_dispatch(
            engine,
            device_id=device,
            state="cancelled",
            reason="superseded",
            completed_at=now - timedelta(seconds=5),
        )
        for _ in range(200):
            _insert_dispatch(engine, device_id=str(uuid4()), state="succeeded")

        probe = (
            "SELECT dispatch_id FROM coord.ci_dispatches "
            "WHERE device_id = :dev AND state = 'cancelled' "
            "AND summary ->> 'reason' = 'no_subscriber' "
            "AND completed_at > now() - make_interval(secs => 60)"
        )
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.ci_dispatches"))
            conn.execute(text("SET LOCAL enable_seqscan = off"))
            plan = "\n".join(
                r[0] for r in conn.execute(text(f"EXPLAIN {probe}"), {"dev": device})
            )
            rows = [str(r[0]) for r in conn.execute(text(probe), {"dev": device})]
        assert _INDEX in plan, plan
        assert rows == [hit]
        assert other not in rows

        # Sensitivity: a probe for another reason cannot use the partial index.
        with engine.begin() as conn:
            conn.execute(text("SET LOCAL enable_seqscan = off"))
            other_plan = "\n".join(
                r[0]
                for r in conn.execute(
                    text(
                        "EXPLAIN SELECT 1 FROM coord.ci_dispatches "
                        "WHERE device_id = :dev AND state = 'cancelled' "
                        "AND summary ->> 'reason' = 'superseded'"
                    ),
                    {"dev": device},
                )
            )
        assert _INDEX not in other_plan, other_plan


@_needs_pg
def test_upgrade_is_idempotent_and_round_trips() -> None:
    """Re-run over a VALID index only; the INVALID-index path is not covered."""
    with ephemeral_database(admin_database_url(), "cinode03_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        row = _insert_dispatch(engine, device_id=str(uuid4()))
        _set(engine, row, "pr_head_sha", _GOOD_SHA)

        # Re-executing the revision over its own objects is a no-op that keeps data.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _get(engine, row, "pr_head_sha") == _GOOD_SHA
        assert _constraint_count(engine) == 2
        assert _index_is_valid(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_info(engine, _TABLE, column) is None
        assert _constraint_count(engine) == 0
        assert not index_exists(engine, _INDEX)
        # The ledger row survives the downgrade.
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.ci_dispatches WHERE dispatch_id = :d",
                d=row,
            )
            == 1
        )

        # Downgrade twice is harmless (every drop is IF EXISTS).
        run_alembic(backend_root(), db_url, "stamp", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _constraint_count(engine) == 2
        assert _index_is_valid(engine)
        assert _get(engine, row, "pr_head_sha") is None
