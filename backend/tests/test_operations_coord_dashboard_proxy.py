"""Integration tests for the Wave-2 coord-dashboard proxy endpoints.

These endpoints (under ``/api/v1/operations/{plans,trees,alerts,fleet/health,
agent-questions,agent-logs,memory}``) proxy state from coord so the
``/admin/coord/*`` operator console can render without the browser
hitting coord cross-origin.

Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 2 (Wave 2).

Mirrors the testing pattern in ``test_operations_claims_proxy.py``:
minimal FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is
needed.

Auth model: every Wave-2 endpoint is ``require_admin``-gated. The tests
exercise both a superuser identity (allowed) and a non-superuser
identity (403) for at least one endpoint per family, plus full
happy-path coverage on each.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, admin: bool = True, authenticated: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router.

    The Wave-2 endpoints depend on ``require_admin`` (which itself
    depends on ``get_current_user_async``). We override
    ``get_current_user_async`` so the dependency tree resolves the
    superuser flag from the mocked identity.
    """
    from app.api.deps import (
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = ("admin" if admin else "user") + "@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        mock_user.is_superuser = admin
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_build_test_app(admin=True))


@pytest.fixture()
def user_client() -> TestClient:
    return TestClient(_build_test_app(admin=False))


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
# Plans
# ---------------------------------------------------------------------------


class TestPlansEndpoints:
    def test_list_plans(self, admin_client: TestClient):
        coord_payload = {
            "plans": [
                {
                    "slug": "2026-05-19-coordinator-production-readiness",
                    "status": "in_progress",
                    "title": "Coord production readiness",
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/plans?status=in_progress")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/plans")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("status") == "in_progress"

    def test_list_plans_no_filters(self, admin_client: TestClient):
        mock_resp = _mock_response(json_data={"plans": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/plans")
        assert resp.status_code == 200
        # No params forwarded when neither filter is set.
        called_params = instance.get.call_args.kwargs.get("params")
        assert called_params is None

    def test_get_single_plan(self, admin_client: TestClient):
        coord_payload = {
            "slug": "my-plan",
            "status": "shipped",
            "content": "# My Plan\n...markdown body...",
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/plans/my-plan")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/plans/my-plan")

    def test_get_plan_history(self, admin_client: TestClient):
        coord_payload = {
            "slug": "my-plan",
            "history": [
                {
                    "status": "drafted",
                    "transitioned_at": "2026-05-19T00:00:00Z",
                    "actor": "operator",
                },
                {
                    "status": "vetted",
                    "transitioned_at": "2026-05-19T01:00:00Z",
                    "actor": "operator",
                },
            ],
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/plans/my-plan/history")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_post_plan_transition(self, admin_client: TestClient):
        coord_payload = {"slug": "my-plan", "status": "shipped"}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.post(
                f"{API_PREFIX}/plans/my-plan/transition",
                json={"status": "shipped", "note": "wave-2 complete"},
            )
        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/plans/my-plan/transition")
        called_body = instance.post.call_args.kwargs.get("json", {})
        assert called_body.get("status") == "shipped"

    def test_non_admin_forbidden(self, user_client: TestClient):
        resp = user_client.get(f"{API_PREFIX}/plans")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Trees (Phase 1)
# ---------------------------------------------------------------------------


class TestTreesEndpoints:
    def test_trees_by_device(self, admin_client: TestClient):
        coord_payload = {
            "device_id": "00000000-0000-0000-0000-00000000000a",
            "trees": [
                {
                    "repo": "qontinui-runner",
                    "primary_path": "D:/qontinui-root/qontinui-runner",
                    "dirty": False,
                    "last_seen": "2026-05-20T00:00:00Z",
                }
            ],
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(
                f"{API_PREFIX}/trees/by-device/00000000-0000-0000-0000-00000000000a"
            )
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_trees_contention(self, admin_client: TestClient):
        coord_payload = {
            "overlaps": [
                {
                    "repo": "qontinui-coord",
                    "primary_paths": [
                        "D:/qontinui-root/qontinui-coord",
                        "C:/repos/qontinui-coord",
                    ],
                }
            ]
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/trees/contention")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_trees_non_admin_forbidden(self, user_client: TestClient):
        resp = user_client.get(f"{API_PREFIX}/trees/contention")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Alerts (full rollup)
# ---------------------------------------------------------------------------


class TestAlertsEndpoint:
    def test_alerts_with_filters(self, admin_client: TestClient):
        coord_payload = {
            "alerts": [
                {
                    "alert_key": "claim-stale-claims-m-a",
                    "severity": "warning",
                    "kind": "claim",
                    "summary": "Stale claim",
                },
                {
                    "alert_key": "stale-wip-72h-m-b",
                    "severity": "critical",
                    "kind": "stale_wip",
                    "summary": "WIP >72h",
                },
            ]
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(
                f"{API_PREFIX}/alerts?include_resolved=false&severity=warning&kind=claim"
            )
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("severity") == "warning"
        assert called_params.get("kind") == "claim"
        assert called_params.get("include_resolved") is False

    def test_alerts_default_query(self, admin_client: TestClient):
        mock_resp = _mock_response(json_data={"alerts": []})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/alerts")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        # `include_resolved` defaults to False; severity/kind absent.
        assert called_params.get("include_resolved") is False
        assert "severity" not in called_params
        assert "kind" not in called_params

    def test_alerts_non_admin_forbidden(self, user_client: TestClient):
        resp = user_client.get(f"{API_PREFIX}/alerts")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Fleet health
# ---------------------------------------------------------------------------


class TestFleetHealthEndpoint:
    def test_fleet_health(self, admin_client: TestClient):
        coord_payload = {
            "devices": [
                {"device_id": "dev-a", "status": "healthy"},
                {"device_id": "dev-b", "status": "degraded"},
            ]
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/fleet/health")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/fleet/health")

    def test_fleet_health_non_admin_forbidden(self, user_client: TestClient):
        resp = user_client.get(f"{API_PREFIX}/fleet/health")
        assert resp.status_code == 403

    def test_coord_unreachable_returns_502(self, admin_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/fleet/health")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# Wave-3 prep — agent questions
# ---------------------------------------------------------------------------


class TestAgentQuestionsEndpoints:
    def test_pending(self, admin_client: TestClient):
        coord_payload = {
            "questions": [
                {
                    "question_id": "q-1",
                    "agent_id": "a-1",
                    "question": "Continue with phase 2?",
                    "options": ["yes", "no"],
                }
            ]
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/agent-questions/pending")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_respond(self, admin_client: TestClient):
        coord_payload = {"question_id": "q-1", "response": "yes"}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.post(
                f"{API_PREFIX}/agent-questions/q-1/respond",
                json={"response": "yes"},
            )
        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/agent-questions/q-1/respond")

    def test_pending_non_admin_forbidden(self, user_client: TestClient):
        resp = user_client.get(f"{API_PREFIX}/agent-questions/pending")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Wave-3 prep — agent logs + memory
# ---------------------------------------------------------------------------


class TestAgentLogsAndMemoryEndpoints:
    def test_agent_logs_by_agent(self, admin_client: TestClient):
        coord_payload = {"logs": [{"ts": "2026-05-20T00:00:00Z", "line": "ok"}]}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/agent-logs/by-agent/a-1?limit=100")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 100

    def test_memory_list(self, admin_client: TestClient):
        coord_payload = {"entries": [{"name": "proj_x", "latest_version": 3}]}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/memory/list")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_memory_entry(self, admin_client: TestClient):
        coord_payload = {"name": "proj_x", "version": 3, "content": "..."}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/memory/proj_x")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_memory_list_non_admin_forbidden(self, user_client: TestClient):
        resp = user_client.get(f"{API_PREFIX}/memory/list")
        assert resp.status_code == 403
