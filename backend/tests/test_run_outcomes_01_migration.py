"""Structural and round-trip test for alembic ``run_outcomes_01``.

Plan ``2026-10-09-spec-front-end-of-the-software-factory`` Phase 2.

``coord.run_outcomes`` is a contract coord codes against from two sides: the CI
result door INSERTs into it with ``ON CONFLICT DO NOTHING`` against the
one-per-dispatch partial unique index, and the ``run_outcome`` anchor's metric
arm reads the latest row for ``(tenant_id, source, subject, task)``. The
properties pinned here are the ones that would break coord at runtime while
every migration gate stays green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.run_outcomes``, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL; no FK.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``:

4. Column types, nullability and defaults, the key and both indexes.
5. Each CHECK rejects what it names, NOT NULL names its column, and the
   one-per-dispatch index absorbs a retried write but admits dispatch-less rows.
6. The latest-row query coord runs picks the newest RUN (by run_completed_at,
   so a late write cannot reorder it), breaks a tie on id, never crosses tenants, and is served by the latest index.
7. The table and column comments land as the source writes them.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import json
import re
import sys
import uuid
from datetime import UTC, datetime, timedelta
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
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "run_outcomes_01"
_REVISION_FILENAME = "run_outcomes_01_coord_run_outcomes.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "plan_library_10_keyset_walk_indexes"

_SCHEMA = "coord"
_TABLE = "run_outcomes"

# (name, information_schema data_type, nullable, has_default)
_COLUMNS: tuple[tuple[str, str, bool, bool], ...] = (
    ("id", "uuid", False, True),
    ("tenant_id", "uuid", False, False),
    ("source", "text", False, False),
    ("subject", "text", False, False),
    ("task", "text", False, False),
    ("ref", "text", True, False),
    ("repo", "text", True, False),
    ("dispatch_id", "uuid", True, False),
    ("metrics", "jsonb", False, False),
    ("executed_case_count", "bigint", False, False),
    ("run_completed_at", "timestamp with time zone", False, False),
    ("recorded_at", "timestamp with time zone", False, True),
)

# The exact query coord's metric-arm resolver runs. Kept in step with
# `qontinui-coord` `anchor_observer.rs` `RUN_OUTCOME_LATEST_SQL`.
_LATEST_SQL = (
    "SELECT metrics, executed_case_count FROM coord.run_outcomes "
    "WHERE tenant_id = :tenant AND source = :source AND subject = :subject "
    "AND task = :task ORDER BY run_completed_at DESC, id DESC LIMIT 1"
)

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
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
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


def test_every_ddl_object_is_coord_run_outcomes() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert re.fullmatch(rf"{_SCHEMA}\.{_TABLE}(\.\w+)?", obj), (
                    f"{fn_name}(): object {obj!r} is not this revision's table"
                )
            for target in re.findall(r"INDEX\b[^;]*?\bON\s+([A-Za-z_.\"]+)", sql, re.I):
                assert target == f"{_SCHEMA}.{_TABLE}", (
                    f"{fn_name}(): index target {target!r} is not this revision's table"
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


def test_no_foreign_key_is_declared() -> None:
    # An outcome outlives the dispatch ledger, and a FK would also take a lock
    # on coord.ci_dispatches, which coord writes on every result POST.
    ddl = [
        sql
        for sql in _sql_literals(_function(_tree(), "upgrade"))
        if not re.match(r"\s*COMMENT\s+ON\b", sql, re.I)
    ]
    assert ddl
    for sql in ddl:
        assert not re.search(r"\bREFERENCES\b|\bFOREIGN\s+KEY\b", sql, re.I), sql


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
    assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", up)
    creates = re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\b[^\n]*", up, re.I)
    assert len(creates) == 2, creates
    for create in creates:
        assert re.search(r"IF\s+NOT\s+EXISTS", create, re.I), create
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_TENANT = uuid.UUID("01a10dde-0000-7000-8000-0000000000a1")
_OTHER_TENANT = uuid.UUID("01a10dde-0000-7000-8000-0000000000b2")
_RECORDED = datetime(2026, 10, 10, 7, 0, tzinfo=UTC)


def _row(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "source": "reference-eval",
        "subject": "baseline",
        "task": "all-sets",
        "ref": "a" * 40,
        "repo": "qontinui/example-evals",
        "dispatch_id": None,
        "metrics": json.dumps({"f1": 0.75}),
        "executed_case_count": 150,
        "run_completed_at": _RECORDED,
    }
    params.update(overrides)
    return params


def _insert(engine: Engine, params: dict[str, object]) -> None:
    cols = ", ".join(params)
    binds = ", ".join(
        f"CAST(:{k} AS jsonb)" if k == "metrics" else f":{k}" for k in params
    )
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds})"), params
        )


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


def _assert_rejected_by(
    engine: Engine, constraint: str, params: dict[str, object]
) -> None:
    """The insert fails, and the database names ``constraint`` as the reason."""
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, params)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None, f"driver error carries no diag: {excinfo.value.orig!r}"
    assert diag.constraint_name == constraint, (
        f"{params}: rejected by {diag.constraint_name!r}, expected {constraint!r}"
    )


def _assert_not_null(engine: Engine, column: str) -> None:
    params = {**_row(), column: None}
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, params)
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
    assert orig.diag.column_name == column  # type: ignore[union-attr]


def _count(engine: Engine) -> int:
    value = scalar(engine, f"SELECT count(*) FROM coord.{_TABLE}")
    assert isinstance(value, int)
    return value


def _latest(engine: Engine, tenant: uuid.UUID) -> tuple[object, ...] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(_LATEST_SQL),
            {
                "tenant": tenant,
                "source": "reference-eval",
                "subject": "baseline",
                "task": "all-sets",
            },
        ).one_or_none()
    return None if row is None else tuple(row)


@_needs_pg
def test_table_shape_key_and_indexes() -> None:
    with ephemeral_database(admin_database_url(), "runout01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable, has_default in _COLUMNS:
            assert name in got, f"coord.{_TABLE} is missing {name}"
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            assert (got_default is not None) is has_default, (
                f"{name}: default {got_default!r}"
            )
        assert set(got) == {c[0] for c in _COLUMNS}, f"unexpected columns {set(got)}"

        pk = scalar(
            engine,
            "SELECT string_agg(a.attname, ',') FROM pg_constraint c "
            "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) "
            "WHERE c.conrelid = 'coord.run_outcomes'::regclass AND c.contype = 'p'",
        )
        assert pk == "id"

        latest_def = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'idx_run_outcomes_latest'",
        )
        assert isinstance(latest_def, str)
        assert (
            "(tenant_id, source, subject, task, run_completed_at DESC, id DESC)"
            in latest_def
        ), latest_def
        one_def = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'idx_run_outcomes_one_per_dispatch'",
        )
        assert isinstance(one_def, str)
        assert "UNIQUE" in one_def
        assert "(dispatch_id, source, subject, task)" in one_def
        assert "WHERE (dispatch_id IS NOT NULL)" in one_def


@_needs_pg
def test_checks_nulls_and_the_one_per_dispatch_index_behave() -> None:
    with ephemeral_database(admin_database_url(), "runout01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _insert(engine, _row())
        for expected, bad in (
            ("run_outcomes_source_nonblank_check", _row(source="  ")),
            ("run_outcomes_subject_nonblank_check", _row(subject="")),
            ("run_outcomes_task_nonblank_check", _row(task=" ")),
            ("run_outcomes_metrics_object_check", _row(metrics=json.dumps([1, 2]))),
            ("run_outcomes_metrics_object_check", _row(metrics=json.dumps(0.5))),
            (
                "run_outcomes_executed_case_count_nonnegative_check",
                _row(executed_case_count=-1),
            ),
        ):
            _assert_rejected_by(engine, expected, bad)
        for column in (
            "tenant_id",
            "source",
            "subject",
            "task",
            "metrics",
            "executed_case_count",
            "run_completed_at",
        ):
            _assert_not_null(engine, column)
        # ref, repo and dispatch_id are nullable: a dispatch-less writer is allowed.
        _insert(engine, _row(ref=None, repo=None, dispatch_id=None))
        _insert(engine, _row(dispatch_id=None))
        assert _count(engine) == 3, "dispatch-less rows are never deduplicated"

        dispatch = uuid.UUID("01a10dde-0000-7000-8000-0000000000d1")
        _insert(engine, _row(dispatch_id=dispatch))
        _assert_rejected_by(
            engine, "idx_run_outcomes_one_per_dispatch", _row(dispatch_id=dispatch)
        )
        # The same dispatch may record a DIFFERENT task.
        _insert(engine, _row(dispatch_id=dispatch, task="discrepancy-detection"))
        # coord's writer: ON CONFLICT DO NOTHING absorbs a retried result POST.
        with engine.begin() as conn:
            dup = conn.execute(
                text(
                    "INSERT INTO coord.run_outcomes "
                    "(tenant_id, source, subject, task, dispatch_id, metrics, "
                    "executed_case_count, run_completed_at) "
                    "VALUES (:t, 'reference-eval', 'baseline', 'all-sets', :d, '{}'::jsonb, "
                    "1, now()) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"t": _TENANT, "d": dispatch},
            )
            assert dup.rowcount == 0, "a retried write is absorbed"
        assert _count(engine) == 5

        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    "SELECT count(*) FILTER (WHERE id IS NULL), "
                    "count(*) FILTER (WHERE recorded_at IS NULL) FROM coord.run_outcomes"
                )
            ).one()
        assert tuple(defaults) == (0, 0), "id and recorded_at default on insert"


@_needs_pg
def test_the_latest_row_query_picks_newest_breaks_ties_and_stays_in_tenant() -> None:
    with ephemeral_database(admin_database_url(), "runout01_latest") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert _latest(engine, _TENANT) is None, "no row is no row, never a default"

        _insert(
            engine,
            _row(
                metrics=json.dumps({"f1": 0.1}),
                executed_case_count=10,
                run_completed_at=_RECORDED,
            ),
        )
        _insert(
            engine,
            _row(
                metrics=json.dumps({"f1": 0.9}),
                executed_case_count=200,
                run_completed_at=_RECORDED + timedelta(hours=1),
            ),
        )
        # A newer row for ANOTHER tenant must never be read.
        _insert(
            engine,
            _row(
                tenant_id=_OTHER_TENANT,
                metrics=json.dumps({"f1": 0.0}),
                executed_case_count=0,
                run_completed_at=_RECORDED + timedelta(hours=5),
            ),
        )
        latest = _latest(engine, _TENANT)
        assert latest is not None
        assert latest[0] == {"f1": 0.9} and latest[1] == 200

        other = _latest(engine, _OTHER_TENANT)
        assert other is not None and other[1] == 0

        # A run_completed_at tie resolves on id DESC, deterministically.
        tie_at = _RECORDED + timedelta(hours=2)
        low = uuid.UUID("00000000-0000-7000-8000-000000000001")
        high = uuid.UUID("ffffffff-0000-7000-8000-000000000001")
        _insert(
            engine,
            _row(id=high, metrics=json.dumps({"f1": 0.5}), run_completed_at=tie_at),
        )
        _insert(
            engine,
            _row(id=low, metrics=json.dumps({"f1": 0.4}), run_completed_at=tie_at),
        )
        latest = _latest(engine, _TENANT)
        assert latest is not None and latest[0] == {"f1": 0.5}

        # A LATE write (recorded now, for a run that completed earlier) must not
        # become "the latest": ordering is by the run's own completion time.
        _insert(
            engine,
            _row(
                metrics=json.dumps({"f1": 0.01}),
                run_completed_at=_RECORDED - timedelta(days=1),
                recorded_at=datetime.now(UTC) + timedelta(days=1),
            ),
        )
        latest = _latest(engine, _TENANT)
        assert latest is not None and latest[0] == {"f1": 0.5}, (
            "a late write reordered latest"
        )

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            plan = "\n".join(
                r[0]
                for r in conn.execute(
                    text("EXPLAIN " + _LATEST_SQL),
                    {"tenant": _TENANT, "source": "s", "subject": "s", "task": "t"},
                )
            )
        assert "idx_run_outcomes_latest" in plan, plan
        assert "Sort" not in plan, f"the latest index must serve the ORDER BY:\n{plan}"


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "runout01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        for column, *_rest in _COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {_TABLE}.{column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "runout01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, _row())

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine) == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "runout01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, _row())

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, "idx_run_outcomes_latest")
        assert not index_exists(engine, "idx_run_outcomes_one_per_dispatch")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine) == 0, "the table comes back empty, not restored"
