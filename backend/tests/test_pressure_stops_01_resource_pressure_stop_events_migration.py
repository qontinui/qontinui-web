"""Behaviour test for the ``pressure_stops_01_resource_pressure_stop_events`` revision.

Phase 1 of plan ``2026-11-24-pressure-stops-record-box-stats-in-coord``. The
revision creates ``coord.resource_pressure_stop_events``; its shape is the
contract coord's ingest (``resource_pressure_stops.rs``) and the runner emitter
are built against, so this module pins it.

Without a database (always runs): chain wiring and docstring header; every
statement one static ``coord.``-qualified literal with the only DROPs in
``downgrade()``; table, comment and index in ONE transaction.

Against a real Postgres (skipped when none is reachable; a skip proves
nothing, set ``DATABASE_URL``): the declared columns, keys, CHECKs and index;
the idempotency key refuses a duplicate ``(tenant_id, device_id,
client_event_id)`` while the same id on another device, or on the same device
under another tenant, is accepted; each CHECK refuses an unknown value;
NULL counts stay NULL (UNKNOWN, not zero); downgrade removes the table and a
re-upgrade restores it.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Iterator
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

_REVISION_ID = "pressure_stops_01_resource_pressure_stop_events"
_PARENT_REVISION_ID = "cfgyaml02_config_yaml_read_sha"
_REVISION_FILENAME = "pressure_stops_01_resource_pressure_stop_events.py"

_SCHEMA = "coord"
_TABLE = "resource_pressure_stop_events"
_INDEX = "ix_resource_pressure_stop_events_tenant_device_observed"
_RETENTION_INDEX = "ix_resource_pressure_stop_events_observed_at"
_TIMESTAMPTZ = "timestamp with time zone"

# (name, information_schema data_type, nullable, default substring or None), in
# the contract's declaration order.
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("event_id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("device_id", "uuid", False, None),
    ("client_event_id", "text", False, None),
    ("observed_at", _TIMESTAMPTZ, False, None),
    ("recorded_at", _TIMESTAMPTZ, False, "now()"),
    ("stop_kind", "text", False, None),
    ("lane", "text", False, None),
    ("guard_lane", "text", False, None),
    ("severity", "text", False, None),
    ("what_class", "text", False, None),
    ("observed", "bigint", True, None),
    ("limit_value", "bigint", True, None),
    ("reason", "text", True, None),
    ("session_count_terminal", "integer", True, None),
    ("session_count_live_claude", "integer", True, None),
    ("active_ci_runners", "integer", True, None),
    ("ci_jobs_queued", "integer", True, None),
    ("calibration", "jsonb", False, "'{}'::jsonb"),
    ("fleet_calibration", "jsonb", True, None),
    ("suppressed_count", "integer", False, "0"),
    ("dropped_before", "integer", False, "0"),
    ("box_stats", "jsonb", False, "'{}'::jsonb"),
)

# Every constraint, by name -> pg_get_constraintdef.
_CONSTRAINTS: dict[str, str] = {
    "resource_pressure_stop_events_pkey": "PRIMARY KEY (event_id)",
    "uq_resource_pressure_stop_events_client_event": (
        "UNIQUE (tenant_id, device_id, client_event_id)"
    ),
    "ck_resource_pressure_stop_events_stop_kind": (
        "CHECK ((stop_kind = ANY (ARRAY['refused_spawn'::text, "
        "'deferred_launch'::text, 'deferred_continuation'::text, "
        "'deferred_ci_job'::text])))"
    ),
    "ck_resource_pressure_stop_events_lane": (
        "CHECK ((lane = ANY (ARRAY['memory_free_commit'::text, "
        "'thread_pressure'::text])))"
    ),
    "ck_resource_pressure_stop_events_guard_lane": (
        "CHECK ((guard_lane = ANY (ARRAY['host'::text, 'wsl'::text, 'threads'::text])))"
    ),
    "ck_resource_pressure_stop_events_severity": (
        "CHECK ((severity = ANY (ARRAY['warn'::text, 'critical'::text])))"
    ),
}

_UPGRADE_STATEMENTS: tuple[str, ...] = (
    "CREATE TABLE IF NOT EXISTS coord.resource_pressure_stop_events (",
    "COMMENT ON TABLE coord.resource_pressure_stop_events IS",
    f"CREATE INDEX IF NOT EXISTS {_INDEX} ON coord.resource_pressure_stop_events (",
    f"CREATE INDEX IF NOT EXISTS {_RETENTION_INDEX} ON coord.resource_pressure_stop_events (",
)

_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    f"DROP INDEX IF EXISTS coord.{_RETENTION_INDEX}",
    f"DROP INDEX IF EXISTS coord.{_INDEX}",
    "DROP TABLE IF EXISTS coord.resource_pressure_stop_events",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring one up or set DATABASE_URL."
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


def _collapsed(sql: str | None) -> str:
    """``sql`` with every whitespace run collapsed to one space."""
    assert sql is not None, "every op.execute takes ONE static string literal"
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_revision() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    ), "the head gate's own parser must read the same parent"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    parents = [
        f.name
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parents) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {parents})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_statement_is_static_coord_sql_and_drops_live_in_downgrade() -> None:
    for call in upgrade_execute_calls(_revision_path()):
        sql = _collapsed(call.sql)
        assert " coord." in f" {sql}", sql
        # A word-boundary match: the ``dropped_before`` column is not a DROP.
        assert not re.search(r"\bDROP\b", sql, re.I), sql
    downgrade_calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert tuple(_collapsed(c.sql) for c in downgrade_calls) == _DOWNGRADE_STATEMENTS

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_table_comment_and_index_are_built_in_one_transaction() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert len(calls) == len(_UPGRADE_STATEMENTS), [_collapsed(c.sql) for c in calls]
    for call, head in zip(calls, _UPGRADE_STATEMENTS, strict=True):
        sql = _collapsed(call.sql)
        assert sql.startswith(head), (head, call.sql)
        assert "CONCURRENTLY" not in sql.upper(), sql
        assert call.in_autocommit_block is False, head

    tree = ast.parse(_revision_source())
    upgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    assert not [n for n in ast.walk(upgrade) if isinstance(n, ast.With)]
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs, "coord's migration classifier rejects bind reads"


# ---------------------------------------------------------------------------
# 4-7. real Postgres
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def stop_events_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by tests 4-6."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "pstops01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


_INSERT = text(
    """
    INSERT INTO coord.resource_pressure_stop_events
        (tenant_id, device_id, client_event_id, observed_at, stop_kind, lane,
         guard_lane, severity, what_class)
    VALUES (:t, :d, :c, now(), :stop_kind, :lane, :guard_lane, :severity,
            'terminal_spawn')
    """
)


def _insert(engine: Engine, **overrides: str) -> None:
    params = {
        "t": str(uuid.uuid4()),
        "d": str(uuid.uuid4()),
        "c": "evt-1",
        "stop_kind": "refused_spawn",
        "lane": "memory_free_commit",
        "guard_lane": "wsl",
        "severity": "critical",
    }
    params.update(overrides)
    with engine.begin() as conn:
        conn.execute(_INSERT, params)


@_needs_pg
def test_upgrade_creates_every_column_in_contract_order(
    stop_events_db: Engine,
) -> None:
    with stop_events_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :t
                 ORDER BY ordinal_position
                """
            ),
            {"t": _TABLE},
        ).all()
    assert [r.column_name for r in rows] == [c[0] for c in _COLUMNS]
    for row, (name, data_type, nullable, default) in zip(rows, _COLUMNS, strict=True):
        assert row.data_type == data_type, (name, row)
        assert (row.is_nullable == "YES") is nullable, (name, row)
        if default is None:
            assert row.column_default is None, (name, row)
        else:
            assert default in (row.column_default or ""), (name, row)


@_needs_pg
def test_upgrade_creates_the_keys_index_and_comment(stop_events_db: Engine) -> None:
    with stop_events_db.connect() as conn:
        constraints = {
            r.conname: r.condef
            for r in conn.execute(
                text(
                    """
                    SELECT conname, pg_get_constraintdef(oid) AS condef
                      FROM pg_constraint
                     WHERE conrelid = to_regclass('coord.resource_pressure_stop_events')
                    """
                )
            )
        }
        index = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid) AS indexdef, i.indisvalid
                  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :name
                """
            ),
            {"name": _INDEX},
        ).one()
        comment = conn.execute(
            text(
                "SELECT obj_description("
                "to_regclass('coord.resource_pressure_stop_events'), 'pg_class')"
            )
        ).scalar_one()

    assert constraints == _CONSTRAINTS
    assert index.indisvalid is True
    assert index.indexdef == (
        f"CREATE INDEX {_INDEX} ON coord.resource_pressure_stop_events "
        "USING btree (tenant_id, device_id, observed_at DESC)"
    )
    assert comment and "never zero" in comment

    with stop_events_db.connect() as conn:
        retention = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid) AS indexdef, i.indisvalid
                  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :name
                """
            ),
            {"name": _RETENTION_INDEX},
        ).one()
    # The retention prune filters on observed_at alone; the composite index
    # cannot serve that, so this one must exist and lead with observed_at.
    assert retention.indisvalid is True
    assert retention.indexdef == (
        f"CREATE INDEX {_RETENTION_INDEX} ON coord.resource_pressure_stop_events "
        "USING btree (observed_at)"
    )


@_needs_pg
def test_a_minimal_insert_keeps_unknown_counts_null_and_defaults_the_rest(
    stop_events_db: Engine,
) -> None:
    _insert(stop_events_db, c="minimal")
    with stop_events_db.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT session_count_terminal, session_count_live_claude,
                       active_ci_runners, ci_jobs_queued, fleet_calibration,
                       calibration::text AS calibration, box_stats::text AS box_stats,
                       suppressed_count, dropped_before, recorded_at IS NOT NULL AS stamped
                  FROM coord.resource_pressure_stop_events
                 WHERE client_event_id = 'minimal'
                """
            )
        ).one()
    assert (
        row.session_count_terminal,
        row.session_count_live_claude,
        row.active_ci_runners,
        row.ci_jobs_queued,
        row.fleet_calibration,
    ) == (None, None, None, None, None)
    assert (row.calibration, row.box_stats) == ("{}", "{}")
    assert (row.suppressed_count, row.dropped_before, row.stamped) == (0, 0, True)


@_needs_pg
def test_client_event_id_is_unique_per_tenant_and_device(
    stop_events_db: Engine,
) -> None:
    tenant = str(uuid.uuid4())
    device = str(uuid.uuid4())
    _insert(stop_events_db, t=tenant, d=device, c="dup")
    # Same tenant, other device: accepted.
    _insert(stop_events_db, t=tenant, d=str(uuid.uuid4()), c="dup")
    # Same device bound to a second tenant: accepted -- keyed on the device
    # alone this retry was answered duplicate with no row for that tenant.
    _insert(stop_events_db, t=str(uuid.uuid4()), d=device, c="dup")
    with pytest.raises(IntegrityError) as excinfo:
        _insert(stop_events_db, t=tenant, d=device, c="dup")
    assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
        "uq_resource_pressure_stop_events_client_event"
    )


@_needs_pg
@pytest.mark.parametrize(
    ("column", "bad", "constraint"),
    [
        ("stop_kind", "killed", "ck_resource_pressure_stop_events_stop_kind"),
        ("lane", "cpu", "ck_resource_pressure_stop_events_lane"),
        ("guard_lane", "gpu", "ck_resource_pressure_stop_events_guard_lane"),
        ("severity", "info", "ck_resource_pressure_stop_events_severity"),
    ],
)
def test_each_check_refuses_an_unknown_value(
    stop_events_db: Engine, column: str, bad: str, constraint: str
) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        _insert(stop_events_db, c=f"bad-{column}", **{column: bad})
    assert excinfo.value.orig.diag.constraint_name == constraint  # type: ignore[union-attr]


@_needs_pg
def test_downgrade_removes_the_table_and_re_upgrade_restores_it() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "pstops01d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX)
        assert index_exists(engine, _RETENTION_INDEX)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _INDEX)
        assert not index_exists(engine, _RETENTION_INDEX)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX)
        assert index_exists(engine, _RETENTION_INDEX)
