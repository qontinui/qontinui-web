"""Pending-installation proxy: key forwarding, the one-key rule, passthrough.

Backs the pre-check on the "already installed the App?" connect card and the
onboarding-status recover card (plan
``2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility``
P1 / P4). The proxy fronts coord's KEYED
``GET /coord/onboarding/pending-installations?installation_id=|account_login=``
— keyed, not listed, because ``coord.pending_installations`` has no tenant
column and a tenant-wide list would either be empty by definition or leak
every other prospective tenant's org.

What matters here:

* exactly one of ``installation_id`` / ``account_login`` is forwarded, under
  the same query-param name, to the coord path;
* zero keys, both keys, or a blank login → ``400 {"error":
  "exactly_one_key_required"}`` — coord's own shape — with NO coord call;
* coord's JSON body passes through on 200 for all three readings, INCLUDING
  ``pending: null`` (UNKNOWN — the table is absent), which must survive as
  ``None`` rather than collapse to ``False``;
* a coord 4xx/5xx re-raises with the same status (``_proxy_coord_get``).

Mirrors the mocked-``httpx`` + ``dependency_overrides`` pattern in
``test_operations_onboarding_enroll_target.py`` — no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
PENDING_URL = "/api/v1/operations/pr-merge/onboarding/pending-installation"

PENDING_ROW = {
    "pending": True,
    "installation_id": 143833618,
    "account_login": "portofino-pizzeria",
    "account_type": "Organization",
    "repo_count": 3,
    "received_at": "2026-09-05T10:11:12Z",
    "claimed_at": None,
}


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else PENDING_ROW
    resp.text = "" if json_data is None else str(json_data)
    return resp


def _patched_get(resp: MagicMock):
    """Patch the AsyncClient used by ``_proxy_coord_get``; return the client mock."""
    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def test_forwards_installation_id_to_coord_pending_path(
    auth_client: TestClient,
) -> None:
    """``?installation_id=`` reaches coord's pending-installations route as-is."""
    client = _patched_get(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(PENDING_URL, params={"installation_id": 143833618})

    assert res.status_code == 200
    assert res.json() == PENDING_ROW
    url = client.get.call_args.args[0]
    assert url.endswith("/coord/onboarding/pending-installations")
    assert client.get.call_args.kwargs["params"] == {"installation_id": 143833618}


def test_forwards_account_login_to_coord_pending_path(
    auth_client: TestClient,
) -> None:
    """``?account_login=`` is forwarded under the same name, trimmed."""
    client = _patched_get(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(
            PENDING_URL, params={"account_login": "  portofino-pizzeria "}
        )

    assert res.status_code == 200
    assert client.get.call_args.kwargs["params"] == {
        "account_login": "portofino-pizzeria"
    }


def test_forwards_caller_bearer_to_coord(auth_client: TestClient) -> None:
    """The tenant read is bearer-forwarded like its accounts sibling."""
    client = _patched_get(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(
            PENDING_URL,
            params={"account_login": "acme"},
            headers={"Authorization": "Bearer test-token"},
        )
    assert res.status_code == 200
    # `_tenant_headers` builds the header dict; the proxy hands it to httpx.
    assert client.get.call_args.kwargs["headers"] is not None


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"installation_id": 1, "account_login": "acme"},
        {"account_login": ""},
        {"account_login": "   "},
    ],
    ids=["no-key", "both-keys", "blank-login", "whitespace-login"],
)
def test_zero_or_two_keys_is_400_with_coord_shape_and_no_coord_call(
    auth_client: TestClient, params: dict
) -> None:
    """The one-key rule is answered here, in coord's own error shape."""
    client = _patched_get(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(PENDING_URL, params=params)
    assert res.status_code == 400
    assert res.json() == {"error": "exactly_one_key_required"}
    client.get.assert_not_called()


def test_pending_null_unknown_survives_passthrough(auth_client: TestClient) -> None:
    """``pending: null`` (table absent) must reach the browser as ``null``.

    The frontend renders it as "couldn't check with coord", never as "not
    installed" — a proxy that coerced it to ``false`` would manufacture a false
    negative for every tenant on a coord without the table.
    """
    unknown = {
        "pending": None,
        "installation_id": None,
        "account_login": None,
        "account_type": None,
        "repo_count": None,
        "received_at": None,
        "claimed_at": None,
        "reason": "pending_installations_table_absent",
    }
    client = _patched_get(_mock_response(200, unknown))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(PENDING_URL, params={"account_login": "acme"})
    assert res.status_code == 200
    body = res.json()
    assert body["pending"] is None
    assert body["reason"] == "pending_installations_table_absent"


def test_claimed_row_passes_through(auth_client: TestClient) -> None:
    """A claimed row (``pending: false`` + ``claimed_at``) is not rewritten."""
    claimed = {**PENDING_ROW, "pending": False, "claimed_at": "2026-09-05T12:00:00Z"}
    client = _patched_get(_mock_response(200, claimed))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(PENDING_URL, params={"installation_id": 143833618})
    assert res.status_code == 200
    assert res.json()["pending"] is False
    assert res.json()["claimed_at"] == "2026-09-05T12:00:00Z"


@pytest.mark.parametrize("status", [400, 403, 500])
def test_coord_error_status_passes_through(
    auth_client: TestClient, status: int
) -> None:
    """A coord 4xx/5xx re-raises with the same status (``_proxy_coord_get``)."""
    client = _patched_get(_mock_response(status, {"error": "whatever"}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(PENDING_URL, params={"account_login": "acme"})
    assert res.status_code == status


def test_coord_unreachable_is_502(auth_client: TestClient) -> None:
    client = MagicMock()
    client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.get(PENDING_URL, params={"account_login": "acme"})
    assert res.status_code == 502
