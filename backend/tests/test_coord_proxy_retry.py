"""Tests for ``app.services.coord_proxy.post_to_coord``.

Regression pins for the 2026-06-11 incident: during a coord rolling
deploy the pairing endpoints failed their single POST and surfaced
``502 INTERNAL_SERVER_ERROR "Coord unreachable."`` to the login flow.

Policy under test:

* connect-level failures (request provably never reached coord) and
  gateway 502/503/504 responses are retried;
* exhausted retries → **503 + Retry-After** (honest, retryable), not 502;
* read timeouts are NOT retried (the request may have been processed) → 504;
* coord's own 4xx rejections pass through with no retry;
* the error-handler envelope labels 503 as SERVICE_UNAVAILABLE (not
  INTERNAL_SERVER_ERROR) and preserves the Retry-After header.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.middleware.error_handler import http_exception_handler
from app.services.coord_proxy import post_to_coord


def _mock_response(status_code: int = 201, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = str(json_data or "")
    return resp


def _patch_client(post_side_effects) -> tuple:
    """Patch coord_proxy's AsyncClient; ``post_side_effects`` is the
    sequence of responses/exceptions the mocked ``post`` produces."""
    instance = AsyncMock()
    instance.post.side_effect = post_side_effects
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    patcher = patch("app.services.coord_proxy.httpx.AsyncClient", return_value=instance)
    return patcher, instance


def _patch_sleep():
    return patch("app.services.coord_proxy.asyncio.sleep", new=AsyncMock())


@pytest.mark.asyncio
class TestPostToCoordRetry:
    async def test_connect_error_then_success_is_retried(self) -> None:
        ok = _mock_response(201)
        patcher, instance = _patch_client(
            [httpx.ConnectError("connection refused"), ok]
        )
        with patcher, _patch_sleep():
            resp = await post_to_coord(
                "/coord/devices/pair-cli",
                headers={},
                json_body={},
                log_event="test",
            )
        assert resp is ok
        assert instance.post.call_count == 2

    async def test_persistent_connect_error_maps_to_503_retry_after(self) -> None:
        patcher, instance = _patch_client(httpx.ConnectError("connection refused"))
        with patcher, _patch_sleep(), pytest.raises(HTTPException) as exc_info:
            await post_to_coord(
                "/coord/devices/pair-cli",
                headers={},
                json_body={},
                log_event="test",
            )
        assert exc_info.value.status_code == 503
        assert exc_info.value.headers["Retry-After"]
        assert exc_info.value.detail["error"] == "SERVICE_UNAVAILABLE"
        assert instance.post.call_count == 3

    async def test_gateway_503_then_success_is_retried(self) -> None:
        ok = _mock_response(200)
        patcher, instance = _patch_client([_mock_response(503), ok])
        with patcher, _patch_sleep():
            resp = await post_to_coord(
                "/coord/devices/pair-cli",
                headers={},
                json_body={},
                log_event="test",
            )
        assert resp is ok
        assert instance.post.call_count == 2

    async def test_persistent_gateway_502_maps_to_503(self) -> None:
        patcher, instance = _patch_client(
            [_mock_response(502), _mock_response(502), _mock_response(502)]
        )
        with patcher, _patch_sleep(), pytest.raises(HTTPException) as exc_info:
            await post_to_coord(
                "/coord/devices/pair-cli",
                headers={},
                json_body={},
                log_event="test",
            )
        assert exc_info.value.status_code == 503
        assert instance.post.call_count == 3

    async def test_coord_4xx_passes_through_without_retry(self) -> None:
        rejected = _mock_response(403)
        patcher, instance = _patch_client([rejected])
        with patcher, _patch_sleep():
            resp = await post_to_coord(
                "/coord/devices/pair-cli",
                headers={},
                json_body={},
                log_event="test",
            )
        assert resp is rejected
        assert instance.post.call_count == 1

    async def test_read_timeout_is_not_retried_maps_to_504(self) -> None:
        patcher, instance = _patch_client(httpx.ReadTimeout("read timed out"))
        with patcher, _patch_sleep(), pytest.raises(HTTPException) as exc_info:
            await post_to_coord(
                "/coord/devices/pair-cli",
                headers={},
                json_body={},
                log_event="test",
            )
        assert exc_info.value.status_code == 504
        assert instance.post.call_count == 1


class TestErrorEnvelope:
    """The standardized error envelope must label gateway statuses
    honestly and preserve the Retry-After header end to end."""

    def _build_app(self) -> FastAPI:
        from app.api.deps import get_async_db, get_current_active_user_async
        from app.api.v1.endpoints.devices import router as devices_router
        from app.services.strategy import strategy_client  # noqa: F401

        app = FastAPI()
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.is_active = True
        app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        app.dependency_overrides[get_async_db] = lambda: None
        app.include_router(devices_router, prefix="/api/v1/devices")
        app.add_exception_handler(StarletteHTTPException, http_exception_handler)
        return app

    def test_pair_cli_coord_down_returns_503_envelope_with_retry_after(self) -> None:
        from app.services.strategy import strategy_client

        client = TestClient(self._build_app())
        patcher, instance = _patch_client(httpx.ConnectError("connection refused"))
        with (
            patch.object(strategy_client, "_admin_secret", "test-secret"),
            patcher,
            _patch_sleep(),
        ):
            resp = client.post(
                "/api/v1/devices/pair-cli",
                json={
                    "device_id": "00000000-0000-0000-0000-deadbeefcafe",
                    "hostname": "spaceship",
                    "name": "spaceship-runner",
                },
                headers={"Authorization": "Bearer cognito-operator-token"},
            )

        assert resp.status_code == 503
        assert resp.headers.get("Retry-After")
        body = resp.json()
        # The 2026-06-11 incident surfaced INTERNAL_SERVER_ERROR — pin the
        # honest label.
        assert body["error"] == "SERVICE_UNAVAILABLE"
        assert "retry" in body["message"].lower()
        assert instance.post.call_count == 3
