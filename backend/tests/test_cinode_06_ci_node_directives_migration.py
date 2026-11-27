"""Structural and round-trip test for alembic ``cinode_06_ci_node_directives``.

Plan ``2026-11-22-ci-node-directive-replays-on-connect`` Phase 1: create
``coord.ci_node_directives``, one row per device holding the LATEST CI-node
directive coord accepted for it, which the runner reads on connect.

Without a database (always runs):

1. Chain wiring: the parent is ``overview_07_schedule_last_known`` (main's
   single head when this was authored) and the ``Revises:`` header agrees.
2. The upgrade checks ``has_table`` first and is then ONE ``create_table`` in
   schema ``coord`` with exactly the plan's eight columns (types,
   nullability, the ``device_id`` primary key), a comment on every column and
   on the table, and the two named CHECKs; with the table already present it
   does nothing. The downgrade drops exactly that table in schema ``coord``.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

3. The table appears with the column types, nullability and comments, the
   ``updated_at`` ``now()`` default, the table comment and the named arm CHECK
   all read back from the catalog; each constraint refuses its own violation
   (the primary key a second row for the same device, the arm CHECK an unknown
   arm, the payload CHECK a non-object payload).
4. Downgrade removes the table; up, down, up round-trips.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

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
    table_exists,
)

_REVISION_ID = "cinode_06_ci_node_directives"
_REVISION_FILENAME = "cinode_06_ci_node_directives.py"

# Pinned as a literal so a re-point of down_revision is a deliberate change of
# this line, the assignment, and the Revises header together.
_PARENT_REVISION_ID = "overview_07_schedule_last_known"

_SCHEMA = "coord"
_TABLE = "ci_node_directives"

# (name, SQLAlchemy type class, nullable) — the plan's Phase 1 column list.
_COLUMNS: list[tuple[str, type, bool]] = [
    ("device_id", postgresql.UUID, False),
    ("tenant_id", postgresql.UUID, False),
    ("directive_id", postgresql.UUID, False),
    ("requested_at", sa.DateTime, False),
    ("payload", postgresql.JSONB, False),
    ("credential_arm", sa.Text, False),
    ("machine_id", sa.Text, True),
    ("updated_at", sa.DateTime, False),
]

# information_schema.columns.data_type for each column, as Postgres renders it.
_CATALOG_TYPES = {
    "device_id": "uuid",
    "tenant_id": "uuid",
    "directive_id": "uuid",
    "requested_at": "timestamp with time zone",
    "payload": "jsonb",
    "credential_arm": "text",
    "machine_id": "text",
    "updated_at": "timestamp with time zone",
}

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


class _RecordingOp:
    """Stand-in for ``alembic.op`` that records create_table / drop_table."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def create_table(self, *args: Any, **kwargs: Any) -> None:
        self.calls.append(("create_table", args, kwargs))

    def drop_table(self, *args: Any, **kwargs: Any) -> None:
        self.calls.append(("drop_table", args, kwargs))

    def get_bind(self) -> object:
        return self


class _Inspector:
    """What ``inspect(op.get_bind())`` returns: reports whether the table
    already exists, and records the lookup."""

    def __init__(self, exists: bool) -> None:
        self.exists = exists
        self.lookups: list[tuple[str, str | None]] = []

    def has_table(self, name: str, schema: str | None = None) -> bool:
        self.lookups.append((name, schema))
        return self.exists


def _record(
    step: str, monkeypatch: pytest.MonkeyPatch, *, table_exists_already: bool = False
) -> tuple[_RecordingOp, _Inspector]:
    module = _module()
    recorder = _RecordingOp()
    inspector = _Inspector(table_exists_already)
    monkeypatch.setattr(module, "op", recorder)
    monkeypatch.setattr(module, "inspect", lambda _bind: inspector)
    getattr(module, step)()
    return recorder, inspector


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_chains_off_its_parent() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    source = _revision_path().read_text(encoding="utf-8")
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. structure, without a database
# ---------------------------------------------------------------------------


def test_upgrade_is_one_create_table_in_coord_with_the_plan_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder, inspector = _record("upgrade", monkeypatch)
    assert inspector.lookups == [(_TABLE, _SCHEMA)]
    assert [c[0] for c in recorder.calls] == ["create_table"]
    _, args, kwargs = recorder.calls[0]
    assert args[0] == _TABLE
    assert kwargs["schema"] == _SCHEMA
    assert kwargs.get("comment"), "the table carries a comment"
    assert "LATEST" in kwargs["comment"]

    columns = [a for a in args[1:] if isinstance(a, sa.Column)]
    assert [c.name for c in columns] == [name for name, _, _ in _COLUMNS]
    for column, (name, type_cls, nullable) in zip(columns, _COLUMNS, strict=True):
        assert isinstance(column.type, type_cls), name
        assert bool(column.nullable) is nullable, name
        assert column.comment, f"{name} carries a comment"
    by_name = {c.name: c for c in columns}
    assert by_name["device_id"].primary_key is True
    assert [c.name for c in columns if c.primary_key] == ["device_id"]
    for tz_column in ("requested_at", "updated_at"):
        column_type = by_name[tz_column].type
        assert isinstance(column_type, sa.DateTime)
        assert column_type.timezone is True, tz_column
    default = by_name["updated_at"].server_default
    assert isinstance(default, sa.DefaultClause)
    assert "now()" in str(default.arg)
    device_comment = by_name["device_id"].comment or ""
    assert "LATEST" in device_comment
    assert "connect" in device_comment

    checks = {
        a.name: " ".join(str(a.sqltext).split())
        for a in args[1:]
        if isinstance(a, sa.CheckConstraint)
    }
    assert checks == {
        "ci_node_directives_credential_arm_check": (
            "credential_arm IN ('operator', 'device')"
        ),
        "ci_node_directives_payload_object_check": "jsonb_typeof(payload) = 'object'",
    }


def test_upgrade_is_skipped_when_the_table_already_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The idempotency guard coord's migration classifier requires: a table
    already in place (a prior partial apply) is left alone."""
    recorder, inspector = _record("upgrade", monkeypatch, table_exists_already=True)
    assert inspector.lookups == [(_TABLE, _SCHEMA)]
    assert recorder.calls == []


def test_downgrade_drops_exactly_the_table_in_coord(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder, _ = _record("downgrade", monkeypatch)
    assert recorder.calls == [("drop_table", (_TABLE,), {"schema": _SCHEMA})]


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _insert(
    engine: sa.Engine,
    device_id: uuid.UUID,
    arm: str,
    payload: str = '{"enabled": true}',
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} "
                "(device_id, tenant_id, directive_id, requested_at, payload, "
                "credential_arm) "
                "VALUES (:d, :t, :i, now(), CAST(:p AS jsonb), :a)"
            ),
            {
                "d": device_id,
                "t": uuid.uuid4(),
                "i": uuid.uuid4(),
                "p": payload,
                "a": arm,
            },
        )


@_needs_pg
def test_upgrade_creates_the_table_and_downgrade_removes_it() -> None:
    with ephemeral_database(admin_database_url(), "cinode06_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name, _, nullable in _COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, name
            assert info[0] == _CATALOG_TYPES[name], name
            assert info[1] == ("YES" if nullable else "NO"), name
            assert column_comment(engine, _TABLE, name, schema=_SCHEMA), name
        updated_at = column_info(engine, _TABLE, "updated_at", schema=_SCHEMA)
        assert updated_at is not None
        assert "now()" in (updated_at[2] or "")
        assert "LATEST" in str(
            scalar(engine, f"SELECT obj_description('{_SCHEMA}.{_TABLE}'::regclass)")
        )
        assert scalar(
            engine,
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ci_node_directives_credential_arm_check' "
            f"AND conrelid = '{_SCHEMA}.{_TABLE}'::regclass",
        ) == (
            "CHECK ((credential_arm = ANY (ARRAY['operator'::text, 'device'::text])))"
        )

        device = uuid.uuid4()
        _insert(engine, device, "operator")
        # Same arm, so only the primary key can refuse it: one row per device.
        with pytest.raises(IntegrityError) as dup:
            _insert(engine, device, "operator")
        assert "ci_node_directives_pkey" in str(dup.value)
        with pytest.raises(IntegrityError) as arm:
            _insert(engine, uuid.uuid4(), "someone_else")
        assert "ci_node_directives_credential_arm_check" in str(arm.value)
        with pytest.raises(IntegrityError) as scalar_payload:
            _insert(engine, uuid.uuid4(), "device", payload='"enabled"')
        assert "ci_node_directives_payload_object_check" in str(scalar_payload.value)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
