"""Test for ``coord_policy_outcome_counts_02``: a rollup row at zero is deleted.

Post-merge follow-up to ``coord_policy_outcome_counts_01``, plan
``2026-10-30-coord-calibration-counts-fetch-every-labeled-row-per-decision``.

coord's seeder replaces a key once and its reconcile only replaces drifted keys,
so without this revision every hourly bucket the retention prune empties would
stay in the table for good, and every per-decision read of its key would scan
it.

Without a database (always runs):

1. Chain wiring, static SQL, and nothing dropped.
2. ``downgrade()`` restores the function body of revision 01 byte for byte,
   indentation included, and its comment exactly, and the new body is that body
   plus exactly the zero-row delete lines, so the delta arithmetic pinned by the
   revision 01 tests cannot have moved.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

3. coord's liveness check still reads this function as the real one.
4. A row reaching zero is deleted for a retention DELETE, a relabel and an
   unlabel, including where every nullable key column is NULL, and a statement
   deletes only the rows it took to zero.
5. An unseeded key below zero keeps its row until a label takes it to zero.
6. A writer racing a zero-row delete of one rollup row ends exact, whether the
   deleter commits or rolls back, and the delete still holds the SHARED fence.
7. Up, down, up: the downgrade brings back the function definition and comment
   the parent revision had, exactly as Postgres stores them, the old body leaves
   zero rows in place, and the re-upgrade clears those rows, skips a row a writer
   holds, keeps every other row, and brings the new body back.
"""

from __future__ import annotations

import ast
import re
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
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
    upgrade_execute_calls,
)
from tests.test_coord_policy_outcome_counts_01_migration import (
    _OTHER_TENANT,
    _TRIGGERS,
    _counts,
    _entity,
    _fence_locks,
    _hashtext,
    _insert,
    _key,
    _reset,
    _row_total,
)
from tests.test_coord_policy_outcome_counts_01_migration import guard as _guard

_REVISION_ID = "coord_policy_outcome_counts_02"
_REVISION_FILENAME = "coord_policy_outcome_counts_02_delete_zero_rows.py"
_V1_FILENAME = "coord_policy_outcome_counts_01_rollup.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "outbound_budget_windows_01"

# The lines the new function body adds to the revision 01 body, in order.
_ADDED_BODY_LINES = [
    "zero_rows tid[];",
    "-- A row left at n = 0 counts nothing. Delete it here, or it would",
    "-- stay for good and every later read of its key would scan it.",
    "-- These rows were locked by the upsert just above, so this cannot",
    "-- wait on another writer and their ctid cannot change first.",
    "WITH applied AS (",
    "RETURNING c.ctid AS row_tid, c.n",
    ")",
    "SELECT array_agg(a.row_tid) INTO zero_rows",
    "FROM applied a",
    "WHERE a.n = 0;",
    "IF zero_rows IS NOT NULL THEN",
    "DELETE FROM coord.policy_outcome_counts c",
    "WHERE c.ctid = ANY (zero_rows) AND c.n = 0;",
    "END IF;",
]

_LABELED: dict[str, object] = {
    "category": "confirmed",
    "labeled_at": "2026-10-30T13:00:00Z",
}

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _revision_path(filename: str = _REVISION_FILENAME) -> Path:
    return backend_root() / "alembic" / "versions" / filename


def _literals(path: Path, function: str) -> list[str]:
    """The SQL of every execute call in ``function``, whitespace-normalized."""
    calls = upgrade_execute_calls(path, function=function)
    assert all(c.sql is not None for c in calls), f"{path.name}: non-literal execute"
    return [" ".join((c.sql or "").split()) for c in calls]


def _body_lines(path: Path, function: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    fn = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == function
    )
    body = next(
        n.value
        for n in ast.walk(fn)
        if isinstance(n, ast.Constant)
        and isinstance(n.value, str)
        and "CREATE OR REPLACE FUNCTION" in n.value
        and "pg_advisory_xact_lock_shared" in n.value
    )
    return [line.strip() for line in body.splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# 1. chain wiring and static SQL
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    siblings = [
        f
        for f in _revision_path().parent.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]
    source = _revision_path().read_text(encoding="utf-8")
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_execute_is_static_and_nothing_is_dropped() -> None:
    assert len(_literals(_revision_path(), "upgrade")) == 3
    assert len(_literals(_revision_path(), "downgrade")) == 2
    scan = _guard.scan_source(
        _revision_path().read_text(encoding="utf-8"), _revision_path()
    )
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 2. the bodies
# ---------------------------------------------------------------------------


def test_downgrade_restores_revision_01_exactly() -> None:
    restored = _literals(_revision_path(), "downgrade")
    v1 = _literals(_revision_path(_V1_FILENAME), "upgrade")
    for sql in restored:
        assert sql in v1, f"downgrade SQL is not a revision 01 statement: {sql[:80]}"


def _raw_literal(path: Path, function: str, marker: str) -> str:
    """The one execute literal in ``function`` containing ``marker``, unnormalized."""
    found = [
        c.sql
        for c in upgrade_execute_calls(path, function=function)
        if c.sql is not None and marker in c.sql
    ]
    assert len(found) == 1, f"{path.name} {function}: {len(found)} {marker!r} literals"
    return found[0]


def test_downgrade_restores_the_revision_01_body_byte_for_byte() -> None:
    # Postgres keeps the text between the dollar quotes verbatim as prosrc and
    # pg_dump prints it verbatim, so the Migration Reversal Tested check reads a
    # body that differs only in indentation as a different schema. The
    # whitespace-collapsed comparison above cannot see that.
    def body(path: Path, function: str) -> str:
        sql = _raw_literal(path, function, "CREATE OR REPLACE FUNCTION")
        match = re.search(r"AS \$fn\$(.*)\$fn\$", sql, re.S)
        assert match, f"{path.name} {function}: no $fn$ body"
        return match.group(1)

    def comment(path: Path, function: str) -> str:
        sql = _raw_literal(path, function, "COMMENT ON FUNCTION")
        match = re.search(r"\bIS\s*'(.*)'", sql, re.S)
        assert match, f"{path.name} {function}: no comment literal"
        return match.group(1)

    v1 = _revision_path(_V1_FILENAME)
    assert body(_revision_path(), "downgrade") == body(v1, "upgrade")
    assert comment(_revision_path(), "downgrade") == comment(v1, "upgrade")


def test_new_body_is_the_old_body_plus_the_zero_row_delete() -> None:
    new = _body_lines(_revision_path(), "upgrade")
    old = _body_lines(_revision_path(_V1_FILENAME), "upgrade")
    # The upsert now ends inside the CTE, so its statement terminator moved.
    old = [
        "DO UPDATE SET n = c.n + EXCLUDED.n"
        if line == "DO UPDATE SET n = c.n + EXCLUDED.n;"
        else line
        for line in old
    ]
    added: list[str] = []
    matched = 0
    for line in new:
        if matched < len(old) and line == old[matched]:
            matched += 1
        else:
            added.append(line)
    assert matched == len(old), f"revision 01 line gone: {old[matched:][:1]}"
    assert added == _ADDED_BODY_LINES


def test_the_existing_zero_row_delete_runs_after_the_function_and_never_waits() -> None:
    calls = upgrade_execute_calls(_revision_path(), function="upgrade")
    delete = calls[-1]
    assert delete.sql is not None
    assert delete.sql.lstrip().startswith("DELETE FROM coord.policy_outcome_counts")
    assert "FOR UPDATE SKIP LOCKED" in delete.sql
    assert delete.in_autocommit_block, "its row locks must last one statement"
    assert not any(c.in_autocommit_block for c in calls[:-1])


# ---------------------------------------------------------------------------
# with a database
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def migrated() -> Iterator[Engine]:
    if not can_connect(admin_database_url()):
        pytest.skip("test Postgres unreachable")
    with ephemeral_database(admin_database_url(), "poc02_shared") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _function_source(engine: Engine) -> str:
    value = scalar(
        engine,
        "SELECT p.prosrc FROM pg_catalog.pg_proc p"
        " JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace"
        " WHERE ns.nspname = 'coord' AND p.proname = 'policy_outcome_counts_apply'",
    )
    assert isinstance(value, str)
    return value


def _function_definition(engine: Engine) -> tuple[str, str]:
    """The function as Postgres stores it: the full definition and its comment."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT pg_catalog.pg_get_functiondef(p.oid),"
                " pg_catalog.obj_description(p.oid, 'pg_proc')"
                " FROM pg_catalog.pg_proc p"
                " JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace"
                " WHERE ns.nspname = 'coord'"
                " AND p.proname = 'policy_outcome_counts_apply'"
            )
        ).one()
    definition, comment = row
    assert isinstance(definition, str) and isinstance(comment, str)
    return definition, comment


def _delete_where(engine: Engine, predicate: str) -> int:
    """One DELETE statement on the base table: one trigger firing."""
    with engine.begin() as conn:
        return conn.execute(
            text(f"DELETE FROM coord.policy_rule_resolutions WHERE {predicate}")
        ).rowcount


# 3. coord's liveness check


@_needs_pg
def test_coord_still_reads_the_function_as_live(migrated: Engine) -> None:
    # The shape of coord's MAINTENANCE_LIVE_SQL (policies/outcome_counts.rs). A
    # body it does not recognise stops coord trusting the rollup.
    assert "pg_advisory_xact_lock_shared" in _function_source(migrated)
    fired = scalar(
        migrated,
        "SELECT count(*) FROM pg_catalog.pg_trigger t"
        " JOIN pg_catalog.pg_proc tp ON tp.oid = t.tgfoid"
        " WHERE t.tgrelid = to_regclass('coord.policy_rule_resolutions')"
        " AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')"
        " AND tp.proname = 'policy_outcome_counts_apply'"
        " AND t.tgname = ANY(:names)",
        names=list(_TRIGGERS),
    )
    assert fired == 4


# 4. a row reaching zero is deleted


@_needs_pg
def test_retention_delete_removes_only_the_rows_it_took_to_zero(
    migrated: Engine,
) -> None:
    engine = migrated
    _reset(engine)
    later: dict[str, object] = {**_LABELED, "labeled_at": "2026-10-30T14:00:00Z"}
    with engine.begin() as conn:
        ids = _insert(
            conn,
            [_LABELED] * 3
            + [later] * 2
            + [{**_LABELED, "category": "failure"}]
            + [{**_LABELED, "tenant_id": _OTHER_TENANT}],
        )
    assert _row_total(engine) == 4

    # One statement empties the 13:00 confirmed bucket and trims the 14:00 one.
    taken = ", ".join(f"'{rid}'" for rid in ids[:4])
    assert _delete_where(engine, f"resolution_id IN ({taken})") == 4
    assert _counts(engine) == {
        _key("confirmed", "2026-10-30 14:00"): 1,
        _key("failure"): 1,
        _key("confirmed", tenant=_OTHER_TENANT): 1,
    }
    assert _row_total(engine) == 3, "the emptied bucket must be gone"

    # Emptying every labeled row leaves nothing at all.
    _delete_where(engine, "outcome_category IS NOT NULL")
    assert _row_total(engine) == 0


@_needs_pg
def test_a_zero_row_is_deleted_when_every_nullable_key_column_is_null(
    migrated: Engine,
) -> None:
    # The delete addresses rows by ctid. A key match written with plain equality
    # would miss these rows, and they are the shape that would then accumulate.
    engine = migrated
    _reset(engine)
    bare: dict[str, object] = {
        "category": "confirmed",
        "labeled_at": None,
        "entity": _entity(domain=None, surface=None, decision=None),
    }
    with engine.begin() as conn:
        _insert(conn, [bare, bare])
    assert _counts(engine) == {
        _key("confirmed", None, domain=None, surface=None, decision=None): 2
    }
    _delete_where(engine, "outcome_category IS NOT NULL")
    assert _row_total(engine) == 0


@_needs_pg
def test_relabel_and_unlabel_delete_the_row_they_empty(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        rid = _insert(conn, [_LABELED])[0]
    assert _counts(engine) == {_key("confirmed"): 1}

    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE coord.policy_rule_resolutions"
                " SET outcome_category = 'failure' WHERE resolution_id = :r"
            ),
            {"r": rid},
        )
    assert _counts(engine) == {_key("failure"): 1}
    assert _row_total(engine) == 1, "the emptied confirmed bucket must be gone"

    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE coord.policy_rule_resolutions"
                " SET outcome_category = NULL WHERE resolution_id = :r"
            ),
            {"r": rid},
        )
    assert _row_total(engine) == 0

    # The bucket comes back when it is labeled again.
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE coord.policy_rule_resolutions"
                " SET outcome_category = 'confirmed' WHERE resolution_id = :r"
            ),
            {"r": rid},
        )
    assert _counts(engine) == {_key("confirmed"): 1}


# 5. an unseeded key below zero


@_needs_pg
def test_a_negative_row_stays_until_a_label_takes_it_to_zero(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        _insert(conn, [_LABELED])
        # A label that was never counted: an unseeded key, simulated.
        conn.execute(text("TRUNCATE coord.policy_outcome_counts"))
    _delete_where(engine, "outcome_category IS NOT NULL")
    assert _counts(engine) == {_key("confirmed"): -1}
    assert _row_total(engine) == 1

    with engine.begin() as conn:
        _insert(conn, [_LABELED])
    assert _row_total(engine) == 0


# 6. concurrency


def _wait_until_blocked(engine: Engine, marker: str) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        waiting = scalar(
            engine,
            "SELECT count(*) FROM pg_catalog.pg_stat_activity"
            " WHERE application_name = :m AND wait_event_type = 'Lock'",
            m=marker,
        )
        if waiting:
            return
        time.sleep(0.05)
    raise AssertionError(f"{marker} never blocked on the zero-row delete")


@_needs_pg
@pytest.mark.parametrize(("outcome", "expected"), [("commit", 1), ("rollback", 2)])
def test_a_writer_racing_a_zero_row_delete_ends_exact(
    migrated: Engine, outcome: str, expected: int
) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        _insert(conn, [_LABELED])
    marker = f"poc02_racer_{outcome}"
    errors: list[BaseException] = []

    def racer() -> None:
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("SELECT set_config('application_name', :m, true)"),
                    {"m": marker},
                )
                _insert(conn, [_LABELED])
        except BaseException as exc:  # noqa: BLE001 - re-raised on the main thread
            errors.append(exc)

    with engine.connect() as deleter:
        tx = deleter.begin()
        deleter.execute(
            text(
                "DELETE FROM coord.policy_rule_resolutions"
                " WHERE outcome_category IS NOT NULL"
            )
        )
        # The zero-row delete still runs under the SHARED seeding fence.
        assert (
            _hashtext(engine, "route_serving_safety|ok"),
            "ShareLock",
        ) in _fence_locks(engine)
        # The deleter's trigger has already deleted the row it took to zero, so
        # the racer below meets a deleted row and retries its insert. Under the
        # revision 01 body the row would still be here at zero.
        assert (
            deleter.execute(
                text("SELECT count(*) FROM coord.policy_outcome_counts")
            ).scalar_one()
            == 0
        )

        thread = threading.Thread(target=racer)
        thread.start()
        try:
            _wait_until_blocked(engine, marker)
        finally:
            if outcome == "commit":
                tx.commit()
            else:
                tx.rollback()
            thread.join(timeout=60)
    assert not thread.is_alive(), "the racer never finished"
    assert not errors, errors
    assert _counts(engine) == {_key("confirmed"): expected}
    assert _row_total(engine) == 1


# 7. round trip


@_needs_pg
def test_up_down_up() -> None:
    with ephemeral_database(admin_database_url(), "poc02_rt") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _PARENT_REVISION_ID)
        before = _function_definition(engine)
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert "zero_rows" in _function_source(engine)

        run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)
        assert "zero_rows" not in _function_source(engine)
        # Exactly what the parent revision had, whitespace included: the same
        # comparison the Migration Reversal Tested check makes over pg_dump.
        assert _function_definition(engine) == before
        with engine.begin() as conn:
            _insert(conn, [_LABELED])
        _delete_where(engine, "outcome_category IS NOT NULL")
        assert _counts(engine) == {}, "the old body still counts to zero"
        assert _row_total(engine) == 1, "the old body leaves the zero row in place"

        # Beside that zero row: a live row, an unseeded negative row, and a zero
        # row a writer holds. The re-upgrade clears only the free zero row.
        later: dict[str, object] = {**_LABELED, "labeled_at": "2026-10-30T14:00:00Z"}
        below: dict[str, object] = {**_LABELED, "labeled_at": "2026-10-30T15:00:00Z"}
        held: dict[str, object] = {**_LABELED, "labeled_at": "2026-10-30T16:00:00Z"}
        with engine.begin() as conn:
            _insert(conn, [later])
            rid = _insert(conn, [below])[0]
            _insert(conn, [held])
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.policy_outcome_counts SET n = 0"
                    " WHERE to_char(labeled_hour, 'HH24') = '15'"
                )
            )
        _delete_where(engine, f"resolution_id = '{rid}'")
        _delete_where(engine, "outcome_labeled_at = '2026-10-30T16:00:00Z'")
        assert _row_total(engine) == 4
        # run_alembic runs on this thread, so a DELETE that waited on the holder
        # would hang rather than fail. Bound it; env.py RESET returns to this value.
        with engine.begin() as conn:
            database = conn.execute(text("SELECT current_database()")).scalar_one()
            conn.exec_driver_sql(
                f"""ALTER DATABASE "{database}" SET lock_timeout = '30s'"""
            )
        with engine.connect() as holder:
            tx = holder.begin()
            holder.execute(
                text(
                    "SELECT 1 FROM coord.policy_outcome_counts"
                    " WHERE to_char(labeled_hour, 'HH24') = '16' FOR UPDATE"
                )
            )
            run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
            tx.rollback()
        assert "zero_rows" in _function_source(engine)
        assert _counts(engine) == {
            _key("confirmed", "2026-10-30 14:00"): 1,
            _key("confirmed", "2026-10-30 15:00"): -1,
        }
        assert _row_total(engine) == 3, "only the row the writer held stays at zero"

        # The new body is live again.
        with engine.begin() as conn:
            _insert(conn, [_LABELED])
        assert _counts(engine)[_key("confirmed")] == 1
        _delete_where(engine, "outcome_labeled_at = '2026-10-30T13:00:00Z'")
        assert _key("confirmed") not in _counts(engine)
        assert _row_total(engine) == 3, "the new body deletes it again"
