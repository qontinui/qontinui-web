"""
Integration tests for the constraint engine proxy endpoints.

These endpoints proxy requests from the web frontend to the runner's HTTP API
(localhost:9876). Tests mock the httpx calls to the runner so no running
runner instance is required.

Uses a lightweight FastAPI app (not the full production app) to avoid needing
a database connection during test setup. Imports are done lazily inside
fixtures to prevent the heavy app import chain from hanging when the test
database is unavailable.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Lightweight test app — avoids the full app's startup lifecycle (DB, Redis)
# ---------------------------------------------------------------------------


def _build_test_app(*, authenticated: bool = True) -> FastAPI:
    """Create a minimal FastAPI app with just the constraints router.

    Imports the router lazily so the module-level import chain
    (app.core.config → DB init) only runs when tests actually execute.
    """
    from app.api.deps import current_active_user
    from app.api.v1.endpoints.constraints import router as constraints_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[current_active_user] = lambda: mock_user
    test_app.include_router(constraints_router, prefix="/api/v1/constraints")
    return test_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def auth_client() -> TestClient:
    """Test client with auth dependency overridden (authenticated requests)."""
    return TestClient(_build_test_app(authenticated=True))


@pytest.fixture()
def unauth_client() -> TestClient:
    """Test client with NO auth override (unauthenticated requests).

    The constraints router uses ``Depends(current_active_user)`` which will
    fail because there is no real JWT / cookie — giving us a 401.
    """
    return TestClient(_build_test_app(authenticated=False))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

API_PREFIX = "/api/v1/constraints"


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    """Build a fake httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    """Return a context-manager that patches ``httpx.AsyncClient`` in the
    constraints module and yields the mock instance."""
    return patch("app.api.v1.endpoints.constraints.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    """Wire up the async context-manager protocol on the mock client."""
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


# ---------------------------------------------------------------------------
# GET /constraints/active
# ---------------------------------------------------------------------------


class TestGetActiveConstraints:
    """Tests for GET /api/v1/constraints/active."""

    def test_returns_constraints_list(self, auth_client: TestClient):
        """Runner returns a list of active constraints — verify pass-through."""
        runner_payload = [
            {"id": "c1", "name": "max-steps", "value": 10},
            {"id": "c2", "name": "timeout", "value": 300},
        ]
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/active", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 200
        assert resp.json() == runner_payload
        instance.get.assert_called_once()
        assert "project_path" in str(instance.get.call_args)

    def test_returns_empty_list(self, auth_client: TestClient):
        """Runner returns an empty list — verify empty array response."""
        mock_resp = _mock_response(json_data=[])

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/active", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 200
        assert resp.json() == []

    def test_runner_error_500(self, auth_client: TestClient):
        """Runner returns 500 — verify error is proxied."""
        mock_resp = _mock_response(status_code=500, text="Internal Server Error")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/active", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 500

    def test_runner_unreachable(self, auth_client: TestClient):
        """Runner is not running — verify 502 error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("Connection refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/active", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 502
        assert "Runner is not reachable" in resp.json()["detail"]

    def test_runner_timeout(self, auth_client: TestClient):
        """Runner times out — verify 504 error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("Read timed out")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/active", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 504
        assert "Timeout" in resp.json()["detail"]

    def test_project_path_is_required(self, auth_client: TestClient):
        """project_path is a required query parameter."""
        resp = auth_client.get(f"{API_PREFIX}/active")
        assert resp.status_code == 422  # Validation error


# ---------------------------------------------------------------------------
# GET /constraints/config
# ---------------------------------------------------------------------------


class TestGetConstraintConfig:
    """Tests for GET /api/v1/constraints/config."""

    def test_returns_toml_and_path(self, auth_client: TestClient):
        """Runner returns TOML content + path — verify pass-through."""
        runner_payload = {
            "toml": "[constraints]\nmax_steps = 10\n",
            "path": "/tmp/myproject/.qontinui/constraints.toml",
        }
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/config", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["toml"] == runner_payload["toml"]
        assert data["path"] == runner_payload["path"]

    def test_returns_empty_when_no_config(self, auth_client: TestClient):
        """Runner returns empty response when no config file exists."""
        runner_payload = {"toml": "", "path": None}
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/config", params={"project_path": "/tmp/myproject"}
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["toml"] == ""

    def test_project_path_forwarded(self, auth_client: TestClient):
        """Verify project_path query param is forwarded to runner."""
        mock_resp = _mock_response(json_data={"toml": "", "path": None})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            auth_client.get(
                f"{API_PREFIX}/config",
                params={"project_path": "/home/user/project"},
            )

        # Verify the runner call URL and params
        call_args = instance.get.call_args
        url = call_args.args[0]
        params = call_args.kwargs.get("params", {})
        assert url.endswith("/constraints/config")
        assert params == {"project_path": "/home/user/project"}

    def test_project_path_is_required(self, auth_client: TestClient):
        """project_path is a required query parameter."""
        resp = auth_client.get(f"{API_PREFIX}/config")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /constraints/config
# ---------------------------------------------------------------------------


class TestWriteConstraintConfig:
    """Tests for POST /api/v1/constraints/config."""

    def test_write_valid_toml(self, auth_client: TestClient):
        """Runner accepts valid TOML — verify write response with path."""
        runner_payload = {
            "success": True,
            "path": "/tmp/myproject/.qontinui/constraints.toml",
        }
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/config",
                json={
                    "toml": "[constraints]\nmax_steps = 10\n",
                    "project_path": "/tmp/myproject",
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "path" in data

    def test_write_toml_without_project_path(self, auth_client: TestClient):
        """Writing TOML without project_path — field is optional, excluded via
        ``exclude_none``."""
        runner_payload = {"success": True, "path": "/default/constraints.toml"}
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/config",
                json={"toml": "[constraints]\nmax_steps = 5\n"},
            )

        assert resp.status_code == 200

        # Verify project_path was excluded from the body sent to runner
        call_args = instance.post.call_args
        body_sent = call_args.kwargs.get("json", {})
        assert "project_path" not in body_sent

    def test_runner_rejects_invalid_toml(self, auth_client: TestClient):
        """Runner rejects invalid TOML — verify error response."""
        mock_resp = _mock_response(
            status_code=400, text="Invalid TOML: unexpected character"
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/config",
                json={"toml": "this is not valid [[[toml"},
            )

        assert resp.status_code == 400

    def test_body_forwarded_correctly(self, auth_client: TestClient):
        """Verify the request body (toml + project_path) is forwarded to runner."""
        mock_resp = _mock_response(json_data={"success": True, "path": "/p"})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            auth_client.post(
                f"{API_PREFIX}/config",
                json={
                    "toml": "[c]\nk = 1\n",
                    "project_path": "/my/project",
                },
            )

        call_args = instance.post.call_args
        body_sent = call_args.kwargs.get("json", {})
        assert body_sent["toml"] == "[c]\nk = 1\n"
        assert body_sent["project_path"] == "/my/project"

    def test_toml_field_required(self, auth_client: TestClient):
        """toml field is required in the request body."""
        resp = auth_client.post(f"{API_PREFIX}/config", json={})
        assert resp.status_code == 422

    def test_runner_connect_error_on_write(self, auth_client: TestClient):
        """Runner is unreachable during write — verify 502."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.side_effect = httpx.ConnectError("Connection refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/config",
                json={"toml": "[c]\nk = 1\n"},
            )

        assert resp.status_code == 502

    def test_runner_timeout_on_write(self, auth_client: TestClient):
        """Runner times out during write — verify 504."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.side_effect = httpx.TimeoutException("Timed out")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/config",
                json={"toml": "[c]\nk = 1\n"},
            )

        assert resp.status_code == 504


# ---------------------------------------------------------------------------
# POST /constraints/validate
# ---------------------------------------------------------------------------


class TestValidateConstraintConfig:
    """Tests for POST /api/v1/constraints/validate."""

    def test_valid_toml(self, auth_client: TestClient):
        """Runner validates valid TOML — verify success response."""
        runner_payload = {"valid": True, "errors": []}
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/validate",
                json={"toml": "[constraints]\nmax_steps = 10\n"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert data["errors"] == []

    def test_invalid_toml_returns_errors(self, auth_client: TestClient):
        """Runner finds validation errors — verify errors passed through."""
        runner_payload = {
            "valid": False,
            "errors": [
                {"line": 3, "message": "Unknown constraint key: 'foo'"},
                {"line": 7, "message": "Value must be positive integer"},
            ],
        }
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/validate",
                json={"toml": "[bad]\nfoo = bar\n"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False
        assert len(data["errors"]) == 2

    def test_body_forwarded_correctly(self, auth_client: TestClient):
        """Verify the toml body is forwarded to runner."""
        mock_resp = _mock_response(json_data={"valid": True, "errors": []})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            toml_content = "[constraints]\ntimeout = 60\n"
            auth_client.post(
                f"{API_PREFIX}/validate",
                json={"toml": toml_content},
            )

        call_args = instance.post.call_args
        body_sent = call_args.kwargs.get("json", {})
        assert body_sent["toml"] == toml_content

    def test_toml_field_required(self, auth_client: TestClient):
        """toml field is required in the request body."""
        resp = auth_client.post(f"{API_PREFIX}/validate", json={})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /constraints/results/{task_run_id}
# ---------------------------------------------------------------------------


class TestGetConstraintResults:
    """Tests for GET /api/v1/constraints/results/{task_run_id}."""

    def test_returns_results(self, auth_client: TestClient):
        """Runner returns constraint results — verify pass-through."""
        task_run_id = str(uuid4())
        runner_payload = {
            "task_run_id": task_run_id,
            "results": [
                {
                    "constraint": "max-steps",
                    "passed": True,
                    "iteration": 1,
                    "value": 5,
                    "limit": 10,
                },
                {
                    "constraint": "timeout",
                    "passed": False,
                    "iteration": 1,
                    "value": 350,
                    "limit": 300,
                },
            ],
        }
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/results/{task_run_id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["task_run_id"] == task_run_id
        assert len(data["results"]) == 2

    def test_with_iteration_param(self, auth_client: TestClient):
        """Verify iteration query param is forwarded to runner."""
        task_run_id = str(uuid4())
        runner_payload = {"task_run_id": task_run_id, "results": []}
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/results/{task_run_id}",
                params={"iteration": 3},
            )

        assert resp.status_code == 200

        # Verify iteration was forwarded
        call_args = instance.get.call_args
        params_sent = call_args.kwargs.get("params", {})
        assert params_sent.get("iteration") == 3

    def test_without_iteration_param(self, auth_client: TestClient):
        """Without iteration param — params dict should be empty."""
        task_run_id = str(uuid4())
        runner_payload = {"task_run_id": task_run_id, "results": []}
        mock_resp = _mock_response(json_data=runner_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/results/{task_run_id}")

        assert resp.status_code == 200

        call_args = instance.get.call_args
        params_sent = call_args.kwargs.get("params", {})
        assert "iteration" not in params_sent

    def test_nonexistent_task_run(self, auth_client: TestClient):
        """Runner returns 404 for unknown task run — verify proxied."""
        task_run_id = str(uuid4())
        mock_resp = _mock_response(status_code=404, text="Task run not found")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/results/{task_run_id}")

        assert resp.status_code == 404

    def test_url_includes_task_run_id(self, auth_client: TestClient):
        """Verify the task_run_id is included in the URL sent to runner."""
        task_run_id = "abc-123-def"
        mock_resp = _mock_response(
            json_data={"task_run_id": task_run_id, "results": []}
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            auth_client.get(f"{API_PREFIX}/results/{task_run_id}")

        call_args = instance.get.call_args
        url_called = call_args.args[0]
        assert task_run_id in url_called
        assert url_called.endswith(f"/constraints/results/{task_run_id}")


# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------


class TestConstraintAuth:
    """Verify that unauthenticated requests are rejected."""

    def test_active_requires_auth(self, unauth_client: TestClient):
        """GET /active without auth returns 401."""
        resp = unauth_client.get(
            f"{API_PREFIX}/active", params={"project_path": "/tmp/p"}
        )
        assert resp.status_code == 401

    def test_config_get_requires_auth(self, unauth_client: TestClient):
        """GET /config without auth returns 401."""
        resp = unauth_client.get(
            f"{API_PREFIX}/config", params={"project_path": "/tmp/p"}
        )
        assert resp.status_code == 401

    def test_config_post_requires_auth(self, unauth_client: TestClient):
        """POST /config without auth returns 401."""
        resp = unauth_client.post(f"{API_PREFIX}/config", json={"toml": "[c]\nk=1\n"})
        assert resp.status_code == 401

    def test_validate_requires_auth(self, unauth_client: TestClient):
        """POST /validate without auth returns 401."""
        resp = unauth_client.post(f"{API_PREFIX}/validate", json={"toml": "[c]\nk=1\n"})
        assert resp.status_code == 401

    def test_results_requires_auth(self, unauth_client: TestClient):
        """GET /results/{id} without auth returns 401."""
        resp = unauth_client.get(f"{API_PREFIX}/results/{uuid4()}")
        assert resp.status_code == 401

    def test_auth_token_not_forwarded_to_runner(self, auth_client: TestClient):
        """Verify the user's auth token is NOT forwarded to the runner."""
        mock_resp = _mock_response(json_data=[])

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            auth_client.get(f"{API_PREFIX}/active", params={"project_path": "/tmp/p"})

        # The runner call should NOT include any Authorization header.
        call_kwargs = instance.get.call_args.kwargs
        headers = call_kwargs.get("headers", {})
        assert "Authorization" not in headers
        assert "authorization" not in headers
