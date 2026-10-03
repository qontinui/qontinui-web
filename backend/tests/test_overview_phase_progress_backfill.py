"""``overview_04c_phase_progress_backfill`` — legacy incoherent phase progress
is repaired, and the two ``NOT VALID`` checks are then validated.

Kept apart from ``test_overview_timeline_integrity.py`` on purpose: this
revision ships in its own PR (coord's migration classifier escalates a data
change), and the ``overview_04b`` PR must pass without it.

Two substrates:

* the revision's ``upgrade()`` run directly, inside the test's transaction
  on the shared test database, against legacy rows stored the way they were
  before the CHECKs existed (constraint dropped, row written, constraint put
  back ``NOT VALID``) — everything rolls back with the test;
* the real alembic chain on a throwaway database, walking
  ``overview_04_timeline`` → ``…04b`` → ``…04c`` → ``…04b``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import date, datetime
from pathlib import Path
from types import ModuleType
from typing import Any
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION = "overview_04c_phase_progress_backfill"
_CHECKS_REVISION = "overview_04b_phase_progress_checks"
_PARENT = "overview_04_timeline"
_CHECKS = (
    "ck_overview_phases_actual_end_has_start",
    "ck_overview_phases_gate_decision_dated",
)


def _revision() -> ModuleType:
    path: Path = backend_root() / "alembic" / "versions" / f"{_REVISION}.py"
    return load_revision_module(path, _REVISION)


#: Each legacy row: its stored progress, and what the repair must leave.
#: ``(actual_start, actual_end, gate_status, gate_decided_at,
#: progress_updated_at, updated_at)`` → ``(actual_end, gate_decided_at)``.
_ROWS: dict[str, tuple[tuple[Any, ...], tuple[date | None, date | None]]] = {
    # Finished without starting: the end is cleared, not a start invented.
    "END_ONLY": (
        (None, "2026-02-01", "pending", None, None, "2026-02-01T09:00Z"),
        (None, None),
    ),
    # Pending, yet dated: the date is cleared.
    "PENDING_DATED": (
        (None, None, "pending", "2026-02-01", None, "2026-02-01T09:00Z"),
        (None, None),
    ),
    # Decided, undated: dated to the progress write — as a UTC date, though
    # the session's TimeZone (set below) is a day ahead at that instant.
    "DECIDED_UNDATED": (
        ("2026-01-05", None, "passed", None, "2026-03-04T23:30Z", "2026-03-20T09:00Z"),
        (None, date(2026, 3, 4)),
    ),
    # No progress write recorded: dated to the row's last write.
    "DECIDED_NO_PROGRESS_STAMP": (
        (None, None, "waived", None, None, "2026-02-10T12:00Z"),
        (None, date(2026, 2, 10)),
    ),
    # Breaking BOTH rules: two separate UPDATEs could repair neither.
    "BOTH": (
        (None, "2026-02-01", "failed", None, "2026-02-03T08:00Z", "2026-02-05T08:00Z"),
        (None, date(2026, 2, 3)),
    ),
    # Coherent: untouched, version and all.
    "COHERENT": (
        ("2026-01-05", "2026-02-01", "passed", "2026-02-01", None, "2026-02-01T09:00Z"),
        (date(2026, 2, 1), date(2026, 2, 1)),
    ),
}

_INSERT_PHASE = text(
    "INSERT INTO overview.phases (tenant_id, estimate_id, code, name, "
    "actual_start, actual_end, gate_status, gate_decided_at, "
    "progress_updated_at, updated_at, progress_version) VALUES (:t, :e, :code, "
    ":code, :s, :f, :g, :d, :p, :u, 3) RETURNING id"
)


def _phase_params(tenant: UUID, estimate: UUID, code: str) -> dict[str, Any]:
    s, f, g, d, p, u = _ROWS[code][0]

    def day(value: str | None) -> date | None:
        return None if value is None else date.fromisoformat(value)

    def instant(value: str | None) -> datetime | None:
        return None if value is None else datetime.fromisoformat(value)

    return {
        "t": tenant,
        "e": estimate,
        "code": code,
        "s": day(s),
        "f": day(f),
        "g": g,
        "d": day(d),
        "p": instant(p),
        "u": instant(u),
    }


_READ_PHASES = text(
    "SELECT code, actual_start, actual_end, gate_status, gate_decided_at, "
    "progress_version FROM overview.phases WHERE estimate_id = :e"
)

_CONVALIDATED = text(
    "SELECT conname, convalidated FROM pg_constraint "
    "WHERE conrelid = 'overview.phases'::regclass AND conname = ANY(:names)"
)


def _assert_repaired(rows: list[Any]) -> None:
    by_code = {row.code: row for row in rows}
    assert set(by_code) == set(_ROWS)
    for code, (_, (actual_end, decided)) in _ROWS.items():
        row = by_code[code]
        assert (row.actual_end, row.gate_decided_at) == (actual_end, decided), code
        # Coherent by both rules now.
        assert row.actual_end is None or row.actual_start is not None, code
        assert (row.gate_status == "pending") == (row.gate_decided_at is None), code
        # A repaired row's progress version moved; the coherent one's did not.
        assert row.progress_version == (3 if code == "COHERENT" else 4), code


@pytest.mark.asyncio
async def test_the_upgrade_repairs_legacy_rows_and_validates_both_checks(
    async_db_session: AsyncSession,
) -> None:
    db = async_db_session
    # A session a day ahead of UTC at 2026-03-04T23:30Z: the repair must
    # still take the UTC date. SET LOCAL ends with the test's transaction.
    await db.execute(text("SET LOCAL TimeZone = 'Pacific/Auckland'"))
    tenant = uuid4()
    estimate = (
        await db.execute(
            text(
                "INSERT INTO overview.estimates (tenant_id, name, purpose) "
                "VALUES (:t, 'Plan', 'budget') RETURNING id"
            ),
            {"t": tenant},
        )
    ).scalar_one()

    # Stored as before the CHECKs: drop them, write, put them back NOT VALID
    # (the state overview_04b leaves a legacy row in). DDL in the test's
    # transaction, so it rolls back with it.
    definitions = {
        name: (
            await db.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = 'overview.phases'::regclass AND conname = :n"
                ),
                {"n": name},
            )
        ).scalar_one()
        for name in _CHECKS
    }
    for name in _CHECKS:
        await db.execute(text(f"ALTER TABLE overview.phases DROP CONSTRAINT {name}"))
    for code in _ROWS:
        await db.execute(_INSERT_PHASE, _phase_params(tenant, estimate, code))
    for name, definition in definitions.items():
        await db.execute(
            text(
                f"ALTER TABLE overview.phases ADD CONSTRAINT {name} "
                f"{definition} NOT VALID"
            )
        )
    before = dict(
        (await db.execute(_CONVALIDATED, {"names": list(_CHECKS)})).tuples().all()
    )
    assert before == dict.fromkeys(_CHECKS, False)

    module = _revision()

    def _run(step: str) -> Callable[[Session], None]:
        def body(session: Session) -> None:
            with Operations.context(MigrationContext.configure(session.connection())):
                getattr(module, step)()

        return body

    await db.run_sync(_run("upgrade"))

    _assert_repaired(list((await db.execute(_READ_PHASES, {"e": estimate})).all()))
    after = dict(
        (await db.execute(_CONVALIDATED, {"names": list(_CHECKS)})).tuples().all()
    )
    assert after == dict.fromkeys(_CHECKS, True)

    # Re-runnable: nothing left to repair, and validating twice is a no-op.
    await db.run_sync(_run("upgrade"))
    _assert_repaired(list((await db.execute(_READ_PHASES, {"e": estimate})).all()))

    # Downgrade passes and changes nothing (see the revision's docstring).
    await db.run_sync(_run("downgrade"))
    _assert_repaired(list((await db.execute(_READ_PHASES, {"e": estimate})).all()))
    still = dict(
        (await db.execute(_CONVALIDATED, {"names": list(_CHECKS)})).tuples().all()
    )
    assert still == dict.fromkeys(_CHECKS, True)


_SKIP_NO_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()), reason="no test Postgres reachable"
)


def _convalidated(engine: Any) -> dict[str, bool]:
    with engine.connect() as conn:
        rows = conn.execute(_CONVALIDATED, {"names": list(_CHECKS)}).all()
    return {row.conname: row.convalidated for row in rows}


@pytest.fixture()
def _chain() -> Iterator[tuple[Any, str]]:
    with ephemeral_database(admin_database_url(), "overview_04c_test") as (
        engine,
        url,
    ):
        yield engine, url


@_SKIP_NO_PG
def test_the_chain_repairs_validates_and_walks_back(_chain: tuple[Any, str]) -> None:
    engine, url = _chain
    root = backend_root()
    run_alembic(root, url, "upgrade", _PARENT)
    tenant = uuid4()
    with engine.begin() as conn:
        estimate = conn.execute(
            text(
                "INSERT INTO overview.estimates (tenant_id, name, purpose) "
                "VALUES (:t, 'Plan', 'budget') RETURNING id"
            ),
            {"t": tenant},
        ).scalar_one()
        for code in _ROWS:
            conn.execute(_INSERT_PHASE, _phase_params(tenant, estimate, code))

    run_alembic(root, url, "upgrade", _CHECKS_REVISION)
    assert _convalidated(engine) == dict.fromkeys(_CHECKS, False)

    run_alembic(root, url, "upgrade", _REVISION)
    assert _convalidated(engine) == dict.fromkeys(_CHECKS, True)
    with engine.connect() as conn:
        rows = list(conn.execute(_READ_PHASES, {"e": estimate}).all())
    # The chain's session TimeZone is the server's; the UTC dates hold anyway.
    _assert_repaired(rows)

    # Back to 04b: a no-op that leaves the data repaired and the checks valid.
    run_alembic(root, url, "downgrade", _CHECKS_REVISION)
    assert _convalidated(engine) == dict.fromkeys(_CHECKS, True)
    run_alembic(root, url, "upgrade", _REVISION)
    assert _convalidated(engine) == dict.fromkeys(_CHECKS, True)
