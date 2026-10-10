"""Tests for the GitHub-hosted CI read proxy (`/api/v1/operations/ci-hosting`).

Plan ``2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting`` Phase 3.
The proxy forwards to coord's ``GET /coord/ci-hosting/effective`` and adds
``can_edit``. What this file pins:

1. **UNKNOWN stays UNKNOWN.** ``level: null`` passes through as ``null`` with
   its ``unknown_reason`` — never floored to ``off`` the way the generic
   fleet-policy view floors a missing level — and a level this build does not
   recognise becomes UNKNOWN rather than a guessed value.
2. **An older coord 404s and the proxy says so** (a 404, not a value).
3. **``can_edit`` follows the effective-tenant roles**, not coord's
   cross-tenant ``is_admin`` union, exactly like ``GET /fleet-policy``.
4. **``?repo=`` is forwarded** so one repo can be resolved alone, and coord's
   ``404 repo_not_in_tenant`` for it becomes a typed UNKNOWN for that repo.
5. **The caller's bearer and active-tenant selection reach coord**, which is
   what scopes the read to the caller's tenant.

Mirrors ``test_operations_fleet_policy_proxy.py``.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

API_PREFIX = "/api/v1/operations"

COORD_BODY = {
    "domain": "github_hosted_ci",
    "tenant_default": {
        "level": "off",
        "resolved_scope": "tenant",
        "unknown_reason": None,
    },
    "repos": [
        {
            "repo": "qontinui/qontinui-web",
            "level": "off",
            "resolved_scope": "tenant",
            "unknown_reason": None,
        },
        {
            "repo": "qontinui/multistate",
            "level": "on",
            "resolved_scope": "repo",
            "unknown_reason": None,
        },
        {
            "repo": "qontinui/shared",
            "level": None,
            "resolved_scope": "none",
            "unknown_reason": "select_failed",
        },
    ],
}


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    resolved = uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    return resp


@contextmanager
def _patch_identity(is_admin: bool = True, effective_roles=("admin",)):
    identity = MagicMock()
    identity.is_admin = is_admin
    with (
        patch_ops(
            "get_coord_identity",
            AsyncMock(return_value=identity),
        ),
        patch_ops(
            "_effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


@contextmanager
def _patch_coord_get(response: MagicMock):
    instance = MagicMock()
    instance.get = AsyncMock(return_value=response)
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as mock_client:
        mock_client.return_value = instance
        yield instance


class TestGetCiHosting:
    def test_proxies_coord_and_adds_can_edit(self, client: TestClient):
        with (
            _patch_coord_get(_mock_response(200, COORD_BODY)) as coord,
            _patch_identity(),
        ):
            resp = client.get(f"{API_PREFIX}/ci-hosting")

        assert resp.status_code == 200
        url = coord.get.call_args.args[0]
        assert url.endswith("/coord/ci-hosting/effective")
        body = resp.json()
        assert body["domain"] == "github_hosted_ci"
        assert body["can_edit"] is True
        assert body["tenant_default"] == {
            "level": "off",
            "resolved_scope": "tenant",
            "unknown_reason": None,
        }
        assert [r["repo"] for r in body["repos"]] == [
            "qontinui/qontinui-web",
            "qontinui/multistate",
            "qontinui/shared",
        ]
        assert body["repos"][1]["resolved_scope"] == "repo"

    def test_unknown_stays_null_with_its_reason(self, client: TestClient):
        """`level: null` is UNKNOWN — never floored to `off`."""
        with _patch_coord_get(_mock_response(200, COORD_BODY)), _patch_identity():
            body = client.get(f"{API_PREFIX}/ci-hosting").json()

        shared = body["repos"][2]
        assert shared["level"] is None
        assert shared["unknown_reason"] == "select_failed"

    def test_an_unrecognised_level_is_unknown_not_a_guess(self, client: TestClient):
        payload = {
            "domain": "github_hosted_ci",
            "tenant_default": {"level": "maybe", "resolved_scope": "tenant"},
            "repos": [{"repo": "o/r", "level": None, "resolved_scope": "none"}],
        }
        with _patch_coord_get(_mock_response(200, payload)), _patch_identity():
            body = client.get(f"{API_PREFIX}/ci-hosting").json()

        assert body["tenant_default"]["level"] is None
        assert body["tenant_default"]["unknown_reason"] == "malformed_level:maybe"
        # A null level with no reason still names that nothing was reported.
        assert body["repos"][0]["level"] is None
        assert body["repos"][0]["unknown_reason"] == "no_level_reported"

    def test_a_coord_answer_missing_tenant_default_is_unknown(self, client: TestClient):
        with (
            _patch_coord_get(_mock_response(200, {"repos": "nope"})),
            _patch_identity(),
        ):
            body = client.get(f"{API_PREFIX}/ci-hosting").json()

        assert body["tenant_default"]["level"] is None
        assert body["tenant_default"]["unknown_reason"] == "missing"
        assert body["repos"] == []

    def test_forwards_the_repo_filter(self, client: TestClient):
        with (
            _patch_coord_get(_mock_response(200, COORD_BODY)) as coord,
            _patch_identity(),
        ):
            client.get(f"{API_PREFIX}/ci-hosting?repo=qontinui/qontinui-web")

        assert coord.get.call_args.kwargs["params"] == {"repo": "qontinui/qontinui-web"}

    def test_an_older_coord_404_passes_through_as_404(self, client: TestClient):
        """No route on coord is UNKNOWN for the panel, never a value."""
        with (
            _patch_coord_get(_mock_response(404, {"error": "NOT_FOUND"})),
            _patch_identity(),
        ):
            resp = client.get(f"{API_PREFIX}/ci-hosting")

        assert resp.status_code == 404

    def test_can_edit_follows_the_effective_tenant_not_the_union(
        self, client: TestClient
    ):
        """Admin of SOME tenant, developer of the active one: read-only."""
        with (
            _patch_coord_get(_mock_response(200, COORD_BODY)),
            _patch_identity(is_admin=True, effective_roles=("developer",)),
        ):
            body = client.get(f"{API_PREFIX}/ci-hosting").json()

        assert body["can_edit"] is False

    def test_superuser_can_edit_without_a_tenant_admin_role(self):
        client = TestClient(_build_test_app(is_superuser=True))
        with (
            _patch_coord_get(_mock_response(200, COORD_BODY)),
            _patch_identity(is_admin=False, effective_roles=()),
        ):
            body = client.get(f"{API_PREFIX}/ci-hosting").json()

        assert body["can_edit"] is True


class TestCiHostingTenantScoping:
    def test_forwards_the_callers_bearer_and_active_tenant(self):
        """Coord scopes the read by these two headers; losing either would
        silently read the wrong tenant (or the home tenant)."""
        from app.api.deps import get_current_active_user_async
        from app.api.v1.endpoints import operations
        from app.api.v1.endpoints.operations import get_tenant_id
        from app.api.v1.endpoints.operations import router as operations_router

        active = str(uuid4())
        resolved = uuid4()

        async def _capturing_tenant_id() -> object:
            # What the real dependency does first: capture the caller's
            # bearer and selection into the request-scoped ContextVars.
            operations._caller_bearer.set("caller-token")
            operations._caller_active_tenant.set(active)
            return resolved

        app = FastAPI()
        user = MagicMock()
        user.is_superuser = False
        app.dependency_overrides[get_current_active_user_async] = lambda: user
        app.dependency_overrides[get_tenant_id] = _capturing_tenant_id
        app.include_router(operations_router, prefix=API_PREFIX)
        client = TestClient(app)

        with (
            _patch_coord_get(_mock_response(200, COORD_BODY)) as coord,
            _patch_identity(),
        ):
            resp = client.get(f"{API_PREFIX}/ci-hosting")

        assert resp.status_code == 200
        headers = coord.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer caller-token"
        assert headers["X-Qontinui-Active-Tenant"] == active


class TestCiHostingRepoScope:
    def test_repo_not_in_tenant_is_a_typed_unknown_for_that_repo(
        self, client: TestClient
    ):
        resp404 = _mock_response(404, {"error": "repo_not_in_tenant"})
        with _patch_coord_get(resp404), _patch_identity():
            resp = client.get(f"{API_PREFIX}/ci-hosting?repo=other/repo")

        assert resp.status_code == 200
        body = resp.json()
        assert body["repos"] == [
            {
                "repo": "other/repo",
                "level": None,
                "resolved_scope": "none",
                "unknown_reason": "repo_not_in_tenant",
                "watched": None,
            }
        ]
        # The tenant default was not read by this request — UNKNOWN, not a value.
        assert body["tenant_default"]["level"] is None

    def test_a_plain_404_with_a_repo_still_passes_through(self, client: TestClient):
        """A coord without the route is not a per-repo answer."""
        with (
            _patch_coord_get(_mock_response(404, {"error": "NOT_FOUND"})),
            _patch_identity(),
        ):
            resp = client.get(f"{API_PREFIX}/ci-hosting?repo=o/r")

        assert resp.status_code == 404

    def test_watched_passes_through_and_absent_stays_null(self, client: TestClient):
        payload = {
            "tenant_default": {"level": "off", "resolved_scope": "tenant"},
            "repos": [
                {
                    "repo": "o/a",
                    "level": "off",
                    "resolved_scope": "tenant",
                    "watched": False,
                },
                {"repo": "o/b", "level": "off", "resolved_scope": "tenant"},
                {
                    "repo": "o/c",
                    "level": "off",
                    "resolved_scope": "tenant",
                    "watched": "x",
                },
            ],
        }
        with _patch_coord_get(_mock_response(200, payload)), _patch_identity():
            body = client.get(f"{API_PREFIX}/ci-hosting").json()

        assert [r["watched"] for r in body["repos"]] == [False, None, None]


class TestCiHostingRepoNotInTenantIsNarrow:
    """Only coord's 404 for a ``?repo=`` read is the per-repo UNKNOWN."""

    def test_a_404_without_repo_passes_through_even_naming_the_code(
        self, client: TestClient
    ):
        resp404 = _mock_response(404, {"error": "repo_not_in_tenant", "repo": "o/r"})
        with _patch_coord_get(resp404), _patch_identity():
            resp = client.get(f"{API_PREFIX}/ci-hosting")

        assert resp.status_code == 404

    def test_a_non_404_naming_the_code_is_not_mapped(self, client: TestClient):
        resp400 = _mock_response(400, {"error": "repo_not_in_tenant"})
        with _patch_coord_get(resp400), _patch_identity():
            resp = client.get(f"{API_PREFIX}/ci-hosting?repo=o/r")

        assert resp.status_code == 400
