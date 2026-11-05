"""One alembic migrator at a time: ``app/db/migration_lock.py`` and its ``env.py`` wiring.

Plan ``2026-11-04-two-web-migrators-can-run-at-once-and-kill-a-concurrent-index-build``.

Every test here runs against a live Postgres in a throwaway database and skips
without one, like the other migration tests (see ``tests/_alembic_harness.py``).

What each test would catch (mutation-checked when written):

* ``test_second_migrator_waits_then_fails_loudly`` — the lock removed, or never
  released.
* ``test_polling_waiter_leaves_a_live_concurrent_build_valid`` — the wait made
  BLOCKING (``pg_advisory_lock``), which deadlocks the build. (A poll that stays
  idle in its transaction between attempts does NOT deadlock it under READ
  COMMITTED — no snapshot survives the statement — so committing between polls
  is horizon hygiene, not something this test can or claims to catch.)
* ``test_blocking_waiter_kills_a_live_concurrent_build`` — documents WHY the
  wait polls: the same choreography with a blocking waiter reproduces the dead,
  INVALID index on this Postgres.
* ``test_env_py_refuses_to_plan_while_the_lock_is_held`` and
  ``test_waiting_migrator_finds_the_holders_stamp_and_applies_nothing`` — the
  ``env.py`` wiring removed, or the lock taken after alembic reads the revision.
* ``test_write_under_the_lock_commits_its_stamp`` — the commit after a
  successful attempt dropped, so alembic sees an "external" transaction and
  never commits.
"""

from __future__ import annotations

import contextlib
import logging
import threading
import time
from collections.abc import Iterator

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DBAPIError

from app.db.migration_lock import (
    LOCK_WAIT_ENV,
    MIGRATION_LOCK_KEY,
    MigrationLockTimeout,
    acquire_migration_lock,
    lock_wait_secs,
    release_migration_lock,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

ROOT_REVISION = "05a366f58455"

pytestmark = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="needs a reachable test Postgres (see tests/_alembic_harness.py)",
)


@pytest.fixture
def db() -> Iterator[tuple[Engine, str]]:
    with ephemeral_database(admin_database_url(), "migrator_lock") as pair:
        yield pair


def _key_is_free(engine: Engine) -> bool:
    """True when a fresh session can take the key (and gives it straight back)."""
    with engine.connect() as conn:
        got = conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": MIGRATION_LOCK_KEY}
        ).scalar()
        if got:
            conn.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": MIGRATION_LOCK_KEY}
            )
        conn.commit()
    return bool(got)


def test_lock_wait_secs_reads_the_environment() -> None:
    assert lock_wait_secs({}) == 3600.0
    assert lock_wait_secs({LOCK_WAIT_ENV: "0"}) == 0.0
    assert lock_wait_secs({LOCK_WAIT_ENV: "12.5"}) == 12.5
    # A typo waits the default rather than failing the deploy.
    assert lock_wait_secs({LOCK_WAIT_ENV: "ten"}) == 3600.0
    assert lock_wait_secs({LOCK_WAIT_ENV: "-1"}) == 3600.0


def test_refuses_a_connection_already_in_a_transaction(db: tuple[Engine, str]) -> None:
    engine, _ = db
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
        with pytest.raises(RuntimeError, match="must not be in a transaction"):
            acquire_migration_lock(conn, wait_secs=0)


def test_second_migrator_waits_then_fails_loudly(db: tuple[Engine, str]) -> None:
    engine, _ = db
    with engine.connect() as first, engine.connect() as second:
        acquire_migration_lock(first, wait_secs=0)
        assert not first.in_transaction()

        started = time.monotonic()
        with pytest.raises(MigrationLockTimeout) as exc:
            acquire_migration_lock(second, wait_secs=1.0, poll_secs=0.1)
        assert time.monotonic() - started >= 1.0
        message = str(exc.value)
        assert str(MIGRATION_LOCK_KEY) in message
        assert "held by pid" in message
        assert "applied nothing" in message
        assert not second.in_transaction()

        release_migration_lock(first)
        acquire_migration_lock(second, wait_secs=1.0, poll_secs=0.1)
        assert not second.in_transaction()
        release_migration_lock(second)
    assert _key_is_free(engine)


def _concurrent_build_under_a_waiter(engine: Engine, wait: str) -> dict[str, object]:
    """Run a live CREATE INDEX CONCURRENTLY while a second migrator waits.

    ``holder`` takes the migration lock and builds the index. An open writer
    keeps the build in its first wait, so the waiter is guaranteed to start
    BEFORE the build's final wait for older snapshots, which is where a blocked
    waiter is drawn into a deadlock. Then the writer commits and the build runs
    to its end.
    """
    with engine.connect() as setup:
        setup.execute(text("CREATE TABLE lock_probe (id int)"))
        setup.execute(text("INSERT INTO lock_probe SELECT generate_series(1, 2000)"))
        setup.commit()

    holder = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    writer = engine.connect()
    waiter = engine.connect()
    result: dict[str, object] = {}
    try:
        acquire_migration_lock(holder, wait_secs=0)
        holder_pid = int(holder.execute(text("SELECT pg_backend_pid()")).scalar_one())
        writer.execute(text("INSERT INTO lock_probe VALUES (0)"))  # open, uncommitted

        def build() -> None:
            try:
                holder.execute(
                    text(
                        "CREATE INDEX CONCURRENTLY IF NOT EXISTS lock_probe_idx ON lock_probe (id)"
                    )
                )
                result["build"] = "ok"
            except DBAPIError as exc:
                result["build"] = type(exc.orig).__name__

        def wait_for_lock() -> None:
            try:
                if wait == "blocking":
                    waiter.execute(
                        text("SELECT pg_advisory_lock(:k)"), {"k": MIGRATION_LOCK_KEY}
                    )
                    waiter.commit()
                else:
                    acquire_migration_lock(waiter, wait_secs=60, poll_secs=0.2)
                result["waiter"] = "acquired"
            except DBAPIError as exc:
                result["waiter"] = type(exc.orig).__name__

        build_thread = threading.Thread(target=build, daemon=True)
        build_thread.start()
        _wait_until_build_waits(engine)
        waiter_thread = threading.Thread(target=wait_for_lock, daemon=True)
        with _poller_seen() as polled:
            waiter_thread.start()
            if wait == "blocking":
                _wait_until_blocked_on_the_key(engine, exclude_pid=holder_pid)
            else:
                assert polled.wait(60), "the waiter never logged a refused attempt"
        writer.commit()
        build_thread.join(60)
        assert not build_thread.is_alive(), "the concurrent build never finished"
        release_migration_lock(holder)
        waiter_thread.join(60)
        assert not waiter_thread.is_alive(), "the waiter never got the lock"
        with engine.connect() as probe:
            result["indisvalid"] = probe.execute(
                text(
                    "SELECT i.indisvalid FROM pg_index i "
                    "JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'lock_probe_idx'"
                )
            ).scalar()
    finally:
        with contextlib.suppress(Exception):  # never mask the test's own failure
            _terminate_other_backends(engine)
        for conn in (waiter, writer, holder):
            with contextlib.suppress(Exception):
                conn.close()
    return result


class _PollerSeen(logging.Handler):
    """Sets ``event`` when a polling migrator logs its first failed attempt.

    Observed state, not a sleep: a slow cold import cannot make the waiter
    arrive after the moment it is meant to race. ``pg_stat_activity`` cannot
    show it — a poller's last statement is its ``COMMIT``, not the lock call —
    so this watches the waiter's own "Waiting up to" line, which
    ``acquire_migration_lock`` logs after a refused attempt and nowhere else.
    """

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.event = threading.Event()

    def emit(self, record: logging.LogRecord) -> None:
        if "Waiting up to" in record.getMessage():
            self.event.set()


@contextlib.contextmanager
def _poller_seen() -> Iterator[threading.Event]:
    lock_logger = logging.getLogger("alembic.env.migration_lock")
    handler = _PollerSeen()
    lock_logger.addHandler(handler)
    try:
        yield handler.event
    finally:
        lock_logger.removeHandler(handler)


def _wait_until_blocked_on_the_key(engine: Engine, *, exclude_pid: int) -> None:
    """Block until another session in THIS database waits on an advisory lock."""
    deadline = time.monotonic() + 60
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as probe:
        while time.monotonic() < deadline:
            waiting = probe.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND pid <> pg_backend_pid() "
                    "AND pid <> :holder AND wait_event_type = 'Lock' "
                    "AND wait_event = 'advisory'"
                ),
                {"holder": exclude_pid},
            ).scalar()
            if waiting:
                return
            time.sleep(0.05)
    raise AssertionError("no migrator was ever seen blocked on the lock")


def _terminate_other_backends(engine: Engine) -> None:
    """Free threads stuck in a statement so a failed test cannot hang teardown."""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as admin:
        admin.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = current_database() AND pid <> pg_backend_pid() "
                "AND backend_type = 'client backend'"
            )
        )


def _wait_until_build_waits(engine: Engine) -> None:
    deadline = time.monotonic() + 30
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as probe:
        while time.monotonic() < deadline:
            waiting = probe.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() "
                    "AND query ILIKE 'CREATE INDEX CONCURRENTLY%' AND wait_event_type = 'Lock'"
                )
            ).scalar()
            if waiting:
                return
            time.sleep(0.05)
    raise AssertionError("the concurrent build never reached its first wait")


def test_polling_waiter_leaves_a_live_concurrent_build_valid(
    db: tuple[Engine, str],
) -> None:
    engine, _ = db
    result = _concurrent_build_under_a_waiter(engine, "polling")
    assert result == {"build": "ok", "waiter": "acquired", "indisvalid": True}


def test_blocking_waiter_kills_a_live_concurrent_build(db: tuple[Engine, str]) -> None:
    """Why the wait polls: a blocked waiter's snapshot deadlocks the build.

    The detector picks the victim, so either side may die; on Postgres 16 it is
    usually the build, leaving the index INVALID behind an ``IF NOT EXISTS``
    that will report success over it.
    """
    engine, _ = db
    result = _concurrent_build_under_a_waiter(engine, "blocking")
    assert "DeadlockDetected" in (result.get("build"), result.get("waiter")), result
    if result.get("build") == "DeadlockDetected":
        assert result["indisvalid"] is False


def _alembic_version(engine: Engine) -> list[str] | None:
    with engine.connect() as conn:
        exists = conn.execute(
            text("SELECT to_regclass('public.alembic_version')")
        ).scalar()
        if exists is None:
            return None
        return [
            r[0] for r in conn.execute(text("SELECT version_num FROM alembic_version"))
        ]


def _hold_lock(engine: Engine) -> Connection:
    conn = engine.connect()
    acquire_migration_lock(conn, wait_secs=0)
    return conn


def test_env_py_refuses_to_plan_while_the_lock_is_held(
    db: tuple[Engine, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, url = db
    monkeypatch.setenv(LOCK_WAIT_ENV, "1")
    holder = _hold_lock(engine)
    try:
        proc = run_alembic(
            backend_root(), url, "upgrade", ROOT_REVISION, expect_success=False
        )
    finally:
        release_migration_lock(holder)
        holder.close()
    assert "MigrationLockTimeout" in proc.stderr, proc.stderr
    assert "Running upgrade" not in proc.stderr
    assert _alembic_version(engine) is None
    assert _key_is_free(engine)


def test_write_under_the_lock_commits_its_stamp(db: tuple[Engine, str]) -> None:
    """``stamp`` takes the lock and runs through ``begin_transaction`` exactly as
    ``upgrade`` does, without paying for the ~4,900-line root revision."""
    engine, url = db
    run_alembic(backend_root(), url, "stamp", ROOT_REVISION)
    # Read from a NEW connection: a stamp alembic never committed is invisible here.
    assert _alembic_version(engine) == [ROOT_REVISION]
    assert _key_is_free(engine), "env.py left the migration lock held"


def test_read_only_command_takes_no_lock(
    db: tuple[Engine, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, url = db
    monkeypatch.setenv(LOCK_WAIT_ENV, "0")
    holder = _hold_lock(engine)
    try:
        run_alembic(backend_root(), url, "current")
    finally:
        release_migration_lock(holder)
        holder.close()


def test_waiting_migrator_finds_the_holders_stamp_and_applies_nothing(
    db: tuple[Engine, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The second of two overlapping migrators sees the first's stamp.

    The holder plays the first migrator: it takes the lock, then stamps the
    root revision itself. A real ``alembic upgrade`` started meanwhile must
    wait, then find the revision applied and run nothing. Without the lock it
    would apply the root revision under the holder, which is the overlap.
    """
    engine, url = db
    monkeypatch.setenv(LOCK_WAIT_ENV, "60")
    holder = _hold_lock(engine)
    outcome: dict[str, object] = {}

    def second_migrator() -> None:
        outcome["proc"] = run_alembic(backend_root(), url, "upgrade", ROOT_REVISION)

    thread = threading.Thread(target=second_migrator, daemon=True)
    try:
        with _poller_seen() as polled:
            thread.start()
            assert polled.wait(120), "the second migrator never waited for the lock"
        holder.execute(
            text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)")
        )
        holder.execute(
            text("INSERT INTO alembic_version VALUES (:r)"), {"r": ROOT_REVISION}
        )
        holder.commit()
    finally:
        release_migration_lock(holder)
        holder.close()
    thread.join(120)
    assert not thread.is_alive()
    proc = outcome["proc"]
    assert "Running upgrade" not in proc.stderr, proc.stderr  # type: ignore[attr-defined]
    assert "acquired after" in proc.stderr  # type: ignore[attr-defined]
    assert _alembic_version(engine) == [ROOT_REVISION]
