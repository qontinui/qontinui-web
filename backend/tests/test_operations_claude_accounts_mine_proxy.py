"""Tests for ``GET /operations/claude-accounts/mine`` — the USER-scoped roster proxy.

Plan ``2026-09-16-user-scoped-account-usage-and-mobile-tenant-selector``
Phase 2. The route proxies coord ``GET /coord/claude-accounts/usage/mine``:
every Claude account on every device the logged-in user owns, independent of
tenant.

Three properties matter more than the happy path, and each has its own test:

* **The bearer is forwarded although no tenant is resolved.** Coord derives
  the caller's identity from that bearer; without it every caller gets
  ``403 user_not_resolved``. Nothing but ``forward_bearer=True`` plus an INLINE
  ``capture_caller_bearer(request)`` puts it on the wire, and asserting merely
  that a headers dict exists is vacuous (``_tenant_headers`` returns ``{}``
  when the ContextVar is unset) — so the tests assert the exact header value.
* **The route works when NO tenant is resolvable.** It is user-scoped by
  design; a tenant-resolution failure must not reach it.
* **Coord's identity refusals surface verbatim**, not flattened into a
  generic 500, so a client can tell "ambiguous account" from "server broke".
  The test app installs the PRODUCTION exception handlers
  (``app/middleware/error_handler.py``, as ``app/main.py`` registers them),
  so these tests assert the body a client really receives — coord's code in
  ``message`` as JSON text — not the bare-FastAPI ``{"detail": ...}`` shape.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

_DEVICE_A = "00000000-0000-0000-0000-deadbeefcafe"
_DEVICE_B = "00000000-0000-0000-0000-feedfacecafe"

API_PREFIX = "/api/v1/operations"


def _build_test_app() -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router
    from app.middleware.error_handler import (
        AppError,
        app_exception_handler,
        http_exception_handler,
        validation_exception_handler,
    )

    test_app = FastAPI()
    # The same handlers `app/main.py` registers, so an error response here has
    # the shape a production client receives.
    test_app.add_exception_handler(AppError, app_exception_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(
        RequestValidationError,
        validation_exception_handler,  # type: ignore[arg-type]
    )
    test_app.add_exception_handler(
        StarletteHTTPException,
        http_exception_handler,  # type: ignore[arg-type]
    )
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "device.owner@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None

    # Tenant resolution is made to FAIL for every test in this file. The route
    # under test must never depend on it — if it ever gains a `get_tenant_id`
    # dependency, every test here turns into a 403 `tenant_not_resolved`.
    async def _unresolvable_tenant() -> Any:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tenant_not_resolved",
        )

    test_app.dependency_overrides[get_tenant_id] = _unresolvable_tenant
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    # Compact separators: coord's serde_json body has no spaces, and `text` is
    # what reaches the client verbatim.
    resp.text = text or (
        json.dumps(json_data, separators=(",", ":")) if json_data is not None else ""
    )
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient: MagicMock, mock_instance: AsyncMock) -> None:
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _account(device_id: str, label: str, **overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "device_id": device_id,
        "account_label": label,
        "weekly_utilization": 0.34,
        "weekly_resets_at": "2026-08-30T00:00:00Z",
        "session_utilization": 0.11,
        "session_resets_at": "2026-08-25T18:00:00Z",
        "model_limits": [{"model": "Fable", "utilization": 0.2, "resets_at": 0}],
        "exhausted": False,
        "source": "runner",
        "error": False,
        "stale": False,
        "is_active": False,
        "account_selection_mode": "least_usage",
    }
    row.update(overrides)
    return row


def _get_mine(
    client: TestClient,
    instance: AsyncMock,
    resp: MagicMock,
    token: str = "mine-proxy-default-token",
) -> httpx.Response:
    instance.get.return_value = resp
    return client.get(
        f"{API_PREFIX}/claude-accounts/mine",
        headers={"Authorization": f"Bearer {token}"},
    )


def _coord_code(resp: httpx.Response) -> str:
    """Recover coord's error code the way a client must: from ``message``.

    The shared handler puts web's GENERIC status code in ``error`` and coord's
    string body in ``message``; there is no ``detail`` key in production.
    """
    body = resp.json()
    assert "detail" not in body
    return json.loads(body["message"])["error"]


class TestGetMyClaudeAccounts:
    def test_returns_roster_across_devices(self, client: TestClient):
        coord_payload = {
            "accounts": [
                _account(_DEVICE_A, ".claude-gmail", is_active=True),
                _account(_DEVICE_B, ".claude-work"),
            ],
            "table_provisioned": True,
            "columns_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(client, instance, _mock_response(json_data=coord_payload))

        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "accounts": coord_payload["accounts"],
            "table_provisioned": True,
            "columns_provisioned": True,
        }
        # Both devices come back — this route is NOT narrowed to one tenant's.
        assert {a["device_id"] for a in body["accounts"]} == {_DEVICE_A, _DEVICE_B}

        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/claude-accounts/usage/mine")

    def test_no_prepaid_keys_on_the_user_scoped_feed(self, client: TestClient):
        # Prepaid is keyed (tenant, device, provider) — a tenant fact, so it
        # stays on the tenant feed even if a coord build ever sent it here.
        coord_payload = {
            "accounts": [],
            "prepaid": [{"device_id": _DEVICE_A, "provider": "deepseek"}],
            "table_provisioned": True,
            "columns_provisioned": True,
            "prepaid_table_provisioned": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            body = _get_mine(
                client, instance, _mock_response(json_data=coord_payload)
            ).json()

        assert "prepaid" not in body
        assert "prepaid_table_provisioned" not in body

    def test_forwards_the_callers_bearer_without_a_tenant(self, client: TestClient):
        token = "mine-proxy-header-token-7f3a"
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(
                client,
                instance,
                _mock_response(
                    json_data={
                        "accounts": [],
                        "table_provisioned": True,
                        "columns_provisioned": True,
                    }
                ),
                token=token,
            )

        # Tenant resolution is rigged to 403 in this app — a 200 proves the
        # route does not depend on it.
        assert resp.status_code == 200
        headers = instance.get.call_args.kwargs["headers"]
        assert headers is not None
        assert "Authorization" in headers, (
            "no Authorization forwarded — coord answers 403 user_not_resolved "
            "for every caller (forward_bearer=True missing, or the capture "
            "was moved into a Depends)"
        )
        assert headers["Authorization"] == f"Bearer {token}"
        # Web never tells coord who is asking: no user id on the wire.
        assert not any("user" in k.lower() for k in headers)
        assert not instance.get.call_args.kwargs.get("params")

    def test_bearer_capture_survives_a_cookie_only_session(self, client: TestClient):
        token = "mine-proxy-cookie-token-91c2"
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={
                    "accounts": [],
                    "table_provisioned": True,
                    "columns_provisioned": True,
                }
            )
            _configure_mock_client(MockClient, instance)
            client.cookies.set("access_token", token)
            resp = client.get(f"{API_PREFIX}/claude-accounts/mine")

        assert resp.status_code == 200
        headers = instance.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {token}"

    def test_table_not_provisioned_passes_through(self, client: TestClient):
        coord_payload = {
            "accounts": [],
            "table_provisioned": False,
            "columns_provisioned": False,
            "note": "coord.claude_account_usage is not provisioned",
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(client, instance, _mock_response(json_data=coord_payload))

        assert resp.status_code == 200
        body = resp.json()
        # UNKNOWN, not "no accounts": the flag must reach the client as False.
        assert body["table_provisioned"] is False
        assert body["columns_provisioned"] is False
        assert body["accounts"] == []

    def test_absent_flags_stay_none_never_defaulted_true(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(
                client,
                instance,
                _mock_response(json_data={"accounts": [_account(_DEVICE_A, ".c")]}),
            )

        body = resp.json()
        assert body["table_provisioned"] is None
        assert body["columns_provisioned"] is None

    @pytest.mark.parametrize(
        ("status_code", "web_code", "error"),
        [
            (403, "FORBIDDEN", "user_not_resolved"),
            (403, "FORBIDDEN", "user_email_ambiguous"),
            (500, "INTERNAL_SERVER_ERROR", "user_lookup_failed"),
        ],
    )
    def test_coord_identity_refusals_surface_verbatim(
        self, client: TestClient, status_code: int, web_code: str, error: str
    ):
        coord_body = {"error": error}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(
                client,
                instance,
                _mock_response(status_code=status_code, json_data=coord_body),
            )

        assert resp.status_code == status_code
        body = resp.json()
        # `error` is web's GENERIC code for the status — it cannot tell the two
        # 403s apart. Coord's code rides `message`, as coord's body verbatim.
        assert body["error"] == web_code
        assert body["message"] == json.dumps(coord_body, separators=(",", ":"))
        assert _coord_code(resp) == error

    def test_usage_read_failure_surfaces_verbatim(self, client: TestClient):
        coord_body = {
            "accounts": [],
            "table_provisioned": None,
            "columns_provisioned": None,
            "error": "usage_read_failed",
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(
                client, instance, _mock_response(status_code=500, json_data=coord_body)
            )

        assert resp.status_code == 500
        assert resp.json()["error"] == "INTERNAL_SERVER_ERROR"
        assert _coord_code(resp) == "usage_read_failed"

    def test_non_object_payload_is_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(client, instance, _mock_response(json_data=["nope"]))

        assert resp.status_code == 502
        assert "unexpected claude-accounts payload" in resp.json()["message"]

    @pytest.mark.parametrize(
        "coord_payload",
        [
            {"accounts": None, "table_provisioned": True, "columns_provisioned": True},
            {"accounts": {"x": 1}, "table_provisioned": True},
            {"table_provisioned": True, "columns_provisioned": True},
        ],
        ids=["null", "object", "absent"],
    )
    def test_non_list_accounts_is_502_not_an_empty_roster(
        self, client: TestClient, coord_payload: dict[str, Any]
    ):
        # `[]` would read as "no paired device reported" — a false zero.
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _get_mine(client, instance, _mock_response(json_data=coord_payload))

        assert resp.status_code == 502
        assert "no accounts list" in resp.json()["message"]

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = client.get(
                f"{API_PREFIX}/claude-accounts/mine",
                headers={"Authorization": "Bearer mine-proxy-unreachable-token"},
            )

        assert resp.status_code == 502
