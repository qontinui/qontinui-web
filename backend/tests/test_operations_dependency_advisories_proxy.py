"""Integration tests for the dependency-advisories proxy.

``GET /api/v1/operations/coord/dependency-advisories`` proxies coord's
``GET /coord/dependency-advisories`` so the "Rust advisories" section on
``/admin/coord/devops`` can render the fleet Rust advisory census without the
browser calling coord. Plan ``2026-11-02-rust-advisories-have-no-fleet-consumer``
Phase 5.

Same harness as ``test_operations_fleet_worktree_slots_proxy.py``: a minimal
FastAPI app with a mocked ``httpx.AsyncClient``. The properties under test:

* the census body is passed through UNTOUCHED — including ``state: unknown``
  rows and their ``reason`` — because the caller, not this proxy, decides how
  an unknown or missing census renders (UNKNOWN, never clean),
* ``include_resolved`` always rides the wire, ``repo`` only when set,
* the operator bearer AND the active-tenant selection are forwarded,
* coord's ``503 dependency_advisories_surface_unavailable`` reaches the
  browser with its status AND JSON body intact,
* a transport failure is a 502/504, never a fabricated empty census.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
ROUTE = "/api/v1/operations/coord/dependency-advisories"
COORD_PATH = "/coord/dependency-advisories"
TEST_BEARER = "test-cognito-access-token"
TEST_ACTIVE_TENANT = str(uuid4())


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: `_tenant_headers` reads the bearer back
        # out of this ContextVar, and a sync override would set it in a worker
        # thread the request task never sees.
        operations_module._caller_bearer.set(TEST_BEARER)
        # The dashboard's tenant-switcher selection, which coord re-scopes on.
        operations_module._caller_active_tenant.set(TEST_ACTIVE_TENANT)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int, json_data) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    return resp


def _get(auth_client: TestClient, url: str, response=None, side_effect=None):
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        mock_instance = MagicMock()
        mock_instance.get = AsyncMock(return_value=response, side_effect=side_effect)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = mock_instance
        resp = auth_client.get(url)
    return resp, mock_instance


CENSUS_PAYLOAD = {
    "available": True,
    "census": [
        {
            "repo": "qontinui/qontinui-coord",
            "ecosystem": "rust",
            "sha": "fe1dde77f0000000000000000000000000000000",
            "db_commit": "abc1234def0000000000000000000000000000",
            "state": "vulnerable",
            "reason": None,
            "advisory_count": 1,
            "observed_at": "2026-11-04T10:00:00Z",
            "age_secs": 120,
            "advisories": [
                {
                    "advisory_id": "RUSTSEC-2026-0001",
                    "package": "tokio",
                    "version": "1.0.0",
                    "patched": [">=1.0.1"],
                    "severity": "high",
                    "ignored": False,
                    "first_seen_at": "2026-11-03T10:00:00Z",
                    "last_seen_at": "2026-11-04T10:00:00Z",
                    "resolved_at": None,
                }
            ],
        },
        {
            "repo": "qontinui/qontinui-runner",
            "ecosystem": "rust",
            "sha": None,
            "db_commit": None,
            "state": "unknown",
            "reason": "cargo-audit not installed on the scheduling box",
            "advisory_count": 0,
            "observed_at": "2026-11-04T10:00:00Z",
            "age_secs": 120,
            "advisories": [],
        },
    ],
}


class TestDependencyAdvisoriesProxy:
    def test_census_is_passed_through_untouched(self, auth_client: TestClient):
        resp, mock_instance = _get(
            auth_client, ROUTE, response=_mock_response(200, CENSUS_PAYLOAD)
        )
        assert resp.status_code == 200
        assert resp.json() == CENSUS_PAYLOAD
        url = mock_instance.get.call_args[0][0]
        assert url.endswith(COORD_PATH)

    def test_include_resolved_always_forwarded_repo_only_when_set(
        self, auth_client: TestClient
    ):
        _, mock_instance = _get(
            auth_client, ROUTE, response=_mock_response(200, CENSUS_PAYLOAD)
        )
        assert mock_instance.get.call_args.kwargs["params"] == {
            "include_resolved": False
        }

        _, mock_instance = _get(
            auth_client,
            f"{ROUTE}?repo=qontinui/qontinui-coord&include_resolved=true",
            response=_mock_response(200, CENSUS_PAYLOAD),
        )
        assert mock_instance.get.call_args.kwargs["params"] == {
            "include_resolved": True,
            "repo": "qontinui/qontinui-coord",
        }

    def test_blank_repo_is_not_forwarded(self, auth_client: TestClient):
        _, mock_instance = _get(
            auth_client, f"{ROUTE}?repo=", response=_mock_response(200, CENSUS_PAYLOAD)
        )
        assert "repo" not in mock_instance.get.call_args.kwargs["params"]

    def test_operator_bearer_is_forwarded(self, auth_client: TestClient):
        _, mock_instance = _get(
            auth_client, ROUTE, response=_mock_response(200, CENSUS_PAYLOAD)
        )
        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_active_tenant_header_is_forwarded(self, auth_client: TestClient):
        """Coord scopes the census to the tenant the operator switched to;
        without this header it would answer for the home tenant instead."""
        from app.api.v1.endpoints.operations import ACTIVE_TENANT_HEADER

        _, mock_instance = _get(
            auth_client, ROUTE, response=_mock_response(200, CENSUS_PAYLOAD)
        )
        headers = mock_instance.get.call_args.kwargs["headers"]
        assert ACTIVE_TENANT_HEADER == "X-Qontinui-Active-Tenant"
        assert headers[ACTIVE_TENANT_HEADER] == TEST_ACTIVE_TENANT

    def test_surface_unavailable_503_body_is_verbatim(self, auth_client: TestClient):
        body = {
            "error": "dependency_advisories_surface_unavailable",
            "detail": "coord.dependency_census does not exist",
        }
        resp, _ = _get(auth_client, ROUTE, response=_mock_response(503, body))
        assert resp.status_code == 503
        assert resp.json() == body

    def test_coord_unreachable_is_a_502_not_an_empty_census(
        self, auth_client: TestClient
    ):
        resp, _ = _get(auth_client, ROUTE, side_effect=httpx.ConnectError("down"))
        assert resp.status_code == 502
        assert "census" not in resp.json()

    def test_coord_timeout_is_a_504(self, auth_client: TestClient):
        resp, _ = _get(auth_client, ROUTE, side_effect=httpx.ReadTimeout("slow"))
        assert resp.status_code == 504
