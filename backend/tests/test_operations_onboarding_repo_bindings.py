"""Repo-tenant binding proxies: admin gate, header forwarding, verbatim passthrough.

Plan ``2026-10-17-per-repo-tenant-binding-overrides-the-org-tenant`` Phase 7.
The web backend fronts coord's operator arm
``GET/POST/DELETE /coord/onboarding/repo-bindings`` at
``/api/v1/operations/pr-merge/onboarding/repo-bindings``. Coord owns every
authorization decision past the web-side active-tenant admin gate (it
re-checks admin in BOTH tenants for a bind), so what matters here is:

* the route is gated by ``require_coord_tenant_admin_target`` — a non-admin
  gets ``403`` before any coord call, on all three verbs;
* the operator's bearer and ``X-Qontinui-Active-Tenant`` reach coord;
* the ``?repo=`` filter and the bind/unbind bodies reach coord unchanged
  (``decision_ref`` omitted when absent), and DELETE carries its body;
* coord's status code AND typed error body pass through VERBATIM, extras
  (``remedy``, ``failed_tenant``, ``proposal_ids``) included;
* a coord transport failure is the web's 502 / 504.

No live coord: ``httpx.AsyncClient`` is patched, as in the restore test.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
ACTIVE_TENANT = str(uuid4())
TARGET_TENANT = "ce1ec20c-9cf1-427a-857d-81d6449cc6e4"
REPO = "Meryts/bauhaus-b2b-dev-notes"

BINDINGS_URL = "/api/v1/operations/pr-merge/onboarding/repo-bindings"

LIST_BODY: dict[str, Any] = {
    "bindings": [
        {
            "repo": "meryts/bauhaus-b2b-dev-notes",
            "tenant_id": TARGET_TENANT,
            "tenant_slug": "bauhaus-b2b",
            "org_tenant_id": str(uuid4()),
            "org_tenant_slug": "meryts-2-0",
            "bound_by": "operator:someone",
            "reason": "operator decision 2026-10-17",
            "decision_ref": None,
            "created_at": "2026-10-17T10:00:00Z",
            "updated_at": "2026-10-17T10:00:00Z",
            "caller_side": "bound",
        }
    ],
    "measured_at": "2026-10-24T08:00:00Z",
}

BIND_BODY: dict[str, Any] = {
    "repo": REPO,
    "from_tenant": str(uuid4()),
    "to_tenant": TARGET_TENANT,
    "governed_by": "binding",
    "moved": {"tenant_repos": 1, "profile": 1, "canonical": 1},
    "binding_written": True,
    "audit_ids": [str(uuid4()), str(uuid4())],
    "notified": True,
    "idempotent": False,
}


async def _fake_admin_target(request: Request) -> UUID:
    """Stand-in for ``require_coord_tenant_admin_target``.

    The real gate resolves the coord identity over its own client; this one
    does only what the gate does to the forwarding ContextVars (capture the
    caller's bearer and active-tenant selection) so the proxy path is under
    test without a live coord.
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


def _build_test_app(*, deny_admin: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        require_coord_tenant_admin,
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    if deny_admin:
        # Deny at the BASE gate, which the target gate depends on: the real
        # `require_coord_tenant_admin_target` runs, and its admin dependency
        # refuses before any coord call.
        async def _deny(request: Request) -> UUID:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

        test_app.dependency_overrides[require_coord_tenant_admin] = _deny
    else:
        test_app.dependency_overrides[require_coord_tenant_admin_target] = (
            _fake_admin_target
        )
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int, json_data: Any) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    return resp


def _patched_client(resp: MagicMock | None = None, *, side_effect=None) -> MagicMock:
    client = MagicMock()
    client.request = AsyncMock(return_value=resp, side_effect=side_effect)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def _call(test_client: TestClient, method: str, **kwargs: Any) -> Any:
    # TestClient.delete takes no body, so every verb goes through request().
    return test_client.request(method, BINDINGS_URL, **kwargs)


# ---------------------------------------------------------------------------
# Admin gate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "body"),
    [
        ("GET", None),
        ("POST", {"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"}),
        ("DELETE", {"repo": REPO, "reason": "r"}),
    ],
)
def test_non_admin_gets_403_before_any_coord_call(
    method: str, body: dict[str, Any] | None
) -> None:
    client = _patched_client(_mock_response(200, LIST_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(TestClient(_build_test_app(deny_admin=True)), method, json=body)
    assert res.status_code == 403
    assert res.json()["detail"] == "not_coord_tenant_admin"
    client.request.assert_not_called()


def test_every_verb_depends_on_the_effective_tenant_admin_gate() -> None:
    """The three routes resolve the tenant through the TARGET gate, not the
    home-returning one — the bind body names a tenant, so the active-tenant
    selection is the one the write is checked against."""
    from fastapi.routing import APIRoute

    from app.api.v1.endpoints.operations import (
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    found: dict[str, bool] = {}
    for route in operations_router.routes:
        if (
            isinstance(route, APIRoute)
            and route.path == "/pr-merge/onboarding/repo-bindings"
        ):
            calls = [d.call for d in route.dependant.dependencies]
            for m in route.methods:
                found[m] = require_coord_tenant_admin_target in calls
    assert found == {"GET": True, "POST": True, "DELETE": True}


# ---------------------------------------------------------------------------
# Forwarding: path, headers, query, body
# ---------------------------------------------------------------------------


def test_list_forwards_to_coord_operator_route_with_headers(
    auth_client: TestClient,
) -> None:
    client = _patched_client(_mock_response(200, LIST_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(
            auth_client,
            "GET",
            headers={
                "X-Qontinui-Active-Tenant": ACTIVE_TENANT,
                "Authorization": "Bearer test-token",
            },
        )
    assert res.status_code == 200
    assert res.json() == LIST_BODY
    args, kwargs = client.request.call_args
    assert args[0] == "GET"
    assert args[1].endswith("/coord/onboarding/repo-bindings")
    # No filter supplied → nothing on the wire.
    assert kwargs["params"] is None
    assert kwargs["json"] is None
    assert kwargs["headers"]["X-Qontinui-Active-Tenant"] == ACTIVE_TENANT
    assert kwargs["headers"]["Authorization"] == "Bearer test-token"


def test_list_forwards_repo_filter_verbatim(auth_client: TestClient) -> None:
    client = _patched_client(_mock_response(200, LIST_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "GET", params={"repo": REPO})
    assert res.status_code == 200
    assert client.request.call_args.kwargs["params"] == {"repo": REPO}


def test_bind_forwards_body_and_omits_absent_decision_ref(
    auth_client: TestClient,
) -> None:
    client = _patched_client(_mock_response(200, BIND_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(
            auth_client,
            "POST",
            json={
                "repo": REPO,
                "target_tenant": TARGET_TENANT,
                "reason": "operator decision 2026-10-17",
            },
            headers={
                "X-Qontinui-Active-Tenant": ACTIVE_TENANT,
                "Authorization": "Bearer test-token",
            },
        )
    assert res.status_code == 200
    assert res.json() == BIND_BODY
    args, kwargs = client.request.call_args
    assert args[0] == "POST"
    assert args[1].endswith("/coord/onboarding/repo-bindings")
    assert kwargs["json"] == {
        "repo": REPO,
        "target_tenant": TARGET_TENANT,
        "reason": "operator decision 2026-10-17",
    }
    assert kwargs["headers"]["X-Qontinui-Active-Tenant"] == ACTIVE_TENANT
    assert kwargs["headers"]["Authorization"] == "Bearer test-token"


def test_bind_forwards_decision_ref_when_present(auth_client: TestClient) -> None:
    client = _patched_client(_mock_response(200, BIND_BODY))
    body = {
        "repo": REPO,
        "target_tenant": TARGET_TENANT,
        "reason": "operator decision 2026-10-17",
        "decision_ref": "decision_record/repositories-live-in-the-meryts-org",
    }
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "POST", json=body)
    assert res.status_code == 200
    assert client.request.call_args.kwargs["json"] == body


def test_unbind_sends_delete_with_its_body(auth_client: TestClient) -> None:
    unbind_answer = {
        **BIND_BODY,
        "governed_by": "org",
        "binding_written": False,
    }
    client = _patched_client(_mock_response(200, unbind_answer))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(
            auth_client,
            "DELETE",
            json={"repo": REPO, "reason": "reclaimed by the org"},
            headers={"Authorization": "Bearer test-token"},
        )
    assert res.status_code == 200
    assert res.json() == unbind_answer
    args, kwargs = client.request.call_args
    assert args[0] == "DELETE"
    assert args[1].endswith("/coord/onboarding/repo-bindings")
    assert kwargs["json"] == {"repo": REPO, "reason": "reclaimed by the org"}
    assert kwargs["headers"]["Authorization"] == "Bearer test-token"


# ---------------------------------------------------------------------------
# Coord's typed refusals pass through unchanged
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "status", "error_body"),
    [
        ("POST", 400, {"error": "invalid_repo", "message": "not owner/name"}),
        ("POST", 404, {"error": "tenant_not_found", "message": "no such tenant"}),
        (
            "POST",
            422,
            {
                "error": "org_unbound",
                "message": "the org has no tenant",
                "remedy": "coord_onboard_bind_account",
            },
        ),
        (
            "POST",
            403,
            {
                "error": "not_admin_in_both_tenants",
                "message": "admin required in both tenants",
                "failed_tenant": TARGET_TENANT,
            },
        ),
        (
            "POST",
            409,
            {
                "error": "in_flight_merge_proposals",
                "message": "proposals in flight",
                "proposal_ids": [str(uuid4())],
            },
        ),
        ("GET", 503, {"error": "migration_pending", "message": "table absent"}),
        ("GET", 500, {"error": "authz_lookup_failed", "message": "lookup failed"}),
        ("DELETE", 404, {"error": "binding_not_found", "message": "no binding"}),
        (
            "DELETE",
            403,
            {
                "error": "not_admin_in_bound_or_org_tenant",
                "message": "admin required in the bound or the org tenant",
            },
        ),
    ],
)
def test_coord_refusal_passes_through_verbatim(
    auth_client: TestClient,
    method: str,
    status: int,
    error_body: dict[str, Any],
) -> None:
    client = _patched_client(_mock_response(status, error_body))
    body: dict[str, Any] | None = None
    if method == "POST":
        body = {"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"}
    elif method == "DELETE":
        body = {"repo": REPO, "reason": "r"}
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, method, json=body)
    assert res.status_code == status
    assert res.json() == error_body


def test_non_json_coord_body_is_wrapped(auth_client: TestClient) -> None:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 502
    resp.json.side_effect = ValueError("not json")
    resp.text = "Bad Gateway"
    client = _patched_client(resp)
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "GET")
    assert res.status_code == 502
    assert res.json() == {"detail": "Bad Gateway"}


# ---------------------------------------------------------------------------
# Transport failures are the web's own
# ---------------------------------------------------------------------------


def test_coord_unreachable_is_502(auth_client: TestClient) -> None:
    client = _patched_client(side_effect=httpx.ConnectError("refused"))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "GET")
    assert res.status_code == 502


def test_coord_timeout_on_bind_is_504(auth_client: TestClient) -> None:
    client = _patched_client(side_effect=httpx.ReadTimeout("slow"))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(
            auth_client,
            "POST",
            json={"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"},
        )
    assert res.status_code == 504
