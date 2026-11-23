"""Un-enroll ("stop governing") proxy: gate, required reason, verbatim answers.

Backs the "Stop governing" action on an ENROLLED row of the Connected
Organizations card (plan
``2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped``
Phase 8). The proxy fronts coord's ``DELETE /coord/canonical-repos?repo=&reason=``
(``canonical_repos::delete_deregister``), which deletes the caller tenant's
governance rows for the repo and writes the un-enrollment tombstone.

What matters here:

* the route is gated by ``require_coord_tenant_admin_target`` — a non-admin
  gets ``403`` before any coord call;
* a missing or blank ``reason`` is ``400 reason_required`` and an over-long
  one ``400 reason_too_long`` (the cap counts the TRIMMED reason), both with no
  coord call; a path that is not ``owner/name`` is ``400 invalid_repo``; and
  the schema publishes ``reason`` as required;
* the ``owner/name`` path param reaches coord as the ``repo`` QUERY parameter,
  beside the trimmed ``reason``, with the operator's bearer and
  ``X-Qontinui-Active-Tenant`` — so the tombstone lands in the tenant the
  operator selected, never the home tenant;
* coord's ``204`` is answered as a BODILESS ``204`` (not the ``200 {"status":
  "ok"}`` of ``_proxy_coord_delete``, nor a ``204`` carrying a JSON body);
* coord's ``404`` body (``tombstoned``, ``note``) passes through VERBATIM in
  both of its arms — the pre-Phase-7 ``tombstoned: true`` and Phase 7's
  ``tombstoned: false`` for a tenant that does not govern the repo — and so
  does every other coord refusal;
* a transport failure is the web's 502 / 504, and a timed-out or lost write
  carries the refusal envelope whose next action is the re-read.

Mirrors ``test_operations_onboarding_restore_target.py`` (the route beside
it); the transport is ``client.request``, as in the repo-bindings test. No
live coord.
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
REPO = "portofino-pizzeria/backend"
REASON = "archived — the service moved to another repository"

UNENROLL_URL = f"/api/v1/operations/pr-merge/onboarding/repos/{REPO}"

#: Coord's 404 before plan Phase 7: a tombstone is written on this path too.
NOT_FOUND_TOMBSTONED: dict[str, Any] = {
    "error": f"repo not found: {REPO}",
    "tombstoned": True,
    "note": "no rows were removed, but an un-enrollment tombstone for (your "
    "tenant, this repo) is now recorded, so enrollment of this slug is "
    "suppressed for your tenant. If the slug was a typo, clear it: "
    "coord_onboard_unenroll_repo with restore=true.",
}

#: Coord's 404 after plan Phase 7, for a tenant that does not govern the repo.
NOT_FOUND_NOT_GOVERNING: dict[str, Any] = {
    "error": f"repo not found: {REPO}",
    "tombstoned": False,
    "note": "your tenant does not govern this repository, so no "
    "un-enrollment tombstone was recorded",
}


async def _fake_admin_target(request: Request) -> UUID:
    """Stand-in for ``require_coord_tenant_admin_target``.

    The real gate resolves the coord identity over its own client; this one
    does only what the gate does to the forwarding ContextVars (capture the
    caller's bearer and active-tenant selection), so the proxy path is under
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


def _coord_answer(status_code: int, body: Any | None = None) -> httpx.Response:
    """A real ``httpx.Response``, so coord's bytes are parsed as in production.

    ``body=None`` is an EMPTY body — coord's ``204``.
    """
    return httpx.Response(
        status_code,
        content=b"" if body is None else json.dumps(body).encode(),
        headers={} if body is None else {"content-type": "application/json"},
        request=httpx.Request("DELETE", "https://coord.test/coord/canonical-repos"),
    )


def _patched_client(
    resp: httpx.Response | None = None, *, side_effect: Any = None
) -> MagicMock:
    client = MagicMock()
    client.request = AsyncMock(return_value=resp, side_effect=side_effect)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def _delete(
    test_client: TestClient,
    *,
    reason: str | None = REASON,
    url: str = UNENROLL_URL,
    headers: dict[str, str] | None = None,
) -> Any:
    params = {} if reason is None else {"reason": reason}
    return test_client.delete(url, params=params, headers=headers)


# ---------------------------------------------------------------------------
# Admin gate
# ---------------------------------------------------------------------------


def test_route_depends_on_the_effective_tenant_admin_gate() -> None:
    """The DELETE declares ``require_coord_tenant_admin_target`` — admin IN THE
    ACTIVE TENANT, the tenant the write lands in — not a home-tenant gate."""
    from fastapi.routing import APIRoute

    from app.api.v1.endpoints.operations import (
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    found = [
        route
        for route in operations_router.routes
        if isinstance(route, APIRoute)
        and route.path == "/pr-merge/onboarding/repos/{repo:path}"
        and "DELETE" in route.methods
    ]
    assert len(found) == 1
    calls = [d.call for d in found[0].dependant.dependencies]
    assert require_coord_tenant_admin_target in calls


def test_openapi_publishes_reason_as_one_required_query_parameter() -> None:
    """The route never runs without a reason, so the schema says so: exactly
    one ``reason`` query parameter, ``required: true`` — what both OpenAPI
    snapshots and the generated frontend types are built from. FastAPI itself
    is told the parameter is optional, so that a missing reason reaches the
    handler's 400 rather than FastAPI's 422."""
    operation = _build_test_app().openapi()["paths"][
        "/api/v1/operations/pr-merge/onboarding/repos/{repo}"
    ]["delete"]
    reasons = [p for p in operation["parameters"] if p["name"] == "reason"]
    assert len(reasons) == 1
    assert reasons[0]["in"] == "query"
    assert reasons[0]["required"] is True
    assert reasons[0]["schema"] == {
        "type": "string",
        "minLength": 1,
        "title": "Reason",
    }


def test_non_admin_gets_403_before_any_coord_call() -> None:
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(TestClient(_build_test_app(deny_admin=True)))
    assert res.status_code == 403
    assert res.json()["detail"] == "not_coord_tenant_admin"
    client.request.assert_not_called()


# ---------------------------------------------------------------------------
# Refused here: the reason and the slug
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("reason", [None, "", "   ", "\n\t "])
def test_missing_or_blank_reason_is_400_with_no_coord_call(
    auth_client: TestClient, reason: str | None
) -> None:
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(auth_client, reason=reason)
    assert res.status_code == 400
    assert res.json() == {"error": "reason_required"}
    client.request.assert_not_called()


def test_over_long_reason_is_400_with_no_coord_call(auth_client: TestClient) -> None:
    """501 characters is one over the 500-character cap. The cap is spelled as
    a literal here rather than read from the module, so moving it reddens this
    test: the frontend input carries the same 500 (``ConnectedOrgsUnenroll.tsx``)
    and must move with it."""
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(auth_client, reason="r" * 501)
    assert res.status_code == 400
    assert res.json() == {"error": "reason_too_long", "max_length": 500}
    client.request.assert_not_called()


def test_reason_at_the_cap_once_trimmed_is_forwarded_trimmed(
    auth_client: TestClient,
) -> None:
    """The cap counts the TRIMMED reason, and the trimmed reason is what coord
    records — never a 400 for a reason that fits once its whitespace goes."""
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(auth_client, reason="  " + "r" * 500 + "\n")
    assert res.status_code == 204
    assert client.request.call_args.kwargs["params"]["reason"] == "r" * 500


@pytest.mark.parametrize(
    "bad_repo",
    ["backend", "a/b/c", "../etc", "owner/na me", "owner/name/restore"],
)
def test_malformed_repo_is_400_with_no_coord_call(
    auth_client: TestClient, bad_repo: str
) -> None:
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(
            auth_client, url=f"/api/v1/operations/pr-merge/onboarding/repos/{bad_repo}"
        )
    # `..` collapses to a path the router does not match (FastAPI's own 404);
    # the rest reach the handler and are refused there.
    assert res.status_code in (400, 404)
    if res.status_code == 400:
        assert res.json() == {"error": "invalid_repo"}
    client.request.assert_not_called()


# ---------------------------------------------------------------------------
# Forwarding: door, query, headers, budget
# ---------------------------------------------------------------------------


def test_forwards_to_coords_removal_door_in_the_selected_tenant(
    auth_client: TestClient,
) -> None:
    """``owner/name`` and the trimmed reason reach ``DELETE
    /coord/canonical-repos`` as query parameters, with the operator's bearer
    and the tenant-switcher selection — the tenant the tombstone lands in."""
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(
            auth_client,
            reason=f"  {REASON}  ",
            headers={
                "X-Qontinui-Active-Tenant": ACTIVE_TENANT,
                "Authorization": "Bearer test-token",
            },
        )
    assert res.status_code == 204
    client.request.assert_called_once()
    args, kwargs = client.request.call_args
    assert args[0] == "DELETE"
    assert args[1].endswith("/coord/canonical-repos")
    assert kwargs["params"] == {"repo": REPO, "reason": REASON}
    # Nothing in a body: coord's door reads the query string.
    assert kwargs["json"] is None
    assert kwargs["headers"]["X-Qontinui-Active-Tenant"] == ACTIVE_TENANT
    assert kwargs["headers"]["Authorization"] == "Bearer test-token"


def test_write_gets_the_longer_coord_budget(auth_client: TestClient) -> None:
    """Coord answers only after the removal commits, behind the
    per-(tenant, repo) lock an enrollment of the same repo also takes — not
    the 5s small-read budget."""
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client) as ctor:
        res = _delete(auth_client)
    assert res.status_code == 204
    timeout = ctor.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.read == 30.0
    assert timeout.connect == 5.0


# ---------------------------------------------------------------------------
# Coord's answers
# ---------------------------------------------------------------------------


def test_coords_204_is_a_bodiless_204(auth_client: TestClient) -> None:
    client = _patched_client(_coord_answer(204))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(auth_client)
    assert res.status_code == 204
    assert res.content == b""
    assert "content-type" not in res.headers


@pytest.mark.parametrize(
    "body",
    [NOT_FOUND_TOMBSTONED, NOT_FOUND_NOT_GOVERNING],
    ids=["tombstoned", "not-governing"],
)
def test_coords_404_body_passes_through_verbatim(
    auth_client: TestClient, body: dict[str, Any]
) -> None:
    """``tombstoned`` and ``note`` survive exactly as coord sent them — the
    page reads them to say whether a suppression was recorded."""
    client = _patched_client(_coord_answer(404, body))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(auth_client)
    assert res.status_code == 404
    assert res.json() == body
    assert res.json()["tombstoned"] is body["tombstoned"]


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (403, {"error": "strategy_admin_required"}),
        (403, {"error": "auth_required"}),
        (400, {"error": "repo query param must be non-empty"}),
        (
            500,
            {"error": "canonical_repos delete_deregister: unenroll_repo: db down"},
        ),
    ],
)
def test_other_coord_refusals_pass_through_verbatim(
    auth_client: TestClient, status: int, body: dict[str, Any]
) -> None:
    client = _patched_client(_coord_answer(status, body))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(auth_client)
    assert res.status_code == status
    assert res.json() == body


def test_a_non_json_coord_body_is_wrapped(auth_client: TestClient) -> None:
    resp = httpx.Response(
        502,
        content=b"Bad Gateway",
        request=httpx.Request("DELETE", "https://coord.test/coord/canonical-repos"),
    )
    with patch("httpx.AsyncClient", return_value=_patched_client(resp)):
        res = _delete(auth_client)
    assert res.status_code == 502
    assert res.json() == {"detail": "Bad Gateway"}


# ---------------------------------------------------------------------------
# Transport failures are the web's own
# ---------------------------------------------------------------------------


def test_coord_unreachable_is_502_nothing_changed() -> None:
    client = _patched_client(side_effect=httpx.ConnectError("refused"))
    test_client = TestClient(_build_test_app(with_error_handler=True))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(test_client)
    assert res.status_code == 502
    assert res.json()["refusal"]["discriminator"] == "coord_unreachable"


def test_coord_timeout_is_504_whose_next_action_is_the_reread() -> None:
    client = _patched_client(side_effect=httpx.ReadTimeout("slow"))
    test_client = TestClient(_build_test_app(with_error_handler=True))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(test_client)
    assert res.status_code == 504
    refusal = res.json()["refusal"]
    assert refusal["code"] == "upstream_timeout"
    assert refusal["discriminator"] == "coord_write_timeout"
    assert refusal["next_action"]["kind"] == "retry_later"
    assert refusal["next_action"]["target"] == "whether the change was applied"


@pytest.mark.parametrize(
    "raised",
    [
        httpx.ReadError("connection reset mid-answer"),
        httpx.RemoteProtocolError("server disconnected without a response"),
    ],
    ids=["ReadError", "RemoteProtocolError"],
)
def test_answer_lost_after_send_is_a_504_answer_lost(raised: httpx.HTTPError) -> None:
    """The removal may have been applied: a typed 504 ``answer_lost`` whose
    next action names the re-read, never a bare 500."""
    client = _patched_client(side_effect=raised)
    test_client = TestClient(_build_test_app(with_error_handler=True))
    with patch("httpx.AsyncClient", return_value=client):
        res = _delete(test_client)
    assert res.status_code == 504
    refusal = res.json()["refusal"]
    assert refusal["discriminator"] == "answer_lost"
    assert refusal["next_action"]["target"] == "whether the change was applied"
