"""Behaviour test for the ``coord_test_result_runs_01`` run-ledger revision.

Phase 2 of plan
``2026-11-07-per-test-results-carry-run-kind-attempts-flakes-and-durations``.
The revision creates ``coord.test_result_runs`` — one row per harness run of
one CI job or shard — which coord's run-report door and per-test door upsert on
the natural key ``(repo, ci_run_id, ci_run_attempt, job, shard)``.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent names exactly one real sibling, and the docstring's ``Revises:``
   header agrees with the assignment (a re-point is three coupled edits: the
   assignment, that header, and ``_PARENT_REVISION_ID`` here).
2. **Every statement is ``coord.``-qualified raw SQL, and the only DROPs are in
   ``downgrade()``** — checked with ``check_coord_column_drops``'s own scanner.
3. **The table is built in the transaction and every index CONCURRENTLY outside
   it**, with no ``op.get_bind()`` read: coord's migration classifier rejects
   both a non-concurrent ``CREATE INDEX`` and a bind read.

Against a real Postgres (skipped when none is reachable):

4. **Upgrade from the parent creates the declared shape**: every column's type,
   nullability and default, the single-column uuid key, the identity UNIQUE by
   name, and the three indexes by definition.
5. **Each of the four CHECK vocabularies** (``ref_class``, ``run_kind``,
   ``harness``, ``gating_outcome``) accepts every one of its tokens and rejects
   a token outside it, naming its own constraint.
6. **The range CHECKs** refuse a zero or above-one inclusion probability, a
   zero re-run attempt or shard count, a negative count, and a JSON payload
   that is not an array.
7. **Both of coord's upserts work against the identity**: the per-test door's
   chunks accumulate ``persisted_rows`` and move ``last_reported_at`` without
   moving ``first_reported_at``; the report door replaces ``exceptions`` and
   ``slowest`` and leaves ``persisted_rows`` alone; another shard is another row.
8. **Downgrade removes the table and its indexes, and a re-upgrade restores
   them.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import ast
import itertools
import json
import re
import sys
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_test_result_runs_01"
_PARENT_REVISION_ID = "outbound_budget_windows_01"
_REVISION_FILENAME = "coord_test_result_runs_01_run_ledger.py"

_SCHEMA = "coord"
_TABLE = "test_result_runs"
_UNIQUE = "uq_test_result_runs_identity"
_INDEXES: dict[str, str] = {
    "idx_test_result_runs_repo_last": "(repo, last_reported_at DESC)",
    "idx_test_result_runs_repo_tested": "(repo, tested_sha)",
    "idx_test_result_runs_last_reported": "(last_reported_at)",
}

_REPO = "qontinui/qontinui-coord"

# (name, information_schema data_type, nullable, default-substring or None)
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("repo", "text", False, None),
    ("job", "text", False, None),
    ("shard", "text", False, "''"),
    ("shard_count", "smallint", False, "1"),
    ("ci_run_id", "bigint", False, None),
    ("ci_run_attempt", "integer", False, None),
    ("ref_name", "text", True, None),
    ("ref_class", "text", False, None),
    ("run_kind", "text", False, None),
    ("harness", "text", False, None),
    ("max_attempts", "smallint", True, None),
    ("head_sha", "text", True, None),
    ("tested_sha", "text", True, None),
    ("base_sha", "text", True, None),
    ("executed_count", "integer", True, None),
    ("parsed_count", "integer", True, None),
    ("skipped_count", "integer", True, None),
    ("exceptions_count", "integer", True, None),
    ("units_expected", "integer", True, None),
    ("units_reported", "integer", True, None),
    ("persisted_rows", "bigint", False, "0"),
    ("exceptions", "jsonb", False, "'[]'::jsonb"),
    ("exceptions_truncated", "boolean", False, "false"),
    ("slowest", "jsonb", False, "'[]'::jsonb"),
    ("total_test_seconds", "double precision", True, None),
    ("inclusion_probability", "double precision", True, None),
    ("gating_outcome", "text", True, None),
    ("tenant_id", "uuid", True, None),
    ("first_reported_at", "timestamp with time zone", False, "now()"),
    ("last_reported_at", "timestamp with time zone", False, "now()"),
)

# column -> (every accepted token, one token outside the vocabulary, constraint)
_VOCABULARIES: dict[str, tuple[tuple[str, ...], str, str]] = {
    "ref_class": (
        ("pr_merge_ref", "candidate", "main_push", "schedule", "dispatch", "other"),
        "merge_queue",
        "ck_test_result_runs_ref_class",
    ),
    "run_kind": (
        ("full", "selected", "audit", "backstop", "mutant", "replicate"),
        "partial",
        "ck_test_result_runs_run_kind",
    ),
    "harness": (
        ("nextest", "libtest", "spec_ci", "guard_roster", "other"),
        "pytest",
        "ck_test_result_runs_harness",
    ),
    "gating_outcome": (
        ("success", "failure", "cancelled", "skipped"),
        "neutral",
        "ck_test_result_runs_gating_outcome",
    ),
}

# The per-test door's chunk upsert, as the plan specifies it: a chunk that
# lands before its report creates the row from the run identity plus the three
# NOT NULL tags, and on conflict touches only persisted_rows/last_reported_at.
_CHUNK_UPSERT_SQL = text(
    """
    INSERT INTO coord.test_result_runs
        (repo, job, shard, ci_run_id, ci_run_attempt, ref_class, run_kind,
         harness, persisted_rows, first_reported_at, last_reported_at)
    VALUES (:repo, :job, :shard, :run_id, 1, 'pr_merge_ref', 'full', 'nextest',
            :n, :at, :at)
    ON CONFLICT (repo, ci_run_id, ci_run_attempt, job, shard) DO UPDATE SET
        persisted_rows = test_result_runs.persisted_rows + EXCLUDED.persisted_rows,
        last_reported_at = greatest(test_result_runs.last_reported_at,
                                    EXCLUDED.last_reported_at)
    """
)

# The report door's upsert: it replaces the payload and never writes
# persisted_rows, which only the per-test door accumulates.
_REPORT_UPSERT_SQL = text(
    """
    INSERT INTO coord.test_result_runs
        (repo, job, shard, ci_run_id, ci_run_attempt, ref_class, run_kind,
         harness, executed_count, parsed_count, exceptions_count, exceptions,
         slowest, first_reported_at, last_reported_at)
    VALUES (:repo, :job, :shard, :run_id, 1, 'pr_merge_ref', 'full', 'nextest',
            :executed, :parsed, :n_exc, CAST(:exceptions AS jsonb),
            CAST(:slowest AS jsonb), :at, :at)
    ON CONFLICT (repo, ci_run_id, ci_run_attempt, job, shard) DO UPDATE SET
        executed_count = EXCLUDED.executed_count,
        parsed_count = EXCLUDED.parsed_count,
        exceptions_count = EXCLUDED.exceptions_count,
        exceptions = EXCLUDED.exceptions,
        slowest = EXCLUDED.slowest,
        last_reported_at = greatest(test_result_runs.last_reported_at,
                                    EXCLUDED.last_reported_at)
    """
)

_T0 = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
_RUN_IDS = itertools.count(9_000_000_001)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring one up or set QONTINUI_TEST_PG=host:port."
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


def _function_sql(name: str) -> list[str]:
    """Every string constant inside the module-level function ``name`` except its docstring."""
    tree = ast.parse(_revision_source())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    doc = fn.body[0]
    doc_id = (
        id(doc.value)
        if isinstance(doc, ast.Expr) and isinstance(doc.value, ast.Constant)
        else None
    )
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) != doc_id
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
    upgrade_sql = _function_sql("upgrade")
    downgrade_sql = _function_sql("downgrade")
    assert len(upgrade_sql) == 4 and len(downgrade_sql) == 4
    for sql in upgrade_sql:
        assert "coord.test_result_runs" in sql, sql
        assert "DROP" not in sql.upper(), sql
    for sql in downgrade_sql:
        assert sql.startswith("DROP ") and " coord." in sql, sql

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_table_in_transaction_indexes_concurrently_and_no_bind_reads() -> None:
    tree = ast.parse(_revision_source())
    fn = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    top_level_sql = [
        node.value
        for stmt in fn.body
        if not isinstance(stmt, ast.With)
        for node in ast.walk(stmt)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert any(
        "CREATE TABLE IF NOT EXISTS coord.test_result_runs" in s for s in top_level_sql
    )
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
    assert len(in_block) == len(_INDEXES)
    for name in _INDEXES:
        assert any(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name}" in s for s in in_block
        ), name
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs


# ---------------------------------------------------------------------------
# 4-8. real Postgres
# ---------------------------------------------------------------------------


def _scalar(engine: Engine, sql: str, **params: object) -> object:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _constraint_def(engine: Engine, name: str) -> str:
    return str(
        _scalar(
            engine,
            "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
            "JOIN pg_namespace n ON n.oid = c.connamespace "
            "WHERE n.nspname = 'coord' AND c.conname = :n",
            n=name,
        )
        or ""
    )


def _index_def(engine: Engine, name: str) -> str:
    return str(
        _scalar(
            engine,
            "SELECT pg_get_indexdef(c.oid) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'coord' AND c.relname = :n",
            n=name,
        )
        or ""
    )


def _insert(engine: Engine, **overrides: object) -> None:
    """Insert one run row with valid defaults, ``overrides`` applied, in its own transaction."""
    row: dict[str, object] = {
        "repo": _REPO,
        "job": "rust-ci",
        "shard": "",
        "ci_run_id": next(_RUN_IDS),
        "ci_run_attempt": 1,
        "ref_class": "pr_merge_ref",
        "run_kind": "full",
        "harness": "nextest",
    }
    row.update(overrides)
    columns = ", ".join(row)
    values = ", ".join(
        f"CAST(:{k} AS jsonb)" if k in ("exceptions", "slowest") else f":{k}"
        for k in row
    )
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.test_result_runs ({columns}) VALUES ({values})"),
            row,
        )


def _refused(engine: Engine, **overrides: object) -> str:
    """Insert, require a CHECK violation, and return the constraint it named."""
    with pytest.raises(IntegrityError) as excinfo:
        _insert(engine, **overrides)
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == "23514", (overrides, orig)
    diag = getattr(orig, "diag", None)
    return str(getattr(diag, "constraint_name", ""))


@pytest.fixture(scope="module")
def ledger_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by tests 4-7."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_trr01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


@_needs_pg
def test_upgrade_creates_the_declared_shape(ledger_db: Engine) -> None:
    engine = ledger_db
    assert table_exists(engine, _SCHEMA, _TABLE)
    for name, expected_type, nullable, default_fragment in _EXPECTED_COLUMNS:
        info = column_info(engine, _TABLE, name, schema=_SCHEMA)
        assert info is not None, f"{name} is missing"
        data_type, is_nullable, default = info
        assert data_type == expected_type, (name, info)
        assert (is_nullable == "YES") is nullable, (name, info)
        if default_fragment is None:
            assert default is None, (name, info)
        else:
            assert default is not None and default_fragment in default, (name, info)
    n_columns = _scalar(
        engine,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = 'coord' AND table_name = :t",
        t=_TABLE,
    )
    assert n_columns == len(_EXPECTED_COLUMNS), "a column was added or dropped"
    pk = _scalar(
        engine,
        "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
        "WHERE c.conrelid = 'coord.test_result_runs'::regclass AND c.contype = 'p'",
    )
    assert pk == "PRIMARY KEY (id)", (
        "a SINGLE-column key: coord's retention prune_sql batches over one pk column"
    )
    assert (
        _constraint_def(engine, _UNIQUE)
        == "UNIQUE (repo, ci_run_id, ci_run_attempt, job, shard)"
    )
    for name, columns in _INDEXES.items():
        assert index_exists(engine, name), name
        assert columns in _index_def(engine, name), (name, _index_def(engine, name))


@_needs_pg
@pytest.mark.parametrize("column", sorted(_VOCABULARIES))
def test_each_vocabulary_accepts_its_tokens_and_refuses_another(
    ledger_db: Engine, column: str
) -> None:
    accepted, rejected, constraint = _VOCABULARIES[column]
    for token in accepted:
        _insert(ledger_db, **{column: token})
    assert _refused(ledger_db, **{column: rejected}) == constraint


@_needs_pg
@pytest.mark.parametrize(
    ("overrides", "constraint_fragment"),
    [
        ({"inclusion_probability": 0.0}, "inclusion_probability"),
        ({"inclusion_probability": 1.5}, "inclusion_probability"),
        ({"ci_run_attempt": 0}, "ci_run_attempt"),
        ({"shard_count": 0}, "shard_count"),
        ({"max_attempts": 0}, "max_attempts"),
        ({"executed_count": -1}, "executed_count"),
        ({"units_reported": -1}, "units_reported"),
        ({"persisted_rows": -1}, "persisted_rows"),
        ({"exceptions": json.dumps({"test_id": "x"})}, "exceptions_array"),
        ({"slowest": json.dumps("not an array")}, "slowest_array"),
    ],
    ids=lambda v: json.dumps(v, sort_keys=True) if isinstance(v, dict) else str(v),
)
def test_range_checks_refuse_out_of_range_values(
    ledger_db: Engine, overrides: dict[str, object], constraint_fragment: str
) -> None:
    assert constraint_fragment in _refused(ledger_db, **overrides)


@_needs_pg
def test_range_checks_accept_the_boundary_values(ledger_db: Engine) -> None:
    _insert(
        ledger_db,
        inclusion_probability=1.0,
        shard_count=4,
        max_attempts=3,
        executed_count=0,
        persisted_rows=0,
        exceptions=json.dumps([]),
        slowest=json.dumps([{"test_id": "t", "duration_seconds": 1.5}]),
    )


@_needs_pg
def test_both_coord_upserts_land_on_the_identity(ledger_db: Engine) -> None:
    engine = ledger_db
    run_id = next(_RUN_IDS)
    ident = {"repo": _REPO, "job": "coord-db-tests", "shard": "s1", "run_id": run_id}
    with engine.begin() as conn:
        # Three chunks of the per-test door, the first BEFORE the report.
        conn.execute(_CHUNK_UPSERT_SQL, {**ident, "n": 1000, "at": _T0})
        conn.execute(
            _REPORT_UPSERT_SQL,
            {
                **ident,
                "executed": 2500,
                "parsed": 2500,
                "n_exc": 1,
                "exceptions": json.dumps([{"test_id": "db:a", "outcome": "fail"}]),
                "slowest": json.dumps([{"test_id": "db:b", "duration_seconds": 9.0}]),
                "at": _T0 + timedelta(minutes=1),
            },
        )
        conn.execute(
            _CHUNK_UPSERT_SQL, {**ident, "n": 1000, "at": _T0 + timedelta(minutes=2)}
        )
        # A late chunk carrying an OLDER timestamp must not move the row back.
        conn.execute(_CHUNK_UPSERT_SQL, {**ident, "n": 500, "at": _T0})
        # A re-POSTed report replaces the payload rather than appending to it.
        conn.execute(
            _REPORT_UPSERT_SQL,
            {
                **ident,
                "executed": 2500,
                "parsed": 2500,
                "n_exc": 0,
                "exceptions": json.dumps([]),
                "slowest": json.dumps([{"test_id": "db:c", "duration_seconds": 7.0}]),
                "at": _T0 + timedelta(minutes=3),
            },
        )
        # The same run's OTHER shard is its own row.
        conn.execute(
            _CHUNK_UPSERT_SQL,
            {**ident, "shard": "s2", "n": 10, "at": _T0 + timedelta(minutes=4)},
        )
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT shard, persisted_rows, first_reported_at, last_reported_at, "
                "exceptions, slowest, exceptions_count "
                "FROM coord.test_result_runs WHERE ci_run_id = :r ORDER BY shard"
            ),
            {"r": run_id},
        ).all()
    assert [r.shard for r in rows] == ["s1", "s2"], "one row per (run, job, shard)"
    s1 = rows[0]
    assert s1.persisted_rows == 1000 + 1000 + 500, (
        "chunks accumulate; reports add nothing"
    )
    assert s1.first_reported_at == _T0
    assert s1.last_reported_at == _T0 + timedelta(minutes=3)
    assert s1.exceptions == [], "a re-POSTed report replaces the exceptions"
    assert s1.slowest == [{"test_id": "db:c", "duration_seconds": 7.0}]
    assert s1.exceptions_count == 0
    assert rows[1].persisted_rows == 10


@_needs_pg
def test_downgrade_removes_the_ledger_and_re_upgrade_restores_it() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_trr01d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name), name
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name in _INDEXES:
            assert index_exists(engine, name), name
