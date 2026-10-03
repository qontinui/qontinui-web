"""The costs read (authoring-layer Phase 5): ``GET /costs/summary``,
``GET /costs/ledger`` and the org-wide spend limit — against real Postgres.

What this file pins:

* **Labour per billing mode, counted once** — ``unbilled`` says "not billed"
  and leaves a ``labour`` cost entry out (reported); ``day_rates`` prices
  logged time and leaves the ``labour`` entry out; ``fixed_fee`` counts the
  ``labour`` entries and no time.
* **FX precedence and partial totals** — the entry's own rate beats the
  project's, the base currency is never converted, an amount no rate converts
  makes its series unknown (null) and the total partial, and every conversion
  is listed.
* **Unknown is not zero** — a connector vendor whose days were never fetched
  is null with its reason until they are.
* **The estimate comparison** against a fixture with price tiers, a
  contingency, phase and unphased non-labour lines and a run cost; explicit
  phase beats the derived one; an entry outside every phase is unphased; the
  estimate totals equal the rollup's own tier totals.
* **The run rate with less than a year of history** is annualised from the
  days there are, and says so.
* **Multi-day manual entries** spread per day under ``amortized``.
* **The ledger** pages, filters and exports CSV with exact amounts and
  formula-safe text.
* **The org-wide rule in EUR with labour** fires on actual cost converted to
  the base currency, and is skipped (with the reason) when a rate is missing.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"
COSTS = f"{API}/costs"
M = 1_000_000

pytestmark = pytest.mark.asyncio

TENANT = UUID("dddddddd-0000-4000-8000-00000000c0d4")
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
TODAY = NOW.date()
SEPT = {"from": "2026-09-01", "to": "2026-09-30"}


# ===========================================================================
# Harness
# ===========================================================================


@pytest.fixture(autouse=True)
def _fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.costs.router as router_module

    monkeypatch.setattr(router_module, "_now", lambda: NOW)


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


def _app(db: AsyncSession, user: Any, roles: tuple[str, ...]) -> FastAPI:
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
        tenant_id=TENANT, roles=roles
    )
    app.include_router(settings_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


@pytest_asyncio.fixture()
async def admin(async_db_session):
    user = await _user(async_db_session, "admin")
    app = _app(async_db_session, user, ("admin",))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _settings(client: httpx.AsyncClient, **values: Any) -> None:
    resp = await client.put(f"{API}/settings", json=values)
    assert resp.status_code == 200, resp.text


async def _vendor(
    client: httpx.AsyncClient,
    name: str,
    category: str = "saas",
    connector: str | None = None,
) -> str:
    body: dict[str, Any] = {"name": name, "category": category}
    if connector:
        body["connector"] = connector
        body["connector_config"] = {"org": "example"}
    resp = await client.post(f"{API}/spend/vendors", json=body)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["item"]["id"])


async def _entry(
    client: httpx.AsyncClient,
    vendor: str,
    amount: int,
    day: str,
    currency: str = "USD",
    **extra: Any,
) -> dict[str, Any]:
    body = {
        "vendor_id": vendor,
        "description": extra.pop("description", f"invoice {day}"),
        "amount_micros": amount,
        "currency": currency,
        "period_start": day,
        **extra,
    }
    resp = await client.post(f"{COSTS}/entries", json=body)
    assert resp.status_code == 201, resp.text
    return dict(resp.json()["item"])


async def _summary(client: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    resp = await client.get(f"{COSTS}/summary", params=params)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


def _points(summary: dict[str, Any]) -> dict[tuple[str, str], Any]:
    return {(p["key"], p["series"]): p["micros"] for p in summary["series"]}


async def _estimate(client: httpx.AsyncClient, body: dict[str, Any]) -> dict[str, Any]:
    resp = await client.post(f"{API}/estimates", json=body)
    assert resp.status_code == 201, resp.text
    return dict(resp.json()["item"])


# ===========================================================================
# Labour, per billing mode, counted once
# ===========================================================================


class TestLabour:
    async def test_each_mode_counts_labour_in_exactly_one_place(self, admin) -> None:
        await _estimate(
            admin,
            {
                "name": "plan",
                "purpose": "comparison",
                "is_baseline": True,
                "content": {
                    "roles": [
                        {
                            "code": "BE",
                            "name": "Backend",
                            "day_rate_micros": 800 * M,
                            "currency": "USD",
                        }
                    ]
                },
            },
        )
        contractor = await _vendor(admin, "Contractor", category="labour")
        hosting = await _vendor(admin, "Hosting")
        await _entry(admin, contractor, 500 * M, "2026-09-10", description="fee 1")
        await _entry(admin, hosting, 100 * M, "2026-09-10")
        await _settings(admin, labour_billing="day_rates")
        logged = await admin.post(
            f"{COSTS}/effort-entries",
            json={"work_date": "2026-09-10", "hours": "8", "role_code": "BE"},
        )
        assert logged.status_code == 201, logged.text

        # day_rates: hosting + priced time; the labour entry is left out.
        rates = await _summary(admin, **SEPT)
        assert rates["totals"] == {"micros": 900 * M, "partial": False, "unknown": []}
        assert rates["labour"]["status"] == "day_rates"
        assert rates["labour"]["cost"]["micros"] == 800 * M
        assert rates["labour"]["excluded_cost_entries"]["rows"] == 1
        assert rates["labour"]["excluded_cost_entries"]["base_micros"] == 500 * M
        points = _points(rates)
        assert points[("2026-09", "labour")] == 800 * M
        assert points[("2026-09", contractor)] == 0

        # fixed_fee: the fee entry IS labour; the logged time costs nothing.
        await _settings(admin, labour_billing="fixed_fee")
        fee = await _summary(admin, **SEPT)
        assert fee["totals"]["micros"] == 600 * M
        assert fee["labour"]["cost"]["micros"] == 500 * M
        assert fee["labour"]["excluded_cost_entries"] is None
        assert fee["labour"]["hours"] == "8.00"
        assert _points(fee)[("2026-09", "labour")] == 500 * M

        # unbilled: neither; said in words, never a silent zero.
        await _settings(admin, labour_billing="unbilled")
        free = await _summary(admin, **SEPT)
        assert free["totals"]["micros"] == 100 * M
        assert free["labour"]["status"] == "not_billed"
        assert free["labour"]["cost"] is None
        assert free["labour"]["excluded_cost_entries"]["rows"] == 1
        assert free["labour"]["person_days"] == "1.00"
        assert ("2026-09", "labour") not in _points(free)

    async def test_time_logged_without_a_price_is_unknown_not_free(self, admin) -> None:
        hosting = await _vendor(admin, "Hosting")
        await _entry(admin, hosting, 100 * M, "2026-09-10")
        await admin.post(
            f"{COSTS}/effort-entries", json={"work_date": "2026-09-10", "hours": "8"}
        )
        await _settings(admin, labour_billing="day_rates")
        summary = await _summary(admin, **SEPT)
        assert summary["totals"]["micros"] == 100 * M
        assert summary["totals"]["partial"] is True
        assert [u["reason"] for u in summary["totals"]["unknown"]] == [
            "effort_not_priced"
        ]
        assert summary["labour"]["cost"]["micros"] is None
        assert summary["labour"]["unpriced_entries"] == 1
        # A month with no time logged at all is not a month of free labour.
        october = await _summary(admin, **{"from": "2026-10-01", "to": "2026-10-03"})
        assert [u["reason"] for u in october["totals"]["unknown"]] == [
            "effort_not_recorded"
        ]


# ===========================================================================
# FX
# ===========================================================================


class TestFx:
    async def test_entry_rate_beats_settings_and_a_missing_rate_is_partial(
        self, admin
    ) -> None:
        await _settings(
            admin,
            base_currency="EUR",
            fx_rates={"USD": {"rate": "0.9", "as_of": "2026-09-01"}},
        )
        a = await _vendor(admin, "Alpha")
        b = await _vendor(admin, "Beta")
        await _entry(admin, a, 100 * M, "2026-09-02", fx_rate_to_base="0.8")
        await _entry(admin, a, 100 * M, "2026-09-03")
        await _entry(admin, a, 50 * M, "2026-09-04", currency="EUR")
        await _entry(admin, b, 10 * M, "2026-09-05", currency="GBP")

        summary = await _summary(admin, group_by="vendor", **SEPT)
        assert summary["base_currency"] == "EUR"
        assert summary["totals"]["micros"] == (80 + 90 + 50) * M
        assert summary["totals"]["partial"] is True
        [gap] = summary["totals"]["unknown"]
        assert (gap["part"], gap["key"], gap["reason"]) == ("fx", "GBP", "fx_missing")
        points = _points(summary)
        assert points[(a, a)] == 220 * M
        assert points[(b, b)] is None  # never the GBP figure relabelled

        applied = {(x["currency"], x["source"]): x for x in summary["fx"]["applied"]}
        assert applied[("USD", "entry")]["rate"] == "0.80000000"
        assert applied[("USD", "entry")]["base_micros"] == 80 * M
        assert applied[("USD", "settings")]["rate"] == "0.90000000"
        assert applied[("USD", "settings")]["as_of"] == "2026-09-01"
        assert applied[("USD", "settings")]["original_micros"] == 100 * M
        assert all(x["currency"] != "EUR" for x in summary["fx"]["applied"])
        [missing] = summary["fx"]["missing"]
        assert (missing["currency"], missing["reason"]) == ("GBP", "no_rate")

    async def test_the_limit_line_is_converted_or_says_why_not(self, admin) -> None:
        await _settings(admin, base_currency="EUR", fx_rates={"USD": {"rate": "0.5"}})
        rule = await admin.post(
            f"{API}/spend/rules",
            json={"currency": "USD", "monthly_ceiling_micros": 1000 * M},
        )
        assert rule.status_code == 201, rule.text
        limit = (await _summary(admin))["limit"]
        assert limit["monthly_micros"] == 500 * M
        assert (limit["rule_currency"], limit["rule_micros"]) == ("USD", 1000 * M)
        await _settings(admin, base_currency="EUR", fx_rates={})
        unknown = (await _summary(admin))["limit"]
        assert unknown["monthly_micros"] is None and "USD" in unknown["detail"]


# ===========================================================================
# Unknown is not zero
# ===========================================================================


class TestCoverage:
    async def test_unfetched_connector_days_are_unknown_until_fetched(
        self, async_db_session, admin
    ) -> None:
        from app.models.overview import CostImportRun

        github = await _vendor(
            admin, "GitHub", category="source_hosting", connector="github_billing"
        )
        manual = await _vendor(admin, "Hosting")
        await _entry(admin, manual, 30 * M, "2026-09-10")
        window = {"from": "2026-09-01", "to": "2026-09-30", "group_by": "vendor"}
        before = await _summary(admin, **window)
        assert _points(before)[(github, github)] is None
        assert before["totals"]["micros"] == 30 * M
        assert before["totals"]["partial"] is True
        [gap] = before["totals"]["unknown"]
        assert (gap["key"], gap["reason"]) == (github, "never_imported")

        finished = datetime(2026, 10, 2, 6, 0, tzinfo=UTC)
        async_db_session.add(
            CostImportRun(
                tenant_id=TENANT,
                vendor_id=UUID(github),
                connector="github_billing",
                transport="push",
                granularity="range",
                status="ok",
                started_at=finished,
                finished_at=finished,
                period_start=date(2026, 9, 1),
                period_end=date(2026, 9, 30),
            )
        )
        await async_db_session.commit()
        after = await _summary(admin, **window)
        assert _points(after)[(github, github)] == 0  # fetched: a stated $0
        assert after["totals"] == {"micros": 30 * M, "partial": False, "unknown": []}

    async def test_a_project_with_nothing_recording_costs_is_null(self, admin) -> None:
        summary = await _summary(admin, **SEPT)
        assert summary["totals"]["micros"] is None
        assert summary["totals"]["unknown"][0]["reason"] == "no_sources"
        assert summary["kpis"]["total_to_date"]["micros"] is None
        assert summary["kpis"]["run_rate"]["annual_micros"] is None
        assert summary["comparison"] is None
        assert summary["comparison_unavailable"]["reason"] == "no_estimate"


# ===========================================================================
# Multi-day manual entries
# ===========================================================================


class TestSpread:
    async def test_a_month_long_invoice_is_spread_per_day_when_amortized(
        self, admin
    ) -> None:
        vendor = await _vendor(admin, "Agency")
        await _entry(admin, vendor, 3000 * M, "2026-09-01", period_end="2026-09-30")
        half = {"from": "2026-09-16", "to": "2026-09-30", "group_by": "vendor"}
        amortized = await _summary(admin, **half)
        assert amortized["totals"]["micros"] == 1500 * M
        charged = await _summary(admin, view="charged", **half)
        assert charged["totals"]["micros"] == 0
        # The spend read spreads it the same way.
        spend = (
            await admin.get(
                f"{API}/spend/summary",
                params={"from": "2026-09-01", "to": "2026-09-30", "group_by": "day"},
            )
        ).json()
        days = [p for p in spend["series"] if p["vendor_id"] == vendor]
        assert len(days) == 30 and {p["net_micros"] for p in days} == {100 * M}


# ===========================================================================
# The estimate comparison
# ===========================================================================


def _fixture_estimate() -> dict[str, Any]:
    return {
        "name": "Delivery plan v0.1",
        "purpose": "budget",
        "is_baseline": True,
        "contingency_pct": "10",
        "content": {
            "roles": [
                {
                    "code": "BE",
                    "name": "Backend",
                    "day_rate_micros": 1000 * M,
                    "currency": "USD",
                }
            ],
            "phases": [
                {
                    "code": "A0",
                    "name": "Discovery",
                    "planned_start": "2026-09-01",
                    "planned_end": "2026-09-15",
                    "tasks": [
                        {
                            "number": "1",
                            "title": "Interviews",
                            "efforts": [
                                {"role_code": "BE", "planned_person_days": "2"}
                            ],
                        }
                    ],
                },
                {
                    "code": "A1",
                    "name": "Build",
                    "planned_start": "2026-09-16",
                    "planned_end": "2026-09-30",
                    "tasks": [
                        {
                            "number": "2",
                            "title": "Build it",
                            "efforts": [
                                {"role_code": "BE", "planned_person_days": "3"}
                            ],
                        }
                    ],
                },
            ],
            "price_tiers": [
                {"name": "Low", "multiplier": "0.8"},
                {"name": "Midpoint", "multiplier": "1", "is_primary": True},
                {"name": "High", "multiplier": "1.25"},
            ],
            "cost_lines": [
                {
                    "kind": "build_non_labour",
                    "label": "Licences",
                    "low_micros": 100 * M,
                    "high_micros": 150 * M,
                    "currency": "USD",
                    "phase_code": "A1",
                },
                {
                    "kind": "build_non_labour",
                    "label": "Hardware",
                    "low_micros": 50 * M,
                    "currency": "USD",
                },
                {
                    "kind": "run_annual",
                    "label": "Hosting",
                    "low_micros": 1200 * M,
                    "high_micros": 2400 * M,
                    "currency": "USD",
                    "run_model": "managed",
                },
            ],
        },
    }


class TestComparison:
    async def test_against_a_fixture_estimate(self, admin) -> None:
        estimate = await _estimate(admin, _fixture_estimate())
        phases = {p["code"]: p["id"] for p in estimate["content"]["phases"]}
        hosting = await _vendor(admin, "Hosting")
        await _entry(admin, hosting, 500 * M, "2026-09-05")  # derived: A0
        # Explicit beats derived: the 20th falls in A1 but is booked to A0.
        await _entry(admin, hosting, 300 * M, "2026-09-20", phase_id=phases["A0"])
        await _entry(admin, hosting, 200 * M, "2026-10-02")  # in no phase
        await admin.post(
            f"{COSTS}/effort-entries", json={"work_date": "2026-09-03", "hours": "4"}
        )

        summary = await _summary(admin, **SEPT)
        comparison = summary["comparison"]
        assert comparison["purpose"] == "budget"
        assert comparison["estimate_currency"] == "USD"
        assert comparison["actual_from"] == "2026-09-03"
        a0, a1 = comparison["phases"]
        assert a0["code"] == "A0"
        assert a0["estimate"]["labour"] == {
            "micros": 2000 * M,
            "low_micros": 1600 * M,
            "high_micros": 2500 * M,
        }
        assert a0["estimate"]["contingency"]["micros"] == 200 * M
        assert a0["estimate"]["cost"] == {
            "micros": 2200 * M,
            "low_micros": 1760 * M,
            "high_micros": 2750 * M,
        }
        assert a0["actual"]["cost"]["micros"] == 800 * M
        assert a0["actual"]["person_days"] == "0.50"
        assert a0["actual"]["people"] == 1
        assert a0["difference_micros"] == 1400 * M
        assert a1["estimate"]["non_labour_low_micros"] == 100 * M
        assert a1["estimate"]["cost"] == {
            "micros": 3400 * M,
            "low_micros": 2740 * M,
            "high_micros": 4275 * M,
        }
        assert a1["actual"]["cost"]["micros"] == 0
        assert a1["actual"]["person_days"] is None  # not recorded, not 0
        unphased = comparison["unphased"]
        assert unphased["cost"]["micros"] == 200 * M
        assert unphased["estimate_non_labour_low_micros"] == 50 * M

        # The totals are the rollup's own tier totals.
        rollup = (await admin.get(f"{API}/estimates/{estimate['id']}/rollup")).json()
        tiers = {t["name"]: t for t in rollup["money"]["tiers"]}
        totals = comparison["totals"]
        assert totals["estimate"]["micros"] == tiers["Midpoint"]["total_low_micros"]
        assert totals["estimate"]["low_micros"] == tiers["Low"]["total_low_micros"]
        assert totals["estimate"]["high_micros"] == tiers["High"]["total_high_micros"]
        assert totals["estimate"]["micros"] == 5650 * M
        assert totals["actual"]["micros"] == 1000 * M
        assert totals["difference_micros"] == 4650 * M
        assert comparison["contingency"]["micros"] == 500 * M
        assert comparison["non_labour_estimate_low_micros"] == 150 * M
        assert comparison["non_labour_estimate_high_micros"] == 200 * M
        assert comparison["non_labour_actual"]["micros"] == 1000 * M
        [run_line] = comparison["run_cost_lines"]
        assert (run_line["low_micros"], run_line["high_micros"]) == (1200 * M, 2400 * M)

        # Grouped by phase, the bars agree with the comparison.
        by_phase = _points(
            await _summary(
                admin, group_by="phase", **{"from": "2026-09-01", "to": "2026-10-03"}
            )
        )
        assert by_phase[(phases["A0"], hosting)] == 800 * M
        assert by_phase[(phases["A1"], hosting)] == 0
        assert by_phase[("unphased", hosting)] == 200 * M

    async def test_the_run_rate_annualises_a_short_history(self, admin) -> None:
        vendor = await _vendor(admin, "Hosting")
        await _entry(admin, vendor, 310 * M, "2026-09-03")
        kpis = (await _summary(admin))["kpis"]
        run = kpis["run_rate"]
        days = (TODAY - date(2026, 9, 3)).days + 1
        assert run["basis_days"] == days == 31
        assert run["short_history"] is True
        expected = (Decimal(310 * M) * 365 / Decimal(days)).quantize(
            Decimal(1), rounding=ROUND_HALF_UP
        )
        assert run["annual_micros"] == int(expected) == 3650 * M
        assert kpis["total_to_date"]["micros"] == 310 * M
        assert kpis["last_month"]["micros"] == 310 * M
        assert kpis["this_month"]["micros"] == 0

    async def test_an_unknown_estimate_is_404(self, admin) -> None:
        resp = await admin.get(f"{COSTS}/summary", params={"estimate_id": str(uuid4())})
        assert resp.status_code == 404


# ===========================================================================
# The ledger
# ===========================================================================


class TestLedger:
    async def test_json_pages_and_csv_exports_exactly(self, admin) -> None:
        vendor = await _vendor(admin, "Hosting")
        await _entry(
            admin, vendor, -12_500_000, "2026-09-20", description="=SUM(A1:A9)"
        )
        await _entry(admin, vendor, 1_234_567, "2026-09-10")
        recurring = await admin.post(
            f"{API}/spend/recurring-costs",
            json={
                "vendor_id": vendor,
                "description": "seats",
                "unit_amount_micros": 20 * M,
                "cadence": "monthly",
                "start_date": "2026-09-15",
            },
        )
        assert recurring.status_code == 201, recurring.text
        await admin.post(
            f"{COSTS}/effort-entries",
            json={"work_date": "2026-09-12", "hours": "3.5", "note": "+review"},
        )
        params = {"from": "2026-09-01", "to": "2026-09-30"}
        page = (
            await admin.get(f"{COSTS}/ledger", params={**params, "limit": 2})
        ).json()
        assert page["total_rows"] == 4
        assert [(r["kind"], r["date"]) for r in page["rows"]] == [
            ("cost", "2026-09-20"),
            ("recurring", "2026-09-15"),
        ]
        rest = (
            await admin.get(f"{COSTS}/ledger", params={**params, "offset": 2})
        ).json()
        assert [(r["kind"], r["date"]) for r in rest["rows"]] == [
            ("effort", "2026-09-12"),
            ("cost", "2026-09-10"),
        ]
        effort = rest["rows"][0]
        assert effort["resource"] == "effort_entries" and effort["editable"] is True
        assert effort["counted_as"] == "time_only"
        only_time = (
            await admin.get(f"{COSTS}/ledger", params={**params, "kind": "effort"})
        ).json()
        assert only_time["total_rows"] == 1

        exported = await admin.get(
            f"{COSTS}/ledger", params={**params, "format": "csv"}
        )
        assert exported.status_code == 200
        assert exported.headers["content-type"].startswith("text/csv")
        assert "attachment" in exported.headers["content-disposition"]
        assert exported.headers["x-ledger-rows"] == "4"
        rows = list(csv.DictReader(io.StringIO(exported.text)))
        assert [r["kind"] for r in rows] == ["cost", "recurring", "effort", "cost"]
        assert rows[0]["amount"] == "-12.5"
        assert rows[0]["description"] == "'=SUM(A1:A9)"
        assert rows[1]["amount"] == "20"
        assert rows[2]["hours"] == "3.50" and rows[2]["description"] == "'+review"
        assert rows[3]["amount"] == "1.234567"
        assert rows[3]["base_amount"] == "1.234567"
        assert rows[3]["base_currency"] == "USD"


# ===========================================================================
# The org-wide rule is the spend limit: EUR, with labour
# ===========================================================================


class TestOrgWideLimit:
    async def _seed(self, db: AsyncSession, *, with_rate: bool) -> None:
        from app.models.overview import (
            CostEntry,
            CostImportRun,
            EffortEntry,
            OverviewSettings,
            SpendRule,
            Vendor,
        )

        db.add(
            OverviewSettings(
                tenant_id=TENANT,
                base_currency="EUR",
                fx_rates={"USD": {"rate": "0.5"}} if with_rate else {},
                labour_billing="day_rates",
            )
        )
        github = Vendor(
            tenant_id=TENANT,
            name="GitHub",
            category="source_hosting",
            connector="github_billing",
        )
        db.add(github)
        await db.flush()
        yesterday = TODAY - timedelta(days=1)
        finished = datetime.combine(TODAY, datetime.min.time(), UTC) + timedelta(
            hours=6
        )
        db.add(
            CostImportRun(
                tenant_id=TENANT,
                vendor_id=github.id,
                connector="github_billing",
                transport="push",
                granularity="range",
                status="ok",
                started_at=finished,
                finished_at=finished,
                period_start=date(2026, 10, 1),
                period_end=yesterday,
            )
        )
        db.add(
            CostEntry(
                tenant_id=TENANT,
                vendor_id=github.id,
                source="connector",
                source_ref="gh:2026-10-01",
                amount_micros=200 * M,
                currency="USD",
                period_start=date(2026, 10, 1),
                period_end=date(2026, 10, 1),
                product="actions",
            )
        )
        db.add(
            EffortEntry(
                tenant_id=TENANT,
                work_date=yesterday,
                person="Ann",
                hours=Decimal("8"),
                role_code="BE",
                rate_micros_used=400 * M,
                rate_currency="EUR",
                hours_per_day_used=Decimal("8"),
            )
        )
        db.add(
            SpendRule(
                tenant_id=TENANT,
                vendor_id=None,
                currency="EUR",
                monthly_ceiling_micros=1000 * M,
                mtd_thresholds_pct=[50, 90],
            )
        )
        await db.flush()

    async def test_month_to_date_is_actual_cost_in_the_base_currency(
        self, async_db_session
    ) -> None:
        from sqlalchemy import select

        from app.models.overview import SpendAlert
        from app.spend.evaluate import evaluate_tenant

        await self._seed(async_db_session, with_rate=True)
        report = await evaluate_tenant(async_db_session, TENANT, NOW)
        assert report.org_rule_skipped is None
        [alert] = (
            await async_db_session.execute(
                select(SpendAlert).where(
                    SpendAlert.tenant_id == TENANT, SpendAlert.rule == "mtd_threshold"
                )
            )
        ).scalars()
        # 200 USD at 0.5 = 100 EUR, plus 8 h at 400 EUR/day: 500 EUR = 50%.
        assert alert.vendor_key == "*"
        assert alert.observed_micros == 500 * M
        assert alert.threshold_micros == 500 * M
        assert alert.currency == "EUR"
        assert alert.detail["currency"] == "EUR"

    async def test_a_missing_rate_skips_the_rule_and_says_why(
        self, async_db_session
    ) -> None:
        from sqlalchemy import select

        from app.models.overview import SpendAlert
        from app.spend.evaluate import evaluate_tenant

        await self._seed(async_db_session, with_rate=False)
        report = await evaluate_tenant(async_db_session, TENANT, NOW)
        assert report.org_rule_skipped is not None
        assert "USD" in report.org_rule_skipped
        alerts = (
            (
                await async_db_session.execute(
                    select(SpendAlert).where(
                        SpendAlert.tenant_id == TENANT,
                        SpendAlert.rule == "mtd_threshold",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert alerts == []
