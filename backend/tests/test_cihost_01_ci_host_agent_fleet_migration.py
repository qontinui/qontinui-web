"""Structural and round-trip test for alembic ``cihost_01_ci_host_agent_fleet``.

Plan ``2026-10-04-coord-managed-ephemeral-self-hosted-ci-runner-fleet``
Phase 1. The five ``coord.ci_*`` tables are the contract coord's
``ci_host_agent`` module (Phase 2a) codes against.

Like ``cmtland_01``'s test this does NOT pin the parent revision:
``down_revision`` is re-pointed at the merged head at land time. It asserts the
chain is WELL-FORMED instead.

Without a database (always runs): chain wiring, coord-qualified static
``op.execute`` DDL, ``IF NOT EXISTS`` upgrade, DROP only in downgrade, the
column-drop guard reading the upgrade as dropping nothing.

With a database (``QONTINUI_TEST_PG=host:port``; skipped otherwise): column
sets, the CHECKs that carry the security contract (hash shape, trust-class and
uid-class vocabularies, lease states), the unique keys, the FK cascade, and an
idempotent up/down/up round-trip.
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
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "cihost_01_ci_host_agent_fleet"
_REVISION_FILENAME = "cihost_01_ci_host_agent_fleet.py"
_SCHEMA = "coord"
_TABLES = (
    "ci_host_agents",
    "ci_enrol_codes",
    "ci_pool_specs",
    "ci_slot_leases",
    "ci_slot_desired",
)

# The exact column sets — a shared contract with coord's ci_host_agent.rs.
_COLUMNS: dict[str, set[str]] = {
    "ci_host_agents": {
        "agent_id",
        "tenant_id",
        "credential_hash",
        "revoked_at",
        "host",
        "os",
        "declared_trust_class",
        "budget",
        "availability_window",
        "slots",
        "agent_version",
        "runner_version",
        "last_seen_at",
        "created_at",
        "updated_at",
    },
    "ci_enrol_codes": {
        "code_hash",
        "tenant_id",
        "issued_by",
        "expires_at",
        "redeemed_at",
        "created_at",
    },
    "ci_pool_specs": {
        "id",
        "tenant_id",
        "repo",
        "labels",
        "uid_class",
        "docker",
        "mem_gib",
        "cores",
        "min_idle",
        "max_slots",
        "cache_class",
        "required",
        "created_at",
        "updated_at",
    },
    "ci_slot_leases": {
        "lease_id",
        "agent_id",
        "pool_spec_id",
        "slot",
        "runner_name",
        "minted_at",
        "job_id",
        "state",
    },
    "ci_slot_desired": {"agent_id", "pool_spec_id", "desired", "computed_at"},
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
    for table in _TABLES:
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\b", up, re.I
        ), table
        assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}\b", down), (
            table
        )
    for obj in re.findall(
        r"(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?"
        r"|COMMENT\s+ON\s+(?:TABLE|COLUMN)|REFERENCES|\bON)\s+([A-Za-z_.\"]+)",
        up + "\n" + down,
        re.I,
    ):
        if obj.upper() in {"DELETE", "TABLE", "COLUMN"}:
            continue
        assert obj.startswith(f"{_SCHEMA}."), obj
    # Every secondary index is built CONCURRENTLY (additive for the classifier).
    for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX[^\n]*", up, re.I):
        assert "CONCURRENTLY" in stmt.upper(), stmt


def test_the_reserved_word_window_is_not_a_bare_column() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    assert not re.search(r"^\s*window\s", up, re.I | re.M)
    assert "availability_window" in up


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
    assert {c.func.attr for c in calls} <= {"execute", "get_context"}  # type: ignore[attr-defined]
    for call in calls:
        if call.func.attr == "execute":  # type: ignore[attr-defined]
            assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# with a database
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {r[0] for r in rows}


def _exec(engine: Engine, sql: str, **params: object) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _tenant(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    cols = scalar(
        engine,
        """
        SELECT string_agg(column_name, ',')
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = 'tenants'
           AND is_nullable = 'NO' AND column_default IS NULL
        """,
    )
    required = [c for c in str(cols or "").split(",") if c and c != "tenant_id"]
    names = ["tenant_id", *required]
    values = [":tenant_id", *[f"'t-{tenant_id.hex[:8]}-{c}'" for c in required]]
    _exec(
        engine,
        f"INSERT INTO coord.tenants ({', '.join(names)}) VALUES ({', '.join(values)})",
        tenant_id=tenant_id,
    )
    return tenant_id


_HASH = "a" * 64


def _agent(engine: Engine, tenant_id: uuid.UUID, **overrides: object) -> uuid.UUID:
    agent_id = uuid.uuid4()
    params: dict[str, object] = {
        "agent_id": agent_id,
        "tenant_id": tenant_id,
        "credential_hash": _HASH,
        "host": "merytshost",
        "os": "linux",
        "declared_trust_class": None,
    }
    params.update(overrides)
    _exec(
        engine,
        "INSERT INTO coord.ci_host_agents "
        "(agent_id, tenant_id, credential_hash, host, os, declared_trust_class) "
        "VALUES (:agent_id, :tenant_id, :credential_hash, :host, :os, "
        ":declared_trust_class)",
        **params,
    )
    return agent_id


def _pool(engine: Engine, tenant_id: uuid.UUID, **overrides: object) -> uuid.UUID:
    pool_id = uuid.uuid4()
    params: dict[str, object] = {
        "id": pool_id,
        "tenant_id": tenant_id,
        "repo": "qontinui/qontinui-coord",
        "labels": ["qontinui-coorddb", "self-hosted"],
        "uid_class": "pr",
        "mem_gib": 32,
        "cores": 8,
        "min_idle": 1,
        "max_slots": 4,
    }
    params.update(overrides)
    _exec(
        engine,
        "INSERT INTO coord.ci_pool_specs "
        "(id, tenant_id, repo, labels, uid_class, mem_gib, cores, min_idle, max_slots) "
        "VALUES (:id, :tenant_id, :repo, :labels, :uid_class, :mem_gib, :cores, "
        ":min_idle, :max_slots)",
        **params,
    )
    return pool_id


@_needs_pg
def test_tables_columns_and_security_checks() -> None:
    with ephemeral_database(admin_database_url(), "cihost01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table, cols in _COLUMNS.items():
            assert _columns(engine, table) == cols, table

        tenant_id = _tenant(engine)
        agent_id = _agent(engine, tenant_id)
        # Only a sha256 hex is accepted as the credential — never a plaintext.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _agent(engine, tenant_id, credential_hash="plaintext-secret")
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _agent(engine, tenant_id, declared_trust_class="admin")
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _agent(engine, tenant_id, os="beos")
        _agent(engine, tenant_id, declared_trust_class="trusted")

        # Enrolment codes: hash shape and a positive lifetime.
        _exec(
            engine,
            "INSERT INTO coord.ci_enrol_codes (code_hash, tenant_id, issued_by, "
            "expires_at) VALUES (:h, :t, 'op', now() + interval '1 hour')",
            h="b" * 64,
            t=tenant_id,
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _exec(
                engine,
                "INSERT INTO coord.ci_enrol_codes (code_hash, tenant_id, issued_by, "
                "expires_at) VALUES ('CODE-PLAINTEXT', :t, 'op', "
                "now() + interval '1 hour')",
                t=tenant_id,
            )

        pool_id = _pool(engine, tenant_id)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _pool(engine, tenant_id)  # same (tenant, repo, labels)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _pool(engine, tenant_id, labels=["x"], uid_class="root")
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _pool(engine, tenant_id, labels=["y"], min_idle=5, max_slots=2)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _pool(engine, tenant_id, labels=[])

        lease_sql = (
            "INSERT INTO coord.ci_slot_leases (agent_id, pool_spec_id, slot, "
            "runner_name, state) VALUES (:a, :p, :s, :n, :st)"
        )
        _exec(
            engine,
            lease_sql,
            a=agent_id,
            p=pool_id,
            s=0,
            n="h-p-0-abcd1234",
            st="minted",
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _exec(
                engine,
                lease_sql,
                a=agent_id,
                p=pool_id,
                s=1,
                n="h-p-0-abcd1234",
                st="minted",
            )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _exec(
                engine, lease_sql, a=agent_id, p=pool_id, s=1, n="other", st="running"
            )

        _exec(
            engine,
            "INSERT INTO coord.ci_slot_desired (agent_id, pool_spec_id, desired) "
            "VALUES (:a, :p, 2)",
            a=agent_id,
            p=pool_id,
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _exec(
                engine,
                "INSERT INTO coord.ci_slot_desired (agent_id, pool_spec_id, desired) "
                "VALUES (:a, :p, 3)",
                a=agent_id,
                p=pool_id,
            )

        # Deleting the agent cascades to its leases and desired rows.
        _exec(
            engine, "DELETE FROM coord.ci_host_agents WHERE agent_id = :a", a=agent_id
        )
        assert scalar(engine, "SELECT count(*) FROM coord.ci_slot_leases") == 0
        assert scalar(engine, "SELECT count(*) FROM coord.ci_slot_desired") == 0


@_needs_pg
def test_upgrade_is_idempotent_and_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "cihost01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id = _tenant(engine)
        _pool(engine, tenant_id)

        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert scalar(engine, "SELECT count(*) FROM coord.ci_pool_specs") == 1

        run_alembic(backend_root(), db_url, "downgrade", parent)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table), table
        assert scalar(engine, "SELECT count(*) FROM coord.ci_pool_specs") == 0
