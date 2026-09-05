"""``POST /api/v1/devices/pair-confirm`` — what web sends coord (arm B).

Coord's ``POST /coord/devices/pair-complete`` mints a device JWT only for a
caller it verified (qontinui-coord ``pairing_auth``, plan
``2026-09-04-pair-complete-mints-a-device-jwt-for-any-caller``). The browser
flow's credential is coord's **arm B**: the web service token
(``sub = service:qontinui-web-strategy``, ``strategy_admin``) in
``Authorization`` plus the signed-in user in ``X-Qontinui-User-Id``. Coord
reads the user from that header and proves its tenant membership itself, so
the body carries NO identity — exactly ``{state, device_id}``.

These tests pin the wire shape web sends: the two headers coord verifies are
present and correct, the body is the two-field contract, and the two former
unverified fields (``web_session_token`` sentinel, ``user_id``) are gone.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.strategy import strategy_client

_USER_ID = uuid4()
_SERVICE_TOKEN = "coord-service-jwt-for-qontinui-web-strategy"
_DEVICE_ID = "00000000-0000-0000-0000-deadbeefcafe"
_STATE = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"
API_PREFIX = "/api/v1/devices"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.devices import router as devices_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = _USER_ID
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.include_router(devices_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _patches():
    """Enable the coord integration, make the linked-operator gate pass, hand
    out a deterministic service header pair, and capture the outbound POST
    (which lives in the shared ``coord_proxy`` helper)."""
    return (
        patch.object(strategy_client, "_admin_secret", "test-secret"),
        patch(
            "app.api.v1.endpoints.devices.get_coord_identity",
            new=AsyncMock(return_value=MagicMock()),
        ),
        patch.object(
            strategy_client,
            "_ensure_token",
            new=AsyncMock(return_value=_SERVICE_TOKEN),
        ),
        patch("app.services.coord_proxy.httpx.AsyncClient"),
    )


_COORD_OK = {
    "token": "device-token-jwt",
    "device_id": _DEVICE_ID,
    "user_id": str(_USER_ID),
    "jti": str(uuid4()),
    "exp": 1234567890,
}


class TestPairConfirmSendsCoordArmB:
    def test_body_is_state_and_device_id_only_identity_rides_the_headers(
        self, client: TestClient
    ) -> None:
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=_COORD_OK)
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 201, resp.text
        assert resp.json()["device_id"] == _DEVICE_ID
        assert resp.json()["token"] == "device-token-jwt"
        assert resp.json()["state"] == _STATE

        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/devices/pair-complete")

        # Arm B: the web SERVICE token (not the user's bearer) + the user.
        headers = instance.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_SERVICE_TOKEN}"
        assert headers["X-Qontinui-User-Id"] == str(_USER_ID)

        # The body carries no identity: coord's contract is {state, device_id}.
        body = instance.post.call_args.kwargs["json"]
        assert body == {"state": _STATE, "device_id": _DEVICE_ID}
        assert "web_session_token" not in body
        assert "user_id" not in body

    def test_coord_membership_refusal_surfaces_as_502_with_coord_body(
        self, client: TestClient
    ) -> None:
        """Coord's 403 ``tenant_membership_required`` (the user's operator is
        not a member of the flow's tenant) is relayed, not masked."""
        refusal = {
            "error": "the verified identity is not a member of the requested tenant",
            "code": "tenant_membership_required",
            "hint": "restart pairing",
        }
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=403, json_data=refusal, text=str(refusal)
            )
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 502, resp.text
        detail = resp.json()["detail"]
        assert detail["coord_status"] == 403
        assert "tenant_membership_required" in detail["coord_body"]

    def test_unlinked_operator_is_refused_before_any_outbound_call(
        self, client: TestClient
    ) -> None:
        from fastapi import HTTPException

        enabled, _gate, token, httpx_client = _patches()
        gate = patch(
            "app.api.v1.endpoints.devices.get_coord_identity",
            new=AsyncMock(
                side_effect=HTTPException(status_code=403, detail="tenant_not_resolved")
            ),
        )
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 403
        instance.post.assert_not_called()
