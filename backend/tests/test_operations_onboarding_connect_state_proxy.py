"""Connect-state mint proxy: ``POST /pr-merge/onboarding/connect-state``.

Plan ``2026-07-26-coord-onboarding-claim-caller-tenant-binding`` P2. Coord's
mint is gated on an operator Cognito context (its ``TenantId`` extractor
resolves from nothing else), so this proxy is the only door the browser — and
later the desktop runner — has to it. What matters here:

* the caller's identity is the ONLY input to the *tenant*: nothing from a
  request body may influence which tenant the minted token binds to;
* the ``flow`` the caller declares IS forwarded, because coord derives the
  claim's ``bind_only`` from the minted row rather than from the claim body
  (§7.5 F2) — dropping it here would silently hand that decision back to
  whoever POSTs the claim;
* a target is forwarded only when the caller actually knows one, and is never
  invented;
* coord's status + JSON body pass through verbatim, so a failed mint surfaces as
  a retryable error in the connect UI rather than a blank navigation to a
  stateless GitHub URL;
* transport failures map the same way as every other operations proxy
  (ConnectError → 502, TimeoutException → 504).

Mirrors the mocked-``httpx`` pattern in
``test_operations_onboarding_claim_target.py`` — no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()

MINT_URL = "/api/v1/operations/pr-merge/onboarding/connect-state"


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


def _patched_post(resp: MagicMock | None = None, side_effect=None) -> MagicMock:
    mock_client = MagicMock()
    mock_client.post = AsyncMock(return_value=resp, side_effect=side_effect)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


def test_mint_forwards_to_coord_and_returns_token(auth_client: TestClient) -> None:
    """The plaintext token coord returns once must reach the caller intact."""
    from app.api.v1.endpoints.operations import COORD_ONBOARDING_CONNECT_STATE_PATH

    client = _patched_post(
        _mock_response(json_data={"connect_state": "ab12", "expires_at": "2026-01-01"})
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json={"flow": "connect"})

    assert res.status_code == 200
    assert res.json()["connect_state"] == "ab12"
    assert client.post.call_args.args[0].endswith(COORD_ONBOARDING_CONNECT_STATE_PATH)


def test_mint_takes_no_tenant_from_the_body(auth_client: TestClient) -> None:
    """A body-supplied tenant_id must not reach coord.

    The whole point of the token is that its tenant comes from the authenticated
    caller. If a body field could ride along, the mint would reintroduce exactly
    the free-parameter tenant the plan removes from the claim. The payload is
    built from an explicit key allowlist, never from ``model_dump()``, so an
    unknown key is dropped rather than proxied.
    """
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    attacker_tenant = str(uuid4())
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(
            MINT_URL, json={"flow": "connect", "tenant_id": attacker_tenant}
        )

    payload = client.post.call_args.kwargs["json"]
    assert attacker_tenant not in str(payload)
    assert payload == {"flow": "connect"}


@pytest.mark.parametrize("flow", ["connect", "runner-clone"])
def test_mint_forwards_the_declared_flow(auth_client: TestClient, flow: str) -> None:
    """The flow must reach coord — it is what pins ``bind_only`` server-side.

    If the flow stopped at this proxy, ``bind_only`` would stay a claim-body
    field the caller picks — the F2 escalation this whole change exists to
    remove.
    """
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json={"flow": flow})

    assert res.status_code == 200
    assert client.post.call_args.kwargs["json"] == {"flow": flow}


def test_mint_forwards_a_known_target(auth_client: TestClient) -> None:
    """The authorize path knows the org before the GitHub hop — bind it."""
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(
            MINT_URL,
            json={
                "flow": "connect",
                "target_login": "acme-org",
                "target_installation_id": 4242,
            },
        )

    assert client.post.call_args.kwargs["json"] == {
        "flow": "connect",
        "target_login": "acme-org",
        "target_installation_id": 4242,
    }


@pytest.mark.parametrize(
    "body", [{"flow": "connect"}, {"flow": "connect", "target_login": None}]
)
def test_mint_never_invents_a_target(auth_client: TestClient, body: dict) -> None:
    """No target on the fresh-install path — GitHub names the org after the mint.

    Coord skips the target assertion for a row that records none, so an absent
    target must stay absent: a guessed login would 403 every legitimate fresh
    install.
    """
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        auth_client.post(MINT_URL, json=body)

    assert client.post.call_args.kwargs["json"] == {"flow": "connect"}


def test_mint_rejects_an_unknown_flow(auth_client: TestClient) -> None:
    """An out-of-range flow must fail here, not become an opaque coord 400."""
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json={"flow": "enroll-everything"})

    assert res.status_code == 422
    client.post.assert_not_called()


@pytest.mark.parametrize("body", [None, {}, {"target_login": "acme-org"}])
def test_mint_refuses_to_mint_without_a_flow(
    auth_client: TestClient, body: dict | None
) -> None:
    """A flow-less mint must not reach coord — that is the F2 bypass.

    Coord keeps ``flow`` optional for its own compatibility, but this proxy is
    the only door to coord's mint, so requiring it HERE is what makes every
    minted row carry one. Without this, the attacker who is already
    hand-crafting the claim just POSTs an empty body, gets a flow-less row and
    picks ``bind_only`` on the claim after all.
    """
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json=body)

    assert res.status_code == 422
    client.post.assert_not_called()


@pytest.mark.parametrize(
    "target_login",
    ["", "   ", "acme~org", "-leading-hyphen", "a" * 40],
)
def test_mint_rejects_an_impossible_target_login(
    auth_client: TestClient, target_login: str
) -> None:
    """Bound + charset-check the target here rather than at coord.

    The browser validates the org before minting, but this route is directly
    reachable. A ``~`` in particular would collide with the delimiter of the
    ``<flow>~<login>~<nonce>~<connect_state>`` GitHub ``state`` wire format, and
    an unbounded string has no business reaching coord at all.
    """
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            MINT_URL, json={"flow": "connect", "target_login": target_login}
        )

    assert res.status_code == 422
    client.post.assert_not_called()


@pytest.mark.parametrize("target_installation_id", [0, -1, 2**63])
def test_mint_rejects_an_out_of_range_installation_id(
    auth_client: TestClient, target_installation_id: int
) -> None:
    """Python ints are unbounded; coord deserializes into ``i64``.

    Without the range check an oversize value validates here and becomes the
    opaque coord 400 that the sibling ``target_login`` check exists to avoid.
    """
    client = _patched_post(_mock_response(json_data={"connect_state": "ab12"}))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(
            MINT_URL,
            json={
                "flow": "connect",
                "target_installation_id": target_installation_id,
            },
        )

    assert res.status_code == 422
    client.post.assert_not_called()


@pytest.mark.parametrize(("status", "code"), [(401, "unauthorized"), (500, "boom")])
def test_mint_failures_pass_through_verbatim(
    auth_client: TestClient, status: int, code: str
) -> None:
    """A failed mint must be distinguishable, so the UI can offer a real retry."""
    client = _patched_post(
        _mock_response(status_code=status, json_data={"error": code})
    )
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json={"flow": "connect"})

    assert res.status_code == status
    assert res.json()["error"] == code


def test_mint_maps_coord_unreachable_to_502(auth_client: TestClient) -> None:
    client = _patched_post(side_effect=httpx.ConnectError("nope"))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json={"flow": "connect"})
    assert res.status_code == 502


def test_mint_maps_coord_timeout_to_504(auth_client: TestClient) -> None:
    client = _patched_post(side_effect=httpx.TimeoutException("slow"))
    with patch("httpx.AsyncClient", return_value=client):
        res = auth_client.post(MINT_URL, json={"flow": "connect"})
    assert res.status_code == 504
