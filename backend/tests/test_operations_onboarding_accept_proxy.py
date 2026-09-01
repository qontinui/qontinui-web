"""Accept-proxy behaviour for tenant-repo parity (plan
``2026-08-29-coord-tenant-repo-parity-and-onboarding-completion`` Phase 2b).

``POST /pr-merge/onboarding/accept`` stopped being a cheap row UPSERT. Coord
now also registers the repo into ``coord.canonical_repos`` and PROVISIONS it —
bare ``git init``, a full mirror clone, a synchronous reconcile — so that
``POST /agents/allocate`` stops answering ``409 repo_not_registered``. Two
consequences are under test here:

* **Timeout.** The module-wide ``_COORD_TIMEOUT`` is 5s, which no mirror clone
  of a real repository beats. The route must override it with the file's
  existing long-call idiom, ``httpx.Timeout(None, connect=5.0)`` — no read
  deadline, 5s to connect. Without it every SUCCESSFUL accept becomes a 504.
  Accept stays synchronous on purpose (an async accept-status poll would
  reopen the window where the profile row exists and the registry row does
  not), so the timeout override is the whole mitigation.

* **Typed errors.** Coord's refusals on this path are machine-readable JSON
  objects (``repo_not_in_tenant`` 403, ``repo_has_no_remote`` 422,
  ``repo_registered_to_another_tenant`` 409, ``repo_unenrolled`` 409). The
  generic ``_proxy_coord_post`` stringifies a ≥400 body into
  ``HTTPException.detail``, which forces the browser to JSON-parse a string to
  find out WHICH refusal it hit. This route opts into ``structured_errors``, so
  the object survives as an object.

The opt-in is deliberately per-route: the last test pins that a sibling route
which does NOT opt in still gets the old stringified ``detail``, so this change
cannot quietly rewrite the error contract of the ~50 other callers of
``_proxy_coord_post``.

Mirrors the mocked-``httpx`` pattern in ``test_operations_onboarding_claim_target.py``
— no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()

ACCEPT_URL = "/api/v1/operations/pr-merge/onboarding/accept"
# A sibling POST proxy that does NOT opt into structured errors — the control
# for the "scoped, not global" assertion.
AUDIT_URL = "/api/v1/operations/pr-merge/onboarding/audit"

ACCEPT_BODY = {
    "repo": "acme/widgets",
    "profile": {"line_budget": 500},
    "github_remote": "https://github.com/acme/widgets.git",
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


def _json_response(status_code: int, json_data) -> MagicMock:
    """A coord response whose body IS valid JSON."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = "<unused: body parsed as JSON>"
    return resp


def _text_response(status_code: int, text: str) -> MagicMock:
    """A coord response whose body is NOT JSON (proxy HTML, empty, prose)."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.side_effect = ValueError("not json")
    resp.text = text
    return resp


def _patched_client(resp: MagicMock) -> MagicMock:
    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


# ---------------------------------------------------------------------------
# Timeout override
# ---------------------------------------------------------------------------


def test_accept_overrides_the_5s_default_with_no_read_deadline(
    auth_client: TestClient,
) -> None:
    """Accept must not inherit ``_COORD_TIMEOUT`` — a mirror clone outlives 5s."""
    client = _patched_client(_json_response(200, {"repo": "acme/widgets"}))
    with patch("httpx.AsyncClient", return_value=client) as ctor:
        res = auth_client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == 200
    timeout = ctor.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx.Timeout)
    # No read/write/pool deadline; 5s to establish the connection.
    assert timeout.read is None
    assert timeout.write is None
    assert timeout.pool is None
    assert timeout.connect == 5.0


def test_the_module_default_is_still_five_seconds() -> None:
    """The override is per-route; it must not have been bought by relaxing the
    module-wide default, which would silently loosen every other proxy call."""
    from app.api.v1.endpoints.operations import _COORD_TIMEOUT

    assert _COORD_TIMEOUT.read == 5.0
    assert _COORD_TIMEOUT.connect == 5.0


# ---------------------------------------------------------------------------
# Request shaping
# ---------------------------------------------------------------------------


def test_github_remote_is_forwarded_verbatim(auth_client: TestClient) -> None:
    """Coord requires the remote on this path and will not synthesize one, so
    the proxy must pass through exactly what the operator supplied."""
    client = _patched_client(_json_response(200, {"repo": "acme/widgets"}))
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(ACCEPT_URL, json=ACCEPT_BODY)

    sent = client.post.call_args.kwargs["json"]
    assert sent["github_remote"] == "https://github.com/acme/widgets.git"


def test_an_omitted_remote_is_not_invented_by_the_proxy(
    auth_client: TestClient,
) -> None:
    """An accept with no remote reaches coord with no remote, so coord's
    ``repo_has_no_remote`` refusal can fire. The proxy never fills it in."""
    client = _patched_client(_json_response(200, {"repo": "acme/widgets"}))
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(ACCEPT_URL, json={"repo": "acme/widgets", "profile": {}})

    sent = client.post.call_args.kwargs["json"]
    assert "github_remote" not in sent


# ---------------------------------------------------------------------------
# Success envelope
# ---------------------------------------------------------------------------


def test_provisioning_and_worktree_allocation_reach_the_browser(
    auth_client: TestClient,
) -> None:
    """The new fields are passed through untouched — the wizard renders them."""
    body = {
        "repo": "acme/widgets",
        "profile_version": 3,
        "profile_source": "audit",
        "updated_at": "2026-08-29T10:00:00Z",
        "provisioning": {
            "registry": "inserted",
            "bare_init": "created",
            "hook": "refreshed",
            "mirror_seed": "seeded",
            "reconcile": "failed: remote hung up",
        },
        "worktree_allocation": "pending_first_reconcile",
    }
    client = _patched_client(_json_response(200, body))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == 200
    assert res.json() == body


# ---------------------------------------------------------------------------
# Typed errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (403, "repo_not_in_tenant"),
        (422, "repo_has_no_remote"),
        (409, "repo_registered_to_another_tenant"),
        (409, "repo_unenrolled"),
    ],
)
def test_typed_refusals_survive_as_objects(
    auth_client: TestClient, status: int, code: str
) -> None:
    """``detail`` is coord's OBJECT, not a JSON string the browser re-parses."""
    coord_body = {
        "repo": "acme/widgets",
        "error": code,
        "hint": "do the thing first",
    }
    client = _patched_client(_json_response(status, coord_body))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == status
    detail = res.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["error"] == code
    assert detail["hint"] == "do the thing first"
    assert detail["repo"] == "acme/widgets"


def test_a_non_json_error_body_falls_back_to_raw_text(
    auth_client: TestClient,
) -> None:
    """An HTML 502 from an intermediary must not be swallowed by the parse."""
    client = _patched_client(_text_response(502, "<html>bad gateway</html>"))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == 502
    assert res.json()["detail"] == "<html>bad gateway</html>"


def test_a_json_scalar_error_body_falls_back_to_raw_text(
    auth_client: TestClient,
) -> None:
    """Only a JSON OBJECT is coord's error contract. A bare string or list is
    passed through as text rather than becoming a nonsense structured detail."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 500
    resp.json.return_value = ["boom"]
    resp.text = '["boom"]'
    client = _patched_client(resp)
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == 500
    assert res.json()["detail"] == '["boom"]'


def test_structured_errors_is_scoped_and_not_global(
    auth_client: TestClient,
) -> None:
    """A sibling route that does NOT opt in keeps the stringified ``detail``.

    This is the guard on the blast radius: ``_proxy_coord_post`` has ~50
    callers, and several render ``detail`` as a message string. Making the
    structured pass-through the default would turn those into ``[object
    Object]`` in the browser, so the behaviour is per-route opt-in.
    """
    client = _patched_client(
        _text_response(409, '{"error": "no_audit_capable_device"}')
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(AUDIT_URL, json={"repo": "acme/widgets"})

    assert res.status_code == 409
    assert res.json()["detail"] == '{"error": "no_audit_capable_device"}'


# ---------------------------------------------------------------------------
# The shape the BROWSER actually receives
# ---------------------------------------------------------------------------
#
# Every other proxy test in this suite builds a bare ``FastAPI()``, which uses
# FastAPI's default handler and so renders ``{"detail": …}``. The real app does
# NOT: ``app/main.py`` registers
# ``app.middleware.error_handler.http_exception_handler`` over it, and that
# handler SPLICES a dict detail carrying an ``error`` key into the top level of
# its standardized envelope. The wizard decodes the spliced shape, so it is
# pinned here rather than left to be discovered in a browser.


def _build_test_app_with_real_error_handler() -> FastAPI:
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import http_exception_handler

    test_app = _build_test_app()
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    return test_app


def test_the_browser_receives_coord_keys_spliced_into_the_envelope() -> None:
    """No ``detail`` key at all — ``error``/``repo``/``hint`` are top level."""
    client = TestClient(_build_test_app_with_real_error_handler())
    coord_body = {
        "repo": "acme/widgets",
        "error": "repo_has_no_remote",
        "hint": "supply the clone URL",
    }
    patched = _patched_client(_json_response(422, coord_body))
    with patch("httpx.AsyncClient", return_value=patched):
        res = client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == 422
    body = res.json()
    assert "detail" not in body
    assert body["error"] == "repo_has_no_remote"
    assert body["repo"] == "acme/widgets"
    assert body["hint"] == "supply the clone URL"


def test_an_unstructured_coord_error_keeps_the_generic_envelope_code() -> None:
    """Without ``structured_errors`` splicing, ``error`` is the status-derived
    code and coord's raw body lands in ``message``. The wizard tells the two
    apart by case (SCREAMING_SNAKE = this backend's, lower_snake = coord's), so
    the generic arm must stay recognizably generic."""
    client = TestClient(_build_test_app_with_real_error_handler())
    patched = _patched_client(_text_response(409, "coord said something odd"))
    with patch("httpx.AsyncClient", return_value=patched):
        res = client.post(ACCEPT_URL, json=ACCEPT_BODY)

    assert res.status_code == 409
    body = res.json()
    assert body["error"] == "CONFLICT"
    assert body["error"].isupper()
    assert body["message"] == "coord said something odd"
