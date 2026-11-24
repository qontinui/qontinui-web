"""Behaviour test for the ``agent_registry_02_admin_ceiling`` revision.

Phase 1 of plan
``2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type``. The
revision adds the tenant-admin ceiling columns to ``coord.agent_registry`` and
creates ``coord.agent_registry_observed_names``. Their shape is the contract
coord's Phase 3 fold, admin-switch route and observe route are built against,
so this module pins it.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent (read through the head gate's own parser) names exactly one real
   revision, and the docstring's ``Revision ID:`` / ``Revises:`` header agrees.
2. **Every statement is ONE static SQL literal, the only DROPs are in
   ``downgrade()``**, and ``check_coord_column_drops``' own scanner sees no
   drop on the upgrade path. No CHECK constraint anywhere (the
   ``agent_registry_01`` convention), no ``op.get_bind()`` read.

Against a real Postgres (skipped when none is reachable — a skip proves
nothing; set ``DATABASE_URL`` to an admin URL of a test Postgres):

3. **A row that existed before the upgrade reads ``admin_disabled = false``**
   with every other ceiling column NULL, and keeps its ``default_enabled``:
   no existing row changes meaning.
4. **The declared shape**: the five columns' types, nullability and defaults;
   the observed-names table's columns in order, its exact primary key, and no
   CHECK on either table.
5. **The observed-names upsert coord will issue works**: a minimal insert gets
   both timestamps from ``now()``, a second plain insert of the same key
   conflicts on the primary key, and the ``ON CONFLICT ... DO UPDATE`` upsert
   bumps ``last_seen_at`` / ``last_device_id`` while keeping ``first_seen_at``.
   The tenant roles (``coord_tenant``, ``coord_tenant_preflight``) hold DML on
   the new table through ``coordrls_01``'s default privileges.
6. **Downgrade removes the table and the five columns (and only them), and a
   re-upgrade restores them.**
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

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
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "agent_registry_02_admin_ceiling"
_PARENT_REVISION_ID = "coord_subprojects_05_note_events"
_REVISION_FILENAME = "agent_registry_02_admin_ceiling.py"

_SCHEMA = "coord"
_REGISTRY = "agent_registry"
_OBSERVED = "agent_registry_observed_names"
_TIMESTAMPTZ = "timestamp with time zone"

# (name, information_schema data_type, nullable, default substring or None).
_CEILING_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("admin_disabled", "boolean", False, "false"),
    ("admin_disposition", "text", True, None),
    ("admin_disabled_by", "text", True, None),
    ("admin_disabled_at", _TIMESTAMPTZ, True, None),
    ("admin_reason", "text", True, None),
)

# In declaration order.
_OBSERVED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("tenant_id", "uuid", False, None),
    ("agent_name", "text", False, None),
    ("first_seen_at", _TIMESTAMPTZ, False, "now()"),
    ("last_seen_at", _TIMESTAMPTZ, False, "now()"),
    ("last_device_id", "uuid", True, None),
    ("spawn_path_hint", "text", True, None),
)

_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    "SET LOCAL lock_timeout = '3s'",
    "DROP TABLE IF EXISTS coord.agent_registry_observed_names",
    "ALTER TABLE coord.agent_registry DROP COLUMN IF EXISTS admin_reason, "
    "DROP COLUMN IF EXISTS admin_disabled_at, "
    "DROP COLUMN IF EXISTS admin_disabled_by, "
    "DROP COLUMN IF EXISTS admin_disposition, "
    "DROP COLUMN IF EXISTS admin_disabled",
    "SET LOCAL lock_timeout = DEFAULT",
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
# 1-2. no database
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


def test_upgrade_adds_every_ceiling_column_and_creates_the_table() -> None:
    upgrade_sql = [_collapsed(c.sql) for c in upgrade_execute_calls(_revision_path())]
    alter = next(
        s for s in upgrade_sql if s.startswith("ALTER TABLE coord.agent_registry ")
    )
    assert (
        "ADD COLUMN IF NOT EXISTS admin_disabled boolean NOT NULL DEFAULT false"
        in alter
    )
    for name, _, nullable, _ in _CEILING_COLUMNS:
        assert f"ADD COLUMN IF NOT EXISTS {name} " in alter, name
        if nullable:
            assert not re.search(rf"\b{name} \w+ NOT NULL", alter), name
    assert any(
        s.startswith("CREATE TABLE IF NOT EXISTS coord.agent_registry_observed_names (")
        and "PRIMARY KEY (tenant_id, agent_name)" in s
        for s in upgrade_sql
    )
    for call in upgrade_execute_calls(_revision_path()):
        assert call.in_autocommit_block is False


def test_every_statement_is_static_sql_and_drops_live_in_downgrade() -> None:
    for call in upgrade_execute_calls(_revision_path()):
        sql = _collapsed(call.sql)
        assert "DROP" not in sql.upper(), sql
        assert not re.search(r"\bCHECK\s*\(", sql, re.I), (
            "no CHECK constraints (agent_registry_01's convention)",
            sql,
        )
    downgrade_calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert tuple(_collapsed(c.sql) for c in downgrade_calls) == _DOWNGRADE_STATEMENTS

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations

    attrs = {
        n.attr
        for n in ast.walk(ast.parse(_revision_source()))
        if isinstance(n, ast.Attribute)
    }
    assert "get_bind" not in attrs, "coord's migration classifier rejects bind reads"


# ---------------------------------------------------------------------------
# 3-6. real Postgres
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> list[Any]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    """
                    SELECT column_name, data_type, is_nullable, column_default
                      FROM information_schema.columns
                     WHERE table_schema = 'coord' AND table_name = :t
                     ORDER BY ordinal_position
                    """
                ),
                {"t": table},
            ).all()
        )


def _check_constraints(engine: Engine, table: str) -> list[str]:
    with engine.connect() as conn:
        return [
            r.conname
            for r in conn.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = to_regclass(:t) AND contype = 'c'"
                ),
                {"t": f"coord.{table}"},
            )
        ]


@pytest.fixture(scope="module")
def ceiling_db() -> Iterator[tuple[Engine, str]]:
    """One ephemeral DB with a registry row inserted at the PARENT revision,
    then upgraded to this one. Yields the engine and that row's tenant id."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_ar02") as (engine, url):
        root = backend_root()
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant = str(uuid.uuid4())
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_registry
                        (tenant_id, agent_name, default_enabled)
                    VALUES (:t, 'code-reviewer', false)
                    """
                ),
                {"t": tenant},
            )
        run_alembic(root, url, "upgrade", _REVISION_ID)
        yield engine, tenant


@_needs_pg
def test_a_pre_existing_row_is_not_admin_disabled(
    ceiling_db: tuple[Engine, str],
) -> None:
    engine, tenant = ceiling_db
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT default_enabled, admin_disabled, admin_disposition,
                       admin_disabled_by, admin_disabled_at, admin_reason
                  FROM coord.agent_registry
                 WHERE tenant_id = :t AND agent_name = 'code-reviewer'
                """
            ),
            {"t": tenant},
        ).one()
    assert row.default_enabled is False, "the tenant default is untouched"
    assert row.admin_disabled is False
    assert (
        row.admin_disposition,
        row.admin_disabled_by,
        row.admin_disabled_at,
        row.admin_reason,
    ) == (None, None, None, None)


@_needs_pg
def test_the_ceiling_columns_have_the_declared_shape(
    ceiling_db: tuple[Engine, str],
) -> None:
    engine, _ = ceiling_db
    by_name = {r.column_name: r for r in _columns(engine, _REGISTRY)}
    for name, data_type, nullable, default in _CEILING_COLUMNS:
        row = by_name[name]
        assert row.data_type == data_type, (name, row)
        assert (row.is_nullable == "YES") is nullable, (name, row)
        if default is None:
            assert row.column_default is None, (name, row)
        else:
            assert default in (row.column_default or ""), (name, row)
    assert _check_constraints(engine, _REGISTRY) == []


@_needs_pg
def test_the_observed_names_table_has_the_declared_shape(
    ceiling_db: tuple[Engine, str],
) -> None:
    engine, _ = ceiling_db
    rows = _columns(engine, _OBSERVED)
    assert [r.column_name for r in rows] == [c[0] for c in _OBSERVED_COLUMNS]
    for row, (name, data_type, nullable, default) in zip(
        rows, _OBSERVED_COLUMNS, strict=True
    ):
        assert row.data_type == data_type, (name, row)
        assert (row.is_nullable == "YES") is nullable, (name, row)
        if default is None:
            assert row.column_default is None, (name, row)
        else:
            assert default in (row.column_default or ""), (name, row)
    with engine.connect() as conn:
        pk = conn.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = to_regclass('coord.agent_registry_observed_names') "
                "AND contype = 'p'"
            )
        ).scalar_one()
    assert pk == "PRIMARY KEY (tenant_id, agent_name)"
    assert _check_constraints(engine, _OBSERVED) == []


@_needs_pg
def test_a_minimal_observation_insert_and_the_key_conflict(
    ceiling_db: tuple[Engine, str],
) -> None:
    engine, _ = ceiling_db
    tenant = str(uuid.uuid4())
    insert = text(
        """
        INSERT INTO coord.agent_registry_observed_names (tenant_id, agent_name)
        VALUES (:t, 'triage-judge')
        RETURNING first_seen_at = now() AS first_now,
                  last_seen_at = now() AS last_now,
                  last_device_id, spawn_path_hint
        """
    )
    with engine.begin() as conn:
        row = conn.execute(insert, {"t": tenant}).one()
    assert row.first_now is True and row.last_now is True
    assert (row.last_device_id, row.spawn_path_hint) == (None, None)
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(insert, {"t": tenant})
    assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
        "agent_registry_observed_names_pkey"
    )


@_needs_pg
def test_the_observe_upsert_bumps_last_seen_and_keeps_first_seen(
    ceiling_db: tuple[Engine, str],
) -> None:
    """The statement shape coord's observe route issues: ON CONFLICT on the
    primary key, bumping ``last_seen_at`` and the device, never ``first_seen_at``."""
    engine, _ = ceiling_db
    tenant = str(uuid.uuid4())
    device = str(uuid.uuid4())
    upsert = text(
        """
        INSERT INTO coord.agent_registry_observed_names
            (tenant_id, agent_name, last_device_id, spawn_path_hint)
        VALUES (:t, 'custom-agent', :d, 'in_session_subagent')
        ON CONFLICT (tenant_id, agent_name) DO UPDATE
            SET last_seen_at = now(),
                last_device_id = EXCLUDED.last_device_id,
                spawn_path_hint = EXCLUDED.spawn_path_hint
        RETURNING first_seen_at, last_seen_at
        """
    )
    with engine.begin() as conn:
        first = conn.execute(upsert, {"t": tenant, "d": str(uuid.uuid4())}).one()
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_sleep(0.01)"))
        second = conn.execute(upsert, {"t": tenant, "d": device}).one()
    assert second.first_seen_at == first.first_seen_at
    assert second.last_seen_at > first.last_seen_at
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT last_device_id FROM coord.agent_registry_observed_names "
                "WHERE tenant_id = :t"
            ),
            {"t": tenant},
        ).all()
    assert [str(r.last_device_id) for r in rows] == [device]


_TENANT_ROLES = ("coord_tenant", "coord_tenant_preflight")


@_needs_pg
def test_the_tenant_roles_can_use_the_new_table(
    ceiling_db: tuple[Engine, str],
) -> None:
    """``coordrls_01``'s default privileges must reach the new table, or the
    first tenant-scoped coord path that touches it is a ``42501``."""
    engine, _ = ceiling_db
    with engine.connect() as conn:
        for role in _TENANT_ROLES:
            for relation in (f"coord.{_OBSERVED}", f"coord.{_REGISTRY}"):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                    granted = conn.execute(
                        text("SELECT has_table_privilege(:r, :rel, :p)"),
                        {"r": role, "rel": relation, "p": privilege},
                    ).scalar_one()
                    assert granted is True, (role, relation, privilege)


@_needs_pg
def test_downgrade_removes_exactly_what_upgrade_added_and_re_upgrade_restores_it() -> (
    None
):
    root = backend_root()
    ceiling = {c[0] for c in _CEILING_COLUMNS}
    with ephemeral_database(admin_database_url(), "coord_ar02d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        before = [r.column_name for r in _columns(engine, _REGISTRY)]
        assert not ceiling & set(before)
        assert not table_exists(engine, _SCHEMA, _OBSERVED)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert ceiling <= {r.column_name for r in _columns(engine, _REGISTRY)}
        assert table_exists(engine, _SCHEMA, _OBSERVED)

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert [r.column_name for r in _columns(engine, _REGISTRY)] == before
        assert not table_exists(engine, _SCHEMA, _OBSERVED)
        assert table_exists(engine, _SCHEMA, "agent_user_prefs"), "siblings stay"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert ceiling <= {r.column_name for r in _columns(engine, _REGISTRY)}
        assert table_exists(engine, _SCHEMA, _OBSERVED)
