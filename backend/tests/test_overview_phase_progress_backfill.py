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
from datetime import UTC, date, datetime
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

from app.schemas.overview import PhaseProgressRead
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


ACTOR = "migration:overview_04c_phase_progress_backfill"


#: Each legacy row: its stored progress, and what the repair must leave.
#: ``(planned_start, actual_start, actual_end, gate_status, gate_decided_at,
#: progress_updated_at, updated_at, progress_version)`` →
#: ``(actual_start, actual_end, gate_decided_at, progress_version)``.
_ROWS: dict[
    str,
    tuple[tuple[Any, ...], tuple[date | None, date | None, date | None, int]],
] = {
    # Finished without a recorded start: the end is KEPT and the start filled
    # with the one the forecast already assumes — the planned start.
    "END_ONLY": (
        (
            "2026-01-10",
            None,
            "2026-02-01",
            "pending",
            None,
            None,
            "2026-02-01T09:00Z",
            3,
        ),
        (date(2026, 1, 10), date(2026, 2, 1), None, 4),
    ),
    # No planned start to assume: the start is the end.
    "END_ONLY_UNPLANNED": (
        (None, None, "2026-02-01", "pending", None, None, "2026-02-01T09:00Z", 3),
        (date(2026, 2, 1), date(2026, 2, 1), None, 4),
    ),
    # Planned to start after it finished: capped at the end, so the actual
    # order still holds.
    "END_ONLY_PLANNED_LATE": (
        (
            "2026-03-01",
            None,
            "2026-02-01",
            "pending",
            None,
            None,
            "2026-02-01T09:00Z",
            3,
        ),
        (date(2026, 2, 1), date(2026, 2, 1), None, 4),
    ),
    # Pending, yet dated: the date is cleared.
    "PENDING_DATED": (
        (None, None, None, "pending", "2026-02-01", None, "2026-02-01T09:00Z", 3),
        (None, None, None, 4),
    ),
    # Pending, dated AND end-only: both repaired in the one statement.
    "PENDING_DATED_END_ONLY": (
        (
            "2026-01-12",
            None,
            "2026-02-01",
            "pending",
            "2026-02-01",
            None,
            "2026-02-01T09:00Z",
            3,
        ),
        (date(2026, 1, 12), date(2026, 2, 1), None, 4),
    ),
    # Decided, undated: dated to the progress write — as a UTC date, though
    # the session's TimeZone (set below) is a day ahead at that instant.
    "DECIDED_UNDATED": (
        (
            None,
            "2026-01-05",
            None,
            "passed",
            None,
            "2026-03-04T23:30Z",
            "2026-03-20T09:00Z",
            3,
        ),
        (date(2026, 1, 5), None, date(2026, 3, 4), 4),
    ),
    # No progress write recorded: dated to the row's last write.
    "DECIDED_NO_PROGRESS_STAMP": (
        (None, None, None, "waived", None, None, "2026-02-10T12:00Z", 3),
        (None, None, date(2026, 2, 10), 4),
    ),
    # Breaking BOTH rules: two separate UPDATEs could repair neither. (Its
    # progress stamp has fractional seconds, which the logged shape keeps.)
    "BOTH": (
        (
            "2026-01-20",
            None,
            "2026-02-01",
            "failed",
            None,
            "2026-02-03T08:00:00.12Z",
            "2026-02-05T08:00Z",
            3,
        ),
        (date(2026, 1, 20), date(2026, 2, 1), date(2026, 2, 3), 4),
    ),
    # A NULL progress version reads as 1, so the repair moves it to 2.
    "NULL_VERSION": (
        (None, None, None, "pending", "2026-02-01", None, "2026-02-01T09:00Z", None),
        (None, None, None, 2),
    ),
    # Coherent: untouched, version and all, and nothing logged.
    "COHERENT": (
        (
            "2026-01-01",
            "2026-01-05",
            "2026-02-01",
            "passed",
            "2026-02-01",
            None,
            "2026-02-01T09:00Z",
            3,
        ),
        (date(2026, 1, 5), date(2026, 2, 1), date(2026, 2, 1), 3),
    ),
}

_REPAIRED = frozenset(code for code in _ROWS if code != "COHERENT")

_INSERT_PHASE = text(
    "INSERT INTO overview.phases (tenant_id, estimate_id, code, name, "
    "planned_start, actual_start, actual_end, gate_status, gate_decided_at, "
    "progress_updated_at, updated_at, progress_version) VALUES (:t, :e, :code, "
    ":code, :ps, :s, :f, :g, :d, :p, :u, :v) RETURNING id"
)


def _day(value: str | None) -> date | None:
    return None if value is None else date.fromisoformat(value)


def _instant(value: str | None) -> datetime | None:
    return None if value is None else datetime.fromisoformat(value)


def _phase_params(tenant: UUID, estimate: UUID, code: str) -> dict[str, Any]:
    ps, s, f, g, d, p, u, v = _ROWS[code][0]
    return {
        "t": tenant,
        "e": estimate,
        "code": code,
        "ps": _day(ps),
        "s": _day(s),
        "f": _day(f),
        "g": g,
        "d": _day(d),
        "p": _instant(p),
        "u": _instant(u),
        "v": v,
    }


_READ_PHASES = text(
    "SELECT id, estimate_id, code, name, sort_order, planned_start, planned_end, "
    "gate_criteria, actual_start, actual_end, gate_status, gate_decided_at, "
    "gate_notes, progress_version, progress_updated_at, progress_updated_by "
    "FROM overview.phases WHERE estimate_id = :e"
)

_READ_LOG = text(
    "SELECT tenant_id, resource, record_id, action, source, actor, "
    "actor_user_id, version_before, version_after, before, after "
    "FROM overview.change_log WHERE tenant_id = :t ORDER BY record_id"
)

_CONVALIDATED = text(
    "SELECT conname, convalidated FROM pg_constraint "
    "WHERE conrelid = 'overview.phases'::regclass AND conname = ANY(:names)"
)


def _read_shape(row: Any, **progress: Any) -> dict[str, Any]:
    """What a normal ``phase_progress`` write logs for ``row`` — the
    resource's read shape, ``model_dump(mode="json")`` — with ``progress``
    overriding the stored progress fields (for the pre-repair ``before``)."""
    fields: dict[str, Any] = {
        "id": str(row.id),
        "estimate_id": row.estimate_id,
        "code": row.code,
        "name": row.name,
        "sort_order": row.sort_order,
        "planned_start": row.planned_start,
        "planned_end": row.planned_end,
        "gate_criteria": row.gate_criteria,
        "actual_start": row.actual_start,
        "actual_end": row.actual_end,
        "gate_status": row.gate_status,
        "gate_decided_at": row.gate_decided_at,
        "gate_notes": row.gate_notes,
        "version": row.progress_version or 1,
        # In UTC, as the API's asyncpg reads it; a sync driver hands back the
        # server's zone instead.
        "updated_at": (
            None
            if row.progress_updated_at is None
            else row.progress_updated_at.astimezone(UTC)
        ),
        "updated_by": row.progress_updated_by,
    }
    fields.update(progress)
    return PhaseProgressRead(**fields).model_dump(mode="json")


def _assert_repaired(rows: list[Any]) -> None:
    by_code = {row.code: row for row in rows}
    assert set(by_code) == set(_ROWS)
    for code, (_, expected) in _ROWS.items():
        row = by_code[code]
        assert (
            row.actual_start,
            row.actual_end,
            row.gate_decided_at,
            row.progress_version,
        ) == expected, code
        # Coherent by every rule now, the validated actual order included.
        assert row.actual_end is None or row.actual_start is not None, code
        assert row.actual_end is None or row.actual_end >= row.actual_start, code
        assert (row.gate_status == "pending") == (row.gate_decided_at is None), code


def _assert_logged(tenant: UUID, rows: list[Any], log: list[Any]) -> None:
    """One change-log row per repaired phase, none for the coherent one, each
    shaped as a normal ``phase_progress`` update with the pre-repair values
    as ``before``."""
    by_id = {str(row.id): row for row in rows}
    logged = {by_id[entry.record_id].code: entry for entry in log}
    assert set(logged) == _REPAIRED
    assert len(log) == len(_REPAIRED)
    for code, entry in logged.items():
        row = by_id[entry.record_id]
        _, s, f, _g, d, p, _u, v = _ROWS[code][0]
        assert entry.tenant_id == tenant, code
        assert (entry.resource, entry.action, entry.source) == (
            "phase_progress",
            "update",
            "import",
        ), code
        assert entry.actor == ACTOR and entry.actor_user_id is None, code
        assert (entry.version_before, entry.version_after) == (
            v or 1,
            row.progress_version,
        ), code
        assert entry.after == _read_shape(row), code
        assert entry.before == _read_shape(
            row,
            actual_start=_day(s),
            actual_end=_day(f),
            gate_decided_at=_day(d),
            version=v or 1,
            updated_at=_instant(p),
        ), code


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

    assert module.ACTOR == ACTOR

    async def check() -> None:
        rows = list((await db.execute(_READ_PHASES, {"e": estimate})).all())
        _assert_repaired(rows)
        log = list((await db.execute(_READ_LOG, {"t": tenant})).all())
        _assert_logged(tenant, rows, log)

    await db.run_sync(_run("upgrade"))

    await check()
    after = dict(
        (await db.execute(_CONVALIDATED, {"names": list(_CHECKS)})).tuples().all()
    )
    assert after == dict.fromkeys(_CHECKS, True)

    # Re-runnable: nothing left to repair — so nothing more logged — and
    # validating twice is a no-op.
    await db.run_sync(_run("upgrade"))
    await check()

    # Downgrade passes and changes nothing (see the revision's docstring).
    await db.run_sync(_run("downgrade"))
    await check()
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

    def check() -> None:
        with engine.connect() as conn:
            rows = list(conn.execute(_READ_PHASES, {"e": estimate}).all())
            log = list(conn.execute(_READ_LOG, {"t": tenant}).all())
        # The chain's session TimeZone is the server's; the UTC dates hold
        # anyway.
        _assert_repaired(rows)
        _assert_logged(tenant, rows, log)

    check()

    # Back to 04b: a no-op that leaves the data repaired and the checks valid.
    run_alembic(root, url, "downgrade", _CHECKS_REVISION)
    assert _convalidated(engine) == dict.fromkeys(_CHECKS, True)
    # Up again: nothing left to repair, so no second log row either.
    run_alembic(root, url, "upgrade", _REVISION)
    assert _convalidated(engine) == dict.fromkeys(_CHECKS, True)
    check()
