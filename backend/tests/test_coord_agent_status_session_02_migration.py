"""Behaviour tests for the ``coord_agent_status_session_02`` revision.

Phase 6a of plan ``2026-11-11-intent-overlap-excludes-the-callers-whole-device``
is the CONTRACT half of making ``coord.agent_status`` session-grain. It builds
``uq_agent_status_session_grain`` CONCURRENTLY and swaps the primary key onto it
in one statement, resolving the old key's name from ``pg_constraint``. This
pins:

1. **Source shapes** (no database). The pinned parent is the revision's
   ``down_revision``. ``upgrade()`` has exactly one CONCURRENTLY build, a
   ``CREATE UNIQUE INDEX ... IF NOT EXISTS`` inside ``autocommit_block()``, with
   no ``lock_timeout`` in force there. The swap runs outside the block, and the
   nearest ``lock_timeout`` statement before it in its transaction is a non-zero
   ``SET LOCAL``. So is the one before ``downgrade()``'s swap. Every
   ``op.execute`` takes one static literal, and ``upgrade()`` reaches a REINDEX
   only through the bounded helper.

Items 2 to 10 are one DB walk, driven only through ``run_alembic``.

2. **Parent state**: the 3-column key, and a nil-stamped and a session-stamped
   row written before the revision.
3. **The swap**: the primary key is ``agent_status_pkey`` over the four columns
   in key order, it is the table's ONLY unique index (the build index was
   consumed by the promotion), replica identity is DEFAULT over it, and every
   row survived.
4. **Why the order is load-bearing**: the original 3-column ``ON CONFLICT``
   upsert now fails ``42P10`` (no arbiter), while Phase 2's arbiter-less insert
   and Phase 6b's ``ON CONFLICT ON CONSTRAINT agent_status_pkey`` both work.
5. **Two sessions keep two rows**; nil writers still collapse per unit.
6. **A re-run is a no-op** after ``stamp`` back to the parent: no second unique
   index on the four columns, the key's index keeps its oid.
7. **The downgrade refuses on same-unit sibling rows**, changing nothing (key,
   rows, recorded revision).
8. **Downgrade** without siblings swaps the 3-column key back and keeps every
   row.
9. **A wrong-shape index of the build's name** (here: a unique index on the
   three old columns) makes ``upgrade()`` refuse before the swap, and the
   3-column key is untouched.
10. **The INVALID-index branch** (superuser only): a re-run logs a warning
    naming the index, REINDEXes it in place, and swaps.

The standing at-head guard ``tests/test_replica_identity_published_schemas.py``
walks the whole chain, this revision included; it is part of this revision's
gate.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing.
"""

from __future__ import annotations

import ast
import re
import uuid
import warnings
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    index_filenode,
    index_oid,
    index_state,
    invalidate_index,
    is_superuser,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_agent_status_session_02"
_PARENT_REVISION_ID = "overlord_04_runner_start_and_nudge_time"
_REVISION_FILENAME = "coord_agent_status_session_02.py"

_PK = "agent_status_pkey"
_BUILD_INDEX = "uq_agent_status_session_grain"
_OLD_KEY = ["device_id", "work_unit_id", "tenant_id"]
_NEW_KEY = [*_OLD_KEY, "agent_session_id"]
_NIL = uuid.UUID(int=0)
_INVALID_WARNING = "coord.uq_agent_status_session_grain is INVALID"
_DOWNGRADE_REFUSED = "coord_agent_status_session_02 downgrade refused"
_WRONG_SHAPE_REFUSED = "is not a valid, unique, non-partial"

_INSERT_SQL = """
    INSERT INTO coord.agent_status
        (device_id, tenant_id, correlation_topic, work_unit_id, status_text,
         expires_at, agent_session_id)
    VALUES
        (:device, :tenant, 'intent', :unit, 'working',
         now() + interval '1 hour', :session)
"""
_LEGACY_INSERT_SQL = """
    INSERT INTO coord.agent_status
        (device_id, tenant_id, correlation_topic, work_unit_id, status_text,
         expires_at)
    VALUES
        (:device, :tenant, 'intent', :unit, 'working', now() + interval '1 hour')
"""
# Coord's ORIGINAL upsert, before plan Phase 2 (and its legacy path's statement).
_OLD_ARBITER_UPSERT_SQL = (
    _LEGACY_INSERT_SQL
    + """
    ON CONFLICT (device_id, work_unit_id, tenant_id) DO UPDATE SET
        status_text = EXCLUDED.status_text, updated_at = now()
"""
)
# Phase 6b's direct upsert.
_PHASE_6B_UPSERT_SQL = (
    _INSERT_SQL
    + """
    ON CONFLICT ON CONSTRAINT agent_status_pkey DO UPDATE SET
        status_text = 'updated', updated_at = now()
"""
)


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


_SET_LOCAL_LOCK_TIMEOUT = re.compile(
    r"\s*SET\s+LOCAL\s+LOCK_TIMEOUT\s*(?:=|\bTO\b)\s*'?\s*(\d+)"
)


def _nearest_lock_timeout_is_bounded(function: str, marker: str) -> None:
    calls = upgrade_execute_calls(_revision_path(), function=function)
    statements = [(call.sql or "").upper() for call in calls]
    at = [i for i, sql in enumerate(statements) if marker in sql]
    assert len(at) == 1, f"exactly one {marker!r} statement in {function}()"
    assert not calls[at[0]].in_autocommit_block
    nearest = None
    for i in range(at[0] - 1, -1, -1):
        if calls[i].in_autocommit_block:
            break
        if "LOCK_TIMEOUT" in statements[i]:
            nearest = statements[i]
            break
    match = _SET_LOCAL_LOCK_TIMEOUT.match(nearest or "")
    assert match is not None and int(match.group(1)) > 0, (
        f"the nearest lock_timeout before the swap in {function}() must be a "
        f"non-zero SET LOCAL in its transaction; found {nearest!r}"
    )


@pytest.mark.parametrize(
    ("function", "marker"),
    [("upgrade", "PRIMARY KEY USING INDEX"), ("downgrade", "PRIMARY KEY (DEVICE_ID")],
)
def test_the_swap_lock_wait_is_bounded(function: str, marker: str) -> None:
    _nearest_lock_timeout_is_bounded(function, marker)


@pytest.mark.parametrize("function", ["upgrade", "downgrade"])
def test_every_execute_is_one_static_literal(function: str) -> None:
    calls = upgrade_execute_calls(_revision_path(), function=function)
    assert calls
    assert all(call.sql is not None for call in calls), (
        f"every {function}() op.execute must take ONE static string literal"
    )


def test_upgrade_builds_concurrently_without_a_lock_bound() -> None:
    calls = upgrade_execute_calls(_revision_path())
    concurrent = [c for c in calls if "CONCURRENTLY" in (c.sql or "").upper()]
    assert len(concurrent) == 1, "exactly one CONCURRENTLY build"
    (build,) = concurrent
    sql = re.sub(r"\s+", " ", (build.sql or "").upper())
    assert build.in_autocommit_block
    assert "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS" in sql
    assert "(DEVICE_ID, WORK_UNIT_ID, TENANT_ID, AGENT_SESSION_ID)" in sql, (
        "the build keys the four columns in primary-key order"
    )
    # Inside the block, before the build, both timeouts are cleared at session
    # level (a role/database/PGOPTIONS value would otherwise be in force), and
    # nothing in the block sets a non-zero one. Outside it, only SET LOCAL.
    at = calls.index(build)
    in_block_before = [
        re.sub(r"\s+", " ", (c.sql or "").upper()).strip()
        for c in calls[:at]
        if c.in_autocommit_block
    ]
    for setting in ("LOCK_TIMEOUT", "STATEMENT_TIMEOUT"):
        assert f"SET {setting} = 0" in in_block_before, (
            f"{setting} must be cleared before the CONCURRENTLY build"
        )
    for call in calls:
        upper = re.sub(r"\s+", " ", (call.sql or "").upper()).strip()
        if "TIMEOUT" not in upper:
            continue
        if call.in_autocommit_block:
            assert upper.startswith("RESET ") or upper.endswith("= 0"), (
                f"no non-zero timeout may be in force for the build: {upper}"
            )
        else:
            assert re.match(r"SET LOCAL LOCK_TIMEOUT\b", upper), upper
    after = [
        re.sub(r"\s+", " ", (c.sql or "").upper()).strip()
        for c in calls[at + 1 :]
        if c.in_autocommit_block
    ]
    assert "RESET STATEMENT_TIMEOUT" in after, (
        "env.py's per-revision RESET omits statement_timeout, so the revision "
        "must reset it itself"
    )


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_source())
    (fn,) = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    ]
    return fn


def _is_autocommit_with(node: ast.stmt) -> bool:
    return isinstance(node, ast.With) and any(
        isinstance(item.context_expr, ast.Call)
        and isinstance(item.context_expr.func, ast.Attribute)
        and item.context_expr.func.attr == "autocommit_block"
        for item in node.items
    )


@pytest.mark.parametrize("function", ["upgrade", "downgrade"])
def test_the_swap_commits_before_the_version_stamp(function: str) -> None:
    """The last statement after the swap is an ``autocommit_block()``.

    Its COMMIT releases the swap's ACCESS EXCLUSIVE lock at once, instead of
    holding it through the ``alembic_version`` stamp and every later
    non-autocommit revision of the same batch.
    """
    body = _function(function).body
    assert _is_autocommit_with(body[-1]), (
        f"{function}() must end with an autocommit_block() that commits the swap"
    )
    swap_sql = [
        node.value
        for stmt in body[:-1]
        for node in ast.walk(stmt)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and "PRIMARY KEY" in node.value.upper()
    ]
    assert swap_sql, f"the swap must come before {function}()'s final commit"


def test_the_reindex_helper_bounds_its_lock_wait() -> None:
    """``_reindex_in_own_transaction`` runs BEGIN, a non-zero SET LOCAL, then the SQL."""
    fn = _function("_reindex_in_own_transaction")
    # ast.walk is breadth-first; sort into source order.
    calls = sorted(
        (
            node
            for node in ast.walk(fn)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
            and node.args
        ),
        key=lambda node: (node.lineno, node.col_offset),
    )
    # A literal argument by value; the helper's parameter as "<sql>".
    executed = [
        node.args[0].value  # type: ignore[attr-defined]
        if isinstance(node.args[0], ast.Constant)  # type: ignore[attr-defined]
        else "<sql>"
        for node in calls
    ]
    assert executed[:1] == ["BEGIN"], executed
    match = _SET_LOCAL_LOCK_TIMEOUT.match(
        str(executed[1]).upper() if len(executed) > 1 else ""
    )
    assert match is not None and int(match.group(1)) > 0, executed
    assert executed[2:3] == ["<sql>"], (
        f"the REINDEX must run straight after the bound, inside it: {executed}"
    )


def test_upgrade_reaches_reindex_only_through_the_bounded_helper() -> None:
    tree = ast.parse(_source())
    (upgrade_fn,) = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade"
    ]
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
    assert all(id(stmt) in helper_args for stmt in statements)


def _tenant_and_device(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'Agent Status Contract Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"agent-status-pk-{uuid.uuid4().hex[:8]}"},
        )
        device_id = conn.execute(
            text(
                """
                INSERT INTO coord.devices (name, hostname, tenant_id)
                VALUES ('pk-test', 'pk-test-host', :t)
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


def _primary_key(engine: Engine) -> tuple[str, list[str], int]:
    """``(constraint name, key columns in order, backing index oid)``."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT c.conname, array_agg(a.attname::text ORDER BY k.ord),
                       c.conindid::int8
                  FROM pg_constraint c
                  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                 WHERE c.conrelid = CAST('coord.agent_status' AS regclass)
                   AND c.contype = 'p'
                 GROUP BY c.conname, c.conindid
                """
            )
        ).one()
    return str(row[0]), list(row[1]), int(row[2])


def _unique_indexes(engine: Engine) -> list[str]:
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


def _unit_sessions(engine: Engine, device: uuid.UUID, unit: str) -> list[uuid.UUID]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT agent_session_id FROM coord.agent_status "
                "WHERE device_id = :d AND work_unit_id = :u ORDER BY agent_session_id"
            ),
            {"d": device, "u": unit},
        ).all()
    return [uuid.UUID(str(row[0])) for row in rows]


def _write(engine: Engine, sql: str, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _refused_by(excinfo: pytest.ExceptionInfo[IntegrityError]) -> tuple[str, str]:
    orig = excinfo.value.orig
    return (
        str(getattr(orig, "pgcode", None)),
        str(getattr(getattr(orig, "diag", None), "constraint_name", None)),
    )


def _recorded_revision(engine: Engine) -> object:
    return scalar(engine, "SELECT version_num FROM alembic_version")


_requires_postgres = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring up a backend Postgres before running this test."
    ),
)


@_requires_postgres
def test_coord_agent_status_session_02_swaps_the_key_and_refuses_lossy_rollback() -> (
    None
):
    root = backend_root()
    with ephemeral_database(admin_database_url(), "agent_status_pk_swap_test") as (
        engine,
        url,
    ):
        # 2. Parent: the 3-column key, a legacy nil row and a stamped row.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert _primary_key(engine)[:2] == (_PK, _OLD_KEY)
        tenant, device = _tenant_and_device(engine)
        s1, s2 = sorted((uuid.uuid4(), uuid.uuid4()))
        _write(engine, _LEGACY_INSERT_SQL, _params(device, tenant, "unit-nil", _NIL))
        _write(engine, _INSERT_SQL, _params(device, tenant, "unit-shared", s1))
        rows_before = _row_count(engine)

        # 3. The swap.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        name, key, pk_index = _primary_key(engine)
        assert (name, key) == (_PK, _NEW_KEY)
        assert _unique_indexes(engine) == [_PK], (
            "the promotion consumes the build index; no second unique index"
        )
        assert not index_exists(engine, _BUILD_INDEX)
        assert (
            scalar(
                engine,
                "SELECT relreplident FROM pg_class "
                "WHERE oid = CAST('coord.agent_status' AS regclass)",
            )
            == "d"
        ), "replica identity DEFAULT, over the new primary key"
        assert _row_count(engine) == rows_before
        assert _unit_sessions(engine, device, "unit-shared") == [s1]

        # 4. The original 3-column arbiter is gone: that is why the PR waited for
        #    coord to serve Phase 2 everywhere.
        with pytest.raises(DBAPIError) as no_arbiter:
            _write(
                engine,
                _OLD_ARBITER_UPSERT_SQL,
                _params(device, tenant, "unit-nil", _NIL),
            )
        assert getattr(no_arbiter.value.orig, "pgcode", None) == "42P10"
        # Smoke checks only, not proof of the swap (they pass on the old key of
        # the same name too; steps 3, 4's 42P10 and 5's sibling insert prove
        # it): Phase 2's arbiter-less insert absorbs the conflict...
        with engine.begin() as conn:
            absorbed = conn.execute(
                text(_INSERT_SQL + " ON CONFLICT DO NOTHING RETURNING 1"),
                _params(device, tenant, "unit-nil", _NIL),
            ).scalar()
        assert absorbed is None
        # ...and Phase 6b's direct upsert arbitrates on the constraint by name.
        _write(engine, _PHASE_6B_UPSERT_SQL, _params(device, tenant, "unit-shared", s1))
        assert (
            scalar(
                engine,
                "SELECT status_text FROM coord.agent_status "
                "WHERE work_unit_id = 'unit-shared' AND agent_session_id = :s",
                s=s1,
            )
            == "updated"
        )

        # 5. A sibling session keeps its own row (the swap's proof); nil writers
        #    still collapse (a smoke check: the old key refuses this too).
        _write(engine, _INSERT_SQL, _params(device, tenant, "unit-shared", s2))
        assert _unit_sessions(engine, device, "unit-shared") == [s1, s2]
        with pytest.raises(IntegrityError) as refused:
            _write(engine, _INSERT_SQL, _params(device, tenant, "unit-nil", _NIL))
        assert _refused_by(refused) == ("23505", _PK)

        # 6. Re-run after stamping back: a no-op.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _unique_indexes(engine) == [_PK], (
            "a re-run must not build a second unique index beside the key"
        )
        assert _primary_key(engine) == (_PK, _NEW_KEY, pk_index)

        # 7. Downgrade refuses while a unit holds two sessions' rows.
        rows_before = _row_count(engine)
        refusal = run_alembic(
            root, url, "downgrade", _PARENT_REVISION_ID, expect_success=False
        )
        assert _DOWNGRADE_REFUSED in refusal.stderr, refusal.stderr[-3000:]
        assert "1 (device_id, work_unit_id, tenant_id) key(s)" in refusal.stderr
        assert _primary_key(engine) == (_PK, _NEW_KEY, pk_index)
        assert _row_count(engine) == rows_before, "a refused downgrade deletes nothing"
        assert _unit_sessions(engine, device, "unit-shared") == [s1, s2]
        assert _recorded_revision(engine) == _REVISION_ID

        # 8. Without siblings the downgrade swaps the 3-column key back.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.agent_status WHERE agent_session_id = :s"),
                {"s": s2},
            )
        rows_before = _row_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _primary_key(engine)[:2] == (_PK, _OLD_KEY)
        assert _unique_indexes(engine) == [_PK]
        assert _row_count(engine) == rows_before
        assert _recorded_revision(engine) == _PARENT_REVISION_ID

        # 9. A same-named index of the wrong shape is refused before the swap.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX uq_agent_status_session_grain "
                    "ON coord.agent_status (device_id, work_unit_id, tenant_id)"
                )
            )
        refusal = run_alembic(root, url, "upgrade", _REVISION_ID, expect_success=False)
        assert _WRONG_SHAPE_REFUSED in refusal.stderr, refusal.stderr[-3000:]
        assert _primary_key(engine)[:2] == (_PK, _OLD_KEY)
        assert _recorded_revision(engine) == _PARENT_REVISION_ID
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX coord.uq_agent_status_session_grain"))

        # 10. The INVALID-index branch.
        if not is_superuser(engine):
            warnings.warn(
                "SKIPPED sub-step 10 (INVALID-index branch): the test role is not a "
                "superuser, so it cannot mark an index INVALID in pg_index.",
                stacklevel=1,
            )
        else:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX uq_agent_status_session_grain "
                        "ON coord.agent_status "
                        "(device_id, work_unit_id, tenant_id, agent_session_id)"
                    )
                )
            oid, filenode = (
                index_oid(engine, _BUILD_INDEX),
                index_filenode(engine, _BUILD_INDEX),
            )
            invalidate_index(engine, _BUILD_INDEX)
            assert not index_state(engine, _BUILD_INDEX)[0]
            rerun = run_alembic(root, url, "upgrade", _REVISION_ID)
            assert _INVALID_WARNING in rerun.stderr, rerun.stderr[-3000:]
            name, key, pk_index = _primary_key(engine)
            assert (name, key) == (_PK, _NEW_KEY)
            assert pk_index == oid, "the REINDEXed index (same oid) became the key"
            with engine.connect() as conn:
                assert _filenode_of_oid(conn, pk_index) != filenode, (
                    "an INVALID index must be reindexed, not merely revalidated"
                )
            assert _unique_indexes(engine) == [_PK]


def _filenode_of_oid(conn: Connection, oid: int) -> int:
    return int(
        conn.execute(
            text("SELECT relfilenode FROM pg_class WHERE oid = :o"), {"o": oid}
        ).scalar_one()
    )
