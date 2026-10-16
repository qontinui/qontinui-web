"""Schema-contract and round-trip test for alembic ``leader_worker_runs_01``.

Plan ``2026-10-03-coord-table-retention-sweep-cannot-converge-under-restarts-and-its-batch-cap``
Phase 2 (claim ``r03-leader-jobs-survive-churn``).

``coord.leader_worker_runs`` is a contract the plan's coord side (Phase 3, not
yet on coord's ``main`` as this is written) is to code against from four sides.
Its worker-ledger cadence is to INSERT a row when a durable leader-gated
worker's body starts and UPDATE it when the body returns; its graceful-shutdown
tail is to close this replica's unfinished rows as ``cancelled``; on promotion
it is to read one worker's window of newest rows, plus its newest scheduled
attempt, beside the database clock; and the claim's probe counts one worker's
finished scheduled runs over 24 h. web makes no reads of ``coord.*``, so this
file is the only place on the authoring side where that contract can be pinned
(the ``test_replpres_01_migration.py`` convention). The statements below are
transcribed from the plan's D3 to D6 text, with the failed-start INSERT's
``LEAST(estimate, now())`` cap per D5 as amended 2026-10-14; re-transcribe them
from ``crates/coord/src/worker_ledger/cadence.rs`` once Phase 3 lands. D4's
single round trip (the window, the attempt and ``now()`` in one statement, with
``now()`` returned even for a worker with no rows) is a coord-side composition
of the reads pinned here; it is owned by Phase 3's
``pg_run_store_reports_db_now_with_the_load``, not by this file. The
properties pinned here are the ones that would break coord at runtime while
every migration gate stays green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.leader_worker_runs``, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL; no FK; no trigger.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``:

4. Column types, nullability and defaults, the identity key and both indexes.
   Every timestamp is ``timestamptz``, because coord subtracts ``now()`` from
   them: also proven by the subtraction itself under a non-UTC session.
5. Each CHECK rejects what it names and NOT NULL names its column.
6. coord's start/finish cycle: the INSERT returns an ascending id and a
   database-clock ``started_at``; the UPDATE stamps ``finished_at`` and an
   outcome; a row left unfinished reads as unfinished; the failed-start arm's
   complete-row INSERT is accepted, a start estimate later than the database's
   ``now()`` capped to it (D5 as amended 2026-10-14).
7. The window read is ordered by ``started_at`` then ``id``, never crosses
   worker names, stops at its LIMIT and is served by the name index without a
   sort.
8. The scheduled-attempt read finds the anchor behind a continuation chain
   longer than the window, skips ``cancelled`` and unfinished rows, and is
   served by the name index without a sort.
9. The shutdown cancel closes only this holder's unfinished rows, as
   ``cancelled``, and the outcome CHECK accepts the result.
10. The ``retention_sweeps_24h`` count shape counts only that worker's FINISHED
    ``scheduled`` ``ok`` runs inside 24 h.
11. The table and column comments land as the source writes them.
12. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from datetime import UTC, datetime, timedelta
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

_REVISION_ID = "leader_worker_runs_01"
_REVISION_FILENAME = "leader_worker_runs_01_coord_leader_worker_runs.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "plan_library_10_model_routes"

_SCHEMA = "coord"
_TABLE = "leader_worker_runs"

# (name, information_schema data_type, nullable, has_default)
_COLUMNS: tuple[tuple[str, str, bool, bool], ...] = (
    ("id", "bigint", False, False),
    ("name", "text", False, False),
    ("interval_secs", "integer", False, False),
    ("run_kind", "text", False, False),
    ("holder_id", "uuid", False, False),
    ("fenced_token", "bigint", True, False),
    ("started_at", "timestamp with time zone", False, True),
    ("finished_at", "timestamp with time zone", True, False),
    ("outcome", "text", True, False),
    ("decision_code", "text", True, False),
    ("detail_code", "text", True, False),
    ("more_pending", "boolean", False, True),
    ("continuation", "text", True, False),
)

# The window read: the newest rows for one worker, of any kind (plan D4). It is
# one of the three parts of the round trip coord's durable cadence is to make on
# promotion and on its bounded re-checks.
_WINDOW_SQL = (
    "SELECT id, run_kind, started_at, finished_at, outcome, more_pending, "
    "continuation, now() AS db_now FROM coord.leader_worker_runs "
    "WHERE name = :name ORDER BY started_at DESC, id DESC LIMIT 8"
)

# The scheduled-attempt read: the schedule's anchor (plan D3 `last`, D4), read
# by its own LIMIT 1 so a continuation chain cannot push it out of the window.
_LAST_ATTEMPT_SQL = (
    "SELECT id, started_at, finished_at, outcome FROM coord.leader_worker_runs "
    "WHERE name = :name AND run_kind = 'scheduled' AND finished_at IS NOT NULL "
    "AND outcome IN ('ok', 'idle', 'error') "
    "ORDER BY started_at DESC, id DESC LIMIT 1"
)

# The graceful-shutdown cancel (plan D6), verbatim but for the bind name.
_MARK_CANCELLED_SQL = (
    "UPDATE coord.leader_worker_runs SET finished_at = now(), outcome = 'cancelled' "
    "WHERE holder_id = :holder AND finished_at IS NULL"
)

# The count behind the claim's probe (plan Phase 8, NamedQuery
# `retention_sweeps_24h`): one worker's finished scheduled ok runs inside 24 h.
_RETENTION_SWEEPS_24H_SQL = (
    "SELECT count(*) FROM coord.leader_worker_runs "
    "WHERE name = 'main.table_retention_pruner' AND run_kind = 'scheduled' "
    "AND outcome = 'ok' AND finished_at > now() - interval '24 hours'"
)

_PRUNER = "main.table_retention_pruner"
_OTHER = "profile_drift_watcher"
_HOLDER = uuid.UUID("01a139a2-0000-7000-8000-0000000000a1")
_BASE = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)

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
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"sibling (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_leader_worker_runs() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert re.fullmatch(rf"{_SCHEMA}\.{_TABLE}(\.\w+)?", obj), (
                    f"{fn_name}(): object {obj!r} is not this revision's table"
                )
            for target in re.findall(r"INDEX\b[^;]*?\bON\s+([A-Za-z_.\"]+)", sql, re.I):
                assert target == f"{_SCHEMA}.{_TABLE}", (
                    f"{fn_name}(): index target {target!r} is not this revision's table"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_no_foreign_key_is_declared() -> None:
    # holder_id is a per-boot replica identity: a run record must outlive the
    # lease row's churn, and a FK would lock coord.leader_lease on every start.
    ddl = [
        sql
        for sql in _sql_literals(_function(_tree(), "upgrade"))
        if not re.match(r"\s*COMMENT\s+ON\b", sql, re.I)
    ]
    assert ddl
    for sql in ddl:
        assert not re.search(r"\bREFERENCES\b|\bFOREIGN\s+KEY\b", sql, re.I), sql


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    calls = [
        node
        for node in ast.walk(_tree())
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


def test_upgrade_ddl_is_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", up)
    creates = re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\b[^\n]*", up, re.I)
    assert len(creates) == 2, creates
    for create in creates:
        assert re.search(r"IF\s+NOT\s+EXISTS", create, re.I), create
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _row(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "name": _PRUNER,
        "interval_secs": 21_600,
        "run_kind": "scheduled",
        "holder_id": _HOLDER,
        "fenced_token": 42,
        "started_at": _BASE,
        "finished_at": _BASE + timedelta(minutes=3),
        "outcome": "ok",
        "decision_code": "converged",
        "detail_code": None,
        "more_pending": False,
        "continuation": None,
    }
    params.update(overrides)
    return params


def _insert(engine: Engine, params: dict[str, object]) -> int:
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        new_id = conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds}) RETURNING id"),
            params,
        ).scalar_one()
    assert isinstance(new_id, int)
    return new_id


def _columns(engine: Engine) -> dict[str, tuple[str, bool, str | None, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default,
                       is_identity
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3], r[4]) for r in rows}


def _assert_rejected_by(
    engine: Engine, constraint: str, params: dict[str, object]
) -> None:
    """The insert fails, and the database names ``constraint`` as the reason."""
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, params)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None, f"driver error carries no diag: {excinfo.value.orig!r}"
    assert diag.constraint_name == constraint, (
        f"{params}: rejected by {diag.constraint_name!r}, expected {constraint!r}"
    )


def _assert_not_null(engine: Engine, column: str) -> None:
    params = {**_row(), column: None}
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, params)
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
    assert orig.diag.column_name == column  # type: ignore[union-attr]


def _count(engine: Engine, *, name: str) -> int:
    """Rows this test wrote for one worker name."""
    value = scalar(
        engine, f"SELECT count(*) FROM coord.{_TABLE} WHERE name = :name", name=name
    )
    assert isinstance(value, int)
    return value


def _window(engine: Engine, name: str) -> list[tuple[object, ...]]:
    with engine.connect() as conn:
        return [tuple(r) for r in conn.execute(text(_WINDOW_SQL), {"name": name})]


def _last_attempt(engine: Engine, name: str) -> tuple[object, ...] | None:
    with engine.connect() as conn:
        row = conn.execute(text(_LAST_ATTEMPT_SQL), {"name": name}).one_or_none()
    return None if row is None else tuple(row)


def _plan(engine: Engine, sql: str, **params: object) -> str:
    """EXPLAIN ``sql`` with sequential scans off, as one string."""
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        return "\n".join(r[0] for r in conn.execute(text("EXPLAIN " + sql), params))


@_needs_pg
def test_table_shape_identity_key_and_indexes() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable, has_default in _COLUMNS:
            assert name in got, f"coord.{_TABLE} is missing {name}"
            got_type, got_nullable, got_default, _identity = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            assert (got_default is not None) is has_default, (
                f"{name}: default {got_default!r}"
            )
        assert set(got) == {c[0] for c in _COLUMNS}, f"unexpected columns {set(got)}"
        # The key is an IDENTITY column (GENERATED ALWAYS), not a defaulted one.
        assert got["id"][3] == "YES", "id must be an identity column"
        generation = scalar(
            engine,
            "SELECT identity_generation FROM information_schema.columns "
            "WHERE table_schema = 'coord' AND table_name = 'leader_worker_runs' "
            "AND column_name = 'id'",
        )
        assert generation == "ALWAYS"

        pk = scalar(
            engine,
            "SELECT string_agg(a.attname, ',') FROM pg_constraint c "
            "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) "
            "WHERE c.conrelid = 'coord.leader_worker_runs'::regclass AND c.contype = 'p'",
        )
        assert pk == "id"

        name_def = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'idx_leader_worker_runs_name_started'",
        )
        assert isinstance(name_def, str)
        assert "(name, started_at DESC, id DESC)" in name_def, name_def
        started_def = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'idx_leader_worker_runs_started'",
        )
        assert isinstance(started_def, str)
        assert "(started_at)" in started_def, started_def
        assert "UNIQUE" not in name_def and "UNIQUE" not in started_def


@_needs_pg
def test_checks_and_not_nulls_reject_what_they_name() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _insert(engine, _row())
        for expected, bad in (
            ("leader_worker_runs_name_nonblank_check", _row(name="  ")),
            ("leader_worker_runs_name_nonblank_check", _row(name="")),
            ("leader_worker_runs_interval_positive_check", _row(interval_secs=0)),
            ("leader_worker_runs_interval_positive_check", _row(interval_secs=-60)),
            (
                "leader_worker_runs_finished_after_started_check",
                _row(finished_at=_BASE - timedelta(seconds=1)),
            ),
            # A finished run with no outcome, and an outcome on a run in flight.
            ("leader_worker_runs_outcome_iff_finished_check", _row(outcome=None)),
            ("leader_worker_runs_outcome_iff_finished_check", _row(finished_at=None)),
            (
                "leader_worker_runs_continuation_length_check",
                _row(more_pending=True, continuation="k" * 4097),
            ),
        ):
            _assert_rejected_by(engine, expected, bad)
        for column in ("name", "interval_secs", "run_kind", "holder_id"):
            _assert_not_null(engine, column)
        # The boundary values the CHECKs admit.
        _insert(engine, _row(more_pending=True, continuation="k" * 4096))
        _insert(engine, _row(interval_secs=1, finished_at=_BASE))
        # A row in flight: no finish, no outcome, codes optional.
        _insert(
            engine,
            _row(finished_at=None, outcome=None, decision_code=None, fenced_token=None),
        )
        assert _count(engine, name=_PRUNER) == 4

        # GENERATED ALWAYS: coord can never supply an id by mistake.
        with pytest.raises(sqlalchemy.exc.DBAPIError) as excinfo:
            _insert(engine, _row(id=999))
        assert getattr(excinfo.value.orig, "pgcode", None) == "428C9", excinfo.value


@_needs_pg
def test_the_start_finish_cycle_coord_runs() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_cycle") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # Start: the INSERT coord sends, relying on the defaults.
        with engine.begin() as conn:
            started = conn.execute(
                text(
                    "INSERT INTO coord.leader_worker_runs "
                    "(name, interval_secs, run_kind, holder_id, fenced_token) "
                    "VALUES (:name, 21600, 'scheduled', :holder, 7) "
                    "RETURNING id, started_at, more_pending, now() AS db_now"
                ),
                {"name": _PRUNER, "holder": _HOLDER},
            ).one()
        first_id, started_at, more_pending, db_now = started
        assert started_at == db_now, "started_at defaults to the database clock"
        assert more_pending is False

        # A second start gets a larger id.
        with engine.begin() as conn:
            second_id = conn.execute(
                text(
                    "INSERT INTO coord.leader_worker_runs "
                    "(name, interval_secs, run_kind, holder_id) "
                    "VALUES (:name, 21600, 'continuation', :holder) RETURNING id"
                ),
                {"name": _PRUNER, "holder": _HOLDER},
            ).scalar_one()
        assert second_id > first_id

        # Until the finish UPDATE lands, the run reads as unfinished.
        rows = {r[0]: r for r in _window(engine, _PRUNER)}
        assert rows[first_id][3] is None and rows[first_id][4] is None

        # Finish: the UPDATE coord sends.
        with engine.begin() as conn:
            finished_at = conn.execute(
                text(
                    "UPDATE coord.leader_worker_runs SET finished_at = now(), "
                    "outcome = 'ok', decision_code = 'backlogged=1', "
                    "more_pending = true, continuation = 'coord.test_results' "
                    "WHERE id = :id RETURNING finished_at"
                ),
                {"id": first_id},
            ).scalar_one()
        assert finished_at >= started_at
        rows = {r[0]: r for r in _window(engine, _PRUNER)}
        assert rows[first_id][4] == "ok"
        assert rows[first_id][5] is True and rows[first_id][6] == "coord.test_results"

        # A finish that forgets its outcome is refused, not stored half-done.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.leader_worker_runs SET finished_at = now() "
                        "WHERE id = :id"
                    ),
                    {"id": second_id},
                )
        assert (
            excinfo.value.orig.diag.constraint_name  # type: ignore[union-attr]
            == "leader_worker_runs_outcome_iff_finished_check"
        )

        # The failed-start arm (plan D5 as amended 2026-10-14): the body ran
        # although its start was never recorded, so the finish INSERTs the
        # complete row at once. started_at is coord's estimate of the database
        # clock at the start, LEAST(estimate, now()): clock-rate drift across a
        # stagger can push the estimate past now(), and uncapped the
        # finish-after-start CHECK would reject the row. The over-estimate is
        # built from the DATABASE clock, so whatever the skew between this
        # client and the server, the CHECK refuses the uncapped row, and the
        # assertion below catches it if that CHECK is ever dropped.
        ahead = scalar(engine, "SELECT now() + interval '5 minutes'")
        assert isinstance(ahead, datetime)
        with engine.begin() as conn:
            complete = conn.execute(
                text(
                    "INSERT INTO coord.leader_worker_runs "
                    "(name, interval_secs, run_kind, holder_id, fenced_token, "
                    "started_at, finished_at, outcome, decision_code, detail_code) "
                    "VALUES (:name, 21600, 'scheduled', :holder, 7, "
                    "LEAST(CAST(:started AS timestamptz), now()), now(), 'ok', "
                    "'converged', NULL) RETURNING id, started_at, finished_at"
                ),
                {"name": _PRUNER, "holder": _HOLDER, "started": ahead},
            ).one()
        assert complete[1] < ahead, "the start estimate past now() was capped"
        assert complete[1] == complete[2], (
            "capped at the statement's own now(), the instant the finish is stamped"
        )

        # Every timestamp is timestamptz. A naive column would apply cleanly and
        # then be off by the session's UTC offset in coord's own expression, so
        # the proof is the SUBTRACTION under a non-UTC session, not a read-back.
        with engine.connect() as conn:
            conn.execute(text("SET TIME ZONE 'America/New_York'"))
            ages = conn.execute(
                text(
                    "SELECT extract(epoch FROM now() - started_at), "
                    "extract(epoch FROM now() - finished_at) "
                    "FROM coord.leader_worker_runs WHERE id = :id"
                ),
                {"id": first_id},
            ).one()
        assert all(0 <= float(a) < 300 for a in ages), (
            f"now() - started_at/finished_at = {ages}: a naive timestamp column?"
        )


@_needs_pg
def test_the_newest_first_read_is_ordered_scoped_and_index_served() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_read") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert _window(engine, _PRUNER) == [], "no row is no row, never a default"

        ids = []
        for hours in range(10):
            ids.append(
                _insert(
                    engine,
                    _row(
                        started_at=_BASE + timedelta(hours=hours),
                        finished_at=_BASE + timedelta(hours=hours, minutes=2),
                    ),
                )
            )
        # A newer row for ANOTHER worker must never be read.
        _insert(
            engine,
            _row(
                name=_OTHER,
                interval_secs=86_400,
                started_at=_BASE + timedelta(days=3),
                finished_at=_BASE + timedelta(days=3, minutes=1),
            ),
        )
        # Two starts in the same instant: the later id is the newer row.
        tie_at = _BASE + timedelta(hours=20)
        low = _insert(engine, _row(started_at=tie_at, finished_at=None, outcome=None))
        high = _insert(engine, _row(started_at=tie_at, finished_at=None, outcome=None))

        rows = _window(engine, _PRUNER)
        assert len(rows) == 8, "the window read stops at its LIMIT"
        assert [r[0] for r in rows[:2]] == [high, low], "a started_at tie breaks on id"
        assert [r[0] for r in rows[2:]] == list(reversed(ids))[:6], (
            "newest started_at first"
        )
        db_now = rows[0][7]
        assert all(r[7] == db_now for r in rows), "one database clock per read"

        other = _window(engine, _OTHER)
        assert len(other) == 1 and other[0][2] == _BASE + timedelta(days=3)

        plan = _plan(engine, _WINDOW_SQL, name=_PRUNER)
        assert "idx_leader_worker_runs_name_started" in plan, plan
        assert "Sort" not in plan, f"the name index must serve the ORDER BY:\n{plan}"


@_needs_pg
def test_the_attempt_read_finds_the_anchor_behind_a_continuation_chain() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_anchor") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert _last_attempt(engine, _PRUNER) is None, "no attempt is no attempt"

        anchor = _insert(engine, _row(decision_code="backlogged=1", more_pending=True))
        # Twelve continuations after it: more than the window holds.
        for minutes in range(10, 130, 10):
            _insert(
                engine,
                _row(
                    run_kind="continuation",
                    started_at=_BASE + timedelta(minutes=minutes),
                    finished_at=_BASE + timedelta(minutes=minutes, seconds=40),
                ),
            )
        # Newer scheduled rows that are NOT attempts: one a graceful shutdown
        # cancelled, one still in flight (or cut off by a crash).
        _insert(
            engine,
            _row(
                started_at=_BASE + timedelta(hours=3),
                finished_at=_BASE + timedelta(hours=3, minutes=1),
                outcome="cancelled",
                decision_code=None,
            ),
        )
        _insert(
            engine,
            _row(started_at=_BASE + timedelta(hours=4), finished_at=None, outcome=None),
        )
        # Another worker's newer attempt is never this worker's anchor.
        _insert(
            engine,
            _row(
                name=_OTHER,
                started_at=_BASE + timedelta(hours=5),
                finished_at=_BASE + timedelta(hours=5, minutes=1),
            ),
        )

        window = _window(engine, _PRUNER)
        assert len(window) == 8
        assert anchor not in {r[0] for r in window}, (
            "the fixture must push the anchor out of the window"
        )
        last = _last_attempt(engine, _PRUNER)
        assert last is not None and last[0] == anchor, (
            f"the attempt read returned {last}, expected the scheduled row {anchor}"
        )
        for outcome in ("idle", "error"):
            newer = _insert(
                engine,
                _row(
                    started_at=_BASE + timedelta(hours=6),
                    finished_at=_BASE + timedelta(hours=6, minutes=2),
                    outcome=outcome,
                ),
            )
            got = _last_attempt(engine, _PRUNER)
            assert got is not None and got[0] == newer, (
                f"an {outcome} run is an attempt"
            )
            with engine.begin() as conn:
                conn.execute(
                    text(f"DELETE FROM coord.{_TABLE} WHERE id = :id"), {"id": newer}
                )

        plan = _plan(engine, _LAST_ATTEMPT_SQL, name=_PRUNER)
        assert "idx_leader_worker_runs_name_started" in plan, plan
        assert "Sort" not in plan, f"the name index must serve the ORDER BY:\n{plan}"


@_needs_pg
def test_the_shutdown_cancel_closes_only_this_holders_unfinished_rows() -> None:
    other_holder = uuid.UUID("01a139a2-0000-7000-8000-0000000000b2")
    with ephemeral_database(admin_database_url(), "lwr01_cancel") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        mine_open = [
            _insert(engine, _row(finished_at=None, outcome=None)),
            _insert(engine, _row(name=_OTHER, finished_at=None, outcome=None)),
        ]
        mine_done = _insert(engine, _row())
        theirs_open = _insert(
            engine, _row(holder_id=other_holder, finished_at=None, outcome=None)
        )

        with engine.begin() as conn:
            closed = conn.execute(
                text(_MARK_CANCELLED_SQL), {"holder": _HOLDER}
            ).rowcount
        assert closed == 2

        with engine.connect() as conn:
            rows = {
                r[0]: (r[1], r[2], r[3])
                for r in conn.execute(
                    text(
                        f"SELECT id, finished_at IS NOT NULL, outcome, "
                        f"finished_at >= started_at FROM coord.{_TABLE}"
                    )
                )
            }
        for run in mine_open:
            assert rows[run] == (True, "cancelled", True), rows[run]
        assert rows[mine_done] == (True, "ok", True), "a finished run is left alone"
        assert rows[theirs_open] == (False, None, None), (
            "another replica's run is left alone"
        )

        with engine.begin() as conn:
            again = conn.execute(
                text(_MARK_CANCELLED_SQL), {"holder": _HOLDER}
            ).rowcount
        assert again == 0, "the cancel is idempotent"


@_needs_pg
def test_the_sweeps_24h_count_takes_only_finished_scheduled_ok_runs() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_count") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        now = scalar(engine, "SELECT now()")
        assert isinstance(now, datetime)

        def at(hours_ago: float) -> dict[str, object]:
            started = now - timedelta(hours=hours_ago)
            return {
                "started_at": started,
                "finished_at": started + timedelta(minutes=2),
            }

        assert scalar(engine, _RETENTION_SWEEPS_24H_SQL) == 0
        # Four scheduled ok sweeps inside the window: these count.
        for hours_ago in (1, 7, 13, 19):
            _insert(engine, _row(**at(hours_ago)))
        # None of these may count.
        _insert(engine, _row(**at(25)))  # outside the window
        _insert(engine, _row(run_kind="continuation", **at(2)))  # a continuation
        _insert(engine, _row(outcome="error", detail_code="pg_pool_acquire", **at(3)))
        _insert(engine, _row(outcome="idle", decision_code="disabled", **at(4)))
        _insert(
            engine,
            _row(started_at=now - timedelta(hours=5), finished_at=None, outcome=None),
        )  # interrupted
        # Another worker's run.
        _insert(engine, _row(name="main.fs_retention_pruner", **at(6)))
        assert scalar(engine, _RETENTION_SWEEPS_24H_SQL) == 4

        plan = _plan(engine, _RETENTION_SWEEPS_24H_SQL)
        assert "idx_leader_worker_runs_name_started" in plan, plan


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "lwr01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        for column, *_rest in _COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {_TABLE}.{column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, _row())

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine, name=_PRUNER) == 1, (
            "the re-run must not disturb existing rows"
        )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "lwr01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, _row())

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, "idx_leader_worker_runs_name_started")
        assert not index_exists(engine, "idx_leader_worker_runs_started")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine, name=_PRUNER) == 0, (
            "the table comes back empty, not restored"
        )
