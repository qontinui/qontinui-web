"""Tests for ``GET /operations/claude-accounts`` — the Claude account roster proxy.

Plan ``2026-08-25-general-purpose-session-spawn-machine-account-prompt``
Phase 2. The route proxies coord ``GET /coord/claude-accounts/usage`` so the
spawn modal can show *"this machine will use: <mode>"* over that device's
accounts.

The assertions are weighted toward the DEGRADED arms, because the failure
that matters here is not a 500 — it is telling an operator "this machine has
no Claude accounts" when the truth is "coord has not been provisioned to
answer that yet". An absent roster is UNKNOWN, never empty.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

_FIXTURE_TENANT_ID = UUID("11111111-2222-3333-4444-555555555555")
_DEVICE_A = "00000000-0000-0000-0000-deadbeefcafe"
_DEVICE_B = "00000000-0000-0000-0000-feedfacecafe"

API_PREFIX = "/api/v1/operations"


def _build_test_app(*, resolves_tenant: bool = True) -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "tenant.user@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None

    if resolves_tenant:

        async def _resolver() -> UUID:
            return _FIXTURE_TENANT_ID

    else:

        async def _resolver() -> UUID:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_not_resolved",
            )

    test_app.dependency_overrides[get_tenant_id] = _resolver
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=True))


@pytest.fixture()
def unresolved_client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=False))


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _account(device_id: str, label: str, **overrides):
    row = {
        "device_id": device_id,
        "account_label": label,
        "weekly_utilization": 0.34,
        "weekly_resets_at": "2026-08-30T00:00:00Z",
        "session_utilization": 0.11,
        "session_resets_at": "2026-08-25T18:00:00Z",
        "model_limits": [{"model": "Fable", "utilization": 0.2, "resets_at": 0}],
        "exhausted": False,
        "source": "runner",
        "error": False,
        "stale": False,
        "is_active": False,
        "account_selection_mode": "least_usage",
    }
    row.update(overrides)
    return row


def _prepaid(device_id: str, provider: str, **overrides):
    """A coord `prepaid` row. Money is micros — see alembic
    ``coord_prepaid_balances_01``; ``None`` means NOT REPORTED, never zero."""
    row = {
        "device_id": device_id,
        "provider": provider,
        "label": provider.title(),
        "currency": "USD",
        "balance_micros": 19280000,
        "granted_micros": 5000000,
        "topped_up_micros": 14280000,
        "is_available": True,
        "error": None,
        "stale": False,
        "updated_at": "2026-09-12T18:00:00Z",
    }
    row.update(overrides)
    return row


class TestGetClaudeAccounts:
    def test_returns_roster_and_calls_coord_usage_path(self, client: TestClient):
        coord_payload = {
            "accounts": [
                _account(_DEVICE_A, ".claude-gmail", is_active=True),
                _account(_DEVICE_A, ".claude-work"),
            ],
            "table_provisioned": True,
            "columns_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/claude-accounts")

        assert resp.status_code == 200
        body = resp.json()
        assert body["table_provisioned"] is True
        assert body["columns_provisioned"] is True
        assert [a["account_label"] for a in body["accounts"]] == [
            ".claude-gmail",
            ".claude-work",
        ]
        # The selection half of the feed reaches the caller intact — it is
        # the whole point of the route.
        assert body["accounts"][0]["is_active"] is True
        assert body["accounts"][0]["account_selection_mode"] == "least_usage"

        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/claude-accounts/usage")
        # Bearer forwarding is triggered by passing tenant_id.
        assert instance.get.call_args.kwargs.get("headers") is not None

    def test_account_label_never_carries_a_local_path(self, client: TestClient):
        # The ingest contract is explicit that identity on the wire is the
        # config-dir BASENAME. Nothing here may re-expand it.
        coord_payload = {
            "accounts": [_account(_DEVICE_A, ".claude-gmail")],
            "table_provisioned": True,
            "columns_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        label = body["accounts"][0]["account_label"]
        assert "/" not in label and "\\" not in label

    def test_device_id_filter_applied_client_side(self, client: TestClient):
        coord_payload = {
            "accounts": [
                _account(_DEVICE_A, ".claude-gmail"),
                _account(_DEVICE_B, ".claude-other"),
            ],
            "table_provisioned": True,
            "columns_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(
                f"{API_PREFIX}/claude-accounts", params={"device_id": _DEVICE_A}
            ).json()

        assert [a["device_id"] for a in body["accounts"]] == [_DEVICE_A]
        # Coord's route is tenant-scoped and takes no device filter, so we
        # must not have guessed at forwarding one.
        assert instance.get.call_args.kwargs.get("params") is None

    def test_unprovisioned_table_is_unknown_not_empty(self, client: TestClient):
        # The defect this guards: flattening "coord cannot answer" into
        # "this machine has no Claude accounts".
        coord_payload = {
            "accounts": [],
            "table_provisioned": False,
            "columns_provisioned": False,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        assert body["accounts"] == []
        assert body["table_provisioned"] is False
        assert body["columns_provisioned"] is False

    def test_missing_columns_still_serves_usage_rows(self, client: TestClient):
        # Coord deployed ahead of alembic `coord_claude_acct_usage_02`: the
        # usage half is real, the selection half is null.
        coord_payload = {
            "accounts": [
                _account(
                    _DEVICE_A,
                    ".claude-gmail",
                    is_active=None,
                    account_selection_mode=None,
                )
            ],
            "table_provisioned": True,
            "columns_provisioned": False,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        assert body["columns_provisioned"] is False
        assert body["accounts"][0]["weekly_utilization"] == 0.34
        assert body["accounts"][0]["is_active"] is None
        assert body["accounts"][0]["account_selection_mode"] is None

    def test_absent_flags_are_null_never_defaulted_to_true(self, client: TestClient):
        # A coord build predating its own flags: we did not OBSERVE
        # provisioning, so we must not assert it.
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"accounts": [_account(_DEVICE_A, ".claude-gmail")]}
            )
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        assert body["table_provisioned"] is None
        assert body["columns_provisioned"] is None
        assert len(body["accounts"]) == 1

    def test_non_object_payload_is_a_contract_break_not_an_empty_roster(
        self, client: TestClient
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=["nope"])
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/claude-accounts")

        assert resp.status_code == 502

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("nope")
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/claude-accounts")

        assert resp.status_code == 502

    def test_coord_timeout_returns_504(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/claude-accounts")

        assert resp.status_code == 504

    def test_coord_4xx_passed_through(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=404, text='{"error": "route not found"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/claude-accounts")

        assert resp.status_code == 404

    def test_unresolved_tenant_is_forbidden(self, unresolved_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = unresolved_client.get(f"{API_PREFIX}/claude-accounts")

        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"
        instance.get.assert_not_called()


class TestPrepaidBalancesOnTheSameFeed:
    """`prepaid` rides the claude-accounts feed — plan
    ``2026-09-12-prepaid-balance-is-a-fleet-fact-with-no-ingest``.

    It is a DIFFERENT object family from ``accounts`` (keyed by provider, money
    instead of a utilization fraction) stored in its own
    ``coord.prepaid_balances``, so it gets its own key and its own provisioning
    flag. The first test here exists because the key was dropped from the
    return dict once already: every field was computed and then not returned,
    and nothing failed — ruff stayed quiet because the name was still "used",
    and no test looked.
    """

    def test_prepaid_rows_actually_reach_the_caller(self, client: TestClient):
        coord_payload = {
            "accounts": [_account(_DEVICE_A, ".claude-gmail")],
            "prepaid": [_prepaid(_DEVICE_A, "deepseek")],
            "table_provisioned": True,
            "columns_provisioned": True,
            "prepaid_table_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        assert "prepaid" in body, "the prepaid key must be RETURNED, not just computed"
        assert [r["provider"] for r in body["prepaid"]] == ["deepseek"]
        assert body["prepaid"][0]["balance_micros"] == 19280000
        assert body["prepaid_table_provisioned"] is True
        # The two families stay separate — a prepaid row must never appear as
        # a Claude account, which is the whole reason it is not two columns on
        # coord.claude_account_usage.
        assert [a["account_label"] for a in body["accounts"]] == [".claude-gmail"]

    def test_device_id_filter_applied_to_prepaid_too(self, client: TestClient):
        coord_payload = {
            "accounts": [_account(_DEVICE_A, ".claude-gmail")],
            "prepaid": [
                _prepaid(_DEVICE_A, "deepseek"),
                _prepaid(_DEVICE_B, "otherprovider"),
            ],
            "table_provisioned": True,
            "columns_provisioned": True,
            "prepaid_table_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(
                f"{API_PREFIX}/claude-accounts", params={"device_id": _DEVICE_A}
            ).json()

        assert [r["provider"] for r in body["prepaid"]] == ["deepseek"]

    def test_unprovisioned_prepaid_table_is_unknown_not_no_providers(
        self, client: TestClient
    ):
        # alembic coord_prepaid_balances_01 unapplied: the usage half is still
        # real and must be served; the prepaid half is UNKNOWN.
        coord_payload = {
            "accounts": [_account(_DEVICE_A, ".claude-gmail")],
            "prepaid": [],
            "table_provisioned": True,
            "columns_provisioned": True,
            "prepaid_table_provisioned": False,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        assert body["prepaid_table_provisioned"] is False
        assert body["prepaid"] == []
        assert len(body["accounts"]) == 1

    def test_absent_prepaid_flag_is_null_never_defaulted(self, client: TestClient):
        # A coord build predating the prepaid half entirely. We observed
        # nothing, so we assert nothing — same rule as table_provisioned.
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"accounts": [_account(_DEVICE_A, ".claude-gmail")]}
            )
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        assert body["prepaid_table_provisioned"] is None
        assert body["prepaid"] == []

    def test_a_real_zero_balance_survives_as_zero(self, client: TestClient):
        # 0 micros means OUT OF CREDIT and must reach the operator as 0. The
        # table exists to keep this distinguishable from "not reported"; the
        # proxy must not collapse either into the other.
        coord_payload = {
            "accounts": [],
            "prepaid": [
                _prepaid(
                    _DEVICE_A,
                    "brokeprovider",
                    balance_micros=0,
                    granted_micros=0,
                    topped_up_micros=0,
                    is_available=False,
                ),
                _prepaid(
                    _DEVICE_A,
                    "unreported",
                    balance_micros=None,
                    granted_micros=None,
                    topped_up_micros=None,
                    currency=None,
                    is_available=None,
                    error="HTTP 401 Unauthorized",
                ),
            ],
            "table_provisioned": True,
            "columns_provisioned": True,
            "prepaid_table_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/claude-accounts").json()

        by_provider = {r["provider"]: r for r in body["prepaid"]}
        assert by_provider["brokeprovider"]["balance_micros"] == 0
        assert by_provider["brokeprovider"]["error"] is None
        assert by_provider["unreported"]["balance_micros"] is None
        assert by_provider["unreported"]["error"] == "HTTP 401 Unauthorized"

    def test_malformed_prepaid_is_tolerated_like_accounts(self, client: TestClient):
        # Coord's half is unwritten at this revision, so be liberal: a null or
        # a non-list must not 500 the whole roster. NOTE the residual hazard —
        # this collapses null to [], which is indistinguishable from "no
        # provider configured" when the flag says True. The coord wire contract
        # must pin [] rather than null; tracked in the plan.
        for bad in (None, {"not": "a list"}, "nonsense", 7):
            coord_payload = {
                "accounts": [_account(_DEVICE_A, ".claude-gmail")],
                "prepaid": bad,
                "table_provisioned": True,
                "prepaid_table_provisioned": True,
            }
            with _patch_httpx() as MockClient:
                instance = AsyncMock()
                instance.get.return_value = _mock_response(json_data=coord_payload)
                _configure_mock_client(MockClient, instance)

                resp = client.get(f"{API_PREFIX}/claude-accounts")

            assert resp.status_code == 200, f"prepaid={bad!r} must not fail the roster"
            assert resp.json()["prepaid"] == []

    def test_prepaid_rows_that_are_not_dicts_are_dropped_when_filtering(
        self, client: TestClient
    ):
        coord_payload = {
            "accounts": [],
            "prepaid": [_prepaid(_DEVICE_A, "deepseek"), "garbage", None],
            "table_provisioned": True,
            "prepaid_table_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            body = client.get(
                f"{API_PREFIX}/claude-accounts", params={"device_id": _DEVICE_A}
            ).json()

        assert [r["provider"] for r in body["prepaid"]] == ["deepseek"]
