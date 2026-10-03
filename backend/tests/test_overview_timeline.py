"""The Timeline — milestones, phase progress and the forecast, end to end.

Plan ``2026-09-20-overview-authoring-layer`` Phase 4. Mirrors
``tests/test_overview_estimates_api.py``: full HTTP through ``ASGITransport``
against real Postgres, with only coord's answer to "who is calling, in which
project" stubbed (``get_overview_caller``) — the project's ``editing_roles``,
the permission decision and every query's tenant run for real.

Three things are proven here beyond the contract every resource shares
(tenant isolation, role gating, ``If-Match`` and the 409 body, idempotent
create, validation, a change-log row per write):

* **Recording progress and saving the estimate never collide.** A gate
  outcome recorded on the Timeline neither moves the estimate's version nor is
  undone by an estimate Save built before it — the defect the split exists for.
* **A milestone outlives its phase**, detached as a logged write when the
  estimate's plan drops the phase or the estimate goes.
* **The forecast's arithmetic** — a pure function, checked by hand.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import Phase
from app.services.overview_forecast import compute_forecast

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000a4")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000b4")


# ===========================================================================
# Harness
# ===========================================================================


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"timeline_{uuid4().hex[:8]}@example.com",
        username=f"timeline_{uuid4().hex[:8]}",
        full_name="Timeline Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _app(db: AsyncSession, user, tenant: UUID, roles: tuple[str, ...]) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
    from app.api.v1.endpoints.overview import router as overview_router
    from app.overview.permissions import OverviewCaller, get_overview_caller
    from app.overview.router import router as authoring_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user

    async def _db():
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=tenant, roles=roles
    )
    app.include_router(overview_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Overview-Source": "ui"},
    )


@pytest_asyncio.fixture()
async def admin(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_A, ("admin",))) as c:
        yield c


@pytest_asyncio.fixture()
async def operator(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_A, ("operator",))) as c:
        yield c


@pytest_asyncio.fixture()
async def other_project(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_B, ("admin",))) as c:
        yield c


def _phases(*codes: str) -> list[dict[str, Any]]:
    """Consecutive four-week phases from 2026-01-05, one per code."""
    out = []
    start = date(2026, 1, 5)
    for index, code in enumerate(codes):
        begin = start + timedelta(weeks=4 * index)
        out.append(
            {
                "code": code,
                "name": f"Phase {code}",
                "planned_start": begin.isoformat(),
                "planned_end": (begin + timedelta(days=25)).isoformat(),
                "gate_criteria": f"Gate {code} demonstrated",
            }
        )
    return out


def _content(*codes: str) -> dict[str, Any]:
    return {"roles": [], "phases": _phases(*codes)}


async def _estimate(
    client: httpx.AsyncClient, *codes: str, baseline: bool = True
) -> dict[str, Any]:
    response = await client.post(
        f"{API}/estimates",
        json={
            "name": "Plan",
            "purpose": "budget",
            "is_baseline": baseline,
            "content": _content(*(codes or ("A0", "A1", "A2"))),
        },
    )
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()["item"]
    return item


def _phase_id(estimate: dict[str, Any], code: str) -> str:
    for phase in estimate["content"]["phases"]:
        if phase["code"] == code:
            return str(phase["id"])
    raise AssertionError(f"no phase {code}")


async def _patch(
    client: httpx.AsyncClient,
    path: str,
    body: dict[str, Any],
    version: int,
) -> httpx.Response:
    return await client.patch(
        f"{API}/{path}", json=body, headers={"If-Match": f'"{version}"'}
    )


async def _milestone(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"title": "Pilot live", "target_date": "2026-03-02"}
    payload.update(body)
    response = await client.post(f"{API}/milestones", json=payload)
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()["item"]
    return item


async def _log(db: AsyncSession, resource: str, record_id: str) -> list[Any]:
    from app.models.overview import ChangeLog

    stmt = (
        select(ChangeLog)
        .where(ChangeLog.resource == resource, ChangeLog.record_id == record_id)
        .order_by(ChangeLog.created_at, ChangeLog.id)
    )
    return list((await db.execute(stmt)).scalars().all())


def _can_edit(catalog: dict[str, Any], name: str) -> bool:
    return bool(next(r for r in catalog["resources"] if r["name"] == name)["can_edit"])


# ===========================================================================
# Milestones
# ===========================================================================


class TestMilestones:
    async def test_create_read_and_list_in_date_order(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        a1 = _phase_id(estimate, "A1")
        later = await _milestone(admin, title="First value", target_date="2026-05-01")
        first = await _milestone(
            admin, title="Pilot", kind="pilot", phase_id=a1, target_date="2026-02-10"
        )
        assert first["phase_code"] == "A1"
        assert first["version"] == 1
        read = await admin.get(f"{API}/milestones/{first['id']}")
        assert read.status_code == 200
        assert read.headers["ETag"] == '"1"'
        listed = (await admin.get(f"{API}/milestones")).json()
        assert [m["id"] for m in listed["items"]] == [first["id"], later["id"]]
        assert listed["can_edit"] is True

    async def test_a_member_reads_but_cannot_write(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        made = await _milestone(admin)
        catalog = (await operator.get(f"{API}/resources")).json()
        assert _can_edit(catalog, "milestones") is False
        assert _can_edit(catalog, "phase_progress") is False
        listed = (await operator.get(f"{API}/milestones")).json()
        assert listed["can_edit"] is False and len(listed["items"]) == 1
        denied = await operator.post(
            f"{API}/milestones", json={"title": "x", "target_date": "2026-01-01"}
        )
        assert denied.status_code == 403
        patched = await _patch(operator, f"milestones/{made['id']}", {"title": "y"}, 1)
        assert patched.status_code == 403
        deleted = await operator.delete(
            f"{API}/milestones/{made['id']}", headers={"If-Match": '"1"'}
        )
        assert deleted.status_code == 403

    async def test_editing_roles_lets_a_member_write(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        widened = await admin.put(
            f"{API}/settings", json={"editing_roles": ["admin", "operator"]}
        )
        assert widened.status_code == 200, widened.text
        made = await _milestone(operator, title="By an operator")
        assert made["created_by"]

    async def test_a_write_without_if_match_is_428(
        self, admin: httpx.AsyncClient
    ) -> None:
        made = await _milestone(admin)
        response = await admin.patch(
            f"{API}/milestones/{made['id']}", json={"title": "y"}
        )
        assert response.status_code == 428

    async def test_a_stale_write_is_a_409_carrying_the_servers_copy(
        self, admin: httpx.AsyncClient
    ) -> None:
        made = await _milestone(admin)
        first = await _patch(admin, f"milestones/{made['id']}", {"title": "Theirs"}, 1)
        assert first.status_code == 200
        stale = await _patch(admin, f"milestones/{made['id']}", {"title": "Mine"}, 1)
        assert stale.status_code == 409
        body = stale.json()
        assert body["error"] == "version_conflict"
        assert body["current"]["title"] == "Theirs"
        assert body["current"]["version"] == 2
        assert stale.headers["ETag"] == '"2"'

    async def test_a_stale_delete_deletes_nothing(
        self, admin: httpx.AsyncClient
    ) -> None:
        made = await _milestone(admin)
        await _patch(admin, f"milestones/{made['id']}", {"title": "Moved on"}, 1)
        refused = await admin.delete(
            f"{API}/milestones/{made['id']}", headers={"If-Match": '"1"'}
        )
        assert refused.status_code == 409
        assert (await admin.get(f"{API}/milestones/{made['id']}")).status_code == 200
        gone = await admin.delete(
            f"{API}/milestones/{made['id']}", headers={"If-Match": '"2"'}
        )
        assert gone.status_code == 204
        assert (await admin.get(f"{API}/milestones/{made['id']}")).status_code == 404

    async def test_create_is_idempotent_under_a_retry(
        self, admin: httpx.AsyncClient
    ) -> None:
        body = {"title": "Pilot", "target_date": "2026-03-02"}
        headers = {"Idempotency-Key": "milestone-retry-1"}
        first = await admin.post(f"{API}/milestones", json=body, headers=headers)
        again = await admin.post(f"{API}/milestones", json=body, headers=headers)
        assert first.status_code == 201
        assert again.status_code == 200
        assert again.headers["Idempotent-Replayed"] == "true"
        assert again.json()["item"]["id"] == first.json()["item"]["id"]
        assert len((await admin.get(f"{API}/milestones")).json()["items"]) == 1

    @pytest.mark.parametrize(
        ("body", "needle"),
        [
            ({"status": "done"}, "completed_date"),
            ({"completed_date": "2026-03-01"}, "only a done milestone"),
            ({"kind": "gate"}, "kind"),
            ({"title": "   "}, "title"),
            ({"target_date": "1900-01-01"}, "target_date"),
            ({"target_date": "2300-01-01"}, "target_date"),
            ({"title": "a\x00b"}, "NUL"),
            ({"description": "x" * 4001}, "description"),
        ],
    )
    async def test_a_create_the_rules_refuse_is_a_422(
        self, admin: httpx.AsyncClient, body: dict[str, Any], needle: str
    ) -> None:
        payload = {"title": "Pilot", "target_date": "2026-03-02", **body}
        response = await admin.post(f"{API}/milestones", json=payload)
        assert response.status_code == 422, response.text
        assert needle in response.text

    async def test_done_is_checked_on_the_milestone_as_it_will_be(
        self, admin: httpx.AsyncClient
    ) -> None:
        made = await _milestone(admin)
        alone = await _patch(admin, f"milestones/{made['id']}", {"status": "done"}, 1)
        assert alone.status_code == 422
        assert alone.json()["error"] == "invalid_milestone"
        both = await _patch(
            admin,
            f"milestones/{made['id']}",
            {"status": "done", "completed_date": "2026-03-03"},
            1,
        )
        assert both.status_code == 200, both.text
        reopened = await _patch(
            admin, f"milestones/{made['id']}", {"status": "at_risk"}, 2
        )
        assert reopened.status_code == 422  # still carries its completed date

    @pytest.mark.parametrize("field", ["title", "kind", "target_date", "status"])
    async def test_clearing_a_required_field_is_a_422_not_a_500(
        self, admin: httpx.AsyncClient, field: str
    ) -> None:
        made = await _milestone(admin)
        response = await _patch(admin, f"milestones/{made['id']}", {field: None}, 1)
        assert response.status_code == 422

    async def test_an_empty_patch_is_a_422(self, admin: httpx.AsyncClient) -> None:
        made = await _milestone(admin)
        assert (
            await _patch(admin, f"milestones/{made['id']}", {}, 1)
        ).status_code == 422

    async def test_the_phase_must_be_one_of_this_project(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        theirs = await _estimate(other_project)
        foreign = _phase_id(theirs, "A0")
        for phase_id in (foreign, str(uuid4())):
            response = await admin.post(
                f"{API}/milestones",
                json={"title": "x", "target_date": "2026-01-01", "phase_id": phase_id},
            )
            assert response.status_code == 422
            assert response.json()["error"] == "phase_not_found"
        made = await _milestone(admin)
        moved = await _patch(
            admin, f"milestones/{made['id']}", {"phase_id": foreign}, 1
        )
        assert moved.status_code == 422

    async def test_every_write_leaves_a_change_log_row_with_its_source(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        made = await _milestone(admin)
        await _patch(admin, f"milestones/{made['id']}", {"title": "Renamed"}, 1)
        await admin.delete(
            f"{API}/milestones/{made['id']}", headers={"If-Match": '"2"'}
        )
        rows = await _log(async_db_session, "milestones", made["id"])
        assert [r.action for r in rows] == ["create", "update", "delete"]
        assert {r.source for r in rows} == {"ui"}
        assert rows[1].before["title"] == "Pilot live"
        assert rows[1].after["title"] == "Renamed"
        assert rows[2].before["version"] == 2 and rows[2].after is None

    async def test_an_unchanged_write_moves_nothing(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        made = await _milestone(admin)
        same = await _patch(
            admin, f"milestones/{made['id']}", {"title": "Pilot live"}, 1
        )
        assert same.status_code == 200
        assert same.json()["item"]["version"] == 1
        assert len(await _log(async_db_session, "milestones", made["id"])) == 1

    async def test_filters_by_phase_and_status(self, admin: httpx.AsyncClient) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        tied = await _milestone(admin, title="Tied", phase_id=a0)
        loose = await _milestone(admin, title="Loose", status="at_risk")

        async def ids(**params: Any) -> list[str]:
            listed = await admin.get(f"{API}/milestones", params=params)
            return [m["id"] for m in listed.json()["items"]]

        assert await ids(phase_id=a0) == [tied["id"]]
        assert await ids(phase_id="none") == [loose["id"]]
        assert await ids(status="at_risk") == [loose["id"]]
        assert await ids(phase_id="not-a-uuid") == []


class TestMilestoneTenantIsolation:
    async def test_another_project_cannot_list_read_or_write_it(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        made = await _milestone(admin)
        assert (await other_project.get(f"{API}/milestones")).json()["items"] == []
        assert (
            await other_project.get(f"{API}/milestones/{made['id']}")
        ).status_code == 404
        patched = await _patch(
            other_project, f"milestones/{made['id']}", {"title": "x"}, 1
        )
        assert patched.status_code == 404
        deleted = await other_project.delete(
            f"{API}/milestones/{made['id']}", headers={"If-Match": '"1"'}
        )
        assert deleted.status_code == 404
        assert (await admin.get(f"{API}/milestones/{made['id']}")).json()["item"][
            "title"
        ] == "Pilot live"

    async def test_an_id_that_is_not_a_uuid_is_404_not_500(
        self, admin: httpx.AsyncClient
    ) -> None:
        assert (await admin.get(f"{API}/milestones/nope")).status_code == 404
        assert (await admin.get(f"{API}/phase-progress/nope")).status_code == 404

    async def test_an_idempotency_key_is_per_project(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        body = {"title": "Pilot", "target_date": "2026-03-02"}
        headers = {"Idempotency-Key": "shared-key"}
        ours = await admin.post(f"{API}/milestones", json=body, headers=headers)
        theirs = await other_project.post(
            f"{API}/milestones", json=body, headers=headers
        )
        assert ours.status_code == 201 and theirs.status_code == 201
        assert ours.json()["item"]["id"] != theirs.json()["item"]["id"]


class TestAMilestoneOutlivesItsPhase:
    async def test_a_kept_phase_keeps_its_id_and_its_milestones(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        a1 = _phase_id(estimate, "A1")
        made = await _milestone(admin, phase_id=a1)
        replanned = _content("A0", "A1", "A2")
        replanned["phases"][1]["name"] = "Discovery, renamed"
        saved = await _patch(
            admin, f"estimates/{estimate['id']}", {"content": replanned}, 1
        )
        assert saved.status_code == 200, saved.text
        assert _phase_id(saved.json()["item"], "A1") == a1
        read = (await admin.get(f"{API}/milestones/{made['id']}")).json()["item"]
        assert read["phase_id"] == a1 and read["version"] == 1

    async def test_dropping_a_phase_detaches_its_milestone_as_a_logged_write(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        estimate = await _estimate(admin)
        a2 = _phase_id(estimate, "A2")
        made = await _milestone(admin, phase_id=a2)
        saved = await _patch(
            admin, f"estimates/{estimate['id']}", {"content": _content("A0", "A1")}, 1
        )
        assert saved.status_code == 200, saved.text
        read = (await admin.get(f"{API}/milestones/{made['id']}")).json()["item"]
        assert read["phase_id"] is None and read["phase_code"] is None
        assert read["version"] == 2
        rows = await _log(async_db_session, "milestones", made["id"])
        assert [r.action for r in rows] == ["create", "update"]
        assert rows[1].before["phase_code"] == "A2"
        # A client holding the old copy now gets a conflict, not a silent change.
        stale = await _patch(admin, f"milestones/{made['id']}", {"title": "x"}, 1)
        assert stale.status_code == 409

    async def test_deleting_the_estimate_detaches_too(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        made = await _milestone(admin, phase_id=_phase_id(estimate, "A0"))
        gone = await admin.delete(
            f"{API}/estimates/{estimate['id']}", headers={"If-Match": '"1"'}
        )
        assert gone.status_code == 204
        read = (await admin.get(f"{API}/milestones/{made['id']}")).json()["item"]
        assert read["phase_id"] is None and read["version"] == 2


# ===========================================================================
# Phase progress
# ===========================================================================


async def _progress(client: httpx.AsyncClient, **params: Any) -> list[dict[str, Any]]:
    response = await client.get(f"{API}/phase-progress", params=params)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


class TestPhaseProgress:
    async def test_lists_the_baseline_phases_in_plan_order(
        self, admin: httpx.AsyncClient
    ) -> None:
        await _estimate(admin, "B0", "B1", baseline=False)
        baseline = await _estimate(admin, "A0", "A1", "A2")
        rows = await _progress(admin)
        assert [r["code"] for r in rows] == ["A0", "A1", "A2"]
        first = rows[0]
        assert first["estimate_id"] == baseline["id"]
        assert first["gate_status"] == "pending"
        assert first["gate_criteria"] == "Gate A0 demonstrated"
        assert first["version"] == 1
        assert first["updated_at"] is None and first["updated_by"] is None

    async def test_an_estimate_can_be_named(self, admin: httpx.AsyncClient) -> None:
        other = await _estimate(admin, "B0", "B1", baseline=False)
        await _estimate(admin, "A0")
        rows = await _progress(admin, estimate_id=other["id"])
        assert [r["code"] for r in rows] == ["B0", "B1"]
        assert await _progress(admin, estimate_id=str(uuid4())) == []

    async def test_a_project_with_no_estimate_has_no_phases(
        self, admin: httpx.AsyncClient
    ) -> None:
        assert await _progress(admin) == []

    async def test_recording_a_gate_moves_its_own_version_and_not_the_estimates(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        response = await _patch(
            admin,
            f"phase-progress/{a0}",
            {
                "actual_start": "2026-01-06",
                "actual_end": "2026-02-03",
                "gate_status": "passed",
                "gate_decided_at": "2026-02-03",
                "gate_notes": "Shown to the sponsor",
            },
            1,
        )
        assert response.status_code == 200, response.text
        item = response.json()["item"]
        assert item["version"] == 2 and response.headers["ETag"] == '"2"'
        assert item["updated_by"] and item["updated_at"]
        head = (await admin.get(f"{API}/estimates/{estimate['id']}")).json()["item"]
        assert head["version"] == 1
        phase = head["content"]["phases"][0]
        assert phase["gate_status"] == "passed"
        assert phase["actual_end"] == "2026-02-03"
        rows = await _log(async_db_session, "phase_progress", a0)
        assert [r.action for r in rows] == ["update"]
        assert rows[0].before["gate_status"] == "pending"
        assert rows[0].after["gate_status"] == "passed"
        assert rows[0].source == "ui"

    async def test_an_estimate_save_built_before_the_outcome_keeps_it(
        self, admin: httpx.AsyncClient
    ) -> None:
        """The defect the split exists for. The estimate editor loaded
        version 1; a gate outcome is recorded on the Timeline; the editor then
        saves a re-plan built on version 1. The save is NOT a conflict (it
        changed nothing the Timeline owns), and the outcome is still there."""
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        recorded = await _patch(
            admin,
            f"phase-progress/{a0}",
            {"gate_status": "failed", "gate_decided_at": "2026-02-02"},
            1,
        )
        assert recorded.status_code == 200
        replanned = _content("A0", "A1", "A2")
        replanned["phases"][0]["planned_end"] = "2026-02-06"
        saved = await _patch(
            admin, f"estimates/{estimate['id']}", {"content": replanned}, 1
        )
        assert saved.status_code == 200, saved.text
        phase = saved.json()["item"]["content"]["phases"][0]
        assert phase["id"] == a0
        assert phase["planned_end"] == "2026-02-06"
        assert phase["gate_status"] == "failed"
        assert phase["gate_decided_at"] == "2026-02-02"
        progress = (await admin.get(f"{API}/phase-progress/{a0}")).json()["item"]
        # The plan moved; the progress version did not.
        assert progress["version"] == 2
        assert progress["planned_end"] == "2026-02-06"

    async def test_a_content_write_naming_progress_is_refused_whole(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        content = _content("A0")
        content["phases"][0]["gate_status"] = "passed"
        response = await _patch(
            admin, f"estimates/{estimate['id']}", {"content": content}, 1
        )
        assert response.status_code == 422
        assert "phase-progress" in response.text

    async def test_a_stale_write_is_a_409_carrying_the_servers_copy(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        a1 = _phase_id(estimate, "A1")
        await _patch(admin, f"phase-progress/{a1}", {"gate_notes": "Theirs"}, 1)
        stale = await _patch(admin, f"phase-progress/{a1}", {"gate_notes": "Mine"}, 1)
        assert stale.status_code == 409
        assert stale.json()["current"]["gate_notes"] == "Theirs"
        assert stale.json()["current"]["version"] == 2
        missing = await admin.patch(
            f"{API}/phase-progress/{a1}", json={"gate_notes": "x"}
        )
        assert missing.status_code == 428

    @pytest.mark.parametrize(
        ("body", "needle"),
        [
            ({"actual_start": "2026-02-01", "actual_end": "2026-01-01"}, "before"),
            ({"actual_end": "2026-01-01"}, "without having started"),
            ({"gate_status": "passed"}, "gate_decided_at"),
            ({"gate_decided_at": "2026-01-01"}, "pending gate"),
        ],
    )
    async def test_progress_that_does_not_add_up_is_a_422(
        self, admin: httpx.AsyncClient, body: dict[str, Any], needle: str
    ) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        response = await _patch(admin, f"phase-progress/{a0}", body, 1)
        assert response.status_code == 422, response.text
        assert response.json()["error"] == "invalid_progress"
        assert needle in response.json()["message"]

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"gate_status": None},
            {"gate_notes": None},
            {"gate_status": "approved"},
            {"actual_start": "1969-12-31"},
            {"gate_notes": "x" * 4001},
            {"gate_notes": "a\x00b"},
        ],
    )
    async def test_a_body_the_schema_refuses_is_a_422(
        self, admin: httpx.AsyncClient, body: dict[str, Any]
    ) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        assert (await _patch(admin, f"phase-progress/{a0}", body, 1)).status_code == 422

    async def test_a_date_is_cleared_with_null(self, admin: httpx.AsyncClient) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        await _patch(admin, f"phase-progress/{a0}", {"actual_start": "2026-01-06"}, 1)
        cleared = await _patch(admin, f"phase-progress/{a0}", {"actual_start": None}, 2)
        assert cleared.status_code == 200
        assert cleared.json()["item"]["actual_start"] is None

    async def test_a_member_cannot_record_progress(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        listed = (await operator.get(f"{API}/phase-progress")).json()
        assert listed["can_edit"] is False and len(listed["items"]) == 3
        denied = await _patch(operator, f"phase-progress/{a0}", {"gate_notes": "x"}, 1)
        assert denied.status_code == 403

    async def test_another_project_cannot_read_or_write_it(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        assert await _progress(other_project) == []
        assert (
            await other_project.get(f"{API}/phase-progress/{a0}")
        ).status_code == 404
        patched = await _patch(
            other_project, f"phase-progress/{a0}", {"gate_notes": "x"}, 1
        )
        assert patched.status_code == 404
        listed = await _progress(other_project, estimate_id=estimate["id"])
        assert listed == []

    async def test_there_is_no_create_or_delete(self, admin: httpx.AsyncClient) -> None:
        estimate = await _estimate(admin)
        a0 = _phase_id(estimate, "A0")
        assert (await admin.post(f"{API}/phase-progress", json={})).status_code == 405
        deleted = await admin.delete(
            f"{API}/phase-progress/{a0}", headers={"If-Match": '"1"'}
        )
        assert deleted.status_code == 405


# ===========================================================================
# The forecast — pure arithmetic, then the route
# ===========================================================================


def _phase(
    code: str,
    start: str | None,
    end: str | None,
    *,
    order: int,
    actual_start: str | None = None,
    actual_end: str | None = None,
    gate: str = "pending",
) -> Phase:
    def d(value: str | None) -> date | None:
        return date.fromisoformat(value) if value else None

    return Phase(
        id=uuid4(),
        code=code,
        name=f"Phase {code}",
        sort_order=order,
        planned_start=d(start),
        planned_end=d(end),
        actual_start=d(actual_start),
        actual_end=d(actual_end),
        gate_status=gate,
        gate_criteria=f"Gate {code}",
    )


def _plan(**progress: dict[str, str]) -> list[Phase]:
    """Three phases: A0 Jan, A1 Feb, A2 March (2026), sequential."""
    shape = [
        ("A0", "2026-01-05", "2026-01-30"),
        ("A1", "2026-02-02", "2026-02-27"),
        ("A2", "2026-03-02", "2026-03-27"),
    ]
    return [
        _phase(code, start, end, order=i, **progress.get(code, {}))  # type: ignore[arg-type]
        for i, (code, start, end) in enumerate(shape)
    ]


def _forecast(phases: list[Phase], today: str) -> dict[str, Any]:
    return compute_forecast(
        phases, [], working_day_factor=Decimal("1"), today=date.fromisoformat(today)
    )


class TestForecastArithmetic:
    async def test_before_anything_starts_the_forecast_is_the_plan(self) -> None:
        figures = _forecast(_plan(), "2025-12-01")
        assert figures["position"] == "not_started"
        assert figures["current_phase"] is None
        assert figures["next_phase"]["code"] == "A0"
        assert figures["planned_finish"] == date(2026, 3, 27)
        assert figures["forecast_finish"] == date(2026, 3, 27)
        assert figures["slip_days"] == 0
        assert figures["next_gate"]["code"] == "A0"
        assert figures["next_gate"]["criteria"] == "Gate A0"

    async def test_a_phase_running_over_carries_its_delay_forward(self) -> None:
        # A0 started on time and is still open ten days past its planned end.
        figures = _forecast(_plan(A0={"actual_start": "2026-01-05"}), "2026-02-09")
        assert figures["position"] == "in_progress"
        assert figures["current_phase"]["code"] == "A0"
        a0, a1, a2 = figures["phases"]
        assert a0["state"] == "in_progress"
        assert a0["forecast_end"] == date(2026, 2, 9)  # at least today
        assert a0["finish_slip_days"] == 10
        assert a1["forecast_start"] == date(2026, 2, 12)
        assert a1["forecast_end"] == date(2026, 3, 9)
        assert a2["forecast_end"] == date(2026, 4, 6)
        assert figures["forecast_finish"] == date(2026, 4, 6)
        assert figures["slip_days"] == 10

    async def test_a_late_start_slips_by_its_lateness(self) -> None:
        # A0 done on time; A1 should have started 2026-02-02 and has not.
        figures = _forecast(
            _plan(A0={"actual_start": "2026-01-05", "actual_end": "2026-01-30"}),
            "2026-02-05",
        )
        assert figures["position"] == "between_phases"
        assert figures["next_phase"]["code"] == "A1"
        a1 = figures["phases"][1]
        assert a1["state"] == "not_started"
        assert a1["forecast_start"] == date(2026, 2, 5)
        assert a1["start_slip_days"] == 3
        assert figures["slip_days"] == 3

    async def test_an_early_finish_is_reported_not_banked(self) -> None:
        figures = _forecast(
            _plan(A0={"actual_start": "2026-01-05", "actual_end": "2026-01-20"}),
            "2026-01-21",
        )
        a0, a1, _ = figures["phases"]
        assert a0["finish_slip_days"] == -10
        assert a1["forecast_start"] == date(2026, 2, 2)  # not pulled in
        assert figures["slip_days"] == 0

    async def test_a_finished_project_reports_what_happened(self) -> None:
        done = {
            "A0": {"actual_start": "2026-01-05", "actual_end": "2026-01-30"},
            "A1": {"actual_start": "2026-02-02", "actual_end": "2026-02-27"},
            "A2": {"actual_start": "2026-03-02", "actual_end": "2026-03-20"},
        }
        figures = _forecast(_plan(**done), "2026-06-01")
        assert figures["position"] == "finished"
        assert figures["forecast_finish"] == date(2026, 3, 20)
        assert figures["slip_days"] == -7

    async def test_an_undated_phase_withholds_the_forecast_rather_than_skip_it(
        self,
    ) -> None:
        phases = _plan()
        phases.append(_phase("A3", None, None, order=3))
        figures = _forecast(phases, "2026-01-10")
        assert figures["forecast_finish"] is None
        assert figures["slip_days"] is None
        assert figures["unavailable"][0]["reason"] == "phase_dates_missing"
        assert "A3" in figures["unavailable"][0]["detail"]

    async def test_no_phases_is_said_not_zeroed(self) -> None:
        figures = _forecast([], "2026-01-10")
        assert figures["position"] == "no_phases"
        assert figures["forecast_finish"] is None
        assert figures["unavailable"][0]["reason"] == "no_phases"

    async def test_the_next_gate_is_the_first_pending_one_in_plan_order(self) -> None:
        phases = _plan()
        phases[0].gate_status = "passed"
        figures = _forecast(phases, "2026-01-10")
        assert figures["next_gate"]["code"] == "A1"


class TestForecastRoute:
    async def test_it_serves_the_figures_with_decimals_as_strings(
        self, admin: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        response = await admin.get(f"{API}/estimates/{estimate['id']}/forecast")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["estimate_id"] == estimate["id"]
        assert body["estimate_version"] == 1
        assert body["planned_start"] == "2026-01-05"
        assert isinstance(body["calendar_weeks"], str)
        assert [p["code"] for p in body["phases"]] == ["A0", "A1", "A2"]
        assert body["today"]

    async def test_another_projects_estimate_is_404(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        estimate = await _estimate(admin)
        response = await other_project.get(f"{API}/estimates/{estimate['id']}/forecast")
        assert response.status_code == 404
        assert (await admin.get(f"{API}/estimates/nope/forecast")).status_code == 404
