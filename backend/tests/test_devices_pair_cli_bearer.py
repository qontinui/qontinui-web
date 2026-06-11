"""Tests for ``POST /api/v1/devices/pair-cli`` operator-bearer forwarding.

Follow-up #1 of plan
``D:/qontinui-root/plans/2026-05-30-coord-operator-resolver-removal.md``.

Web's ``pair_cli`` used to resolve the caller's ``tenant_id`` server-side
(``resolve_tenant_for_user``) and forward a MINTED service token +
``X-Qontinui-User-Id`` to coord. Coord now derives the tenant from the
forwarded Cognito **operator bearer** via its ``resolve_operator_optional``
middleware, so web must:

  * forward ``Authorization: Bearer <caller Cognito token>`` (NOT the minted
    service token),
  * keep ``X-Qontinui-User-Id`` (coord still requires it for attribution),
  * DROP ``tenant_id`` from the request body,
  * fail 401 when no caller bearer is present.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.strategy import strategy_client

_USER_ID = uuid4()
_CALLER_TOKEN = "cognito-operator-token-abc123"
_DEVICE_ID = "00000000-0000-0000-0000-deadbeefcafe"
API_PREFIX = "/api/v1/devices"


def _build_test_app() -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
    )
    from app.api.v1.endpoints.devices import router as devices_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = _USER_ID
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(devices_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 201, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    # The outbound POST now lives in the shared coord_proxy helper
    # (retry + honest-503 wrapper) — patch the client there.
    return patch("app.services.coord_proxy.httpx.AsyncClient")


def _patch_enabled(*, enabled: bool = True):
    # ``strategy_client.enabled`` is a property backed by ``_admin_secret``;
    # patch the backing attr so the 503 short-circuit fires (or not). We do NOT
    # mock ``_headers`` because the endpoint no longer uses the minted service
    # token — it forwards the caller's Cognito bearer instead.
    return patch.object(
        strategy_client,
        "_admin_secret",
        "test-secret" if enabled else None,
    )


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


_COORD_OK = {
    "device_id": _DEVICE_ID,
    "token": "device-token-jwt",
}

_BODY = {
    "device_id": _DEVICE_ID,
    "hostname": "spaceship",
    "name": "spaceship-runner",
}


class TestPairCliBearerForwarding:
    def test_forwards_caller_bearer_and_user_id_no_tenant(
        self, client: TestClient
    ) -> None:
        with _patch_enabled(), _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=_COORD_OK)
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-cli",
                json=_BODY,
                headers={"Authorization": f"Bearer {_CALLER_TOKEN}"},
            )

        assert resp.status_code == 201, resp.text
        assert resp.json()["device_id"] == _DEVICE_ID

        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/devices/pair-cli")

        # Header assertions: caller Cognito bearer forwarded verbatim + user id.
        headers = instance.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"
        assert headers["X-Qontinui-User-Id"] == str(_USER_ID)

        # Body assertions: tenant_id NO LONGER sent; coord derives it.
        body = instance.post.call_args.kwargs["json"]
        assert "tenant_id" not in body
        assert body["device_id"] == _DEVICE_ID
        assert body["hostname"] == "spaceship"
        assert body["name"] == "spaceship-runner"
        assert body["user_id"] == str(_USER_ID)

    def test_accepts_bearer_from_access_token_cookie(self, client: TestClient) -> None:
        with _patch_enabled(), _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=_COORD_OK)
            _configure_mock_client(MockClient, instance)

            client.cookies.set("access_token", _CALLER_TOKEN)
            resp = client.post(f"{API_PREFIX}/pair-cli", json=_BODY)

        assert resp.status_code == 201, resp.text
        headers = instance.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"

    def test_missing_caller_bearer_returns_401(self, client: TestClient) -> None:
        with _patch_enabled(), _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(f"{API_PREFIX}/pair-cli", json=_BODY)

        assert resp.status_code == 401
        instance.post.assert_not_called()

    def test_coord_disabled_returns_503(self, client: TestClient) -> None:
        with _patch_enabled(enabled=False), _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/pair-cli",
                json=_BODY,
                headers={"Authorization": f"Bearer {_CALLER_TOKEN}"},
            )
        assert resp.status_code == 503
        instance.post.assert_not_called()
