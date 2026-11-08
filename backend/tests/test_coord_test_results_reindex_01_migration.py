"""Behaviour test for ``coord_test_results_reindex_01``.

The revision reclaims storage by rebuilding three existing ``coord.test_results``
indexes with ``REINDEX INDEX CONCURRENTLY``, smallest first. Before each rebuild
it drops that index's ``_ccnew`` / ``_ccold`` leftovers of an interrupted
rebuild, and a rebuild that fails is caught, cleaned up after, logged on one
line, and followed by the next.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``down_revision`` and the docstring's ``Revises:`` line both
   name ``_PARENT_REVISION_ID``. A re-point is three coupled edits: those two
   and the pin here.
2. **The statement list.** ``upgrade()`` issues static literals only, all inside
   the autocommit block, in this order for each index, smallest first: the two
   leftover drops, the ``REINDEX``, then the same two drops in the failure
   handler. ``downgrade()`` issues nothing.

Against a real Postgres (skipped when none is reachable):

3. **Upgrade, downgrade, upgrade.** Each upgrade rebuilds all three indexes
   (each comes back under a new ``indexrelid``) and logs no failure; the
   downgrade leaves them as they are.
4. **Valid, with the same definitions.** After an upgrade over a table holding
   rows, the three indexes are ``indisvalid``, ``pg_get_indexdef`` reads exactly
   the definitions spelled out below, and the primary key constraint uses the
   rebuilt index.
5. **Leftovers are dropped before each rebuild** (superuser). An invalid
   ``<name>_ccnew``, or in the second case ``<name>_ccold``, planted for each of
   the three indexes is gone afterwards, and no other ``_cc*`` index is left.
6. **One failed rebuild does not stop the others** (superuser). A real
   duplicate key makes the primary key's rebuild fail in its build phase, which
   leaves ``test_results_pkey_ccnew`` behind. The upgrade still exits 0 and
   stamps; that leftover is dropped; the failure is logged on one line naming
   the index and the error; the rebuild before it and the one after it both
   happen; and the old primary key index still serves.

Assertion 6 is also the proof plan D3 asked for: inside alembic's
``autocommit_block()`` a caught statement error leaves the connection usable for
the next statement and for alembic's stamp.

Assertions 5 and 6 write to ``pg_index`` (``indisvalid`` / ``indisunique``), so
they need a superuser and skip, saying so, without one. CI's
``pgvector/pgvector:pg16`` ``POSTGRES_USER`` is a superuser.
"""

from __future__ import annotations

import contextlib
import re
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from psycopg2 import errors as pg_errors
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_test_results_reindex_01"
_PARENT_REVISION_ID = "coord_test_result_runs_01"
_REVISION_FILENAME = "coord_test_results_reindex_01_reclaim_index_storage.py"
_REVISION_PATH = backend_root() / "alembic" / "versions" / _REVISION_FILENAME

#: Plan D2: smallest first, so the largest rebuild runs with the most room.
_REBUILD_ORDER = (
    "idx_test_results_repo_observed",
    "test_results_pkey",
    "idx_test_results_repo_test_observed",
)

#: What each index must still be after its rebuild, as ``pg_get_indexdef``
#: renders it on PostgreSQL 16.
_EXPECTED_DEFINITIONS = {
    "idx_test_results_repo_observed": (
        "CREATE INDEX idx_test_results_repo_observed ON coord.test_results "
        "USING btree (repo, observed_at DESC)"
    ),
    "test_results_pkey": (
        "CREATE UNIQUE INDEX test_results_pkey ON coord.test_results USING btree (id)"
    ),
    "idx_test_results_repo_test_observed": (
        "CREATE INDEX idx_test_results_repo_test_observed ON coord.test_results "
        "USING btree (repo, test_id, observed_at DESC)"
    ),
}

#: The start of the one line the revision logs per failed rebuild.
_FAILURE_MARKER = "coord_test_results_reindex_01: REINDEX FAILED"

# 3 repos x 40 tests, 1200 rows: enough that each rebuild sorts and writes real
# pages rather than an empty index.
_SEED_SQL = (
    "INSERT INTO coord.test_results (repo, test_id, outcome, provenance, observed_at) "
    "SELECT 'repo-' || (g % 3), 'bin::mod::t' || (g % 40), 'pass', 'test', "
    "now() - make_interval(mins => g) "
    "FROM generate_series(1, 1200) g"
)

_NO_POSTGRES_REASON = (
    "no reachable Postgres at the conftest URL, so coord_test_results_reindex_01 "
    "was NOT run against a database here (set QONTINUI_TEST_PG_DSN or "
    "QONTINUI_TEST_PG to point at one)"
)
_PG_REACHABLE = can_connect(admin_database_url())


def _superuser_skip_reason() -> str | None:
    """``None`` when the ``pg_index`` writes may run here; else why they may not."""
    if not _PG_REACHABLE:
        return _NO_POSTGRES_REASON
    engine = create_engine(admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            is_superuser = bool(
                conn.execute(
                    text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
                ).scalar()
            )
    except Exception as exc:  # pragma: no cover - a probe that cannot answer
        return f"could not read rolsuper for current_user: {exc!r}"
    finally:
        engine.dispose()
    if not is_superuser:
        return (
            "the connected role is NOT a superuser, so the leftover and failure "
            "cases (which write pg_index) were not verified here. CI's "
            "POSTGRES_USER is a superuser; connect as one to run them."
        )
    return None


_SUPERUSER_SKIP_REASON = _superuser_skip_reason()


@contextlib.contextmanager
def _database_at_parent() -> Iterator[tuple[Engine, str, Path]]:
    """An ephemeral database upgraded to the parent; yields (engine, url, root)."""
    root = backend_root()
    with ephemeral_database(
        admin_database_url(), "coord_test_results_reindex_test"
    ) as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        yield engine, url, root


def _index_state(engine: Engine, name: str) -> tuple[str, bool, int]:
    """``(definition, indisvalid, indexrelid)`` for ``coord.<name>``.

    ``indexrelid`` is the identity half: ``REINDEX ... CONCURRENTLY`` builds a
    new index and swaps it in under the old name, so a changed oid is what tells
    "rebuilt" from "left alone".
    """
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid), i.indisvalid, i.indexrelid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": name},
        ).one_or_none()
    assert row is not None, f"coord.{name} is absent"
    return str(row[0]), bool(row[1]), int(row[2])


def _index_oids(engine: Engine) -> dict[str, int]:
    return {name: _index_state(engine, name)[2] for name in _REBUILD_ORDER}


def _leftover_indexes(engine: Engine) -> list[str]:
    """Every ``_ccnew*`` / ``_ccold*`` index on ``coord.test_results``, sorted."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE i.indrelid = 'coord.test_results'::regclass
                   AND c.relname ~ '_cc(new|old)[0-9]*$'
                 ORDER BY c.relname
                """
            )
        ).all()
    return [str(row[0]) for row in rows]


def _failure_lines(proc: subprocess.CompletedProcess[str]) -> list[str]:
    return [
        line
        for line in (proc.stdout + proc.stderr).splitlines()
        if _FAILURE_MARKER in line
    ]


def _stamped_revision(engine: Engine) -> str:
    return str(scalar(engine, "SELECT version_num FROM alembic_version"))


def _write_pg_index(engine: Engine, sql: str) -> None:
    """One superuser write to ``pg_index``; a refusal skips rather than fails."""
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
    except DBAPIError as exc:  # pragma: no cover - superuser-gated already
        if isinstance(exc.orig, pg_errors.InsufficientPrivilege):
            pytest.skip(f"UPDATE pg_index was refused despite rolsuper: {exc.orig}")
        raise


def _plant_invalid_index(engine: Engine, name: str) -> None:
    """An INVALID ``coord.<name>``: the stand-in for a killed rebuild's leftover."""
    with engine.begin() as conn:
        conn.execute(text(f"CREATE INDEX {name} ON coord.test_results (repo)"))
    _write_pg_index(
        engine,
        "UPDATE pg_index SET indisvalid = false "
        f"WHERE indexrelid = 'coord.{name}'::regclass",
    )


def _plant_duplicate_primary_key(engine: Engine) -> None:
    """Two rows sharing one ``id``, so the primary key's rebuild fails mid-way.

    A real ``REINDEX ... CONCURRENTLY`` failure rather than a statement naming a
    missing index: the rebuild creates ``test_results_pkey_ccnew``, its build
    phase raises ``could not create unique index``, and that INVALID index is
    left behind for the revision's failure handler to drop. Uniqueness is
    suspended on the live index for the duplicate insert only (``indisunique``
    is the same superuser ``pg_index`` write as the ``indisvalid`` plants) and
    restored before the upgrade, so the rebuild still builds a unique index.
    """
    pkey = "WHERE indexrelid = 'coord.test_results_pkey'::regclass"
    _write_pg_index(engine, f"UPDATE pg_index SET indisunique = false {pkey}")
    with engine.begin() as conn:
        for _ in range(2):
            # A negative id: the identity column never generates one, so no
            # seeded row shares it.
            conn.execute(
                text(
                    "INSERT INTO coord.test_results "
                    "(id, repo, test_id, outcome, provenance) "
                    "VALUES (-1, 'repo-0', 'bin::mod::dup', 'fail', 'test')"
                )
            )
    _write_pg_index(engine, f"UPDATE pg_index SET indisunique = true {pkey}")
    duplicates = scalar(engine, "SELECT count(*) FROM coord.test_results WHERE id = -1")
    assert duplicates == 2, "the duplicate key must have landed"


def test_down_revision_and_header_name_the_pinned_parent() -> None:
    """1. Chain wiring; no database needed."""
    source = _REVISION_PATH.read_text(encoding="utf-8")
    declared = declared_parent_revision_id(source, _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}. A re-point moves down_revision, the "
        "docstring's `Revises:` line and _PARENT_REVISION_ID together."
    )
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)


def test_upgrade_issues_static_literals_in_order_outside_a_transaction() -> None:
    """2. The exact statement list, each a literal inside the autocommit block."""
    calls = upgrade_execute_calls(_REVISION_PATH)
    assert all(call.sql is not None for call in calls), (
        "every op.execute argument must be ONE static literal: coord's classifier "
        "and this test can only read the SQL that way"
    )
    issued = [" ".join(str(call.sql).split()) for call in calls]
    expected: list[str] = []
    for name in _REBUILD_ORDER:
        drops = [
            f"DROP INDEX CONCURRENTLY IF EXISTS coord.{name}_ccnew",
            f"DROP INDEX CONCURRENTLY IF EXISTS coord.{name}_ccold",
        ]
        expected += [*drops, f"REINDEX INDEX CONCURRENTLY coord.{name}", *drops]
    assert issued == expected, (
        "per index, smallest first: drop _ccnew, drop _ccold, REINDEX, then the "
        "same two drops in the failure handler"
    )
    outside = [
        sql
        for sql, call in zip(issued, calls, strict=True)
        if not call.in_autocommit_block
    ]
    assert not outside, (
        "REINDEX CONCURRENTLY and DROP INDEX CONCURRENTLY cannot run inside a "
        f"transaction; outside the autocommit block: {outside}"
    )
    assert not upgrade_execute_calls(_REVISION_PATH, function="downgrade"), (
        "downgrade() must be a no-op: a rebuilt index is the same index"
    )


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_upgrade_downgrade_upgrade_rebuilds_every_index_each_time() -> None:
    """3. Both upgrades rebuild all three indexes and log no failure."""
    with _database_at_parent() as (engine, url, root):
        at_parent = _index_oids(engine)

        first = run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not _failure_lines(first), f"a rebuild failed: {_failure_lines(first)}"
        after_first = _index_oids(engine)
        for name in _REBUILD_ORDER:
            assert after_first[name] != at_parent[name], f"{name} was not rebuilt"
        assert _stamped_revision(engine) == _REVISION_ID

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _stamped_revision(engine) == _PARENT_REVISION_ID
        assert _index_oids(engine) == after_first, "downgrade must change nothing"

        second = run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not _failure_lines(second), f"a rebuild failed: {_failure_lines(second)}"
        after_second = _index_oids(engine)
        for name in _REBUILD_ORDER:
            assert after_second[name] != after_first[name], (
                f"{name} was not rebuilt by the second upgrade"
            )
        assert _stamped_revision(engine) == _REVISION_ID
        assert not _leftover_indexes(engine)


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_rebuilt_indexes_are_valid_and_keep_their_definitions() -> None:
    """4. Valid, exactly the spelled-out definitions, primary key intact."""
    with _database_at_parent() as (engine, url, root):
        with engine.begin() as conn:
            conn.execute(text(_SEED_SQL))
        before = {name: _index_state(engine, name) for name in _REBUILD_ORDER}
        for name, (definition, valid, _oid) in before.items():
            assert valid and definition == _EXPECTED_DEFINITIONS[name], (
                f"premise: the parent chain must build {name} as spelled out here; "
                f"got {definition!r}"
            )

        run_alembic(root, url, "upgrade", _REVISION_ID)

        for name in _REBUILD_ORDER:
            definition, valid, oid = _index_state(engine, name)
            assert oid != before[name][2], f"{name} was not rebuilt"
            assert valid, f"{name} is INVALID after its rebuild"
            assert definition == _EXPECTED_DEFINITIONS[name], (
                f"{name} changed definition in its rebuild\n"
                f"got:      {definition}\nexpected: {_EXPECTED_DEFINITIONS[name]}"
            )
        primary_key_index = scalar(
            engine,
            "SELECT conindid FROM pg_constraint "
            "WHERE conrelid = 'coord.test_results'::regclass AND contype = 'p'",
        )
        assert primary_key_index == _index_state(engine, "test_results_pkey")[2], (
            "the primary key constraint must be served by the rebuilt index"
        )


@pytest.mark.skipif(
    _SUPERUSER_SKIP_REASON is not None, reason=str(_SUPERUSER_SKIP_REASON)
)
@pytest.mark.parametrize("suffix", ["_ccnew", "_ccold"])
def test_an_invalid_leftover_is_dropped_before_each_rebuild(suffix: str) -> None:
    """5. A planted invalid leftover of each index is gone after the upgrade."""
    with _database_at_parent() as (engine, url, root):
        planted = sorted(f"{name}{suffix}" for name in _REBUILD_ORDER)
        for leftover in planted:
            _plant_invalid_index(engine, leftover)
        assert _leftover_indexes(engine) == planted, "the plant must have landed"

        proc = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert not _leftover_indexes(engine), (
            f"an invalid {suffix} leftover survived the upgrade: REINDEX "
            "CONCURRENTLY works around a taken name (_ccnew1, _ccold1) rather "
            "than reusing it, so only the revision's drop removes it"
        )
        assert not _failure_lines(proc), f"a rebuild failed: {_failure_lines(proc)}"
        for name in _REBUILD_ORDER:
            definition, valid, _oid = _index_state(engine, name)
            assert valid and definition == _EXPECTED_DEFINITIONS[name]


@pytest.mark.skipif(
    _SUPERUSER_SKIP_REASON is not None, reason=str(_SUPERUSER_SKIP_REASON)
)
def test_one_failed_rebuild_does_not_stop_the_others() -> None:
    """6. The primary key's rebuild fails; the upgrade finishes and stamps."""
    with _database_at_parent() as (engine, url, root):
        with engine.begin() as conn:
            conn.execute(text(_SEED_SQL))
        _plant_duplicate_primary_key(engine)
        before = _index_oids(engine)

        # run_alembic asserts exit 0: an uncaught rebuild error fails here.
        proc = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _stamped_revision(engine) == _REVISION_ID, "the revision must stamp"
        lines = _failure_lines(proc)
        assert len(lines) == 1, f"expected one failure line, got {lines}"
        assert "coord.test_results_pkey" in lines[0], lines[0]
        assert "could not create unique index" in lines[0], (
            f"the line must carry the database error, on that one line: {lines[0]}"
        )
        assert not _leftover_indexes(engine), (
            "the failed rebuild's test_results_pkey_ccnew must be dropped by the "
            f"failure handler; left: {_leftover_indexes(engine)}"
        )
        definition, valid, oid = _index_state(engine, "test_results_pkey")
        assert valid and oid == before["test_results_pkey"], (
            "the old primary key index must be untouched and still serving"
        )
        assert definition == _EXPECTED_DEFINITIONS["test_results_pkey"]
        for name in (
            "idx_test_results_repo_observed",
            "idx_test_results_repo_test_observed",
        ):
            definition, valid, oid = _index_state(engine, name)
            assert oid != before[name], (
                f"{name} was not rebuilt: a failure in another index must not stop it"
            )
            assert valid and definition == _EXPECTED_DEFINITIONS[name]
