"""Integration tests for the Wave-2 coord-dashboard proxy endpoints.

These endpoints (under ``/api/v1/operations/{plans,trees,alerts,fleet/health,
agent-questions,agent-logs,memory}``) proxy state from coord so the
``/admin/coord/*`` operator console can render without the browser
hitting coord cross-origin.

Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 2 (Wave 2).

Mirrors the testing pattern in ``test_operations_claims_proxy.py``:
minimal FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is
needed.

Auth model (refactor ``coord_tenant_scope_columns``):
the prior ``require_admin`` gate is replaced by tenant scoping. Every
Wave-2 endpoint resolves ``current_user → tenant_id`` via
``app.services.coord_operator_resolver`` and forwards
``X-Qontinui-Tenant-Id`` to coord. The tests exercise:

* happy-path proxy semantics for every endpoint (with tenant header
  asserted on the coord call);
* the tenant-not-resolved branch (403 ``tenant_not_resolved``) for at
  least one endpoint per family.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

# Stable tenant_id the in-test resolver returns for the "happy path"
# fixture; tests assert the X-Qontinui-Tenant-Id header carries it.
_FIXTURE_TENANT_ID = UUID("11111111-2222-3333-4444-555555555555")
TENANT_HEADER = "X-Qontinui-Tenant-Id"


def _build_test_app(*, resolves_tenant: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router.

    ``resolves_tenant=True`` overrides the tenant resolver so it returns
    ``_FIXTURE_TENANT_ID``. ``resolves_tenant=False`` makes it raise
    403 ``tenant_not_resolved`` — the same behaviour the real resolver
    surfaces when the user doesn't have a coord ``operators`` row.

    The ``get_async_db`` dependency is also stubbed (returns ``None``)
    so the operations router builds without needing a live PG session.
    """
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import (
        router as operations_router,
    )

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "tenant.user@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False  # NOT relevant under tenant-scoping
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
    # Coordination MUTATIONS (plan transition, memory upsert/delete/restore, …)
    # are admin-gated via require_coord_tenant_admin; override it with the same
    # resolver so these proxy tests exercise the forward path (and still get a
    # 403 when resolves_tenant is False).
    test_app.dependency_overrides[require_coord_tenant_admin] = _resolver
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    """Authenticated user whose tenant resolves to ``_FIXTURE_TENANT_ID``."""
    return TestClient(_build_test_app(resolves_tenant=True))


@pytest.fixture()
def unresolved_client() -> TestClient:
    """Authenticated user with no operator row → 403 tenant_not_resolved."""
    return TestClient(_build_test_app(resolves_tenant=False))


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


def _assert_tenant_header_forwarded(call) -> None:
    """Helper: Phase T2b — the legacy ``X-Qontinui-Tenant-Id`` email-bridge
    header must NOT be sent on the coord call. Coord resolves the tenant from
    the forwarded Cognito bearer instead; the proxy still passes a (possibly
    empty) ``headers`` dict to httpx for tenant-scoped routes."""
    headers = call.kwargs.get("headers")
    assert headers is not None, "scoped coord call must pass a headers dict"
    assert TENANT_HEADER not in headers, (
        f"{TENANT_HEADER} must no longer be sent (T2b), got {headers}"
    )


API_PREFIX = "/api/v1/operations"


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------


class TestPlansEndpoints:
    def test_list_plans(self, client: TestClient):
        # The "Plans" dashboard now proxies coord's generic work-unit
        # surface; the list envelope is `{work_units: [...]}`.
        coord_payload = {
            "work_units": [
                {
                    "slug": "2026-05-19-coordinator-production-readiness",
                    "status": "in_progress",
                    "title": "Coord production readiness",
                }
            ],
            "limit": 100,
            "offset": 0,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/plans?status=in_progress")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/work-units")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("status") == "in_progress"
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_list_plans_no_filters(self, client: TestClient):
        mock_resp = _mock_response(
            json_data={"work_units": [], "limit": 100, "offset": 0}
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/plans")
        assert resp.status_code == 200
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/work-units")
        called_params = instance.get.call_args.kwargs.get("params")
        assert called_params is None
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_get_single_plan(self, client: TestClient):
        # Single-work-unit envelope: `{work_unit: {...}, recent_history: [...]}`.
        coord_payload = {
            "work_unit": {
                "slug": "my-plan",
                "status": "shipped",
                "title": "My Plan",
            },
            "recent_history": [],
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/plans/my-plan")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/work-units/my-plan")
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_get_plan_history(self, client: TestClient):
        # Work-unit history rows: {from_status?, to_status, transitioned_at,
        # by_actor?, reason?}.
        coord_payload = {
            "slug": "my-plan",
            "history": [
                {
                    "from_status": None,
                    "to_status": "draft",
                    "transitioned_at": "2026-05-19T00:00:00Z",
                    "by_actor": "operator:web-admin",
                    "reason": None,
                },
            ],
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/plans/my-plan/history")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/work-units/my-plan/history")
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_post_plan_transition(self, client: TestClient):
        coord_payload = {"slug": "my-plan", "to_status": "shipped"}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/plans/my-plan/transition",
                json={"status": "shipped", "note": "wave-2 complete"},
            )
        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        # Proxies coord's operator-transition route.
        assert called_url.endswith("/coord/work-units/my-plan/operator-transition")
        # The operator-friendly `{status, note}` body is remapped onto coord's
        # `{to_status, by_actor, reason}` contract. `by_actor` is sent for
        # compatibility with the deployed coord (a follow-up derives it
        # server-side + ignores this field).
        called_body = instance.post.call_args.kwargs.get("json", {})
        assert called_body.get("to_status") == "shipped"
        assert called_body.get("by_actor")  # non-empty (deployed coord requires it)
        assert called_body.get("reason") == "wave-2 complete"
        assert "status" not in called_body
        assert "note" not in called_body
        _assert_tenant_header_forwarded(instance.post.call_args)

    def test_tenant_not_resolved_returns_403(self, unresolved_client: TestClient):
        """User authenticates but no operator row → 403 tenant_not_resolved.

        Sanity check that the new dependency surfaces the documented
        error code (replaces the prior ``Not authorized. Admin access
        required.`` 403 from ``require_admin``).
        """
        resp = unresolved_client.get(f"{API_PREFIX}/plans")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"


# ---------------------------------------------------------------------------
# Trees (Phase 1)
# ---------------------------------------------------------------------------


class TestTreesEndpoints:
    def test_trees_by_device(self, client: TestClient):
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
            resp = client.get(
                f"{API_PREFIX}/trees/by-device/00000000-0000-0000-0000-00000000000a"
            )
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_trees_contention(self, client: TestClient):
        coord_payload = {"overlaps": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/trees/contention")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_trees_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/trees/contention")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Pull decisions (repo_pull audit feed) — plan 2026-05-30-coord-pull-decision-ui
# ---------------------------------------------------------------------------


class TestPullDecisionsEndpoint:
    def test_pull_decisions_pins_repo_pull_domain(self, client: TestClient):
        """The proxy always forwards ``decision_domain=repo_pull`` to coord's
        ``/coord/policies/resolutions`` and forwards the optional filters."""
        coord_payload = {
            "resolutions": [
                {
                    "resolution_id": "00000000-0000-0000-0000-0000000000aa",
                    "resolved_at": "2026-05-30T00:00:00Z",
                    "device_id": "00000000-0000-0000-0000-00000000000a",
                    "repo": "qontinui-coord",
                    "kind": "decision",
                    "verdict": "pull",
                    "timing": "now",
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(
                f"{API_PREFIX}/coord/pull-decisions"
                "?device_id=00000000-0000-0000-0000-00000000000a"
                "&repo=qontinui-coord&limit=50&since=2026-05-29T00:00:00Z"
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/policies/resolutions")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("decision_domain") == "repo_pull"
        assert called_params.get("device_id") == "00000000-0000-0000-0000-00000000000a"
        assert called_params.get("repo") == "qontinui-coord"
        assert called_params.get("limit") == 50
        assert called_params.get("since") == "2026-05-29T00:00:00Z"
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_pull_decisions_default_only_domain(self, client: TestClient):
        """With no filters, only ``decision_domain=repo_pull`` is forwarded."""
        mock_resp = _mock_response(json_data={"resolutions": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/coord/pull-decisions")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params == {"decision_domain": "repo_pull"}
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_pull_decisions_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/coord/pull-decisions")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Alerts (full rollup)
# ---------------------------------------------------------------------------


class TestAlertsEndpoint:
    def test_alerts_with_filters(self, client: TestClient):
        coord_payload = {"alerts": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(
                f"{API_PREFIX}/alerts?include_resolved=false&severity=warning&kind=claim"
            )
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("severity") == "warning"
        assert called_params.get("kind") == "claim"
        assert called_params.get("include_resolved") is False
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_alerts_default_query(self, client: TestClient):
        mock_resp = _mock_response(json_data={"alerts": []})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/alerts")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("include_resolved") is False
        assert "severity" not in called_params
        assert "kind" not in called_params
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_alerts_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/alerts")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Fleet health
# ---------------------------------------------------------------------------


class TestFleetHealthEndpoint:
    def test_fleet_health(self, client: TestClient):
        coord_payload = {"devices": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/fleet/health")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/fleet/health")
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_fleet_health_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/fleet/health")
        assert resp.status_code == 403

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/fleet/health")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# Wave-3 prep — agent questions
# ---------------------------------------------------------------------------


class TestAgentQuestionsEndpoints:
    def test_pending(self, client: TestClient):
        coord_payload = {"questions": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agent-questions/pending")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_respond(self, client: TestClient):
        coord_payload = {"question_id": "q-1", "response": "yes"}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/agent-questions/q-1/respond",
                json={"response": "yes"},
            )
        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/agent-questions/q-1/respond")
        _assert_tenant_header_forwarded(instance.post.call_args)

    def test_pending_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/agent-questions/pending")
        assert resp.status_code == 403

    def test_answered(self, client: TestClient):
        coord_payload = {"questions": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agent-questions/answered?limit=50")
        assert resp.status_code == 200
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/agent-questions/answered")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 50
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_get_single_question(self, client: TestClient):
        coord_payload = {"question_id": "q-1", "agent_id": "a-1"}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agent-questions/q-1")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_by_session(self, client: TestClient):
        coord_payload = {"session_id": "s-42", "questions": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agent-questions/by-session/s-42")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)


# ---------------------------------------------------------------------------
# Wave-3 prep — agent logs + memory
# ---------------------------------------------------------------------------


class TestAgentLogsAndMemoryEndpoints:
    def test_agent_logs_by_agent(self, client: TestClient):
        coord_payload = {"logs": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agent-logs/by-agent/a-1?limit=100")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 100
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_agent_logs_by_session(self, client: TestClient):
        coord_payload = {"agent_session_id": "session-123", "logs": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(
                f"{API_PREFIX}/agent-logs/by-session/session-123?limit=250"
            )
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_agent_logs_recent(self, client: TestClient):
        coord_payload = {"logs": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agent-logs/recent?limit=200&level=info")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_agent_logs_recent_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/agent-logs/recent")
        assert resp.status_code == 403

    def test_memory_list(self, client: TestClient):
        coord_payload = {"entries": []}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/memory/list")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_memory_entry(self, client: TestClient):
        coord_payload = {"name": "proj_x", "version": 3, "content": "..."}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/memory/proj_x")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_memory_list_tenant_not_resolved(self, unresolved_client: TestClient):
        resp = unresolved_client.get(f"{API_PREFIX}/memory/list")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Wave-3c memory browser mutation surface
# ---------------------------------------------------------------------------


class TestMemoryMutationEndpoints:
    """Coverage for the Phase 6 memory-browser mutation surface."""

    def test_get_memory_version(self, client: TestClient):
        coord_payload = {"name": "proj_x", "version": 2, "content": "..."}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/memory/proj_x/version/2")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.get.call_args)

    def test_get_memory_version_tenant_not_resolved(
        self, unresolved_client: TestClient
    ):
        resp = unresolved_client.get(f"{API_PREFIX}/memory/proj_x/version/2")
        assert resp.status_code == 403

    def test_post_memory_upsert(self, client: TestClient):
        coord_payload = {"name": "proj_x", "version": 3}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/memory/upsert",
                json={"name": "proj_x", "content": "new content"},
            )
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.post.call_args)

    def test_post_memory_upsert_tenant_not_resolved(
        self, unresolved_client: TestClient
    ):
        resp = unresolved_client.post(
            f"{API_PREFIX}/memory/upsert",
            json={"name": "x", "content": "y"},
        )
        assert resp.status_code == 403

    def test_delete_memory_entry(self, client: TestClient):
        coord_payload = {"name": "proj_x", "tombstoned": True}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.delete.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.delete(f"{API_PREFIX}/memory/proj_x")
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.delete.call_args)

    def test_delete_memory_entry_204_no_content(self, client: TestClient):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 204
        mock_resp.content = b""
        mock_resp.text = ""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.delete.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.delete(f"{API_PREFIX}/memory/proj_x")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_post_memory_restore(self, client: TestClient):
        coord_payload = {"name": "proj_x", "restored_from_version": 2}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/memory/proj_x/restore",
                json={"version": 2},
            )
        assert resp.status_code == 200
        _assert_tenant_header_forwarded(instance.post.call_args)
