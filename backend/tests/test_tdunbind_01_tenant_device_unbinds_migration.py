"""Schema + round-trip test for ``tdunbind_01`` (``coord.tenant_device_unbinds``
and ``coord.devices.membership_autobind``).

Phase 1 of plan ``2026-10-17-runner-credential-for-every-account-tenant``.
The consumers are coord's unbind route, consent door and ``all_memberships``
pairing arm (Phases 3 and 4), which degrade fail-closed when the object is
missing: a misspelled column there reads exactly like a migration that has not
shipped yet, so the NAMES, TYPES, NULLABILITY and DEFAULTS are pinned here.

What is pinned:

1. The revision is wired to an existing parent and its header agrees.
2. Every DDL object is ``coord.``-qualified, ``upgrade()`` drops no table,
   and both directions are static ``op.execute`` literals.
3. The live shape: every tombstone column, the ``(tenant_id, device_id)``
   primary key, the device index, and the new devices column with its default.
4. Constraints: ``reason`` admits exactly ``operator_unbind`` and
   ``owner_declined``; ``membership_autobind`` admits exactly ``created`` and
   ``off``; a second tombstone for the same pair is refused; both FKs cascade.
5. Every pre-existing device reads ``created`` after the upgrade.
6. Up, down, up leaves no residue.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing; set
``QONTINUI_TEST_PG=host:port`` (not ``DATABASE_URL``, which ``conftest.py``
overwrites).
"""

from __future__ import annotations

import ast
import re
import uuid
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
    table_exists,
)

# `_PARENT_REVISION_ID` MUST equal the revision's own `down_revision`; the
# first test enforces it. Re-point both together if main moves before landing.
_REVISION_ID = "tdunbind_01"
_PARENT_REVISION_ID = "spawnledger_01_spawn_requests"
_REVISION_FILENAME = "tdunbind_01_tenant_device_unbinds_and_membership_autobind.py"

_SCHEMA = "coord"
_TABLE = "tenant_device_unbinds"
_INDEX = "ix_tenant_device_unbinds_device"
_REASON_CHECK = "ck_tenant_device_unbinds_reason"
_AUTOBIND_CHECK = "ck_devices_membership_autobind"

# (column, information_schema.data_type, nullable, default substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("tenant_id", "uuid", False, None),
    ("device_id", "uuid", False, None),
    ("unbound_at", "timestamp with time zone", False, "now()"),
    ("unbound_by_operator_id", "uuid", True, None),
    ("reason", "text", False, "'operator_unbind'"),
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


def test_every_ddl_object_is_coord_qualified_and_upgrade_drops_no_table() -> None:
    object_re = re.compile(
        r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE|"
        r"COMMENT\s+ON\s+COLUMN|REFERENCES|CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON)"
        r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.]+)",
        re.I,
    )
    allowed = (
        f"{_SCHEMA}.{_TABLE}",
        f"{_SCHEMA}.devices",
        f"{_SCHEMA}.tenants",
    )
    for name in ("upgrade", "downgrade"):
        for sql in _sql_literals(name):
            for obj in object_re.findall(sql):
                assert obj.startswith(allowed), (name, obj)
    up = "\n".join(_sql_literals("upgrade"))
    assert not re.search(r"\bDROP\s+(?:TABLE|COLUMN|INDEX)\b", up, re.I), (
        "upgrade() must not drop a table, column or index"
    )
    down = "\n".join(_sql_literals("downgrade"))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down)
    assert re.search(rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{_INDEX}\b", down)
    assert re.search(r"DROP\s+COLUMN\s+IF\s+EXISTS\s+membership_autobind\b", down)


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


def _constraint_count(engine: Engine, name: str) -> int:
    count = scalar(
        engine,
        """
        SELECT count(*) FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = 'coord' AND c.conname = :name
        """,
        name=name,
    )
    assert isinstance(count, int)
    return count


def _index_count(engine: Engine) -> int:
    count = scalar(
        engine,
        "SELECT count(*) FROM pg_indexes WHERE schemaname = 'coord' AND indexname = :i",
        i=_INDEX,
    )
    assert isinstance(count, int)
    return count


def _seed_tenant_and_device(engine: Engine) -> tuple[str, str]:
    """Insert one tenant and one device, filling only NOT NULL no-default columns."""
    tenant_id = str(uuid.uuid4())
    device_id = str(uuid.uuid4())
    with engine.begin() as conn:
        for table, key, value in (
            ("tenants", "tenant_id", tenant_id),
            ("devices", "device_id", device_id),
        ):
            required = conn.execute(
                text(
                    """
                    SELECT column_name, data_type, udt_name
                      FROM information_schema.columns
                     WHERE table_schema = 'coord' AND table_name = :t
                       AND is_nullable = 'NO' AND column_default IS NULL
                       AND column_name <> :key
                    """
                ),
                {"t": table, "key": key},
            ).all()
            cols = [key]
            vals: dict[str, object] = {key: value}
            for name, data_type, _udt in required:
                cols.append(name)
                if name == "tenant_id":
                    vals[name] = tenant_id
                elif data_type == "uuid":
                    vals[name] = str(uuid.uuid4())
                elif data_type in ("text", "character varying"):
                    vals[name] = f"tdunbind-{name}-{value[:8]}"
                elif data_type in ("jsonb", "json"):
                    vals[name] = "{}"
                elif data_type == "boolean":
                    vals[name] = False
                elif data_type.startswith("timestamp"):
                    vals[name] = "2026-10-18T00:00:00+00:00"
                elif data_type in ("integer", "bigint", "smallint"):
                    vals[name] = 0
                else:  # pragma: no cover - surfaces a new required column type
                    raise AssertionError(f"coord.{table}.{name}: unhandled {data_type}")
            placeholders = ", ".join(f":{c}" for c in cols)
            conn.execute(
                text(
                    f"INSERT INTO coord.{table} ({', '.join(cols)}) VALUES ({placeholders})"
                ),
                vals,
            )
    return tenant_id, device_id


_INSERT_TOMBSTONE = text(
    """
    INSERT INTO coord.tenant_device_unbinds (tenant_id, device_id, reason)
    VALUES (:t, :d, :reason)
    """
)


@_needs_pg
def test_shape_primary_key_index_and_devices_column() -> None:
    with ephemeral_database(admin_database_url(), "tdunbind_shape") as (engine, db_url):
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
             WHERE c.conrelid = 'coord.tenant_device_unbinds'::regclass AND c.contype = 'p'
            """,
        )
        assert pk == "tenant_id,device_id"
        assert _index_count(engine) == 1
        assert _constraint_count(engine, _REASON_CHECK) == 1
        assert _constraint_count(engine, _AUTOBIND_CHECK) == 1
        info = column_info(engine, "devices", "membership_autobind")
        assert info is not None
        data_type, is_nullable, default = info
        assert data_type == "text"
        assert is_nullable == "NO"
        assert default is not None and "'created'" in default


@_needs_pg
def test_existing_devices_read_created_after_upgrade() -> None:
    with ephemeral_database(admin_database_url(), "tdunbind_backfill") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        # Zero, one and many pre-existing devices all read the default.
        assert scalar(engine, "SELECT count(*) FROM coord.devices") == 0
        for _ in range(3):
            _seed_tenant_and_device(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        rows = scalar(
            engine,
            "SELECT array_agg(DISTINCT membership_autobind) FROM coord.devices",
        )
        assert rows == ["created"]
        assert scalar(engine, "SELECT count(*) FROM coord.devices") == 3


@_needs_pg
def test_constraints_refuse_bad_values_and_duplicates() -> None:
    with ephemeral_database(admin_database_url(), "tdunbind_ck") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_tenant_and_device(engine)
        other_tenant, _ = _seed_tenant_and_device(engine)

        # Default reason, and the other admitted value.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.tenant_device_unbinds (tenant_id, device_id) "
                    "VALUES (:t, :d)"
                ),
                {"t": tenant_id, "d": device_id},
            )
            conn.execute(
                _INSERT_TOMBSTONE,
                {"t": other_tenant, "d": device_id, "reason": "owner_declined"},
            )
        reasons = scalar(
            engine,
            "SELECT array_agg(reason ORDER BY reason) FROM coord.tenant_device_unbinds",
        )
        assert reasons == ["operator_unbind", "owner_declined"]
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.tenant_device_unbinds "
                "WHERE unbound_at IS NOT NULL AND unbound_by_operator_id IS NULL",
            )
            == 2
        )

        # A second tombstone for the same pair is refused.
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT_TOMBSTONE,
                    {"t": tenant_id, "d": device_id, "reason": "owner_declined"},
                )
        # An unknown reason is refused.
        third_tenant, _ = _seed_tenant_and_device(engine)
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT_TOMBSTONE,
                    {"t": third_tenant, "d": device_id, "reason": "admin_unbind"},
                )
        # A tombstone for a device or tenant that does not exist is refused.
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT_TOMBSTONE,
                    {
                        "t": third_tenant,
                        "d": str(uuid.uuid4()),
                        "reason": "operator_unbind",
                    },
                )
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT_TOMBSTONE,
                    {
                        "t": str(uuid.uuid4()),
                        "d": device_id,
                        "reason": "operator_unbind",
                    },
                )

        # membership_autobind admits exactly created and off.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.devices SET membership_autobind = 'off' WHERE device_id = :d"
                ),
                {"d": device_id},
            )
        for bad in ("admin", "all", ""):
            with pytest.raises(IntegrityError):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "UPDATE coord.devices SET membership_autobind = :v "
                            "WHERE device_id = :d"
                        ),
                        {"v": bad, "d": device_id},
                    )
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.devices SET membership_autobind = NULL "
                        "WHERE device_id = :d"
                    ),
                    {"d": device_id},
                )


@_needs_pg
def test_deleting_the_device_or_tenant_cascades_its_tombstones() -> None:
    with ephemeral_database(admin_database_url(), "tdunbind_cascade") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_a, device_a = _seed_tenant_and_device(engine)
        tenant_b, device_b = _seed_tenant_and_device(engine)
        with engine.begin() as conn:
            for t, d in (
                (tenant_a, device_a),
                (tenant_b, device_a),
                (tenant_b, device_b),
            ):
                conn.execute(
                    _INSERT_TOMBSTONE, {"t": t, "d": d, "reason": "operator_unbind"}
                )
        assert scalar(engine, "SELECT count(*) FROM coord.tenant_device_unbinds") == 3
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"), {"d": device_b}
            )
        assert scalar(engine, "SELECT count(*) FROM coord.tenant_device_unbinds") == 2
        # Deleting a tenant takes only its own tombstones. tenant_a still owns
        # device_a, so detach the device first if the devices FK would block it.
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE coord.devices SET tenant_id = :b WHERE device_id = :d"),
                {"b": tenant_b, "d": device_a},
            )
            conn.execute(
                text("DELETE FROM coord.tenants WHERE tenant_id = :t"), {"t": tenant_a}
            )
        remaining = scalar(
            engine,
            "SELECT array_agg(tenant_id::text) FROM coord.tenant_device_unbinds",
        )
        assert remaining == [tenant_b]


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "tdunbind_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert _index_count(engine) == 0
        assert _constraint_count(engine, _REASON_CHECK) == 0
        assert _constraint_count(engine, _AUTOBIND_CHECK) == 0
        assert column_info(engine, "devices", "membership_autobind") is None
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert column_info(engine, "devices", "membership_autobind") is not None
