"""Structural and round-trip test for alembic ``coord_maintenance_windows_01``.

Plan ``2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place``
Phase 1.

``coord.machine_ci_hosts`` and ``coord.maintenance_windows`` are contracts
coord's window routes and expiry/restore arm code against. Two properties
carry a safety argument and are pinned here: a CI host belongs to exactly one
machine per tenant (and only to a machine BOUND to that tenant), and at most
one window is OPEN per machine and per CI host, enforced by the database so
two concurrent opens cannot both win.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling, and the ``Revises:``
   header agrees.
2. Every DDL object is ``coord.``-qualified, the only DROPs are in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults of both tables, and the keys.
5. ``machine_ci_hosts``: one machine per host per tenant, the composite FK to
   ``coord.tenant_devices`` refuses an unbound device and cascades on unbind.
6. ``maintenance_windows``: the target / state / lifecycle / JSON-shape
   CHECKs, and the two open-window unique partial indexes refuse a second
   open window and nothing else.
7. The table and column comments land as the source writes them.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
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

_REVISION_ID = "coord_maintenance_windows_01"
_REVISION_FILENAME = "coord_maintenance_windows_01_create.py"

# Pinned as a literal, not read back from the module: the test must notice a
# re-point, not follow it.
_PARENT_REVISION_ID = "findings_keyset_01"

_SCHEMA = "coord"
_HOSTS = "machine_ci_hosts"
_WINDOWS = "maintenance_windows"
_OPEN_MACHINE_INDEX = "ux_maintenance_windows_open_machine"
_OPEN_HOST_INDEX = "ux_maintenance_windows_open_ci_host"
_OPEN_UNTIL_INDEX = "idx_maintenance_windows_open_until"
_TENANT_OPENED_INDEX = "idx_maintenance_windows_tenant_opened"
_INDEXES = (
    _OPEN_MACHINE_INDEX,
    _OPEN_HOST_INDEX,
    _OPEN_UNTIL_INDEX,
    _TENANT_OPENED_INDEX,
)

# (name, information_schema data_type, nullable, default-substring or None)
_HOST_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("tenant_id", "uuid", False, None),
    ("device_id", "uuid", False, None),
    ("ci_host", "text", False, None),
    ("created_by", "text", False, None),
    ("created_at", "timestamp with time zone", False, "now()"),
)

_WINDOW_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("machine_device_id", "uuid", True, None),
    ("ci_host", "text", True, None),
    ("levers", "jsonb", False, "'{}'"),
    ("until", "timestamp with time zone", False, None),
    ("reason", "text", False, None),
    ("opened_by", "text", False, None),
    ("opened_at", "timestamp with time zone", False, "now()"),
    ("closed_by", "text", True, None),
    ("closed_at", "timestamp with time zone", True, None),
    ("ci_paused_at", "timestamp with time zone", True, None),
    ("ci_label_outcomes", "jsonb", False, "'[]'"),
    ("pool_health", "jsonb", True, None),
    ("state", "text", False, "'open'"),
)

_HOST_COMMENTED = ("ci_host", "device_id")
_WINDOW_COMMENTED = (
    "levers",
    "ci_label_outcomes",
    "ci_paused_at",
    "pool_health",
    "state",
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
    assert module.down_revision == _PARENT_REVISION_ID
    parent = _PARENT_REVISION_ID

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {parent!r} must name exactly one existing sibling "
        f"(found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROPs are in downgrade()
# ---------------------------------------------------------------------------

_TABLE_OBJECT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
    r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)
_INDEX_OBJECT_RE = re.compile(
    r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON"
    r"|DROP\s+INDEX(?:\s+IF\s+EXISTS)?)\s+([A-Za-z_.\"]+)",
    re.I,
)
_OWNED_TABLES = (f"{_SCHEMA}.{_HOSTS}", f"{_SCHEMA}.{_WINDOWS}")


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    allowed_index_objects = {f"{_SCHEMA}.{_WINDOWS}"} | {
        f"{_SCHEMA}.{index}" for index in _INDEXES
    }
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                assert obj.startswith(_OWNED_TABLES), (
                    f"{fn_name}(): object {obj!r} is not one of {_OWNED_TABLES}"
                )
            for obj in _INDEX_OBJECT_RE.findall(sql):
                assert obj in allowed_index_objects, (
                    f"{fn_name}(): index object {obj!r} is not coord-qualified"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    for table in (_HOSTS, _WINDOWS):
        assert re.search(
            rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}\b", down, re.I
        ), f"downgrade() must drop {table}"
    for index in _INDEXES:
        assert re.search(
            rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{index}\b", down, re.I
        ), f"downgrade() must drop {index}"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = _tree()
    calls = [
        node
        for node in ast.walk(tree)
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


def test_upgrade_ddl_is_idempotent_and_the_open_indexes_are_unique_partial() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    for table in (_HOSTS, _WINDOWS):
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\b", up
        ), table
    for index, column in (
        (_OPEN_MACHINE_INDEX, "machine_device_id"),
        (_OPEN_HOST_INDEX, "ci_host"),
    ):
        assert re.search(
            rf"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{index}\s+ON\s+"
            rf"{_SCHEMA}\.{_WINDOWS}\s*\(tenant_id,\s*{column}\)"
            rf"\s+WHERE\s+{column}\s+IS\s+NOT\s+NULL\s+AND\s+state\s*=\s*'open'",
            up,
        ), f"{index} must be UNIQUE on (tenant_id, {column}), partial on open"
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000a001")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000a002")
_MACHINE = uuid.UUID("00000000-0000-4000-8000-00000000b001")
_OTHER_MACHINE = uuid.UUID("00000000-0000-4000-8000-00000000b002")


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
    got: dict[str, tuple[str, bool, str | None]],
    expected: tuple[tuple[str, str, bool, str | None], ...],
    table: str,
) -> None:
    for name, data_type, nullable, default in expected:
        assert name in got, f"coord.{table} is missing {name}"
        got_type, got_nullable, got_default = got[name]
        assert got_type == data_type, f"{table}.{name}: {got_type} != {data_type}"
        assert got_nullable is nullable, f"{table}.{name}: nullable {got_nullable}"
        if default is None:
            assert got_default is None, f"{table}.{name}: unexpected {got_default}"
        else:
            assert got_default is not None and default in got_default, (
                f"{table}.{name}: default {got_default!r} lacks {default!r}"
            )
    assert set(got) == {c[0] for c in expected}, f"{table}: unexpected {set(got)}"


def _pk(engine: Engine, table: str) -> object:
    return scalar(
        engine,
        f"""
        SELECT string_agg(a.attname, ',' ORDER BY k.ord)
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'coord.{table}'::regclass
           AND c.contype = 'p'
        """,
    )


def _index_definition(engine: Engine, index: str) -> str:
    value = scalar(
        engine,
        "SELECT indexdef FROM pg_indexes WHERE schemaname = :s AND indexname = :i",
        s=_SCHEMA,
        i=index,
    )
    assert isinstance(value, str)
    return value


def _seed_tenant(engine: Engine, tenant_id: uuid.UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'maintenance windows test tenant')
                """
            ),
            # The full hex: the test UUIDs share their leading digits, and slug
            # is UNIQUE, so a prefix would make the second seed collide.
            {"t": tenant_id, "slug": f"mmw01-{tenant_id.hex}"},
        )


def _seed_device(engine: Engine, device_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
    """A coord device bound to ``tenant_id`` through ``coord.tenant_devices``."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.devices (device_id, tenant_id, name, hostname)
                VALUES (:d, :t, :name, :hostname)
                """
            ),
            {
                "d": device_id,
                "t": tenant_id,
                "name": f"mmw01-{device_id.hex}",
                "hostname": f"mmw01-host-{device_id.hex}",
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.tenant_devices (tenant_id, device_id)
                VALUES (:t, :d)
                ON CONFLICT DO NOTHING
                """
            ),
            {"t": tenant_id, "d": device_id},
        )


def _seed(engine: Engine) -> None:
    _seed_tenant(engine, _TENANT)
    _seed_tenant(engine, _OTHER_TENANT)
    _seed_device(engine, _MACHINE, _TENANT)
    _seed_device(engine, _OTHER_MACHINE, _TENANT)


def _link(
    engine: Engine,
    ci_host: str,
    device_id: uuid.UUID = _MACHINE,
    tenant_id: uuid.UUID = _TENANT,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_HOSTS} (tenant_id, device_id, ci_host, created_by)
                VALUES (:t, :d, :h, 'operator:test')
                """
            ),
            {"t": tenant_id, "d": device_id, "h": ci_host},
        )


def _open_window(engine: Engine, **overrides: object) -> uuid.UUID:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "machine_device_id": _MACHINE,
        "ci_host": "merytshost",
        "reason": "kernel upgrade",
        "opened_by": "operator:test",
    }
    params.update(overrides)
    json_cols = {"levers", "ci_label_outcomes", "pool_health"}
    columns = list(params)
    values = [f"CAST(:{k} AS jsonb)" if k in json_cols else f":{k}" for k in params]
    if "until" not in params:
        columns.append("until")
        values.append("now() + interval '1 hour'")
    cols = ", ".join(columns)
    binds = ", ".join(values)
    with engine.begin() as conn:
        row = conn.execute(
            text(
                f"INSERT INTO coord.{_WINDOWS} ({cols}) VALUES ({binds}) RETURNING id"
            ),
            params,
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _violated_constraint(excinfo: pytest.ExceptionInfo[BaseException]) -> str:
    diag = getattr(getattr(excinfo.value, "orig", None), "diag", None)
    assert diag is not None, f"no diagnostics on {excinfo.value!r}"
    name = diag.constraint_name
    assert isinstance(name, str), f"no constraint name on {excinfo.value!r}"
    return name


def _count(engine: Engine, table: str) -> int:
    """Rows of ``table`` belonging to this module's two test tenants."""
    value = scalar(
        engine,
        f"SELECT count(*) FROM coord.{table} WHERE tenant_id IN (:t1, :t2)",
        t1=_TENANT,
        t2=_OTHER_TENANT,
    )
    assert isinstance(value, int)
    return value


@_needs_pg
def test_both_tables_shape_and_keys() -> None:
    with ephemeral_database(admin_database_url(), "mmw01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _assert_shape(_columns(engine, _HOSTS), _HOST_COLUMNS, _HOSTS)
        _assert_shape(_columns(engine, _WINDOWS), _WINDOW_COLUMNS, _WINDOWS)
        assert _pk(engine, _HOSTS) == "tenant_id,device_id,ci_host"
        assert _pk(engine, _WINDOWS) == "id"

        for index, column in (
            (_OPEN_MACHINE_INDEX, "machine_device_id"),
            (_OPEN_HOST_INDEX, "ci_host"),
        ):
            definition = _index_definition(engine, index)
            assert definition.startswith("CREATE UNIQUE INDEX"), definition
            assert f"(tenant_id, {column})" in definition, definition
            assert definition.endswith(
                f"WHERE (({column} IS NOT NULL) AND (state = 'open'::text))"
            ), definition
        open_until = _index_definition(engine, _OPEN_UNTIL_INDEX)
        assert not open_until.startswith("CREATE UNIQUE"), open_until
        assert "(until)" in open_until, open_until
        assert open_until.endswith("WHERE (state = 'open'::text)"), open_until
        assert "(tenant_id, opened_at DESC)" in _index_definition(
            engine, _TENANT_OPENED_INDEX
        )


@_needs_pg
def test_a_host_belongs_to_one_bound_machine_per_tenant() -> None:
    with ephemeral_database(admin_database_url(), "mmw01_hosts") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed(engine)

        _link(engine, "merytshost")
        # One machine may run several hosts.
        _link(engine, "merytshost-wsl")

        # The same host on a second machine of the same tenant is refused:
        # this is the 409 ci_host_linked_elsewhere.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as elsewhere:
            _link(engine, "merytshost", device_id=_OTHER_MACHINE)
        assert _violated_constraint(elsewhere) == "machine_ci_hosts_tenant_ci_host_key"

        # A device not bound to the tenant cannot be linked.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as unbound:
            _link(engine, "other-host", tenant_id=_OTHER_TENANT)
        assert _violated_constraint(unbound) == "machine_ci_hosts_tenant_device_fkey"

        with pytest.raises(sqlalchemy.exc.IntegrityError) as blank:
            _link(engine, "   ")
        assert _violated_constraint(blank) == "machine_ci_hosts_ci_host_nonblank"

        with engine.connect() as conn:
            created_at_set = conn.execute(
                text(f"SELECT bool_and(created_at IS NOT NULL) FROM coord.{_HOSTS}")
            ).scalar_one()
        assert created_at_set is True
        assert _count(engine, _HOSTS) == 2

        # Unbinding the device from the tenant drops its links with it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM coord.tenant_devices "
                    "WHERE tenant_id = :t AND device_id = :d"
                ),
                {"t": _TENANT, "d": _MACHINE},
            )
        assert _count(engine, _HOSTS) == 0

        # Deleting the device itself drops its links too (through the
        # tenant_devices cascade). Reaping is an UPDATE of reaped_at and is
        # not exercised here: it deliberately drops nothing.
        _link(engine, "msi-wsl", device_id=_OTHER_MACHINE)
        assert _count(engine, _HOSTS) == 1
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"),
                {"d": _OTHER_MACHINE},
            )
        assert _count(engine, _HOSTS) == 0


@_needs_pg
def test_one_open_window_per_machine_and_per_host_and_nothing_else() -> None:
    with ephemeral_database(admin_database_url(), "mmw01_open") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        first = _open_window(engine)

        # A second open window on the same machine (different host) is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as machine_dup:
            _open_window(engine, ci_host="other-host")
        assert _violated_constraint(machine_dup) == _OPEN_MACHINE_INDEX

        # A second open window on the same host (host-only window) is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as host_dup:
            _open_window(engine, machine_device_id=None)
        assert _violated_constraint(host_dup) == _OPEN_HOST_INDEX

        # Another tenant, another machine with no host, and a host-only window
        # on an unlinked host all coexist with the open one.
        _open_window(engine, tenant_id=_OTHER_TENANT)
        _open_window(engine, machine_device_id=_OTHER_MACHINE, ci_host=None)
        _open_window(engine, machine_device_id=None, ci_host="msi-wsl")
        assert _count(engine, _WINDOWS) == 4

        # Closed and expired windows do not hold the slot: history coexists,
        # and once the open one closes a new one may open.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_WINDOWS} SET state = 'closed', "
                    "closed_at = now(), closed_by = 'operator:test' WHERE id = :id"
                ),
                {"id": first},
            )
        second = _open_window(engine)
        with engine.begin() as conn:
            conn.execute(
                text(f"UPDATE coord.{_WINDOWS} SET state = 'expired' WHERE id = :id"),
                {"id": second},
            )
        _open_window(engine)
        assert _count(engine, _WINDOWS) == 6

        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    f"""
                    SELECT levers, ci_label_outcomes, state, opened_at IS NOT NULL,
                           closed_at, closed_by, ci_paused_at, pool_health
                      FROM coord.{_WINDOWS}
                     WHERE id = :id
                    """
                ),
                {"id": second},
            ).one()
        assert tuple(defaults) == ({}, [], "expired", True, None, None, None, None)


@_needs_pg
def test_window_checks_refuse_malformed_rows() -> None:
    with ephemeral_database(admin_database_url(), "mmw01_check") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        refusals: tuple[tuple[dict[str, object], str], ...] = (
            (
                {"machine_device_id": None, "ci_host": None},
                "maintenance_windows_target_present",
            ),
            ({"ci_host": "  "}, "maintenance_windows_ci_host_nonblank"),
            ({"state": "paused"}, "maintenance_windows_state_check"),
            ({"reason": " "}, "maintenance_windows_reason_nonblank"),
            ({"levers": "[]"}, "maintenance_windows_levers_object"),
            (
                {"ci_label_outcomes": "{}"},
                "maintenance_windows_ci_label_outcomes_array",
            ),
            ({"closed_by": "operator:test"}, "maintenance_windows_open_has_no_close"),
            (
                {"closed_at": "2026-09-28T12:00:00Z"},
                "maintenance_windows_open_has_no_close",
            ),
            ({"state": "closed"}, "maintenance_windows_closed_has_closed_at"),
            (
                {"opened_at": "2999-01-01T00:00:00Z"},
                "maintenance_windows_until_after_open",
            ),
            (
                {
                    "opened_at": "2026-09-28T12:00:00Z",
                    "until": "2026-09-28T12:00:00Z",
                },
                "maintenance_windows_until_after_open",
            ),
        )
        for overrides, constraint in refusals:
            with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
                _open_window(engine, **overrides)
            assert _violated_constraint(excinfo) == constraint, overrides

        # The JSON columns accept the shapes the contract writes.
        _open_window(
            engine,
            levers='{"agent_work": {"held": true, "state": "held", "detail": null}}',
            ci_label_outcomes=(
                '[{"label": "qontinui", "repo": "qontinui/qontinui-web",'
                ' "outcome": "removed", "detail": null}]'
            ),
            pool_health='{"verdict": "host_specific", "detail": "ok"}',
        )
        assert _count(engine, _WINDOWS) == 1


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "mmw01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table, columns in (
            (_HOSTS, _HOST_COMMENTED),
            (_WINDOWS, _WINDOW_COMMENTED),
        ):
            table_comment = scalar(
                engine, f"SELECT obj_description('coord.{table}'::regclass)"
            )
            assert table_comment == comment_body_from_source(
                source, f"{_SCHEMA}.{table}", object_kind="TABLE"
            )
            for column in columns:
                assert column_comment(
                    engine, table, column
                ) == comment_body_from_source(source, f"{_SCHEMA}.{table}.{column}"), (
                    f"comment on {table}.{column} differs from the revision source"
                )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "mmw01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed(engine)
        _link(engine, "merytshost")
        _open_window(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _HOSTS)
        assert table_exists(engine, _SCHEMA, _WINDOWS)
        for index in _INDEXES:
            assert index_exists(engine, index), index
        assert _count(engine, _HOSTS) == 1
        assert _count(engine, _WINDOWS) == 1


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "mmw01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed(engine)
        _link(engine, "merytshost")
        _open_window(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _HOSTS)
        assert not table_exists(engine, _SCHEMA, _WINDOWS)
        for index in _INDEXES:
            assert not index_exists(engine, index), index
        # The referenced binding table is not this revision's and must survive.
        assert table_exists(engine, _SCHEMA, "tenant_devices")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _HOSTS)
        assert table_exists(engine, _SCHEMA, _WINDOWS)
        assert _count(engine, _HOSTS) == 0
        assert _count(engine, _WINDOWS) == 0
