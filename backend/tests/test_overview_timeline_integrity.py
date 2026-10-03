"""The Timeline's data integrity beyond the API's own checks.

Three things, each about what the API alone could not guarantee:

* **A milestone write cannot be nulled behind its back by a phase delete.**
  An estimate save that drops a phase detaches that phase's milestones as
  logged, versioned writes and then deletes it. A milestone write naming the
  phase that committed BETWEEN those two steps used to be nulled by the FK's
  ``ON DELETE SET NULL`` with no version bump and no change-log row. Proven
  here with real concurrency: every request on its own connection, committing
  for real, the estimate save held open at exactly that point.
* **The database refuses incoherent progress** written around the API
  (``ck_overview_phases_actual_end_has_start``,
  ``ck_overview_phases_gate_decision_dated``), and the migration that adds
  them leaves rows already stored untouched (``NOT VALID``), walks up, down
  and up, and re-runs cleanly.
* **Progress records what has happened**: an actual or decision date in the
  future is a 422 (the API's rule alone — it depends on the clock).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

API = "/api/v1/overview"

TENANT = UUID("aaaaaaaa-0000-4000-8000-0000000000c5")


def _app(
    db_dependency: Callable[[], AsyncIterator[AsyncSession]], user: Any
) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
    from app.overview.permissions import OverviewCaller, get_overview_caller
    from app.overview.router import router as authoring_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[get_async_db] = db_dependency
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=TENANT, roles=("admin",)
    )
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Overview-Source": "ui"},
    )


def _content(*codes: str) -> dict[str, Any]:
    return {
        "roles": [],
        "phases": [
            {
                "code": code,
                "name": f"Phase {code}",
                "planned_start": "2026-01-05",
                "planned_end": "2026-01-30",
                "gate_criteria": f"Gate {code}",
            }
            for code in codes
        ],
    }


async def _estimate(client: httpx.AsyncClient, *codes: str) -> dict[str, Any]:
    response = await client.post(
        f"{API}/estimates",
        json={
            "name": "Plan",
            "purpose": "budget",
            "is_baseline": True,
            "content": _content(*codes),
        },
    )
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()["item"]
    return item


def _phase_id(estimate: dict[str, Any], code: str) -> str:
    return next(
        str(p["id"]) for p in estimate["content"]["phases"] if p["code"] == code
    )


def _if_match(version: int) -> dict[str, str]:
    return {"If-Match": f'"{version}"'}


# ===========================================================================
# A milestone write racing the phase delete
# ===========================================================================


@pytest.mark.asyncio
class TestAMilestoneWriteRacingAPhaseDelete:
    @pytest_asyncio.fixture()
    async def racing(self, test_engine):
        """An admin client whose every request gets its own session (its own
        pooled connection, committing for real), and the cleanup that needs."""
        from types import SimpleNamespace

        from app.models.overview import ChangeLog, Estimate, Milestone

        sessions = async_sessionmaker(test_engine, expire_on_commit=False)

        async def _clear() -> None:
            async with sessions() as session:
                for table in (Milestone, ChangeLog, Estimate):
                    await session.execute(
                        table.__table__.delete().where(table.tenant_id == TENANT)
                    )
                await session.commit()

        await _clear()

        async def _fresh_session() -> AsyncIterator[AsyncSession]:
            async with sessions() as session:
                yield session

        user = SimpleNamespace(id=uuid4(), email="race@example.com")
        try:
            async with _client(_app(_fresh_session, user)) as client:
                yield client, sessions
        finally:
            await _clear()

    @staticmethod
    async def _blocked_or_done(
        sessions: async_sessionmaker[AsyncSession], task: asyncio.Task[Any]
    ) -> None:
        """Wait until ``task`` has finished, or is waiting on a row lock in
        this database — whichever comes first (10 s bound)."""
        deadline = asyncio.get_running_loop().time() + 10
        while not task.done():
            async with sessions() as session:
                waiting = (
                    await session.execute(
                        text(
                            "SELECT count(*) FROM pg_stat_activity "
                            "WHERE datname = current_database() "
                            "AND wait_event_type = 'Lock' "
                            "AND pid <> pg_backend_pid()"
                        )
                    )
                ).scalar_one()
            if waiting:
                return
            assert asyncio.get_running_loop().time() < deadline, (
                "the milestone write neither finished nor waited on a lock"
            )
            await asyncio.sleep(0.05)

    @pytest.mark.parametrize("write", ["create", "update"])
    async def test_a_milestone_write_between_detach_and_delete_is_never_silently_nulled(
        self, racing, monkeypatch: pytest.MonkeyPatch, write: str
    ) -> None:
        from app.models.overview import ChangeLog, Milestone
        from app.overview import estimates, milestones

        client, sessions = racing
        estimate = await _estimate(client, "A0", "A1")
        dropped = _phase_id(estimate, "A1")
        existing: dict[str, Any] | None = None
        if write == "update":
            made = await client.post(
                f"{API}/milestones",
                json={"title": "Pilot", "target_date": "2026-03-02"},
            )
            assert made.status_code == 201, made.text
            existing = made.json()["item"]

        detached = asyncio.Event()
        resume = asyncio.Event()
        real_detach = milestones.detach_milestones

        async def detach_then_hold(ctx: Any, phase_ids: list[UUID]) -> None:
            # The estimate save, held open between its detach step and its
            # phase DELETE — the window the race lives in.
            await real_detach(ctx, phase_ids)
            detached.set()
            await resume.wait()

        monkeypatch.setattr(estimates, "detach_milestones", detach_then_hold)

        save = asyncio.create_task(
            client.patch(
                f"{API}/estimates/{estimate['id']}",
                json={"content": _content("A0")},
                headers=_if_match(1),
            )
        )
        await asyncio.wait_for(detached.wait(), 10)

        milestone_write: Coroutine[Any, Any, httpx.Response]
        if existing is None:
            milestone_write = client.post(
                f"{API}/milestones",
                json={
                    "title": "Pilot",
                    "target_date": "2026-03-02",
                    "phase_id": dropped,
                },
            )
        else:
            milestone_write = client.patch(
                f"{API}/milestones/{existing['id']}",
                json={"phase_id": dropped},
                headers=_if_match(existing["version"]),
            )
        racer = asyncio.create_task(milestone_write)
        await self._blocked_or_done(sessions, racer)
        resume.set()
        saved = await save
        written = await racer
        assert saved.status_code == 200, saved.text

        async with sessions() as session:
            rows = list(
                (
                    await session.execute(
                        select(Milestone).where(Milestone.tenant_id == TENANT)
                    )
                )
                .scalars()
                .all()
            )
            logged: dict[str, list[str]] = {}
            for row in rows:
                logged[str(row.id)] = [
                    log.action
                    for log in (
                        await session.execute(
                            select(ChangeLog)
                            .where(
                                ChangeLog.resource == "milestones",
                                ChangeLog.record_id == str(row.id),
                            )
                            .order_by(ChangeLog.created_at, ChangeLog.id)
                        )
                    )
                    .scalars()
                    .all()
                ]

        if written.status_code == 422:
            # The write waited for the delete and found the phase gone.
            assert written.json()["error"] == "phase_not_found", written.text
        else:
            # Or it committed first — then the detach saw it, and untied it
            # as a write of its own.
            assert written.status_code in (200, 201), written.text
            item = written.json()["item"]
            row = next(r for r in rows if str(r.id) == item["id"])
            assert row.phase_id is None
            assert row.version == item["version"] + 1 and logged[item["id"]][-1] == (
                "update"
            ), (
                "the milestone was nulled by ON DELETE SET NULL with no version "
                f"bump or change-log row: version {row.version}, "
                f"log {logged[item['id']]}"
            )

    async def test_a_milestone_moving_onto_a_renamed_phase_does_not_deadlock_a_save(
        self, racing, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The save drops A1 and renames A2 (by id) to D2; the milestone tied
        to A1 is moved onto A2 at the same moment.

        The rename is a KEY update (``code`` is in the unique ``(estimate_id,
        code)`` index), so it needs ``FOR UPDATE`` on A2 — which conflicts
        with the ``FOR KEY SHARE`` the milestone write takes on A2 before it
        locks the milestone. If the save took A2's lock only at the rename,
        after its detach had locked the milestone, the two waited on each
        other: a deadlock, one of them aborted with a 500. The save now
        locks every phase first, so the milestone write waits on A2 and then
        meets the detached milestone's new version — a clean 409.
        """
        from app.models.overview import Milestone
        from app.overview import estimates, milestones

        client, sessions = racing
        estimate = await _estimate(client, "A0", "A1", "A2")
        a0, a1, a2 = (_phase_id(estimate, code) for code in ("A0", "A1", "A2"))
        made = await client.post(
            f"{API}/milestones",
            json={"title": "Pilot", "target_date": "2026-03-02", "phase_id": a1},
        )
        assert made.status_code == 201, made.text
        milestone = made.json()["item"]

        detached = asyncio.Event()
        resume = asyncio.Event()
        real_detach = milestones.detach_milestones

        async def detach_then_hold(ctx: Any, phase_ids: list[UUID]) -> None:
            # Held with the milestone already locked and detached, and the
            # rename of A2 still to come.
            await real_detach(ctx, phase_ids)
            detached.set()
            await resume.wait()

        monkeypatch.setattr(estimates, "detach_milestones", detach_then_hold)

        content = _content("A0", "D2")
        content["phases"][0]["id"] = a0
        content["phases"][1]["id"] = a2
        # A1 has a milestone tied to it, so dropping it is acknowledged.
        ack = {"phase_id": a1, "progress_version": 1, "milestone_count": 1}
        save = asyncio.create_task(
            client.patch(
                f"{API}/estimates/{estimate['id']}",
                json={"content": content, "acknowledged_drops": [ack]},
                headers=_if_match(1),
            )
        )
        await asyncio.wait_for(detached.wait(), 10)
        racer = asyncio.create_task(
            client.patch(
                f"{API}/milestones/{milestone['id']}",
                json={"phase_id": a2},
                headers=_if_match(milestone["version"]),
            )
        )
        await self._blocked_or_done(sessions, racer)
        resume.set()
        # A deadlock surfaces here as an exception out of the app (the
        # aborted transaction's DeadlockDetectedError), not as a status.
        saved, moved = await asyncio.wait_for(
            asyncio.gather(save, racer, return_exceptions=True), 30
        )
        assert not isinstance(saved, BaseException), repr(saved)
        assert not isinstance(moved, BaseException), repr(moved)
        assert saved.status_code == 200, saved.text
        item = saved.json()["item"]
        assert [(p["id"], p["code"]) for p in item["content"]["phases"]] == [
            (a0, "A0"),
            (a2, "D2"),
        ]
        # The milestone write waited for the save, then met the version the
        # detach gave the milestone: a clean conflict carrying that copy.
        assert moved.status_code == 409, moved.text
        async with sessions() as session:
            row = (
                await session.execute(
                    select(Milestone).where(Milestone.id == UUID(milestone["id"]))
                )
            ).scalar_one()
        assert row.phase_id is None and row.version == milestone["version"] + 1


# ===========================================================================
# The database refuses incoherent progress
# ===========================================================================


@pytest_asyncio.fixture()
async def admin(async_db_session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    from types import SimpleNamespace

    async def _db() -> AsyncIterator[AsyncSession]:
        yield async_db_session

    user = SimpleNamespace(id=uuid4(), email="coherence@example.com")
    async with _client(_app(_db, user)) as client:
        yield client


@pytest.mark.asyncio
class TestTheDatabaseRefusesIncoherentProgress:
    @pytest.mark.parametrize(
        ("assignments", "constraint"),
        [
            (
                "actual_end = DATE '2026-02-01'",
                "ck_overview_phases_actual_end_has_start",
            ),
            ("gate_status = 'passed'", "ck_overview_phases_gate_decision_dated"),
            ("gate_status = 'waived'", "ck_overview_phases_gate_decision_dated"),
            (
                "gate_decided_at = DATE '2026-02-01'",
                "ck_overview_phases_gate_decision_dated",
            ),
        ],
    )
    async def test_a_write_around_the_api_is_refused(
        self,
        admin: httpx.AsyncClient,
        async_db_session: AsyncSession,
        assignments: str,
        constraint: str,
    ) -> None:
        estimate = await _estimate(admin, "A0")
        phase = _phase_id(estimate, "A0")
        nested = await async_db_session.begin_nested()
        with pytest.raises(IntegrityError) as excinfo:
            await async_db_session.execute(
                text(f"UPDATE overview.phases SET {assignments} WHERE id = :id"),
                {"id": phase},
            )
        await nested.rollback()
        assert constraint in str(excinfo.value)

    async def test_a_coherent_write_around_the_api_is_accepted(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        estimate = await _estimate(admin, "A0")
        phase = _phase_id(estimate, "A0")
        await async_db_session.execute(
            text(
                "UPDATE overview.phases SET actual_start = DATE '2026-01-05', "
                "actual_end = DATE '2026-02-01', gate_status = 'failed', "
                "gate_decided_at = DATE '2026-02-01' WHERE id = :id"
            ),
            {"id": phase},
        )

    async def test_the_api_still_answers_422_first(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin, "A0")
        phase = _phase_id(estimate, "A0")
        for body in (
            {"actual_end": "2026-02-01"},
            {"gate_status": "passed"},
            {"gate_decided_at": "2026-02-01"},
        ):
            response = await admin.patch(
                f"{API}/phase-progress/{phase}", json=body, headers=_if_match(1)
            )
            assert response.status_code == 422, response.text
            assert response.json()["error"] == "invalid_progress"


# ===========================================================================
# A row stored incoherently before the CHECKs is refused visibly, not a 500
# ===========================================================================

#: For each CHECK: the statement that stores a row breaking it, and the
#: progress write that then makes the row coherent.
_LEGACY: dict[str, tuple[str, dict[str, Any]]] = {
    "ck_overview_phases_actual_end_has_start": (
        "actual_end = DATE '2026-02-01'",
        {"actual_start": "2026-01-05"},
    ),
    "ck_overview_phases_gate_decision_dated": (
        "gate_status = 'passed'",
        {"gate_decided_at": "2026-02-01"},
    ),
    "ck_overview_phases_actual_order": (
        "actual_start = DATE '2026-02-01', actual_end = DATE '2026-01-05'",
        {"actual_end": "2026-02-02"},
    ),
}


async def _store_legacy(session: AsyncSession, phase_id: str, constraint: str) -> None:
    """Store an incoherent phase row the way one was stored before the CHECK
    existed: drop the constraint, write the row, put the constraint back
    ``NOT VALID`` (so it is present, unvalidated, and the row untouched) —
    the state ``overview_04b_phase_progress_checks`` leaves a legacy row in.
    All of it is DDL inside the test's transaction, so it rolls back with it.
    """
    check = (
        await session.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'overview.phases'::regclass AND conname = :n"
            ),
            {"n": constraint},
        )
    ).scalar_one()
    await session.execute(
        text(f"ALTER TABLE overview.phases DROP CONSTRAINT {constraint}")
    )
    await session.execute(
        text(f"UPDATE overview.phases SET {_LEGACY[constraint][0]} WHERE id = :id"),
        {"id": phase_id},
    )
    await session.execute(
        text(
            f"ALTER TABLE overview.phases ADD CONSTRAINT {constraint} {check} NOT VALID"
        )
    )


@pytest.mark.asyncio
class TestALegacyIncoherentRowIsRefusedVisibly:
    @pytest.mark.parametrize("constraint", sorted(_LEGACY))
    async def test_an_estimate_save_rewriting_it_is_a_422_naming_the_phase(
        self,
        admin: httpx.AsyncClient,
        async_db_session: AsyncSession,
        constraint: str,
    ) -> None:
        estimate = await _estimate(admin, "A0", "A1")
        a0, a1 = _phase_id(estimate, "A0"), _phase_id(estimate, "A1")
        await _store_legacy(async_db_session, a1, constraint)

        # Renaming A1 (by id) UPDATEs its row, which the CHECK refuses.
        renamed = _content("A0", "D1")
        renamed["phases"][0]["id"], renamed["phases"][1]["id"] = a0, a1
        response = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"content": renamed},
            headers=_if_match(1),
        )
        assert response.status_code == 422, response.text
        body = response.json()
        assert body["error"] == "incoherent_recorded_progress"
        assert "Phase A1's recorded progress is incoherent" in body["message"]
        assert "on the Timeline" in body["message"]
        assert "A0" not in body["message"]

        # Rolled back cleanly: the session still answers, nothing changed.
        head = (await admin.get(f"{API}/estimates/{estimate['id']}")).json()["item"]
        assert head["version"] == 1
        assert [p["code"] for p in head["content"]["phases"]] == ["A0", "A1"]

        # A save that leaves A1's row alone is not refused...
        untouched = _content("A0", "A1")
        untouched["phases"][0]["name"] = "Discovery"
        ok = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"content": untouched},
            headers=_if_match(1),
        )
        assert ok.status_code == 200, ok.text

        # ...and once A1's progress is corrected on the Timeline, the rename
        # goes through.
        fixed = await admin.patch(
            f"{API}/phase-progress/{a1}",
            json=_LEGACY[constraint][1],
            headers=_if_match(1),
        )
        assert fixed.status_code == 200, fixed.text
        again = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"content": renamed},
            headers=_if_match(2),
        )
        assert again.status_code == 200, again.text
        assert _phase_id(again.json()["item"], "D1") == a1

    async def test_a_save_dropping_the_incoherent_phase_is_not_refused(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A DELETE is not checked, so dropping the phase is still possible
        (acknowledged, since it holds recorded progress)."""
        estimate = await _estimate(admin, "A0", "A1")
        a1 = _phase_id(estimate, "A1")
        await _store_legacy(
            async_db_session, a1, "ck_overview_phases_gate_decision_dated"
        )
        response = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={
                "content": _content("A0"),
                "acknowledged_drops": [
                    {"phase_id": a1, "progress_version": 1, "milestone_count": 0}
                ],
            },
            headers=_if_match(1),
        )
        assert response.status_code == 200, response.text

    async def test_a_progress_write_leaving_it_incoherent_is_a_422(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        estimate = await _estimate(admin, "A0")
        a0 = _phase_id(estimate, "A0")
        await _store_legacy(
            async_db_session, a0, "ck_overview_phases_gate_decision_dated"
        )
        # The API's own rule sees the row as it would stand and refuses first.
        response = await admin.patch(
            f"{API}/phase-progress/{a0}",
            json={"gate_notes": "Signed off"},
            headers=_if_match(1),
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"] == "invalid_progress"

    async def test_the_database_refusing_a_progress_write_is_a_422_naming_the_fields(
        self,
        admin: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Were the API's rule and the CHECKs ever to drift apart (or the rule
        be bypassed), the CHECK's refusal is still a 422 naming the fields,
        with only the write rolled back — not a 500 on a dead transaction."""
        from app.overview import phase_progress

        estimate = await _estimate(admin, "A0")
        a0 = _phase_id(estimate, "A0")
        await _store_legacy(
            async_db_session, a0, "ck_overview_phases_actual_end_has_start"
        )
        monkeypatch.setattr(phase_progress, "phase_progress_problem", lambda **_: None)
        response = await admin.patch(
            f"{API}/phase-progress/{a0}",
            json={"gate_notes": "Signed off"},
            headers=_if_match(1),
        )
        assert response.status_code == 422, response.text
        body = response.json()
        assert body["error"] == "incoherent_recorded_progress"
        assert "Phase A0's recorded progress is incoherent" in body["message"]
        assert "(actual_start, actual_end)" in body["message"]
        read = (await admin.get(f"{API}/phase-progress/{a0}")).json()["item"]
        assert read["version"] == 1 and read["gate_notes"] in (None, "")


# ===========================================================================
# A refused write commits nothing — through a session that really commits
# ===========================================================================


@pytest_asyncio.fixture()
async def committing(test_engine):
    """An admin client on the REAL request-session shape: every request gets
    its own session, which ``get_async_db``'s contract COMMITS when the route
    returns normally — a refusal answered as a JSONResponse included. The
    ``admin`` fixture above shares one never-committed session, which is why
    a refusal that had already written could pass its tests. Read back here
    through a separate session, after the request."""
    from types import SimpleNamespace

    from app.models.overview import ChangeLog, Estimate, Milestone

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)

    async def _clear() -> None:
        async with sessions() as session:
            for table in (Milestone, ChangeLog, Estimate):
                await session.execute(
                    table.__table__.delete().where(table.tenant_id == TENANT)
                )
            await session.commit()

    await _clear()

    async def _committing_session() -> AsyncIterator[AsyncSession]:
        # ``get_async_db``'s own shape: commit after a normal return.
        async with sessions() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    user = SimpleNamespace(id=uuid4(), email="committing@example.com")
    app = _app(_committing_session, user)
    try:
        async with _client(app) as client:
            yield client, sessions, app
    finally:
        await _clear()


async def _stored_estimate(
    sessions: async_sessionmaker[AsyncSession], estimate_id: str
) -> dict[str, Any]:
    from app.models.overview import ChangeLog, Estimate, Phase

    async with sessions() as session:
        row = (
            await session.execute(
                select(Estimate).where(Estimate.id == UUID(estimate_id))
            )
        ).scalar_one()
        codes = (
            (
                await session.execute(
                    select(Phase.code)
                    .where(Phase.estimate_id == row.id)
                    .order_by(Phase.sort_order)
                )
            )
            .scalars()
            .all()
        )
        log = (
            (
                await session.execute(
                    select(ChangeLog.action).where(
                        ChangeLog.resource == "estimates",
                        ChangeLog.record_id == estimate_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return {
            "name": row.name,
            "version": row.version,
            "is_baseline": row.is_baseline,
            "codes": list(codes),
            "log": sorted(log),
        }


@pytest.mark.asyncio
class TestARefusedWriteCommitsNothing:
    async def test_a_refused_estimate_save_keeps_its_head_and_the_baseline(
        self, committing
    ) -> None:
        """A save carrying a head field, the baseline flag and content the
        store refuses (here: a drop it did not acknowledge) used to answer
        409/422 having already demoted the other baseline and set the new
        name — and the request's session then committed both, with no
        version bump and no change-log row."""
        client, sessions, _ = committing
        first = await _estimate(client, "A0", "A1")
        second = await _estimate(client, "B0")  # takes the baseline from it
        a1 = _phase_id(first, "A1")
        recorded = await client.patch(
            f"{API}/phase-progress/{a1}",
            json={"gate_status": "passed", "gate_decided_at": "2026-01-30"},
            headers=_if_match(1),
        )
        assert recorded.status_code == 200, recorded.text
        before_first = await _stored_estimate(sessions, first["id"])
        before_second = await _stored_estimate(sessions, second["id"])
        assert before_first["is_baseline"] is False
        assert before_second["is_baseline"] is True

        response = await client.patch(
            f"{API}/estimates/{first['id']}",
            json={"name": "SNEAKY", "is_baseline": True, "content": _content("A0")},
            headers=_if_match(before_first["version"]),
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"] == "unacknowledged_drop"

        assert await _stored_estimate(sessions, first["id"]) == before_first
        assert await _stored_estimate(sessions, second["id"]) == before_second

    @pytest.mark.parametrize("verb", ["create", "update"])
    async def test_a_store_that_writes_then_refuses_commits_nothing(
        self, committing, verb: str
    ) -> None:
        """The choke point, for any resource: whatever a store wrote before
        it refused is undone before the route answers — so a resource added
        to the registry later cannot reintroduce this (``app.overview.http.refusable``)."""
        from app.models.overview import ChangeLog, Milestone
        from app.overview.milestones import MilestoneStore, milestone_store
        from app.overview.resource import StoreRefused

        client, sessions, app = committing
        made = await client.post(
            f"{API}/milestones",
            json={"title": "Pilot", "target_date": "2026-03-02"},
        )
        assert made.status_code == 201, made.text
        milestone = made.json()["item"]

        class WritesThenRefuses(MilestoneStore):
            async def create(self, ctx: Any, payload: Any) -> Any:
                await super().create(ctx, payload)
                raise StoreRefused(422, "refused_after_writing", "No.")

            async def update(self, ctx: Any, *args: Any) -> Any:
                await super().update(ctx, *args)
                raise StoreRefused(422, "refused_after_writing", "No.")

        app.dependency_overrides[milestone_store] = WritesThenRefuses
        if verb == "create":
            response = await client.post(
                f"{API}/milestones",
                json={"title": "Second", "target_date": "2026-03-09"},
            )
        else:
            response = await client.patch(
                f"{API}/milestones/{milestone['id']}",
                json={"title": "Renamed"},
                headers=_if_match(1),
            )
        assert response.status_code == 422, response.text
        assert response.json()["error"] == "refused_after_writing"

        async with sessions() as session:
            rows = (
                (
                    await session.execute(
                        select(Milestone).where(Milestone.tenant_id == TENANT)
                    )
                )
                .scalars()
                .all()
            )
            logged = (
                (
                    await session.execute(
                        select(ChangeLog.action).where(
                            ChangeLog.tenant_id == TENANT,
                            ChangeLog.resource == "milestones",
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert [(r.title, r.version) for r in rows] == [("Pilot", 1)]
        assert logged == ["create"]

    async def test_posting_an_estimate_read_back_as_a_copy_ignores_its_phase_ids(
        self, committing
    ) -> None:
        """GET → POST is a copy: the phase ids it carries name another
        estimate's phases, and a new estimate's phases are all new. It used
        to be refused AFTER the head row was written, leaving an orphan
        estimate (and the baseline handed to it)."""
        client, sessions, _ = committing
        original = await _estimate(client, "A0", "A1")
        copied = _content("A0", "A1")
        for phase in copied["phases"]:
            phase["id"] = _phase_id(original, phase["code"])
        response = await client.post(
            f"{API}/estimates",
            json={
                "name": "Copy",
                "purpose": "budget",
                "is_baseline": True,
                "content": copied,
            },
        )
        assert response.status_code == 201, response.text
        copy = response.json()["item"]
        assert [p["code"] for p in copy["content"]["phases"]] == ["A0", "A1"]
        assert {_phase_id(copy, c) for c in ("A0", "A1")}.isdisjoint(
            {_phase_id(original, c) for c in ("A0", "A1")}
        )
        # The original keeps its phases, by the same ids.
        read = (await client.get(f"{API}/estimates/{original['id']}")).json()["item"]
        assert [_phase_id(read, c) for c in ("A0", "A1")] == [
            _phase_id(original, c) for c in ("A0", "A1")
        ]


@pytest.mark.asyncio
class TestAnUnacknowledgedDropIsRefused:
    async def test_a_phase_holding_nothing_needs_no_acknowledgement(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin, "A0", "A1")
        response = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"content": _content("A0")},
            headers=_if_match(1),
        )
        assert response.status_code == 200, response.text

    async def test_progress_recorded_after_the_check_refuses_the_save(
        self, admin: httpx.AsyncClient
    ) -> None:
        """The race the client's own check cannot close: it found A1 clear
        (or acknowledged it at progress version 1), then somebody recorded
        A1's gate before Save. The save is refused with A1 as it now stands,
        and nothing is written; acknowledging THAT state goes through."""
        estimate = await _estimate(admin, "A0", "A1")
        a1 = _phase_id(estimate, "A1")
        seen = {"phase_id": a1, "progress_version": 1, "milestone_count": 0}
        recorded = await admin.patch(
            f"{API}/phase-progress/{a1}",
            json={"gate_status": "passed", "gate_decided_at": "2026-01-30"},
            headers=_if_match(1),
        )
        assert recorded.status_code == 200, recorded.text
        made = await admin.post(
            f"{API}/milestones",
            json={"title": "Pilot", "target_date": "2026-03-02", "phase_id": a1},
        )
        assert made.status_code == 201, made.text

        for acknowledged in ([], [seen]):
            response = await admin.patch(
                f"{API}/estimates/{estimate['id']}",
                json={"content": _content("A0"), "acknowledged_drops": acknowledged},
                headers=_if_match(1),
            )
            assert response.status_code == 409, response.text
            body = response.json()
            assert body["error"] == "unacknowledged_drop"
            assert body["phases"] == [
                {
                    "phase_id": a1,
                    "code": "A1",
                    "name": "Phase A1",
                    "progress_version": 2,
                    "milestone_count": 1,
                    "actual_start": None,
                    "actual_end": None,
                    "gate_status": "passed",
                    "gate_decided_at": "2026-01-30",
                    "gate_notes": "",
                }
            ]
            head = (await admin.get(f"{API}/estimates/{estimate['id']}")).json()
            assert head["item"]["version"] == 1
            assert [p["code"] for p in head["item"]["content"]["phases"]] == [
                "A0",
                "A1",
            ]

        fresh = {"phase_id": a1, "progress_version": 2, "milestone_count": 1}
        response = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"content": _content("A0"), "acknowledged_drops": [fresh]},
            headers=_if_match(1),
        )
        assert response.status_code == 200, response.text
        assert [p["code"] for p in response.json()["item"]["content"]["phases"]] == [
            "A0"
        ]

    async def test_a_milestone_tied_after_the_check_refuses_the_save(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin, "A0", "A1")
        a1 = _phase_id(estimate, "A1")
        made = await admin.post(
            f"{API}/milestones",
            json={"title": "Pilot", "target_date": "2026-03-02", "phase_id": a1},
        )
        assert made.status_code == 201, made.text
        stale = {"phase_id": a1, "progress_version": 1, "milestone_count": 0}
        response = await admin.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"content": _content("A0"), "acknowledged_drops": [stale]},
            headers=_if_match(1),
        )
        assert response.status_code == 409, response.text
        assert response.json()["phases"][0]["milestone_count"] == 1

    async def test_a_refused_incoherent_rename_keeps_the_head_and_the_baseline(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The review's reproduction: a head field and the baseline flag
        beside content the database refuses (a rename of a legacy-incoherent
        phase). The 422 used to leave the new name and the other estimate's
        demotion in the session."""
        first = await _estimate(admin, "A0", "A1")
        second = await _estimate(admin, "B0")  # now the baseline
        a0, a1 = _phase_id(first, "A0"), _phase_id(first, "A1")
        await _store_legacy(
            async_db_session, a1, "ck_overview_phases_gate_decision_dated"
        )
        renamed = _content("A0", "D1")
        renamed["phases"][0]["id"], renamed["phases"][1]["id"] = a0, a1
        version = (await admin.get(f"{API}/estimates/{first['id']}")).json()["item"][
            "version"
        ]
        response = await admin.patch(
            f"{API}/estimates/{first['id']}",
            json={"name": "SNEAKY", "is_baseline": True, "content": renamed},
            headers=_if_match(version),
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"] == "incoherent_recorded_progress"
        head = (await admin.get(f"{API}/estimates/{first['id']}")).json()["item"]
        assert (head["name"], head["version"], head["is_baseline"]) == (
            "Plan",
            version,
            False,
        )
        other = (await admin.get(f"{API}/estimates/{second['id']}")).json()["item"]
        assert (other["version"], other["is_baseline"]) == (1, True)


# ===========================================================================
# Progress cannot be dated in the future
# ===========================================================================


@pytest.mark.asyncio
class TestProgressIsWhatHasHappened:
    @pytest.mark.parametrize("field", ["actual_start", "actual_end", "gate_decided_at"])
    async def test_a_date_past_tomorrow_is_a_422_naming_the_field(
        self, admin: httpx.AsyncClient, field: str
    ) -> None:
        estimate = await _estimate(admin, "A0")
        phase = _phase_id(estimate, "A0")
        today = datetime.now(UTC).date()
        future = (today + timedelta(days=2)).isoformat()
        body: dict[str, Any] = {field: future}
        # Otherwise coherent, so the date is the only thing wrong.
        if field == "actual_end":
            body["actual_start"] = today.isoformat()
        if field == "gate_decided_at":
            body["gate_status"] = "passed"
        response = await admin.patch(
            f"{API}/phase-progress/{phase}", json=body, headers=_if_match(1)
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"] == "invalid_progress"
        message = response.json()["message"]
        assert message.startswith(f"A0: {field} is {future}"), message
        assert "has not happened yet" in message

    async def test_tomorrow_is_allowed_for_timezones(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin, "A0")
        phase = _phase_id(estimate, "A0")
        tomorrow = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()
        response = await admin.patch(
            f"{API}/phase-progress/{phase}",
            json={
                "actual_start": tomorrow,
                "actual_end": tomorrow,
                "gate_status": "passed",
                "gate_decided_at": tomorrow,
            },
            headers=_if_match(1),
        )
        assert response.status_code == 200, response.text


def test_the_rule_is_against_the_given_today() -> None:
    from datetime import date

    from app.schemas.overview import phase_progress_problem

    today = date(2026, 10, 3)
    assert (
        phase_progress_problem(
            actual_start=date(2026, 10, 4),
            actual_end=None,
            gate_status="pending",
            gate_decided_at=None,
            today=today,
        )
        is None
    )
    problem = phase_progress_problem(
        actual_start=date(2027, 1, 5),
        actual_end=None,
        gate_status="pending",
        gate_decided_at=None,
        today=today,
    )
    assert problem is not None and "actual_start is 2027-01-05" in problem
    assert "at most 2026-10-04" in problem


# ===========================================================================
# The migration
# ===========================================================================

_REVISION = "overview_04b_phase_progress_checks"
_PARENT = "overview_04_timeline"
_CHECKS = (
    "ck_overview_phases_actual_end_has_start",
    "ck_overview_phases_gate_decision_dated",
)

_SKIP_NO_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()), reason="no test Postgres reachable"
)


def _checks(engine: Any) -> dict[str, bool]:
    """``{name: convalidated}`` for the two constraints, where present."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname, convalidated FROM pg_constraint "
                "WHERE conrelid = 'overview.phases'::regclass "
                "AND conname = ANY(:names)"
            ),
            {"names": list(_CHECKS)},
        ).all()
    return {row.conname: row.convalidated for row in rows}


@_SKIP_NO_PG
def test_the_migration_adds_the_checks_not_valid_and_walks_up_down_up() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "overview_04b_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT)
        assert _checks(engine) == {}

        # A row written incoherently before the rule existed.
        tenant = uuid4()
        with engine.begin() as conn:
            estimate = conn.execute(
                text(
                    "INSERT INTO overview.estimates (tenant_id, name, purpose) "
                    "VALUES (:t, 'Plan', 'budget') RETURNING id"
                ),
                {"t": tenant},
            ).scalar_one()
            legacy = conn.execute(
                text(
                    "INSERT INTO overview.phases (tenant_id, estimate_id, code, "
                    "name, actual_end, gate_status) VALUES (:t, :e, 'A0', "
                    "'Legacy', DATE '2026-02-01', 'passed') RETURNING id"
                ),
                {"t": tenant, "e": estimate},
            ).scalar_one()

        run_alembic(root, url, "upgrade", _REVISION)
        # Added NOT VALID: present, unvalidated, and the stored row untouched.
        assert _checks(engine) == dict.fromkeys(_CHECKS, False)
        with engine.connect() as conn:
            kept = conn.execute(
                text(
                    "SELECT actual_start, actual_end, gate_status, gate_decided_at "
                    "FROM overview.phases WHERE id = :id"
                ),
                {"id": legacy},
            ).one()
        assert kept.actual_start is None and kept.gate_decided_at is None

        # Every new write is checked, an INSERT and an UPDATE alike...
        for statement, params in (
            (
                "INSERT INTO overview.phases (tenant_id, estimate_id, code, name, "
                "gate_decided_at) VALUES (:t, :e, 'A1', 'New', DATE '2026-02-01')",
                {"t": tenant, "e": estimate},
            ),
            (
                "UPDATE overview.phases SET name = 'Renamed' WHERE id = :id",
                {"id": legacy},
            ),
        ):
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(text(statement), params)
        # ...and a write that leaves the legacy row coherent goes through.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE overview.phases SET actual_start = DATE '2026-01-05', "
                    "gate_decided_at = DATE '2026-02-01' WHERE id = :id"
                ),
                {"id": legacy},
            )

        # Re-runnable: the guard finds both by name and adds neither again.
        run_alembic(root, url, "stamp", _PARENT)
        run_alembic(root, url, "upgrade", _REVISION)
        assert _checks(engine) == dict.fromkeys(_CHECKS, False)

        run_alembic(root, url, "downgrade", _PARENT)
        assert _checks(engine) == {}
        run_alembic(root, url, "upgrade", _REVISION)
        assert set(_checks(engine)) == set(_CHECKS)
