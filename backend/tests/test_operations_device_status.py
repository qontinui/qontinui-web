"""Integration tests for the Phase 1.3 device-status endpoints.

Plan ``D:/qontinui-root/plans/2026-05-21-coordination-improvements.md``
Phase 1.3. Two endpoints:

* ``GET  /api/v1/operations/device-status``      — REST proxy to
  ``GET /coord/status?tenant_id=<uuid>``.
* ``WS   /api/v1/operations/device-status/ws``   — bridges browser to
  coord's typed ``/ws/device-status`` channel after minting a
  tenant-scoped service JWT.

Mirrors the testing pattern in :mod:`test_operations_coord_dashboard_proxy`
(minimal FastAPI app + mocked ``httpx.AsyncClient``) plus a mocked
``websockets.connect`` for the bridge.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

# Stable tenant_id the in-test resolver returns; tests assert the
# coord call carries it on `?tenant_id=…`.
_FIXTURE_TENANT_ID = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


def _build_test_app(*, resolves_tenant: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router.

    ``resolves_tenant=True`` overrides the tenant resolver to return
    ``_FIXTURE_TENANT_ID``. ``False`` makes it raise 403
    ``tenant_not_resolved``.
    """
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "phase13.user@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None

    if resolves_tenant:

        async def _resolver() -> UUID:
            return _FIXTURE_TENANT_ID
    else:

        async def _resolver() -> UUID:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_not_resolved",
            )

    test_app.dependency_overrides[get_tenant_id] = _resolver
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=True))


@pytest.fixture()
def unresolved_client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=False))


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")

    def _raise_for_status() -> None:
        if status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {status_code}", request=MagicMock(), response=resp
            )

    resp.raise_for_status.side_effect = _raise_for_status
    return resp


def _patch_httpx():
    # The new endpoint helpers live in ``app.services.coord_device_status``,
    # which is where httpx.AsyncClient is constructed.
    return patch("app.services.coord_device_status.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


API_PREFIX = "/api/v1/operations"


# ---------------------------------------------------------------------------
# GET /operations/device-status
# ---------------------------------------------------------------------------


class TestGetDeviceStatus:
    def test_returns_rows_scoped_to_caller_tenant(self, client: TestClient) -> None:
        coord_payload = {
            "devices": [
                {
                    "device_id": "11111111-1111-1111-1111-111111111111",
                    "hostname": "spaceship",
                    "current_task": "implement-plan: foo",
                    "current_repo": "qontinui-web",
                    "current_branch": "feat/bar",
                    "free_text": None,
                    "details": {"phase": "2/5"},
                    "updated_at": "2026-05-21T12:00:00Z",
                    "tenant_id": str(_FIXTURE_TENANT_ID),
                },
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/device-status")

        assert resp.status_code == 200
        assert resp.json() == coord_payload

        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/status")
        called_params = instance.get.call_args.kwargs.get("params", {})
        # Tenant scope flows as a query param (coord's GET /coord/status
        # filters server-side).
        assert called_params.get("tenant_id") == str(_FIXTURE_TENANT_ID)
        # No `since=` means the param is absent.
        assert "since" not in called_params

    def test_forwards_since_filter(self, client: TestClient) -> None:
        mock_resp = _mock_response(json_data={"devices": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/device-status?since=2026-05-21T00:00:00Z")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("since") == "2026-05-21T00:00:00Z"

    def test_empty_payload_when_no_devices_reporting(self, client: TestClient) -> None:
        # The empty list is intentional — non-tenant operators (or
        # tenants with no live status rows) get an empty list, not a 404.
        mock_resp = _mock_response(json_data={"devices": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/device-status")
        assert resp.status_code == 200
        body = resp.json()
        assert body["devices"] == []
        assert body["count"] == 0

    def test_tenant_not_resolved_returns_403(
        self, unresolved_client: TestClient
    ) -> None:
        resp = unresolved_client.get(f"{API_PREFIX}/device-status")
        assert resp.status_code == 403
        assert resp.json() == {"detail": "tenant_not_resolved"}

    def test_coord_unreachable_returns_502(self, client: TestClient) -> None:
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/device-status")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# WS /operations/device-status/ws — bridge
# ---------------------------------------------------------------------------
#
# The bridge minted-token + upstream WS path goes through asyncio +
# `websockets.connect`. We assert mint-failure and disabled-feature
# branches at the service level (no FastAPI WS roundtrip needed), and
# verify the upstream forwarding contract via a direct unit-test of
# the service module's `build_device_status_ws_url`.


class TestDeviceStatusServiceModule:
    """Unit tests for the bridge service helpers — no FastAPI WS roundtrip.

    The WS endpoint itself wires these helpers together with FastAPI's
    `WebSocket` and `websockets.connect`; the meaningful behaviour we
    care about (token mint payload + URL scheme translation) is fully
    covered here. WS endpoint smoke is left to integration testing
    against a live coord (see the manual-smoke notes in the PR body).
    """

    def test_disabled_when_admin_secret_unset(self) -> None:
        from app.services.coord_device_status import (
            CoordDeviceStatusDisabledError,
            mint_device_status_token,
        )

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_ADMIN_SECRET = None
            mock_settings.COORD_URL = "http://localhost:9870"
            with pytest.raises(CoordDeviceStatusDisabledError):
                asyncio.run(mint_device_status_token(tenant_id=_FIXTURE_TENANT_ID))

    def test_mint_sends_tenant_id_in_payload(self) -> None:
        from app.services.coord_device_status import mint_device_status_token

        mock_resp = _mock_response(
            json_data={
                "token": "fake.jwt.token",
                "sub": "service:qontinui-web-device-status",
                "jti": str(uuid4()),
                "exp": 9999999999,
            }
        )

        with (
            patch("app.services.coord_device_status.settings") as mock_settings,
            patch("app.services.coord_device_status.httpx.AsyncClient") as MockClient,
        ):
            mock_settings.COORD_ADMIN_SECRET = "test-admin-secret"
            mock_settings.COORD_URL = "http://localhost:9870"
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            token = asyncio.run(mint_device_status_token(tenant_id=_FIXTURE_TENANT_ID))

        assert token == "fake.jwt.token"
        # Verify coord saw the tenant_id in the JSON body and the
        # admin secret in the header.
        called_kwargs = instance.post.call_args.kwargs
        body = called_kwargs["json"]
        assert body["tenant_id"] == str(_FIXTURE_TENANT_ID)
        assert body["service_name"] == "qontinui-web-device-status"
        assert called_kwargs["headers"]["X-Coord-Admin-Secret"] == "test-admin-secret"

    def test_mint_failure_raises(self) -> None:
        from app.services.coord_device_status import (
            CoordDeviceStatusMintFailedError,
            mint_device_status_token,
        )

        mock_resp = _mock_response(status_code=401, text='{"error":"bad secret"}')

        with (
            patch("app.services.coord_device_status.settings") as mock_settings,
            patch("app.services.coord_device_status.httpx.AsyncClient") as MockClient,
        ):
            mock_settings.COORD_ADMIN_SECRET = "test-admin-secret"
            mock_settings.COORD_URL = "http://localhost:9870"
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            with pytest.raises(CoordDeviceStatusMintFailedError):
                asyncio.run(mint_device_status_token(tenant_id=_FIXTURE_TENANT_ID))

    def test_ws_url_translates_http_to_ws(self) -> None:
        from app.services.coord_device_status import build_device_status_ws_url

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_URL = "http://localhost:9870"
            assert build_device_status_ws_url("abc") == (
                "ws://localhost:9870/ws/device-status?token=abc"
            )

    def test_ws_url_translates_https_to_wss(self) -> None:
        from app.services.coord_device_status import build_device_status_ws_url

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_URL = "https://coord.qontinui.io"
            url = build_device_status_ws_url("abc.def.ghi")
            assert url == (
                "wss://coord.qontinui.io/ws/device-status?token=abc.def.ghi"
            )


# ---------------------------------------------------------------------------
# WS bridge — FastAPI integration smoke (mocks `websockets.connect`)
# ---------------------------------------------------------------------------


class TestDeviceStatusWsBridge:
    """End-to-end bridge smoke. The browser side is the FastAPI TestClient's
    WS roundtrip; the upstream coord side is a mocked `websockets.connect`
    that yields a single `device_status.changed` frame.

    Covers:
    * happy-path: browser receives the forwarded frame verbatim.
    * cleanup: when the browser disconnects, the upstream is closed.
    """

    def _build_test_app_with_ws_auth(self) -> FastAPI:
        # The WS handler authenticates via `get_current_user_from_ws`;
        # the REST endpoints use a separate dependency override path.
        # We bypass cookies entirely by patching `get_current_user_from_ws`.
        return _build_test_app(resolves_tenant=True)

    def test_bridge_forwards_upstream_frame(self) -> None:
        test_app = self._build_test_app_with_ws_auth()
        ws_client = TestClient(test_app)

        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "phase13.ws@example.com"

        # Upstream coord WS — yield exactly one frame then close.
        coord_frame = json.dumps(
            {
                "kind": "device_status.changed",
                "row": {
                    "device_id": "11111111-1111-1111-1111-111111111111",
                    "hostname": "spaceship",
                    "current_task": "manual smoke",
                    "tenant_id": str(_FIXTURE_TENANT_ID),
                    "updated_at": "2026-05-21T12:00:01Z",
                },
            }
        )

        class MockUpstream:
            def __init__(self) -> None:
                self.sent: list[str] = []
                self._frames = [coord_frame]
                self.closed = False

            async def send(self, message: str) -> None:
                self.sent.append(message)

            def __aiter__(self) -> MockUpstream:
                return self

            async def __anext__(self) -> str:
                if not self._frames:
                    # Hold until cancelled — simulates a live upstream
                    # waiting for the next change. The test will close
                    # the browser side which cancels the pump.
                    await asyncio.sleep(3600)
                return self._frames.pop(0)

            async def close(self) -> None:
                self.closed = True

        upstream_mock = MockUpstream()

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            assert "token=fake.jwt.token" in url
            assert url.endswith("/ws/device-status?token=fake.jwt.token")
            return upstream_mock

        async def fake_mint(*, tenant_id: UUID) -> str:
            assert tenant_id == _FIXTURE_TENANT_ID
            return "fake.jwt.token"

        async def fake_get_user_from_ws(token: str) -> Any:
            return mock_user

        # The session loading inside the WS handler uses
        # AsyncSessionLocal; bypass it with a trivial context manager.
        class _FakeSession:
            async def __aenter__(self) -> _FakeSession:
                return self

            async def __aexit__(self, *args: Any) -> None:
                return None

        async def fake_resolve_tenant_for_user(user: Any, db: Any) -> UUID:
            return _FIXTURE_TENANT_ID

        with (
            patch(
                "app.api.v1.endpoints.operations.get_current_user_from_ws",
                fake_get_user_from_ws,
            ),
            patch(
                "app.api.v1.endpoints.operations.AsyncSessionLocal",
                lambda: _FakeSession(),
            ),
            patch(
                "app.api.v1.endpoints.operations.resolve_tenant_for_user",
                fake_resolve_tenant_for_user,
            ),
            patch(
                "app.api.v1.endpoints.operations.mint_device_status_token",
                fake_mint,
            ),
            patch(
                "app.api.v1.endpoints.operations.websockets_connect",
                fake_connect,
            ),
        ):
            with ws_client.websocket_connect(
                f"{API_PREFIX}/device-status/ws?token=session-jwt"
            ) as ws:
                received = ws.receive_text()
                assert json.loads(received) == json.loads(coord_frame)
                # Closing here propagates a WS close → the pump exits
                # → the bridge's finally{} closes the upstream.

        # The first message the bridge sends upstream is the subscribe.
        assert len(upstream_mock.sent) == 1
        subscribe = json.loads(upstream_mock.sent[0])
        assert subscribe == {
            "action": "subscribe",
            "topic": f"device_status:{_FIXTURE_TENANT_ID}",
        }
        # Upstream MUST be closed when the browser side disconnects.
        assert upstream_mock.closed is True

    def test_bridge_closes_cleanly_on_browser_disconnect(self) -> None:
        # Same wiring as the forwarding test, but we never read on the
        # browser side — disconnect immediately on entering the
        # context. The upstream's `close()` must still fire.
        test_app = self._build_test_app_with_ws_auth()
        ws_client = TestClient(test_app)

        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "phase13.disconnect@example.com"

        class MockUpstream:
            def __init__(self) -> None:
                self.closed = False
                self.sent: list[str] = []

            async def send(self, message: str) -> None:
                self.sent.append(message)

            def __aiter__(self) -> MockUpstream:
                return self

            async def __anext__(self) -> str:
                # Block forever — only the browser disconnect ends the bridge.
                await asyncio.sleep(3600)
                raise AssertionError("unreachable")

            async def close(self) -> None:
                self.closed = True

        upstream_mock = MockUpstream()

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            return upstream_mock

        async def fake_mint(*, tenant_id: UUID) -> str:
            return "fake.jwt.token"

        async def fake_get_user_from_ws(token: str) -> Any:
            return mock_user

        class _FakeSession:
            async def __aenter__(self) -> _FakeSession:
                return self

            async def __aexit__(self, *args: Any) -> None:
                return None

        async def fake_resolve_tenant_for_user(user: Any, db: Any) -> UUID:
            return _FIXTURE_TENANT_ID

        with (
            patch(
                "app.api.v1.endpoints.operations.get_current_user_from_ws",
                fake_get_user_from_ws,
            ),
            patch(
                "app.api.v1.endpoints.operations.AsyncSessionLocal",
                lambda: _FakeSession(),
            ),
            patch(
                "app.api.v1.endpoints.operations.resolve_tenant_for_user",
                fake_resolve_tenant_for_user,
            ),
            patch(
                "app.api.v1.endpoints.operations.mint_device_status_token",
                fake_mint,
            ),
            patch(
                "app.api.v1.endpoints.operations.websockets_connect",
                fake_connect,
            ),
        ):
            with ws_client.websocket_connect(
                f"{API_PREFIX}/device-status/ws?token=session-jwt"
            ):
                # Immediate exit — TestClient closes the browser side.
                pass

        assert upstream_mock.closed is True
