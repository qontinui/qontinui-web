"""Behaviour tests for the ``coord_agent_status_session_01`` revision.

Phase 1 of plan ``2026-11-11-intent-overlap-excludes-the-callers-whole-device``
is the EXPAND half of making ``coord.agent_status`` session-grain. The revision
adds ``agent_session_id UUID NOT NULL DEFAULT <nil UUID>`` and one partial
index built CONCURRENTLY. It builds no unique index and leaves the 3-column
primary key alone: the session-grain unique key is plan Phase 6a's. This pins:

1. **Source shapes** (no database). The pinned parent is the revision's
   ``down_revision``. Every ``op.execute`` in ``upgrade()`` is one static
   literal. The ACCESS EXCLUSIVE wait of ``ADD COLUMN`` in ``upgrade()`` and of
   ``DROP COLUMN`` in ``downgrade()`` is bounded: scanning back over the
   ``op.execute`` literals before each, without crossing an
   ``autocommit_block``, the nearest one that touches ``lock_timeout`` is a
   non-zero ``SET LOCAL``. (A shape-level check: it does not parse
   transaction-control literals, an ``autocommit_block`` that holds no
   ``op.execute``, or non-literal SQL.) In ``upgrade()`` every ``lock_timeout`` statement
   outside the ``autocommit_block`` is a ``SET LOCAL`` and none is inside it,
   so no bound reaches the one CONCURRENTLY build, which a lock timeout would
   fail. The upgrade path creates no UNIQUE index, drops nothing, and touches
   no primary key.

Items 2 to 11 are one DB walk. It drives the revision only through
``run_alembic``, exactly as alembic runs ``upgrade()`` and ``downgrade()``,
and names none of the revision's private helpers.

2. **Absent at the parent**, so the walk cannot pass vacuously.
3. **The column** is ``uuid NOT NULL`` with the nil default, and its catalog
   comment says the nil UUID means unattributed. A row written before the
   revision reads the nil UUID.
4. **The partial index is VALID**, with key and predicate checked as Postgres
   renders them, and the primary key is still the table's ONLY unique index.
   Coord's live ``ON CONFLICT (device_id, work_unit_id, tenant_id) DO UPDATE``
   would check a second one with an immediate uniqueness check, so a
   concurrent first insert of one key could fail 23505 instead of updating.
5. **Coord's live writes still work.** Coord's two upserts, verbatim, are each
   run twice for one key. The first call inserts and takes the column's
   DEFAULT, and the second takes the update, leaving one row.
6. **Phase 2's write premise**, with the 4-column key built inside a
   transaction that is rolled back. ``agent_status_pkey`` refuses a second
   session on one (device, unit, tenant). ``ON CONFLICT DO NOTHING`` with no
   arbiter absorbs that refusal, and an arbiter on the 4-column key does not.
7. **The contract is ready**, in the same rolled-back transaction. Phase 6a's
   one-statement key swap succeeds on that index, keeps two sibling sessions'
   rows, and still collapses nil writers.
8. **A re-run is idempotent** after ``stamp`` back to the parent. The VALID
   index is not rebuilt, no INVALID warning is logged, and a stamped row keeps
   its session.
9. **The INVALID-index branch** (superuser only). A re-run logs a warning
   naming the index, and REINDEXes it: VALID again, same oid, new storage file.
10. **A downgrade past Phase 6a's key fails closed.** With the swap committed
    in this scratch database, the downgrade raises, and the 4-column key, the
    column, the index, the rows and the recorded revision are all untouched.
    Without the guard, ``DROP COLUMN`` would silently drop the primary key.
11. **Downgrade** drops the index and the column. The rows and the 3-column
    key survive, and a second upgrade re-applies cleanly.

12. **The REINDEX is bounded, and the bound ends with its transaction**, in a
    separate DB test that calls the REINDEX helper directly. With a writer open
    on the table it fails with a lock timeout (55P03) instead of queueing, and
    it rolls back its transaction. Without the writer the same call succeeds,
    and leaves the session's ``lock_timeout`` as it found it, so no bound
    outlives the REINDEX's transaction to reach the CONCURRENTLY build that
    follows it in ``upgrade()``.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import time
import uuid
import warnings
from pathlib import Path
from typing import Any

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine, Row
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    index_definition,
    index_exists,
    index_filenode,
    index_oid,
    index_state,
    invalidate_index,
    is_superuser,
    load_revision_module,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head", so a later revision landing on top
# cannot change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision`, and the first test enforces it.
_REVISION_ID = "coord_agent_status_session_01"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_REVISION_FILENAME = "coord_agent_status_session_01.py"

_TABLE = "agent_status"
_COLUMN = "agent_session_id"
_INDEX = "idx_agent_status_session"
_PK = "agent_status_pkey"
_OLD_KEY = ["device_id", "work_unit_id", "tenant_id"]
_NEW_KEY = [*_OLD_KEY, "agent_session_id"]
_NIL = uuid.UUID(int=0)
_INVALID_WARNING = "coord.idx_agent_status_session is INVALID"

# Plan Phase 6a's contract: build the session-grain key, then swap the primary
# key onto it. 6a builds the index CONCURRENTLY, which cannot run inside a
# transaction, so the test builds the same index plainly, inside a transaction
# it rolls back.
_SESSION_GRAIN_KEY_SQL = """
    CREATE UNIQUE INDEX uq_agent_status_session_grain
    ON coord.agent_status (device_id, work_unit_id, tenant_id, agent_session_id)
"""
_KEY_SWAP_SQL = """
    ALTER TABLE coord.agent_status
        DROP CONSTRAINT agent_status_pkey,
        ADD CONSTRAINT agent_status_pkey
            PRIMARY KEY USING INDEX uq_agent_status_session_grain
"""
# Swaps the 3-column key back, as 6a's own downgrade will.
_KEY_RESTORE_SQL = """
    ALTER TABLE coord.agent_status
        DROP CONSTRAINT agent_status_pkey,
        ADD CONSTRAINT agent_status_pkey
            PRIMARY KEY (device_id, work_unit_id, tenant_id)
"""
_NIL_MEANS_UNATTRIBUTED = (
    "the nil UUID 00000000-0000-0000-0000-000000000000 means unattributed"
)
_DOWNGRADE_REFUSED = "downgrade refused: agent_session_id is a column of"

# Coord's two LIVE writes to this table, as `upsert` and `upsert_intent_globs`
# in qontinui-coord crates/coord/src/agent_status.rs issue them (read at
# e1ab20bc6). STATUS_TTL ('1 hour') and ROW_COLUMNS are inlined, and the
# positional parameters are named. Neither names agent_session_id, so each
# INSERT takes the column's DEFAULT.
_COORD_RETURNING = """
    RETURNING device_id, tenant_id, correlation_topic, work_unit_id,
              status_text, blocked_on, intent_globs, updated_at, expires_at
"""
_COORD_UPSERT_SQL = (
    """
    INSERT INTO coord.agent_status
        (device_id, tenant_id, correlation_topic, work_unit_id, status_text,
         blocked_on, intent_globs, updated_at, expires_at)
    VALUES (:device, :tenant, :topic, :unit, :status, :blocked, :globs, now(),
            now() + interval '1 hour')
    ON CONFLICT (device_id, work_unit_id, tenant_id) DO UPDATE SET
        correlation_topic = EXCLUDED.correlation_topic,
        status_text       = EXCLUDED.status_text,
        blocked_on        = EXCLUDED.blocked_on,
        intent_globs      = COALESCE(EXCLUDED.intent_globs,
                                     coord.agent_status.intent_globs),
        updated_at        = now(),
        expires_at        = now() + interval '1 hour'
    """
    + _COORD_RETURNING
)
_COORD_DECLARE_SQL = (
    """
    INSERT INTO coord.agent_status
        (device_id, tenant_id, correlation_topic, work_unit_id, status_text,
         blocked_on, intent_globs, updated_at, expires_at)
    VALUES (:device, :tenant, :topic, :unit, 'declared intent', NULL, :globs,
            now(), now() + interval '1 hour')
    ON CONFLICT (device_id, work_unit_id, tenant_id) DO UPDATE SET
        correlation_topic = EXCLUDED.correlation_topic,
        intent_globs      = EXCLUDED.intent_globs,
        updated_at        = now(),
        expires_at        = now() + interval '1 hour'
    """
    + _COORD_RETURNING
)

# A write that names the new column, as plan Phase 2's write will.
_INSERT_SQL = """
    INSERT INTO coord.agent_status
        (device_id, tenant_id, correlation_topic, work_unit_id, status_text,
         expires_at, agent_session_id)
    VALUES
        (:device, :tenant, 'intent', :unit, 'working',
         now() + interval '1 hour', :session)
"""

# The same write as `_INSERT_SQL`, before the column exists.
_LEGACY_INSERT_SQL = """
    INSERT INTO coord.agent_status
        (device_id, tenant_id, correlation_topic, work_unit_id, status_text,
         expires_at)
    VALUES
        (:device, :tenant, 'intent', :unit, 'working', now() + interval '1 hour')
"""


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both together."
    )


# A `SET LOCAL lock_timeout` and its leading number, as the upper-cased
# statement text reads ('3S', 3000, TO '3S').
_SET_LOCAL_LOCK_TIMEOUT = re.compile(
    r"\s*SET\s+LOCAL\s+LOCK_TIMEOUT\s*(?:=|\bTO\b)\s*'?\s*(\d+)"
)


def _is_nonzero_set_local_lock_timeout(statement: str) -> bool:
    """True for a ``SET LOCAL lock_timeout`` to a non-zero value. Zero disables it."""
    match = _SET_LOCAL_LOCK_TIMEOUT.match(statement)
    return match is not None and int(match.group(1)) > 0


@pytest.mark.parametrize(
    ("function", "column_ddl"),
    [("upgrade", "ADD COLUMN"), ("downgrade", "DROP COLUMN")],
)
def test_the_column_ddl_lock_wait_is_bounded(function: str, column_ddl: str) -> None:
    """The nearest ``lock_timeout`` statement before the DDL is a non-zero SET LOCAL.

    ``ADD COLUMN`` and ``DROP COLUMN`` take ACCESS EXCLUSIVE, and a queued ACCESS
    EXCLUSIVE request blocks every reader and writer behind it. The bound must be
    in force when the statement runs. So the nearest statement before it that
    touches ``lock_timeout`` must be a non-zero ``SET LOCAL``, with no
    ``autocommit_block`` in between, because a block's COMMIT would end an
    earlier ``SET LOCAL``. A ``RESET`` there, or ``= '0'``, leaves the wait
    unbounded.
    """
    calls = upgrade_execute_calls(_revision_path(), function=function)
    statements = [(call.sql or "").upper() for call in calls]
    at = [i for i, sql in enumerate(statements) if column_ddl in sql]
    assert len(at) == 1, f"exactly one {column_ddl} in {function}()"
    assert not calls[at[0]].in_autocommit_block
    nearest = None
    for i in range(at[0] - 1, -1, -1):
        if calls[i].in_autocommit_block:
            break
        if "LOCK_TIMEOUT" in statements[i]:
            nearest = statements[i]
            break
    assert nearest is not None and _is_nonzero_set_local_lock_timeout(nearest), (
        f"the nearest lock_timeout statement before the {column_ddl}, in its "
        f"transaction, must be a non-zero SET LOCAL; found {nearest!r}"
    )


def test_upgrade_reaches_reindex_only_through_the_bounded_helper() -> None:
    """``upgrade()`` must not inline a REINDEX: only the helper bounds it."""
    import ast

    tree = ast.parse(_source())
    (upgrade_fn,) = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade"
    ]
    # Every REINDEX statement literal anywhere in upgrade() (op.execute, a bind
    # execute, dead code) must be an argument of the bounded helper. The
    # anchored match skips the warning text, which also mentions REINDEX.
    statements = [
        node
        for node in ast.walk(upgrade_fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and re.match(r"\s*REINDEX\b", node.value, re.IGNORECASE)
    ]
    helper_args = {
        id(arg)
        for node in ast.walk(upgrade_fn)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_reindex_in_own_transaction"
        for arg in node.args
    }
    assert statements, "upgrade() must reach its REINDEX through the helper"
    assert all(id(stmt) in helper_args for stmt in statements), (
        "upgrade() must not run a REINDEX outside the bounded helper"
    )


def test_upgrade_is_expand_only_and_concurrently_runs_unbounded() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert calls, "upgrade() must issue its DDL through op.execute"
    statements = []
    for call in calls:
        assert call.sql is not None, (
            "every upgrade op.execute must take ONE static string literal"
        )
        statements.append(call.sql.upper())
    concurrent = [
        call
        for call, sql in zip(calls, statements, strict=True)
        if "CONCURRENTLY" in sql
    ]
    assert len(concurrent) == 1, "exactly one CONCURRENTLY index build"
    (build,) = concurrent
    assert build.in_autocommit_block, (
        "CREATE INDEX CONCURRENTLY outside autocommit_block fails at runtime"
    )
    assert "IF NOT EXISTS" in (build.sql or "").upper()
    # A lock_timeout in force during a CONCURRENTLY build fails the build on
    # any older open transaction and leaves an INVALID index behind. So none may
    # be set inside the block, and every one outside it must be a SET LOCAL: a
    # session-level SET would survive the COMMIT that opens the block. This sees
    # only upgrade()'s own statements, not the REINDEX helper's, which
    # test_the_reindex_bound_is_scoped_to_its_own_transaction checks at runtime.
    for call, sql in zip(calls, statements, strict=True):
        if "LOCK_TIMEOUT" not in sql:
            continue
        assert not call.in_autocommit_block, sql
        assert re.match(r"\s*SET\s+LOCAL\s+LOCK_TIMEOUT\b", sql), (
            f"a lock_timeout outside the autocommit_block must be SET LOCAL: {sql}"
        )
    # Expand only. No second unique index while coord's live upsert arbitrates
    # on the primary key, and the key swap is plan Phase 6a's revision.
    for sql in statements:
        assert not re.search(
            r"\bUNIQUE\b|\bDROP\b|\bPRIMARY\s+KEY\b|\bCONSTRAINT\b", sql
        ), sql


def _tenant_and_device(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'Agent Status Session Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"agent-status-session-{uuid.uuid4().hex[:8]}"},
        )
        device_id = conn.execute(
            text(
                """
                INSERT INTO coord.devices (name, hostname, tenant_id)
                VALUES ('session-test', 'session-test-host', :t)
                RETURNING device_id
                """
            ),
            {"t": tenant_id},
        ).scalar_one()
    return tenant_id, uuid.UUID(str(device_id))


def _params(
    device: uuid.UUID, tenant: uuid.UUID, unit: str, session: uuid.UUID
) -> dict[str, object]:
    return {"device": device, "tenant": tenant, "unit": unit, "session": session}


def _coord_write(engine: Engine, sql: str, params: dict[str, object]) -> Row[Any]:
    """One of coord's live upserts, committed; its RETURNING row."""
    with engine.begin() as conn:
        return conn.execute(text(sql), params).one()


def _sessions(engine: Engine, device: uuid.UUID, unit: str) -> list[uuid.UUID]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT agent_session_id FROM coord.agent_status
                 WHERE device_id = :device AND work_unit_id = :unit
                 ORDER BY agent_session_id
                """
            ),
            {"device": device, "unit": unit},
        ).all()
    return [uuid.UUID(str(row[0])) for row in rows]


def _primary_key(conn: Connection) -> tuple[str, list[str]]:
    """``(constraint name, key columns in key order)`` of the primary key."""
    row = conn.execute(
        text(
            """
            SELECT c.conname, array_agg(a.attname::text ORDER BY k.ord)
              FROM pg_constraint c
              CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = k.attnum
             WHERE c.conrelid = CAST('coord.agent_status' AS regclass)
               AND c.contype = 'p'
             GROUP BY c.conname
            """
        )
    ).one()
    return str(row[0]), list(row[1])


def _unique_indexes(engine: Engine) -> list[str]:
    """Every unique index on ``coord.agent_status``, by name."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE i.indrelid = CAST('coord.agent_status' AS regclass)
                   AND i.indisunique
                 ORDER BY c.relname
                """
            )
        ).all()
    return [str(row[0]) for row in rows]


def _row_count(engine: Engine) -> int:
    return int(str(scalar(engine, "SELECT count(*) FROM coord.agent_status")))


def _refused_by(excinfo: pytest.ExceptionInfo[IntegrityError]) -> tuple[str, str]:
    """``(SQLSTATE, constraint)`` of a refused write."""
    orig = excinfo.value.orig
    return (
        str(getattr(orig, "pgcode", None)),
        str(getattr(getattr(orig, "diag", None), "constraint_name", None)),
    )


_requires_postgres = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)


@_requires_postgres
def test_the_reindex_bound_is_scoped_to_its_own_transaction() -> None:
    """Item 12: the INVALID-leftover REINDEX gives up on a busy table, and its
    lock bound ends with its own transaction.

    The one test here that calls a private helper of the revision directly. The
    DB walk reaches the same helper only through ``run_alembic``, and on an idle
    database, where neither property can show.
    """
    module = load_revision_module(
        _revision_path(), "coord_agent_status_session_01_under_test"
    )
    reindex = "REINDEX INDEX coord.idx_agent_status_session"

    def call_reindex(conn: Connection) -> None:
        with Operations.context(MigrationContext.configure(conn)):
            module._reindex_in_own_transaction(reindex)

    with ephemeral_database(admin_database_url(), "agent_status_reindex_test") as (
        engine,
        url,
    ):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        tenant, device = _tenant_and_device(engine)

        writer = engine.connect()
        writer_tx = writer.begin()
        # An uncommitted write holds ROW EXCLUSIVE, which REINDEX's SHARE waits on.
        writer.execute(text(_INSERT_SQL), _params(device, tenant, "unit-writer", _NIL))
        try:
            with engine.connect() as conn:
                conn.execution_options(isolation_level="AUTOCOMMIT")
                # Hang guard: an UNbounded REINDEX would wait for the writer
                # forever. This fails it with 57014 instead, which the 55P03
                # check rejects.
                conn.execute(text("SET statement_timeout = '20s'"))
                baseline = conn.execute(text("SHOW lock_timeout")).scalar_one()
                assert baseline != "3s", "the rollback check below needs another value"
                started = time.monotonic()
                with pytest.raises(DBAPIError) as excinfo:
                    call_reindex(conn)
                elapsed = time.monotonic() - started
                assert getattr(excinfo.value.orig, "pgcode", None) == "55P03", (
                    "the REINDEX must give up on the lock wait (lock_not_available), "
                    f"not wait it out: {excinfo.value}"
                )
                assert elapsed < 15, (
                    f"a bounded REINDEX gave up only after {elapsed:.1f}s"
                )
                # It rolled back: the SET LOCAL ended with its transaction, and
                # the session is out of the aborted transaction.
                assert conn.execute(text("SHOW lock_timeout")).scalar_one() == baseline
                assert conn.execute(text("SELECT 1")).scalar_one() == 1
                conn.execute(text("RESET statement_timeout"))
        finally:
            writer_tx.rollback()
            writer.close()

        # Without the writer, the same call goes through, and no bound outlives
        # its transaction. A session-level `SET lock_timeout` would survive the
        # COMMIT and be in force for the CONCURRENTLY build that follows the
        # REINDEX in upgrade(). The failure path above cannot see that, because
        # an aborted transaction reverts even a session-level SET.
        filenode = index_filenode(engine, _INDEX)
        with engine.connect() as conn:
            conn.execution_options(isolation_level="AUTOCOMMIT")
            before = conn.execute(text("SHOW lock_timeout")).scalar_one()
            assert before != "3s", (
                "the check below needs a value the REINDEX does not set"
            )
            call_reindex(conn)
            assert conn.execute(text("SHOW lock_timeout")).scalar_one() == before, (
                "the REINDEX's lock_timeout outlived its transaction: SET, not SET LOCAL"
            )
        assert index_state(engine, _INDEX)[0]
        assert index_filenode(engine, _INDEX) != filenode


@_requires_postgres
def test_coord_agent_status_session_01_expands_and_readies_the_contract() -> None:
    """The session column arrives beside the untouched 3-column key.

    Drives the revision only through ``run_alembic``: it names none of the
    revision's private helpers, directly or through a helper of this file.
    """
    root = backend_root()

    with ephemeral_database(admin_database_url(), "agent_status_session_test") as (
        engine,
        url,
    ):
        # 2. Parent revision: nothing yet. A row written here proves in step 3
        #    that the DDL default reaches rows that predate the column.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert not index_exists(engine, _INDEX)
        tenant, device = _tenant_and_device(engine)
        with engine.begin() as conn:
            conn.execute(
                text(_LEGACY_INSERT_SQL),
                {"device": device, "tenant": tenant, "unit": "unit-legacy"},
            )

        # 3. Apply. The column is uuid NOT NULL with the nil default, its comment
        #    names the sentinel, and the pre-existing row reads nil.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == (
            "uuid",
            "NO",
            "'00000000-0000-0000-0000-000000000000'::uuid",
        )
        comment = column_comment(engine, _TABLE, _COLUMN)
        assert comment is not None and _NIL_MEANS_UNATTRIBUTED in comment, comment
        assert _sessions(engine, device, "unit-legacy") == [_NIL]

        # 4. The partial index is VALID, with key and predicate as Postgres
        #    renders them. The primary key is still the ONLY unique index, and
        #    the table keeps its replica identity.
        valid, unique, predicate = index_state(engine, _INDEX)
        assert valid, "a killed CONCURRENTLY build leaves an INVALID index"
        assert not unique
        assert predicate == (
            "(agent_session_id <> '00000000-0000-0000-0000-000000000000'::uuid)"
        ), predicate
        assert "USING btree (agent_session_id) WHERE" in index_definition(
            engine, _INDEX
        )
        assert _unique_indexes(engine) == [_PK], (
            "a second unique index would make coord's live upsert fail 23505 on "
            "a concurrent first insert, until coord serves plan Phase 2"
        )
        with engine.connect() as conn:
            assert _primary_key(conn) == (_PK, _OLD_KEY)
        assert (
            scalar(
                engine,
                "SELECT relreplident FROM pg_class "
                "WHERE oid = CAST('coord.agent_status' AS regclass)",
            )
            == "d"
        )

        # 5. Coord's live writes, each run twice for one key: the first call
        #    inserts and takes the DEFAULT, the second takes the update.
        report = {
            "device": device,
            "tenant": tenant,
            "topic": "intent",
            "unit": "unit-report",
            "status": "working",
            "blocked": None,
            "globs": ["qontinui-web/backend/**"],
        }
        row = _coord_write(engine, _COORD_UPSERT_SQL, report)
        assert (row.status_text, row.intent_globs) == (
            "working",
            ["qontinui-web/backend/**"],
        )
        row = _coord_write(
            engine,
            _COORD_UPSERT_SQL,
            {**report, "status": "blocked", "blocked": "a peer", "globs": None},
        )
        # Only the DO UPDATE path keeps the stored globs through the COALESCE.
        assert (row.status_text, row.blocked_on, row.intent_globs) == (
            "blocked",
            "a peer",
            ["qontinui-web/backend/**"],
        )
        assert _sessions(engine, device, "unit-report") == [_NIL]
        declare = {
            "device": device,
            "tenant": tenant,
            "topic": "intent",
            "unit": "unit-declare",
            "globs": ["qontinui-web/backend/alembic/**"],
        }
        _coord_write(engine, _COORD_DECLARE_SQL, declare)
        row = _coord_write(
            engine, _COORD_DECLARE_SQL, {**declare, "globs": ["qontinui-web/**"]}
        )
        assert (row.status_text, row.intent_globs) == (
            "declared intent",
            ["qontinui-web/**"],
        )
        assert _sessions(engine, device, "unit-declare") == [_NIL]

        # 6-7. Phase 2's write premise and Phase 6a's contract, against the
        #      session-grain key this revision does not build. Both run inside
        #      one transaction that is rolled back.
        s1, s2 = sorted((uuid.uuid4(), uuid.uuid4()))
        first = _params(device, tenant, "unit-shared", s1)
        second = _params(device, tenant, "unit-shared", s2)
        with engine.connect() as conn:
            trans = conn.begin()
            try:
                conn.execute(text(_SESSION_GRAIN_KEY_SQL))
                conn.execute(text(_INSERT_SQL), first)
                # 6. The 3-column key refuses a second session on one unit.
                with pytest.raises(IntegrityError) as refused, conn.begin_nested():
                    conn.execute(text(_INSERT_SQL), second)
                assert _refused_by(refused) == ("23505", _PK)
                # No arbiter: that refusal is absorbed.
                absorbed = conn.execute(
                    text(_INSERT_SQL + " ON CONFLICT DO NOTHING RETURNING 1"), second
                ).scalar()
                assert absorbed is None
                # An arbiter on the 4-column key does not cover the 3-column key.
                with pytest.raises(IntegrityError) as refused, conn.begin_nested():
                    conn.execute(
                        text(
                            _INSERT_SQL + " ON CONFLICT (device_id, work_unit_id,"
                            " tenant_id, agent_session_id) DO NOTHING"
                        ),
                        second,
                    )
                assert _refused_by(refused) == ("23505", _PK)

                # 7. Phase 6a's key swap onto that index.
                conn.execute(text(_KEY_SWAP_SQL))
                assert _primary_key(conn) == (_PK, _NEW_KEY)
                conn.execute(text(_INSERT_SQL), second)
                assert (
                    conn.execute(
                        text(
                            "SELECT count(*) FROM coord.agent_status "
                            "WHERE device_id = :d AND work_unit_id = 'unit-shared'"
                        ),
                        {"d": device},
                    ).scalar_one()
                    == 2
                ), "after the swap, two sessions on one unit keep two rows"
                with pytest.raises(IntegrityError) as refused, conn.begin_nested():
                    conn.execute(
                        text(_INSERT_SQL),
                        _params(device, tenant, "unit-legacy", _NIL),
                    )
                assert _refused_by(refused) == ("23505", _PK), (
                    "nil (unattributed) writers still collapse per unit"
                )
            finally:
                trans.rollback()
        with engine.connect() as conn:
            assert _primary_key(conn) == (_PK, _OLD_KEY)
        assert _unique_indexes(engine) == [_PK], "the rehearsal must leave nothing"
        assert _sessions(engine, device, "unit-shared") == []

        # 8. Idempotent re-run. Stamp a session first, as Phase 2 will.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.agent_status SET agent_session_id = :s "
                    "WHERE device_id = :d AND work_unit_id = 'unit-report'"
                ),
                {"s": s1, "d": device},
            )
        oid, filenode = index_oid(engine, _INDEX), index_filenode(engine, _INDEX)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _INVALID_WARNING not in rerun.stderr, "a VALID index needs no REINDEX"
        assert index_state(engine, _INDEX)[0]
        assert (index_oid(engine, _INDEX), index_filenode(engine, _INDEX)) == (
            oid,
            filenode,
        ), "a re-run must not rebuild or reindex a VALID index"
        assert _sessions(engine, device, "unit-report") == [s1], (
            "a re-run must not reset a stamped session"
        )

        # 9. The INVALID-index branch. Writing pg_index needs a superuser. On a
        #    role that is not one, THIS SUB-STEP ONLY is skipped (loudly), and
        #    the rest still runs.
        if not is_superuser(engine):
            warnings.warn(
                "SKIPPED sub-step 9 (INVALID-index cleanup branch): the test role "
                "is not a superuser, so it cannot mark an index INVALID in "
                "pg_index. Run against a superuser role to exercise it.",
                stacklevel=1,
            )
        else:
            oid, filenode = index_oid(engine, _INDEX), index_filenode(engine, _INDEX)
            invalidate_index(engine, _INDEX)
            assert not index_state(engine, _INDEX)[0]
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            rerun = run_alembic(root, url, "upgrade", _REVISION_ID)
            assert index_state(engine, _INDEX)[0], (
                "an INVALID index must be rebuilt VALID, not kept by IF NOT EXISTS"
            )
            assert index_oid(engine, _INDEX) == oid, (
                "REINDEXed in place, not re-created"
            )
            assert index_filenode(engine, _INDEX) != filenode, (
                "an INVALID index must be reindexed, not merely revalidated"
            )
            # Checked after the rebuild, so a missing REINDEX and a missing
            # announcement each fail on their own assertion.
            assert _INVALID_WARNING in rerun.stderr, (
                "the REINDEX must be announced in the migration log, naming the index"
            )

        # 10. A downgrade past Phase 6a's key fails closed. Commit 6a's swap in
        #     this scratch database, try the downgrade, then swap the key back.
        with engine.begin() as conn:
            conn.execute(text(_SESSION_GRAIN_KEY_SQL))
            conn.execute(text(_KEY_SWAP_SQL))
        rows_before = _row_count(engine)
        refusal = run_alembic(
            root, url, "downgrade", _PARENT_REVISION_ID, expect_success=False
        )
        assert _DOWNGRADE_REFUSED in refusal.stderr, refusal.stderr[-3000:]
        with engine.connect() as conn:
            assert _primary_key(conn) == (_PK, _NEW_KEY), (
                "a refused downgrade must leave the primary key as it found it"
            )
        assert column_info(engine, _TABLE, _COLUMN) is not None
        assert index_state(engine, _INDEX)[0]
        assert _row_count(engine) == rows_before
        assert (
            scalar(engine, "SELECT version_num FROM alembic_version") == _REVISION_ID
        ), "a refused downgrade must not move the recorded revision"
        with engine.begin() as conn:
            conn.execute(text(_KEY_RESTORE_SQL))
        with engine.connect() as conn:
            assert _primary_key(conn) == (_PK, _OLD_KEY)
        assert _unique_indexes(engine) == [_PK]

        # 11. Downgrade removes what was added. The rows and the key survive.
        rows_before = _row_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert _row_count(engine) == rows_before, "downgrade must not delete rows"
        with engine.connect() as conn:
            assert _primary_key(conn) == (_PK, _OLD_KEY)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_state(engine, _INDEX)[0], "the re-applied index must be VALID"
        assert _unique_indexes(engine) == [_PK]
        assert _NIL_MEANS_UNATTRIBUTED in (
            column_comment(engine, _TABLE, _COLUMN) or ""
        )
        assert _sessions(engine, device, "unit-report") == [_NIL], (
            "a re-added column starts every row unattributed"
        )
