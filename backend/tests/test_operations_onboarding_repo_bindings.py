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
  (``remedy``, ``failed_side`` / ``failed_tenant``, ``proposal_ids``, the
  ``schema_settling`` replica counts) included — every refusal
  qontinui-coord#3522's ``BindingError`` can answer — and so does a
  ``Retry-After`` header;
* an over-long body field is a web-side 422 and never reaches coord; no cap
  is tighter than coord's own (``reason`` / ``decision_ref`` are trimmed and
  then capped at 2000, as coord does);
* a coord transport failure is the web's 502 / 504, and a timed-out WRITE's
  504 carries the ``coord_write_timeout`` refusal envelope the page renders
  (its next action names the re-read before any retry); an answer lost after
  the request may have been sent is a typed ``answer_lost`` 504 for a write
  and a 502 for a read, never a bare 500.

No live coord: ``httpx.AsyncClient`` is patched, as in the restore test.
"""

import json
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
    "binding_deleted": False,
    "tombstone_cleared": False,
    "audit_ids": [str(uuid4()), str(uuid4())],
    "notified": True,
    "idempotent": False,
    "enrollment_spawned": False,
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


def _build_test_app(
    *, deny_admin: bool = False, with_error_handler: bool = False
) -> FastAPI:
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
    if with_error_handler:
        # The app's real handler: it composes a RefusalHTTPException into the
        # wire body (top-level `error`/`message` + nested `refusal`).
        from starlette.exceptions import HTTPException as StarletteHTTPException

        from app.middleware.error_handler import http_exception_handler

        test_app.add_exception_handler(
            StarletteHTTPException,
            http_exception_handler,  # type: ignore[arg-type]
        )
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(
    status_code: int, json_data: Any, headers: dict[str, str] | None = None
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.headers = httpx.Headers(headers or {})
    return resp


def _patched_client(
    resp: httpx.Response | MagicMock | None = None, *, side_effect=None
) -> MagicMock:
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
    """Each of the three verbs declares ``require_coord_tenant_admin_target``
    as a dependency — the gate that checks admin in the EFFECTIVE tenant (the
    switcher's selection) — rather than the home-returning base gate alone.

    This pins only WHICH gate guards the routes. It does not test, and the
    web does not do, any comparison between a bind body's ``target_tenant``
    and the active tenant: that body field is forwarded unexamined, and coord
    re-checks admin in both tenants itself."""
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
        "binding_deleted": True,
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


#: qontinui-coord#3522 ``BindingError::WriteFailed``: the failure arm before
#: the COMMIT, which rolled back. ``rolled_back`` is always the JSON ``true``.
_WRITE_FAILED_ROLLED_BACK: dict[str, Any] = {
    "error": "repo_binding_write_failed",
    "message": "the binding transaction failed before its commit and was "
    "rolled back; nothing was written — retry",
    "rolled_back": True,
}

#: ``BindingError::CommitUnknown``: the COMMIT failed, so the write may have
#: landed. It never carries ``rolled_back``.
_COMMIT_UNKNOWN: dict[str, Any] = {
    "error": "repo_binding_commit_unknown",
    "message": "the binding transaction's commit failed, so its outcome is "
    "unknown: the write may have landed. Re-read the bindings list (GET "
    "/coord/agent-onboarding/repo-bindings, or coord_repo_tenant_bindings) "
    "before retrying",
}


@pytest.mark.parametrize(
    ("method", "status", "error_body"),
    [
        ("POST", 400, {"error": "invalid_repo", "message": "not owner/name"}),
        (
            "POST",
            400,
            {"error": "invalid_target_tenant", "message": "not a tenant UUID"},
        ),
        (
            "POST",
            404,
            {
                "error": "tenant_not_found",
                "message": "no such tenant",
                "tenant_id": TARGET_TENANT,
            },
        ),
        (
            "POST",
            422,
            {
                "error": "org_unbound",
                "message": "the org has no tenant",
                "org": "meryts",
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
                "failed_side": "target",
            },
        ),
        (
            "POST",
            403,
            {
                "error": "not_admin_in_both_tenants",
                "message": "admin required in both tenants",
                "failed_tenant": None,
                "failed_side": "governing",
            },
        ),
        (
            "POST",
            403,
            {"error": "caller_tenant_not_a_party", "message": "not a party"},
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
        ("POST", 409, {"error": "tenancy_changed", "message": "retry"}),
        (
            "POST",
            503,
            {
                "error": "schema_settling",
                "message": "a replica predates bindings",
                "retry_after_secs": 30,
                "live_replicas": None,
                "not_ready_replicas": None,
            },
        ),
        # The bind door's two failed-write bodies, exactly as coord sends
        # them: the page reads `rolled_back` as its "nothing was written"
        # marker, so the key must survive the proxy on both verbs.
        ("POST", 500, _WRITE_FAILED_ROLLED_BACK),
        ("DELETE", 500, _WRITE_FAILED_ROLLED_BACK),
        # The same code without the marker: the page reads it defensively as
        # "may have landed", and the proxy passes it on exactly as sent.
        (
            "POST",
            500,
            {
                "error": "repo_binding_write_failed",
                "message": "the binding transaction failed before its commit "
                "and was rolled back; nothing was written — retry",
            },
        ),
        ("POST", 500, _COMMIT_UNKNOWN),
        ("DELETE", 500, _COMMIT_UNKNOWN),
        (
            "GET",
            503,
            {
                "error": "migration_pending",
                "message": "table absent",
                "missing": "coord.repo_tenant_bindings",
            },
        ),
        ("GET", 500, {"error": "repo_binding_read_failed", "message": "unknown"}),
        ("GET", 503, {"error": "coord_db_unavailable", "message": "no pool"}),
        ("POST", 500, {"error": "authz_lookup_failed", "message": "lookup failed"}),
        (
            "POST",
            403,
            {"error": "operator_principal_required", "hint": "operator-only"},
        ),
        (
            "DELETE",
            404,
            {
                "error": "binding_not_found",
                "message": "no binding",
                "repo": "meryts/bauhaus-b2b-dev-notes",
            },
        ),
        ("DELETE", 409, {"error": "tenancy_changed", "message": "retry"}),
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


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_rolled_back_marker_survives_the_proxy_as_json_true(
    auth_client: TestClient, method: str
) -> None:
    """The page treats a ``repo_binding_write_failed`` as "nothing was
    written" only when its body carries ``"rolled_back": true``, so the proxy
    must hand that key on as the JSON boolean ``true``: not dropped, not ``1``,
    not ``"true"``. Driven with a real ``httpx.Response`` so coord's bytes are
    parsed the way they are in production."""
    resp = httpx.Response(
        500,
        content=json.dumps(_WRITE_FAILED_ROLLED_BACK).encode(),
        headers={"content-type": "application/json"},
        request=httpx.Request(method, "https://coord.test/x"),
    )
    body: dict[str, Any] = {"repo": REPO, "reason": "r"}
    if method == "POST":
        body["target_tenant"] = TARGET_TENANT
    with patch("httpx.AsyncClient", return_value=_patched_client(resp)):
        res = _call(auth_client, method, json=body)
    assert res.status_code == 500
    assert res.json()["rolled_back"] is True
    assert res.json() == _WRITE_FAILED_ROLLED_BACK
    assert '"rolled_back":true' in res.text


def test_schema_settling_retry_after_header_passes_through(
    auth_client: TestClient,
) -> None:
    """Coord's ``503 schema_settling`` says when to come back in a
    ``Retry-After`` header as well as in ``retry_after_secs``; the proxy echoes
    the header, and both counts may be null (the census was unreadable)."""
    settling = {
        "error": "schema_settling",
        "message": "a replica predates bindings",
        "retry_after_secs": 30,
        "live_replicas": 3,
        "not_ready_replicas": 1,
    }
    client = _patched_client(
        _mock_response(503, settling, headers={"Retry-After": "30"})
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(
            auth_client,
            "POST",
            json={"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"},
        )
    assert res.status_code == 503
    assert res.json() == settling
    assert res.headers["retry-after"] == "30"


def test_no_retry_after_is_invented(auth_client: TestClient) -> None:
    client = _patched_client(_mock_response(200, LIST_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "GET")
    assert res.status_code == 200
    assert "retry-after" not in res.headers


def test_non_json_coord_body_is_wrapped(auth_client: TestClient) -> None:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 502
    resp.json.side_effect = ValueError("not json")
    resp.text = "Bad Gateway"
    resp.headers = httpx.Headers()
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


@pytest.mark.parametrize(
    ("method", "body", "discriminator"),
    [
        ("GET", None, "coord_timeout"),
        (
            "POST",
            {"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"},
            "coord_write_timeout",
        ),
        ("DELETE", {"repo": REPO, "reason": "r"}, "coord_write_timeout"),
    ],
)
def test_coord_timeout_carries_the_refusal_envelope(
    method: str, body: dict[str, Any] | None, discriminator: str
) -> None:
    """The page renders a timed-out write through its refusal envelope: the
    write's next action names the re-read that must precede a retry, which
    the bare ``message`` does not."""
    client = _patched_client(side_effect=httpx.ReadTimeout("slow"))
    test_client = TestClient(_build_test_app(with_error_handler=True))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(test_client, method, json=body)
    assert res.status_code == 504
    payload = res.json()
    assert payload["message"] == "timeout waiting for coord"
    refusal = payload["refusal"]
    assert refusal["code"] == "upstream_timeout"
    assert refusal["discriminator"] == discriminator
    assert refusal["next_action"]["kind"] == "retry_later"
    if method == "GET":
        assert refusal["next_action"].get("target") is None
    else:
        assert refusal["next_action"]["target"] == "whether the change was applied"


@pytest.mark.parametrize(
    "raised",
    [
        httpx.ReadError("connection reset mid-answer"),
        httpx.RemoteProtocolError("server disconnected without a response"),
    ],
    ids=["ReadError", "RemoteProtocolError"],
)
@pytest.mark.parametrize(
    ("method", "body"),
    [
        ("GET", None),
        ("POST", {"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"}),
        ("DELETE", {"repo": REPO, "reason": "r"}),
    ],
)
def test_answer_lost_after_send_is_a_typed_refusal_not_a_bare_500(
    method: str, body: dict[str, Any] | None, raised: httpx.HTTPError
) -> None:
    """A transport failure after the request may have reached coord is
    neither a connect error nor a timeout. A write's outcome is then unknown:
    a 504 ``answer_lost`` whose next action names the re-read (the page reads
    it as "may have landed"). A read changed nothing: a 502 that says retrying
    is safe."""
    client = _patched_client(side_effect=raised)
    test_client = TestClient(_build_test_app(with_error_handler=True))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(test_client, method, json=body)
    payload = res.json()
    refusal = payload["refusal"]
    assert refusal["next_action"]["kind"] == "retry_later"
    assert type(raised).__name__ in payload["message"]
    if method == "GET":
        assert res.status_code == 502
        assert refusal["code"] == "upstream_unavailable"
        assert refusal["discriminator"] == "coord_read_answer_lost"
        assert refusal["next_action"].get("target") is None
        assert "retrying is safe" in payload["message"]
    else:
        assert res.status_code == 504
        assert refusal["code"] == "upstream_timeout"
        assert refusal["discriminator"] == "answer_lost"
        assert refusal["next_action"]["target"] == "whether the change was applied"
        assert "may have been applied" in payload["message"]
        assert "outcome is unknown" in payload["message"]


@pytest.mark.parametrize(
    ("method", "body", "read_secs"),
    [
        ("GET", None, 5.0),
        (
            "POST",
            {"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r"},
            30.0,
        ),
        ("DELETE", {"repo": REPO, "reason": "r"}, 30.0),
    ],
)
def test_writes_get_the_longer_coord_budget(
    auth_client: TestClient,
    method: str,
    body: dict[str, Any] | None,
    read_secs: float,
) -> None:
    """A bind / unbind does a census, admin lookups and a three-table move
    before it answers, so it is not held to the 5s small-read budget the list
    uses — at that budget the "may have landed" 504 would be routine."""
    client = _patched_client(_mock_response(200, LIST_BODY))
    with patch("httpx.AsyncClient", return_value=client) as ctor:
        res = _call(auth_client, method, json=body)
    assert res.status_code == 200
    timeout = ctor.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.read == read_secs


# ---------------------------------------------------------------------------
# Length caps — an over-long field is a 422 and never reaches coord
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "body"),
    [
        (
            "POST",
            {"repo": "o/" + "n" * 255, "target_tenant": TARGET_TENANT, "reason": "r"},
        ),
        (
            "POST",
            {"repo": REPO, "target_tenant": "t" * 65, "reason": "r"},
        ),
        (
            "POST",
            {"repo": REPO, "target_tenant": TARGET_TENANT, "reason": "r" * 2001},
        ),
        (
            "POST",
            {
                "repo": REPO,
                "target_tenant": TARGET_TENANT,
                "reason": "r",
                "decision_ref": "d" * 2001,
            },
        ),
        ("DELETE", {"repo": "o/" + "n" * 255, "reason": "r"}),
        ("DELETE", {"repo": REPO, "reason": "r" * 2001}),
    ],
)
def test_over_long_fields_are_refused_before_coord(
    auth_client: TestClient, method: str, body: dict[str, Any]
) -> None:
    client = _patched_client(_mock_response(200, BIND_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, method, json=body)
    assert res.status_code == 422
    client.request.assert_not_called()


def test_fields_at_their_caps_are_forwarded(auth_client: TestClient) -> None:
    body = {
        # The longest spelling coord normalizes: a github.com URL + `.git`.
        "repo": "https://github.com/" + "o" * 39 + "/" + "n" * 100 + ".git",
        "target_tenant": TARGET_TENANT,
        "reason": "r" * 2000,
        "decision_ref": "d" * 2000,
    }
    client = _patched_client(_mock_response(200, BIND_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "POST", json=body)
    assert res.status_code == 200
    assert client.request.call_args.kwargs["json"] == body


def test_text_is_trimmed_before_its_cap_as_coord_does(
    auth_client: TestClient,
) -> None:
    """Coord bounds ``reason`` / ``decision_ref`` at 2000 characters AFTER
    trimming; a value that fits once trimmed is forwarded (trimmed), never a
    web-side 422 for a value coord would have accepted."""
    body = {
        "repo": REPO,
        "target_tenant": TARGET_TENANT,
        "reason": "  " + "r" * 2000 + "\n",
        "decision_ref": " " + "d" * 2000 + " ",
    }
    client = _patched_client(_mock_response(200, BIND_BODY))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "POST", json=body)
    assert res.status_code == 200
    sent = client.request.call_args.kwargs["json"]
    assert sent["reason"] == "r" * 2000
    assert sent["decision_ref"] == "d" * 2000


def test_blank_reason_is_coords_to_refuse(auth_client: TestClient) -> None:
    """Blankness is coord's ``400 invalid_reason``, not a web-side shape: a
    whitespace-only reason reaches coord (as ``""``) and its refusal comes
    back verbatim."""
    refusal = {"error": "invalid_reason", "message": "`reason` is required"}
    client = _patched_client(_mock_response(400, refusal))
    with patch("httpx.AsyncClient", return_value=client):
        res = _call(auth_client, "DELETE", json={"repo": REPO, "reason": "   "})
    assert res.status_code == 400
    assert res.json() == refusal
    assert client.request.call_args.kwargs["json"] == {"repo": REPO, "reason": ""}
