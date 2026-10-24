"""Behaviour test for the ``spawnledger_01_spawn_requests`` revision.

Pins the contract coord's spawn-ledger writers and ``GET /coord/spawns`` reads
(plan ``2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration``
Phase 2) rely on:

1. **Shape** — both tables, their exact column contracts, the identity column,
   every constraint by name and definition, and every index by its exact
   definition; all gone after downgrade.
2. **The vocabularies are enforced** — each named CHECK's value set is read
   back from the catalog and compared exactly, an unknown value is refused, and
   every listed value is accepted.
3. **Defaults are honest** — ``state`` ``queued``, ``attempts`` /
   ``deferrals`` 0, ``history_complete`` true, ``detail`` ``{}``, the three
   timestamps ``now()``, timing and placement columns NULL until written.
4. **Counters never go negative** — ``attempts`` / ``deferrals`` below 0 are
   refused.
5. **One row per addressable source** — the partial unique index refuses a
   second ``(tenant_id, class, source_ref)`` and does NOT constrain rows whose
   ``source_ref`` is NULL.
6. **Events belong to their request, and to its tenant** — an event for an
   unknown request is refused, an event whose tenant differs from its
   request's is refused, and deleting a request cascades to its events.
7. **Re-running is harmless** — with rows present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing (every statement is ``IF NOT EXISTS``).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

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
    run_alembic,
    table_exists,
)

_REVISION_ID = "spawnledger_01_spawn_requests"
_REVISION_FILENAME = "spawnledger_01_spawn_requests.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_REQUESTS = "spawn_requests"
_EVENTS = "spawn_request_events"

_TIMESTAMPTZ = "timestamp with time zone"

# The column contracts shared with coord: name -> (data_type, nullable).
_EXPECTED_REQUEST_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "class": ("text", "NO"),
    "origin": ("text", "NO"),
    "source_ref": ("text", "YES"),
    "requested_at": (_TIMESTAMPTZ, "NO"),
    "first_dispatched_at": (_TIMESTAMPTZ, "YES"),
    "spawned_at": (_TIMESTAMPTZ, "YES"),
    "updated_at": (_TIMESTAMPTZ, "NO"),
    "pinned_device_id": ("uuid", "YES"),
    "preferred_device_id": ("uuid", "YES"),
    "current_device_id": ("uuid", "YES"),
    "spawned_device_id": ("uuid", "YES"),
    "lease_id": ("uuid", "YES"),
    "placement_basis": ("text", "YES"),
    "state": ("text", "NO"),
    "attempts": ("integer", "NO"),
    "deferrals": ("integer", "NO"),
    "claude_code_session_id": ("text", "YES"),
    "claude_account": ("text", "YES"),
    "session_outcome": ("text", "YES"),
    "session_outcome_at": (_TIMESTAMPTZ, "YES"),
    "terminal_reason": ("text", "YES"),
    "history_complete": ("boolean", "NO"),
}

_EXPECTED_EVENT_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("bigint", "NO"),
    "request_id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "at": (_TIMESTAMPTZ, "NO"),
    "kind": ("text", "NO"),
    "device_id": ("uuid", "YES"),
    "reason": ("text", "YES"),
    "detail": ("jsonb", "NO"),
}

# The vocabularies, each the ONE list its CHECK must hold, in the same order.
_CLASSES = ("autofix", "continuation", "local", "attended")
_ORIGINS = (
    "gate_continuation",
    "unit_continuation",
    "coord_dispatch",
    "looping_agent",
    "steward",
    "respawn",
    "scheduler",
    "orchestration",
    "boot_resume",
    "operator_terminal",
    "operator_chat",
    "unknown",
)
_PLACEMENT_BASES = (
    "admitted",
    "unknown_capacity_runner_guard",
    "pinned",
    "preference_released",
    "attended",
)
_STATES = (
    "queued",
    "dispatched",
    "deferred",
    "spawned",
    "failed",
    "expired",
    "cancelled",
    "superseded",
)
_OPEN_STATES = _STATES[:3]
_SESSION_OUTCOMES = ("working", "finished", "closed_unfinished", "unknown")
_EVENT_KINDS = (
    "requested",
    "placed",
    "dispatched",
    "deferred",
    "refused",
    "rerouted",
    "consumed",
    "spawned",
    "spawn_failed",
    "expired",
    "cancelled",
    "outcome",
)


def _text_array(values: tuple[str, ...]) -> str:
    """How ``pg_get_constraintdef`` / ``indexdef`` render an ``IN (...)`` list."""
    return "ARRAY[" + ", ".join(f"'{value}'::text" for value in values) + "]"


def _in_check(column: str, values: tuple[str, ...]) -> str:
    return f"CHECK (({column} = ANY ({_text_array(values)})))"


# Every constraint, by name: (contype, pg_get_constraintdef). Exact, so a
# widened vocabulary, a renamed constraint, a dropped one or an extra one all
# fail here before any insert runs.
_EXPECTED_REQUEST_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "spawn_requests_pkey": ("p", "PRIMARY KEY (id)"),
    "uq_spawn_requests_id_tenant": ("u", "UNIQUE (id, tenant_id)"),
    "ck_spawn_requests_attempts_nonneg": ("c", "CHECK ((attempts >= 0))"),
    "ck_spawn_requests_deferrals_nonneg": ("c", "CHECK ((deferrals >= 0))"),
    "ck_spawn_requests_class": ("c", _in_check("class", _CLASSES)),
    "ck_spawn_requests_origin": ("c", _in_check("origin", _ORIGINS)),
    "ck_spawn_requests_placement_basis": (
        "c",
        _in_check("placement_basis", _PLACEMENT_BASES),
    ),
    "ck_spawn_requests_state": ("c", _in_check("state", _STATES)),
    "ck_spawn_requests_session_outcome": (
        "c",
        _in_check("session_outcome", _SESSION_OUTCOMES),
    ),
}

_EXPECTED_EVENT_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "spawn_request_events_pkey": ("p", "PRIMARY KEY (id)"),
    "fk_spawn_request_events_request": (
        "f",
        "FOREIGN KEY (request_id, tenant_id) "
        "REFERENCES coord.spawn_requests(id, tenant_id) ON DELETE CASCADE",
    ),
    "ck_spawn_request_events_kind": ("c", _in_check("kind", _EVENT_KINDS)),
}

# Every index on each table, by name, with its exact ``pg_indexes.indexdef``.
_EXPECTED_REQUEST_INDEXES: dict[str, str] = {
    "spawn_requests_pkey": (
        "CREATE UNIQUE INDEX spawn_requests_pkey "
        "ON coord.spawn_requests USING btree (id)"
    ),
    "uq_spawn_requests_id_tenant": (
        "CREATE UNIQUE INDEX uq_spawn_requests_id_tenant "
        "ON coord.spawn_requests USING btree (id, tenant_id)"
    ),
    "uq_spawn_requests_source": (
        "CREATE UNIQUE INDEX uq_spawn_requests_source "
        "ON coord.spawn_requests USING btree (tenant_id, class, source_ref) "
        "WHERE (source_ref IS NOT NULL)"
    ),
    "ix_spawn_requests_tenant_requested": (
        "CREATE INDEX ix_spawn_requests_tenant_requested "
        "ON coord.spawn_requests USING btree (tenant_id, requested_at DESC)"
    ),
    "ix_spawn_requests_open_state": (
        "CREATE INDEX ix_spawn_requests_open_state "
        "ON coord.spawn_requests USING btree (state) "
        f"WHERE (state = ANY ({_text_array(_OPEN_STATES)}))"
    ),
    "ix_spawn_requests_device": (
        "CREATE INDEX ix_spawn_requests_device "
        "ON coord.spawn_requests USING btree "
        "(tenant_id, spawned_device_id, requested_at)"
    ),
}

_EXPECTED_EVENT_INDEXES: dict[str, str] = {
    "spawn_request_events_pkey": (
        "CREATE UNIQUE INDEX spawn_request_events_pkey "
        "ON coord.spawn_request_events USING btree (id)"
    ),
    "ix_spawn_request_events_request_at": (
        "CREATE INDEX ix_spawn_request_events_request_at "
        "ON coord.spawn_request_events USING btree (request_id, at)"
    ),
}

_TENANT = uuid.UUID("5e1d7a93-2c48-4b06-9f3a-71d8e2b4c650")
_OTHER_TENANT = uuid.UUID("a07c3e5f-8d21-4e9b-b6f4-2c9a1d58e731")

_INSERT_REQUEST = text(
    """
    INSERT INTO coord.spawn_requests
        (id, tenant_id, class, origin, source_ref, state, placement_basis,
         session_outcome, attempts, deferrals)
    VALUES (:id, :tid, :class, :origin, :source_ref, :state, :placement_basis,
            :session_outcome, :attempts, :deferrals)
    """
)

_INSERT_EVENT = text(
    """
    INSERT INTO coord.spawn_request_events (request_id, tenant_id, kind)
    VALUES (:rid, :tid, :kind)
    """
)


def _request(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "id": uuid.uuid4(),
        "tid": _TENANT,
        "class": "continuation",
        "origin": "gate_continuation",
        "source_ref": None,
        "state": "queued",
        "placement_basis": None,
        "session_outcome": None,
        "attempts": 0,
        "deferrals": 0,
    }
    params.update(overrides)
    return params


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _constraints(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                   -- NOT NULL is pinned by ``_columns``.
                   AND contype <> 'n'
                """
            ),
            {"table": table},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _identity_generation(engine: Engine, table: str, column: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT identity_generation FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                   AND column_name = :column
                """
            ),
            {"table": table, "column": column},
        ).scalar_one()


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine, _REQUESTS) == _EXPECTED_REQUEST_COLUMNS
    assert _columns(engine, _EVENTS) == _EXPECTED_EVENT_COLUMNS
    assert _identity_generation(engine, _EVENTS, "id") == "ALWAYS"
    assert _constraints(engine, _REQUESTS) == _EXPECTED_REQUEST_CONSTRAINTS
    assert _constraints(engine, _EVENTS) == _EXPECTED_EVENT_CONSTRAINTS
    assert _indexes(engine, _REQUESTS) == _EXPECTED_REQUEST_INDEXES
    assert _indexes(engine, _EVENTS) == _EXPECTED_EVENT_INDEXES


def _assert_absent(engine: Engine) -> None:
    for table in (_REQUESTS, _EVENTS):
        assert not table_exists(engine, "coord", table), f"coord.{table} is present"
        assert _indexes(engine, table) == {}, f"coord.{table} left indexes behind"


def _count(engine: Engine, table: str) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text(f"SELECT count(*) FROM coord.{table}")).scalar_one()
        )


def _insert(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        _insert(engine, statement, params)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_spawnledger_01_creates_the_ledger_and_enforces_its_contract() -> None:
    """Shape, vocabularies, defaults, dedup, tenant-tied FK, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "spawnledger01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — neither table exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply — exact columns, identity, constraints and indexes.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. Defaults, read back inside the inserting transaction so that
        #    ``now()`` is the same instant the defaults were evaluated at.
        with engine.begin() as conn:
            request_id, requested_now, updated_now = conn.execute(
                text(
                    """
                    INSERT INTO coord.spawn_requests (tenant_id, class, origin)
                    VALUES (:tid, 'autofix', 'coord_dispatch')
                    RETURNING id, requested_at = now(), updated_at = now()
                    """
                ),
                {"tid": _TENANT},
            ).one()
            defaults = conn.execute(
                text(
                    """
                    SELECT state, attempts, deferrals, history_complete,
                           source_ref, first_dispatched_at, spawned_at,
                           pinned_device_id, preferred_device_id,
                           current_device_id, spawned_device_id, lease_id,
                           placement_basis, claude_code_session_id,
                           claude_account, session_outcome, session_outcome_at,
                           terminal_reason
                      FROM coord.spawn_requests WHERE id = :id
                    """
                ),
                {"id": request_id},
            ).one()
            event = conn.execute(
                text(
                    """
                    INSERT INTO coord.spawn_request_events
                        (request_id, tenant_id, kind)
                    VALUES (:rid, :tid, 'requested')
                    RETURNING id, at = now(), detail, device_id, reason
                    """
                ),
                {"rid": request_id, "tid": _TENANT},
            ).one()
        # ``id`` was omitted from both inserts: their success is what proves
        # the gen_random_uuid() default and the identity column.
        assert (requested_now, updated_now) == (True, True)
        assert tuple(defaults) == ("queued", 0, 0, True) + (None,) * 14
        assert isinstance(event[0], int)
        assert tuple(event[1:]) == (True, {}, None, None)

        # 4. Every vocabulary refuses an unknown value and accepts every listed
        #    one (the exact sets were already pinned by ``_assert_shape``).
        _refused(engine, _INSERT_REQUEST, _request(**{"class": "batch"}))
        _refused(engine, _INSERT_REQUEST, _request(origin="continuation_push"))
        _refused(engine, _INSERT_REQUEST, _request(state="running"))
        _refused(engine, _INSERT_REQUEST, _request(placement_basis="guessed"))
        _refused(engine, _INSERT_REQUEST, _request(session_outcome="abandoned"))
        _refused(
            engine,
            _INSERT_EVENT,
            {"rid": request_id, "tid": _TENANT, "kind": "admitted"},
        )
        for klass in _CLASSES:
            _insert(engine, _INSERT_REQUEST, _request(**{"class": klass}))
        for origin in _ORIGINS:
            _insert(engine, _INSERT_REQUEST, _request(origin=origin))
        for state in _STATES:
            _insert(engine, _INSERT_REQUEST, _request(state=state))
        for basis in _PLACEMENT_BASES:
            _insert(engine, _INSERT_REQUEST, _request(placement_basis=basis))
        for outcome in _SESSION_OUTCOMES:
            _insert(engine, _INSERT_REQUEST, _request(session_outcome=outcome))
        for kind in _EVENT_KINDS:
            _insert(
                engine,
                _INSERT_EVENT,
                {"rid": request_id, "tid": _TENANT, "kind": kind},
            )

        # 5. The counters never go negative.
        _refused(engine, _INSERT_REQUEST, _request(attempts=-1))
        _refused(engine, _INSERT_REQUEST, _request(deferrals=-1))
        _insert(engine, _INSERT_REQUEST, _request(attempts=3, deferrals=2))

        # 6. One row per (tenant, class, source_ref); NULL sources never collide.
        gate_ref = "gate:7f3c1a52"
        _insert(engine, _INSERT_REQUEST, _request(source_ref=gate_ref))
        _refused(engine, _INSERT_REQUEST, _request(source_ref=gate_ref))
        # The key is the triple, not source_ref alone.
        _insert(
            engine,
            _INSERT_REQUEST,
            _request(source_ref=gate_ref, **{"class": "autofix"}),
        )
        _insert(
            engine, _INSERT_REQUEST, _request(source_ref=gate_ref, tid=_OTHER_TENANT)
        )
        for _ in range(2):
            _insert(engine, _INSERT_REQUEST, _request(source_ref=None))

        # 7. Events belong to their request AND to its tenant.
        _refused(
            engine,
            _INSERT_EVENT,
            {"rid": uuid.uuid4(), "tid": _TENANT, "kind": "requested"},
        )
        _refused(
            engine,
            _INSERT_EVENT,
            {"rid": request_id, "tid": _OTHER_TENANT, "kind": "requested"},
        )

        # 8. Re-running is harmless: with rows present, rewind the version
        #    stamp and apply the revision again. Nothing is created twice,
        #    nothing is lost, the shape is unchanged.
        rows_before = (_count(engine, _REQUESTS), _count(engine, _EVENTS))
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert (_count(engine, _REQUESTS), _count(engine, _EVENTS)) == rows_before

        # 9. Deleting a request cascades to its timeline.
        count_events = text(
            "SELECT count(*) FROM coord.spawn_request_events WHERE request_id = :id"
        )
        with engine.begin() as conn:
            before = conn.execute(count_events, {"id": request_id}).scalar_one()
            conn.execute(
                text("DELETE FROM coord.spawn_requests WHERE id = :id"),
                {"id": request_id},
            )
            after = conn.execute(count_events, {"id": request_id}).scalar_one()
        # The default-row event plus one per kind: the cascade had work to do.
        assert before == 1 + len(_EVENT_KINDS)
        assert after == 0

        # 10. Downgrade — both tables, every constraint and index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 11. Re-apply — the downgrade left no residue that blocks a second run.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
