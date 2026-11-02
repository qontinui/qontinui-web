"""Behaviour test for the ``recurring_agents_01`` revision.

Pins the contract coord's recurring-agent routes and drift watcher (plan
``2026-10-29-recurring-agents-declared-in-coord-reconciled-by-runner`` Phase 3)
and the runner's reconciler (Phase 4) rely on:

1. **Shape** — the four ``coord.*`` tables with their exact columns, every
   constraint and index by name; the six ``project.scheduled_tasks`` columns
   nullable and undefaulted, and the managed-key partial unique index with its
   exact predicate.
2. **Catalog rows hold overrides, custom rows are complete** — a catalog row
   may leave every override NULL (inherit) and may NOT carry a ``task_spec``;
   a custom row must carry ``task_spec``, ``schedule``, ``target``,
   ``catch_up_policy`` and ``enabled``.
3. **Every CHECK refuses** — each constraint is exercised by a refused write
   naming it.
4. **Keys** — one row per ``(tenant, name)``; one status row and one run
   request per ``(tenant, device, name)``, neither needing a
   ``coord.recurring_agents`` row; history outlives a deleted agent; at most
   one managed task per ``(source, tenant, agent)`` while unmanaged tasks are
   unconstrained.
5. **Status rows are never defaulted into existence** — ``reported_at`` has no
   default; a run request needs no status row.
6. **Re-running is harmless**, **downgrade refuses while a managed task
   exists**, and otherwise **reverses exactly this revision**
   (``project.scheduled_tasks`` and its prior columns survive).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable — a skip proves nothing.
"""

from __future__ import annotations

import inspect
import json
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import TextClause, text
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
)

_REVISION_ID = "recurring_agents_01"
_REVISION_FILENAME = "recurring_agents_01_coord_tables.py"


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_AGENTS = "recurring_agents"
_VERSIONS = "recurring_agent_versions"
_STATUS = "recurring_agent_device_status"
_REQUESTS = "recurring_agent_run_requests"
_TIMESTAMPTZ = "timestamp with time zone"

_EXPECTED_AGENT_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "name": ("text", "NO"),
    "catalog_ref": ("text", "YES"),
    "enabled": ("boolean", "YES"),
    "schedule": ("jsonb", "YES"),
    "timezone": ("text", "YES"),
    "catch_up_policy": ("text", "YES"),
    "params": ("jsonb", "NO"),
    "task_spec": ("jsonb", "YES"),
    "target": ("jsonb", "YES"),
    "version": ("integer", "NO"),
    "updated_by": ("text", "NO"),
    "created_at": (_TIMESTAMPTZ, "NO"),
    "updated_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_VERSION_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "recurring_agent_id": ("uuid", "NO"),
    "name": ("text", "NO"),
    "version": ("integer", "NO"),
    "snapshot": ("jsonb", "NO"),
    "updated_by": ("text", "NO"),
    "created_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_STATUS_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "NO"),
    "name": ("text", "NO"),
    "applied_digest": ("text", "YES"),
    "applied_version": ("integer", "YES"),
    "state": ("text", "NO"),
    "unapplied_reason": ("text", "YES"),
    "override": ("jsonb", "YES"),
    "last_run": ("jsonb", "YES"),
    "recent_runs": ("jsonb", "YES"),
    "last_completed_at": (_TIMESTAMPTZ, "YES"),
    "last_success_at": (_TIMESTAMPTZ, "YES"),
    "next_run": (_TIMESTAMPTZ, "YES"),
    "reported_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_REQUEST_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "NO"),
    "name": ("text", "NO"),
    "requested_at": (_TIMESTAMPTZ, "NO"),
    "requested_by": ("text", "NO"),
    "request_id": ("uuid", "NO"),
    "acknowledged_request_id": ("uuid", "YES"),
    "acknowledged_at": (_TIMESTAMPTZ, "YES"),
}

# Constraint name -> contype. Exact sets: a dropped, renamed or extra
# constraint fails here before any insert runs.
_EXPECTED_AGENT_CONSTRAINTS: dict[str, str] = {
    "recurring_agents_pkey": "p",
    "recurring_agents_tenant_id_fkey": "f",
    "uq_recurring_agents_tenant_name": "u",
    "ck_recurring_agents_name_nonempty": "c",
    "ck_recurring_agents_updated_by_nonempty": "c",
    "ck_recurring_agents_catalog_ref_nonempty": "c",
    "ck_recurring_agents_version_positive": "c",
    "ck_recurring_agents_catch_up_policy": "c",
    "ck_recurring_agents_schedule_object": "c",
    "ck_recurring_agents_params_object": "c",
    "ck_recurring_agents_task_spec_object": "c",
    "ck_recurring_agents_target_object": "c",
    "ck_recurring_agents_task_spec_only_custom": "c",
    "ck_recurring_agents_custom_is_complete": "c",
}

_EXPECTED_VERSION_CONSTRAINTS: dict[str, str] = {
    "recurring_agent_versions_pkey": "p",
    "recurring_agent_versions_tenant_id_fkey": "f",
    "uq_recurring_agent_versions_agent_version": "u",
    "ck_recurring_agent_versions_version_positive": "c",
    "ck_recurring_agent_versions_updated_by_nonempty": "c",
    "ck_recurring_agent_versions_snapshot_object": "c",
}

_EXPECTED_STATUS_CONSTRAINTS: dict[str, str] = {
    "recurring_agent_device_status_pkey": "p",
    "recurring_agent_device_status_tenant_id_fkey": "f",
    "ck_recurring_agent_device_status_state": "c",
    "ck_recurring_agent_device_status_reason_iff_unapplied": "c",
    "ck_recurring_agent_device_status_reason_nonempty": "c",
    "ck_recurring_agent_device_status_overridden_has_override": "c",
    "ck_recurring_agent_device_status_applied_digest_sha256": "c",
    "ck_recurring_agent_device_status_applied_version_positive": "c",
    "ck_recurring_agent_device_status_override_object": "c",
    "ck_recurring_agent_device_status_last_run_object": "c",
    "ck_recurring_agent_device_status_recent_runs_array": "c",
}

_EXPECTED_REQUEST_CONSTRAINTS: dict[str, str] = {
    "recurring_agent_run_requests_pkey": "p",
    "recurring_agent_run_requests_tenant_id_fkey": "f",
    "ck_recurring_agent_run_requests_requested_by_nonempty": "c",
}

_EXPECTED_AGENT_INDEXES: dict[str, str] = {
    "recurring_agents_pkey": (
        "CREATE UNIQUE INDEX recurring_agents_pkey ON coord.recurring_agents "
        "USING btree (id)"
    ),
    "uq_recurring_agents_tenant_name": (
        "CREATE UNIQUE INDEX uq_recurring_agents_tenant_name ON "
        "coord.recurring_agents USING btree (tenant_id, name)"
    ),
}

_EXPECTED_VERSION_INDEXES: dict[str, str] = {
    "recurring_agent_versions_pkey": (
        "CREATE UNIQUE INDEX recurring_agent_versions_pkey ON "
        "coord.recurring_agent_versions USING btree (id)"
    ),
    "uq_recurring_agent_versions_agent_version": (
        "CREATE UNIQUE INDEX uq_recurring_agent_versions_agent_version ON "
        "coord.recurring_agent_versions USING btree (recurring_agent_id, version)"
    ),
    "ix_recurring_agent_versions_tenant_name": (
        "CREATE INDEX ix_recurring_agent_versions_tenant_name ON "
        "coord.recurring_agent_versions USING btree (tenant_id, name, version DESC)"
    ),
}

_EXPECTED_STATUS_INDEXES: dict[str, str] = {
    "recurring_agent_device_status_pkey": (
        "CREATE UNIQUE INDEX recurring_agent_device_status_pkey ON "
        "coord.recurring_agent_device_status USING btree "
        "(tenant_id, device_id, name)"
    ),
    "ix_recurring_agent_device_status_tenant_name": (
        "CREATE INDEX ix_recurring_agent_device_status_tenant_name ON "
        "coord.recurring_agent_device_status USING btree (tenant_id, name)"
    ),
}

_EXPECTED_REQUEST_INDEXES: dict[str, str] = {
    "recurring_agent_run_requests_pkey": (
        "CREATE UNIQUE INDEX recurring_agent_run_requests_pkey ON "
        "coord.recurring_agent_run_requests USING btree "
        "(tenant_id, device_id, name)"
    ),
}

_MANAGED_KEY_INDEXDEF = (
    "CREATE UNIQUE INDEX uq_scheduled_tasks_managed_key ON project.scheduled_tasks "
    "USING btree (managed_source, managed_tenant_id, managed_agent) "
    "WHERE ((managed_source IS NOT NULL) AND (managed_tenant_id IS NOT NULL) "
    "AND (managed_agent IS NOT NULL))"
)

_EXPECTED_TASK_COLUMNS: dict[str, str] = {
    "managed_source": "text",
    "managed_tenant_id": "uuid",
    "managed_agent": "text",
    "managed_version": "integer",
    "managed_digest": "text",
    "timezone": "text",
}

# qontinui-schemas rust/src/scheduler.rs CatchUpPolicy, serde snake_case.
_CATCH_UP_POLICIES = ("run", "skip", "run_once")
_DEVICE_STATES = ("applied", "paused", "overridden", "unapplied", "refused")

_TENANT = uuid.UUID("5d1c8e27-3a90-4f6b-b2e4-7c08a1f9d362")
_OTHER_TENANT = uuid.UUID("e2a47b90-61cd-4e38-9f15-3b7d0c84a5e1")
_DEVICE = uuid.UUID("9a3f6c12-8e45-4d70-b1a9-2c5e7f08d4b3")
_NEVER_REPORTED_DEVICE = uuid.UUID("4c7e2b19-d083-4f5a-a6e1-8b90f3c25d74")
_DIGEST = "a" * 64
_REPORTED_AT = "2026-10-29T10:00:00+00:00"


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_revision_names_the_vocabularies_its_sql_enforces() -> None:
    module = load_revision_module(_revision_path(), "_recurring_agents_01_under_test")
    assert tuple(module._CATCH_UP_POLICIES) == _CATCH_UP_POLICIES
    assert tuple(module._DEVICE_STATES) == _DEVICE_STATES
    assert {name: ddl.lower() for name, ddl in module._SCHEDULED_TASK_COLUMNS} == (
        _EXPECTED_TASK_COLUMNS
    )
    source = _revision_source()
    policy_list = ", ".join(f"'{p}'" for p in _CATCH_UP_POLICIES)
    assert f"catch_up_policy IN ({policy_list})" in source
    states = re.sub(
        r"\s+", " ", source.split("ck_recurring_agent_device_status_state")[1]
    )
    state_list = ", ".join(f"'{s}'" for s in _DEVICE_STATES)
    assert f"CHECK (state IN ({state_list}))" in states


def test_the_revision_follows_the_lock_timeout_convention() -> None:
    module = load_revision_module(_revision_path(), "_recurring_agents_01_lock")
    upgrade = inspect.getsource(module.upgrade)
    assert "SET LOCAL lock_timeout = '3s'" in upgrade
    assert upgrade.index("lock_timeout = DEFAULT") < upgrade.index(
        "autocommit_block"
    ), "lock_timeout must be reset before the autocommit block"

    # downgrade: ONE transaction — no autocommit block, and the lock, the
    # refusing check and the drops in that order.
    downgrade = inspect.getsource(module.downgrade)
    assert "autocommit_block" not in downgrade
    assert "CONCURRENTLY" not in downgrade
    order = [
        downgrade.index("SET LOCAL lock_timeout = '3s'"),
        downgrade.index("LOCK TABLE project.scheduled_tasks IN ACCESS EXCLUSIVE MODE"),
        downgrade.index("RAISE EXCEPTION"),
        downgrade.index("DROP INDEX IF EXISTS project.uq_scheduled_tasks_managed_key"),
        downgrade.index("DROP COLUMN IF EXISTS managed_source"),
        downgrade.index('DROP TABLE IF EXISTS coord.recurring_agents"'),
        downgrade.index("SET LOCAL lock_timeout = DEFAULT"),
    ]
    assert order == sorted(order), "downgrade statements are out of order"


# ---------------------------------------------------------------------------
# Live-schema walk.
# ---------------------------------------------------------------------------


def _columns(engine: Engine, schema: str, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": schema, "table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _column_default(engine: Engine, table: str, column: str) -> str | None:
    with engine.connect() as conn:
        value = conn.execute(
            text(
                """
                SELECT column_default FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :t
                   AND column_name = :c
                """
            ),
            {"t": table, "c": column},
        ).scalar_one()
    return None if value is None else str(value)


def _constraints(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                   AND contype <> 'n'
                """
            ),
            {"table": table},
        ).all()
    return {str(name): str(contype) for name, contype in rows}


def _indexes(engine: Engine, schema: str, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = :schema AND tablename = :table
                """
            ),
            {"schema": schema, "table": table},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _task_columns(engine: Engine) -> dict[str, tuple[str, str, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'project' AND table_name = 'scheduled_tasks'
                """
            )
        ).all()
    return {r[0]: (r[1], r[2], r[3]) for r in rows}


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine, "coord", _AGENTS) == _EXPECTED_AGENT_COLUMNS
    assert _columns(engine, "coord", _VERSIONS) == _EXPECTED_VERSION_COLUMNS
    assert _columns(engine, "coord", _STATUS) == _EXPECTED_STATUS_COLUMNS
    assert _columns(engine, "coord", _REQUESTS) == _EXPECTED_REQUEST_COLUMNS
    assert _constraints(engine, _AGENTS) == _EXPECTED_AGENT_CONSTRAINTS
    assert _constraints(engine, _VERSIONS) == _EXPECTED_VERSION_CONSTRAINTS
    assert _constraints(engine, _STATUS) == _EXPECTED_STATUS_CONSTRAINTS
    assert _constraints(engine, _REQUESTS) == _EXPECTED_REQUEST_CONSTRAINTS
    assert _indexes(engine, "coord", _AGENTS) == _EXPECTED_AGENT_INDEXES
    assert _indexes(engine, "coord", _VERSIONS) == _EXPECTED_VERSION_INDEXES
    assert _indexes(engine, "coord", _STATUS) == _EXPECTED_STATUS_INDEXES
    assert _indexes(engine, "coord", _REQUESTS) == _EXPECTED_REQUEST_INDEXES
    assert _column_default(engine, _STATUS, "reported_at") is None, (
        "reported_at must be supplied by the device, never defaulted"
    )
    task_cols = _task_columns(engine)
    for name, dtype in _EXPECTED_TASK_COLUMNS.items():
        assert name in task_cols, f"project.scheduled_tasks is missing {name}"
        assert task_cols[name] == (dtype, "YES", None), (
            f"project.scheduled_tasks.{name} is {task_cols[name]}, expected "
            f"nullable undefaulted {dtype}"
        )
    task_indexes = _indexes(engine, "project", "scheduled_tasks")
    assert task_indexes.get("uq_scheduled_tasks_managed_key") == _MANAGED_KEY_INDEXDEF
    with engine.connect() as conn:
        valid = conn.execute(
            text(
                "SELECT indisvalid FROM pg_index "
                "WHERE indexrelid = to_regclass('project.uq_scheduled_tasks_managed_key')"
            )
        ).scalar_one()
    assert valid is True


def _assert_absent(engine: Engine) -> None:
    for table in (_AGENTS, _VERSIONS, _STATUS, _REQUESTS):
        assert not table_exists(engine, "coord", table), f"coord.{table} is present"
    task_cols = _task_columns(engine)
    assert task_cols, "project.scheduled_tasks itself is gone"
    for name in _EXPECTED_TASK_COLUMNS:
        assert name not in task_cols, f"project.scheduled_tasks.{name} is present"
    assert "conditions" in task_cols, "sched_cond_01's column was removed"
    assert "uq_scheduled_tasks_managed_key" not in _indexes(
        engine, "project", "scheduled_tasks"
    )


def _exec(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(
    engine: Engine,
    statement: TextClause,
    params: dict[str, object],
    constraint: str,
) -> None:
    """The write is refused, and by the named constraint, not by another one."""
    with pytest.raises(IntegrityError) as refusal:
        _exec(engine, statement, params)
    refused_by = getattr(
        getattr(refusal.value.orig, "diag", None), "constraint_name", None
    )
    assert refused_by == constraint, (
        f"refused by {refused_by!r}, expected {constraint!r}"
    )


_INSERT_AGENT = text(
    """
    INSERT INTO coord.recurring_agents
        (tenant_id, name, catalog_ref, enabled, schedule, timezone,
         catch_up_policy, params, task_spec, target, version, updated_by)
    VALUES (:tid, :name, :catalog_ref, :enabled, CAST(:schedule AS jsonb),
            :timezone, :catch_up_policy, CAST(:params AS jsonb),
            CAST(:task_spec AS jsonb), CAST(:target AS jsonb), :version,
            :updated_by)
    """
)

_INSERT_STATUS = text(
    """
    INSERT INTO coord.recurring_agent_device_status
        (tenant_id, device_id, name, applied_digest, applied_version, state,
         unapplied_reason, override, last_run, recent_runs, last_completed_at,
         last_success_at, reported_at)
    VALUES (:tid, :device, :name, :digest, :applied_version, :state, :reason,
            CAST(:override AS jsonb), CAST(:last_run AS jsonb),
            CAST(:recent_runs AS jsonb), :completed, :success, :reported_at)
    """
)

_INSERT_REQUEST = text(
    """
    INSERT INTO coord.recurring_agent_run_requests
        (tenant_id, device_id, name, requested_by)
    VALUES (:tid, :device, :name, :by)
    """
)

_INSERT_TASK = text(
    """
    INSERT INTO project.scheduled_tasks
        (id, name, managed_source, managed_tenant_id, managed_agent,
         managed_version, managed_digest, timezone)
    VALUES (:id, :name, :source, :tid, :agent, :version, :digest, :tz)
    """
)

_CRON = json.dumps({"type": "Cron", "value": "0 3 * * *"})
_ALL = json.dumps({"kind": "all"})
_REMOTE_AGENT = json.dumps({"type": "RemoteAgent", "prompt": "hello"})


def _agent(**overrides: object) -> dict[str, object]:
    """A catalog override row that changes nothing (every override NULL)."""
    params: dict[str, object] = {
        "tid": _TENANT,
        "name": "cleanup-steward",
        "catalog_ref": "cleanup-steward",
        "enabled": None,
        "schedule": None,
        "timezone": None,
        "catch_up_policy": None,
        "params": "{}",
        "task_spec": None,
        "target": None,
        "version": 1,
        "updated_by": "user:test",
    }
    params.update(overrides)
    return params


def _custom(**overrides: object) -> dict[str, object]:
    fields: dict[str, object] = {
        "name": "my-custom",
        "catalog_ref": None,
        "enabled": True,
        "schedule": _CRON,
        "target": _ALL,
        "catch_up_policy": "run_once",
        "task_spec": _REMOTE_AGENT,
    }
    fields.update(overrides)
    return _agent(**fields)


def _status(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "name": "cleanup-steward",
        "digest": _DIGEST,
        "applied_version": 1,
        "state": "applied",
        "reason": None,
        "override": None,
        "last_run": None,
        "recent_runs": None,
        "completed": None,
        "success": None,
        "reported_at": _REPORTED_AT,
    }
    params.update(overrides)
    return params


def _task(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "name": "task",
        "source": "coord",
        "tid": _TENANT,
        "agent": "cleanup-steward",
        "version": 1,
        "digest": _DIGEST,
        "tz": "Europe/Berlin",
    }
    params.update(overrides)
    return params


_UNMANAGED = {
    "source": None,
    "tid": None,
    "agent": None,
    "version": None,
    "digest": None,
    "tz": None,
}


def _seed_tenants(engine: Engine) -> None:
    with engine.begin() as conn:
        for tenant, label in ((_TENANT, "a"), (_OTHER_TENANT, "b")):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:t, :slug, :label)
                    """
                ),
                {"t": tenant, "slug": f"ra01-{label}-{tenant.hex[:8]}", "label": label},
            )


def _count(engine: Engine, sql: str) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text(sql)).scalar_one())


def _exercise_agents(engine: Engine) -> None:
    # A catalog row may override nothing: every override NULL, params
    # defaults to {}, version to 1.
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.recurring_agents
                    (tenant_id, name, catalog_ref, updated_by)
                VALUES (:tid, 'strategic-pulse', 'strategic-pulse', 'user:test')
                """
            ),
            {"tid": _TENANT},
        )
        row = conn.execute(
            text(
                """
                SELECT enabled, schedule, timezone, catch_up_policy, params,
                       task_spec, target, version,
                       created_at = now(), updated_at = now()
                  FROM coord.recurring_agents WHERE name = 'strategic-pulse'
                """
            )
        ).one()
    assert tuple(row) == (None, None, None, None, {}, None, None, 1, True, True)

    # Catalog rows never carry a task body; custom rows must, and be complete.
    _exec(engine, _INSERT_AGENT, _agent())
    _refused(
        engine,
        _INSERT_AGENT,
        _agent(name="x", task_spec=_REMOTE_AGENT),
        "ck_recurring_agents_task_spec_only_custom",
    )
    _refused(
        engine,
        _INSERT_AGENT,
        _custom(task_spec=None),
        "ck_recurring_agents_task_spec_only_custom",
    )
    for missing in ("enabled", "schedule", "target", "catch_up_policy"):
        _refused(
            engine,
            _INSERT_AGENT,
            _custom(**{missing: None}),
            "ck_recurring_agents_custom_is_complete",
        )
    # A custom row's timezone stays optional (NULL = the device's zone).
    _exec(engine, _INSERT_AGENT, _custom(timezone=None))

    # One row per (tenant, name); another tenant may reuse the name.
    _refused(engine, _INSERT_AGENT, _agent(), "uq_recurring_agents_tenant_name")
    _exec(engine, _INSERT_AGENT, _agent(tid=_OTHER_TENANT))

    # catch_up_policy is exactly CatchUpPolicy's serialization.
    for i, policy in enumerate(_CATCH_UP_POLICIES):
        _exec(engine, _INSERT_AGENT, _agent(name=f"cu-{i}", catch_up_policy=policy))

    # Every remaining CHECK refuses.
    for name, overrides, constraint in (
        (
            "cu-bad",
            {"catch_up_policy": "RunOnce"},
            "ck_recurring_agents_catch_up_policy",
        ),
        ("sch", {"schedule": '"0 3 * * *"'}, "ck_recurring_agents_schedule_object"),
        ("tgt", {"target": "[]"}, "ck_recurring_agents_target_object"),
        ("prm", {"params": "[]"}, "ck_recurring_agents_params_object"),
        ("", {}, "ck_recurring_agents_name_nonempty"),
        ("cr", {"catalog_ref": ""}, "ck_recurring_agents_catalog_ref_nonempty"),
        ("ver", {"version": 0}, "ck_recurring_agents_version_positive"),
        ("upd", {"updated_by": ""}, "ck_recurring_agents_updated_by_nonempty"),
    ):
        _refused(engine, _INSERT_AGENT, _agent(name=name, **overrides), constraint)
    _refused(
        engine,
        _INSERT_AGENT,
        _custom(name="ts", task_spec='"RemoteAgent"'),
        "ck_recurring_agents_task_spec_object",
    )


def _exercise_versions(engine: Engine) -> None:
    with engine.begin() as conn:
        agent_id = conn.execute(
            text(
                "SELECT id FROM coord.recurring_agents "
                "WHERE tenant_id = :t AND name = 'my-custom'"
            ),
            {"t": _TENANT},
        ).scalar_one()
    insert_version = text(
        """
        INSERT INTO coord.recurring_agent_versions
            (tenant_id, recurring_agent_id, name, version, snapshot, updated_by)
        VALUES (:tid, :aid, 'my-custom', :v, CAST(:snap AS jsonb), :by)
        """
    )

    def version(v: int, snap: str = "{}", by: str = "user:test") -> dict[str, object]:
        return {"tid": _TENANT, "aid": agent_id, "v": v, "snap": snap, "by": by}

    _exec(engine, insert_version, version(1))
    _refused(
        engine,
        insert_version,
        version(1),
        "uq_recurring_agent_versions_agent_version",
    )
    _refused(
        engine,
        insert_version,
        version(2, "[]"),
        "ck_recurring_agent_versions_snapshot_object",
    )
    _refused(
        engine,
        insert_version,
        version(0),
        "ck_recurring_agent_versions_version_positive",
    )
    _refused(
        engine,
        insert_version,
        version(3, by=""),
        "ck_recurring_agent_versions_updated_by_nonempty",
    )
    # History outlives the agent.
    _exec(
        engine,
        text("DELETE FROM coord.recurring_agents WHERE id = :id"),
        {"id": agent_id},
    )
    assert _count(engine, "SELECT count(*) FROM coord.recurring_agent_versions") == 1


def _exercise_status(engine: Engine) -> None:
    # No recurring_agents row needed (a catalog agent with no tenant row).
    _exec(engine, _INSERT_STATUS, _status(name="return-to-main"))
    _refused(
        engine,
        _INSERT_STATUS,
        _status(name="return-to-main"),
        "recurring_agent_device_status_pkey",
    )
    # Every state, each with what it requires.
    for state in _DEVICE_STATES:
        reason = "workspace_root_unset" if state in ("unapplied", "refused") else None
        override = '{"prompt": "local"}' if state == "overridden" else None
        _exec(
            engine,
            _INSERT_STATUS,
            _status(name=f"s-{state}", state=state, reason=reason, override=override),
        )
    # A paused task may also carry an override; typed run instants accepted.
    _exec(
        engine,
        _INSERT_STATUS,
        _status(
            name="s-paused-overridden",
            state="paused",
            override="{}",
            last_run='{"status": "completed"}',
            recent_runs="[]",
            completed=_REPORTED_AT,
            success=_REPORTED_AT,
        ),
    )
    # A device that has applied nothing.
    _exec(
        engine,
        _INSERT_STATUS,
        _status(
            name="s-none",
            digest=None,
            applied_version=None,
            state="unapplied",
            reason="refused_command",
        ),
    )
    # reported_at has no default: the device must supply it.
    with pytest.raises(IntegrityError):
        _exec(
            engine,
            text(
                """
                INSERT INTO coord.recurring_agent_device_status
                    (tenant_id, device_id, name, state)
                VALUES (:tid, :device, 's-noreport', 'applied')
                """
            ),
            {"tid": _TENANT, "device": _DEVICE},
        )
    for name, overrides, constraint in (
        ("s-bad", {"state": "healthy"}, "ck_recurring_agent_device_status_state"),
        (
            "s-nr",
            {"state": "unapplied"},
            "ck_recurring_agent_device_status_reason_iff_unapplied",
        ),
        (
            "s-xr",
            {"state": "applied", "reason": "stray"},
            "ck_recurring_agent_device_status_reason_iff_unapplied",
        ),
        (
            "s-er",
            {"state": "refused", "reason": ""},
            "ck_recurring_agent_device_status_reason_nonempty",
        ),
        (
            "s-ov",
            {"state": "overridden"},
            "ck_recurring_agent_device_status_overridden_has_override",
        ),
        (
            "s-dg",
            {"digest": "A" * 64},
            "ck_recurring_agent_device_status_applied_digest_sha256",
        ),
        (
            "s-dl",
            {"digest": "a" * 63},
            "ck_recurring_agent_device_status_applied_digest_sha256",
        ),
        (
            "s-av",
            {"applied_version": 0},
            "ck_recurring_agent_device_status_applied_version_positive",
        ),
        (
            "s-oo",
            {"override": "[]"},
            "ck_recurring_agent_device_status_override_object",
        ),
        (
            "s-lr",
            {"last_run": "[]"},
            "ck_recurring_agent_device_status_last_run_object",
        ),
        (
            "s-rr",
            {"recent_runs": "{}"},
            "ck_recurring_agent_device_status_recent_runs_array",
        ),
    ):
        _refused(engine, _INSERT_STATUS, _status(name=name, **overrides), constraint)


def _exercise_run_requests(engine: Engine) -> None:
    # A device that never reported can be asked; no status row is needed.
    request = {
        "tid": _TENANT,
        "device": _NEVER_REPORTED_DEVICE,
        "name": "cleanup-steward",
        "by": "user:operator",
    }
    _exec(engine, _INSERT_REQUEST, request)
    assert (
        _count(
            engine,
            "SELECT count(*) FROM coord.recurring_agent_device_status "
            f"WHERE device_id = '{_NEVER_REPORTED_DEVICE}'",
        )
        == 0
    )
    assert _pending(engine) == (True, True, None), (
        "a fresh request must carry a generated request_id and be pending"
    )
    _refused(engine, _INSERT_REQUEST, request, "recurring_agent_run_requests_pkey")
    _refused(
        engine,
        _INSERT_REQUEST,
        {**request, "name": "other", "by": ""},
        "ck_recurring_agent_run_requests_requested_by_nonempty",
    )
    # The runner acknowledges by echoing the id it ran: no longer pending.
    _exec(
        engine,
        text(
            "UPDATE coord.recurring_agent_run_requests "
            "SET acknowledged_request_id = request_id, acknowledged_at = now() "
            "WHERE device_id = :d"
        ),
        {"d": _NEVER_REPORTED_DEVICE},
    )
    assert _pending(engine)[0] is False
    # A second press: coord regenerates request_id; pending again, whatever
    # the timestamps say.
    _exec(
        engine,
        text(
            "UPDATE coord.recurring_agent_run_requests "
            "SET request_id = gen_random_uuid(), requested_at = acknowledged_at "
            "WHERE device_id = :d"
        ),
        {"d": _NEVER_REPORTED_DEVICE},
    )
    assert _pending(engine)[0] is True


def _pending(engine: Engine) -> tuple[bool, bool, object]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT acknowledged_request_id IS DISTINCT FROM request_id,
                       request_id IS NOT NULL, acknowledged_at
                  FROM coord.recurring_agent_run_requests WHERE device_id = :d
                """
            ),
            {"d": _NEVER_REPORTED_DEVICE},
        ).one()
    return (bool(row[0]), bool(row[1]), row[2])


def _exercise_tenant_fks(engine: Engine) -> None:
    """Every table with the tenant FK refuses a tenant coord.tenants lacks."""
    unknown = uuid.UUID("0f9e8d7c-6b5a-4938-a7b6-c5d4e3f2a1b0")
    _refused(
        engine,
        _INSERT_AGENT,
        _agent(tid=unknown, name="fk"),
        "recurring_agents_tenant_id_fkey",
    )
    _refused(
        engine,
        text(
            """
            INSERT INTO coord.recurring_agent_versions
                (tenant_id, recurring_agent_id, name, version, snapshot, updated_by)
            VALUES (:tid, gen_random_uuid(), 'fk', 1, '{}'::jsonb, 'user:test')
            """
        ),
        {"tid": unknown},
        "recurring_agent_versions_tenant_id_fkey",
    )
    _refused(
        engine,
        _INSERT_STATUS,
        _status(tid=unknown, name="fk"),
        "recurring_agent_device_status_tenant_id_fkey",
    )
    _refused(
        engine,
        _INSERT_REQUEST,
        {"tid": unknown, "device": _DEVICE, "name": "fk", "by": "user:operator"},
        "recurring_agent_run_requests_tenant_id_fkey",
    )


def _exercise_managed_key(engine: Engine) -> None:
    _exec(engine, _INSERT_TASK, _task())
    _refused(engine, _INSERT_TASK, _task(), "uq_scheduled_tasks_managed_key")
    _exec(engine, _INSERT_TASK, _task(tid=_OTHER_TENANT))
    for _ in range(2):
        _exec(engine, _INSERT_TASK, _task(**_UNMANAGED))
    # The runner's upsert: ON CONFLICT with the identical predicate infers the
    # partial index as arbiter.
    _exec(
        engine,
        text(
            """
            INSERT INTO project.scheduled_tasks
                (id, name, managed_source, managed_tenant_id, managed_agent,
                 managed_version, managed_digest)
            VALUES (:id, 'task', 'coord', :tid, 'cleanup-steward', 2, :digest)
            ON CONFLICT (managed_source, managed_tenant_id, managed_agent)
                WHERE managed_source IS NOT NULL
                  AND managed_tenant_id IS NOT NULL
                  AND managed_agent IS NOT NULL
            DO UPDATE SET managed_version = EXCLUDED.managed_version,
                          managed_digest = EXCLUDED.managed_digest
            """
        ),
        {"id": str(uuid.uuid4()), "tid": _TENANT, "digest": "b" * 64},
    )
    assert (
        _count(
            engine,
            "SELECT count(*) FROM project.scheduled_tasks "
            "WHERE managed_source = 'coord' AND managed_version = 2",
        )
        == 1
    )


def _row_counts(engine: Engine) -> tuple[int, ...]:
    return tuple(
        _count(engine, f"SELECT count(*) FROM {table}")
        for table in (
            "coord.recurring_agents",
            "coord.recurring_agent_versions",
            "coord.recurring_agent_device_status",
            "coord.recurring_agent_run_requests",
            "project.scheduled_tasks",
        )
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_recurring_agents_01_creates_the_tables_and_enforces_their_contract() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "recagents01_test") as (engine, url):
        # Parent — nothing of this revision exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # Apply — exact shape.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        _seed_tenants(engine)

        _exercise_agents(engine)
        _exercise_versions(engine)
        _exercise_status(engine)
        _exercise_run_requests(engine)
        _exercise_tenant_fks(engine)
        _exercise_managed_key(engine)

        # Re-running is harmless with rows present.
        before = _row_counts(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _row_counts(engine) == before

        # Downgrade REFUSES while a managed task exists, and changes nothing.
        proc = run_alembic(
            root, url, "downgrade", _PARENT_REVISION_ID, expect_success=False
        )
        assert "coord-managed task" in (proc.stdout + proc.stderr)
        _assert_shape(engine)
        assert _row_counts(engine) == before

        # Unmanage them; now downgrade reverses exactly this revision.
        _exec(
            engine,
            text(
                "UPDATE project.scheduled_tasks SET managed_source = NULL "
                "WHERE managed_source IS NOT NULL"
            ),
            {},
        )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        assert _count(engine, "SELECT count(*) FROM project.scheduled_tasks") == 4

        # And applies again cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
