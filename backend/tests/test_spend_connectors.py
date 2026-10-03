"""Provider-reported spend, Phases 8–9: the token-linked connectors, pure.

Plan ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``.
No database and no network: every normaliser runs over a fixture built from
the provider's DOCUMENTED response shape (``tests/fixtures/spend/*_documented*``
— keys as documented, values invented, NOT captured), and every fetch/validate
runs against an ``httpx.MockTransport`` or a fake boto3. What this file pins:

* each normaliser turns its provider's statement into entries whose net is the
  provider's billed figure — no estimate, no derived price — with the plan's
  ``source_ref`` shape, and refuses a payload that does not state what it
  claims (a missing day is never $0);
* the two no-money connectors (Workspace seats, Namecheap domains) write no
  entry and report facts and warnings;
* each fetch calls exactly the documented endpoint with the credential in a
  header or body — never in a URL — and maps a refusal to a typed reason;
* the AWS task-role arm reads with the task role, the linked arm assumes the
  tenant's role with its ExternalId.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
import pytest

from app.spend.connectors import (
    CONNECTORS,
    CredentialRejected,
    FetchContext,
    IngestQuery,
    NormaliseError,
    _http,
)

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures" / "spend"
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
SENTINEL = "SENTINEL-c0ffee-7d1f-not-a-real-key"


def _load(name: str) -> Any:
    path = FIXTURES / name
    if path.suffix == ".xml":
        return path.read_text()
    return json.loads(path.read_text())


def _range(start: date, end: date) -> IngestQuery:
    return IngestQuery.for_range(start, end)


def _ctx(
    credential: dict[str, Any], last: date | None = None, **kw: Any
) -> FetchContext:
    return FetchContext(
        tenant_id=uuid4(),
        credential=credential,
        config=kw.pop("config", {}),
        now=NOW,
        last_pulled_day=last,
        **kw,
    )


@pytest.fixture()
def mock_http(monkeypatch: pytest.MonkeyPatch):
    """Route every connector HTTP call to a handler the test installs."""
    calls: list[httpx.Request] = []
    state: dict[str, Any] = {"handler": None}

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


def _assert_no_secret_in_urls(calls: list[httpx.Request]) -> None:
    for request in calls:
        assert SENTINEL not in str(request.url)


# ===========================================================================
# The registry
# ===========================================================================


class TestRegistry:
    async def test_every_connector_is_linkable_and_declares_its_lag(self) -> None:
        expected = {
            "github_billing": 24,
            "aws_cost_explorer": 48,
            "vercel_billing": 48,
            "cloudflare_billing": 48,
            "anthropic_cost_report": 24,
            "google_play_earnings": 24 * 35,
            "google_workspace_seats": 24,
            "upstash_billing": 24,
            "namecheap_domains": 24,
        }
        assert {k: s.expected_lag_hours for k, s in CONNECTORS.items()} == expected
        for spec in CONNECTORS.values():
            assert spec.normalise is not None, spec.key
            assert spec.fetch is not None, spec.key
            assert spec.validate is not None, spec.key
            assert spec.credential_fields, spec.key
            assert spec.credential_help, spec.key
            # Something must be kept secret — except AWS, whose cross-account
            # arm holds a role ARN plus an ExternalId the SERVER issues.
            assert any(f.secret for f in spec.credential_fields) or (
                spec.issued_fields is not None
            ), spec.key

    async def test_no_money_connectors_and_spike_opt_outs(self) -> None:
        assert {k for k, s in CONNECTORS.items() if not s.produces_money} == {
            "google_workspace_seats",
            "namecheap_domains",
        }
        assert {k for k, s in CONNECTORS.items() if not s.spike_rule} == {
            "google_play_earnings",
            "google_workspace_seats",
            "namecheap_domains",
        }
        assert CONNECTORS["aws_cost_explorer"].complete_lag_days == 2
        assert CONNECTORS["vercel_billing"].complete_lag_days == 2
        assert CONNECTORS["aws_cost_explorer"].min_pull_interval_hours == 12


# ===========================================================================
# AWS Cost Explorer (Phase 8)
# ===========================================================================


class TestAwsCostExplorer:
    async def test_range_statement_net_gross_discount_and_refs(self) -> None:
        from app.spend.connectors.aws_cost_explorer import normalise

        raw = _load("aws_ce_range_documented.json")
        batch = normalise(raw, _range(date(2026, 9, 30), date(2026, 10, 2)), {})
        assert batch.granularity == "range"
        assert (batch.period_start, batch.period_end) == (
            date(2026, 9, 30),
            date(2026, 10, 2),
        )
        by_ref = {e.source_ref: e for e in batch.entries}
        rds = by_ref["aws:123456789012:2026-09-30:Amazon Relational Database Service"]
        assert rds.amount_micros == 3_900_000  # NetUnblendedCost
        assert rds.gross_micros == 4_100_000  # UnblendedCost
        assert rds.discount_micros == 200_000
        assert rds.scope_label == "Amazon Relational Database Service"
        assert (
            by_ref["aws:123456789012:2026-09-30:AWS Secrets Manager"].amount_micros
            == 40_000
        )
        assert len(batch.entries) == 5
        # One per-day prefix, so a day re-pulled drops a vanished service —
        # including 10-02, which stated no service at all.
        assert [batch.ref_prefix, *batch.extra_ref_prefixes] == [
            "aws:123456789012:2026-09-30:",
            "aws:123456789012:2026-10-01:",
            "aws:123456789012:2026-10-02:",
        ]

    async def test_a_missing_day_is_refused_not_zero(self) -> None:
        from app.spend.connectors.aws_cost_explorer import normalise

        raw = _load("aws_ce_range_documented.json")
        raw["ResultsByTime"].pop(1)
        with pytest.raises(NormaliseError, match="2026-10-01"):
            normalise(raw, _range(date(2026, 9, 30), date(2026, 10, 2)), {})

    async def test_refusals(self) -> None:
        from app.spend.connectors.aws_cost_explorer import normalise

        raw = _load("aws_ce_range_documented.json")
        with pytest.raises(NormaliseError, match="month"):
            normalise(raw, IngestQuery(2026, 10), {})
        with pytest.raises(NormaliseError, match="outside"):
            normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 2)), {})
        with pytest.raises(NormaliseError, match="account"):
            normalise(
                raw,
                _range(date(2026, 9, 30), date(2026, 10, 2)),
                {"account_id": "999999999999"},
            )
        with pytest.raises(NormaliseError, match="ResultsByTime"):
            normalise({"x": 1}, _range(date(2026, 9, 30), date(2026, 9, 30)), {})

    async def test_task_role_arm_backfills_90_days_then_trails_3(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.spend.connectors import aws_cost_explorer as aws

        seen: list[tuple[Any, ...]] = []

        def fake_read(credential, arm, start, end_exclusive):
            seen.append((dict(credential), arm, start, end_exclusive))
            return {"account_id": "123456789012", "ResultsByTime": []}

        monkeypatch.setattr(aws, "_read", fake_read)
        first = await aws.fetch(_ctx({}, None, arm="task_role"))
        assert seen[-1] == ({}, "task_role", date(2026, 7, 5), date(2026, 10, 3))
        assert first[0].query.days() == (date(2026, 7, 5), date(2026, 10, 2))
        later = await aws.fetch(_ctx({}, date(2026, 10, 2), arm="task_role"))
        assert seen[-1][2:] == (date(2026, 9, 30), date(2026, 10, 3))
        assert later[0].query.days() == (date(2026, 9, 30), date(2026, 10, 2))

    @staticmethod
    def _fake_boto(monkeypatch: pytest.MonkeyPatch, hosting: str = "047700000000"):
        import boto3

        record: dict[str, list[dict[str, Any]]] = {"assumed": [], "ce": []}

        class FakeSts:
            def get_caller_identity(self) -> dict[str, str]:
                return {"Account": hosting}

            def assume_role(self, **kw: Any) -> dict[str, Any]:
                record["assumed"].append(kw)
                return {
                    "Credentials": {
                        "AccessKeyId": "AKIAEXAMPLE",
                        "SecretAccessKey": SENTINEL,
                        "SessionToken": "tok",
                    }
                }

        class FakeCe:
            def get_cost_and_usage(self, **kw: Any) -> dict[str, Any]:
                record["ce"].append(kw)
                if "NextPageToken" not in kw:
                    return {"ResultsByTime": [{"a": 1}], "NextPageToken": "p2"}
                return {"ResultsByTime": [{"b": 2}]}

        class FakeSession:
            def __init__(self, **kw: Any) -> None:
                self.kw = kw

            def client(self, name: str, **kw: Any) -> Any:
                if name == "sts":
                    return FakeSts()
                assert name == "ce"
                assert kw["region_name"] == "us-east-1"
                return FakeCe()

        def no_default_session(*a: Any, **kw: Any) -> Any:
            raise AssertionError("the thread-unsafe default session was used")

        monkeypatch.setattr(boto3, "client", no_default_session)
        monkeypatch.setattr(boto3.session, "Session", FakeSession)
        return record

    async def test_linked_arm_assumes_the_tenant_role_with_external_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.spend.connectors import aws_cost_explorer as aws

        record = self._fake_boto(monkeypatch)
        raw = aws._read(
            {
                "role_arn": "arn:aws:iam::210987654321:role/qontinui-spend-reader",
                "external_id": "qontinui-abc",
            },
            "secret",
            date(2026, 10, 1),
            date(2026, 10, 3),
        )
        assert raw == {
            "account_id": "210987654321",
            "ResultsByTime": [{"a": 1}, {"b": 2}],
        }
        assumed = record["assumed"][0]
        assert assumed["RoleArn"] == (
            "arn:aws:iam::210987654321:role/qontinui-spend-reader"
        )
        assert assumed["ExternalId"] == "qontinui-abc"
        ce_calls = record["ce"]
        assert ce_calls[0]["Granularity"] == "DAILY"
        assert ce_calls[0]["Metrics"] == ["UnblendedCost", "NetUnblendedCost"]
        assert ce_calls[0]["GroupBy"] == [{"Type": "DIMENSION", "Key": "SERVICE"}]
        assert ce_calls[0]["TimePeriod"] == {"Start": "2026-10-01", "End": "2026-10-03"}

    async def test_a_role_in_the_hosting_account_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.spend.connectors import aws_cost_explorer as aws

        record = self._fake_boto(monkeypatch, hosting="047719635665")
        with pytest.raises(CredentialRejected) as caught:
            aws._read(
                {
                    "role_arn": "arn:aws:iam::047719635665:role/qontinui-spend-x",
                    "external_id": "e",
                },
                "secret",
                date(2026, 10, 1),
                date(2026, 10, 2),
            )
        assert caught.value.reason == "forbidden"
        assert record["assumed"] == []

    async def test_a_role_outside_the_granted_name_is_refused(self) -> None:
        from app.spend.connectors import aws_cost_explorer as aws

        with pytest.raises(CredentialRejected, match="qontinui-spend-"):
            aws._read(
                {
                    "role_arn": "arn:aws:iam::210987654321:role/Admin",
                    "external_id": "e",
                },
                "secret",
                date(2026, 10, 1),
                date(2026, 10, 2),
            )

    async def test_the_external_id_is_issued_per_tenant(self) -> None:
        from app.spend.connectors.aws_cost_explorer import SPEC, external_id_for

        a, b = uuid4(), uuid4()
        assert external_id_for(a) == external_id_for(a)
        assert external_id_for(a) != external_id_for(b)
        assert external_id_for(a).startswith("qontinui-")
        # Never a form field: the tenant cannot choose it.
        assert "external_id" not in {f.name for f in SPEC.credential_fields}
        assert SPEC.issued_fields is not None
        assert SPEC.issued_fields(a) == {"external_id": external_id_for(a)}

    async def test_a_gap_left_by_failed_pulls_is_refetched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.spend.connectors import aws_cost_explorer as aws

        seen: list[date] = []

        def fake_read(credential, arm, start, end_exclusive):
            seen.append(start)
            return {"account_id": "123456789012", "ResultsByTime": []}

        monkeypatch.setattr(aws, "_read", fake_read)
        await aws.fetch(_ctx({}, date(2026, 9, 20), arm="task_role"))
        assert seen[-1] == date(2026, 9, 18)  # two before the last pulled day

    async def test_a_bad_role_arn_is_a_typed_refusal(self) -> None:
        from app.spend.connectors import aws_cost_explorer as aws

        with pytest.raises(CredentialRejected) as caught:
            aws._read(
                {"role_arn": "not-an-arn", "external_id": "x"},
                "secret",
                date(2026, 10, 1),
                date(2026, 10, 2),
            )
        assert caught.value.reason == "invalid_credential"

    async def test_boto_errors_are_typed(self) -> None:
        from botocore.exceptions import ClientError, NoCredentialsError

        from app.spend.connectors.aws_cost_explorer import _reject_from_boto

        denied = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": SENTINEL}},
            "GetCostAndUsage",
        )
        rejected = _reject_from_boto(denied)
        assert rejected.reason == "forbidden"
        assert SENTINEL not in str(rejected)
        assert _reject_from_boto(NoCredentialsError()).reason == "not_configured"


# ===========================================================================
# Vercel
# ===========================================================================


class TestVercel:
    async def test_focus_lines_billed_cost_is_net(self) -> None:
        from app.spend.connectors.vercel_billing import normalise

        raw = _load("vercel_charges_documented.json")
        batch = normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 2)), {})
        by_ref = {e.source_ref: e for e in batch.entries}
        transfer = by_ref[
            "vercel:team_exampleTeam123:2026-10-01:Fast Data Transfer:Fast Data Transfer"
        ]
        assert transfer.amount_micros == 2_000_000  # 1.25 + 0.75 BilledCost
        assert transfer.gross_micros == 2_400_000  # ListCost
        assert transfer.discount_micros == 400_000
        assert transfer.quantity == Decimal("20.0")
        functions = by_ref[
            "vercel:team_exampleTeam123:2026-10-02:Serverless Functions:"
            "Function Invocations"
        ]
        assert functions.amount_micros == 400_000
        assert functions.gross_micros is None  # no ListCost: not reported
        assert batch.items_seen == 3

    async def test_a_record_outside_the_range_is_not_stored(self) -> None:
        from app.spend.connectors.vercel_billing import normalise

        raw = _load("vercel_charges_documented.json")
        batch = normalise(raw, IngestQuery(2026, 10, 2), {})
        assert len(batch.entries) == 1
        assert "outside" in batch.notices[0]

    async def test_fetch_sends_the_token_as_a_header_only(self, mock_http) -> None:
        from app.spend.connectors.vercel_billing import fetch

        body = _load("vercel_charges_documented.json")["jsonl"]
        calls = mock_http(lambda r: httpx.Response(200, text=body))
        pulls = await fetch(
            _ctx({"token": SENTINEL, "team_id": "team_x"}, date(2026, 10, 2))
        )
        assert calls[0].url.host == "api.vercel.com"
        assert calls[0].url.path == "/v1/billing/charges"
        assert calls[0].url.params["teamId"] == "team_x"
        # Re-reads the last three days whatever was pulled last.
        assert calls[0].url.params["from"] == "2026-10-01T00:00:00.000Z"
        assert calls[0].headers["authorization"] == f"Bearer {SENTINEL}"
        _assert_no_secret_in_urls(calls)
        assert pulls[0].query.days() == (date(2026, 10, 1), date(2026, 10, 3))

    async def test_a_refusal_is_typed_and_value_free(self, mock_http) -> None:
        from app.spend.connectors.vercel_billing import validate

        mock_http(lambda r: httpx.Response(403, text=f"bad token {SENTINEL}"))
        with pytest.raises(CredentialRejected) as caught:
            await validate({"token": SENTINEL, "team_id": "team_x"}, {})
        assert caught.value.reason == "forbidden"
        assert SENTINEL not in str(caught.value)


# ===========================================================================
# Cloudflare
# ===========================================================================


class TestCloudflare:
    async def test_history_items_dated_to_their_day_refund_negative(self) -> None:
        from app.spend.connectors.cloudflare_billing import normalise

        raw = _load("cloudflare_billing_history_documented.json")
        batch = normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 3)), {})
        amounts = {
            e.source_ref.rsplit(":", 1)[1]: e.amount_micros for e in batch.entries
        }
        assert amounts == {
            "b69a9f3492637782896352daae219e7d": 5_000_000,
            "a1b2c3d4e5f60718293a4b5c6d7e8f90": 20_990_000,
            "c0ffee00c0ffee00c0ffee00c0ffee00": -2_500_000,
        }
        zone = next(e for e in batch.entries if e.amount_micros == 5_000_000)
        assert zone.scope_label == "example.com"
        assert zone.period_start == date(2026, 10, 1)

    async def test_success_false_is_refused(self) -> None:
        from app.spend.connectors.cloudflare_billing import normalise

        raw = _load("cloudflare_billing_history_documented.json")
        raw["success"] = False
        with pytest.raises(NormaliseError, match="success"):
            normalise(raw, IngestQuery(2026, 10, 1), {})

    async def test_fetch_pages_until_older_than_the_window(self, mock_http) -> None:
        from app.spend.connectors import cloudflare_billing as cf

        raw = _load("cloudflare_billing_history_documented.json")
        calls = mock_http(
            lambda r: httpx.Response(
                200, json={"success": True, "result": raw["result"]}
            )
        )
        pulls = await cf.fetch(
            _ctx({"token": SENTINEL, "account_id": "acc1"}, date(2026, 10, 2))
        )
        assert len(calls) == 1  # 4 items < per_page: the last page
        assert calls[0].url.path == "/client/v4/accounts/acc1/billing/history"
        assert calls[0].headers["authorization"] == f"Bearer {SENTINEL}"
        _assert_no_secret_in_urls(calls)
        assert pulls[0].raw["account_id"] == "acc1"


# ===========================================================================
# Anthropic
# ===========================================================================


class TestAnthropic:
    async def test_cents_strings_become_exact_micros(self) -> None:
        from app.spend.connectors.anthropic_cost_report import normalise

        raw = _load("anthropic_cost_report_documented.json")
        batch = normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 2)), {})
        by_ref = {e.source_ref: e for e in batch.entries}
        inp = by_ref[
            "anthropic:2026-10-01:wrkspc_01Example:Claude Sonnet Usage - Input Tokens"
        ]
        assert inp.amount_micros == 1_234_500  # "123.45" cents = $1.2345
        assert (
            by_ref["anthropic:2026-10-01:default:Web Search Usage"].amount_micros
            == 5_000
        )
        assert sum(e.amount_micros for e in batch.entries) == 1_334_500 + 5_000
        # 10-02 stated no result: a real $0 for that day, and its prefix is
        # there so a vanished line is dropped.
        assert "anthropic:2026-10-02:" in batch.extra_ref_prefixes

    async def test_a_missing_daily_bucket_is_refused_and_a_trailing_one_unclaimed(
        self,
    ) -> None:
        from app.spend.connectors.anthropic_cost_report import normalise

        raw = _load("anthropic_cost_report_documented.json")
        # 10-03 not in the report yet: the run states 10-01..10-02 only.
        batch = normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 3)), {})
        assert batch.period_end == date(2026, 10, 2)
        raw["data"].pop(0)
        with pytest.raises(NormaliseError, match="2026-10-01"):
            normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 2)), {})

    async def test_a_currency_it_cannot_scale_is_refused(self) -> None:
        from app.spend.connectors.anthropic_cost_report import normalise

        raw = _load("anthropic_cost_report_documented.json")
        raw["data"][0]["results"][0]["currency"] = "JPY"
        with pytest.raises(NormaliseError, match="JPY"):
            normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 2)), {})

    async def test_fetch_pages_and_sends_admin_key_and_version(self, mock_http) -> None:
        from app.spend.connectors.anthropic_cost_report import fetch

        raw = _load("anthropic_cost_report_documented.json")
        pages = [
            {"data": raw["data"][:1], "has_more": True, "next_page": "page_2"},
            {"data": raw["data"][1:], "has_more": False, "next_page": None},
        ]
        calls = mock_http(lambda r: httpx.Response(200, json=pages[len(calls) - 1]))
        pulls = await fetch(_ctx({"api_key": SENTINEL}, date(2026, 10, 2)))
        assert len(calls) == 2
        assert calls[0].headers["x-api-key"] == SENTINEL
        assert calls[0].headers["anthropic-version"] == "2023-06-01"
        assert calls[0].url.path == "/v1/organizations/cost_report"
        assert calls[0].url.params.get_list("group_by[]") == [
            "workspace_id",
            "description",
        ]
        assert calls[1].url.params["page"] == "page_2"
        _assert_no_secret_in_urls(calls)
        assert len(pulls[0].raw["data"]) == 2


# ===========================================================================
# Upstash
# ===========================================================================


class TestUpstash:
    async def test_daily_billing_is_the_provider_figure(self) -> None:
        from app.spend.connectors.upstash_billing import normalise

        raw = _load("upstash_redis_stats_documented.json")
        batch = normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 3)), {})
        by_ref = {e.source_ref: e.amount_micros for e in batch.entries}
        rid = "6a4e2ccf-0000-4000-8000-000000000001"
        assert by_ref[f"upstash:redis:{rid}:2026-10-02"] == 345_600
        assert by_ref["upstash:qstash:qstash:2026-10-01"] == 10_000  # epoch-ms x
        assert by_ref["upstash:qstash:qstash:2026-10-02"] == 0
        assert batch.facts["total_monthly_billing"][f"redis:{rid}"] == 0.5156

    async def test_the_run_is_clipped_to_the_days_the_series_states(self) -> None:
        from app.spend.connectors.upstash_billing import normalise

        raw = _load("upstash_redis_stats_documented.json")
        batch = normalise(raw, _range(date(2026, 9, 25), date(2026, 10, 3)), {})
        # 09-25..09-30 are in no series, and QStash states nothing for 10-03:
        # the run claims only the days EVERY resource states.
        assert (batch.period_start, batch.period_end) == (
            date(2026, 10, 1),
            date(2026, 10, 2),
        )
        assert all(e.period_start <= date(2026, 10, 2) for e in batch.entries)

    async def test_a_resource_silent_on_a_day_inside_the_span_is_refused(
        self,
    ) -> None:
        from app.spend.connectors.upstash_billing import normalise

        raw = _load("upstash_redis_stats_documented.json")
        raw["resources"][0]["stats"]["dailybilling"].pop(1)  # redis skips 10-02
        with pytest.raises(NormaliseError, match="2026-10-02"):
            normalise(raw, _range(date(2026, 10, 1), date(2026, 10, 3)), {})

    async def test_fetch_basic_auth_and_a_missing_qstash(self, mock_http) -> None:
        from app.spend.connectors.upstash_billing import fetch

        stats = _load("upstash_redis_stats_documented.json")["resources"][0]["stats"]

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/v2/redis/databases":
                return httpx.Response(
                    200, json=[{"database_id": "db1", "database_name": "cache"}]
                )
            if request.url.path == "/v2/redis/stats/db1":
                return httpx.Response(200, json=stats)
            return httpx.Response(404, json={"error": "not found"})

        calls = mock_http(handler)
        pulls = await fetch(_ctx({"email": "ops@example.com", "api_key": SENTINEL}))
        assert [c.url.path for c in calls] == [
            "/v2/redis/databases",
            "/v2/redis/stats/db1",
            "/v2/qstash/stats",
        ]
        assert calls[0].headers["authorization"].startswith("Basic ")
        _assert_no_secret_in_urls(calls)
        assert [r["type"] for r in pulls[0].raw["resources"]] == ["redis"]
        assert pulls[0].query.days() == (date(2026, 10, 1), date(2026, 10, 3))


# ===========================================================================
# Google Play
# ===========================================================================


class TestGooglePlay:
    async def test_fees_and_refunds_only_revenue_as_context(self) -> None:
        from app.spend.connectors.google_play_earnings import normalise

        raw = _load("google_play_earnings_documented.json")
        batch = normalise(raw, _range(date(2026, 9, 1), date(2026, 9, 30)), {})
        by_type = {e.sku: e.amount_micros for e in batch.entries}
        assert by_type == {
            "Google fee": 3_120_000,  # 1.50 + 1.62, negated developer-side
            "Google fee refund": -1_620_000,
        }
        assert all(e.period_start == date(2026, 9, 1) for e in batch.entries)
        assert batch.entries[0].source_ref.startswith(
            "play:01234567890123456789:202609:"
        )
        # Revenue and its refunds are context, never spend; tax ignored.
        assert batch.facts["revenue_micros"] == {"USD": 9_990_000}
        assert "context, not spend" in batch.notices[0]

    async def test_a_month_with_no_report_is_unknown(self) -> None:
        from app.spend.connectors.google_play_earnings import normalise

        raw = _load("google_play_earnings_documented.json")
        raw["files"] = []
        with pytest.raises(NormaliseError, match="UNKNOWN"):
            normalise(raw, _range(date(2026, 9, 1), date(2026, 9, 30)), {})

    async def test_fetch_reads_the_zipped_report_with_a_service_account(
        self, mock_http
    ) -> None:
        import io
        import zipfile

        from app.spend.connectors import google_play_earnings as play

        csv_text = _load("google_play_earnings_documented.json")["files"][0]["csv"]
        blob = io.BytesIO()
        with zipfile.ZipFile(blob, "w") as archive:
            archive.writestr("PlayApps_202609.csv", csv_text)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "oauth2.googleapis.com":
                form = parse_qs(request.content.decode())
                assert form["grant_type"] == [
                    "urn:ietf:params:oauth:grant-type:jwt-bearer"
                ]
                return httpx.Response(200, json={"access_token": "at-1"})
            assert request.headers["authorization"] == "Bearer at-1"
            if request.url.params.get("alt") == "media":
                return httpx.Response(200, content=blob.getvalue())
            prefix = request.url.params["prefix"]
            if prefix == "earnings/earnings_202609":
                return httpx.Response(
                    200, json={"items": [{"name": "earnings/earnings_202609_1-0.zip"}]}
                )
            return httpx.Response(200, json={})

        calls = mock_http(handler)
        pulls = await play.fetch(
            _ctx(
                {
                    "service_account_json": _service_account_json(),
                    "bucket": "gs://pubsite_prod_rev_01234567890123456789/",
                },
                date(2026, 9, 30),
            )
        )
        # Two months asked; only September published.
        assert len(pulls) == 1
        assert pulls[0].raw["developer_id"] == "01234567890123456789"
        assert pulls[0].query.days() == (date(2026, 9, 1), date(2026, 9, 30))
        batch = play.normalise(pulls[0].raw, pulls[0].query, {})
        assert {e.sku for e in batch.entries} == {"Google fee", "Google fee refund"}
        _assert_no_secret_in_urls(calls)


def _service_account_json() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return json.dumps(
        {
            "type": "service_account",
            "client_email": "reports@example.iam.gserviceaccount.com",
            "private_key": pem,
            "token_uri": "https://evil.example/token",  # never followed
        }
    )


# ===========================================================================
# Google Workspace seats (no money)
# ===========================================================================


class TestWorkspaceSeats:
    async def test_counts_seats_and_writes_no_money(self) -> None:
        from app.spend.connectors.google_workspace_seats import normalise

        raw = _load("google_workspace_license_assignments_documented.json")
        batch = normalise(raw, IngestQuery(2026, 10, 3), {})
        assert batch.entries == []
        assert batch.facts["seats"] == 4
        assert batch.facts["by_sku"] == {"Google Workspace Business Starter": 4}

    async def test_noted_seats(self) -> None:
        from app.spend.connectors.google_workspace_seats import noted_seats

        assert noted_seats("Workspace", "3 seats, Business Starter", Decimal(1)) == 3
        assert noted_seats("Workspace (2 seats)", None, Decimal(1)) == 2
        assert noted_seats("Workspace", None, Decimal(5)) == 5
        assert noted_seats("Workspace", None, Decimal(1)) is None

    async def test_fetch_impersonates_the_admin_and_never_follows_token_uri(
        self, mock_http
    ) -> None:
        import jwt

        from app.spend.connectors.google_workspace_seats import fetch

        raw = _load("google_workspace_license_assignments_documented.json")
        seen: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "oauth2.googleapis.com":
                form = parse_qs(request.content.decode())
                seen["claims"] = jwt.decode(
                    form["assertion"][0], options={"verify_signature": False}
                )
                return httpx.Response(200, json={"access_token": "at-2"})
            assert request.url.host == "licensing.googleapis.com"
            return httpx.Response(200, json={"items": raw["items"]})

        calls = mock_http(handler)
        pulls = await fetch(
            _ctx(
                {
                    "service_account_json": _service_account_json(),
                    "admin_email": "admin@example.com",
                    "customer_id": "C0example",
                }
            )
        )
        assert all(c.url.host != "evil.example" for c in calls)
        assert seen["claims"]["sub"] == "admin@example.com"
        assert (
            seen["claims"]["scope"] == "https://www.googleapis.com/auth/apps.licensing"
        )
        assert calls[1].url.path == "/apps/licensing/v1/product/Google-Apps/users"
        assert calls[1].url.params["customerId"] == "C0example"
        assert len(pulls[0].raw["items"]) == 4

    async def test_a_key_that_is_not_json_is_typed(self) -> None:
        from app.spend.connectors._google import access_token

        with pytest.raises(CredentialRejected) as caught:
            await access_token({"service_account_json": SENTINEL}, scope="x")
        assert caught.value.reason == "invalid_credential"
        assert SENTINEL not in str(caught.value)


# ===========================================================================
# Namecheap (no money)
# ===========================================================================


class TestNamecheap:
    async def test_domains_and_the_autorenew_warning(self) -> None:
        from app.spend.connectors.namecheap_domains import normalise

        xml = _load("namecheap_domains_getlist_documented.xml")
        batch = normalise({"xml": xml}, IngestQuery(2026, 10, 3), {})
        assert batch.entries == []
        domains = {d["name"]: d for d in batch.facts["domains"]}
        assert domains["example.io"] == {
            "name": "example.io",
            "expires": "2026-11-02",
            "auto_renew": False,
            "is_expired": False,
        }
        # example.io: AutoRenew off, 30 days left -> warned. example.dev
        # expires sooner but renews by itself -> not warned.
        assert len(batch.notices) == 1
        assert "example.io" in batch.notices[0]

    async def test_an_error_response_and_a_dtd_are_refused(self) -> None:
        from app.spend.connectors.namecheap_domains import normalise

        error = (
            '<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">'
            '<Errors><Error Number="1011102">API Key is invalid</Error></Errors>'
            "</ApiResponse>"
        )
        with pytest.raises(NormaliseError, match="1011102"):
            normalise({"xml": error}, IngestQuery(2026, 10, 3), {})
        bomb = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "a">]><ApiResponse/>'
        with pytest.raises(NormaliseError, match="DOCTYPE"):
            normalise({"xml": bomb}, IngestQuery(2026, 10, 3), {})

    async def test_the_key_travels_in_the_post_body_never_the_url(
        self, mock_http
    ) -> None:
        from app.spend.connectors.namecheap_domains import fetch

        xml = _load("namecheap_domains_getlist_documented.xml")
        calls = mock_http(lambda r: httpx.Response(200, text=xml))
        pulls = await fetch(
            _ctx(
                {
                    "api_user": "exampleuser",
                    "user_name": "exampleuser",
                    "api_key": SENTINEL,
                    "client_ip": "203.0.113.7",
                }
            )
        )
        assert calls[0].method == "POST"
        _assert_no_secret_in_urls(calls)
        form = parse_qs(calls[0].content.decode())
        assert form["ApiKey"] == [SENTINEL]
        assert form["Command"] == ["namecheap.domains.getList"]
        assert form["ClientIp"] == ["203.0.113.7"]
        assert len(pulls) == 1

    async def test_an_unwhitelisted_ip_is_typed(self, mock_http) -> None:
        from app.spend.connectors.namecheap_domains import validate

        mock_http(
            lambda r: httpx.Response(
                200,
                text=(
                    '<ApiResponse Status="ERROR"><Errors><Error Number="1011150">'
                    "Invalid request IP</Error></Errors></ApiResponse>"
                ),
            )
        )
        with pytest.raises(CredentialRejected) as caught:
            await validate(
                {
                    "api_user": "u",
                    "user_name": "u",
                    "api_key": SENTINEL,
                    "client_ip": "203.0.113.7",
                },
                {},
            )
        assert caught.value.reason == "forbidden"


# ===========================================================================
# GitHub server pull
# ===========================================================================


class TestGithubPull:
    async def test_pulls_each_day_since_the_last_and_a_month_check(
        self, mock_http
    ) -> None:
        from app.spend.connectors.github_billing import fetch

        calls = mock_http(lambda r: httpx.Response(200, json={"usageItems": []}))
        pulls = await fetch(
            _ctx({"token": SENTINEL, "org": "example-org"}, date(2026, 10, 1))
        )
        days = [p.query.day for p in pulls if p.query.is_day]
        # The last pulled day is re-read (it may have been partial), then on.
        assert days == [1, 2, 3]
        assert not pulls[-1].query.is_day  # the reconciliation month query
        assert calls[0].headers["authorization"] == f"Bearer {SENTINEL}"
        assert calls[0].url.path == "/organizations/example-org/settings/billing/usage"
        _assert_no_secret_in_urls(calls)


# ===========================================================================
# The HTTP door and the Sentry backstop
# ===========================================================================


class TestNoValueEscapes:
    async def test_a_header_httpx_cannot_encode_is_a_typed_refusal(
        self, mock_http
    ) -> None:
        from app.spend.connectors.vercel_billing import validate

        mock_http(lambda r: httpx.Response(200, text=""))
        with pytest.raises(CredentialRejected) as caught:
            await validate({"token": SENTINEL + "”", "team_id": "t"}, {})
        assert caught.value.reason == "invalid_credential"
        assert caught.value.__cause__ is None  # no frame with headers chained
        assert SENTINEL not in str(caught.value)

    async def test_sentry_drops_spend_frame_vars_and_credential_bodies(self) -> None:
        from app.core.sentry_config import before_send_filter

        event: dict[str, Any] = {
            "request": {
                "url": "https://api.example/api/v1/overview/spend/connectors/x/credential",
                "data": {"credential": {"token": SENTINEL}},
            },
            "exception": {
                "values": [
                    {
                        "value": "boom",
                        "stacktrace": {
                            "frames": [
                                {
                                    "module": "app.spend.router",
                                    "vars": {"raw": SENTINEL},
                                },
                                {"module": "app.other", "vars": {"x": 1}},
                            ]
                        },
                    }
                ]
            },
        }
        out = before_send_filter(event, {})  # type: ignore[arg-type]
        assert out is not None
        assert SENTINEL not in json.dumps(out)
        assert out["exception"]["values"][0]["stacktrace"]["frames"][1]["vars"] == {
            "x": 1
        }
