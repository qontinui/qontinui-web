"""Enroll-proxy target shaping + verbatim passthrough + admin gate.

Backs the "Enroll / Sync repositories" button on the Connected Organizations
card (plan ``2026-07-19-web-onboarding-enroll-now-button``). The proxy fronts
coord's already-existing
``POST /coord/onboarding/installations/:installation_id/enroll``, which — after
Phase 0 — runs its authz prologue synchronously and then ``tokio::spawn``s the
enrollment, returning ``202 {"enrolled": "spawned", ...}`` with NO ``repos``
array. The UI learns the repos by re-polling the accounts endpoint.

What matters here:

* the ``installation_id`` path param is substituted into the coord path;
* the active-tenant selection (``X-Qontinui-Active-Tenant``) is forwarded to
  coord via ``_tenant_headers`` (coord re-scopes the operator's context to it);
* coord's status code + JSON body pass through VERBATIM — the ``202`` is not
  rewritten to ``200`` and the ``{"error": ...}`` shape survives for the
  frontend (cover ``202`` / ``403`` / ``404``);
* the route is gated by ``require_coord_tenant_admin`` (admin in the active
  tenant), NOT the looser ``get_tenant_id`` — a non-admin gets
  ``403 not_coord_tenant_admin`` before any coord call.

Mirrors the mocked-``httpx`` + ``dependency_overrides`` pattern in
``test_operations_onboarding_claim_target.py`` — no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
ACTIVE_TENANT = str(uuid4())
INSTALLATION_ID = 143833618

ENROLL_URL = (
    f"/api/v1/operations/pr-merge/onboarding/installations/{INSTALLATION_ID}/enroll"
)


async def _fake_admin(request: Request) -> UUID:
    """Stand-in for ``require_coord_tenant_admin``.

    Reproduces the real dependency's contextvar SIDE EFFECTS (capturing the
    caller's bearer + active-tenant header) without the coord round-trip, so
    ``_tenant_headers`` forwards them exactly as it would in production — but
    treats the caller as an admin unconditionally.
    """
    from app.api.v1.endpoints.operations import (
        ACTIVE_TENANT_HEADER,
        _caller_active_tenant,
        _caller_bearer,
        _extract_caller_token,
    )

    _caller_bearer.set(_extract_caller_token(request))
    _caller_active_tenant.set(request.headers.get(ACTIVE_TENANT_HEADER))
    return TEST_TENANT_ID


def _build_test_app(admin_override=None) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[require_coord_tenant_admin] = (
        admin_override or _fake_admin
    )
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 202, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = (
        json_data if json_data is not None else {"enrolled": "spawned"}
    )
    return resp


def _patched_post(resp: MagicMock):
    """Patch the AsyncClient used by the enroll handler; return the client mock."""
    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def test_forwards_to_coord_enroll_path_with_installation_id(
    auth_client: TestClient,
) -> None:
    """The path param is substituted into coord's installation enroll route."""
    client = _patched_post(
        _mock_response(
            202,
            {
                "enrolled": "spawned",
                "tenant_id": str(TEST_TENANT_ID),
                "installation_id": INSTALLATION_ID,
            },
        )
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(ENROLL_URL)

    # 202 passes through unchanged (not rewritten to 200 by FastAPI).
    assert res.status_code == 202
    assert res.json()["enrolled"] == "spawned"
    # The mocked coord POST targeted the installation enroll route with the id.
    url = client.post.call_args.args[0]
    assert url.endswith(f"/coord/onboarding/installations/{INSTALLATION_ID}/enroll")
    # No JSON body is sent — the enroll takes no payload.
    assert "json" not in client.post.call_args.kwargs


def test_forwards_active_tenant_header(auth_client: TestClient) -> None:
    """``X-Qontinui-Active-Tenant`` reaches coord via ``_tenant_headers``."""
    client = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            ENROLL_URL,
            headers={
                "X-Qontinui-Active-Tenant": ACTIVE_TENANT,
                "Authorization": "Bearer test-token",
            },
        )
    assert res.status_code == 202
    sent_headers = client.post.call_args.kwargs["headers"]
    assert sent_headers["X-Qontinui-Active-Tenant"] == ACTIVE_TENANT
    assert sent_headers["Authorization"] == "Bearer test-token"


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (403, "installation_not_owned_by_tenant"),
        (404, "installation_not_mapped"),
    ],
)
def test_coord_error_shapes_pass_through_verbatim(
    auth_client: TestClient, status: int, code: str
) -> None:
    """Coord's status + ``{"error": ...}`` body reach the browser unchanged.

    Collapsing a 404 into a 500 would make an unmapped org look like an outage;
    the frontend keys its copy on the exact ``error`` code + status.
    """
    client = _patched_post(_mock_response(status, {"error": code}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(ENROLL_URL)
    assert res.status_code == status
    assert res.json()["error"] == code


def test_non_admin_gets_403_before_any_coord_call() -> None:
    """A non-admin is rejected by ``require_coord_tenant_admin`` — no coord POST.

    Proves the route is gated by the admin dependency (not ``get_tenant_id``):
    enrolling opens bootstrap PRs, a consequential write.
    """

    async def _deny(request: Request) -> UUID:
        raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

    client = TestClient(_build_test_app(admin_override=_deny))
    post_mock = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=post_mock):
        res = client.post(ENROLL_URL)
    assert res.status_code == 403
    assert res.json()["detail"] == "not_coord_tenant_admin"
    # The gate short-circuits before the handler body — coord is never called.
    post_mock.post.assert_not_called()
