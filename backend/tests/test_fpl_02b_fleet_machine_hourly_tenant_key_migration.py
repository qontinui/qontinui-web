"""Schema + round-trip test for the ``fpl_02b`` revision.

``fpl_02b`` re-keys ``coord.fleet_machine_hourly`` (created by ``fpl_02``) from
``(machine_key, hour)`` to ``(tenant_id, machine_key, hour)`` and makes
``tenant_id`` NOT NULL. Phase 3 of plan
``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr``.

The consumer is ``qontinui-coord``'s ``fleet_machine_hourly`` module, whose
UPSERT says ``ON CONFLICT (tenant_id, machine_key, hour)``. On a table without
that exact key Postgres refuses every fold with 42P10, which coord does not
classify as a pending migration, so the key is pinned here where a mismatch
fails.

What is pinned:

1. The revision is wired to an existing parent and its header agrees.
2. Every statement is a static ``op.execute`` literal on ``coord.`` objects.
3. After upgrade: the key is ``tenant_id,machine_key,hour``, ``tenant_id`` is
   NOT NULL, a pre-existing NULL-tenant row is gone and a tenant row survives,
   a second tenant under the same machine key and hour is its own row, and a
   NULL tenant is refused.
4. Downgrade restores ``machine_key,hour`` and a nullable ``tenant_id``,
   keeping the smallest tenant's row where two collide; up again works.

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
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

# `_PARENT_REVISION_ID` MUST equal the revision's own `down_revision`; the
# first test enforces it. Re-point both together if main moves before landing.
_REVISION_ID = "fpl_02b"
_PARENT_REVISION_ID = "coord_repo_tenant_bindings_01"
_REVISION_FILENAME = "fpl_02b_fleet_machine_hourly_tenant_key.py"
_TABLE_REVISION_ID = "fpl_02"

_SCHEMA = "coord"
_TABLE = "fleet_machine_hourly"

_TENANT_A = "00000000-0000-4000-8000-0000000000a1"
_TENANT_B = "00000000-0000-4000-8000-0000000000b2"
_KEY = "/runner-1"
_HOUR = "2026-10-17T04:00:00+00:00"

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


def test_every_statement_is_a_static_op_execute_on_the_coord_table() -> None:
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
        sql = call.args[0].value
        assert isinstance(sql, str)
        assert f"{_SCHEMA}.{_TABLE}" in sql, sql
    assert not re.search(r"\bDROP\s+(TABLE|COLUMN|INDEX)\b", _revision_source(), re.I)


# ---------------------------------------------------------------------------
# Live checks (ephemeral database)
# ---------------------------------------------------------------------------

_INSERT = text(
    """
    INSERT INTO coord.fleet_machine_hourly
        (tenant_id, machine_key, hour, coverage_pct, sample_count)
    VALUES (CAST(:tenant_id AS uuid), :machine_key, :hour, :coverage_pct, 1)
    """
)


def _pk(engine: Engine) -> object:
    return scalar(
        engine,
        """
        SELECT string_agg(a.attname, ',' ORDER BY k.ord)
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'coord.fleet_machine_hourly'::regclass AND c.contype = 'p'
        """,
    )


def _tenant_nullable(engine: Engine) -> bool:
    info = column_info(engine, _TABLE, "tenant_id", schema=_SCHEMA)
    assert info is not None, "tenant_id column missing"
    return info[1] == "YES"


def _rows(engine: Engine) -> dict[str | None, float]:
    with engine.connect() as conn:
        return dict(
            conn.execute(
                text(
                    "SELECT tenant_id::text, coverage_pct FROM coord.fleet_machine_hourly"
                )
            ).all()
        )


@_needs_pg
def test_upgrade_keys_by_tenant_and_downgrade_restores_the_old_key() -> None:
    with ephemeral_database(admin_database_url(), "fpl02b_key") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _TABLE_REVISION_ID)
        # Under fpl_02: a NULL-tenant row and a tenant row on different keys.
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                {
                    "tenant_id": None,
                    "machine_key": "/orphan",
                    "hour": _HOUR,
                    "coverage_pct": 5.0,
                },
            )
            conn.execute(
                _INSERT,
                {
                    "tenant_id": _TENANT_A,
                    "machine_key": _KEY,
                    "hour": _HOUR,
                    "coverage_pct": 95.0,
                },
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _pk(engine) == "tenant_id,machine_key,hour"
        assert _tenant_nullable(engine) is False
        assert _rows(engine) == {_TENANT_A: 95.0}, "the NULL-tenant row must be gone"
        # A second tenant under the same key and hour is its own row.
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                {
                    "tenant_id": _TENANT_B,
                    "machine_key": _KEY,
                    "hour": _HOUR,
                    "coverage_pct": 10.0,
                },
            )
        assert _rows(engine) == {_TENANT_A: 95.0, _TENANT_B: 10.0}
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT,
                    {
                        "tenant_id": None,
                        "machine_key": _KEY,
                        "hour": _HOUR,
                        "coverage_pct": 1.0,
                    },
                )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _pk(engine) == "machine_key,hour"
        assert _tenant_nullable(engine) is True
        # The narrower key holds one row: the smallest tenant's is kept.
        assert _rows(engine) == {_TENANT_A: 95.0}

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _pk(engine) == "tenant_id,machine_key,hour"
        assert _tenant_nullable(engine) is False
