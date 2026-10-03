"""Provider-reported spend, Phases 7–9 against real Postgres: the credential
vault, "Link account", the server pull, the AWS tenant pin, and the two
no-money connectors' effects.

Plan ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``.
What this file pins:

* **The value never leaves the vault.** A sentinel token is linked, read,
  re-linked, refused and unlinked, and is asserted absent from every response
  body, every log line (stdlib and stdout), every change-log row and every
  import-run row. A validation failure stores nothing. Unlink gives
  ``not_linked``.
* **Only a project admin** links, reads the status of, or unlinks a credential.
* **The server pull** goes through the same normaliser as the ingest door and
  records ``transport=pull``; it honours the connector's minimum interval, and
  a provider refusal is a ``failed`` run with a typed, value-free reason.
* **The AWS task-role arm serves only the pinned tenant** — another tenant's
  ``aws_cost_explorer`` vendor is refused on it (policy
  ``aws-account-is-per-tenant``) — and Cost Explorer's day is complete only
  two days later.
* **No-money connectors** write no entry: Workspace seats warn on a changed
  seat count; Namecheap keeps ``renews_on``/``auto_renew`` current (with a
  change-log row) and warns about a domain that will not auto-renew.

The vault is an in-process ``MemoryStore``; every provider is an
``httpx.MockTransport``; coord's identity read is stubbed as in Phase 1.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"
SPEND = f"{API}/spend"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000a1")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000b2")
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
SENTINEL = "SENTINEL-7f3a-c0ffee-not-a-real-token"
FIXTURES = Path(__file__).parent / "fixtures" / "spend"


# ===========================================================================
# Harness
# ===========================================================================


@pytest.fixture(autouse=True)
def _clock_and_vault(monkeypatch: pytest.MonkeyPatch):
    import app.spend.ingest as ingest_module
    import app.spend.router as router_module
    from app.spend import credentials

    monkeypatch.setattr(router_module, "_now", lambda: NOW)
    monkeypatch.setattr(ingest_module, "_now", lambda: NOW)

    async def no_evaluate(tenant_id: UUID) -> None:
        return None

    monkeypatch.setattr(router_module, "after_ingest", no_evaluate)
    store = credentials.MemoryStore()
    credentials.set_store(store)
    yield store
    credentials.set_store(None)


@pytest.fixture()
def provider(monkeypatch: pytest.MonkeyPatch):
    """Every connector HTTP call goes to the handler a test installs."""
    from app.spend.connectors import _http

    calls: list[httpx.Request] = []
    state: dict[str, Any] = {"handler": lambda r: httpx.Response(500)}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return state["handler"](request)

    monkeypatch.setattr(
        _http, "transport_factory", lambda: httpx.MockTransport(handler)
    )

    def install(fn):
        state["handler"] = fn
        return calls

    return install


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"cred_{uuid4().hex[:8]}@example.com",
        username=f"cred_{uuid4().hex[:8]}",
        full_name="Credential Tester",
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


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
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
    name: str,
    connector: str | None,
    category: str = "cloud",
    config: dict[str, Any] | None = None,
) -> str:
    body: dict[str, Any] = {"name": name, "category": category}
    if connector:
        body["connector"] = connector
        body["connector_config"] = config or {}
    resp = await client.post(f"{SPEND}/vendors", json=body)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["item"]["id"])


async def _summary(client: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    resp = await client.get(f"{SPEND}/summary", params=params)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


def _github_ok(request: httpx.Request) -> httpx.Response:
    assert request.url.host == "api.github.com"
    return httpx.Response(200, json={"usageItems": []})


async def _everything_stored(db: AsyncSession) -> str:
    """Every row of every table this feature writes, as text."""
    parts: list[str] = []
    for table in (
        "overview.change_log",
        "overview.cost_import_runs",
        "overview.cost_entries",
        "overview.vendors",
        "overview.recurring_costs",
    ):
        rows = (
            await db.execute(text(f"SELECT row_to_json(t)::text FROM {table} t"))
        ).all()
        parts.extend(r[0] for r in rows)
    return "\n".join(parts)


# ===========================================================================
# Phase 7 — the vault and the Link-account routes
# ===========================================================================


class TestLinkAccount:
    async def test_link_status_unlink_and_the_value_never_leaves(
        self,
        async_db_session,
        admin,
        provider,
        _clock_and_vault,
        caplog,
        capsys,
    ) -> None:
        caplog.set_level(logging.DEBUG)
        await _vendor(
            admin, "GitHub", "github_billing", "source_hosting", {"org": "example-org"}
        )
        calls = provider(_github_ok)

        status = await admin.get(f"{SPEND}/connectors/github_billing/credential")
        assert status.json() == {
            "connector": "github_billing",
            "status": "not_linked",
            "arm": None,
        }

        linked = await admin.put(
            f"{SPEND}/connectors/github_billing/credential",
            json={"credential": {"token": SENTINEL, "org": "example-org"}},
        )
        assert linked.status_code == 200, linked.text
        assert linked.json() == {
            "connector": "github_billing",
            "status": "linked",
            "arm": "secret",
        }
        # Validated with ONE live provider call, the token in a header.
        assert len(calls) == 1
        assert calls[0].headers["authorization"] == f"Bearer {SENTINEL}"
        # Stored under the IaC path, as the vault's value only.
        name = f"qontinui/development/web/spend/{TENANT_A}/github_billing"
        assert json.loads(_clock_and_vault.values[name]) == {
            "token": SENTINEL,
            "org": "example-org",
        }

        relinked = await admin.put(
            f"{SPEND}/connectors/github_billing/credential",
            json={"credential": {"token": SENTINEL + "-2", "org": "example-org"}},
        )
        assert relinked.status_code == 200
        read = await admin.get(f"{SPEND}/connectors/github_billing/credential")
        assert read.json()["status"] == "linked"

        summary = await _summary(admin)
        vendor = summary["vendors"][0]
        assert vendor["credential_status"] == "linked"
        # Linked but nothing collected yet: "never", not "not linked".
        assert vendor["status"] == "never"

        gone = await admin.delete(f"{SPEND}/connectors/github_billing/credential")
        assert gone.status_code == 200
        assert gone.json()["status"] == "not_linked"
        assert name not in _clock_and_vault.values

        stored = await _everything_stored(async_db_session)
        log_rows = (
            (
                await async_db_session.execute(
                    text(
                        "SELECT action FROM overview.change_log "
                        "WHERE resource = 'spend_credentials' ORDER BY created_at"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert list(log_rows) == ["create", "update", "delete"]
        captured = capsys.readouterr()
        for blob in (
            linked.text,
            relinked.text,
            read.text,
            gone.text,
            json.dumps(summary),
            stored,
            caplog.text,
            captured.out + captured.err,
        ):
            assert SENTINEL not in blob

    async def test_a_refused_credential_stores_nothing_and_echoes_nothing(
        self, async_db_session, admin, provider, _clock_and_vault, caplog
    ) -> None:
        caplog.set_level(logging.DEBUG)
        provider(lambda r: httpx.Response(401, text=f"Bad credentials {SENTINEL}"))
        resp = await admin.put(
            f"{SPEND}/connectors/vercel_billing/credential",
            json={"credential": {"token": SENTINEL, "team_id": "team_x"}},
        )
        assert resp.status_code == 422
        assert resp.json()["error"] == "credential_rejected"
        assert resp.json()["reason"] == "unauthorized"
        assert _clock_and_vault.values == {}
        status = await admin.get(f"{SPEND}/connectors/vercel_billing/credential")
        assert status.json()["status"] == "not_linked"
        stored = await _everything_stored(async_db_session)
        for blob in (resp.text, stored, caplog.text):
            assert SENTINEL not in blob

    async def test_malformed_bodies_never_echo_the_input(
        self, admin, provider, _clock_and_vault
    ) -> None:
        provider(_github_ok)
        for body in (
            {"credential": {"token": SENTINEL}},  # org missing
            {"credential": {"token": SENTINEL, "org": "o", "extra": SENTINEL}},
            {"credential": {"token": [SENTINEL], "org": "o"}},
            {"token": SENTINEL},
        ):
            resp = await admin.put(
                f"{SPEND}/connectors/github_billing/credential", json=body
            )
            assert resp.status_code == 422, resp.text
            assert SENTINEL not in resp.text
        raw = await admin.put(
            f"{SPEND}/connectors/github_billing/credential",
            content=f'{{"credential": {SENTINEL}',
        )
        assert raw.status_code == 422
        assert SENTINEL not in raw.text
        assert _clock_and_vault.values == {}

    async def test_only_a_project_admin(self, operator) -> None:
        for method in ("get", "put", "delete"):
            kwargs = {"json": {"credential": {}}} if method == "put" else {}
            resp = await getattr(operator, method)(
                f"{SPEND}/connectors/github_billing/credential", **kwargs
            )
            assert resp.status_code == 403, (method, resp.text)
        # The connector catalogue (no state, no values) is a member read.
        listing = await operator.get(f"{SPEND}/connectors")
        assert listing.status_code == 200
        keys = {c["key"] for c in listing.json()["connectors"]}
        assert "namecheap_domains" in keys and "aws_cost_explorer" in keys
        github = next(
            c for c in listing.json()["connectors"] if c["key"] == "github_billing"
        )
        assert {f["name"]: f["secret"] for f in github["fields"]} == {
            "token": True,
            "org": False,
        }
        assert "Administration: Read-only" in github["help"]

    async def test_an_unknown_connector_is_404(self, admin) -> None:
        resp = await admin.get(f"{SPEND}/connectors/nope/credential")
        assert resp.status_code == 404

    async def test_a_tenant_never_sees_another_tenants_link(
        self, admin, admin_b, provider
    ) -> None:
        provider(_github_ok)
        resp = await admin.put(
            f"{SPEND}/connectors/github_billing/credential",
            json={"credential": {"token": SENTINEL, "org": "example-org"}},
        )
        assert resp.status_code == 200
        other = await admin_b.get(f"{SPEND}/connectors/github_billing/credential")
        assert other.json()["status"] == "not_linked"

    async def test_no_vault_refuses_a_link_honestly(self, admin, provider) -> None:
        from app.spend import credentials

        credentials.set_store(credentials.DisabledStore())
        provider(_github_ok)
        resp = await admin.put(
            f"{SPEND}/connectors/github_billing/credential",
            json={"credential": {"token": SENTINEL, "org": "example-org"}},
        )
        assert resp.status_code == 503
        assert resp.json()["reason"] == "store_unavailable"
        assert SENTINEL not in resp.text


class TestVaultChoice:
    async def test_development_has_no_vault_and_production_uses_aws(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.core.config import settings
        from app.spend import credentials

        credentials.set_store(None)
        monkeypatch.setattr(settings, "SPEND_CREDENTIAL_STORE", None)
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        assert isinstance(credentials.get_store(), credentials.DisabledStore)
        credentials.set_store(None)
        monkeypatch.setattr(settings, "ENVIRONMENT", "staging")
        store = credentials.get_store()
        assert isinstance(store, credentials.AwsSecretsManagerStore)
        assert credentials.secret_name(TENANT_A, "upstash_billing") == (
            f"qontinui/staging/web/spend/{TENANT_A}/upstash_billing"
        )

    async def test_unlink_deletes_without_recovery(self) -> None:
        from app.spend.credentials import AwsSecretsManagerStore

        deleted: list[dict[str, Any]] = []

        class FakeSm:
            def delete_secret(self, **kw: Any) -> None:
                deleted.append(kw)

        store = AwsSecretsManagerStore("us-east-1")
        store._client = FakeSm()
        assert await store.delete("qontinui/staging/web/spend/t/c") is True
        assert deleted == [
            {
                "SecretId": "qontinui/staging/web/spend/t/c",
                "ForceDeleteWithoutRecovery": True,
            }
        ]


# ===========================================================================
# Phase 7 — the server pull
# ===========================================================================


class TestServerPull:
    async def test_pull_uses_the_normaliser_and_records_transport_pull(
        self, async_db_session, admin, provider, _clock_and_vault
    ) -> None:
        from app.models.overview import CostEntry, CostImportRun, Vendor
        from app.spend.collect import collect_vendor

        vendor_id = await _vendor(admin, "Vercel", "vercel_billing")
        body = json.loads((FIXTURES / "vercel_charges_documented.json").read_text())
        provider(lambda r: httpx.Response(200, text=body["jsonl"]))
        resp = await admin.put(
            f"{SPEND}/connectors/vercel_billing/credential",
            json={"credential": {"token": SENTINEL, "team_id": "team_exampleTeam123"}},
        )
        assert resp.status_code == 200, resp.text

        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        assert await collect_vendor(async_db_session, vendor, NOW) == "ok"
        runs = (
            (
                await async_db_session.execute(
                    select(CostImportRun).where(
                        CostImportRun.vendor_id == UUID(vendor_id)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [(r.transport, r.status, r.granularity) for r in runs] == [
            ("pull", "ok", "range")
        ]
        # First pull: 35 days through today.
        assert (runs[0].period_start, runs[0].period_end) == (
            date(2026, 8, 30),
            date(2026, 10, 3),
        )
        entries = (
            (
                await async_db_session.execute(
                    select(CostEntry).where(CostEntry.vendor_id == UUID(vendor_id))
                )
            )
            .scalars()
            .all()
        )
        assert sum(e.amount_micros for e in entries) == 2_400_000

        # Inside the minimum interval: not pulled again.
        assert await collect_vendor(async_db_session, vendor, NOW) == "skipped:interval"

        summary = await _summary(admin, **{"from": "2026-10-01", "to": "2026-10-02"})
        v = summary["vendors"][0]
        assert v["status"] == "ok"
        assert v["credential_status"] == "linked"
        assert v["yesterday_micros"] == 400_000

    async def test_a_provider_refusal_is_a_failed_run_with_a_typed_reason(
        self, async_db_session, admin, provider, _clock_and_vault
    ) -> None:
        from app.models.overview import CostImportRun, Vendor
        from app.spend.collect import collect_vendor
        from app.spend.credentials import secret_name

        vendor_id = await _vendor(admin, "Cloudflare", "cloudflare_billing")
        _clock_and_vault.values[secret_name(TENANT_A, "cloudflare_billing")] = (
            json.dumps({"token": SENTINEL, "account_id": "acc1"})
        )
        provider(lambda r: httpx.Response(403, text=SENTINEL))
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        assert await collect_vendor(async_db_session, vendor, NOW) == "failed:forbidden"
        run = await async_db_session.scalar(
            select(CostImportRun).where(CostImportRun.vendor_id == UUID(vendor_id))
        )
        assert run is not None
        assert (run.transport, run.status) == ("pull", "failed")
        assert run.error is not None and "forbidden" in run.error
        assert SENTINEL not in run.error
        summary = await _summary(admin)
        assert summary["vendors"][0]["status"] == "failed"

    async def test_an_unlinked_vendor_is_skipped_and_reads_not_linked(
        self, async_db_session, admin, provider
    ) -> None:
        from app.models.overview import Vendor
        from app.spend.collect import collect_vendor

        calls = provider(_github_ok)
        vendor_id = await _vendor(admin, "Anthropic", "anthropic_cost_report", "ai")
        github_id = await _vendor(
            admin, "GitHub", "github_billing", "source_hosting", {"org": "o"}
        )
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        assert (
            await collect_vendor(async_db_session, vendor, NOW) == "skipped:not_linked"
        )
        assert calls == []
        summary = await _summary(admin)
        by_id = {v["id"]: v for v in summary["vendors"]}
        assert by_id[vendor_id]["status"] == "not_linked"
        assert by_id[vendor_id]["month_to_date_micros"] is None
        # GitHub is pushed by the fleet importer with no credential: a GitHub
        # vendor with no run is still "never" (the Phase 1 acceptance).
        assert by_id[github_id]["status"] == "never"

    async def test_an_unreachable_vault_writes_no_failed_run(
        self, async_db_session, admin, provider
    ) -> None:
        from app.models.overview import CostImportRun, Vendor
        from app.spend import credentials
        from app.spend.collect import collect_vendor

        class DeniedStore(credentials.MemoryStore):
            async def get(self, name: str) -> str | None:
                raise credentials.StoreUnavailable("store_forbidden", "AccessDenied")

        credentials.set_store(DeniedStore())
        calls = provider(_github_ok)
        vendor_id = await _vendor(
            admin, "GitHub", "github_billing", "source_hosting", {"org": "o"}
        )
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        outcome = await collect_vendor(async_db_session, vendor, NOW)
        assert outcome == "skipped:vault_store_forbidden"
        assert calls == []
        # The fleet importer's pushes must not be overruled by a vault outage.
        assert (
            await async_db_session.scalar(
                select(CostImportRun.id).where(
                    CostImportRun.vendor_id == UUID(vendor_id)
                )
            )
        ) is None
        status = await admin.get(f"{SPEND}/connectors/github_billing/credential")
        assert status.json()["status"] == "error:store_forbidden"

    async def test_collect_all_tenants_runs_every_due_vendor(
        self, async_db_session, admin, provider, _clock_and_vault, monkeypatch
    ) -> None:
        from contextlib import asynccontextmanager

        from app.spend import collect
        from app.spend.credentials import secret_name

        await _vendor(admin, "GitHub", "github_billing", "source_hosting", {"org": "o"})
        await _vendor(admin, "Anthropic", "anthropic_cost_report", "ai")
        _clock_and_vault.values[secret_name(TENANT_A, "github_billing")] = json.dumps(
            {"token": SENTINEL, "org": "o"}
        )
        provider(_github_ok)

        @asynccontextmanager
        async def factory():
            yield async_db_session

        result = await collect.collect_all_tenants(
            session_factory=factory, now=NOW, evaluate=False
        )
        assert result["vendors"] == 2
        assert result["ok"] == 1
        assert result["skipped"] == 1

    async def test_spend_collect_is_scheduled_hourly_at_boot(self) -> None:
        from app.core.scheduler import SchedulerService, install_default_tasks

        service = SchedulerService()
        install_default_tasks(service)
        task = next(t for t in service._tasks.values() if t.name == "spend_collect")
        assert task.cron == "5 * * * *"
        assert task.run_at_boot is True


# ===========================================================================
# Phase 8 — AWS Cost Explorer: the tenant pin and the day-2 completeness
# ===========================================================================


class TestAwsTenantPin:
    @pytest.fixture(autouse=True)
    def _pin(self, monkeypatch: pytest.MonkeyPatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "SPEND_AWS_TASK_ROLE_TENANT_ID", str(TENANT_A))

    @pytest.fixture()
    def ce(self, monkeypatch: pytest.MonkeyPatch):
        from app.spend.connectors import aws_cost_explorer as aws

        seen: list[tuple[str, date, date]] = []
        raw = json.loads((FIXTURES / "aws_ce_range_documented.json").read_text())

        def fake_read(credential, arm, start, end_exclusive):
            seen.append((arm, start, end_exclusive))
            return {
                "account_id": raw["account_id"],
                "ResultsByTime": raw["ResultsByTime"],
            }

        monkeypatch.setattr(aws, "_read", fake_read)
        monkeypatch.setattr(aws, "BACKFILL_DAYS", 3)  # the fixture's three days
        return seen

    async def test_the_pinned_tenant_is_read_with_the_task_role(
        self, async_db_session, admin, ce
    ) -> None:
        from app.models.overview import CostImportRun, Vendor
        from app.spend.collect import collect_vendor

        status = await admin.get(f"{SPEND}/connectors/aws_cost_explorer/credential")
        assert status.json() == {
            "connector": "aws_cost_explorer",
            "status": "linked",
            "arm": "task_role",
        }
        vendor_id = await _vendor(admin, "AWS", "aws_cost_explorer")
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        assert await collect_vendor(async_db_session, vendor, NOW) == "ok"
        assert ce == [("task_role", date(2026, 9, 30), date(2026, 10, 3))]
        run = await async_db_session.scalar(
            select(CostImportRun).where(CostImportRun.vendor_id == UUID(vendor_id))
        )
        assert run is not None and run.transport == "pull"
        # Twice a day at most.
        later = datetime(2026, 10, 3, 23, 0, tzinfo=UTC)
        assert (
            await collect_vendor(async_db_session, vendor, later) == "skipped:interval"
        )

        summary = await _summary(admin, **{"from": "2026-09-30", "to": "2026-10-02"})
        v = summary["vendors"][0]
        # The run finished on 10-03: Cost Explorer's day is complete only two
        # days later, so 10-01 is the newest complete day and 10-02 (fetched)
        # is not complete.
        assert v["newest_complete_day"] == "2026-10-01"
        assert v["status"] == "ok"
        assert v["yesterday_micros"] == 0  # 10-02 was stated, with no service
        assert v["expected_lag_hours"] == 48

    async def test_another_tenant_is_refused_on_the_task_role_arm(
        self, async_db_session, admin_b, ce
    ) -> None:
        from app.models.overview import Vendor
        from app.spend import credentials
        from app.spend.collect import collect_vendor

        assert credentials.task_role_serves(TENANT_A, "aws_cost_explorer")
        assert not credentials.task_role_serves(TENANT_B, "aws_cost_explorer")
        assert await credentials.resolve(TENANT_B, "aws_cost_explorer") is None
        status = await admin_b.get(f"{SPEND}/connectors/aws_cost_explorer/credential")
        assert status.json()["status"] == "not_linked"

        vendor_id = await _vendor(admin_b, "AWS", "aws_cost_explorer")
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        assert (
            await collect_vendor(async_db_session, vendor, NOW) == "skipped:not_linked"
        )
        assert ce == []  # the hosting account's bill was never read for B
        summary = await _summary(admin_b)
        assert summary["vendors"][0]["status"] == "not_linked"

    async def test_a_linked_role_serves_another_tenant(
        self, async_db_session, admin_b, ce, _clock_and_vault
    ) -> None:
        from app.models.overview import Vendor
        from app.spend.collect import collect_vendor
        from app.spend.credentials import secret_name

        _clock_and_vault.values[secret_name(TENANT_B, "aws_cost_explorer")] = (
            json.dumps(
                {"role_arn": "arn:aws:iam::210987654321:role/r", "external_id": "x"}
            )
        )
        vendor_id = await _vendor(admin_b, "AWS", "aws_cost_explorer")
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        assert await collect_vendor(async_db_session, vendor, NOW) == "ok"
        assert ce[0][0] == "secret"

    async def test_unset_pin_disables_the_arm(self, monkeypatch) -> None:
        from app.core.config import settings
        from app.spend import credentials

        monkeypatch.setattr(settings, "SPEND_AWS_TASK_ROLE_TENANT_ID", None)
        assert not credentials.task_role_serves(TENANT_A, "aws_cost_explorer")
        assert (await credentials.status(TENANT_A, "aws_cost_explorer")).status == (
            "not_linked"
        )


# ===========================================================================
# Phase 9 — the no-money connectors' effects
# ===========================================================================


async def _ingest_raw(
    db: AsyncSession, vendor_id: str, connector: str, raw: Any
) -> Any:
    from app.models.overview import Vendor
    from app.spend.connectors import IngestQuery
    from app.spend.ingest import ingest_payload

    vendor = await db.get(Vendor, UUID(vendor_id))
    result = await ingest_payload(
        db,
        tenant_id=TENANT_A,
        vendor=vendor,
        connector=connector,
        query=IngestQuery(2026, 10, 3),
        raw=raw,
        source="test",
        transport="pull",
    )
    await db.commit()
    return result


class TestNoMoneyConnectors:
    async def test_workspace_seats_warn_and_never_write_money(
        self, async_db_session, admin
    ) -> None:
        from app.models.overview import CostEntry

        vendor_id = await _vendor(
            admin, "Google Workspace", "google_workspace_seats", "saas"
        )
        resp = await admin.post(
            f"{SPEND}/recurring-costs",
            json={
                "vendor_id": vendor_id,
                "description": "Workspace Business Starter",
                "unit_amount_micros": 21_600_000,
                "currency": "USD",
                "cadence": "monthly",
                "start_date": "2026-09-01",
                "source_note": "3 seats, invoice 2026-09",
            },
        )
        assert resp.status_code == 201, resp.text
        raw = json.loads(
            (
                FIXTURES / "google_workspace_license_assignments_documented.json"
            ).read_text()
        )
        result = await _ingest_raw(
            async_db_session, vendor_id, "google_workspace_seats", raw
        )
        assert result.status == "ok"
        assert (
            await async_db_session.scalar(
                select(CostEntry.id).where(
                    CostEntry.vendor_id == UUID(vendor_id),
                    CostEntry.source == "connector",
                )
            )
        ) is None
        summary = await _summary(admin, **{"from": "2026-10-01", "to": "2026-10-03"})
        v = summary["vendors"][0]
        assert v["status"] == "manual"  # the money is the recurring entry
        assert v["connector_status"] == "ok"
        assert any("Seats changed" in w and "4 assigned" in w for w in v["warnings"])
        assert v["month_to_date_micros"] is not None  # recurring, known

    async def test_namecheap_keeps_renewal_dates_and_warns(
        self, async_db_session, admin
    ) -> None:
        from app.models.overview import ChangeLog, RecurringCost

        vendor_id = await _vendor(admin, "Namecheap", "namecheap_domains", "saas")
        resp = await admin.post(
            f"{SPEND}/recurring-costs",
            json={
                "vendor_id": vendor_id,
                "description": "example.io renewal",
                "unit_amount_micros": 35_980_000,
                "currency": "USD",
                "cadence": "annual",
                "start_date": "2024-11-02",
                "external_ref": "EXAMPLE.io",
            },
        )
        assert resp.status_code == 201, resp.text
        entry_id = UUID(resp.json()["item"]["id"])
        xml = (FIXTURES / "namecheap_domains_getlist_documented.xml").read_text()
        result = await _ingest_raw(
            async_db_session, vendor_id, "namecheap_domains", {"xml": xml}
        )
        assert result.status == "ok"
        entry = await async_db_session.get(RecurringCost, entry_id)
        await async_db_session.refresh(entry)
        assert entry.renews_on == date(2026, 11, 2)
        assert entry.auto_renew is False
        assert entry.version == 2
        logged = await async_db_session.scalar(
            select(ChangeLog).where(
                ChangeLog.resource == "recurring_costs",
                ChangeLog.record_id == str(entry_id),
                ChangeLog.action == "update",
            )
        )
        assert logged is not None and logged.source == "import"

        renewals = await admin.get(f"{SPEND}/renewals", params={"days": 60})
        row = next(r for r in renewals.json()["renewals"] if r["id"] == str(entry_id))
        assert row["renews_on"] == "2026-11-02"
        assert row["auto_renew"] is False

        summary = await _summary(admin)
        warnings = summary["vendors"][0]["warnings"]
        assert any("example.io" in w and "AutoRenew is OFF" in w for w in warnings)
        assert any("example.com" in w and "no recurring cost" in w for w in warnings)

        # A second identical read changes nothing (no new version, no new row).
        await _ingest_raw(
            async_db_session, vendor_id, "namecheap_domains", {"xml": xml}
        )
        await async_db_session.refresh(entry)
        assert entry.version == 2


# ===========================================================================
# Review round: escape paths, issued ExternalId, duplicates, push vs pull
# ===========================================================================


class TestReviewRound:
    async def test_a_crashing_validate_is_422_and_value_free(
        self, admin, monkeypatch, _clock_and_vault, caplog
    ) -> None:
        from app.spend.connectors import CONNECTORS

        async def boom(credential, config):
            raise RuntimeError(f"leaky {credential['token']}")

        object.__setattr__(CONNECTORS["vercel_billing"], "validate", boom)
        try:
            resp = await admin.put(
                f"{SPEND}/connectors/vercel_billing/credential",
                json={"credential": {"token": SENTINEL, "team_id": "t"}},
            )
        finally:
            from app.spend.connectors import vercel_billing

            object.__setattr__(
                CONNECTORS["vercel_billing"], "validate", vercel_billing.validate
            )
        assert resp.status_code == 422
        assert resp.json()["reason"] == "provider_error"
        assert SENTINEL not in resp.text
        assert SENTINEL not in caplog.text
        assert _clock_and_vault.values == {}

    async def test_a_non_ascii_character_is_refused_by_field_name(
        self, admin, provider, _clock_and_vault
    ) -> None:
        calls = provider(_github_ok)
        resp = await admin.put(
            f"{SPEND}/connectors/github_billing/credential",
            json={"credential": {"token": SENTINEL + "​", "org": "o"}},
        )
        assert resp.status_code == 422
        assert "token" in resp.json()["message"]
        assert SENTINEL not in resp.text
        assert calls == []

    async def test_aws_link_stores_the_issued_external_id(
        self, admin, monkeypatch, _clock_and_vault
    ) -> None:
        from app.spend.connectors import aws_cost_explorer as aws
        from app.spend.credentials import secret_name

        seen: list[dict[str, Any]] = []
        monkeypatch.setattr(
            aws, "_read", lambda c, arm, s, e: seen.append(dict(c)) or {}
        )
        listing = await admin.get(f"{SPEND}/connectors")
        issued = next(
            c for c in listing.json()["connectors"] if c["key"] == "aws_cost_explorer"
        )["issued"]
        assert issued == {"external_id": aws.external_id_for(TENANT_A)}
        chosen = await admin.put(
            f"{SPEND}/connectors/aws_cost_explorer/credential",
            json={
                "credential": {
                    "role_arn": "arn:aws:iam::210987654321:role/qontinui-spend-r",
                    "external_id": "i-choose-this",
                }
            },
        )
        assert chosen.status_code == 422  # not a field the tenant may send
        resp = await admin.put(
            f"{SPEND}/connectors/aws_cost_explorer/credential",
            json={
                "credential": {
                    "role_arn": "arn:aws:iam::210987654321:role/qontinui-spend-r"
                }
            },
        )
        assert resp.status_code == 200, resp.text
        assert seen[-1]["external_id"] == issued["external_id"]
        stored = json.loads(
            _clock_and_vault.values[secret_name(TENANT_A, "aws_cost_explorer")]
        )
        assert stored["external_id"] == issued["external_id"]

    async def test_only_the_oldest_vendor_per_connector_is_pulled(
        self, async_db_session, admin, provider, _clock_and_vault
    ) -> None:
        from contextlib import asynccontextmanager

        from app.models.overview import CostImportRun
        from app.spend import collect
        from app.spend.credentials import secret_name

        first = await _vendor(
            admin, "GitHub", "github_billing", "source_hosting", {"org": "o"}
        )
        second = await _vendor(
            admin, "GitHub again", "github_billing", "source_hosting", {"org": "o"}
        )
        _clock_and_vault.values[secret_name(TENANT_A, "github_billing")] = json.dumps(
            {"token": SENTINEL, "org": "o"}
        )
        provider(_github_ok)

        @asynccontextmanager
        async def factory():
            yield async_db_session

        result = await collect.collect_all_tenants(
            session_factory=factory, now=NOW, evaluate=False
        )
        assert result["ok"] == 1 and result["skipped"] == 1
        pulled = set(
            (await async_db_session.execute(select(CostImportRun.vendor_id))).scalars()
        )
        assert pulled == {UUID(first)}
        assert UUID(second) not in pulled

    async def test_a_pushed_namecheap_payload_changes_no_recurring_cost(
        self, async_db_session, admin
    ) -> None:
        from app.models.overview import RecurringCost, Vendor
        from app.spend.connectors import IngestQuery
        from app.spend.ingest import ingest_payload

        vendor_id = await _vendor(admin, "Namecheap", "namecheap_domains", "saas")
        resp = await admin.post(
            f"{SPEND}/recurring-costs",
            json={
                "vendor_id": vendor_id,
                "description": "example.io",
                "unit_amount_micros": 1,
                "currency": "USD",
                "cadence": "annual",
                "start_date": "2024-11-02",
                "external_ref": "example.io",
            },
        )
        entry_id = UUID(resp.json()["item"]["id"])
        xml = (FIXTURES / "namecheap_domains_getlist_documented.xml").read_text()
        vendor = await async_db_session.get(Vendor, UUID(vendor_id))
        result = await ingest_payload(
            async_db_session,
            tenant_id=TENANT_A,
            vendor=vendor,
            connector="namecheap_domains",
            query=IngestQuery(2026, 10, 3),
            raw={"xml": xml},
            source="import_token:x",
            transport="push",
        )
        await async_db_session.commit()
        assert result.status == "ok"
        entry = await async_db_session.get(RecurringCost, entry_id)
        await async_db_session.refresh(entry)
        assert entry.renews_on is None and entry.auto_renew is None
        assert entry.version == 1
