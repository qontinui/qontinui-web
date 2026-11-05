"""One alembic migrator at a time, enforced by the database.

``alembic/env.py`` calls [`acquire_migration_lock`] on the migration connection
before alembic opens its transaction or reads the current revision, and
[`release_migration_lock`] after alembic's transaction has ended. A second
migrator therefore plans its upgrade only after the first has stamped, and
finds the head already applied.

Why two can run at all
==============================================================================
``.github/workflows/migrate.yml`` serializes workflow RUNS, but its waiter
observes the ECS migrator task and never stops it. A job that times out or is
cancelled leaves its task running, and the next run starts a second task beside
it. Plan ``2026-11-04-two-web-migrators-can-run-at-once-and-kill-a-concurrent-index-build``.

Why a SESSION lock
==============================================================================
A session-level advisory lock survives commits, so it is held across
alembic's ``autocommit_block()``, which every ``CREATE INDEX CONCURRENTLY``
revision needs. A transaction-level lock would be released at the first
autocommit boundary.

Why the waiter POLLS instead of blocking
==============================================================================
A session blocked inside ``SELECT pg_advisory_lock(...)`` holds that
statement's snapshot. A live ``CREATE INDEX CONCURRENTLY`` waits, in its last
phase, for every transaction holding an older snapshot. So the build waits on
the waiter and the waiter waits on the build's session, and the deadlock
detector kills one of them. Usually it kills the build, which leaves an INVALID
index that a later ``IF NOT EXISTS`` reports as success. Reproduced on
Postgres 16.13 (qontinui-web#2078) and 16.2
(``tests/test_alembic_migrator_lock.py``).

So the waiter calls ``pg_try_advisory_lock``, which returns at once, and
sleeps client-side, outside any statement, so it holds no snapshot while it
waits. It also COMMITS after every attempt, so it is not left idle in a
transaction for up to an hour; under READ COMMITTED that would not deadlock the
build (measured), but it is a session nothing should have to reason about.

Why it also commits after a SUCCESSFUL attempt
==============================================================================
SQLAlchemy 2.0 autobegins a transaction on a connection's first ``execute``.
If that transaction is still open when ``context.begin_transaction()`` runs,
alembic treats it as an EXTERNAL transaction and does not commit. The
connection's close then rolls back every revision, while alembic reports
success. The helper therefore hands the connection back with no transaction
open, and raises if it cannot.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection

logger = logging.getLogger("alembic.env.migration_lock")

#: The one advisory-lock key every qontinui-web migrator takes:
#: ``int.from_bytes(b"qontmigr", "big")``. It is a single bigint, so it shares
#: no keyspace with the two-int4 form (``pg_advisory_xact_lock_shared(a, b)``)
#: that revision bodies use.
MIGRATION_LOCK_KEY = 8173873295031625586

#: Environment variable bounding how long a migrator waits for the lock.
LOCK_WAIT_ENV = "QONTINUI_MIGRATION_LOCK_WAIT_SECS"

#: Default wait. A ``CONCURRENTLY`` build on a large table has been estimated
#: at 3 to 30+ minutes, so the default waits out a long build, not just a
#: typical one.
DEFAULT_WAIT_SECS = 3600.0

#: Seconds between attempts. Each attempt is one short statement and a commit.
DEFAULT_POLL_SECS = 5.0

_TRY_LOCK_SQL = text("SELECT pg_try_advisory_lock(:key)")
_UNLOCK_SQL = text("SELECT pg_advisory_unlock(:key)")
# Who holds the key, for the waiter's log line. A session-level advisory lock on
# a single bigint appears in pg_locks with classid = high 32 bits, objid = low
# 32 bits and objsubid = 1.
_HOLDER_SQL = text(
    """
    SELECT a.pid, a.application_name, a.backend_start, a.state
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory'
       AND l.granted
       AND l.objsubid = 1
       AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND ((l.classid::bigint << 32) | l.objid::bigint) = :key
     LIMIT 1
    """
)


class MigrationLockTimeout(RuntimeError):
    """Another migrator held the lock past this migrator's deadline."""


def lock_wait_secs(environ: dict[str, str] | None = None) -> float:
    """The wait bound: ``$QONTINUI_MIGRATION_LOCK_WAIT_SECS``, else the default.

    ``0`` means a single attempt. A value that is not a non-negative number is
    logged and replaced by the default rather than read as "no wait", because
    failing a deploy on a typo is worse than waiting.
    """
    raw = (os.environ if environ is None else environ).get(LOCK_WAIT_ENV, "").strip()
    if not raw:
        return DEFAULT_WAIT_SECS
    try:
        value = float(raw)
    except ValueError:
        value = -1.0
    if value < 0 or value != value:  # negative or NaN
        logger.warning(
            "%s=%r is not a non-negative number of seconds; using %ss",
            LOCK_WAIT_ENV,
            raw,
            DEFAULT_WAIT_SECS,
        )
        return DEFAULT_WAIT_SECS
    return value


def _end_transaction(connection: Connection) -> None:
    """Commit, so the connection holds no transaction and no snapshot."""
    connection.commit()
    if connection.in_transaction():  # pragma: no cover - defensive
        raise RuntimeError(
            "migration lock: connection still in a transaction after commit"
        )


def _describe_holder(connection: Connection) -> str:
    try:
        row = connection.execute(_HOLDER_SQL, {"key": MIGRATION_LOCK_KEY}).first()
    except Exception as exc:  # noqa: BLE001 - diagnostic only
        connection.rollback()
        return f"holder unreadable ({type(exc).__name__})"
    _end_transaction(connection)
    if row is None:
        return "holder not visible (released between reads)"
    return (
        f"held by pid {row.pid} (application_name={row.application_name!r}, "
        f"backend_start={row.backend_start}, state={row.state})"
    )


def acquire_migration_lock(
    connection: Connection,
    *,
    wait_secs: float | None = None,
    poll_secs: float = DEFAULT_POLL_SECS,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    """Take the session-level migration lock on ``connection``, polling.

    Returns with the lock held and NO transaction open on ``connection``.
    Raises [`MigrationLockTimeout`] when the deadline passes first.
    """
    if connection.in_transaction():
        raise RuntimeError(
            "migration lock: the connection must not be in a transaction before "
            "the lock is taken (alembic would then skip its own commit)"
        )
    wait = lock_wait_secs() if wait_secs is None else wait_secs
    deadline = clock() + wait
    attempts = 0
    while True:
        attempts += 1
        got = bool(
            connection.execute(_TRY_LOCK_SQL, {"key": MIGRATION_LOCK_KEY}).scalar()
        )
        _end_transaction(connection)
        if got:
            if attempts > 1:
                logger.info(
                    "migration lock %s acquired after %d attempts",
                    MIGRATION_LOCK_KEY,
                    attempts,
                )
            return
        remaining = deadline - clock()
        if attempts == 1:
            until = datetime.now(UTC) + timedelta(seconds=max(remaining, 0))
            logger.warning(
                "migration lock %s is %s; another migrator is running. Waiting up "
                "to %.0fs (until %s), polling every %.0fs, holding no transaction",
                MIGRATION_LOCK_KEY,
                _describe_holder(connection),
                wait,
                until.isoformat(timespec="seconds"),
                poll_secs,
            )
        if remaining <= 0:
            raise MigrationLockTimeout(
                f"migration lock {MIGRATION_LOCK_KEY} still {_describe_holder(connection)} "
                f"after {wait:.0f}s ({attempts} attempts). Another migrator is still "
                f"running; this one applied nothing. Raise {LOCK_WAIT_ENV} to wait "
                "longer, or re-run once the other migrator has finished."
            )
        sleep(min(poll_secs, remaining))


def release_migration_lock(connection: Connection) -> None:
    """Release the lock taken by [`acquire_migration_lock`], best-effort.

    Closing the connection releases a session lock too, so a failure here is
    logged, never raised over the migration's own outcome.
    """
    try:
        if connection.in_transaction():
            connection.rollback()
        released = connection.execute(_UNLOCK_SQL, {"key": MIGRATION_LOCK_KEY}).scalar()
        connection.commit()
        if not released:
            logger.warning(
                "migration lock %s was not held at release; closing the connection "
                "releases it in any case",
                MIGRATION_LOCK_KEY,
            )
    except Exception as exc:  # noqa: BLE001 - the migration outcome must win
        logger.warning(
            "migration lock %s release failed (%s: %s); the connection close releases it",
            MIGRATION_LOCK_KEY,
            type(exc).__name__,
            exc,
        )
