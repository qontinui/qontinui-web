"""Provider-reported spend, Phase 1: the store, the GitHub normaliser, the
ingest door and the summary read — against real Postgres.

Plan ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``.
What this file pins:

* **The normaliser** turns a real-shaped GitHub usage payload (keys verbatim,
  values anonymised — ``tests/fixtures/spend/``) into one entry per (repo,
  product, SKU), and refuses a month-shaped payload on the daily path.
* **Ingest is idempotent** — the same payload twice is the same totals — and a
  partial day re-ingested is corrected.
* **Tenant isolation** and the two credentials: an import token reaches its
  own tenant only; a session must be a project admin.
* **Unknown is not zero** — a vendor with no run is ``never`` with ``null``
  figures, and a total over it is ``partial``.
* **Two views of a yearly cost** — ``charged`` lands it on its date,
  ``amortized`` spreads it per day, and both sum to the invoice.

Coord's identity read (:func:`get_overview_caller`) and the Cognito session
check are the only things stubbed.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"
SPEND = f"{API}/spend"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000a1")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000b2")
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
FIXTURE = (
    Path(__file__).parent / "fixtures" / "spend" / "github_usage_day_2026-10-02.json"
)
DAY = {"year": 2026, "month": 10, "day": 2}


def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text())


def _micros(value: float) -> int:
    return int((Decimal(str(value)) * 1_000_000).quantize(Decimal(1)))


def _per_repo(raw: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for item in raw["usageItems"]:
        out[item["repositoryName"]] += _micros(item["netAmount"])
    return dict(out)


# ===========================================================================
# Harness
# ===========================================================================


@pytest.fixture(autouse=True)
def _fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Freshness compares a run's finish with 'now'; pin both."""
    import app.spend.ingest as ingest_module
    import app.spend.router as router_module

    monkeypatch.setattr(router_module, "_now", lambda: NOW)
    monkeypatch.setattr(ingest_module, "_now", lambda: NOW)


@pytest.fixture(autouse=True)
def _no_after_ingest(monkeypatch: pytest.MonkeyPatch) -> list[UUID]:
    """The after-ingest evaluation opens its own session; record the call."""
    import app.spend.router as router_module

    calls: list[UUID] = []

    async def record(tenant_id: UUID) -> None:
        calls.append(tenant_id)

    monkeypatch.setattr(router_module, "after_ingest", record)
    return calls


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"spend_{uuid4().hex[:8]}@example.com",
        username=f"spend_{uuid4().hex[:8]}",
        full_name="Spend Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _app(db: AsyncSession, user: Any, tenant: UUID, roles: tuple[str, ...]) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
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
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI, headers: dict[str, str] | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers=headers or {},
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
async def admin_b(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_B, ("admin",))) as c:
        yield c


async def _vendor(
    client: httpx.AsyncClient,
    name: str = "GitHub",
    connector: str | None = "github_billing",
    category: str = "source_hosting",
) -> str:
    body: dict[str, Any] = {"name": name, "category": category}
    if connector:
        body["connector"] = connector
        body["connector_config"] = {"org": "example-org"}
    resp = await client.post(f"{SPEND}/vendors", json=body)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["item"]["id"])


async def _token(client: httpx.AsyncClient, vendor_id: str | None = None) -> str:
    body: dict[str, Any] = {"name": "fleet importer"}
    if vendor_id:
        body["vendor_id"] = vendor_id
    resp = await client.post(f"{SPEND}/import-tokens", json=body)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["token"])


async def _ingest(
    db: AsyncSession,
    user: Any,
    token: str,
    vendor_id: str,
    raw: Any,
    query: dict[str, int] | None = None,
    tenant: UUID = TENANT_A,
) -> httpx.Response:
    """POST with ONLY the import token — no session at all."""
    app = _app(db, user, tenant, ())
    async with _client(app, {"Authorization": f"Bearer {token}"}) as c:
        return await c.post(
            f"{SPEND}/ingest/github_billing",
            json={"vendor_id": vendor_id, "query": query or DAY, "raw": raw},
        )


async def _summary(client: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    resp = await client.get(f"{SPEND}/summary", params=params)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


# ===========================================================================
# The normaliser
# ===========================================================================


class TestGithubNormaliser:
    async def test_one_entry_per_repo_product_sku_with_net_gross_discount(self) -> None:
        from app.spend.connectors import IngestQuery
        from app.spend.connectors.github_billing import normalise

        raw = _fixture()
        batch = normalise(raw, IngestQuery(2026, 10, 2), {"org": "example-org"})
        assert batch.granularity == "day"
        assert batch.items_seen == len(raw["usageItems"])
        assert len(batch.entries) == len(raw["usageItems"])
        assert sum(e.amount_micros for e in batch.entries) == sum(
            _micros(i["netAmount"]) for i in raw["usageItems"]
        )
        first = raw["usageItems"][0]
        ref = (
            f"github:example-org:2026-10-02:{first['repositoryName']}:"
            f"{first['product']}/{first['sku']}"
        )
        entry = next(e for e in batch.entries if e.source_ref == ref)
        assert entry.gross_micros == _micros(first["grossAmount"])
        assert entry.discount_micros == _micros(first["discountAmount"])
        assert entry.scope_label == first["repositoryName"]
        assert entry.product == "actions"

    async def test_every_product_is_kept(self) -> None:
        from app.spend.connectors import IngestQuery
        from app.spend.connectors.github_billing import normalise

        raw = _fixture()
        extra = dict(raw["usageItems"][0])
        extra.update(product="packages", sku="Packages storage", netAmount=1.5)
        raw["usageItems"].append(extra)
        batch = normalise(raw, IngestQuery(2026, 10, 2), {})
        assert {e.product for e in batch.entries} == {"actions", "packages"}

    async def test_a_month_payload_is_refused_on_the_daily_path(self) -> None:
        from app.spend.connectors import IngestQuery, NormaliseError
        from app.spend.connectors.github_billing import normalise

        raw = _fixture()
        other = dict(raw["usageItems"][0])
        other["date"] = "2026-10-01T00:00:00Z"
        raw["usageItems"].append(other)
        with pytest.raises(NormaliseError, match="month payload"):
            normalise(raw, IngestQuery(2026, 10, 2), {})

    async def test_a_month_payload_is_a_reconciliation_sum(self) -> None:
        from app.spend.connectors import IngestQuery
        from app.spend.connectors.github_billing import normalise

        raw = _fixture()
        batch = normalise(raw, IngestQuery(2026, 10), {})
        assert batch.granularity == "month"
        assert batch.entries == []
        assert batch.month_net_micros == sum(
            _micros(i["netAmount"]) for i in raw["usageItems"]
        )

    async def test_another_org_is_refused(self) -> None:
        from app.spend.connectors import IngestQuery, NormaliseError
        from app.spend.connectors.github_billing import normalise

        with pytest.raises(NormaliseError, match="organization"):
            normalise(_fixture(), IngestQuery(2026, 10, 2), {"org": "someone-else"})

    async def test_not_a_usage_payload(self) -> None:
        from app.spend.connectors import IngestQuery, NormaliseError
        from app.spend.connectors.github_billing import normalise

        with pytest.raises(NormaliseError, match="usageItems"):
            normalise({"total": 0}, IngestQuery(2026, 10, 2), {})

    async def test_duplicate_lines_are_summed(self) -> None:
        from app.spend.connectors import IngestQuery
        from app.spend.connectors.github_billing import normalise

        raw = _fixture()
        raw["usageItems"].append(dict(raw["usageItems"][-1]))
        batch = normalise(raw, IngestQuery(2026, 10, 2), {})
        assert len(batch.entries) == len(raw["usageItems"]) - 1
        assert sum(e.amount_micros for e in batch.entries) == sum(
            _micros(i["netAmount"]) for i in raw["usageItems"]
        )

    async def test_the_registry_admits_exactly_the_stored_connectors(self) -> None:
        from app.models.overview import SPEND_CONNECTORS
        from app.spend.connectors import CONNECTORS

        assert set(CONNECTORS) == set(SPEND_CONNECTORS)
        assert CONNECTORS["github_billing"].expected_lag_hours == 24
        assert CONNECTORS["aws_cost_explorer"].expected_lag_hours == 48


# ===========================================================================
# The ingest door and the summary
# ===========================================================================


class TestIngest:
    async def test_acceptance_fixture_day_and_a_vendor_with_no_runs(
        self, async_db_session, api_user, admin, _no_after_ingest
    ) -> None:
        vendor = await _vendor(admin)
        aws = await _vendor(admin, "AWS", "aws_cost_explorer", "cloud")
        token = await _token(admin)
        raw = _fixture()

        resp = await _ingest(async_db_session, api_user, token, vendor, raw)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "ok"
        assert body["rows_upserted"] == len(raw["usageItems"])
        assert body["items_seen"] == len(raw["usageItems"])
        assert body["reconcile_delta_micros"] is None
        assert _no_after_ingest == [TENANT_A]

        summary = await _summary(
            admin, **{"from": "2026-10-02", "to": "2026-10-02", "group_by": "scope"}
        )
        by_repo = {
            p["key"]: p["net_micros"]
            for p in summary["series"]
            if p["vendor_id"] == vendor
        }
        assert by_repo == _per_repo(raw)
        vendors = {v["id"]: v for v in summary["vendors"]}
        assert vendors[vendor]["status"] == "ok"
        assert vendors[vendor]["newest_complete_day"] == "2026-10-02"
        assert vendors[vendor]["expected_lag_hours"] == 24
        assert "GitHub billing" in vendors[vendor]["provenance"]
        assert vendors[aws]["status"] == "never"
        assert vendors[aws]["month_to_date_micros"] is None
        assert summary["totals"]["partial"] is True
        assert summary["totals"]["unknown_vendors"] == ["AWS"]

    async def test_same_payload_twice_is_the_same_totals(
        self, async_db_session, api_user, admin
    ) -> None:
        from app.models.overview import CostEntry

        vendor = await _vendor(admin)
        token = await _token(admin)
        raw = _fixture()
        first = await _ingest(async_db_session, api_user, token, vendor, raw)
        before = await _summary(admin, **{"from": "2026-10-02", "to": "2026-10-02"})
        second = await _ingest(async_db_session, api_user, token, vendor, raw)
        after = await _summary(admin, **{"from": "2026-10-02", "to": "2026-10-02"})
        assert first.status_code == second.status_code == 201
        assert before["totals"] == after["totals"]
        assert before["series"] == after["series"]
        count = await async_db_session.scalar(
            select(func.count())
            .select_from(CostEntry)
            .where(CostEntry.tenant_id == TENANT_A)
        )
        assert count == len(raw["usageItems"])

    async def test_a_partial_day_reingested_is_corrected(
        self, async_db_session, api_user, admin
    ) -> None:
        vendor = await _vendor(admin)
        token = await _token(admin)
        full = _fixture()
        partial = {"usageItems": [dict(i) for i in full["usageItems"][:-3]]}
        for item in partial["usageItems"]:
            item["netAmount"] = round(item["netAmount"] / 2, 6)
        await _ingest(async_db_session, api_user, token, vendor, partial)
        await _ingest(async_db_session, api_user, token, vendor, full)
        summary = await _summary(
            admin, **{"from": "2026-10-02", "to": "2026-10-02", "group_by": "scope"}
        )
        assert {p["key"]: p["net_micros"] for p in summary["series"]} == _per_repo(full)

    async def test_month_payload_reconciles_without_upserting(
        self, async_db_session, api_user, admin
    ) -> None:
        vendor = await _vendor(admin)
        token = await _token(admin)
        raw = _fixture()
        await _ingest(async_db_session, api_user, token, vendor, raw)
        month = {"usageItems": [dict(i) for i in raw["usageItems"]]}
        month["usageItems"][0]["netAmount"] += 1.25
        resp = await _ingest(
            async_db_session,
            api_user,
            token,
            vendor,
            month,
            query={"year": 2026, "month": 10},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["rows_upserted"] == 0
        assert resp.json()["reconcile_delta_micros"] == 1_250_000

    async def test_a_rejected_payload_is_422_and_a_failed_run(
        self, async_db_session, api_user, admin
    ) -> None:
        from app.models.overview import CostImportRun

        vendor = await _vendor(admin)
        token = await _token(admin)
        resp = await _ingest(async_db_session, api_user, token, vendor, {"x": 1})
        assert resp.status_code == 422
        assert resp.json()["status"] == "failed"
        run = await async_db_session.get(
            CostImportRun, UUID(resp.json()["import_run_id"])
        )
        assert run is not None and run.status == "failed" and "usageItems" in run.error
        summary = await _summary(admin)
        github = summary["vendors"][0]
        assert github["status"] == "failed"
        assert github["month_to_date_micros"] is None
        assert summary["totals"]["partial"] is True

    async def test_an_unauthenticated_large_body_is_401_not_read(
        self, async_db_session, api_user
    ) -> None:
        app = _app(async_db_session, api_user, TENANT_A, ())
        async with _client(app) as c:
            resp = await c.post(
                f"{SPEND}/ingest/github_billing",
                content=b"x" * (3 * 1024 * 1024),
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 401

    async def test_a_payload_over_2mb_is_413(
        self, async_db_session, api_user, admin
    ) -> None:
        vendor = await _vendor(admin)
        token = await _token(admin)
        raw = {"usageItems": [], "pad": "x" * (2 * 1024 * 1024 + 10)}
        resp = await _ingest(async_db_session, api_user, token, vendor, raw)
        assert resp.status_code == 413

    async def test_a_session_ingest_needs_a_project_admin(
        self, async_db_session, api_user, monkeypatch
    ) -> None:
        import app.spend.router as router_module
        from app.overview.permissions import OverviewCaller

        async def session_user(token: str, db: AsyncSession) -> Any:
            return api_user

        monkeypatch.setattr(router_module, "_resolve_session_user", session_user)
        app = _app(async_db_session, api_user, TENANT_A, ("admin",))
        async with _client(app) as c:
            vendor = await _vendor(c)
        headers = {"Authorization": "Bearer a-cognito-session-jwt"}
        for roles, expected in ((("operator",), 403), (("admin",), 201)):

            async def caller(request: Any, roles: tuple[str, ...] = roles) -> Any:
                return OverviewCaller(tenant_id=TENANT_A, roles=roles)

            monkeypatch.setattr(router_module, "get_overview_caller", caller)
            async with _client(app, headers) as c:
                resp = await c.post(
                    f"{SPEND}/ingest/github_billing",
                    json={"vendor_id": vendor, "query": DAY, "raw": _fixture()},
                )
            assert resp.status_code == expected, resp.text

    async def test_no_credential_is_401(self, async_db_session, api_user) -> None:
        app = _app(async_db_session, api_user, TENANT_A, ("admin",))
        async with _client(app) as c:
            resp = await c.post(
                f"{SPEND}/ingest/github_billing",
                json={"vendor_id": str(uuid4()), "query": DAY, "raw": {}},
            )
        assert resp.status_code == 401

    async def test_vendor_connector_must_match_the_route(
        self, async_db_session, api_user, admin
    ) -> None:
        manual = await _vendor(admin, "Namecheap", None, "saas")
        token = await _token(admin)
        resp = await _ingest(async_db_session, api_user, token, manual, _fixture())
        assert resp.status_code == 409


class TestTenantIsolation:
    async def test_a_token_reaches_its_own_tenant_only(
        self, async_db_session, api_user, admin, admin_b
    ) -> None:
        vendor_b = await _vendor(admin_b)
        token_a = await _token(admin)
        # Tenant A's token names tenant B's vendor: not found, never written.
        resp = await _ingest(async_db_session, api_user, token_a, vendor_b, _fixture())
        assert resp.status_code == 404
        # And it cannot be pointed at tenant B through the header.
        app = _app(async_db_session, api_user, TENANT_A, ())
        async with _client(
            app,
            {
                "Authorization": f"Bearer {token_a}",
                "X-Qontinui-Active-Tenant": str(TENANT_B),
            },
        ) as c:
            resp = await c.post(
                f"{SPEND}/ingest/github_billing",
                json={"vendor_id": vendor_b, "query": DAY, "raw": _fixture()},
            )
        assert resp.status_code == 403

    async def test_a_tenant_never_reads_another_tenants_spend(
        self, async_db_session, api_user, admin, admin_b
    ) -> None:
        vendor_a = await _vendor(admin)
        token_a = await _token(admin)
        await _ingest(async_db_session, api_user, token_a, vendor_a, _fixture())
        summary_b = await _summary(admin_b)
        assert summary_b["vendors"] == []
        assert summary_b["series"] == []
        assert summary_b["totals"]["net_micros"] == 0
        listed = (await admin_b.get(f"{SPEND}/vendors")).json()
        assert listed["items"] == []
        assert (await admin_b.get(f"{SPEND}/vendors/{vendor_a}")).status_code == 404

    async def test_a_member_reads_but_does_not_write(self, admin, operator) -> None:
        await _vendor(admin)
        assert (await operator.get(f"{SPEND}/summary")).status_code == 200
        resp = await operator.post(
            f"{SPEND}/vendors", json={"name": "X", "category": "other"}
        )
        assert resp.status_code == 403
        resp = await operator.post(f"{SPEND}/import-tokens", json={"name": "t"})
        assert resp.status_code == 403
        resp = await operator.post(
            f"{SPEND}/rules", json={"daily_abs_micros": 50_000_000}
        )
        assert resp.status_code == 403


class TestImportTokens:
    async def test_shown_once_hashed_at_rest_and_revocable(
        self, async_db_session, api_user, admin
    ) -> None:
        from app.models.overview import ImportToken

        vendor = await _vendor(admin)
        token = await _token(admin)
        assert token.startswith("qsit_")
        listed = await admin.get(f"{SPEND}/import-tokens")
        assert token not in listed.text
        rows = (
            (
                await async_db_session.execute(
                    select(ImportToken).where(ImportToken.tenant_id == TENANT_A)
                )
            )
            .scalars()
            .all()
        )
        assert rows and all(token not in r.token_hash for r in rows)
        token_id = listed.json()["tokens"][0]["id"]
        assert (
            await admin.delete(f"{SPEND}/import-tokens/{token_id}")
        ).status_code == 204
        resp = await _ingest(async_db_session, api_user, token, vendor, _fixture())
        assert resp.status_code == 401

    async def test_a_vendor_scoped_token_ingests_for_that_vendor_only(
        self, async_db_session, api_user, admin
    ) -> None:
        vendor = await _vendor(admin)
        other = await _vendor(admin, "GitHub (second org)")
        token = await _token(admin, vendor)
        resp = await _ingest(async_db_session, api_user, token, other, _fixture())
        assert resp.status_code == 403
        resp = await _ingest(async_db_session, api_user, token, vendor, _fixture())
        assert resp.status_code == 201

    async def test_the_token_value_is_never_logged(
        self, async_db_session, api_user, admin, capsys, caplog
    ) -> None:
        vendor = await _vendor(admin)
        token = await _token(admin)
        await _ingest(async_db_session, api_user, token, vendor, {"bad": True})
        await _ingest(async_db_session, api_user, token, vendor, _fixture())
        captured = capsys.readouterr()
        assert token not in captured.out + captured.err
        assert token not in caplog.text


class TestUnknownIsNotZero:
    async def test_a_known_zero_is_zero_and_an_unknown_is_null(
        self, async_db_session, api_user, admin
    ) -> None:
        zero = await _vendor(admin)
        never = await _vendor(admin, "Vercel", "vercel_billing", "cloud")
        token = await _token(admin)
        resp = await _ingest(
            async_db_session, api_user, token, zero, {"usageItems": []}
        )
        assert resp.status_code == 201
        summary = await _summary(admin, **{"from": "2026-10-02", "to": "2026-10-02"})
        vendors = {v["id"]: v for v in summary["vendors"]}
        assert vendors[zero]["status"] == "ok"
        # 10-02 was fetched and stated nothing: a real $0.
        assert vendors[zero]["yesterday_micros"] == 0
        # 10-01 was never fetched, so the month so far is UNKNOWN, not $0;
        # and today (10-03) has not been fetched at all.
        assert vendors[zero]["month_to_date_micros"] is None
        assert vendors[zero]["today_micros"] is None
        assert vendors[never]["status"] == "never"
        assert vendors[never]["yesterday_micros"] is None
        assert vendors[never]["ceiling_pct"] is None
        assert summary["totals"]["unknown_vendors"] == ["Vercel"]
        # Over the default 60 days GitHub has unfetched days: partial, named.
        wide = await _summary(admin)
        assert wide["totals"]["unknown_vendors"] == ["GitHub", "Vercel"]

    async def test_month_to_date_is_known_once_every_day_is_fetched(
        self, async_db_session, api_user, admin
    ) -> None:
        vendor = await _vendor(admin)
        token = await _token(admin)
        raw = _fixture()
        day1 = {
            "usageItems": [
                dict(i, date="2026-10-01T00:00:00Z") for i in raw["usageItems"]
            ]
        }
        await _ingest(async_db_session, api_user, token, vendor, raw)
        await _ingest(
            async_db_session,
            api_user,
            token,
            vendor,
            day1,
            query={"year": 2026, "month": 10, "day": 1},
        )
        github = (await _summary(admin))["vendors"][0]
        assert github["month_to_date_micros"] == 2 * sum(_per_repo(raw).values())
        assert github["today_micros"] is None  # 10-03 still unfetched

    async def test_a_rejected_backfill_does_not_unknow_the_present(
        self, async_db_session, api_user, admin
    ) -> None:
        vendor = await _vendor(admin)
        token = await _token(admin)
        await _ingest(async_db_session, api_user, token, vendor, _fixture())
        resp = await _ingest(
            async_db_session,
            api_user,
            token,
            vendor,
            {"bad": 1},
            query={"year": 2026, "month": 9, "day": 3},
        )
        assert resp.status_code == 422
        summary = await _summary(admin, **{"from": "2026-10-02", "to": "2026-10-02"})
        assert summary["vendors"][0]["status"] == "ok"

    async def test_a_vendor_with_no_connector_and_nothing_entered_is_not_linked(
        self, admin
    ) -> None:
        await _vendor(admin, "Cloudflare", None, "cloud")
        summary = await _summary(admin)
        assert summary["vendors"][0]["status"] == "not_linked"
        assert summary["vendors"][0]["month_to_date_micros"] is None

    async def test_stale_after_the_lag(
        self, async_db_session, api_user, admin, monkeypatch
    ) -> None:
        import app.spend.router as router_module

        vendor = await _vendor(admin)
        token = await _token(admin)
        await _ingest(async_db_session, api_user, token, vendor, _fixture())
        # 10-02 complete; 10-03 is due once 24 h + 12 h past its end.
        monkeypatch.setattr(
            router_module, "_now", lambda: datetime(2026, 10, 5, 11, 0, tzinfo=UTC)
        )
        assert (await _summary(admin))["vendors"][0]["status"] == "ok"
        monkeypatch.setattr(
            router_module, "_now", lambda: datetime(2026, 10, 5, 13, 0, tzinfo=UTC)
        )
        vendor_row = (await _summary(admin))["vendors"][0]
        assert vendor_row["status"] == "stale"
        assert vendor_row["month_to_date_micros"] is None


class TestRecurringViews:
    async def _annual(
        self, admin: httpx.AsyncClient, vendor: str, **extra: Any
    ) -> dict:
        body = {
            "vendor_id": vendor,
            "description": "example.io",
            "unit_amount_micros": 15_000_000,
            "cadence": "annual",
            "start_date": "2025-11-02",
            "external_ref": "example.io",
            "source_note": "renewal invoice 2025-11",
            **extra,
        }
        resp = await admin.post(f"{SPEND}/recurring-costs", json=body)
        assert resp.status_code == 201, resp.text
        return dict(resp.json()["item"])

    async def test_charged_vs_amortized_for_an_annual_cost(self, admin) -> None:
        vendor = await _vendor(admin, "Namecheap", None, "saas")
        entry = await self._annual(admin, vendor)
        assert entry["next_charge_on"] == "2026-11-02"
        window = {"from": "2025-11-02", "to": "2026-11-01", "group_by": "month"}
        charged = await _summary(admin, view="charged", **window)
        amortized = await _summary(admin, view="amortized", **window)
        assert [(p["key"], p["net_micros"]) for p in charged["series"]] == [
            ("2025-11", 15_000_000)
        ]
        assert all(p["source"] == "recurring" for p in amortized["series"])
        # Nov 2025 … Nov 2026 (the last covered day is 2026-11-01).
        assert len(amortized["series"]) == 13
        assert sum(p["net_micros"] for p in amortized["series"]) == 15_000_000
        assert charged["totals"]["net_micros"] == amortized["totals"]["net_micros"]
        nov = next(p for p in amortized["series"] if p["key"] == "2025-11")
        # 29 of 365 days of the year the charge covers.
        assert nov["net_micros"] == pytest.approx(15_000_000 * 29 / 365, abs=1)
        assert charged["vendors"][0]["status"] == "manual"
        assert "entered manually" in charged["vendors"][0]["provenance"]

    async def test_renewals_list_the_next_charge(self, admin) -> None:
        vendor = await _vendor(admin, "Namecheap", None, "saas")
        await self._annual(admin, vendor, renews_on="2026-11-02")
        await self._annual(admin, vendor, description="far.io", start_date="2026-06-01")
        resp = await admin.get(f"{SPEND}/renewals", params={"days": 60})
        renewals = resp.json()["renewals"]
        assert [(r["description"], r["renews_on"]) for r in renewals] == [
            ("example.io", "2026-11-02")
        ]
        assert renewals[0]["amount_micros"] == 15_000_000
        assert renewals[0]["external_ref"] == "example.io"
        assert renewals[0]["vendor_name"] == "Namecheap"
        assert renewals[0]["auto_renew"] is None


class TestVendorNarrowing:
    async def test_vendor_param_narrows_everything(
        self, async_db_session, api_user, admin
    ) -> None:
        from app.models.overview import SpendAlert

        github = await _vendor(admin)
        names = await _vendor(admin, "Namecheap", None, "saas")
        await _vendor(admin, "AWS", "aws_cost_explorer", "cloud")
        token = await _token(admin)
        await _ingest(async_db_session, api_user, token, github, _fixture())
        await admin.post(
            f"{SPEND}/recurring-costs",
            json={
                "vendor_id": names,
                "description": "example.io",
                "unit_amount_micros": 15_000_000,
                "cadence": "monthly",
                "start_date": "2026-09-01",
            },
        )
        for vendor_id, rule in ((github, "daily_abs"), (names, "stale")):
            async_db_session.add(
                SpendAlert(
                    tenant_id=TENANT_A,
                    vendor_id=UUID(vendor_id),
                    vendor_key=vendor_id,
                    rule=rule,
                    scope_key="org",
                    period_key="2026-10-02",
                    fired_at=NOW,
                )
            )
        await async_db_session.commit()

        window = {"from": "2026-10-02", "to": "2026-10-02"}
        narrowed = await _summary(admin, vendor=github, **window)
        assert [v["id"] for v in narrowed["vendors"]] == [github]
        assert {p["vendor_id"] for p in narrowed["series"]} == {github}
        assert [a["vendor_id"] for a in narrowed["alerts"]] == [github]
        # AWS (UNKNOWN) is outside the narrowed read, so the total is whole.
        assert narrowed["totals"]["partial"] is False
        assert narrowed["totals"]["net_micros"] == sum(_per_repo(_fixture()).values())
        everything = await _summary(admin, **window)
        assert len(everything["vendors"]) == 3
        assert everything["totals"]["partial"] is True


class TestResources:
    async def test_rules_need_a_ceiling_for_thresholds_and_one_per_vendor(
        self, admin
    ) -> None:
        vendor = await _vendor(admin)
        resp = await admin.post(
            f"{SPEND}/rules", json={"vendor_id": vendor, "mtd_thresholds_pct": [50]}
        )
        assert resp.status_code == 422
        rule = {
            "vendor_id": vendor,
            "monthly_ceiling_micros": 750_000_000,
            "daily_abs_micros": 50_000_000,
            "spike_multiplier": "3",
            "median_window_days": 14,
            "mtd_thresholds_pct": [100, 50, 75, 90],
            "product_filter": ["actions"],
            "note": "success_metric/github-actions-monthly-spend",
        }
        resp = await admin.post(f"{SPEND}/rules", json=rule)
        assert resp.status_code == 201, resp.text
        assert resp.json()["item"]["mtd_thresholds_pct"] == [50, 75, 90, 100]
        assert (await admin.post(f"{SPEND}/rules", json=rule)).status_code == 409
        other = await _vendor(admin, "Elsewhere")
        await admin.post(f"{SPEND}/rules", json={"daily_abs_micros": 1})
        assert (
            await admin.post(f"{SPEND}/rules", json={"daily_abs_micros": 2})
        ).status_code == 409
        assert (
            await admin.post(f"{SPEND}/rules", json={"vendor_id": other})
        ).status_code == 201

    async def test_a_rule_cannot_name_another_tenants_vendor(
        self, admin, admin_b
    ) -> None:
        vendor_b = await _vendor(admin_b)
        resp = await admin.post(
            f"{SPEND}/rules", json={"vendor_id": vendor_b, "daily_abs_micros": 1}
        )
        assert resp.status_code == 422

    async def test_connector_config_refuses_credentials(self, admin) -> None:
        resp = await admin.post(
            f"{SPEND}/vendors",
            json={
                "name": "Vercel",
                "category": "cloud",
                "connector": "vercel_billing",
                "connector_config": {"team_id": "t", "auth": {"api_token": "nope"}},
            },
        )
        assert resp.status_code == 422
        assert "nope" not in resp.text

    async def test_writes_are_audited(self, async_db_session, admin) -> None:
        from app.models.overview import ChangeLog

        vendor = await _vendor(admin)
        resp = await admin.patch(
            f"{SPEND}/vendors/{vendor}",
            json={"preset_key": "github"},
            headers={"If-Match": '"1"'},
        )
        assert resp.status_code == 200, resp.text
        rows = (
            (
                await async_db_session.execute(
                    select(ChangeLog.action).where(
                        ChangeLog.tenant_id == TENANT_A, ChangeLog.resource == "vendors"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(rows) == ["create", "update"]


class TestAlertPreferences:
    async def test_default_unmuted_and_own_switch(self, operator) -> None:
        assert (await operator.get(f"{SPEND}/alert-preferences")).json() == {
            "muted": False
        }
        resp = await operator.put(f"{SPEND}/alert-preferences", json={"muted": True})
        assert resp.status_code == 200
        assert (await operator.get(f"{SPEND}/alert-preferences")).json() == {
            "muted": True
        }


async def test_cost_entry_day_payload_uses_the_utc_date() -> None:
    """A guard on the fixture itself: every item is dated the queried day."""
    raw = _fixture()
    assert {i["date"][:10] for i in raw["usageItems"]} == {
        date(2026, 10, 2).isoformat()
    }
    assert set(raw["usageItems"][0]) == {
        "date",
        "product",
        "sku",
        "quantity",
        "unitType",
        "pricePerUnit",
        "grossAmount",
        "discountAmount",
        "netAmount",
        "organizationName",
        "repositoryName",
    }
