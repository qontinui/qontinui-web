"""Structural and round-trip test for alembic ``coord_maint_agent_req_01``.

Plan ``2026-06-08-coord-scheduled-maintenance-subsystem`` Phases 2-3.

``coord.maintenance_agent_requests`` is the one queue coord writes Phase 2
semantic-verdict requests and Phase 3 natural-language compile requests into,
and runners claim and answer. coord's routes and scheduler tick code against
its columns, its closed vocabularies and the partial unique that dedupes
verdict requests, so those are pinned here.

Without a database (always runs):

1. Chain wiring: the parent is pinned as a literal and names one real sibling,
   and the ``Revises:`` header agrees.
2. Every statement is static, ``coord.``-qualified SQL through ``op.execute``;
   the only DROPs are in ``downgrade()``; the column-drop guard reads the
   upgrade path as dropping nothing; no build is CONCURRENTLY and every index
   targets the table this revision creates (a provable new-table claim).
3. The source never names the retired store name the coord new-table proof
   greps for.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults, in contract order.
5. The two indexes by definition, the CHECKs, the dedupe, and the FK actions.
6. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_definition,
    index_exists,
    index_state,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_maint_agent_req_01"
_REVISION_FILENAME = "coord_maint_agent_req_01_maintenance_agent_requests.py"

# Pinned as a literal, not read back from the module: the test must notice a
# re-point, not follow it.
_PARENT_REVISION_ID = "journey_05_edge_outcome_verdict_unknown"

_SCHEMA = "coord"
_TABLE = "maintenance_agent_requests"
_DEDUPE_INDEX = "ux_maintenance_agent_requests_verdict_dedupe"
_QUEUE_INDEX = "idx_maintenance_agent_requests_queue"
_INDEXES = (_DEDUPE_INDEX, _QUEUE_INDEX)

# The name coord's new-table proof would match on trunk comments; this
# revision must never spell it (built from parts so this file does not either).
_RETIRED_NAME = "maintenance_" + "verdicts"

# (name, information_schema data_type, nullable, default-substring or None),
# in the contract's column order.
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("kind", "text", False, None),
    ("task_id", "uuid", True, None),
    ("run_id", "uuid", True, None),
    ("target_device_id", "uuid", True, None),
    ("candidate_key", "text", True, None),
    ("repo_path", "text", True, None),
    ("question", "text", False, None),
    ("prompt", "text", False, None),
    ("min_confidence", "real", True, None),
    ("state", "text", False, "'pending'"),
    ("claimed_by_device", "uuid", True, None),
    ("claimed_at", "timestamp with time zone", True, None),
    ("verdict", "text", True, None),
    ("confidence", "real", True, None),
    ("rationale", "text", True, None),
    ("result", "jsonb", True, None),
    ("error", "text", True, None),
    ("requested_by", "text", False, None),
    ("created_at", "timestamp with time zone", False, "now()"),
    ("answered_at", "timestamp with time zone", True, None),
    ("expires_at", "timestamp with time zone", False, None),
)

_DOWNGRADE_STATEMENTS = (
    f"DROP INDEX IF EXISTS {_SCHEMA}.{_QUEUE_INDEX}",
    f"DROP INDEX IF EXISTS {_SCHEMA}.{_DEDUPE_INDEX}",
    f"DROP TABLE IF EXISTS {_SCHEMA}.{_TABLE}",
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


def _collapsed(sql: str | None) -> str:
    assert sql is not None, "an op.execute argument is not a static literal"
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)
    assert "2026-06-08-coord-scheduled-maintenance-subsystem" in source


# ---------------------------------------------------------------------------
# 2-3. statement shapes
# ---------------------------------------------------------------------------


def test_the_source_never_names_the_retired_store() -> None:
    assert _RETIRED_NAME not in _revision_source().lower()


def test_every_statement_is_static_coord_sql_and_drops_live_in_downgrade() -> None:
    upgrade_calls = upgrade_execute_calls(_revision_path())
    assert upgrade_calls
    for call in upgrade_calls:
        sql = _collapsed(call.sql)
        assert "DROP" not in sql.upper(), sql
        assert "CONCURRENTLY" not in sql.upper(), sql
        assert not call.in_autocommit_block, sql
        if sql.startswith("SET LOCAL lock_timeout"):
            continue
        assert f" {_SCHEMA}.{_TABLE}" in f" {sql}", sql
        if " INDEX " in sql:
            target = sql.split(" ON ", 1)[1].split(" ", 1)[0]
            assert target == f"{_SCHEMA}.{_TABLE}", (
                f"{sql!r} is not a claim on the table this revision creates"
            )

    downgrade_calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert tuple(_collapsed(c.sql) for c in downgrade_calls) == _DOWNGRADE_STATEMENTS

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations

    tree = ast.parse(_revision_source())
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs, "coord's classifier refuses SQL through a bind"


# ---------------------------------------------------------------------------
# 4-6. real Postgres
# ---------------------------------------------------------------------------

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000c001")
_DEVICE = uuid.UUID("00000000-0000-4000-8000-00000000d001")


def _uuid(value: object) -> uuid.UUID:
    assert isinstance(value, uuid.UUID), value
    return value


def _insert_task(conn: Connection) -> uuid.UUID:
    return _uuid(
        conn.execute(
            text(
                """
            INSERT INTO coord.maintenance_tasks
                (tenant_id, name, target_selector, action, schedule_gate)
            VALUES (:t, 'branch reset', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
            RETURNING id
            """
            ),
            {"t": str(_TENANT)},
        ).scalar_one()
    )


def _insert_run(conn: Connection, task_id: uuid.UUID) -> uuid.UUID:
    return _uuid(
        conn.execute(
            text(
                "INSERT INTO coord.maintenance_runs (task_id) VALUES (:t) RETURNING id"
            ),
            {"t": task_id},
        ).scalar_one()
    )


def _insert_request(conn: Connection, **overrides: object) -> uuid.UUID:
    row: dict[str, object] = {
        "tenant_id": _TENANT,
        "kind": "verdict",
        "target_device_id": _DEVICE,
        "candidate_key": "D:/repo|feature|abc123",
        "repo_path": "D:/repo",
        "question": "Is this branch abandoned?",
        "prompt": "full prompt",
        "requested_by": "coord:maintenance",
    }
    row.update(overrides)
    columns = list(row)
    values = [f"CAST(:{k} AS jsonb)" if k == "result" else f":{k}" for k in row]
    columns.append("expires_at")
    values.append("now() + interval '1 hour'")
    return _uuid(
        conn.execute(
            text(
                f"INSERT INTO coord.{_TABLE} ({', '.join(columns)}) "
                f"VALUES ({', '.join(values)}) RETURNING id"
            ),
            row,
        ).scalar_one()
    )


def _refused_by(engine: Engine, write: Callable[[Connection], object]) -> str:
    """Run ``write`` in its own transaction; return the constraint it violated."""
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            write(conn)
    diag = getattr(excinfo.value.orig, "diag", None)
    return str(getattr(diag, "constraint_name", ""))


def _count(engine: Engine) -> int:
    """Rows of the table belonging to this module's test tenant."""
    value = scalar(
        engine,
        f"SELECT count(*) FROM {_SCHEMA}.{_TABLE} WHERE tenant_id = :t",
        t=_TENANT,
    )
    assert isinstance(value, int)
    return value


@pytest.fixture(scope="module")
def requests_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by tests 4-5."""
    with ephemeral_database(admin_database_url(), "mar01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


@_needs_pg
def test_columns_in_contract_order(requests_db: Engine) -> None:
    with requests_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :s AND table_name = :t
                 ORDER BY ordinal_position
                """
            ),
            {"s": _SCHEMA, "t": _TABLE},
        ).all()
    assert [r[0] for r in rows] == [c[0] for c in _COLUMNS]
    for row, (name, data_type, nullable, default) in zip(rows, _COLUMNS, strict=True):
        assert row[1] == data_type, (name, row[1])
        assert (row[2] == "YES") is nullable, (name, row[2])
        if default is None:
            assert row[3] is None, (name, row[3])
        else:
            assert row[3] is not None and default in row[3], (name, row[3])


@_needs_pg
def test_indexes_by_definition(requests_db: Engine) -> None:
    valid, unique, predicate = index_state(requests_db, _DEDUPE_INDEX)
    assert valid and unique
    assert predicate == "(kind = 'verdict'::text)", predicate
    assert "(task_id, candidate_key, question)" in index_definition(
        requests_db, _DEDUPE_INDEX
    )
    valid, unique, predicate = index_state(requests_db, _QUEUE_INDEX)
    assert valid and not unique and predicate == ""
    assert "(state, target_device_id)" in index_definition(requests_db, _QUEUE_INDEX)


@_needs_pg
def test_a_minimal_request_gets_its_defaults(requests_db: Engine) -> None:
    with requests_db.begin() as conn:
        request_id = _insert_request(conn, kind="compile", candidate_key=None)
        row = conn.execute(
            text(
                f"SELECT state, created_at IS NOT NULL, verdict, result "
                f"FROM coord.{_TABLE} WHERE id = :id"
            ),
            {"id": request_id},
        ).one()
    assert tuple(row) == ("pending", True, None, None)


@_needs_pg
@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"kind": "explain"}, "ck_maintenance_agent_requests_kind"),
        ({"state": "running"}, "ck_maintenance_agent_requests_state"),
        ({"verdict": "maybe"}, "ck_maintenance_agent_requests_verdict"),
        ({"confidence": 1.5}, "ck_maintenance_agent_requests_confidence"),
        ({"confidence": -0.1}, "ck_maintenance_agent_requests_confidence"),
    ],
)
def test_closed_vocabularies_refuse_another_word(
    requests_db: Engine, overrides: dict[str, object], constraint: str
) -> None:
    def write(conn: Connection) -> None:
        _insert_request(conn, candidate_key=str(uuid.uuid4()), **overrides)

    assert _refused_by(requests_db, write) == constraint


@_needs_pg
def test_the_answer_shapes_are_accepted(requests_db: Engine) -> None:
    with requests_db.begin() as conn:
        _insert_request(
            conn,
            candidate_key=str(uuid.uuid4()),
            state="answered",
            verdict="yes",
            confidence=0.9,
            rationale="merged upstream",
        )
        _insert_request(
            conn,
            kind="compile",
            target_device_id=None,
            candidate_key=None,
            state="answered",
            result='{"name": "reset", "predicates": []}',
        )


@_needs_pg
def test_one_verdict_request_per_task_candidate_and_question(
    requests_db: Engine,
) -> None:
    with requests_db.begin() as conn:
        task_id = _insert_task(conn)
        _insert_request(conn, task_id=task_id, candidate_key="k|b|1")

    def duplicate(conn: Connection) -> None:
        _insert_request(conn, task_id=task_id, candidate_key="k|b|1")

    assert _refused_by(requests_db, duplicate) == _DEDUPE_INDEX

    with requests_db.begin() as conn:
        # A moved head is a new candidate; another question is a new request;
        # compile requests are not deduped at all.
        _insert_request(conn, task_id=task_id, candidate_key="k|b|2")
        _insert_request(conn, task_id=task_id, candidate_key="k|b|1", question="Q2")
        _insert_request(conn, kind="compile", task_id=task_id, candidate_key="k|b|1")
        _insert_request(conn, kind="compile", task_id=task_id, candidate_key="k|b|1")
        # The enqueue arbiter restates the partial predicate.
        inserted = conn.execute(
            text(
                f"""
                INSERT INTO coord.{_TABLE}
                    (tenant_id, kind, task_id, candidate_key, question, prompt,
                     requested_by, expires_at)
                VALUES (:t, 'verdict', :task, 'k|b|1', 'Is this branch abandoned?',
                        'p', 'coord:maintenance', now() + interval '1 hour')
                ON CONFLICT (task_id, candidate_key, question)
                    WHERE kind = 'verdict' DO NOTHING
                RETURNING id
                """
            ),
            {"t": _TENANT, "task": task_id},
        ).all()
    assert inserted == []


@_needs_pg
def test_task_delete_cascades_and_run_delete_nulls(requests_db: Engine) -> None:
    with requests_db.begin() as conn:
        task_id = _insert_task(conn)
        run_id = _insert_run(conn, task_id)
        request_id = _insert_request(
            conn, task_id=task_id, run_id=run_id, candidate_key="fk|b|1"
        )
        conn.execute(
            text("DELETE FROM coord.maintenance_runs WHERE id = :r"), {"r": run_id}
        )
        kept = conn.execute(
            text(f"SELECT task_id, run_id FROM coord.{_TABLE} WHERE id = :id"),
            {"id": request_id},
        ).one()
        assert tuple(kept) == (task_id, None)
        conn.execute(
            text("DELETE FROM coord.maintenance_tasks WHERE id = :t"), {"t": task_id}
        )
        gone = conn.execute(
            text(f"SELECT count(*) FROM coord.{_TABLE} WHERE id = :id"),
            {"id": request_id},
        ).scalar_one()
    assert gone == 0

    def dangling(conn: Connection) -> None:
        _insert_request(conn, task_id=uuid.uuid4(), candidate_key="fk|b|2")

    assert _refused_by(requests_db, dangling) == "fk_maintenance_agent_requests_task"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "mar01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            _insert_request(conn)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for index in _INDEXES:
            assert index_exists(engine, index), index
        assert _count(engine) == 1


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "mar01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            _insert_request(conn)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        for index in _INDEXES:
            assert not index_exists(engine, index), index
        # The referenced Phase 1 tables are not this revision's and survive.
        assert table_exists(engine, _SCHEMA, "maintenance_tasks")
        assert table_exists(engine, _SCHEMA, "maintenance_runs")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine) == 0
