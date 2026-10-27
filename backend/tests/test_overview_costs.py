"""The Costs page — categories, recurring costs, cost entries and the summary.

Mirrors ``tests/test_overview_timeline.py``: full HTTP through
``ASGITransport`` against real Postgres, with only coord's answer to "who is
calling, in which project" stubbed (``get_overview_caller``).

Beyond the contract every resource shares (proven once per resource here:
role gating, tenant isolation, ``If-Match``), this proves the rules the
ledger adds:

* references (category, recurring cost) stay inside the project;
* a delivered item's received date, and the "still to arrive" filter;
* one entry per recurring period, only on a due date;
* history is not deleted or stranded (category in use, recorded periods);
* the summary — fixed periods are scheduled spend, variable ones awaiting an
  amount are counted and never added as zero, currencies are never mixed;
* the period arithmetic, as pure functions.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.overview_costs import add_months, due_dates, is_due_date, summarize

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000c5")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000c5")


# ===========================================================================
# Harness
# ===========================================================================


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"costs_{uuid4().hex[:8]}@example.com",
        username=f"costs_{uuid4().hex[:8]}",
        full_name="Costs Tester",
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


async def _post(client: httpx.AsyncClient, path: str, **body: Any) -> dict[str, Any]:
    response = await client.post(f"{API}/{path}", json=body)
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()["item"]
    return item


async def _category(
    client: httpx.AsyncClient, name: str = "Hardware"
) -> dict[str, Any]:
    return await _post(client, "cost-categories", name=name)


async def _entry(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "incurred_on": "2026-10-20",
        "description": "Ryzen 9 9950X",
        "amount_micros": 649_000_000,
        "currency": "EUR",
    }
    payload.update(body)
    return await _post(client, "cost-entries", **payload)


async def _recurring(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Claude Code Max",
        "vendor": "Anthropic",
        "amount_micros": 200_000_000,
        "currency": "USD",
        "start_date": "2026-01-15",
    }
    payload.update(body)
    return await _post(client, "recurring-costs", **payload)


async def _patch(
    client: httpx.AsyncClient, path: str, body: dict[str, Any], version: int
) -> httpx.Response:
    return await client.patch(
        f"{API}/{path}", json=body, headers={"If-Match": f'"{version}"'}
    )


async def _delete(client: httpx.AsyncClient, path: str, version: int) -> httpx.Response:
    return await client.delete(f"{API}/{path}", headers={"If-Match": f'"{version}"'})


def _can_edit(catalog: dict[str, Any], name: str) -> bool:
    return bool(next(r for r in catalog["resources"] if r["name"] == name)["can_edit"])


# ===========================================================================
# The contract, once per resource
# ===========================================================================


class TestContract:
    async def test_a_member_reads_but_cannot_write(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        category = await _category(admin)
        catalog = (await operator.get(f"{API}/resources")).json()
        for name in ("cost_categories", "recurring_costs", "cost_entries"):
            assert _can_edit(catalog, name) is False
        assert len((await operator.get(f"{API}/cost-categories")).json()["items"]) == 1
        for path, body in (
            ("cost-categories", {"name": "AI"}),
            (
                "cost-entries",
                {
                    "incurred_on": "2026-10-01",
                    "description": "x",
                    "amount_micros": 1,
                    "currency": "USD",
                },
            ),
            (
                "recurring-costs",
                {
                    "name": "x",
                    "amount_micros": 1,
                    "currency": "USD",
                    "start_date": "2026-10-01",
                },
            ),
        ):
            assert (await operator.post(f"{API}/{path}", json=body)).status_code == 403
        renamed = await _patch(
            operator, f"cost-categories/{category['id']}", {"name": "y"}, 1
        )
        assert renamed.status_code == 403

    async def test_another_project_sees_none_of_it(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        entry = await _entry(admin)
        cost = await _recurring(admin)
        category = await _category(admin)
        for path in ("cost-entries", "recurring-costs", "cost-categories"):
            assert (await other_project.get(f"{API}/{path}")).json()["items"] == []
        for path, item in (
            ("cost-entries", entry),
            ("recurring-costs", cost),
            ("cost-categories", category),
        ):
            assert (
                await other_project.get(f"{API}/{path}/{item['id']}")
            ).status_code == 404
            assert (
                await _delete(other_project, f"{path}/{item['id']}", 1)
            ).status_code == 404
        summary = (await other_project.get(f"{API}/costs/summary")).json()
        assert summary["currencies"] == [] and summary["periods"] == []

    async def test_a_stale_write_is_a_409_and_needs_if_match(
        self, admin: httpx.AsyncClient
    ) -> None:
        entry = await _entry(admin)
        assert (
            await admin.patch(f"{API}/cost-entries/{entry['id']}", json={"notes": "a"})
        ).status_code == 428
        first = await _patch(admin, f"cost-entries/{entry['id']}", {"notes": "a"}, 1)
        assert first.status_code == 200
        stale = await _patch(admin, f"cost-entries/{entry['id']}", {"notes": "b"}, 1)
        assert stale.status_code == 409
        assert stale.json()["current"]["notes"] == "a"


# ===========================================================================
# Categories
# ===========================================================================


class TestCategories:
    async def test_names_are_unique_ignoring_case(
        self, admin: httpx.AsyncClient
    ) -> None:
        made = await _category(admin, "Hardware")
        again = await admin.post(f"{API}/cost-categories", json={"name": " hardware "})
        assert again.status_code == 409
        assert again.json()["error"] == "name_taken"
        other = await _category(admin, "Legal & registration")
        renamed = await _patch(
            admin, f"cost-categories/{other['id']}", {"name": "HARDWARE"}, 1
        )
        assert renamed.status_code == 409
        same = await _patch(
            admin,
            f"cost-categories/{made['id']}",
            {"name": "Hardware", "sort_order": 2},
            1,
        )
        assert same.status_code == 200, same.text

    async def test_a_category_in_use_cannot_be_deleted(
        self, admin: httpx.AsyncClient
    ) -> None:
        category = await _category(admin)
        entry = await _entry(admin, category_id=category["id"])
        refused = await _delete(admin, f"cost-categories/{category['id']}", 1)
        assert refused.status_code == 409
        assert refused.json()["error"] == "category_in_use"
        moved = await _patch(
            admin, f"cost-entries/{entry['id']}", {"category_id": None}, 1
        )
        assert moved.status_code == 200
        assert (
            await _delete(admin, f"cost-categories/{category['id']}", 1)
        ).status_code == 204

    async def test_another_projects_category_is_refused(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        foreign = await _category(other_project)
        response = await admin.post(
            f"{API}/cost-entries",
            json={
                "incurred_on": "2026-10-01",
                "description": "x",
                "amount_micros": 1,
                "currency": "USD",
                "category_id": foreign["id"],
            },
        )
        assert response.status_code == 422
        assert response.json()["error"] == "category_not_found"


# ===========================================================================
# Cost entries
# ===========================================================================


class TestEntries:
    async def test_newest_first_with_currency_normalised(
        self, admin: httpx.AsyncClient
    ) -> None:
        older = await _entry(admin, incurred_on="2026-09-01", currency="usd")
        newer = await _entry(admin, incurred_on="2026-10-01")
        assert older["currency"] == "USD"
        items = (await admin.get(f"{API}/cost-entries")).json()["items"]
        assert [i["id"] for i in items] == [newer["id"], older["id"]]

    async def test_a_delivered_item_tracks_its_arrival(
        self, admin: httpx.AsyncClient
    ) -> None:
        board = await _entry(admin, description="Motherboard", expects_delivery=True)
        await _entry(
            admin,
            description="Already here",
            expects_delivery=True,
            received_on="2026-10-22",
        )
        await _entry(admin, description="A service")
        waiting = (
            await admin.get(f"{API}/cost-entries", params={"awaiting_delivery": "true"})
        ).json()["items"]
        assert [i["description"] for i in waiting] == ["Motherboard"]
        received = await _patch(
            admin, f"cost-entries/{board['id']}", {"received_on": "2026-10-25"}, 1
        )
        assert received.status_code == 200, received.text
        assert (
            await admin.get(f"{API}/cost-entries", params={"awaiting_delivery": "true"})
        ).json()["items"] == []

    async def test_only_a_delivered_item_has_a_received_date(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.post(
            f"{API}/cost-entries",
            json={
                "incurred_on": "2026-10-01",
                "description": "x",
                "amount_micros": 1,
                "currency": "USD",
                "received_on": "2026-10-02",
            },
        )
        assert response.status_code == 422
        entry = await _entry(admin)
        patched = await _patch(
            admin, f"cost-entries/{entry['id']}", {"received_on": "2026-10-02"}, 1
        )
        assert patched.status_code == 422
        assert patched.json()["error"] == "invalid_cost_entry"

    async def test_a_refund_is_a_negative_amount(
        self, admin: httpx.AsyncClient
    ) -> None:
        refund = await _entry(
            admin, description="Returned PSU", amount_micros=-89_000_000
        )
        assert refund["amount_micros"] == -89_000_000

    async def test_filter_by_category(self, admin: httpx.AsyncClient) -> None:
        hardware = await _category(admin)
        tagged = await _entry(admin, category_id=hardware["id"])
        bare = await _entry(admin)
        by_cat = (
            await admin.get(
                f"{API}/cost-entries", params={"category_id": hardware["id"]}
            )
        ).json()["items"]
        assert [i["id"] for i in by_cat] == [tagged["id"]]
        none = (
            await admin.get(f"{API}/cost-entries", params={"category_id": "none"})
        ).json()["items"]
        assert [i["id"] for i in none] == [bare["id"]]


# ===========================================================================
# Recurring costs and their periods
# ===========================================================================


class TestRecurring:
    async def test_a_fixed_cost_needs_its_amount(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await admin.post(
            f"{API}/recurring-costs",
            json={"name": "x", "currency": "USD", "start_date": "2026-01-01"},
        )
        assert response.status_code == 422
        variable = await _recurring(
            admin, name="AWS", amount_kind="variable", amount_micros=None
        )
        cleared = await _patch(
            admin, f"recurring-costs/{variable['id']}", {"amount_kind": "fixed"}, 1
        )
        assert cleared.status_code == 422
        assert cleared.json()["error"] == "invalid_recurring_cost"

    async def test_one_entry_per_period_on_a_due_date(
        self, admin: httpx.AsyncClient
    ) -> None:
        aws = await _recurring(
            admin,
            name="AWS",
            amount_kind="variable",
            amount_micros=None,
            start_date="2026-01-31",
        )
        body = {
            "recurring_cost_id": aws["id"],
            "description": "AWS February",
            "currency": "USD",
            "amount_micros": 412_500_000,
        }
        wrong_day = await admin.post(
            f"{API}/cost-entries",
            json={**body, "incurred_on": "2026-02-27", "period_start": "2026-02-27"},
        )
        assert wrong_day.status_code == 422
        assert wrong_day.json()["error"] == "not_a_due_date"
        made = await _entry(
            admin, **body, incurred_on="2026-02-28", period_start="2026-02-28"
        )
        assert made["recurring_cost_id"] == aws["id"]
        again = await admin.post(
            f"{API}/cost-entries",
            json={**body, "incurred_on": "2026-02-28", "period_start": "2026-02-28"},
        )
        assert again.status_code == 409
        assert again.json()["error"] == "period_already_recorded"
        half = await admin.post(
            f"{API}/cost-entries",
            json={**body, "incurred_on": "2026-03-31"},
        )
        assert half.status_code == 422

    async def test_recorded_periods_are_never_deleted_or_stranded(
        self, admin: httpx.AsyncClient
    ) -> None:
        cost = await _recurring(admin)
        await _entry(
            admin,
            recurring_cost_id=cost["id"],
            period_start="2026-02-15",
            incurred_on="2026-02-15",
            description="Feb",
            currency="USD",
        )
        refused = await _delete(admin, f"recurring-costs/{cost['id']}", 1)
        assert refused.status_code == 409
        assert refused.json()["error"] == "periods_recorded"
        moved = await _patch(
            admin, f"recurring-costs/{cost['id']}", {"start_date": "2026-01-01"}, 1
        )
        assert moved.status_code == 409
        ended = await _patch(
            admin, f"recurring-costs/{cost['id']}", {"end_date": "2026-06-30"}, 1
        )
        assert ended.status_code == 200, ended.text
        too_early = await _patch(
            admin, f"recurring-costs/{cost['id']}", {"end_date": "2026-02-01"}, 2
        )
        assert too_early.status_code == 409

    async def test_an_unused_recurring_cost_can_be_deleted(
        self, admin: httpx.AsyncClient
    ) -> None:
        cost = await _recurring(admin)
        assert (
            await _delete(admin, f"recurring-costs/{cost['id']}", 1)
        ).status_code == 204


# ===========================================================================
# The summary
# ===========================================================================


class TestSummaryRoute:
    async def test_figures_per_currency(self, admin: httpx.AsyncClient) -> None:
        hardware = await _category(admin)
        await _entry(
            admin,
            category_id=hardware["id"],
            expects_delivery=True,
            incurred_on="2026-01-10",
        )
        aws = await _recurring(
            admin,
            name="AWS",
            amount_kind="variable",
            amount_micros=None,
            start_date="2026-01-01",
            end_date="2026-02-28",
        )
        await _entry(
            admin,
            recurring_cost_id=aws["id"],
            period_start="2026-01-01",
            incurred_on="2026-01-03",
            description="AWS Jan",
            amount_micros=300_000_000,
            currency="USD",
        )
        await _recurring(admin, start_date="2026-01-15", end_date="2026-02-15")
        summary = (await admin.get(f"{API}/costs/summary")).json()
        by = {c["currency"]: c for c in summary["currencies"]}
        assert by["EUR"]["spent_to_date_micros"] == 649_000_000
        assert by["EUR"]["awaiting_delivery_micros"] == 649_000_000
        # AWS January recorded, two Claude Code months scheduled; AWS
        # February is unknown, so counted — not added as zero.
        assert by["USD"]["spent_to_date_micros"] == 300_000_000 + 2 * 200_000_000
        assert by["USD"]["scheduled_micros"] == 400_000_000
        assert summary["awaiting_amount_count"] == 1
        assert summary["awaiting_delivery_count"] == 1
        states = sorted((p["period_start"], p["state"]) for p in summary["periods"])
        assert states == [
            ("2026-01-01", "recorded"),
            ("2026-01-15", "scheduled"),
            ("2026-02-01", "awaiting_amount"),
            ("2026-02-15", "scheduled"),
        ]


# ===========================================================================
# The arithmetic (pure)
# ===========================================================================


class _Cost:
    def __init__(self, **kw: Any) -> None:
        self.id = kw.pop("id", uuid4())
        self.category_id = kw.pop("category_id", None)
        self.end_date = kw.pop("end_date", None)
        self.__dict__.update(kw)


class _Entry:
    def __init__(self, **kw: Any) -> None:
        self.id = uuid4()
        self.category_id = kw.pop("category_id", None)
        self.expects_delivery = kw.pop("expects_delivery", False)
        self.received_on = kw.pop("received_on", None)
        self.recurring_cost_id = kw.pop("recurring_cost_id", None)
        self.period_start = kw.pop("period_start", None)
        self.__dict__.update(kw)


class TestArithmetic:
    def test_months_clamp_to_the_end_and_do_not_drift(self) -> None:
        start = date(2026, 1, 31)
        assert [add_months(start, n) for n in range(4)] == [
            date(2026, 1, 31),
            date(2026, 2, 28),
            date(2026, 3, 31),
            date(2026, 4, 30),
        ]
        assert add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)

    def test_due_dates_stop_at_the_end_or_today(self) -> None:
        dates = list(
            due_dates(date(2026, 1, 15), None, "quarterly", date(2026, 10, 14))
        )
        assert dates == [date(2026, 1, 15), date(2026, 4, 15), date(2026, 7, 15)]
        ended = list(
            due_dates(date(2026, 1, 1), date(2026, 2, 1), "monthly", date(2026, 12, 1))
        )
        assert ended == [date(2026, 1, 1), date(2026, 2, 1)]
        assert list(due_dates(date(2027, 1, 1), None, "annual", date(2026, 1, 1))) == []

    def test_is_due_date(self) -> None:
        start = date(2026, 1, 31)
        assert is_due_date(start, None, "monthly", date(2026, 2, 28))
        assert not is_due_date(start, None, "monthly", date(2026, 2, 27))
        assert not is_due_date(start, None, "quarterly", date(2026, 2, 28))
        assert is_due_date(start, None, "annual", date(2027, 1, 31))
        assert not is_due_date(start, date(2026, 6, 1), "monthly", date(2026, 6, 30))
        assert not is_due_date(start, None, "monthly", date(2025, 12, 31))

    def test_this_month_and_month_table(self) -> None:
        cat = uuid4()
        sub = _Cost(
            cadence="monthly",
            amount_kind="fixed",
            amount_micros=20,
            currency="USD",
            start_date=date(2026, 9, 1),
            category_id=cat,
        )
        entries = [
            _Entry(
                incurred_on=date(2026, 10, 3),
                amount_micros=5,
                currency="USD",
                category_id=cat,
            ),
            _Entry(incurred_on=date(2026, 9, 3), amount_micros=7, currency="USD"),
        ]
        out = summarize(entries, [sub], today=date(2026, 10, 27), base_currency="USD")
        usd = out["currencies"][0]  # type: ignore[index]
        assert usd == {
            "currency": "USD",
            "spent_to_date_micros": 5 + 7 + 2 * 20,
            "scheduled_micros": 40,
            "this_month_micros": 5 + 20,
            "awaiting_delivery_micros": 0,
        }
        cells = {
            (m["month"], m["category_id"]): (
                m["recorded_micros"],
                m["scheduled_micros"],
            )
            for m in out["months"]  # type: ignore[attr-defined]
        }
        assert cells == {
            (date(2026, 10, 1), cat): (5, 20),
            (date(2026, 9, 1), cat): (0, 20),
            (date(2026, 9, 1), None): (7, 0),
        }

    def test_the_base_currency_is_listed_first(self) -> None:
        entries = [
            _Entry(incurred_on=date(2026, 1, 1), amount_micros=1, currency=c)
            for c in ("AUD", "USD", "EUR")
        ]
        out = summarize(entries, [], today=date(2026, 1, 2), base_currency="EUR")
        assert [c["currency"] for c in out["currencies"]] == ["EUR", "AUD", "USD"]  # type: ignore[attr-defined]
