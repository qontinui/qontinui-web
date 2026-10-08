"""Structural and round-trip test for alembic ``hostpause_01_host_pause_schema``.

Plan ``2026-10-06-host-pause-is-one-coord-held-switch-the-ci-host-agent-enforces``
Phase 1. The tables and columns are the contract coord's ``host_pause`` module
(plan Phase 2) codes against; the CHECKs carry the plan's D2 authority table,
D6's host settings and D7's interrupted-job identity.

Like ``cihost_01``'s test this does NOT pin the parent revision:
``down_revision`` is re-pointed at the merged head at land time. It asserts the
chain is WELL-FORMED instead.

Without a database (always runs): chain wiring, coord-qualified static
``op.execute`` DDL, ``IF NOT EXISTS`` upgrade, DROP only in downgrade, the
column-drop guard reading the upgrade as dropping nothing, and the two shapes
coord's merge-gate migration classifier needs from a change to an EXISTING
table (no ``ADD COLUMN ... NOT NULL``; every ``ADD CONSTRAINT`` ``NOT VALID``).

With a database (``QONTINUI_TEST_PG=host:port`` or ``QONTINUI_TEST_PG_DSN``;
skipped otherwise): the column sets, D2's CHECKs, the not-null-by-CHECK columns
(and that an EXISTING agent row reads every default after the upgrade), the
one-live-child and one-open-request bounds, the device link's delete rule,
interrupted-job identity, and an up/down/up round-trip with no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_ids,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "hostpause_01_host_pause_schema"
_REVISION_FILENAME = "hostpause_01_host_pause_schema.py"
_SCHEMA = "coord"

_NEW_TABLES: dict[str, set[str]] = {
    "host_pauses": {
        "id",
        "tenant_id",
        "agent_id",
        "device_id",
        "scopes",
        "actor_kind",
        "actor_ref",
        "reason_code",
        "reason_text",
        "started_at",
        "until",
        "grace_secs",
        "until_idle",
        "origin",
        "local_id",
        "applied_at",
        "memory_returned_mib",
        "ended_at",
        "ended_by_kind",
        "end_reason",
        "synced_at",
        "version",
        "imported",
        "source_since_utc",
        "imported_from",
        "imported_version",
        "created_at",
        "updated_at",
    },
    "ci_interrupted_jobs": {
        "id",
        "tenant_id",
        "repo",
        "run_id",
        "job_id",
        "run_attempt",
        "agent_id",
        "lease_id",
        "pause_id",
        "cause",
        "interrupted_at",
        "rerun_state",
        "rerun_detail",
        "rerun_job_id",
        "client_key",
        "created_at",
        "updated_at",
    },
    "host_pause_resume_requests": {
        "id",
        "tenant_id",
        "pause_id",
        "requested_by_kind",
        "requested_by_ref",
        "requested_at",
        "delivered_at",
        "answer",
        "answered_at",
    },
    "host_owner_events": {"id", "tenant_id", "agent_id", "kind", "at"},
    "ci_host_agent_hours": {
        "agent_id",
        "hour",
        "tenant_id",
        "online_secs",
        "paused_secs",
    },
    "host_pause_legacy_events": {
        "id",
        "tenant_id",
        "agent_id",
        "at",
        "kind",
        "by",
        "raw",
        "client_key",
        "created_at",
    },
}

# host_pauses_versions mirrors every host_pauses column except the row's own
# id/created_at/updated_at, plus its own id, pause_id, changed_by, recorded_at.
_NEW_TABLES["host_pauses_versions"] = (
    _NEW_TABLES["host_pauses"] - {"id", "created_at", "updated_at"}
) | {"id", "pause_id", "changed_by", "recorded_at"}

_SETTINGS_COLUMNS = {
    "device_id",
    "owner_app",
    "capacity_schedule",
    "availability_window",
    "keep_awake",
    "enforcement",
    "guest_name",
    "rollback_deferred_until",
    "windows_slot_window",
    "windows_pools_allowed",
    "windows_pools_finding",
}
_NEW_TABLES["ci_host_agents_settings_versions"] = _SETTINGS_COLUMNS | {
    "id",
    "agent_id",
    "tenant_id",
    "settings_version",
    "updated_by",
    "updated_at",
    "created_at",
}

_ADDED_COLUMNS: dict[str, set[str]] = {
    "ci_host_agents": {
        "parent_agent_id",
        "device_id",
        "owner_app",
        "capacity_schedule",
        "keep_awake",
        "enforcement",
        "settings_version",
        "settings_updated_at",
        "reported_window",
        "notices",
        "clock_skew_ms",
        "envelope_state",
        "windows_slot_window",
        "rollback_deferred_until",
        "windows_pools_allowed",
        "windows_pools_finding",
        "guest_name",
        "owner_door",
    },
    "ci_enrol_codes": {"enforcement", "parent_agent_id"},
    "ci_pool_specs": {"non_preemptible"},
    "ci_slot_leases": {"busy_started_at", "busy_ended_at"},
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
    """String literals of ``fn`` in SOURCE order (``ast.walk`` is breadth-first)."""
    doc = ast.get_docstring(fn, clean=False)
    found: list[tuple[int, int, str]] = [
        (node.lineno, node.col_offset, node.value)
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]
    found.sort()
    return [value for _, _, value in found]


def _statements(fn: ast.FunctionDef) -> list[str]:
    """Each ``op.execute`` literal, whitespace-collapsed and upper-cased."""
    return [" ".join(s.split()).upper() for s in _sql_literals(fn)]


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


def test_exactly_one_revision_declares_this_parent() -> None:
    """No sibling fork: this revision is the ONLY child of its parent."""
    parent = _declared_parent()
    children = [
        f.name
        for f in sorted((backend_root() / "alembic" / "versions").glob("*.py"))
        if parent in (declared_parent_revision_ids(f.read_text(encoding="utf-8")) or [])
    ]
    assert children == [_REVISION_FILENAME], children


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_declared_parent())}$", source, re.M)


def test_ddl_is_coord_qualified_idempotent_and_drops_only_in_downgrade() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    down = "\n".join(_sql_literals(_function("downgrade")))
    assert not re.search(r"\bDROP\b", up, re.I)
    for table in _NEW_TABLES:
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\s*\(", up, re.I
        ), table
        assert re.search(
            rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}$", down, re.M
        ), table
    # Object names follow these keywords. The SQL keywords are upper-case in
    # the revision, so the match is case-sensitive: an English "on" inside a
    # COMMENT's text is not an object reference.
    for obj in re.findall(
        r"(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?"
        r"|ALTER\s+TABLE|COMMENT\s+ON\s+(?:TABLE|COLUMN)|REFERENCES|INDEX\s+IF\s+EXISTS"
        r"|\bON(?!\s+DELETE))\s+([A-Za-z_.\"]+)",
        up + "\n" + down,
    ):
        if obj.upper() in {"TABLE", "COLUMN"}:
            continue
        assert obj.startswith(f"{_SCHEMA}."), obj
    # Every secondary index is built CONCURRENTLY and guarded.
    for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX[^\n]*", up, re.I):
        assert "CONCURRENTLY IF NOT EXISTS" in stmt.upper(), stmt


def test_existing_tables_get_no_not_null_column_and_only_not_valid_constraints() -> (
    None
):
    """The two shapes coord's migration classifier needs to read this as additive.

    ``ADD COLUMN ... NOT NULL`` and a validated ``ADD CONSTRAINT`` both make the
    classifier Reject the PR (``classify_add_column_action``; the ALTER TABLE
    action rule). A NOT NULL on an added column is therefore a separate
    ``CHECK (<col> IS NOT NULL) NOT VALID``.
    """
    alters = [
        s for s in _statements(_function("upgrade")) if s.startswith("ALTER TABLE")
    ]
    assert alters
    for stmt in alters:
        for action in re.split(r",\s*(?=ADD )", stmt.split(" ", 3)[3]):
            if action.startswith("ADD COLUMN"):
                assert action.startswith("ADD COLUMN IF NOT EXISTS "), action
                assert not re.search(r"\bNOT NULL\b", action), action
                assert not re.search(r"\bREFERENCES\b", action), action
            else:
                assert action.startswith("ADD CONSTRAINT "), action
                assert action.endswith("NOT VALID"), action


def test_every_not_null_column_the_plan_names_has_its_present_check() -> None:
    up = "\n".join(_statements(_function("upgrade")))
    for table, column in (
        ("CI_HOST_AGENTS", "KEEP_AWAKE"),
        ("CI_HOST_AGENTS", "ENFORCEMENT"),
        ("CI_HOST_AGENTS", "SETTINGS_VERSION"),
        ("CI_HOST_AGENTS", "WINDOWS_POOLS_ALLOWED"),
        ("CI_HOST_AGENTS", "OWNER_DOOR"),
        ("CI_ENROL_CODES", "ENFORCEMENT"),
        ("CI_POOL_SPECS", "NON_PREEMPTIBLE"),
    ):
        assert (
            f"ADD CONSTRAINT CK_{table}_{column}_PRESENT CHECK ({column} IS NOT NULL) NOT VALID"
            in up
        ), (table, column)


def test_lock_timeout_is_always_restored() -> None:
    for fn in ("upgrade", "downgrade"):
        stmts = _statements(_function(fn))
        bounded = [s for s in stmts if s.startswith("SET LOCAL LOCK_TIMEOUT = '3S'")]
        restored = [s for s in stmts if s == "SET LOCAL LOCK_TIMEOUT = DEFAULT"]
        assert bounded and len(bounded) == len(restored), fn
        assert stmts[-1] == "SET LOCAL LOCK_TIMEOUT = DEFAULT", fn


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


def _refused(engine: Engine, sql: str, **params: object) -> None:
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        _exec(engine, sql, **params)


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


def _agent(engine: Engine, tenant_id: uuid.UUID, **cols: object) -> uuid.UUID:
    agent_id = uuid.uuid4()
    params: dict[str, object] = {
        "agent_id": agent_id,
        "tenant_id": tenant_id,
        "credential_hash": "a" * 64,
        "host": f"h-{agent_id.hex[:8]}",
        "os": "windows",
    }
    params.update(cols)
    names = ", ".join(params)
    values = ", ".join(f":{k}" for k in params)
    _exec(
        engine,
        f"INSERT INTO coord.ci_host_agents ({names}) VALUES ({values})",
        **params,
    )
    return agent_id


def _device(engine: Engine, tenant_id: uuid.UUID) -> uuid.UUID:
    device_id = uuid.uuid4()
    _exec(
        engine,
        "INSERT INTO coord.devices (device_id, name, hostname, tenant_id) "
        "VALUES (:d, 'dev', 'dev-host', :t)",
        d=device_id,
        t=tenant_id,
    )
    _exec(
        engine,
        "INSERT INTO coord.tenant_devices (tenant_id, device_id) VALUES (:t, :d)",
        t=tenant_id,
        d=device_id,
    )
    return device_id


_PAUSE_COLS = (
    "tenant_id",
    "agent_id",
    "device_id",
    "scopes",
    "actor_kind",
    "reason_code",
    "reason_text",
    "until",
    "grace_secs",
    "until_idle",
    "origin",
    "local_id",
    "ended_at",
    "ended_by_kind",
    "end_reason",
    "imported",
    "source_since_utc",
    "imported_from",
)


def _pause(engine: Engine, **p: object) -> uuid.UUID:
    pause_id = uuid.uuid4()
    params: dict[str, object] = {
        "agent_id": None,
        "device_id": None,
        "scopes": ["ci"],
        "actor_kind": "operator",
        "reason_code": "maintenance",
        "reason_text": None,
        "grace_secs": None,
        "until_idle": False,
        "origin": "coord",
        "local_id": None,
        "ended_at": None,
        "ended_by_kind": None,
        "end_reason": None,
        "imported": False,
        "source_since_utc": None,
        "imported_from": None,
    }
    params.update(p)
    until = params.pop("until", "1 hour")
    _exec(
        engine,
        "INSERT INTO coord.host_pauses (id, started_at, "
        + ", ".join(c for c in _PAUSE_COLS if c != "until")
        + ", until) VALUES (:id, now(), "
        + ", ".join(f":{c}" for c in _PAUSE_COLS if c != "until")
        + ", CASE WHEN :until IS NULL THEN NULL ELSE now() + CAST(:until AS interval) END)",
        id=pause_id,
        until=until,
        **params,
    )
    return pause_id


@contextmanager
def _migrated(label: str) -> Iterator[Engine]:
    with ephemeral_database(admin_database_url(), label) as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


@_needs_pg
def test_tables_and_columns() -> None:
    with _migrated("hostpause01_shape") as engine:
        for table, cols in _NEW_TABLES.items():
            assert _columns(engine, table) == cols, table
        for table, added in _ADDED_COLUMNS.items():
            missing = added - _columns(engine, table)
            assert not missing, (table, missing)


@_needs_pg
def test_existing_agent_rows_read_every_default_after_the_upgrade() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "hostpause01_existing") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", parent)
        t = _tenant(engine)
        a = _agent(engine, t)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT keep_awake, enforcement, settings_version, "
                    "windows_pools_allowed, owner_door, device_id, parent_agent_id "
                    "FROM coord.ci_host_agents WHERE agent_id = :a"
                ),
                {"a": a},
            ).one()
        assert tuple(row) == ("off", "enforce", 0, False, False, None, None)


@_needs_pg
def test_host_pause_checks_carry_the_authority_table() -> None:
    with _migrated("hostpause01_pause") as engine:
        t = _tenant(engine)
        a = _agent(engine, t)
        d = _device(engine, t)
        # Accepted shapes.
        _pause(
            engine,
            tenant_id=t,
            agent_id=a,
            actor_kind="owner",
            reason_code="big_program",
            origin="local",
            local_id=uuid.uuid4(),
            until=None,
            grace_secs=120,
        )
        _pause(engine, tenant_id=t, device_id=d, scopes=["builds"], until="30 days")
        _pause(
            engine,
            tenant_id=t,
            agent_id=a,
            device_id=d,
            scopes=["ci", "builds"],
            actor_kind="agent",
            reason_text="x" * 200,
            until_idle=True,
        )
        local = uuid.uuid4()
        _pause(engine, tenant_id=t, agent_id=a, origin="local", local_id=local)

        bad: tuple[dict[str, object], ...] = (
            {
                "agent_id": a,
                "actor_kind": "owner",
                "scopes": ["builds"],
                "origin": "local",
                "local_id": uuid.uuid4(),
            },  # owner: ci only
            {"agent_id": a, "actor_kind": "owner", "until": None},  # owner: local only
            {"agent_id": a, "until": None},  # fleet actor: until mandatory
            {"agent_id": a, "until": "31 days"},  # ≤ 30 d
            {"device_id": d, "scopes": ["ci"]},  # ci needs an agent
            {"scopes": ["builds"]},  # no target at all
            {"agent_id": a, "scopes": []},
            {"agent_id": a, "scopes": ["ci", "gpu"]},
            {"agent_id": a, "actor_kind": "bench_lease"},  # part 10a widens this
            {"agent_id": a, "reason_code": "ui_test"},  # part 10a widens this
            {"agent_id": a, "reason_text": "x" * 201},
            {
                "agent_id": a,
                "actor_kind": "owner",
                "origin": "local",
                "local_id": uuid.uuid4(),
                "until": None,
                "reason_text": "why",
            },
            {"agent_id": a, "grace_secs": 3601},
            {"agent_id": a, "grace_secs": 60, "until_idle": True},
            {"agent_id": a, "origin": "local"},  # local needs local_id
            {"agent_id": a, "origin": "local", "local_id": local},  # sync key dup
            {"agent_id": a, "ended_at": "2026-10-08T00:00:00Z"},  # no end_reason
            {
                "agent_id": a,
                "ended_at": "2026-10-08T00:00:00Z",
                "end_reason": "lease_queue_empty",
                "ended_by_kind": "coord",
            },
            {"agent_id": a, "source_since_utc": "2026-10-01T00:00:00Z"},  # not imported
            {
                "agent_id": a,
                "imported": True,
                "source_since_utc": "2999-01-01T00:00:00Z",
            },  # after started_at
        )
        for b in bad:
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                _pause(engine, tenant_id=t, **b)

        # An ended row is accepted with its reason and its actor.
        _pause(
            engine,
            tenant_id=t,
            agent_id=a,
            ended_at="2026-10-08T00:00:00Z",
            end_reason="resumed",
            ended_by_kind="operator",
        )
        # The build-admission copy key is unique per tenant.
        _pause(
            engine,
            tenant_id=t,
            device_id=d,
            scopes=["builds"],
            imported_from=f"build-admission:{d}",
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _pause(
                engine,
                tenant_id=t,
                device_id=d,
                scopes=["builds"],
                imported_from=f"build-admission:{d}",
            )
        # An imported pause keeps its earlier source time.
        _pause(
            engine,
            tenant_id=t,
            agent_id=a,
            actor_kind="owner",
            origin="local",
            local_id=uuid.uuid4(),
            until=None,
            imported=True,
            source_since_utc="2026-10-01T00:00:00Z",
        )


@_needs_pg
def test_a_pause_cannot_target_another_tenants_agent() -> None:
    with _migrated("hostpause01_xtenant") as engine:
        t1, t2 = _tenant(engine), _tenant(engine)
        a1 = _agent(engine, t1)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _pause(engine, tenant_id=t2, agent_id=a1)


@_needs_pg
def test_host_settings_columns() -> None:
    with _migrated("hostpause01_settings") as engine:
        t = _tenant(engine)
        a = _agent(
            engine, t, owner_app='{"owner_grace_secs": 120, "helper_name": "Joshua"}'
        )
        for col, value in (
            ("keep_awake", None),
            ("keep_awake", "sometimes"),
            ("enforcement", None),
            ("enforcement", "shadow"),
            ("settings_version", None),
            ("settings_version", -1),
            ("windows_pools_allowed", None),
            ("owner_door", None),
            ("guest_name", ""),
            ("owner_app", '{"owner_grace_secs": 1801}'),
            ("owner_app", '{"owner_grace_secs": "120"}'),
            ("owner_app", '{"owner_grace_secs": 1.5}'),
            ("owner_app", '["not", "an", "object"]'),
        ):
            _refused(
                engine,
                f"UPDATE coord.ci_host_agents SET {col} = :v WHERE agent_id = :a",
                v=value,
                a=a,
            )
        # Windows pools are allowed only with the finding they rest on.
        _refused(
            engine,
            "UPDATE coord.ci_host_agents SET windows_pools_allowed = true WHERE agent_id = :a",
            a=a,
        )
        _exec(
            engine,
            "UPDATE coord.ci_host_agents SET windows_pools_allowed = true, "
            "windows_pools_finding = '1b378196', keep_awake = 'window', "
            "enforcement = 'observe' WHERE agent_id = :a",
            a=a,
        )
        _refused(
            engine,
            "INSERT INTO coord.ci_pool_specs (tenant_id, repo, labels, mem_gib, cores, "
            "max_slots, non_preemptible) VALUES (:t, 'o/r', ARRAY['x'], 1, 1, 1, NULL)",
            t=t,
        )


@_needs_pg
def test_device_link_is_tenant_bound_and_unbinding_clears_only_the_link() -> None:
    with _migrated("hostpause01_device") as engine:
        t1, t2 = _tenant(engine), _tenant(engine)
        d1 = _device(engine, t1)
        d2 = _device(engine, t2)
        a = _agent(engine, t1, device_id=d1)
        # A device bound to another tenant cannot be linked.
        _refused(
            engine,
            "UPDATE coord.ci_host_agents SET device_id = :d WHERE agent_id = :a",
            d=d2,
            a=a,
        )
        _exec(
            engine,
            "DELETE FROM coord.tenant_devices WHERE tenant_id = :t AND device_id = :d",
            t=t1,
            d=d1,
        )
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT tenant_id, device_id FROM coord.ci_host_agents WHERE agent_id = :a"
                ),
                {"a": a},
            ).one()
        assert tuple(row) == (t1, None)


@_needs_pg
def test_one_live_child_per_parent_and_one_unredeemed_child_code() -> None:
    with _migrated("hostpause01_child") as engine:
        t = _tenant(engine)
        parent = _agent(engine, t)
        _refused(
            engine,
            "UPDATE coord.ci_host_agents SET parent_agent_id = agent_id WHERE agent_id = :a",
            a=parent,
        )
        child = _agent(engine, t, parent_agent_id=parent)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _agent(engine, t, parent_agent_id=parent)
        _exec(
            engine,
            "UPDATE coord.ci_host_agents SET revoked_at = now() WHERE agent_id = :a",
            a=child,
        )
        _agent(engine, t, parent_agent_id=parent)  # a revoked child frees the slot

        code_sql = (
            "INSERT INTO coord.ci_enrol_codes (code_hash, tenant_id, issued_by, host, "
            "expires_at, parent_agent_id, enforcement) VALUES (:h, :t, 'agent', 'h', "
            "now() + interval '15 minutes', :p, :e)"
        )
        _exec(engine, code_sql, h="b" * 64, t=t, p=parent, e="observe")
        _refused(engine, code_sql, h="c" * 64, t=t, p=parent, e="observe")
        _exec(
            engine,
            "UPDATE coord.ci_enrol_codes SET redeemed_at = now() WHERE code_hash = :h",
            h="b" * 64,
        )
        _exec(engine, code_sql, h="d" * 64, t=t, p=parent, e="enforce")
        _refused(engine, code_sql, h="e" * 64, t=t, p=None, e=None)
        _refused(engine, code_sql, h="f" * 64, t=t, p=None, e="shadow")

        # Deleting the parent removes its children and its child codes.
        _exec(engine, "DELETE FROM coord.ci_host_agents WHERE agent_id = :a", a=parent)
        assert scalar(engine, "SELECT count(*) FROM coord.ci_host_agents") == 0
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.ci_enrol_codes WHERE parent_agent_id IS NOT NULL",
            )
            == 0
        )


@_needs_pg
def test_interrupted_jobs_identity_and_rerun_vocabulary() -> None:
    with _migrated("hostpause01_jobs") as engine:
        t = _tenant(engine)
        a = _agent(engine, t)
        pool = uuid.uuid4()
        _exec(
            engine,
            "INSERT INTO coord.ci_pool_specs (id, tenant_id, repo, labels, mem_gib, "
            "cores, max_slots) VALUES (:p, :t, 'qontinui/qontinui-coord', "
            "ARRAY['self-hosted'], 8, 4, 2)",
            p=pool,
            t=t,
        )
        lease = uuid.uuid4()
        _exec(
            engine,
            "INSERT INTO coord.ci_slot_leases (lease_id, tenant_id, agent_id, "
            "pool_spec_id, slot, runner_name, state, busy_started_at) VALUES "
            "(:l, :t, :a, :p, 0, 'h-p-0-abcd1234', 'busy', now())",
            l=lease,
            t=t,
            a=a,
            p=pool,
        )
        _refused(
            engine,
            "UPDATE coord.ci_slot_leases SET busy_ended_at = busy_started_at - "
            "interval '1 second' WHERE lease_id = :l",
            l=lease,
        )
        pause = _pause(engine, tenant_id=t, agent_id=a)
        job_sql = (
            "INSERT INTO coord.ci_interrupted_jobs (tenant_id, repo, run_id, job_id, "
            "run_attempt, agent_id, lease_id, pause_id, cause, interrupted_at, "
            "rerun_state, client_key) VALUES (:t, :repo, :run, :job, :att, :a, :l, "
            ":p, :c, now(), :st, :k)"
        )
        base: dict[str, object] = {
            "t": t,
            "repo": "qontinui/qontinui-coord",
            "run": None,
            "job": None,
            "att": None,
            "a": a,
            "l": lease,
            "p": pause,
            "c": "pause",
            "st": "pending",
            "k": None,
        }
        _exec(engine, job_sql, **base)  # an agent report, job not yet resolved
        for override in (
            {"l": None},  # neither a run nor a lease
            {"run": 1},  # the lease is already recorded (UNIQUE lease_id)
            {"l": None, "run": 2, "c": "window_close"},  # pause_id only for pause
            {"l": None, "p": None, "c": "legacy_migration"},  # legacy needs run_id
            {"l": None, "run": 3, "c": "job_timeout", "p": None},  # part 10a widens
            {"l": None, "run": 4, "st": "lost"},
            {"l": None, "run": 5, "repo": "no-slash"},
            {"l": None, "run": 6, "att": 0},
        ):
            _refused(engine, job_sql, **{**base, **override})
        legacy = {
            **base,
            "l": None,
            "p": None,
            "c": "legacy_migration",
            "run": 99,
            "k": "k1",
        }
        _exec(engine, job_sql, **legacy)
        _refused(engine, job_sql, **{**legacy, "run": 100})  # client_key per tenant
        resolved = {
            **base,
            "l": None,
            "run": 7,
            "job": 70,
            "att": 1,
            "c": "window_close",
            "p": None,
        }
        _exec(engine, job_sql, **resolved)
        _refused(engine, job_sql, **resolved)  # one row per (repo, job, attempt)

        # Ending the pause's retention keeps the re-run history.
        _exec(engine, "DELETE FROM coord.host_pauses WHERE id = :p", p=pause)
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.ci_interrupted_jobs WHERE cause = 'pause' "
                "AND pause_id IS NULL",
            )
            == 1
        )


@_needs_pg
def test_history_tables_bounds() -> None:
    with _migrated("hostpause01_history") as engine:
        t = _tenant(engine)
        a = _agent(engine, t)
        pause = _pause(
            engine,
            tenant_id=t,
            agent_id=a,
            actor_kind="owner",
            origin="local",
            local_id=uuid.uuid4(),
            until=None,
        )
        req_sql = (
            "INSERT INTO coord.host_pause_resume_requests (tenant_id, pause_id, "
            "requested_by_kind, answer, answered_at) VALUES (:t, :p, :k, :ans, :at)"
        )
        _exec(engine, req_sql, t=t, p=pause, k="operator", ans=None, at=None)
        _refused(
            engine, req_sql, t=t, p=pause, k="agent", ans=None, at=None
        )  # one open
        _refused(
            engine,
            req_sql,
            t=t,
            p=pause,
            k="owner",
            ans="yes",
            at="2026-10-08T00:00:00Z",
        )
        _refused(engine, req_sql, t=t, p=pause, k="agent", ans="yes", at=None)
        _exec(
            engine,
            req_sql,
            t=t,
            p=pause,
            k="agent",
            ans="not_now",
            at="2026-10-08T00:00:00Z",
        )

        _exec(
            engine,
            "INSERT INTO coord.host_owner_events (tenant_id, agent_id, kind, at) "
            "VALUES (:t, :a, 'nudge_shown', now())",
            t=t,
            a=a,
        )
        _refused(
            engine,
            "INSERT INTO coord.host_owner_events (tenant_id, agent_id, kind, at) "
            "VALUES (:t, :a, 'nudge_ignored', now())",
            t=t,
            a=a,
        )

        hours_sql = (
            "INSERT INTO coord.ci_host_agent_hours (agent_id, hour, tenant_id, "
            "online_secs, paused_secs) VALUES (:a, CAST(:h AS timestamptz), :t, :on, :pa)"
        )
        _exec(engine, hours_sql, a=a, h="2026-10-08T05:00:00Z", t=t, on=3600, pa=1200)
        _refused(engine, hours_sql, a=a, h="2026-10-08T05:00:00Z", t=t, on=1, pa=0)
        _refused(engine, hours_sql, a=a, h="2026-10-08T06:30:00Z", t=t, on=1, pa=0)
        _refused(engine, hours_sql, a=a, h="2026-10-08T07:00:00Z", t=t, on=3601, pa=0)

        legacy_sql = (
            "INSERT INTO coord.host_pause_legacy_events (tenant_id, agent_id, at, kind, "
            "by, raw, client_key) VALUES (:t, :a, now(), 'Pause', 'owner', "
            "CAST('{}' AS jsonb), :k)"
        )
        _exec(engine, legacy_sql, t=t, a=a, k="e1")
        _refused(engine, legacy_sql, t=t, a=a, k="e1")

        ver_sql = (
            "INSERT INTO coord.host_pauses_versions (pause_id, tenant_id, version, "
            "scopes, actor_kind, reason_code, started_at, until_idle, origin, imported) "
            "VALUES (:p, :t, 1, ARRAY['ci'], 'owner', 'other', now(), false, 'local', false)"
        )
        _exec(engine, ver_sql, p=pause, t=t)
        _refused(engine, ver_sql, p=pause, t=t)

        settings_sql = (
            "INSERT INTO coord.ci_host_agents_settings_versions (agent_id, tenant_id, "
            "settings_version, keep_awake, enforcement, windows_pools_allowed, "
            "updated_by, updated_at) VALUES (:a, :t, 1, 'off', 'observe', false, "
            "'operator', now())"
        )
        _exec(engine, settings_sql, a=a, t=t)
        _refused(engine, settings_sql, a=a, t=t)

        # Deleting the agent removes its history rows.
        _exec(engine, "DELETE FROM coord.ci_host_agents WHERE agent_id = :a", a=a)
        for table in (
            "host_pauses",
            "host_pauses_versions",
            "host_pause_resume_requests",
            "host_owner_events",
            "ci_host_agent_hours",
            "host_pause_legacy_events",
            "ci_host_agents_settings_versions",
        ):
            assert scalar(engine, f"SELECT count(*) FROM coord.{table}") == 0, table


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "hostpause01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", parent)
        for table in _NEW_TABLES:
            assert not table_exists(engine, _SCHEMA, table), table
        for table, added in _ADDED_COLUMNS.items():
            assert not (added & _columns(engine, table)), table
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM pg_indexes WHERE schemaname = 'coord' AND "
                "indexname IN ('uq_ci_host_agents_one_live_child', "
                "'uq_ci_enrol_codes_one_unredeemed_child')",
            )
            == 0
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _NEW_TABLES:
            assert table_exists(engine, _SCHEMA, table), table
        t = _tenant(engine)
        a = _agent(engine, t)
        _pause(engine, tenant_id=t, agent_id=a)
