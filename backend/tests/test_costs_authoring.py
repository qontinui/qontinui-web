"""Costs authoring (authoring-layer Phase 5): the ``costs/entries`` and
``costs/effort-entries`` resources, against real Postgres.

Plan ``2026-09-20-overview-authoring-layer`` Phase 5; design
``phase5-design.md`` §2 / §5. What this file pins:

* **The authoring contract, generated from the registry** for both resources:
  ``ETag``/``If-Match`` (428 without, 409 with the server's copy when stale),
  an idempotent keyed create, the change log on every write, tenant isolation,
  and the served ``can_edit`` agreeing with what the gate enforces.
* **Provider rows are annotations only** — ``phase_id`` / ``fx_rate_to_base``
  may change, anything else is ``422 provider_reported_field``, a delete is
  ``409 provider_reported``; a re-import keeps the annotations and moves the
  version only when the provider's figures changed.
* **member_self** — any member logs and edits their own time, never
  someone else's (``403 not_your_entry``); an editor writes anybody's; every
  entry serves ``editable`` from the same rule.
* **The rate snapshot** under ``day_rates`` — taken when logged, kept across a
  later rate edit, refused (``422 role_not_priced``) for a role the baseline
  does not price, re-taken when the role changes; the 24-hour day.
* **FX settings are typed** on write.

Coord's identity read (:func:`get_overview_caller`) and the Cognito session
check are the only things stubbed.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"
M = 1_000_000

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-00000000c0a1")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-00000000c0b2")
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)


# ===========================================================================
# Harness
# ===========================================================================


async def _user(db: AsyncSession, label: str) -> Any:
    from app.models.user import User

    user = User(
        email=f"{label}_{uuid4().hex[:8]}@example.com",
        username=f"{label}_{uuid4().hex[:8]}",
        full_name=label.title(),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _app(db: AsyncSession, user: Any, tenant: UUID, roles: tuple[str, ...]) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
    from app.api.v1.endpoints.overview import router as settings_router
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
    app.include_router(settings_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest_asyncio.fixture()
async def users(async_db_session):
    return {
        "admin": await _user(async_db_session, "admin"),
        "ann": await _user(async_db_session, "ann"),
        "bob": await _user(async_db_session, "bob"),
    }


@pytest_asyncio.fixture()
async def admin(async_db_session, users):
    app = _app(async_db_session, users["admin"], TENANT_A, ("admin",))
    async with _client(app) as c:
        yield c


@pytest_asyncio.fixture()
async def ann(async_db_session, users):
    """A member (operator) — not an overview editor by default."""
    app = _app(async_db_session, users["ann"], TENANT_A, ("operator",))
    async with _client(app) as c:
        yield c


@pytest_asyncio.fixture()
async def bob(async_db_session, users):
    app = _app(async_db_session, users["bob"], TENANT_A, ("operator",))
    async with _client(app) as c:
        yield c


@pytest_asyncio.fixture()
async def admin_b(async_db_session, users):
    app = _app(async_db_session, users["admin"], TENANT_B, ("admin",))
    async with _client(app) as c:
        yield c


async def _vendor(client: httpx.AsyncClient, name: str = "Contractor") -> str:
    resp = await client.post(
        f"{API}/spend/vendors", json={"name": name, "category": "saas"}
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["item"]["id"])


async def _settings(client: httpx.AsyncClient, **values: Any) -> dict[str, Any]:
    resp = await client.put(f"{API}/settings", json=values)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


def _content(rate_micros: int) -> dict[str, Any]:
    return {
        "roles": [
            {
                "code": "BE",
                "name": "Backend",
                "day_rate_micros": rate_micros,
                "currency": "EUR",
            },
            {"code": "PO", "name": "Product owner", "client_side": True},
        ],
        "phases": [
            {
                "code": "A0",
                "name": "Discovery",
                "planned_start": "2026-09-01",
                "planned_end": "2026-09-30",
            }
        ],
    }


async def _baseline(client: httpx.AsyncClient, rate_micros: int = 800 * M) -> str:
    resp = await client.post(
        f"{API}/estimates",
        json={
            "name": "v1",
            "purpose": "comparison",
            "is_baseline": True,
            "content": _content(rate_micros),
        },
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["item"]["id"])


def _etag(resp: httpx.Response) -> str:
    return resp.headers["ETag"]


# ===========================================================================
# The contract, from the registry
# ===========================================================================


async def _sample(resource: str, admin: httpx.AsyncClient) -> dict[str, Any]:
    if resource == "cost_entries":
        return {
            "vendor_id": await _vendor(admin),
            "description": "September invoice",
            "amount_micros": 1200 * M,
            "currency": "USD",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
        }
    return {"work_date": "2026-09-14", "hours": "6.5", "note": "discovery"}


_EDIT = {
    "cost_entries": {"description": "September invoice (corrected)"},
    "effort_entries": {"hours": "7.25"},
}


@pytest.mark.parametrize("resource", ["cost_entries", "effort_entries"])
class TestContract:
    async def test_the_registry_routes_it_with_its_permission_rule(
        self, resource: str, admin: httpx.AsyncClient, ann: httpx.AsyncClient
    ) -> None:
        from app.overview.registry import REGISTRY

        spec = REGISTRY[resource]
        assert spec.store is not None
        assert spec.operations == {"list", "get", "create", "update", "delete"}
        catalog = (await ann.get(f"{API}/resources")).json()
        served = {r["name"]: r for r in catalog["resources"]}[resource]
        # An operator may log their own time; only an admin writes costs.
        assert served["can_edit"] is (resource == "effort_entries")
        assert set(served["schemas"]) == {"read", "create", "update"}

    async def test_create_read_update_delete_under_the_contract(
        self,
        resource: str,
        admin: httpx.AsyncClient,
        admin_b: httpx.AsyncClient,
        async_db_session: AsyncSession,
    ) -> None:
        from app.models.overview import ChangeLog
        from app.overview.registry import REGISTRY

        base = f"{API}/{REGISTRY[resource].path}"
        body = await _sample(resource, admin)
        key = {"Idempotency-Key": f"k-{uuid4().hex}"}
        created = await admin.post(base, json=body, headers=key)
        assert created.status_code == 201, created.text
        item = created.json()["item"]
        assert _etag(created) == '"1"' and item["version"] == 1
        replay = await admin.post(base, json=body, headers=key)
        assert replay.status_code == 200
        assert replay.headers["Idempotent-Replayed"] == "true"
        assert replay.json()["item"]["id"] == item["id"]

        url = f"{base}/{item['id']}"
        got = await admin.get(url)
        assert got.status_code == 200 and _etag(got) == '"1"'
        listed = (await admin.get(base)).json()
        assert [i["id"] for i in listed["items"]] == [item["id"]]
        assert listed["can_edit"] is True

        assert (await admin.patch(url, json=_EDIT[resource])).status_code == 428
        moved = await admin.patch(
            url, json=_EDIT[resource], headers={"If-Match": '"1"'}
        )
        assert moved.status_code == 200, moved.text
        assert moved.json()["item"]["version"] == 2
        stale = await admin.patch(
            url, json=_EDIT[resource], headers={"If-Match": '"1"'}
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["version"] == 2

        # Another project cannot see it.
        assert (await admin_b.get(url)).status_code == 404
        assert (await admin_b.get(base)).json()["items"] == []

        assert (await admin.delete(url, headers={"If-Match": '"1"'})).status_code == 409
        assert (await admin.delete(url, headers={"If-Match": '"2"'})).status_code == 204
        assert (await admin.get(url)).status_code == 404

        actions = [
            r.action
            for r in (
                await async_db_session.execute(
                    select(ChangeLog)
                    .where(
                        ChangeLog.tenant_id == TENANT_A,
                        ChangeLog.resource == resource,
                        ChangeLog.record_id == item["id"],
                    )
                    .order_by(ChangeLog.created_at)
                )
            ).scalars()
        ]
        assert actions == ["create", "update", "delete"]


# ===========================================================================
# Cost entries
# ===========================================================================


async def _provider_row(db: AsyncSession, vendor_id: str) -> Any:
    from app.models.overview import CostEntry

    row = CostEntry(
        tenant_id=TENANT_A,
        vendor_id=UUID(vendor_id),
        source="connector",
        source_ref="aws:1:2026-09-02:EC2",
        description="EC2",
        amount_micros=40 * M,
        currency="USD",
        period_start=date(2026, 9, 2),
        period_end=date(2026, 9, 2),
        product="ec2",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


class TestCostEntries:
    async def test_a_provider_row_takes_only_its_annotations(
        self, async_db_session, admin
    ) -> None:
        vendor = await _vendor(admin, "AWS")
        estimate = await _baseline(admin)
        phase = (await admin.get(f"{API}/estimates/{estimate}")).json()["item"][
            "content"
        ]["phases"][0]["id"]
        row = await _provider_row(async_db_session, vendor)
        url = f"{API}/costs/entries/{row.id}"
        read = (await admin.get(url)).json()["item"]
        assert read["provider_reported"] is True and read["version"] == 1

        refused = await admin.patch(
            url,
            json={"amount_micros": 1, "phase_id": phase},
            headers={"If-Match": '"1"'},
        )
        assert refused.status_code == 422
        assert refused.json()["error"] == "provider_reported_field"
        assert "amount_micros" in refused.json()["message"]

        # Echoing an unchanged provider field is not a change.
        ok = await admin.patch(
            url,
            json={"phase_id": phase, "fx_rate_to_base": "0.9", "amount_micros": 40 * M},
            headers={"If-Match": '"1"'},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["item"]["phase_id"] == phase
        assert ok.json()["item"]["fx_rate_to_base"] == "0.90000000"

        gone = await admin.delete(url, headers={"If-Match": '"2"'})
        assert gone.status_code == 409
        assert gone.json()["error"] == "provider_reported"

    async def test_a_reimport_keeps_annotations_and_versions_only_real_changes(
        self, async_db_session, admin
    ) -> None:
        from app.models.overview import CostEntry
        from app.spend.ingest import _upsert_chunk

        vendor = await _vendor(admin, "AWS")
        row = await _provider_row(async_db_session, vendor)
        url = f"{API}/costs/entries/{row.id}"
        patched = await admin.patch(
            url, json={"fx_rate_to_base": "0.9"}, headers={"If-Match": '"1"'}
        )
        assert patched.json()["item"]["version"] == 2

        def payload(amount: int) -> dict[str, Any]:
            return {
                "tenant_id": TENANT_A,
                "vendor_id": UUID(vendor),
                "source": "connector",
                "source_ref": row.source_ref,
                "category": None,
                "description": "EC2",
                "amount_micros": amount,
                "currency": "USD",
                "period_start": date(2026, 9, 2),
                "period_end": date(2026, 9, 2),
                "gross_micros": None,
                "discount_micros": None,
                "quantity": None,
                "unit": None,
                "scope_label": None,
                "sku": None,
                "product": "ec2",
                "import_run_id": None,
                "created_by": "importer",
                "updated_by": "importer",
            }

        async def stored() -> CostEntry:
            found: CostEntry = (
                await async_db_session.execute(
                    select(CostEntry)
                    .where(CostEntry.id == row.id)
                    .execution_options(populate_existing=True)
                )
            ).scalar_one()
            return found

        await _upsert_chunk(async_db_session, [payload(40 * M)])
        same = await stored()
        assert same.version == 2  # the same statement again moves nothing
        await _upsert_chunk(async_db_session, [payload(41 * M)])
        moved = await stored()
        assert moved.version == 3
        assert moved.amount_micros == 41 * M
        assert moved.fx_rate_to_base == Decimal("0.9")

    async def test_manual_rules_period_vendor_and_duplicate_reference(
        self, admin, admin_b
    ) -> None:
        vendor = await _vendor(admin)
        base = f"{API}/costs/entries"
        body = {
            "vendor_id": vendor,
            "description": "Invoice 7",
            "amount_micros": -50 * M,  # a credit note
            "currency": "EUR",
            "period_start": "2026-09-10",
            "source_ref": "INV-7",
        }
        created = await admin.post(base, json=body)
        assert created.status_code == 201, created.text
        item = created.json()["item"]
        assert item["period_end"] == "2026-09-10" and item["source"] == "manual"
        assert (await admin.post(base, json=body)).json()["error"] == "name_taken"
        bad = await admin.post(
            base, json={**body, "source_ref": "INV-8", "period_end": "2026-09-01"}
        )
        assert bad.status_code == 422 and bad.json()["error"] == "bad_period"
        # Another project's vendor is not news: 422, not "exists elsewhere".
        other = await _vendor(admin_b, "Theirs")
        foreign = await admin.post(base, json={**body, "vendor_id": other})
        assert foreign.json()["error"] == "unknown_vendor"
        cleared = await admin.patch(
            f"{base}/{item['id']}",
            json={"description": None},
            headers={"If-Match": '"1"'},
        )
        assert cleared.status_code == 422

    async def test_only_an_admin_writes_costs(self, admin, ann) -> None:
        vendor = await _vendor(admin)
        denied = await ann.post(
            f"{API}/costs/entries",
            json={
                "vendor_id": vendor,
                "description": "x",
                "amount_micros": 1,
                "currency": "USD",
                "period_start": "2026-09-01",
            },
        )
        assert denied.status_code == 403
        assert (await ann.get(f"{API}/costs/entries")).status_code == 200

    async def test_a_long_list_says_it_is_truncated(
        self, async_db_session, admin
    ) -> None:
        from app.models.overview import CostEntry

        vendor = await _vendor(admin)
        for day in range(1, 6):
            async_db_session.add(
                CostEntry(
                    tenant_id=TENANT_A,
                    vendor_id=UUID(vendor),
                    source="manual",
                    description=f"d{day}",
                    amount_micros=M,
                    currency="USD",
                    period_start=date(2026, 9, day),
                    period_end=date(2026, 9, day),
                )
            )
        await async_db_session.commit()
        page = (await admin.get(f"{API}/costs/entries", params={"limit": 3})).json()
        assert [i["description"] for i in page["items"]] == ["d5", "d4", "d3"]
        assert page["degraded"].startswith("truncated")
        narrowed = (
            await admin.get(
                f"{API}/costs/entries", params={"from": "2026-09-04", "limit": 3}
            )
        ).json()
        assert len(narrowed["items"]) == 2 and narrowed["degraded"] is None


# ===========================================================================
# Effort entries: member_self
# ===========================================================================


class TestMemberSelf:
    async def test_a_member_logs_and_edits_their_own_time_only(
        self, ann, bob, users
    ) -> None:
        base = f"{API}/costs/effort-entries"
        mine = await ann.post(base, json={"work_date": "2026-09-14", "hours": "4"})
        assert mine.status_code == 201, mine.text
        entry = mine.json()["item"]
        assert entry["person_user_id"] == str(users["ann"].id)
        assert entry["person"] == users["ann"].email
        assert entry["editable"] is True

        # Bob reads it, is told he cannot edit it, and is refused if he tries.
        seen = (await bob.get(f"{base}/{entry['id']}")).json()
        assert seen["can_edit"] is True  # he may log his OWN time
        assert seen["item"]["editable"] is False
        url = f"{base}/{entry['id']}"
        refused = await bob.patch(url, json={"hours": "9"}, headers={"If-Match": '"1"'})
        assert refused.status_code == 403
        assert refused.json()["error"] == "not_your_entry"
        assert (await bob.delete(url, headers={"If-Match": '"1"'})).json()[
            "error"
        ] == "not_your_entry"
        # …nor can he log time as her, nor hand his own entry to her.
        as_ann = await bob.post(
            base,
            json={
                "work_date": "2026-09-14",
                "hours": "1",
                "person_user_id": str(users["ann"].id),
            },
        )
        assert as_ann.status_code == 403
        own = (
            await bob.post(base, json={"work_date": "2026-09-14", "hours": "1"})
        ).json()
        handed = await bob.patch(
            f"{base}/{own['item']['id']}",
            json={"person_user_id": str(users["ann"].id)},
            headers={"If-Match": '"1"'},
        )
        assert handed.status_code == 403

        edited = await ann.patch(url, json={"hours": "5"}, headers={"If-Match": '"1"'})
        assert edited.status_code == 200, edited.text
        mine_only = (await ann.get(base, params={"mine": "true"})).json()["items"]
        assert [i["id"] for i in mine_only] == [entry["id"]]

    async def test_an_editor_writes_anybodys_time(self, admin, ann, bob, users) -> None:
        base = f"{API}/costs/effort-entries"
        entry = (
            await ann.post(base, json={"work_date": "2026-09-14", "hours": "4"})
        ).json()["item"]
        url = f"{base}/{entry['id']}"
        by_admin = await admin.patch(
            url, json={"hours": "3"}, headers={"If-Match": '"1"'}
        )
        assert by_admin.status_code == 200
        for_someone = await admin.post(
            base, json={"work_date": "2026-09-15", "hours": "2", "person": "Carol"}
        )
        assert for_someone.status_code == 201, for_someone.text
        assert for_someone.json()["item"]["person_user_id"] is None
        # Widening editing_roles makes Bob an editor of everybody's time.
        await _settings(admin, editing_roles=["admin", "operator"])
        assert (await bob.get(url)).json()["item"]["editable"] is True
        took = await bob.patch(url, json={"hours": "2"}, headers={"If-Match": '"2"'})
        assert took.status_code == 200, took.text

    async def test_a_person_s_day_holds_24_hours(self, ann) -> None:
        base = f"{API}/costs/effort-entries"
        assert (
            await ann.post(base, json={"work_date": "2026-09-14", "hours": "20"})
        ).status_code == 201
        over = await ann.post(base, json={"work_date": "2026-09-14", "hours": "4.5"})
        assert over.status_code == 422 and over.json()["error"] == "day_over_24h"
        assert (
            await ann.post(base, json={"work_date": "2026-09-14", "hours": "4"})
        ).status_code == 201
        assert (
            await ann.post(base, json={"work_date": "2026-09-15", "hours": "25"})
        ).status_code == 422


# ===========================================================================
# Effort entries: the rate snapshot
# ===========================================================================


class TestRateSnapshot:
    async def test_day_rates_snapshot_survives_a_rate_edit(self, admin, ann) -> None:
        estimate = await _baseline(admin, rate_micros=800 * M)
        await _settings(admin, labour_billing="day_rates", hours_per_day="8")
        base = f"{API}/costs/effort-entries"

        unpriced = await ann.post(base, json={"work_date": "2026-09-14", "hours": "4"})
        assert unpriced.json()["error"] == "role_required"
        client_side = await ann.post(
            base, json={"work_date": "2026-09-14", "hours": "4", "role_code": "PO"}
        )
        assert client_side.status_code == 422
        assert client_side.json()["error"] == "role_not_priced"
        unknown = await ann.post(
            base, json={"work_date": "2026-09-14", "hours": "4", "role_code": "XX"}
        )
        assert unknown.json()["error"] == "role_not_priced"

        logged = await ann.post(
            base, json={"work_date": "2026-09-14", "hours": "4", "role_code": "BE"}
        )
        assert logged.status_code == 201, logged.text
        item = logged.json()["item"]
        assert item["rate_micros_used"] == 800 * M
        assert item["rate_currency"] == "EUR"
        assert item["hours_per_day_used"] == "8.00"
        assert item["cost_micros"] == 400 * M

        # The rate changes; history does not.
        current = (await admin.get(f"{API}/estimates/{estimate}")).json()["item"]
        saved = await admin.patch(
            f"{API}/estimates/{estimate}",
            json={"content": _content(1000 * M)},
            headers={"If-Match": f'"{current["version"]}"'},
        )
        assert saved.status_code == 200, saved.text
        url = f"{base}/{item['id']}"
        after = (await ann.get(url)).json()["item"]
        assert after["rate_micros_used"] == 800 * M and after["cost_micros"] == 400 * M
        # Editing the note keeps the price…
        noted = await ann.patch(url, json={"note": "x"}, headers={"If-Match": '"1"'})
        assert noted.json()["item"]["rate_micros_used"] == 800 * M
        # …changing the role re-prices it at today's rate.
        await ann.patch(url, json={"role_code": "PO"}, headers={"If-Match": '"2"'})
        repriced = await ann.patch(
            url, json={"role_code": "BE"}, headers={"If-Match": '"2"'}
        )
        assert repriced.status_code == 200, repriced.text
        assert repriced.json()["item"]["rate_micros_used"] == 1000 * M

    async def test_unbilled_carries_no_price_and_a_later_switch_prices_on_edit(
        self, admin, ann
    ) -> None:
        await _baseline(admin)
        base = f"{API}/costs/effort-entries"
        item = (
            await ann.post(
                base, json={"work_date": "2026-09-14", "hours": "8", "role_code": "BE"}
            )
        ).json()["item"]
        assert item["rate_micros_used"] is None and item["cost_micros"] is None
        await _settings(admin, labour_billing="day_rates")
        priced = await ann.patch(
            f"{base}/{item['id']}", json={"note": "priced"}, headers={"If-Match": '"1"'}
        )
        assert priced.json()["item"]["cost_micros"] == 800 * M


# ===========================================================================
# FX settings are typed on write
# ===========================================================================


class TestFxSettings:
    async def test_rates_are_validated_and_stored_as_decimal_strings(
        self, admin
    ) -> None:
        saved = await _settings(
            admin,
            base_currency="EUR",
            fx_rates={"usd": {"rate": 0.92, "as_of": "2026-01-01", "note": "plan"}},
        )
        assert saved["fx_rates"] == {
            "USD": {"rate": "0.92", "as_of": "2026-01-01", "note": "plan"}
        }
        for bad in (
            {"US": {"rate": "1"}},
            {"USD": {"rate": "0"}},
            {"USD": {"rate": "abc"}},
            {"EUR": {"rate": "1"}},
            {"USD": {"rate": "1", "extra": 1}},
        ):
            resp = await admin.put(
                f"{API}/settings", json={"base_currency": "EUR", "fx_rates": bad}
            )
            assert resp.status_code == 422, bad

    async def test_a_legacy_unreadable_rate_is_reported_not_guessed(self) -> None:
        from app.costs.fx import FxBook

        book = FxBook.for_settings(
            "EUR", {"USD": 0.9, "GBP": {"rate": "nope"}, "xx": {"rate": "1"}}
        )
        assert book.to_base(10 * M, "USD") == 9 * M
        assert book.to_base(10 * M, "GBP") is None
        [missing] = book.missing()
        assert missing.currency == "GBP" and missing.reason == "unreadable_rate"
        assert "xx" in book.unreadable
