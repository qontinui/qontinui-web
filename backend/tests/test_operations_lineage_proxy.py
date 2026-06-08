"""Integration tests for the commit-lineage coord proxy endpoints.

Three GET routes under ``/api/v1/operations/lineage/*`` proxy coord's
``coord.commit_lineage``-backed reads so the web ``/commits`` page renders
the "which Claude Code session produced which commit" feed without the
browser hitting coord cross-origin:

* ``GET /operations/lineage/recent?limit=N``
      → coord ``GET /coord/lineage/recent?limit=N``
* ``GET /operations/lineage/stats``
      → coord ``GET /coord/lineage/stats``
* ``GET /operations/lineage/sessions/{session_id}/commits``
      → coord ``GET /coord/sessions/{session_id}/commits``

All three forward coord's JSON envelope verbatim and forward the operator's
Cognito bearer (via ``tenant_id=`` → ``_tenant_headers``) so coord
authenticates the operator and scopes the query.

Mirrors the testing pattern in ``test_operations_gates_proxy.py`` /
``test_operations_claims_proxy.py``: a minimal FastAPI app with the
``get_tenant_id`` + auth dependencies overridden, and ``httpx.AsyncClient``
mocked so no live coord is needed.

These tests assert ONLY the web layer's behavior — proxy path, params,
verbatim pass-through, auth gating, bearer forwarding, and coord
error-mapping. They make NO assertion about coord-side tenant scoping
(that contract is owned by coord); the web proxy contract is stable
regardless.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, server_tenant=None, authenticated: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router.

    ``server_tenant`` — the tenant the (overridden) ``get_tenant_id``
    dependency resolves from the authenticated operator. Passing a fixed
    value lets the isolation test prove the resolved tenant — not a
    client-supplied one — is what the proxy uses.
    """
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        resolved = server_tenant if server_tenant is not None else uuid4()
        test_app.dependency_overrides[get_tenant_id] = lambda: resolved
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

SESSION_ID = "abcdabcd-1234-5678-9abc-def012345678"


def _recent_envelope():
    return {
        "rows": [
            {
                "sha": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                "repo": "qontinui/qontinui-web",
                "session_id": SESSION_ID,
                "session_name": "ufix-2026-06-08",
                "source": "claude_cli",
                "committed_at": "2026-06-08T12:00:00+00:00",
                "subject": "fix: thing",
            }
        ],
        "count": 1,
        "limit": 100,
    }


def _stats_envelope():
    return {
        "total": 42,
        "by_source": {"claude_cli": 30, "human": 12},
        "top_sessions": [
            {"session_id": SESSION_ID, "session_name": "ufix", "count": 7},
        ],
    }


def _session_commits_envelope():
    return {
        "session_id": SESSION_ID,
        "commits": [
            {
                "sha": "cafebabecafebabecafebabecafebabecafebabe",
                "repo": "qontinui/qontinui-web",
                "committed_at": "2026-06-08T11:00:00+00:00",
                "subject": "feat: another",
            }
        ],
        "count": 1,
    }


# ---------------------------------------------------------------------------
# GET /operations/lineage/recent
# ---------------------------------------------------------------------------


class TestGetLineageRecent:
    def test_returns_envelope_and_calls_coord_path(self, auth_client: TestClient):
        coord_payload = _recent_envelope()
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/recent")
        assert resp.status_code == 200
        # Envelope passes through verbatim.
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/lineage/recent")

    def test_default_limit_is_100(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data=_recent_envelope())
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/recent")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {}) or {}
        assert called_params.get("limit") == 100

    def test_forwards_limit_query_param(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data=_recent_envelope())
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/recent?limit=25")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {}) or {}
        assert called_params.get("limit") == 25

    def test_unauthenticated_is_blocked(self):
        # No auth override → the real auth dependency rejects the request
        # before any coord call is made.
        app = _build_test_app(authenticated=False)
        client = TestClient(app)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_recent_envelope())
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/lineage/recent")
        assert resp.status_code in (401, 403)
        instance.get.assert_not_called()

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/recent")
        assert resp.status_code == 502

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/recent")
        assert resp.status_code == 504

    def test_coord_4xx_passed_through(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=403, text='{"error":"forbidden"}')
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/recent")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /operations/lineage/stats
# ---------------------------------------------------------------------------


class TestGetLineageStats:
    def test_returns_envelope_verbatim(self, auth_client: TestClient):
        coord_payload = _stats_envelope()
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/stats")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/lineage/stats")

    def test_no_query_params_forwarded(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data=_stats_envelope())
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/stats")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", None)
        # stats takes no params — None or empty mapping are both acceptable.
        assert not called_params

    def test_unauthenticated_is_blocked(self):
        app = _build_test_app(authenticated=False)
        client = TestClient(app)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_stats_envelope())
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/lineage/stats")
        assert resp.status_code in (401, 403)
        instance.get.assert_not_called()

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/stats")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /operations/lineage/sessions/{session_id}/commits
# ---------------------------------------------------------------------------


class TestGetSessionCommits:
    def test_returns_envelope_and_calls_coord_path(self, auth_client: TestClient):
        coord_payload = _session_commits_envelope()
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/lineage/sessions/{SESSION_ID}/commits"
            )
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        # The session_id is interpolated into the coord path.
        assert called_url.endswith(f"/coord/sessions/{SESSION_ID}/commits")

    def test_empty_commits_passes_through(self, auth_client: TestClient):
        coord_payload = {"session_id": SESSION_ID, "commits": [], "count": 0}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/lineage/sessions/{SESSION_ID}/commits"
            )
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_invalid_session_id_is_422_no_coord_call(self, auth_client: TestClient):
        # session_id is typed as UUID — a non-UUID path segment is rejected by
        # FastAPI validation before the coord proxy runs.
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data=_session_commits_envelope()
            )
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/lineage/sessions/not-a-uuid/commits")
        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_unauthenticated_is_blocked(self):
        app = _build_test_app(authenticated=False)
        client = TestClient(app)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data=_session_commits_envelope()
            )
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/lineage/sessions/{SESSION_ID}/commits")
        assert resp.status_code in (401, 403)
        instance.get.assert_not_called()

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/lineage/sessions/{SESSION_ID}/commits"
            )
        assert resp.status_code == 502

    def test_coord_4xx_passed_through(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=404, text='{"error":"no session"}')
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/lineage/sessions/{SESSION_ID}/commits"
            )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Bearer forwarding at the _proxy_coord_get helper level
# ---------------------------------------------------------------------------
#
# The route-level tests above override ``get_tenant_id`` to a stub, so the
# real token-capture (``_caller_bearer.set(...)`` inside ``get_tenant_id``)
# never runs there. Bearer forwarding is a property of the proxy helper +
# ``_tenant_headers``: when a caller bearer is present in the ContextVar and
# a ``tenant_id`` is passed (which every lineage route does), the helper must
# attach ``Authorization: Bearer <token>`` to the upstream coord GET. This
# mirrors ``TestProxyCoordGetHelper`` in ``test_agent_sessions_coord_proxy``.


class TestLineageBearerForwarding:
    @pytest.mark.asyncio
    async def test_proxy_forwards_caller_bearer_to_coord(self):
        from app.api.v1.endpoints import operations as mod

        seen: dict[str, object] = {}

        class _Resp:
            status_code = 200

            def json(self):
                return _recent_envelope()

        class _Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url, params=None, headers=None):  # noqa: ANN001
                seen["url"] = url
                seen["params"] = params
                seen["headers"] = headers or {}
                return _Resp()

        token = mod._caller_bearer.set("tok-lineage")
        try:
            with patch.object(mod.httpx, "AsyncClient", _Client):
                result = await mod._proxy_coord_get(
                    "/coord/lineage/recent",
                    params={"limit": 100},
                    tenant_id=uuid4(),
                )
        finally:
            mod._caller_bearer.reset(token)

        assert result == _recent_envelope()
        assert seen["url"].endswith("/coord/lineage/recent")
        assert seen["params"] == {"limit": 100}
        assert seen["headers"].get("Authorization") == "Bearer tok-lineage"

    @pytest.mark.asyncio
    async def test_proxy_omits_auth_header_when_no_bearer(self):
        from app.api.v1.endpoints import operations as mod

        seen: dict[str, object] = {}

        class _Resp:
            status_code = 200

            def json(self):
                return _stats_envelope()

        class _Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url, params=None, headers=None):  # noqa: ANN001
                seen["headers"] = headers or {}
                return _Resp()

        # Ensure no bearer is set for this call.
        token = mod._caller_bearer.set(None)
        try:
            with patch.object(mod.httpx, "AsyncClient", _Client):
                await mod._proxy_coord_get(
                    "/coord/lineage/stats",
                    tenant_id=uuid4(),
                )
        finally:
            mod._caller_bearer.reset(token)

        assert "Authorization" not in seen["headers"]
