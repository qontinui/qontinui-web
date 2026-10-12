"""Integration tests for the computers proxies.

``GET /api/v1/operations/computers`` and
``GET /api/v1/operations/computers/{computer_id}`` proxy coord's
``GET /coord/computers`` and ``GET /coord/computers/:computer_id`` so the
``/admin/coord/computers`` console can render without the browser calling coord
cross-origin.

Plan ``2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
has-no-resource-model`` Phase 5. Same harness as
``test_operations_fleet_worktree_slots_proxy.py``: a minimal FastAPI app and a
mocked ``httpx.AsyncClient``, so no live coord is needed. Properties pinned:

* the body passes through UNTOUCHED — a ``null`` PSI reading, a
  ``not_supported`` axis and a ``stale`` freshness are coord's words and reach
  the page as coord wrote them (this proxy adds no defaults);
* the operator bearer is forwarded (never an anonymous coord call);
* coord's 404 and ``schema_pending`` answers keep their status AND JSON body,
  because the page renders them as UNKNOWN rather than as a failure;
* a transport failure is a 502, never a fabricated empty computer list;
* a malformed ``computer_id`` stops at the web edge (422) and never reaches
  coord as an arbitrary path segment;
* both routes are gated on ``require_coord_tenant_admin`` — the payload carries
  the registrar's CI-runner rows and each computer's ``access`` facts, which
  ``/fleet/ci-runners`` already serves only to a tenant admin (see
  ``test_operations_ci_runners_proxy.py``'s module doc for that posture). A
  non-admin is refused BEFORE any coord call.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
LIST_ROUTE = f"{API_PREFIX}/computers"
COMPUTER_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f"
DETAIL_ROUTE = f"{API_PREFIX}/computers/{COMPUTER_ID}"

TEST_BEARER = "test-cognito-access-token"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: `_tenant_headers` reads the bearer back
        # out of this ContextVar, and a sync override would set it in a worker
        # thread the endpoint never sees (see the worktree-slots proxy test).
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    if json_data is None:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _client_returning(MockClient, response=None, side_effect=None) -> MagicMock:
    mock_instance = MagicMock()
    mock_instance.get = AsyncMock(return_value=response, side_effect=side_effect)
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance
    return mock_instance


STALE_COMPUTER = {
    "computer_id": COMPUTER_ID,
    "kind": "wsl_guest",
    "hostname": "msi-wsl",
    "freshness": {
        "last_report_at": "2026-09-30T01:00:00Z",
        "age_secs": 9000,
        "state": "stale",
    },
    "lanes": [
        {
            "lane": "wsl",
            "psi_memory_some_avg60": None,
            "measured": {"psi_memory": "not_supported"},
        }
    ],
    "services_failed": None,
}

LIST_PAYLOAD = {
    "computers": [STALE_COMPUTER],
    "unattributed_ci_runners": [
        {"runner_name": "gh-runner-orphan", "repo": "qontinui-web"}
    ],
}

DETAIL_PAYLOAD = {
    **STALE_COMPUTER,
    "services": [
        {
            "unit": "actions.runner.qontinui-web.merytshost-1.service",
            "kind": "gh_actions_runner",
            "active_state": "failed",
            "result": "oom-kill",
            "oom_policy": "continue",
            "memory_peak": None,
        }
    ],
    "events": [],
    "history": [],
    "divergence": [],
}


class TestComputersListProxy:
    def test_forwards_the_body_untouched(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == LIST_PAYLOAD

    def test_unknown_readings_are_not_defaulted(self, auth_client: TestClient):
        """A never-measured axis is `null` and an unsupported one says so —
        neither may become `0` or vanish on the hop."""
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            body = auth_client.get(LIST_ROUTE).json()
        computer = body["computers"][0]
        assert computer["freshness"]["state"] == "stale"
        assert computer["services_failed"] is None
        assert computer["lanes"][0]["psi_memory_some_avg60"] is None
        assert computer["lanes"][0]["measured"] == {"psi_memory": "not_supported"}

    def test_calls_the_coord_list_route_with_the_bearer(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            auth_client.get(LIST_ROUTE)
        url = mock.get.call_args[0][0]
        assert url.endswith("/coord/computers")
        assert mock.get.call_args.kwargs["headers"]["Authorization"] == (
            f"Bearer {TEST_BEARER}"
        )

    def test_route_not_deployed_404_keeps_status_and_body(
        self, auth_client: TestClient
    ):
        """A coord predating Phase 3 answers 404. The page renders that as
        UNKNOWN ("coord does not serve computers yet"), so the status must
        survive rather than being re-wrapped."""
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(404, None, text=""))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 404
        assert resp.json() == {"error": "coord returned HTTP 404"}

    def test_schema_pending_body_passes_through(self, auth_client: TestClient):
        pending = {"error": "schema_pending", "detail": "coord.computers absent"}
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(503, pending))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 503
        assert resp.json() == pending

    def test_coord_unreachable_is_a_502_not_an_empty_list(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, side_effect=httpx.ConnectError("nope"))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 502
        assert "computers" not in resp.json()

    def test_coord_timeout_is_a_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, side_effect=httpx.ReadTimeout("slow"))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 504


class TestComputerDetailProxy:
    def test_forwards_the_body_untouched(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DETAIL_PAYLOAD))
            resp = auth_client.get(DETAIL_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == DETAIL_PAYLOAD
        assert mock.get.call_args[0][0].endswith(f"/coord/computers/{COMPUTER_ID}")

    def test_not_found_in_tenant_keeps_coords_error_code(self, auth_client: TestClient):
        body = {"error": "computer_not_found"}
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(404, body))
            resp = auth_client.get(DETAIL_ROUTE)
        assert resp.status_code == 404
        assert resp.json() == body

    def test_malformed_id_never_reaches_coord(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DETAIL_PAYLOAD))
            resp = auth_client.get(f"{API_PREFIX}/computers/not-a-uuid")
        assert resp.status_code == 422
        mock.get.assert_not_called()


class TestComputersAreAdminGated:
    """Every other test overrides ``require_coord_tenant_admin`` to pass, so
    without these, swapping it back to ``get_tenant_id`` would stay green:
    the deny override below would then gate nothing and coord would be called.
    """

    @pytest.mark.parametrize("route", [LIST_ROUTE, DETAIL_ROUTE])
    def test_non_admin_gets_403_before_any_coord_call(self, route: str):
        from fastapi import HTTPException

        from app.api.v1.endpoints.operations import require_coord_tenant_admin

        def _deny() -> None:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

        app = _build_test_app()
        app.dependency_overrides[require_coord_tenant_admin] = _deny
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = TestClient(app).get(route)

        assert resp.status_code == 403
        mock.get.assert_not_called()
