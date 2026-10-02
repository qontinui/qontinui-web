"""Structural and round-trip test for alembic ``mdroles_01``.

Plan ``2026-10-02-fleet-machine-roles-workhorse-bench-ci-node`` Phase 1 (§D4).
``coord.machine_dispatch_roles`` and its ``_versions`` child are the contract
the plan's Phase 2 ``lane_closed`` read and Phase 3 routes code against.

Like ``cmtland_01``'s test, this deliberately does NOT pin the parent
revision: ``down_revision`` is re-pointed at the merged head at land time. It
asserts the chain is WELL-FORMED instead.

Without a database (always runs): chain wiring, coord-qualified static
``op.execute`` DDL, ``IF NOT EXISTS`` upgrade, DROP only in downgrade, the
column-drop guard reading the upgrade as dropping nothing, and the versions
table mirroring every live column (§D4 "Versions mirror every column").

With a database (``QONTINUI_TEST_PG=host:port``; skipped otherwise — a skip
proves nothing): column shape of both tables, the exactly-one-machine-key
CHECK, the role CHECK, the COALESCE unique index treating the NULL half of the
key as a value, the version FK + ``UNIQUE (role_id, version)``, the comments,
idempotent upgrade and an up/down/up round-trip.
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

_REVISION_ID = "mdroles_01"
_REVISION_FILENAME = "mdroles_01_machine_dispatch_roles.py"
_SCHEMA = "coord"
_TABLE = "machine_dispatch_roles"
_VERSIONS = "machine_dispatch_roles_versions"
_UNIQUE_INDEX = "uq_machine_dispatch_roles_machine"

# (name, information_schema data_type, nullable, default-substring or None)
_LIVE_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("machine_device_id", "uuid", True, None),
    ("ci_host_name", "text", True, None),
    ("dispatch_role", "text", False, None),
    ("reason", "text", True, None),
    ("current_version", "integer", False, "1"),
    ("updated_by", "text", True, None),
    ("created_at", "timestamp with time zone", False, "now()"),
    ("updated_at", "timestamp with time zone", False, "now()"),
)

_VERSION_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("role_id", "uuid", False, None),
    ("version", "integer", False, None),
    ("tenant_id", "uuid", False, None),
    ("machine_device_id", "uuid", True, None),
    ("ci_host_name", "text", True, None),
    ("dispatch_role", "text", False, None),
    ("reason", "text", True, None),
    ("updated_by", "text", True, None),
    ("updated_at", "timestamp with time zone", False, None),
    ("created_at", "timestamp with time zone", False, "now()"),
)

# Live-row bookkeeping that a snapshot does not repeat: its own id, and the
# pointer to the latest snapshot. Every OTHER live column is mirrored.
_LIVE_ONLY = {"id", "current_version"}

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


def _declared_parent() -> str:
    parent = load_revision_module(
        _revision_path(), f"_test_{_REVISION_ID}"
    ).down_revision
    assert isinstance(parent, str) and parent, f"down_revision is {parent!r}"
    return parent


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# without a database
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}_wired")
    assert module.revision == _REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_the_declared_parent_is_exactly_one_real_sibling() -> None:
    parent = _declared_parent()
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_declared_parent())}$", source, re.M)


def test_ddl_is_coord_qualified_idempotent_and_drops_only_in_downgrade() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    down = "\n".join(_sql_literals(_function("downgrade")))
    assert not re.search(r"\bDROP\b", up, re.I)
    for table in (_TABLE, _VERSIONS):
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\s*\(", up, re.I
        ), table
        assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}\b", down), (
            table
        )
    # The FK child is dropped first.
    dropped = re.findall(r"DROP\s+TABLE\s+IF\s+EXISTS\s+([A-Za-z_.]+)", down)
    assert dropped == [f"{_SCHEMA}.{_VERSIONS}", f"{_SCHEMA}.{_TABLE}"], dropped
    assert re.search(
        rf"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{_UNIQUE_INDEX}\s+"
        rf"ON\s+{_SCHEMA}\.{_TABLE}\b",
        up,
        re.I,
    )
    for obj in re.findall(
        r"(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?"
        r"|COMMENT\s+ON\s+(?:TABLE|COLUMN)|REFERENCES)\s+([A-Za-z_.\"]+)",
        up + "\n" + down,
        re.I,
    ):
        assert obj.startswith(f"{_SCHEMA}.{_TABLE}"), obj


def test_both_directions_are_static_op_execute() -> None:
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


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_the_expected_snapshot_columns_mirror_every_live_column() -> None:
    """§D4: versions mirror every column — pinned so the two tuples cannot drift."""
    live = {c[0] for c in _LIVE_COLUMNS} - _LIVE_ONLY
    snap = {c[0] for c in _VERSION_COLUMNS}
    assert live <= snap, live - snap
    for name, data_type, nullable, _ in _LIVE_COLUMNS:
        if name in _LIVE_ONLY:
            continue
        twin = next(c for c in _VERSION_COLUMNS if c[0] == name)
        assert twin[1] == data_type, name
        assert twin[2] is nullable, name


# ---------------------------------------------------------------------------
# with a database
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _assert_shape(
    engine: Engine, table: str, expected: tuple[tuple[str, str, bool, str | None], ...]
) -> None:
    got = _columns(engine, table)
    assert set(got) == {c[0] for c in expected}, set(got)
    for name, data_type, nullable, default in expected:
        got_type, got_nullable, got_default = got[name]
        assert got_type == data_type, f"{table}.{name}: {got_type}"
        assert got_nullable is nullable, f"{table}.{name}: nullable {got_nullable}"
        if default is None:
            assert got_default is None, f"{table}.{name}: {got_default}"
        else:
            assert got_default is not None and default in got_default, (
                f"{table}.{name}: {got_default}"
            )


def _insert(engine: Engine, **overrides: object) -> uuid.UUID:
    params: dict[str, object] = {
        "tenant_id": uuid.UUID(int=1),
        "machine_device_id": uuid.uuid4(),
        "ci_host_name": None,
        "dispatch_role": "bench",
    }
    params.update(overrides)
    with engine.begin() as conn:
        return conn.execute(  # type: ignore[no-any-return]
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} "
                "(tenant_id, machine_device_id, ci_host_name, dispatch_role) "
                "VALUES (:tenant_id, :machine_device_id, :ci_host_name, "
                ":dispatch_role) RETURNING id"
            ),
            params,
        ).scalar_one()


def _snapshot(engine: Engine, role_id: uuid.UUID, version: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_SCHEMA}.{_VERSIONS} "
                "(role_id, version, tenant_id, machine_device_id, ci_host_name, "
                " dispatch_role, reason, updated_by, updated_at) "
                "SELECT id, :version, tenant_id, machine_device_id, ci_host_name, "
                "       dispatch_role, reason, updated_by, updated_at "
                f"  FROM {_SCHEMA}.{_TABLE} WHERE id = :id"
            ),
            {"id": role_id, "version": version},
        )


@_needs_pg
def test_table_shapes_checks_and_unique_machine_key() -> None:
    with ephemeral_database(admin_database_url(), "mdroles01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _assert_shape(engine, _TABLE, _LIVE_COLUMNS)
        _assert_shape(engine, _VERSIONS, _VERSION_COLUMNS)
        assert index_exists(engine, _UNIQUE_INDEX)

        tenant = uuid.UUID(int=1)
        device = uuid.uuid4()
        _insert(engine, machine_device_id=device, dispatch_role="workhorse")
        _insert(
            engine, machine_device_id=None, ci_host_name="hp2", dispatch_role="ci_node"
        )
        # The same device under ANOTHER tenant is a different row.
        _insert(engine, tenant_id=uuid.UUID(int=2), machine_device_id=device)

        # The unique index treats the NULL half of the key as a value:
        # a second row for the same machine is refused, by either key.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, tenant_id=tenant, machine_device_id=device)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, machine_device_id=None, ci_host_name="hp2")
        # Exactly one machine key: neither, or both, is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, machine_device_id=None, ci_host_name=None)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, ci_host_name="hp3")
        # '' is the index's COALESCE sentinel and never a host name.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, machine_device_id=None, ci_host_name="  ")
        # Closed role set — and not coord.devices.role's vocabulary.
        for bad in ("build", "standby", "Workhorse"):
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                _insert(engine, dispatch_role=bad)


@_needs_pg
def test_versions_mirror_the_row_and_are_keyed_per_role() -> None:
    with ephemeral_database(admin_database_url(), "mdroles01_ver") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        role_id = _insert(engine, machine_device_id=None, ci_host_name="hp2")
        _snapshot(engine, role_id, 1)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _snapshot(engine, role_id, 1)  # UNIQUE (role_id, version)
        # FK: a snapshot of a role that does not exist is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError), engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO {_SCHEMA}.{_VERSIONS} "
                    "(role_id, version, tenant_id, dispatch_role, updated_at) "
                    "VALUES (:r, 1, :t, 'bench', now())"
                ),
                {"r": uuid.uuid4(), "t": uuid.UUID(int=1)},
            )
        assert (
            scalar(
                engine,
                f"SELECT ci_host_name FROM {_SCHEMA}.{_VERSIONS} WHERE role_id = :r",
                r=role_id,
            )
            == "hp2"
        )


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    with ephemeral_database(admin_database_url(), "mdroles01_cmt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in (_TABLE, _VERSIONS):
            comment = scalar(
                engine, f"SELECT obj_description('{_SCHEMA}.{table}'::regclass)"
            )
            assert comment == comment_body_from_source(
                _revision_source(), f"{_SCHEMA}.{table}", object_kind="TABLE"
            )
            assert "SAME transaction" in str(comment)


@_needs_pg
def test_upgrade_is_idempotent_and_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "mdroles01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _snapshot(engine, _insert(engine), 1)

        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 1
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_VERSIONS}") == 1

        run_alembic(backend_root(), db_url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not table_exists(engine, _SCHEMA, _VERSIONS)
        assert not index_exists(engine, _UNIQUE_INDEX)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _VERSIONS)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 0
