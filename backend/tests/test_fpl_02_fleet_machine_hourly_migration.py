"""Schema + round-trip test for the ``fpl_02`` revision (``coord.fleet_machine_hourly``).

Phase 3 of plan ``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr``.
The consumer is ``qontinui-coord``'s ``fleet_machine_hourly`` module, which
reaches this table through ``pg_error::is_missing_schema_object``: a misspelled
column there reads exactly like a migration that has not shipped yet, so the
column NAMES, TYPES and NULLABILITY are pinned here, where a mismatch fails.

What is pinned:

1. The revision is wired to an existing parent and its header agrees.
2. Every DDL object is ``coord.``-qualified, ``upgrade()`` drops nothing, and
   both directions are static ``op.execute`` literals.
3. The live shape: every column with its type and nullability, the
   ``(machine_key, hour)`` primary key, and NO default on any metric column
   (a default would write a 0 into an hour the fold could not measure).
4. The fold's UPSERT is idempotent on the key: writing the same row twice
   leaves one row with the same values.
5. ``coverage_pct`` outside 0..100 is refused.
6. Up, down, up leaves no residue.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing; set
``QONTINUI_TEST_PG=host:port`` (not ``DATABASE_URL``, which ``conftest.py``
overwrites).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

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

# `_PARENT_REVISION_ID` MUST equal the revision's own `down_revision`; the
# first test enforces it. Re-point both together if main moves before landing.
_REVISION_ID = "fpl_02"
_PARENT_REVISION_ID = "coord_ci_runner_probes_02"
_REVISION_FILENAME = "fpl_02_fleet_machine_hourly.py"

_SCHEMA = "coord"
_TABLE = "fleet_machine_hourly"
_INDEXES = ("ix_fleet_machine_hourly_tenant_hour", "ix_fleet_machine_hourly_hour")

# (column, information_schema.data_type, nullable, default substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("machine_key", "text", False, None),
    ("hour", "timestamp with time zone", False, None),
    ("tenant_id", "uuid", True, None),
    ("coverage_pct", "real", False, None),
    ("sample_count", "integer", False, None),
    ("sessions_p50", "real", True, None),
    ("sessions_max", "integer", True, None),
    ("ci_jobs_c1", "integer", True, None),
    ("ci_jobs_c2", "integer", True, None),
    ("ci_jobs_c3_remote", "integer", True, None),
    ("mem_available_p5_bytes", "bigint", True, None),
    ("mem_available_p50_bytes", "bigint", True, None),
    ("commit_available_p5_bytes", "bigint", True, None),
    ("commit_available_p50_bytes", "bigint", True, None),
    ("load_per_core_p50", "real", True, None),
    ("load_per_core_p95", "real", True, None),
    ("swap_used_max_bytes", "bigint", True, None),
    ("verification_outcomes", "jsonb", True, None),
    ("folded_at", "timestamp with time zone", False, "now()"),
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(name: str) -> list[str]:
    fn = _function(name)
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# Static checks (no database)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_exists() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    parents = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parents) == 1, [f.name for f in parents]


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_ddl_object_is_coord_qualified_and_upgrade_drops_nothing() -> None:
    table_re = re.compile(
        r"(?:CREATE\s+TABLE|DROP\s+TABLE|COMMENT\s+ON\s+TABLE|COMMENT\s+ON\s+COLUMN)"
        r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.]+)",
        re.I,
    )
    for name in ("upgrade", "downgrade"):
        for sql in _sql_literals(name):
            for obj in table_re.findall(sql):
                assert obj.startswith(f"{_SCHEMA}.{_TABLE}"), (name, obj)
    up = "\n".join(_sql_literals("upgrade"))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    assert not re.search(r"\bALTER\s+TABLE\b", up, re.I), "no existing table is altered"
    down = "\n".join(_sql_literals("downgrade"))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down)
    for index in _INDEXES:
        assert re.search(rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{index}\b", down)


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant)
        assert isinstance(call.args[0].value, str)


# ---------------------------------------------------------------------------
# Live checks (ephemeral database)
# ---------------------------------------------------------------------------


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


_UPSERT = text(
    """
    INSERT INTO coord.fleet_machine_hourly
        (machine_key, hour, coverage_pct, sample_count, sessions_p50, ci_jobs_c1,
         verification_outcomes)
    VALUES
        (:machine_key, :hour, :coverage_pct, :sample_count, :sessions_p50,
         :ci_jobs_c1, CAST(:verification_outcomes AS jsonb))
    ON CONFLICT (machine_key, hour) DO UPDATE SET
        coverage_pct = EXCLUDED.coverage_pct,
        sample_count = EXCLUDED.sample_count,
        sessions_p50 = EXCLUDED.sessions_p50,
        ci_jobs_c1 = EXCLUDED.ci_jobs_c1,
        verification_outcomes = EXCLUDED.verification_outcomes,
        folded_at = now()
    """
)

_ROW = {
    "machine_key": "00000000-0000-4000-8000-000000000007/",
    "hour": "2026-10-17T04:00:00+00:00",
    "coverage_pct": 95.0,
    "sample_count": 114,
    "sessions_p50": 20.0,
    "ci_jobs_c1": 2,
    "verification_outcomes": '{"local": 3}',
}


@_needs_pg
def test_shape_primary_key_and_no_metric_defaults() -> None:
    with ephemeral_database(admin_database_url(), "fpl02_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        got = _columns(engine)
        assert set(got) == {c[0] for c in _COLUMNS}, set(got) ^ {c[0] for c in _COLUMNS}
        for name, data_type, nullable, default in _COLUMNS:
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, (name, got_type)
            assert got_nullable is nullable, (name, got_nullable)
            if default is None:
                assert got_default is None, (name, got_default)
            else:
                assert got_default is not None and default in got_default, name
        pk = scalar(
            engine,
            """
            SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM pg_constraint c
              CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
             WHERE c.conrelid = 'coord.fleet_machine_hourly'::regclass AND c.contype = 'p'
            """,
        )
        assert pk == "machine_key,hour"
        for index in _INDEXES:
            assert (
                scalar(
                    engine,
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'coord' AND indexname = :i",
                    i=index,
                )
                == 1
            ), index


@_needs_pg
def test_upsert_on_the_key_is_idempotent_and_coverage_is_bounded() -> None:
    with ephemeral_database(admin_database_url(), "fpl02_upsert") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        select = text(
            "SELECT coverage_pct, sample_count, sessions_p50, ci_jobs_c1, "
            "verification_outcomes, mem_available_p5_bytes "
            "FROM coord.fleet_machine_hourly"
        )
        with engine.begin() as conn:
            conn.execute(_UPSERT, _ROW)
        with engine.connect() as conn:
            first = conn.execute(select).all()
        with engine.begin() as conn:
            conn.execute(_UPSERT, _ROW)
        with engine.connect() as conn:
            second = conn.execute(select).all()
        assert len(first) == 1 and first == second
        # An unwritten metric column reads NULL, never a defaulted 0.
        assert first[0][5] is None
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _UPSERT, {**_ROW, "machine_key": "/other", "coverage_pct": 100.5}
                )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "fpl02_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        for index in _INDEXES:
            assert (
                scalar(
                    engine,
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'coord' AND indexname = :i",
                    i=index,
                )
                == 0
            ), index
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
