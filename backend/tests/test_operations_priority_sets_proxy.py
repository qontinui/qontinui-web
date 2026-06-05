"""Integration tests for the coord priority-sets + composition-rules proxy.

These endpoints (under ``/api/v1/operations/coord/priority-sets*`` and
``/api/v1/operations/coord/composition-rules*``) forward CRUD to coord so
the tenant-settings UI can manage priority sets / composition rules without
the browser hitting coord cross-origin. Every route is tenant-admin gated
(``require_coord_tenant_admin``).

Mirrors ``test_operations_merge_proxy.py``: a minimal FastAPI app + mocked
``httpx.AsyncClient`` so no live coord is needed. The admin gate is
overridden via ``dependency_overrides`` so the proxy path doesn't hit a real
coord ``/admin/coord/me``.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, authenticated: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        # The priority-set / composition-rule proxies are gated by
        # ``require_coord_tenant_admin`` (resolves home tenant + asserts
        # coord ``is_admin``). Override it so the proxy path doesn't hit a
        # real coord ``/admin/coord/me``.
        test_app.dependency_overrides[require_coord_tenant_admin] = lambda: uuid4()
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app(authenticated=True))


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


API_PREFIX = "/api/v1/operations"


# ---------------------------------------------------------------------------
# priority-sets
# ---------------------------------------------------------------------------


class TestListPrioritySets:
    def test_returns_list(self, auth_client: TestClient):
        coord_payload = [
            {"id": "ps1", "name": "throughput-first", "rules": []},
            {"id": "ps2", "name": "risk-first", "rules": []},
        ]
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/priority-sets")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        instance.get.assert_called_once()
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/priority-sets")

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/priority-sets")

        assert resp.status_code == 502
        assert "coord is not reachable" in resp.json()["detail"]


class TestCreatePrioritySet:
    _PAYLOAD = {"name": "throughput-first", "rules": [{"priority": "throughput"}]}

    def test_proxies_post(self, auth_client: TestClient):
        coord_resp_body = {"id": "ps-new", **self._PAYLOAD}
        mock_resp = _mock_response(json_data=coord_resp_body)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/priority-sets", json=self._PAYLOAD
            )

        assert resp.status_code == 200
        assert resp.json() == coord_resp_body
        instance.post.assert_called_once()
        called_url = instance.post.call_args.args[0]
        called_body = instance.post.call_args.kwargs["json"]
        assert called_url.endswith("/coord/priority-sets")
        assert called_body == self._PAYLOAD

    def test_duplicate_name_409_passes_through(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=409, text="duplicate_set_name")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/priority-sets", json=self._PAYLOAD
            )

        assert resp.status_code == 409
        assert "duplicate_set_name" in resp.json()["detail"]


class TestUpdatePrioritySet:
    def test_proxies_patch(self, auth_client: TestClient):
        body = {"name": "renamed"}
        coord_resp_body = {"id": "ps1", "name": "renamed", "rules": []}
        mock_resp = _mock_response(json_data=coord_resp_body)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(f"{API_PREFIX}/coord/priority-sets/ps1", json=body)

        assert resp.status_code == 200
        assert resp.json() == coord_resp_body
        called_url = instance.patch.call_args.args[0]
        called_body = instance.patch.call_args.kwargs["json"]
        assert called_url.endswith("/coord/priority-sets/ps1")
        assert called_body == body

    def test_unknown_id_404_passes_through(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=404, text="not found")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/priority-sets/missing", json={"name": "x"}
            )

        assert resp.status_code == 404


class TestDeletePrioritySet:
    def test_proxies_delete(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"deleted": True})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.delete.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.delete(f"{API_PREFIX}/coord/priority-sets/ps1")

        assert resp.status_code == 200
        assert resp.json() == {"deleted": True}
        called_url = instance.delete.call_args.args[0]
        assert called_url.endswith("/coord/priority-sets/ps1")


# ---------------------------------------------------------------------------
# composition-rules
# ---------------------------------------------------------------------------


class TestListCompositionRules:
    def test_returns_list(self, auth_client: TestClient):
        coord_payload = [{"id": "cr1", "name": "default"}]
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/composition-rules")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/composition-rules")


class TestCreateCompositionRule:
    _PAYLOAD = {"name": "default", "priority_set_ids": ["ps1", "ps2"]}

    def test_proxies_post(self, auth_client: TestClient):
        coord_resp_body = {"id": "cr-new", **self._PAYLOAD}
        mock_resp = _mock_response(json_data=coord_resp_body)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/composition-rules", json=self._PAYLOAD
            )

        assert resp.status_code == 200
        assert resp.json() == coord_resp_body
        called_url = instance.post.call_args.args[0]
        called_body = instance.post.call_args.kwargs["json"]
        assert called_url.endswith("/coord/composition-rules")
        assert called_body == self._PAYLOAD


class TestUpdateCompositionRule:
    def test_proxies_patch(self, auth_client: TestClient):
        body = {"name": "renamed"}
        coord_resp_body = {"id": "cr1", "name": "renamed"}
        mock_resp = _mock_response(json_data=coord_resp_body)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/composition-rules/cr1", json=body
            )

        assert resp.status_code == 200
        assert resp.json() == coord_resp_body
        called_url = instance.patch.call_args.args[0]
        assert called_url.endswith("/coord/composition-rules/cr1")


class TestDeleteCompositionRule:
    def test_proxies_delete(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"deleted": True})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.delete.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.delete(f"{API_PREFIX}/coord/composition-rules/cr1")

        assert resp.status_code == 200
        called_url = instance.delete.call_args.args[0]
        assert called_url.endswith("/coord/composition-rules/cr1")


# ---------------------------------------------------------------------------
# auth gate — unauthenticated callers are rejected before any coord call
# ---------------------------------------------------------------------------


class TestAuthGate:
    def test_unauthenticated_rejected(self):
        # No dependency overrides -> the real auth dependency runs and the
        # request has no credentials, so it never reaches coord.
        client = TestClient(_build_test_app(authenticated=False))
        resp = client.get(f"{API_PREFIX}/coord/priority-sets")
        assert resp.status_code in (401, 403)
