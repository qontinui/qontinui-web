"""Behaviour test for the ``sessruns_01_session_runs`` revision.

Pins the contract coord's session-run ingest, classifier, backstop, rollup and
reads (plan ``2026-10-23-session-duration-by-work-type-and-per-device-session-load``
Phase 3) rely on:

1. **Shape** — both tables, their exact column contracts, every constraint by
   name and definition, and every index by its exact definition; all gone
   after downgrade.
2. **Only three vocabularies are enforced** — ``initiator``, ``end_reason`` and
   ``end_source`` refuse an unknown value and accept every listed one, while
   ``work_type``, ``skill``, ``dispatch_source``, ``first_command`` and
   ``bind_origin`` accept any text (their vocabularies live in Rust).
3. **Defaults are honest** — ``initiator`` / ``work_type`` ``unknown``,
   ``classifier_version`` 0, ``run_seq`` 1, ``history_complete`` true,
   timestamps ``now()``, every fact and timing column NULL until written.
4. **An end is all-or-nothing and never precedes the start** — ``ended_at``
   without ``end_reason`` (and vice versa) is refused, as is
   ``ended_at < started_at``.
5. **Counters never go negative** — ``run_seq`` below 1, ``active_seconds``
   below 0 and every hourly counter below 0 are refused.
6. **One row per run** — a second ``(tenant_id, claude_code_session_id,
   run_seq)`` is refused; the next ``run_seq`` and another tenant are not.
7. **The device id is not a foreign key** — a device no table knows is
   accepted, since the record must outlive device deletion.
8. **Re-running is harmless** — with rows present, ``stamp <parent>`` then
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

_REVISION_ID = "sessruns_01_session_runs"
_REVISION_FILENAME = "sessruns_01_session_runs.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_RUNS = "session_runs"
_HOURLY = "session_run_hourly"

_TIMESTAMPTZ = "timestamp with time zone"

_FACT_COLUMNS = (
    "spawn_origin",
    "spawn_kind",
    "dispatch_source",
    "diagnosis_kind",
    "gate_registered_by",
    "skill",
    "first_command",
    "bind_origin",
    "close_reason",
    "account_label",
    "provider",
    "model",
    "repo",
    "work_unit_slug",
)

# The column contracts shared with coord: name -> (data_type, nullable).
_EXPECTED_RUN_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "NO"),
    "claude_code_session_id": ("uuid", "NO"),
    "run_seq": ("integer", "NO"),
    "coord_session_id": ("uuid", "YES"),
    "spawn_request_id": ("uuid", "YES"),
    "gate_id": ("uuid", "YES"),
    "agent_id": ("uuid", "YES"),
    **dict.fromkeys(_FACT_COLUMNS, ("text", "YES")),
    "initiator": ("text", "NO"),
    "work_type": ("text", "NO"),
    "classifier_version": ("integer", "NO"),
    "started_at": (_TIMESTAMPTZ, "NO"),
    "first_turn_at": (_TIMESTAMPTZ, "YES"),
    "finished_at": (_TIMESTAMPTZ, "YES"),
    "ended_at": (_TIMESTAMPTZ, "YES"),
    "last_seen_at": (_TIMESTAMPTZ, "YES"),
    "active_seconds": ("integer", "YES"),
    "clock_skew_seconds": ("integer", "YES"),
    "end_reason": ("text", "YES"),
    "end_source": ("text", "YES"),
    "history_complete": ("boolean", "NO"),
    "created_at": (_TIMESTAMPTZ, "NO"),
    "updated_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_HOURLY_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "NO"),
    "work_type": ("text", "NO"),
    "hour": (_TIMESTAMPTZ, "NO"),
    "runs_started": ("integer", "NO"),
    "slot_seconds": ("bigint", "NO"),
    "peak_concurrent": ("integer", "NO"),
    "p95_concurrent": ("integer", "NO"),
    "computed_at": (_TIMESTAMPTZ, "NO"),
}

# The three enforced vocabularies, each the ONE list its CHECK must hold.
_INITIATORS = ("operator", "coord", "runner_local", "unknown")
_END_REASONS = (
    "exited",
    "poll_dead",
    "superseded",
    "operator_closed",
    "finished_close",
    "runner_stopped",
    "handoff_detached",
    "inferred_lost",
    "other",
)
_END_SOURCES = ("observed", "inferred")

_HOURLY_COUNTERS = ("runs_started", "slot_seconds", "peak_concurrent", "p95_concurrent")


def _text_array(values: tuple[str, ...]) -> str:
    """How ``pg_get_constraintdef`` / ``indexdef`` render an ``IN (...)`` list."""
    return "ARRAY[" + ", ".join(f"'{value}'::text" for value in values) + "]"


def _nullable_in_check(column: str, values: tuple[str, ...]) -> str:
    return f"CHECK ((({column} IS NULL) OR ({column} = ANY ({_text_array(values)}))))"


# Every constraint, by name: (contype, pg_get_constraintdef). Exact, so a
# widened vocabulary, a renamed constraint, a dropped one or an extra one all
# fail here before any insert runs — including any CHECK that would constrain
# work_type or another Rust-owned vocabulary.
_EXPECTED_RUN_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "session_runs_pkey": ("p", "PRIMARY KEY (id)"),
    "uq_session_runs_session_run": (
        "u",
        "UNIQUE (tenant_id, claude_code_session_id, run_seq)",
    ),
    "ck_session_runs_run_seq_positive": ("c", "CHECK ((run_seq >= 1))"),
    "ck_session_runs_active_seconds_nonneg": ("c", "CHECK ((active_seconds >= 0))"),
    "ck_session_runs_initiator": (
        "c",
        f"CHECK ((initiator = ANY ({_text_array(_INITIATORS)})))",
    ),
    "ck_session_runs_end_reason": ("c", _nullable_in_check("end_reason", _END_REASONS)),
    "ck_session_runs_end_source": ("c", _nullable_in_check("end_source", _END_SOURCES)),
    "ck_session_runs_end_consistent": (
        "c",
        "CHECK (((ended_at IS NULL) = (end_reason IS NULL)))",
    ),
    "ck_session_runs_ended_after_start": (
        "c",
        "CHECK (((ended_at IS NULL) OR (ended_at >= started_at)))",
    ),
}

_EXPECTED_HOURLY_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "session_run_hourly_pkey": (
        "p",
        "PRIMARY KEY (tenant_id, device_id, work_type, hour)",
    ),
    **{
        f"ck_session_run_hourly_{counter}_nonneg": ("c", f"CHECK (({counter} >= 0))")
        for counter in _HOURLY_COUNTERS
    },
}

# Every index on each table, by name, with its exact ``pg_indexes.indexdef``.
_EXPECTED_RUN_INDEXES: dict[str, str] = {
    "session_runs_pkey": (
        "CREATE UNIQUE INDEX session_runs_pkey ON coord.session_runs USING btree (id)"
    ),
    "uq_session_runs_session_run": (
        "CREATE UNIQUE INDEX uq_session_runs_session_run ON coord.session_runs "
        "USING btree (tenant_id, claude_code_session_id, run_seq)"
    ),
    "ix_session_runs_tenant_started": (
        "CREATE INDEX ix_session_runs_tenant_started ON coord.session_runs "
        "USING btree (tenant_id, started_at DESC)"
    ),
    "ix_session_runs_device_started": (
        "CREATE INDEX ix_session_runs_device_started ON coord.session_runs "
        "USING btree (tenant_id, device_id, started_at)"
    ),
    "ix_session_runs_work_type_started": (
        "CREATE INDEX ix_session_runs_work_type_started ON coord.session_runs "
        "USING btree (tenant_id, work_type, started_at)"
    ),
    "ix_session_runs_open": (
        "CREATE INDEX ix_session_runs_open ON coord.session_runs "
        "USING btree (tenant_id, device_id) WHERE (ended_at IS NULL)"
    ),
}

_EXPECTED_HOURLY_INDEXES: dict[str, str] = {
    "session_run_hourly_pkey": (
        "CREATE UNIQUE INDEX session_run_hourly_pkey ON coord.session_run_hourly "
        "USING btree (tenant_id, device_id, work_type, hour)"
    ),
    "ix_session_run_hourly_tenant_hour": (
        "CREATE INDEX ix_session_run_hourly_tenant_hour ON coord.session_run_hourly "
        "USING btree (tenant_id, hour)"
    ),
}

_TENANT = uuid.UUID("3b8e2f61-7c04-4d9a-a1e5-9f62c7d0b418")
_OTHER_TENANT = uuid.UUID("c95a1d37-4e80-4b2f-8d16-0a7e3f9c5b21")
_DEVICE = uuid.UUID("71f0c4a8-2d5e-4a3b-9c67-e8b1f2a09d53")

_INSERT_RUN = text(
    """
    INSERT INTO coord.session_runs
        (tenant_id, device_id, claude_code_session_id, run_seq, initiator,
         work_type, skill, dispatch_source, first_command, bind_origin,
         started_at, ended_at, end_reason, end_source, active_seconds)
    VALUES (:tid, :device, :sid, :run_seq, :initiator,
            :work_type, :skill, :dispatch_source, :first_command, :bind_origin,
            :started_at, :ended_at, :end_reason, :end_source, :active_seconds)
    """
)

_INSERT_HOURLY = text(
    """
    INSERT INTO coord.session_run_hourly
        (tenant_id, device_id, work_type, hour, runs_started, slot_seconds,
         peak_concurrent, p95_concurrent)
    VALUES (:tid, :device, :work_type, :hour, :runs_started, :slot_seconds,
            :peak_concurrent, :p95_concurrent)
    """
)

_START = "2026-10-26T10:00:00+00:00"
_END = "2026-10-26T11:30:00+00:00"
_BEFORE_START = "2026-10-26T09:59:59+00:00"


def _run(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "sid": uuid.uuid4(),
        "run_seq": 1,
        "initiator": "unknown",
        "work_type": "unknown",
        "skill": None,
        "dispatch_source": None,
        "first_command": None,
        "bind_origin": None,
        "started_at": _START,
        "ended_at": None,
        "end_reason": None,
        "end_source": None,
        "active_seconds": None,
    }
    params.update(overrides)
    return params


def _hourly(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "work_type": "unknown",
        "hour": _START,
        "runs_started": 0,
        "slot_seconds": 0,
        "peak_concurrent": 0,
        "p95_concurrent": 0,
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


def _table_comment(engine: Engine, table: str) -> str | None:
    with engine.connect() as conn:
        comment = conn.execute(
            text("SELECT obj_description(to_regclass('coord.' || :table), 'pg_class')"),
            {"table": table},
        ).scalar_one()
    return None if comment is None else str(comment)


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine, _RUNS) == _EXPECTED_RUN_COLUMNS
    assert _columns(engine, _HOURLY) == _EXPECTED_HOURLY_COLUMNS
    assert _constraints(engine, _RUNS) == _EXPECTED_RUN_CONSTRAINTS
    assert _constraints(engine, _HOURLY) == _EXPECTED_HOURLY_CONSTRAINTS
    assert _indexes(engine, _RUNS) == _EXPECTED_RUN_INDEXES
    assert _indexes(engine, _HOURLY) == _EXPECTED_HOURLY_INDEXES
    runs_comment = _table_comment(engine, _RUNS)
    assert runs_comment is not None and "400 days" in runs_comment
    assert "coord.sessions" in runs_comment
    hourly_comment = _table_comment(engine, _HOURLY)
    assert hourly_comment is not None and "400 days" in hourly_comment


def _assert_absent(engine: Engine) -> None:
    for table in (_RUNS, _HOURLY):
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


def _ended(**overrides: object) -> dict[str, object]:
    """A run closed by an observed exit, overridable."""
    fields: dict[str, object] = {
        "ended_at": _END,
        "end_reason": "exited",
        "end_source": "observed",
    }
    fields.update(overrides)
    return _run(**fields)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_sessruns_01_creates_the_run_record_and_enforces_its_contract() -> None:
    """Shape, vocabularies, defaults, end consistency, run key, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "sessruns01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — neither table exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply — exact columns, constraints, indexes, table comments.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. Defaults, read back inside the inserting transaction so that
        #    ``now()`` is the same instant the defaults were evaluated at.
        #    ``id`` and ``run_seq`` are omitted: success proves their defaults.
        fact_list = ", ".join(_FACT_COLUMNS)
        with engine.begin() as conn:
            run_id, created_now, updated_now = conn.execute(
                text(
                    """
                    INSERT INTO coord.session_runs
                        (tenant_id, device_id, claude_code_session_id, started_at)
                    VALUES (:tid, :device, :sid, :started_at)
                    RETURNING id, created_at = now(), updated_at = now()
                    """
                ),
                {
                    "tid": _TENANT,
                    "device": _DEVICE,
                    "sid": uuid.uuid4(),
                    "started_at": _START,
                },
            ).one()
            defaults = conn.execute(
                text(
                    f"""
                    SELECT run_seq, initiator, work_type, classifier_version,
                           history_complete, coord_session_id, spawn_request_id,
                           gate_id, agent_id, {fact_list}, first_turn_at,
                           finished_at, ended_at, last_seen_at, active_seconds,
                           clock_skew_seconds, end_reason, end_source
                      FROM coord.session_runs WHERE id = :id
                    """
                ),
                {"id": run_id},
            ).one()
            hourly_now = conn.execute(
                text(
                    """
                    INSERT INTO coord.session_run_hourly
                        (tenant_id, device_id, work_type, hour)
                    VALUES (:tid, :device, 'unknown', :hour)
                    RETURNING runs_started, slot_seconds, peak_concurrent,
                              p95_concurrent, computed_at = now()
                    """
                ),
                {"tid": _TENANT, "device": _DEVICE, "hour": _START},
            ).one()
        assert (created_now, updated_now) == (True, True)
        assert tuple(defaults) == (1, "unknown", "unknown", 0, True) + (None,) * (
            4 + len(_FACT_COLUMNS) + 8
        )
        assert tuple(hourly_now) == (0, 0, 0, 0, True)

        # 4. The three enforced vocabularies refuse an unknown value and accept
        #    every listed one (the exact sets were pinned by ``_assert_shape``).
        _refused(engine, _INSERT_RUN, _run(initiator="human"))
        _refused(engine, _INSERT_RUN, _ended(end_reason="crashed"))
        _refused(engine, _INSERT_RUN, _ended(end_source="guessed"))
        for initiator in _INITIATORS:
            _insert(engine, _INSERT_RUN, _run(initiator=initiator))
        for reason in _END_REASONS:
            _insert(engine, _INSERT_RUN, _ended(end_reason=reason))
        for source in _END_SOURCES:
            _insert(engine, _INSERT_RUN, _ended(end_source=source))

        # 5. The Rust-owned vocabularies are free text: a value no list knows
        #    is accepted, so a new work type needs no alembic round-trip.
        _insert(
            engine,
            _INSERT_RUN,
            _run(
                work_type="a_work_type_coord_has_not_invented_yet",
                skill="/some-future-skill",
                dispatch_source="future_dispatch",
                first_command="/brand-new",
                bind_origin="future_origin",
            ),
        )

        # 6. An end is all-or-nothing and never precedes the start.
        _refused(engine, _INSERT_RUN, _run(ended_at=_END))
        _refused(engine, _INSERT_RUN, _run(end_reason="exited"))
        _refused(engine, _INSERT_RUN, _ended(ended_at=_BEFORE_START))
        _insert(engine, _INSERT_RUN, _ended(ended_at=_START))

        # 7. Counters never go negative; run_seq starts at 1.
        _refused(engine, _INSERT_RUN, _run(run_seq=0))
        _refused(engine, _INSERT_RUN, _run(active_seconds=-1))
        _insert(engine, _INSERT_RUN, _run(active_seconds=0))
        for counter in _HOURLY_COUNTERS:
            _refused(
                engine, _INSERT_HOURLY, _hourly(work_type=counter, **{counter: -1})
            )
        _insert(
            engine,
            _INSERT_HOURLY,
            _hourly(
                work_type="implement",
                runs_started=4,
                slot_seconds=10_800,
                peak_concurrent=3,
                p95_concurrent=2,
            ),
        )
        # One rollup row per (tenant, device, work_type, hour).
        _refused(engine, _INSERT_HOURLY, _hourly(work_type="implement"))

        # 8. One row per run: the next run_seq and another tenant are distinct.
        session = uuid.uuid4()
        _insert(engine, _INSERT_RUN, _run(sid=session))
        _refused(engine, _INSERT_RUN, _run(sid=session))
        _insert(engine, _INSERT_RUN, _run(sid=session, run_seq=2))
        _insert(engine, _INSERT_RUN, _run(sid=session, tid=_OTHER_TENANT))

        # 9. The device is not a foreign key: an id no table knows is accepted.
        _insert(engine, _INSERT_RUN, _run(device=uuid.uuid4()))

        # 10. Re-running is harmless: with rows present, rewind the version
        #     stamp and apply the revision again.
        rows_before = (_count(engine, _RUNS), _count(engine, _HOURLY))
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert (_count(engine, _RUNS), _count(engine, _HOURLY)) == rows_before

        # 11. Downgrade — both tables, every constraint and index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 12. Re-apply — the downgrade left no residue that blocks a second run.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
