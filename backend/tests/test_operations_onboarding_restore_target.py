"""Restore (re-enroll) proxy: target shaping, verbatim passthrough, admin gate.

Backs the "Re-enroll" action on an un-enrolled row of the Connected
Organizations card (plan
``2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility``
P3). The proxy fronts coord's
``POST /coord/onboarding/repos/{owner/name}/restore``, which clears the
``tenant_repo_unenrollments`` tombstone and re-runs the installation enroll
for that repo, answering ``202 {"restored", "enrolled": "spawned", ...}``.

What matters here:

* the ``owner/name`` path param — which carries a slash — is substituted into
  the coord path VERBATIM (not URL-encoded into ``owner%2Fname``);
* a path that is not ``owner/name`` is refused here (``400 invalid_repo``)
  with no coord call;
* coord's status code + JSON body pass through VERBATIM — the ``202`` is not
  rewritten to ``200``, and the ``404 no_installation_for_owner`` shape keeps
  its ``restored`` flag for the frontend copy;
* the route is gated by ``require_coord_tenant_admin`` — a non-admin gets
  ``403`` before any coord call.

Mirrors ``test_operations_onboarding_enroll_target.py`` — no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
ACTIVE_TENANT = str(uuid4())
REPO = "portofino-pizzeria/backend"

RESTORE_URL = f"/api/v1/operations/pr-merge/onboarding/repos/{REPO}/restore"


async def _fake_admin(request: Request) -> UUID:
    """Stand-in for ``require_coord_tenant_admin`` (see the enroll test)."""
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
        json_data
        if json_data is not None
        else {
            "restored": True,
            "enrolled": "spawned",
            "installation_id": 143833618,
            "repo": REPO,
        }
    )
    return resp


def _patched_post(resp: MagicMock):
    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def test_forwards_to_coord_restore_path_with_repo_verbatim(
    auth_client: TestClient,
) -> None:
    """``owner/name`` lands in coord's path with its slash intact."""
    client = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(RESTORE_URL)

    assert res.status_code == 202
    body = res.json()
    assert body["enrolled"] == "spawned"
    assert body["restored"] is True
    assert body["repo"] == REPO
    url = client.post.call_args.args[0]
    assert url.endswith(f"/coord/onboarding/repos/{REPO}/restore")
    assert "%2F" not in url
    # Body-less, like the enroll proxy.
    assert "json" not in client.post.call_args.kwargs


def test_forwards_active_tenant_header(auth_client: TestClient) -> None:
    client = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            RESTORE_URL,
            headers={
                "X-Qontinui-Active-Tenant": ACTIVE_TENANT,
                "Authorization": "Bearer test-token",
            },
        )
    assert res.status_code == 202
    sent_headers = client.post.call_args.kwargs["headers"]
    assert sent_headers["X-Qontinui-Active-Tenant"] == ACTIVE_TENANT
    assert sent_headers["Authorization"] == "Bearer test-token"


@pytest.mark.parametrize("restored", [True, False])
def test_404_no_installation_passes_through_with_restored_flag(
    auth_client: TestClient, restored: bool
) -> None:
    """The 404 keeps ``restored`` — the copy differs on whether the tombstone went."""
    client = _patched_post(
        _mock_response(
            404,
            {
                "error": "no_installation_for_owner",
                "owner": "portofino-pizzeria",
                "restored": restored,
            },
        )
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(RESTORE_URL)
    assert res.status_code == 404
    assert res.json()["error"] == "no_installation_for_owner"
    assert res.json()["restored"] is restored


@pytest.mark.parametrize(
    "bad_repo",
    ["backend", "a/b/c", "../etc", "owner/", "/name", "owner/na me"],
)
def test_malformed_repo_is_400_with_no_coord_call(bad_repo: str) -> None:
    client = TestClient(_build_test_app())
    post_mock = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=post_mock):
        res = client.post(
            f"/api/v1/operations/pr-merge/onboarding/repos/{bad_repo}/restore"
        )
    # `owner/` and `/name` collapse to a path the router does not match (404
    # from FastAPI itself); the rest reach the handler and are refused there.
    assert res.status_code in (400, 404)
    if res.status_code == 400:
        assert res.json() == {"error": "invalid_repo"}
    post_mock.post.assert_not_called()


def test_non_admin_gets_403_before_any_coord_call() -> None:
    async def _deny(request: Request) -> UUID:
        raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

    client = TestClient(_build_test_app(admin_override=_deny))
    post_mock = _patched_post(_mock_response())
    with patch("httpx.AsyncClient", return_value=post_mock):
        res = client.post(RESTORE_URL)
    assert res.status_code == 403
    assert res.json()["detail"] == "not_coord_tenant_admin"
    post_mock.post.assert_not_called()


def test_coord_unreachable_is_502(auth_client: TestClient) -> None:
    client = MagicMock()
    client.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(RESTORE_URL)
    assert res.status_code == 502
