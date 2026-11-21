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
3. The created table is not named ``maintenance_`` + ``verdicts``: that name
   already appears on web trunk (the Phase 1 migration), and the new-table
   proof greps trunk for the created table's name, so it would be refuted.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults, in contract order.
5. The four indexes by definition, the CHECKs, the dedupe, and the FK actions.
6. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import secrets
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
_PARENT_REVISION_ID = "coord_policy_outcome_counts_02"

_SCHEMA = "coord"
_TABLE = "maintenance_agent_requests"
_DEDUPE_INDEX = "ux_maintenance_agent_requests_verdict_dedupe"
_PENDING_INDEX = "idx_maintenance_agent_requests_pending"
_TASK_INDEX = "idx_maintenance_agent_requests_task_id"
_RUN_INDEX = "idx_maintenance_agent_requests_run_id"
_INDEXES = (_DEDUPE_INDEX, _PENDING_INDEX, _TASK_INDEX, _RUN_INDEX)

# The table must not be given this name: it already appears on web trunk (the
# Phase 1 migration), and coord's new-table proof greps trunk for the created
# table's name, so a table of this name could never be proven new. Built from
# parts so this file does not spell it either.
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
    "SET LOCAL lock_timeout = '3s'",
    f"DROP INDEX IF EXISTS {_SCHEMA}.{_RUN_INDEX}",
    f"DROP INDEX IF EXISTS {_SCHEMA}.{_TASK_INDEX}",
    f"DROP INDEX IF EXISTS {_SCHEMA}.{_PENDING_INDEX}",
    f"DROP INDEX IF EXISTS {_SCHEMA}.{_DEDUPE_INDEX}",
    f"DROP TABLE IF EXISTS {_SCHEMA}.{_TABLE}",
    "SET LOCAL lock_timeout = DEFAULT",
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


def test_no_other_revision_forks_from_the_same_parent() -> None:
    """A second child of the parent is a fork: re-point this revision."""
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        r"^down_revision(?::[^=]*)?\s*=\s*[\(\[]?\s*[\"']"
        rf"{re.escape(_PARENT_REVISION_ID)}[\"']",
        re.M,
    )
    forks = [
        f.name
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert forks == [], (
        f"{forks} also revise {_PARENT_REVISION_ID!r}; re-point down_revision, "
        "the Revises: line and _PARENT_REVISION_ID at the current single head"
    )


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)
    assert "2026-06-08-coord-scheduled-maintenance-subsystem" in source


# ---------------------------------------------------------------------------
# 2-3. statement shapes
# ---------------------------------------------------------------------------


def test_the_created_table_is_not_the_name_trunk_already_carries() -> None:
    create = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)", re.I)
    created = [
        m.group(1).lower()
        for call in upgrade_execute_calls(_revision_path())
        if (m := create.search(_collapsed(call.sql)))
    ]
    assert created == [f"{_SCHEMA}.{_TABLE}"], created
    assert all(name.split(".")[-1] != _RETIRED_NAME for name in created)
    # And the revision text never spells it, so no reader mistakes the two.
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


_SHARED_TASK = uuid.UUID("00000000-0000-4000-8000-00000000e001")


def _shared_task(conn: Connection) -> uuid.UUID:
    """A task row every default verdict request can name (created once)."""
    conn.execute(
        text(
            """
            INSERT INTO coord.maintenance_tasks
                (id, tenant_id, name, target_selector, action, schedule_gate)
            VALUES (:id, :t, 'shared', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {"id": _SHARED_TASK, "t": str(_TENANT)},
    )
    return _SHARED_TASK


def _insert_request(conn: Connection, **overrides: object) -> uuid.UUID:
    row: dict[str, object] = {
        "tenant_id": _TENANT,
        "kind": "verdict",
        "task_id": _SHARED_TASK if "task_id" in overrides else _shared_task(conn),
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
    assert (
        "(task_id, target_device_id, md5(candidate_key), md5(question))"
    ) in index_definition(requests_db, _DEDUPE_INDEX)
    valid, unique, predicate = index_state(requests_db, _PENDING_INDEX)
    assert valid and not unique
    assert predicate == "(state = 'pending'::text)", predicate
    assert "(target_device_id, tenant_id)" in index_definition(
        requests_db, _PENDING_INDEX
    )
    for index, column in ((_TASK_INDEX, "task_id"), (_RUN_INDEX, "run_id")):
        valid, unique, predicate = index_state(requests_db, index)
        assert valid and not unique and predicate == "", index
        assert f"({column})" in index_definition(requests_db, index), index


@_needs_pg
def test_a_minimal_request_gets_its_defaults(requests_db: Engine) -> None:
    """Only the NOT NULL columns with no default: the rest default or are NULL."""
    with requests_db.begin() as conn:
        row = conn.execute(
            text(
                f"""
                INSERT INTO coord.{_TABLE}
                    (tenant_id, kind, question, prompt, requested_by, expires_at)
                VALUES (:t, 'compile', 'describe a rule', 'p', 'operator:test',
                        now() + interval '1 hour')
                RETURNING id IS NOT NULL, state, created_at IS NOT NULL,
                          task_id, run_id, target_device_id, candidate_key,
                          repo_path, min_confidence, claimed_by_device,
                          claimed_at, verdict, confidence, rationale, result,
                          error, answered_at
                """
            ),
            {"t": _TENANT},
        ).one()
    assert tuple(row) == (True, "pending", True) + (None,) * 14


@_needs_pg
@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"kind": "explain"}, "ck_maintenance_agent_requests_kind"),
        ({"state": "running"}, "ck_maintenance_agent_requests_state"),
        ({"verdict": "maybe"}, "ck_maintenance_agent_requests_verdict"),
        ({"confidence": 1.5}, "ck_maintenance_agent_requests_confidence"),
        ({"confidence": -0.1}, "ck_maintenance_agent_requests_confidence"),
        ({"min_confidence": 1.5}, "ck_maintenance_agent_requests_min_confidence"),
        ({"min_confidence": -0.1}, "ck_maintenance_agent_requests_min_confidence"),
        ({"task_id": None}, "ck_maintenance_agent_requests_verdict_fields"),
        ({"target_device_id": None}, "ck_maintenance_agent_requests_verdict_fields"),
        ({"repo_path": None}, "ck_maintenance_agent_requests_verdict_fields"),
    ],
)
def test_closed_vocabularies_refuse_another_word(
    requests_db: Engine, overrides: dict[str, object], constraint: str
) -> None:
    def write(conn: Connection) -> None:
        _insert_request(conn, candidate_key=str(uuid.uuid4()), **overrides)

    assert _refused_by(requests_db, write) == constraint


@_needs_pg
def test_a_verdict_needs_its_fields_and_a_compile_does_not(
    requests_db: Engine,
) -> None:
    def no_candidate(conn: Connection) -> None:
        _insert_request(conn, task_id=_shared_task(conn), candidate_key=None)

    assert (
        _refused_by(requests_db, no_candidate)
        == "ck_maintenance_agent_requests_verdict_fields"
    )
    with requests_db.begin() as conn:
        _insert_request(
            conn,
            kind="compile",
            task_id=None,
            target_device_id=None,
            candidate_key=None,
            repo_path=None,
            min_confidence=None,
        )


def _enqueue_verdict(
    conn: Connection,
    task_id: uuid.UUID,
    candidate_key: str,
    question: str,
    device: uuid.UUID = _DEVICE,
) -> list[object]:
    """The coord enqueue: insert a verdict request unless one already exists."""
    return list(
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_TABLE}
                    (tenant_id, kind, task_id, target_device_id, candidate_key,
                     repo_path, question, prompt, requested_by, expires_at)
                VALUES (:t, 'verdict', :task, :d, :key, 'D:/repo', :q, 'p',
                        'coord:maintenance', now() + interval '1 hour')
                ON CONFLICT (task_id, target_device_id, md5(candidate_key),
                             md5(question))
                    WHERE kind = 'verdict' DO NOTHING
                RETURNING id
                """
            ),
            {
                "t": _TENANT,
                "task": task_id,
                "d": device,
                "key": candidate_key,
                "q": question,
            },
        ).all()
    )


@_needs_pg
def test_incompressible_long_dedupe_text_fits_and_dedupes(requests_db: Engine) -> None:
    """A raw-text unique fails past the 2704-byte btree row; the md5 key does not."""
    question = secrets.token_hex(2000)
    candidate_key = secrets.token_hex(1000)
    assert (len(question), len(candidate_key)) == (4000, 2000)
    with requests_db.begin() as conn:
        task_id = _insert_task(conn)
        assert len(_enqueue_verdict(conn, task_id, candidate_key, question)) == 1
    with requests_db.begin() as conn:
        assert _enqueue_verdict(conn, task_id, candidate_key, question) == []
        stored = conn.execute(
            text(
                f"SELECT count(*) FROM coord.{_TABLE} "
                "WHERE task_id = :task AND question = :q AND candidate_key = :key"
            ),
            {"task": task_id, "q": question, "key": candidate_key},
        ).scalar_one()
    assert stored == 1


_CLAIM = {"claimed_by_device": _DEVICE}
_ANSWER = {**_CLAIM, "verdict": "no", "confidence": 0.5}


def _state_row(conn: Connection, state: str, **fields: object) -> uuid.UUID:
    """A verdict request in ``state``; ``*_at`` fields given as True are now()."""
    stamps = {k for k, v in fields.items() if v is True}
    values = {k: v for k, v in fields.items() if k not in stamps}
    values.setdefault("candidate_key", str(uuid.uuid4()))
    request_id = _insert_request(conn, state="pending", **values)
    sets = ", ".join(["state = :state"] + [f"{k} = now()" for k in sorted(stamps)])
    conn.execute(
        text(f"UPDATE coord.{_TABLE} SET {sets} WHERE id = :id"),
        {"state": state, "id": request_id},
    )
    return request_id


@_needs_pg
@pytest.mark.parametrize(
    ("state", "fields"),
    [
        ("claimed", {"claimed_at": True}),
        ("claimed", {**_CLAIM}),
        ("answered", {**_ANSWER, "answered_at": True}),
        ("answered", {**_CLAIM, "verdict": "no", "claimed_at": True}),
        (
            "answered",
            {"claimed_by_device": _DEVICE, "claimed_at": True, "answered_at": True},
        ),
        ("failed", {**_CLAIM, "claimed_at": True}),
        (
            "answered",
            {**_CLAIM, "kind": "compile", "claimed_at": True, "answered_at": True},
        ),
    ],
    ids=[
        "claimed-no-device",
        "claimed-no-claimed-at",
        "answered-no-claimed-at",
        "answered-no-answered-at",
        "answered-no-verdict-or-result",
        "failed-no-error",
        "answered-compile-no-result",
    ],
)
def test_a_state_refuses_a_row_missing_its_fields(
    requests_db: Engine, state: str, fields: dict[str, object]
) -> None:
    def write(conn: Connection) -> None:
        _state_row(conn, state, **fields)

    assert _refused_by(requests_db, write) == (
        "ck_maintenance_agent_requests_state_fields"
    )


@_needs_pg
@pytest.mark.parametrize(
    ("state", "fields"),
    [
        ("pending", {}),
        ("expired", {}),
        ("claimed", {**_CLAIM, "claimed_at": True}),
        ("answered", {**_ANSWER, "claimed_at": True, "answered_at": True}),
        (
            "answered",
            {
                **_CLAIM,
                "kind": "compile",
                "result": '{"name": "reset"}',
                "claimed_at": True,
                "answered_at": True,
            },
        ),
        ("failed", {"error": "unparseable claude output: x"}),
    ],
    ids=[
        "pending",
        "expired",
        "claimed",
        "answered-verdict",
        "answered-compile-result",
        "failed-unclaimed",
    ],
)
def test_a_state_accepts_a_row_carrying_its_fields(
    requests_db: Engine, state: str, fields: dict[str, object]
) -> None:
    with requests_db.begin() as conn:
        request_id = _state_row(conn, state, **fields)
        got = conn.execute(
            text(f"SELECT state FROM coord.{_TABLE} WHERE id = :id"),
            {"id": request_id},
        ).scalar_one()
    assert got == state


@_needs_pg
@pytest.mark.parametrize(
    ("state", "fields"),
    [
        ("pending", {"kind": "compile", "verdict": "yes"}),
        ("pending", {"kind": "compile", "confidence": 0.5}),
        ("pending", {"result": '{"name": "reset"}'}),
        (
            "answered",
            {
                **_CLAIM,
                "kind": "compile",
                "verdict": "yes",
                "claimed_at": True,
                "answered_at": True,
            },
        ),
        (
            "answered",
            {
                **_CLAIM,
                "result": '{"name": "reset"}',
                "claimed_at": True,
                "answered_at": True,
            },
        ),
    ],
    ids=[
        "compile-carrying-verdict",
        "compile-carrying-confidence",
        "verdict-carrying-result",
        "answered-compile-with-only-verdict",
        "answered-verdict-with-only-result",
    ],
)
def test_a_kind_refuses_the_other_kinds_answer_fields(
    requests_db: Engine, state: str, fields: dict[str, object]
) -> None:
    def write(conn: Connection) -> None:
        _state_row(conn, state, **fields)

    assert _refused_by(requests_db, write) == (
        "ck_maintenance_agent_requests_answer_kind"
    )


_REARM = f"""
    INSERT INTO coord.{_TABLE}
        (tenant_id, kind, task_id, target_device_id, candidate_key, repo_path,
         question, prompt, min_confidence, requested_by, expires_at)
    VALUES (:t, 'verdict', :task, :d, :key, 'D:/repo-v2', :q, 'prompt v2', 0.8,
            'coord:maintenance', now() + interval '2 hours')
    ON CONFLICT (task_id, target_device_id, md5(candidate_key), md5(question))
        WHERE kind = 'verdict'
    DO UPDATE SET state = 'pending', claimed_by_device = NULL,
        claimed_at = NULL, answered_at = NULL, verdict = NULL,
        confidence = NULL, rationale = NULL, error = NULL,
        expires_at = EXCLUDED.expires_at, run_id = EXCLUDED.run_id,
        prompt = EXCLUDED.prompt,
        min_confidence = EXCLUDED.min_confidence,
        repo_path = EXCLUDED.repo_path
    WHERE {_TABLE}.state IN ('expired', 'failed')
       OR ({_TABLE}.state = 'answered' AND {_TABLE}.expires_at < now())
    RETURNING id
"""

_QUESTION = "Is this branch abandoned?"


def _rearm(
    conn: Connection, task_id: uuid.UUID, key: str, device: uuid.UUID = _DEVICE
) -> list[uuid.UUID]:
    return [
        _uuid(row[0])
        for row in conn.execute(
            text(_REARM),
            {"t": _TENANT, "task": task_id, "d": device, "key": key, "q": _QUESTION},
        ).all()
    ]


def _request_row(conn: Connection, request_id: uuid.UUID) -> dict[str, object]:
    row = (
        conn.execute(
            text(
                f"""
                SELECT state, claimed_by_device, claimed_at, answered_at, verdict,
                       confidence, rationale, error, prompt, min_confidence,
                       repo_path
                  FROM coord.{_TABLE} WHERE id = :id
                """
            ),
            {"id": request_id},
        )
        .mappings()
        .one()
    )
    return dict(row)


# Each prior row carries every field the re-arm clears, where its state allows.
_OLD = {"rationale": "old rationale", "min_confidence": 0.3, "question": _QUESTION}
_PRIOR_ROWS: dict[str, tuple[str, dict[str, object], bool]] = {
    # id: (state, fields, past its expires_at)
    "expired": (
        "expired",
        {**_OLD, **_CLAIM, "claimed_at": True, "error": "timed out"},
        True,
    ),
    "failed": (
        "failed",
        {**_OLD, **_CLAIM, "claimed_at": True, "error": "unparseable output"},
        False,
    ),
    "answered-unexpired": (
        "answered",
        {**_OLD, **_ANSWER, "claimed_at": True, "answered_at": True},
        False,
    ),
    "answered-past-ttl": (
        "answered",
        {
            **_OLD,
            **_ANSWER,
            "verdict": "unknown",
            "claimed_at": True,
            "answered_at": True,
        },
        True,
    ),
    "pending": ("pending", {**_OLD}, False),
    "claimed": ("claimed", {**_OLD, **_CLAIM, "claimed_at": True}, False),
}
_REARMED = {"expired", "failed", "answered-past-ttl"}


@_needs_pg
@pytest.mark.parametrize("case", sorted(_PRIOR_ROWS))
def test_the_rearm_upsert_by_prior_state(requests_db: Engine, case: str) -> None:
    state, fields, past_ttl = _PRIOR_ROWS[case]
    key = f"rearm|{case}|{uuid.uuid4().hex}"
    with requests_db.begin() as conn:
        task_id = _insert_task(conn)
        request_id = _state_row(
            conn, state, task_id=task_id, candidate_key=key, **fields
        )
        if past_ttl:
            conn.execute(
                text(
                    f"UPDATE coord.{_TABLE} "
                    "SET expires_at = now() - interval '1 minute' WHERE id = :id"
                ),
                {"id": request_id},
            )
        before = _request_row(conn, request_id)

    with requests_db.begin() as conn:
        returned = _rearm(conn, task_id, key)
        after = _request_row(conn, request_id)

    if case in _REARMED:
        assert returned == [request_id]
        assert after["state"] == "pending"
        for cleared in (
            "claimed_by_device",
            "claimed_at",
            "answered_at",
            "verdict",
            "confidence",
            "rationale",
            "error",
        ):
            assert after[cleared] is None, (cleared, after)
        assert after["prompt"] == "prompt v2"
        assert after["repo_path"] == "D:/repo-v2"
        assert after["min_confidence"] == pytest.approx(0.8)
    else:
        assert returned == []
        assert after == before


@_needs_pg
def test_two_devices_with_the_same_candidate_get_two_rows(requests_db: Engine) -> None:
    other_device = uuid.UUID("00000000-0000-4000-8000-00000000d002")
    key = f"D:/repo|main|{uuid.uuid4().hex}"
    with requests_db.begin() as conn:
        task_id = _insert_task(conn)
        row_a = _enqueue_verdict(conn, task_id, key, _QUESTION, device=_DEVICE)
        row_b = _enqueue_verdict(conn, task_id, key, _QUESTION, device=other_device)
        assert len(row_a) == 1 and len(row_b) == 1
        id_a = _uuid(row_a[0][0])  # type: ignore[index]
        id_b = _uuid(row_b[0][0])  # type: ignore[index]
        assert id_a != id_b
        # Device A answered; device B failed.
        conn.execute(
            text(
                f"""
                UPDATE coord.{_TABLE}
                   SET state = 'answered', claimed_by_device = :d,
                       claimed_at = now(), answered_at = now(), verdict = 'yes',
                       confidence = 0.9
                 WHERE id = :id
                """
            ),
            {"d": _DEVICE, "id": id_a},
        )
        conn.execute(
            text(
                f"""
                UPDATE coord.{_TABLE}
                   SET state = 'failed', error = 'no answer'
                 WHERE id = :id
                """
            ),
            {"id": id_b},
        )
        before_a = _request_row(conn, id_a)

    with requests_db.begin() as conn:
        # Re-enqueuing for B re-arms B alone; re-enqueuing for A changes nothing.
        assert _rearm(conn, task_id, key, device=other_device) == [id_b]
        assert (
            _enqueue_verdict(conn, task_id, key, _QUESTION, device=other_device) == []
        )
        assert _rearm(conn, task_id, key, device=_DEVICE) == []
        assert _request_row(conn, id_a) == before_a
        assert _request_row(conn, id_b)["state"] == "pending"
        count = conn.execute(
            text(
                f"SELECT count(*) FROM coord.{_TABLE} "
                "WHERE task_id = :task AND candidate_key = :key"
            ),
            {"task": task_id, "key": key},
        ).scalar_one()
    assert count == 2


@_needs_pg
def test_the_answer_shapes_are_accepted(requests_db: Engine) -> None:
    with requests_db.begin() as conn:
        _insert_request(
            conn,
            candidate_key=str(uuid.uuid4()),
            state="answered",
            claimed_by_device=_DEVICE,
            claimed_at="2026-11-21T00:00:00Z",
            answered_at="2026-11-21T00:01:00Z",
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
            claimed_by_device=_DEVICE,
            claimed_at="2026-11-21T00:00:00Z",
            answered_at="2026-11-21T00:01:00Z",
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
        # The enqueue arbiter restates the md5 expressions and the predicate.
        inserted = _enqueue_verdict(conn, task_id, "k|b|1", "Is this branch abandoned?")
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
