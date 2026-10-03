"""Costs review round 1 — one pin per finding, each shown to fail on the
commit before the fix (``f4f1fad5a``).

1. A vendor's USD rules read its connector rows only: a foreign-currency
   MANUAL entry no longer switches them off.
2. An ingest never writes over an entry entered by hand that shares its
   reference, says so on the run, and a hand-entered reference may not be
   shaped like a provider's.
3. A rate for an entry is a rate for its currency: a currency change (by hand
   or by the provider) clears it.
4. The legacy bare-number ``fx_rates`` shape round-trips through a settings
   save.
5. The logged-time list is bounded; the ledger converts only the rows it
   serves.
6. A role change outside day rates re-prices instead of wiping; a note edit of
   a role-less entry under day rates is not refused.
7. Time logged for someone else names a member; one's own time is named by
   one's name.
8. A per-reader field (``editable``) never reaches the change log, on delete
   either.
9. The limit's conversion is stated on the limit, not counted in ``fx.applied``.
10. Only the reference constraint is a "name taken"; a vanished phase is
    ``unknown_phase``.
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_costs_authoring import (
    API,
    TENANT_A,
    M,
    _app,
    _baseline,
    _settings,
    _user,
    _vendor,
)

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)


def _client(app: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture(autouse=True)
def _fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.costs.router as router_module

    monkeypatch.setattr(router_module, "_now", lambda: NOW)


@pytest_asyncio.fixture()
async def users(async_db_session):
    return {
        "admin": await _user(async_db_session, "admin"),
        "ann": await _user(async_db_session, "ann"),
    }


@pytest_asyncio.fixture()
async def admin(async_db_session, users):
    async with _client(
        _app(async_db_session, users["admin"], TENANT_A, ("admin",))
    ) as c:
        yield c


@pytest_asyncio.fixture()
async def ann(async_db_session, users):
    async with _client(
        _app(async_db_session, users["ann"], TENANT_A, ("operator",))
    ) as c:
        yield c


# 1 ---------------------------------------------------------------------------


async def test_a_foreign_manual_entry_leaves_the_vendor_rules_on(
    async_db_session: AsyncSession,
) -> None:
    from app.models.overview import (
        CostEntry,
        CostImportRun,
        SpendAlert,
        SpendRule,
        Vendor,
    )
    from app.spend.evaluate import evaluate_tenant

    db = async_db_session
    day = date(2026, 10, 2)
    vendor = Vendor(
        tenant_id=TENANT_A,
        name="GitHub",
        category="source_hosting",
        connector="github_billing",
    )
    db.add(vendor)
    await db.flush()
    finished = datetime(2026, 10, 3, 6, 0, tzinfo=UTC)
    db.add(
        CostImportRun(
            tenant_id=TENANT_A,
            vendor_id=vendor.id,
            connector="github_billing",
            transport="push",
            granularity="day",
            status="ok",
            started_at=finished,
            finished_at=finished,
            period_start=day,
            period_end=day,
        )
    )
    for source, ref, amount, currency in (
        ("connector", "github:o:2026-10-02:a", 60 * M, "USD"),
        ("manual", "INV-1", 5 * M, "EUR"),
    ):
        db.add(
            CostEntry(
                tenant_id=TENANT_A,
                vendor_id=vendor.id,
                source=source,
                source_ref=ref,
                amount_micros=amount,
                currency=currency,
                period_start=day,
                period_end=day,
                product="actions",
            )
        )
    db.add(SpendRule(tenant_id=TENANT_A, vendor_id=vendor.id, daily_abs_micros=50 * M))
    await db.flush()
    report = await evaluate_tenant(db, TENANT_A, NOW)
    assert report.unknown_currency == []
    alerts = (
        await db.execute(select(SpendAlert).where(SpendAlert.tenant_id == TENANT_A))
    ).scalars()
    assert [a.rule for a in alerts] == ["daily_abs"]


# 2 ---------------------------------------------------------------------------


async def test_an_ingest_never_writes_over_an_entry_entered_by_hand(
    async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models.overview import CostEntry, Vendor
    from app.spend import connectors
    from app.spend.connectors import (
        IngestQuery,
        NormalisedBatch,
        NormalisedEntry,
    )
    from app.spend.ingest import ingest_payload

    db = async_db_session
    vendor = Vendor(
        tenant_id=TENANT_A,
        name="GitHub",
        category="source_hosting",
        connector="github_billing",
        connector_config={"org": "o"},
    )
    db.add(vendor)
    await db.flush()
    day = date(2026, 10, 2)
    clash = "github:o:2026-10-02:repo:actions:linux"
    db.add(
        CostEntry(
            tenant_id=TENANT_A,
            vendor_id=vendor.id,
            source="manual",
            source_ref=clash,
            description="entered by hand",
            amount_micros=7 * M,
            currency="USD",
            period_start=day,
            period_end=day,
        )
    )
    await db.flush()

    def normalise(raw: Any, query: Any, config: Any) -> NormalisedBatch:
        return NormalisedBatch(
            granularity="day",
            period_start=day,
            period_end=day,
            items_seen=2,
            provider_endpoint="test",
            entries=[
                NormalisedEntry(clash, day, day, 99 * M, "USD", description="p"),
                NormalisedEntry(clash + ":2", day, day, 1 * M, "USD", description="q"),
            ],
        )

    spec = connectors.CONNECTORS["github_billing"]
    monkeypatch.setitem(
        connectors.CONNECTORS, "github_billing", replace(spec, normalise=normalise)
    )
    result = await ingest_payload(
        db,
        tenant_id=TENANT_A,
        vendor=vendor,
        connector="github_billing",
        query=IngestQuery(2026, 10, 2),
        raw={},
        source="test",
    )
    assert result.status == "ok" and result.rows_upserted == 1
    kept = (
        await db.execute(
            select(CostEntry)
            .where(CostEntry.source_ref == clash)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert (kept.source, kept.amount_micros) == ("manual", 7 * M)
    from app.models.overview import CostImportRun

    run = await db.get(CostImportRun, result.run_id)
    assert run is not None and any("entered by hand" in n for n in run.notices)


async def test_a_hand_entered_reference_may_not_look_like_a_providers(admin) -> None:
    vendor = await _vendor(admin)
    resp = await admin.post(
        f"{API}/costs/entries",
        json={
            "vendor_id": vendor,
            "description": "x",
            "amount_micros": M,
            "currency": "USD",
            "period_start": "2026-09-01",
            "source_ref": "GitHub:o:2026-09-01:x",
        },
    )
    assert resp.status_code == 422 and resp.json()["error"] == "reserved_reference"


def test_the_reserved_namespaces_cover_every_connector() -> None:
    from app.spend.connectors import CONNECTOR_REF_NAMESPACES

    root = Path(__file__).resolve().parent.parent / "app" / "spend" / "connectors"
    used = {
        m.group(1)
        for path in root.glob("*.py")
        for m in re.finditer(r'f"([a-z_]+):\{', path.read_text(encoding="utf-8"))
    }
    assert used and used <= CONNECTOR_REF_NAMESPACES


# 3 ---------------------------------------------------------------------------


async def test_a_currency_change_clears_the_entrys_rate(
    admin, async_db_session: AsyncSession
) -> None:
    from app.models.overview import CostEntry
    from app.spend.ingest import _upsert_chunk

    vendor = await _vendor(admin)
    made = await admin.post(
        f"{API}/costs/entries",
        json={
            "vendor_id": vendor,
            "description": "x",
            "amount_micros": 10 * M,
            "currency": "USD",
            "fx_rate_to_base": "0.8",
            "period_start": "2026-09-01",
        },
    )
    url = f"{API}/costs/entries/{made.json()['item']['id']}"
    moved = await admin.patch(
        url, json={"currency": "GBP"}, headers={"If-Match": '"1"'}
    )
    assert moved.json()["item"]["fx_rate_to_base"] is None
    both = await admin.patch(
        url,
        json={"currency": "CHF", "fx_rate_to_base": "1.1"},
        headers={"If-Match": '"2"'},
    )
    assert both.json()["item"]["fx_rate_to_base"] == "1.10000000"

    row = CostEntry(
        tenant_id=TENANT_A,
        vendor_id=UUID(vendor),
        source="connector",
        source_ref="aws:1:2026-09-02:EC2",
        description="EC2",
        amount_micros=40 * M,
        currency="USD",
        fx_rate_to_base=Decimal("0.9"),
        period_start=date(2026, 9, 2),
        period_end=date(2026, 9, 2),
    )
    async_db_session.add(row)
    await async_db_session.flush()
    values = {
        c: getattr(row, c)
        for c in (
            "tenant_id",
            "vendor_id",
            "source",
            "source_ref",
            "category",
            "description",
            "amount_micros",
            "period_start",
            "period_end",
            "gross_micros",
            "discount_micros",
            "quantity",
            "unit",
            "scope_label",
            "sku",
            "product",
            "import_run_id",
            "created_by",
            "updated_by",
        )
    }
    await _upsert_chunk(async_db_session, [{**values, "currency": "USD"}])
    await async_db_session.refresh(row)
    assert row.fx_rate_to_base == Decimal("0.9")  # same currency: kept
    await _upsert_chunk(async_db_session, [{**values, "currency": "EUR"}])
    await async_db_session.refresh(row)
    assert row.fx_rate_to_base is None


# 4 ---------------------------------------------------------------------------


async def test_a_legacy_bare_number_rate_round_trips(admin) -> None:
    saved = await admin.put(
        f"{API}/settings", json={"base_currency": "EUR", "fx_rates": {"USD": 0.9}}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["fx_rates"] == {"USD": {"rate": "0.9"}}


# 5 ---------------------------------------------------------------------------


async def test_the_logged_time_list_is_bounded(ann) -> None:
    base = f"{API}/costs/effort-entries"
    for day in range(1, 5):
        await ann.post(base, json={"work_date": f"2026-09-0{day}", "hours": "1"})
    page = (await ann.get(base, params={"limit": 2})).json()
    assert [i["work_date"] for i in page["items"]] == ["2026-09-04", "2026-09-03"]
    assert page["degraded"].startswith("truncated")


async def test_the_ledger_converts_only_the_rows_it_serves(admin) -> None:
    await _settings(admin, base_currency="EUR", fx_rates={"USD": {"rate": "0.5"}})
    vendor = await _vendor(admin)
    for day in range(1, 6):
        await admin.post(
            f"{API}/costs/entries",
            json={
                "vendor_id": vendor,
                "description": f"d{day}",
                "amount_micros": 2 * M,
                "currency": "USD",
                "period_start": f"2026-09-0{day}",
            },
        )
    params = {"from": "2026-09-01", "to": "2026-09-30", "limit": 2, "offset": 1}
    page = (await admin.get(f"{API}/costs/ledger", params=params)).json()
    assert page["total_rows"] == 5
    assert [r["description"] for r in page["rows"]] == ["d4", "d3"]
    assert [r["base_micros"] for r in page["rows"]] == [M, M]
    [applied] = page["fx_applied"]
    assert applied["rows"] == 2


# 6 ---------------------------------------------------------------------------


async def test_outside_day_rates_a_role_change_reprices_and_nothing_wipes(
    admin, ann, async_db_session: AsyncSession
) -> None:
    from app.models.overview import EffortEntry

    await _baseline(admin)
    await _settings(admin, labour_billing="day_rates")
    base = f"{API}/costs/effort-entries"
    item = (
        await ann.post(
            base, json={"work_date": "2026-09-14", "hours": "8", "role_code": "BE"}
        )
    ).json()["item"]
    url = f"{base}/{item['id']}"
    await _settings(admin, labour_billing="unbilled")
    noted = await ann.patch(url, json={"note": "x"}, headers={"If-Match": '"1"'})
    assert noted.json()["item"]["rate_micros_used"] == 800 * M
    # A role the baseline does not price clears it; a priced one re-prices.
    cleared = await ann.patch(
        url, json={"role_code": "PO"}, headers={"If-Match": '"2"'}
    )
    assert (
        cleared.status_code == 200
        and cleared.json()["item"]["rate_micros_used"] is None
    )
    back = await ann.patch(url, json={"role_code": "BE"}, headers={"If-Match": '"3"'})
    assert back.json()["item"]["rate_micros_used"] == 800 * M

    # A legacy role-less entry under day rates can still have its note fixed.
    legacy = EffortEntry(
        tenant_id=TENANT_A,
        work_date=date(2026, 9, 15),
        person="Ann",
        person_user_id=UUID(item["person_user_id"]),
        hours=Decimal("2"),
        version=1,
    )
    async_db_session.add(legacy)
    await async_db_session.commit()
    await _settings(admin, labour_billing="day_rates")
    fixed = await ann.patch(
        f"{base}/{legacy.id}", json={"note": "typo"}, headers={"If-Match": '"1"'}
    )
    assert fixed.status_code == 200, fixed.text


# 7 ---------------------------------------------------------------------------


async def test_time_for_someone_else_names_a_member(
    admin, users, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.costs.effort as effort

    answer: bool | None = False
    asked: list[str] = []

    async def lookup(tenant_id: UUID, subject: str) -> bool | None:
        asked.append(subject)
        return answer

    monkeypatch.setattr(effort, "project_member_by_subject", lookup)
    base = f"{API}/costs/effort-entries"
    body = {
        "work_date": "2026-09-14",
        "hours": "2",
        "person_user_id": str(users["ann"].id),
        "person": "Ann",
    }
    # No sign-in subject: nothing coord could match, so not checkable.
    no_sub = await admin.post(base, json=body)
    assert no_sub.json()["error"] == "membership_unverified" and asked == []
    users["ann"].cognito_sub = "sub-ann"
    await async_db_session.commit()
    refused = await admin.post(base, json=body)
    assert refused.json()["error"] == "not_a_member"
    assert asked == ["sub-ann"]
    answer = None
    unknown = await admin.post(base, json=body)
    assert unknown.json()["error"] == "membership_unverified"
    nobody = await admin.post(base, json={**body, "person_user_id": str(uuid4())})
    assert nobody.json()["error"] == "unknown_person"
    answer = True
    ok = await admin.post(base, json=body)
    assert ok.status_code == 201, ok.text


async def test_a_non_admin_editor_names_others_by_person_only(
    admin, ann, users, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.costs.effort as effort

    called: list[str] = []

    async def lookup(tenant_id: UUID, subject: str) -> bool | None:
        called.append(subject)
        return True

    monkeypatch.setattr(effort, "project_member_by_subject", lookup)
    users["admin"].cognito_sub = "sub-admin"
    await async_db_session.commit()
    await _settings(admin, editing_roles=["admin", "operator"])
    base = f"{API}/costs/effort-entries"
    by_account = await ann.post(
        base,
        json={
            "work_date": "2026-09-14",
            "hours": "1",
            "person_user_id": str(users["admin"].id),
        },
    )
    assert by_account.json()["error"] == "membership_unverified"
    assert "only a project admin" in by_account.json()["message"]
    assert called == []  # coord would refuse a non-admin anyway
    by_name = await ann.post(
        base, json={"work_date": "2026-09-14", "hours": "1", "person": "Carol"}
    )
    assert by_name.status_code == 201, by_name.text


async def test_the_membership_check_runs_before_the_row_lock(
    admin, ann, users, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.costs.effort as effort
    from app.costs.effort import EffortEntryStore

    users["ann"].cognito_sub = "sub-ann"
    await async_db_session.commit()
    base = f"{API}/costs/effort-entries"
    item = (
        await admin.post(base, json={"work_date": "2026-09-14", "hours": "1"})
    ).json()["item"]
    events: list[str] = []
    real_load = EffortEntryStore._load

    async def load(self: Any, ctx: Any, record_id: str, *, lock: bool = False) -> Any:
        events.append("lock" if lock else "read")
        return await real_load(self, ctx, record_id, lock=lock)

    async def lookup(tenant_id: UUID, subject: str) -> bool | None:
        events.append("coord")
        return True

    monkeypatch.setattr(EffortEntryStore, "_load", load)
    monkeypatch.setattr(effort, "project_member_by_subject", lookup)
    moved = await admin.patch(
        f"{base}/{item['id']}",
        json={"person_user_id": str(users["ann"].id)},
        headers={"If-Match": '"1"'},
    )
    assert moved.status_code == 200, moved.text
    assert events.index("coord") < events.index("lock")


# 8 ---------------------------------------------------------------------------


async def test_editable_never_reaches_the_change_log(
    ann, async_db_session: AsyncSession
) -> None:
    from app.models.overview import ChangeLog

    base = f"{API}/costs/effort-entries"
    item = (
        await ann.post(base, json={"work_date": "2026-09-14", "hours": "1"})
    ).json()["item"]
    url = f"{base}/{item['id']}"
    await ann.patch(url, json={"hours": "2"}, headers={"If-Match": '"1"'})
    assert (await ann.delete(url, headers={"If-Match": '"2"'})).status_code == 204
    rows = (
        await async_db_session.execute(
            select(ChangeLog).where(ChangeLog.record_id == item["id"])
        )
    ).scalars()
    snapshots = [s for r in rows for s in (r.before, r.after) if s is not None]
    assert len(snapshots) == 4  # create after, update before+after, delete before
    assert all("editable" not in s for s in snapshots)
    assert all("hours" in s for s in snapshots)


# 9 ---------------------------------------------------------------------------


async def test_the_limit_states_its_own_rate(admin) -> None:
    await _settings(admin, base_currency="EUR", fx_rates={"USD": {"rate": "0.5"}})
    await admin.post(
        f"{API}/spend/rules",
        json={"currency": "USD", "monthly_ceiling_micros": 1000 * M},
    )
    summary = (await admin.get(f"{API}/costs/summary")).json()
    assert summary["limit"]["monthly_micros"] == 500 * M
    assert summary["limit"]["rate"] == "0.50000000"
    assert summary["limit"]["rate_source"] == "settings"
    assert summary["fx"]["applied"] == []


# 10 --------------------------------------------------------------------------


async def test_a_vanished_phase_is_unknown_phase_not_name_taken(
    admin, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.costs.entries import CostEntryStore

    async def no_check(self: Any, ctx: Any, phase_id: Any) -> None:
        return None

    # The phase existed at the check and is gone at the write (a race).
    monkeypatch.setattr(CostEntryStore, "_check_phase", no_check)
    vendor = await _vendor(admin)
    resp = await admin.post(
        f"{API}/costs/entries",
        json={
            "vendor_id": vendor,
            "description": "x",
            "amount_micros": M,
            "currency": "USD",
            "period_start": "2026-09-01",
            "phase_id": str(uuid4()),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"] == "unknown_phase"


async def test_the_member_lookup_matches_the_subject_never_the_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.v1.endpoints.operations as operations
    from app.costs.effort import project_member_by_subject

    seen: dict[str, Any] = {}
    rows: list[dict[str, Any]] = []

    async def answer(path: str, **kwargs: Any) -> Any:
        seen.update(path=path, **kwargs)
        return {"operators": rows}

    monkeypatch.setattr(operations, "_proxy_coord_get", answer)
    # Same e-mail, another account: not this member.
    rows[:] = [{"email": "ann@example.com", "sso_subject": "sub-other"}]
    assert await project_member_by_subject(TENANT_A, "sub-ann") is False
    assert seen["path"] == "/admin/coord/operators"
    assert seen["params"] == {"sso_subject": "sub-ann"}
    assert seen["headers"] == {"X-Qontinui-Active-Tenant": str(TENANT_A)}
    rows[:] = [{"email": "renamed@example.com", "sso_subject": "sub-ann"}]
    assert await project_member_by_subject(TENANT_A, "sub-ann") is True

    async def refuse(path: str, **kwargs: Any) -> Any:
        raise RuntimeError("403 from coord")

    monkeypatch.setattr(operations, "_proxy_coord_get", refuse)
    assert await project_member_by_subject(TENANT_A, "sub-ann") is None


# Round 2 ---------------------------------------------------------------------


async def test_the_ledger_offset_cap_is_stated(admin) -> None:
    resp = await admin.get(f"{API}/costs/ledger", params={"offset": 100_001})
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "offset_too_large"
    assert "100,000" in resp.json()["detail"]["message"]


async def test_a_provider_row_editing_its_reference_gets_the_provider_error(
    admin, async_db_session: AsyncSession
) -> None:
    from app.models.overview import CostEntry

    vendor = await _vendor(admin)
    row = CostEntry(
        tenant_id=TENANT_A,
        vendor_id=UUID(vendor),
        source="connector",
        source_ref="aws:1:2026-09-02:EC2",
        amount_micros=M,
        currency="USD",
        period_start=date(2026, 9, 2),
        period_end=date(2026, 9, 2),
    )
    async_db_session.add(row)
    await async_db_session.commit()
    resp = await admin.patch(
        f"{API}/costs/entries/{row.id}",
        json={"source_ref": "github:x"},
        headers={"If-Match": '"1"'},
    )
    assert resp.json()["error"] == "provider_reported_field"


# 11 --------------------------------------------------------------------------
# A refused write commits nothing — under a session that COMMITS on a normal
# return, as production's ``get_async_db`` does. (The other fixtures run each
# test inside one never-committed transaction, which hides exactly this.)


@pytest_asyncio.fixture()
async def committing(test_engine):
    """A client whose requests each get a fresh session that commits on a
    normal return and rolls back on an exception — ``get_async_db``'s own
    contract — in a tenant of its own, wiped afterwards."""
    from types import SimpleNamespace

    from fastapi import FastAPI
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.api.deps import current_active_user, get_async_db
    from app.models.overview import ChangeLog, CostEntry, Vendor
    from app.overview.permissions import OverviewCaller, get_overview_caller
    from app.overview.router import router as authoring_router

    tenant = uuid4()
    maker = async_sessionmaker(test_engine, expire_on_commit=False)

    async def db():  # type: ignore[no-untyped-def]
        session = maker()
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

    user = SimpleNamespace(
        id=uuid4(), email="committer@example.com", is_superuser=False
    )
    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[get_async_db] = db
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=tenant, roles=("admin",)
    )
    app.include_router(authoring_router, prefix=API)
    async with _client(app) as client:
        yield client, maker, tenant
    async with maker() as session:
        for model in (ChangeLog, CostEntry, Vendor):
            await session.execute(delete(model).where(model.tenant_id == tenant))
        await session.commit()


async def _stored(maker: Any, entry_id: str) -> Any:
    from app.models.overview import CostEntry

    async with maker() as session:
        return await session.get(CostEntry, UUID(entry_id))


async def test_a_refused_costs_write_commits_nothing(committing) -> None:
    from app.models.overview import ChangeLog

    client, maker, tenant = committing
    vendor = await _vendor(client)
    made = await client.post(
        f"{API}/costs/entries",
        json={
            "vendor_id": vendor,
            "description": "kept",
            "amount_micros": M,
            "currency": "USD",
            "period_start": "2026-09-10",
        },
    )
    entry_id = made.json()["item"]["id"]
    url = f"{API}/costs/entries/{entry_id}"
    refused = await client.patch(
        url,
        json={"description": "leaked", "period_end": "2026-09-01"},
        headers={"If-Match": '"1"'},
    )
    assert refused.json()["error"] == "bad_period"
    row = await _stored(maker, entry_id)
    assert (row.description, row.version) == ("kept", 1)
    async with maker() as session:
        actions = (
            await session.execute(
                select(ChangeLog.action).where(
                    ChangeLog.tenant_id == tenant, ChangeLog.record_id == entry_id
                )
            )
        ).scalars()
        assert list(actions) == ["create"]


async def test_whatever_a_store_flushed_before_refusing_is_rolled_back(
    committing, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The choke point itself: a store that WROTE (and flushed) and then
    refused — a future store's bug — still commits nothing."""
    from app.costs.entries import CostEntryStore
    from app.overview.resource import StoreRefused

    client, maker, _tenant = committing
    vendor = await _vendor(client)
    made = await client.post(
        f"{API}/costs/entries",
        json={
            "vendor_id": vendor,
            "description": "kept",
            "amount_micros": M,
            "currency": "USD",
            "period_start": "2026-09-10",
        },
    )
    entry_id = made.json()["item"]["id"]

    async def write_then_refuse(
        self: Any, ctx: Any, record_id: str, payload: Any, expected: int
    ) -> Any:
        row = await self._load(ctx, record_id)
        row.description = "leaked"
        await ctx.db.flush()
        raise StoreRefused(422, "refused_late", "refused after writing")

    monkeypatch.setattr(CostEntryStore, "update", write_then_refuse)
    refused = await client.patch(
        f"{API}/costs/entries/{entry_id}",
        json={"description": "x"},
        headers={"If-Match": '"1"'},
    )
    assert refused.status_code == 422
    assert (await _stored(maker, entry_id)).description == "kept"
