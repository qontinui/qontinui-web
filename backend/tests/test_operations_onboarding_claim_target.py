"""Claim-proxy target shaping: `installation_id` vs `account_login`.

Covers the already-installed-org onboarding path (plan
``2026-07-08-runner-multi-tenant-session-ux.md`` O1). Two GitHub redirect
shapes reach ``POST /pr-merge/onboarding/claim``:

* fresh install — Setup-URL redirect carries ``installation_id``;
* already-installed org — the ``login/oauth/authorize`` callback carries a
  ``code`` but **no** ``installation_id``, so the org is named via
  ``account_login`` and coord resolves the id from the caller's own
  ``/user/installations``.

What matters here is that the proxy forwards the caller's target verbatim and
adds nothing: the tenant comes from the caller's auth, never the body, and
coord's org-admin gate is the authority on whether the target is claimable.

Mirrors the mocked-``httpx`` pattern in ``test_operations_claims_proxy.py`` —
no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()

CLAIM_URL = "/api/v1/operations/pr-merge/onboarding/claim"


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
    resp.json.return_value = json_data if json_data is not None else {"ok": True}
    return resp


def _patched_post(resp: MagicMock):
    """Patch the AsyncClient used by the claim handler; return the post mock."""
    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def test_fresh_install_forwards_installation_id_only(auth_client: TestClient) -> None:
    """Setup-URL shape: installation_id goes through, no account_login is invented."""
    client = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            CLAIM_URL, json={"code": "abc", "installation_id": 12345}
        )
    assert res.status_code == 200
    payload = client.post.call_args.kwargs["json"]
    assert payload["installation_id"] == 12345
    assert payload["code"] == "abc"
    # Absent target keys must be OMITTED, not sent as null — coord distinguishes
    # "no target" (400 target_required) from a supplied one.
    assert "account_login" not in payload


def test_authorize_callback_forwards_account_login_only(
    auth_client: TestClient,
) -> None:
    """Authorize shape: no installation_id exists, so the org rides as account_login."""
    client = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            CLAIM_URL, json={"code": "abc", "account_login": "acme-org"}
        )
    assert res.status_code == 200
    payload = client.post.call_args.kwargs["json"]
    assert payload["account_login"] == "acme-org"
    assert "installation_id" not in payload


def test_bind_only_rides_with_account_login(auth_client: TestClient) -> None:
    """The runner clone-connect path is authorize + bind-only (no enrollment)."""
    client = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(
            CLAIM_URL,
            json={"code": "abc", "account_login": "acme-org", "bind_only": True},
        )
    payload = client.post.call_args.kwargs["json"]
    assert payload["bind_only"] is True
    assert payload["account_login"] == "acme-org"


def test_empty_target_is_forwarded_for_coord_to_reject(
    auth_client: TestClient,
) -> None:
    """A code with no target isn't rejected locally — coord owns `target_required`.

    Keeping the 400 in one place (coord) means the proxy can't drift from the
    gate it fronts.
    """
    client = _patched_post(
        _mock_response(status_code=400, json_data={"error": "target_required"})
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(CLAIM_URL, json={"code": "abc"})
    payload = client.post.call_args.kwargs["json"]
    assert "installation_id" not in payload
    assert "account_login" not in payload
    # Coord's status + body pass through verbatim so the page can render it.
    assert res.status_code == 400
    assert res.json()["error"] == "target_required"


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (403, "installation_not_administered"),
        (409, "account_already_bound"),
        (400, "code_exchange_failed"),
    ],
)
def test_gate_failures_pass_through_verbatim(
    auth_client: TestClient, status: int, code: str
) -> None:
    """The org-admin gate's verdict must reach the browser with its own status.

    Collapsing a 403 into a 500 would make an unadministered org look like an
    outage and invite a retry loop.
    """
    client = _patched_post(_mock_response(status_code=status, json_data={"error": code}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            CLAIM_URL, json={"code": "abc", "account_login": "not-mine"}
        )
    assert res.status_code == status
    assert res.json()["error"] == code


def test_tenant_never_taken_from_body(auth_client: TestClient) -> None:
    """A body-supplied tenant_id must be ignored — tenant comes from auth only.

    This is the standing invariant behind the whole bind/claim surface: the
    request body selects WHICH installation, never WHOSE tenant it lands in.
    """
    client = _patched_post(_mock_response())
    attacker_tenant = str(uuid4())
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(
            CLAIM_URL,
            json={
                "code": "abc",
                "account_login": "acme-org",
                "tenant_id": attacker_tenant,
            },
        )
    payload = client.post.call_args.kwargs["json"]
    assert attacker_tenant not in str(payload)
    assert "tenant_id" not in payload
