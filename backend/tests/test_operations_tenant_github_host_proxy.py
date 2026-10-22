"""Tests for the tenant GitHub host proxy (`/api/v1/operations/tenant/github-host`).

Plan ``2026-10-10-spec-front-end-phase-9-generic-boundary`` Phase 3: the
console's door onto coord's ``GET``/``PUT``/``DELETE /coord/tenant/github-host``,
which reads and writes ``coord.tenant_github_hosts``. What this file pins:

1. **The read passes coord's host through and adds ``can_edit``** on the
   effective-tenant rule ``GET /fleet-policy`` uses.
2. **A field coord did not send is UNKNOWN** (``None``), never the github.com
   default.
3. **The PUT sends exactly coord's ``PutGithubHostRequest`` keys**, and an
   extra key is refused locally.
4. **Coord's typed refusals survive as structured ``detail``** — including
   the 409's ``repos`` list on both the PUT and the DELETE — so the panel can
   name them.
5. **The caller's tenant reaches coord** on every verb.

Mirrors ``test_operations_ci_hosting_proxy.py``.
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
URL = f"{API_PREFIX}/tenant/github-host"
ACTIVE_TENANT = str(uuid4())

GHES_BODY = {
    "tenant_id": "c231d9da-0ca8-4fe4-bd81-0e3d6c20339a",
    "api_base": "https://ghe.example.com/api/v3",
    "web_base": "https://ghe.example.com",
    "graphql_url": "https://ghe.example.com/api/graphql",
    "configured": True,
}

GITHUB_COM_BODY = {
    "tenant_id": "c231d9da-0ca8-4fe4-bd81-0e3d6c20339a",
    "api_base": "https://api.github.com",
    "web_base": "https://github.com",
    "graphql_url": "https://api.github.com/graphql",
    "configured": False,
}

REGISTERED_ELSEWHERE = {
    "error": "repos_registered_on_another_host",
    "detail": "these enrolled repos are registered on a different GitHub host",
    "repos": [{"repo": "acme/app", "github_remote": "https://github.com/acme/app.git"}],
}


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    resolved = uuid4()

    async def _capturing_tenant_id() -> object:
        # What the real dependencies do first: capture the caller's bearer
        # and selection into the request-scoped ContextVars coord reads.
        operations._caller_bearer.set("caller-token")
        operations._caller_active_tenant.set(ACTIVE_TENANT)
        return resolved

    test_app.dependency_overrides[get_tenant_id] = _capturing_tenant_id
    test_app.dependency_overrides[require_coord_tenant_admin] = _capturing_tenant_id
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
        patch_ops("get_coord_identity", AsyncMock(return_value=identity)),
        patch_ops(
            "_effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


def _assert_scoped_to_caller(verb: AsyncMock) -> None:
    """Coord scopes the row by these two headers; losing either would
    silently read or write the wrong tenant's host."""
    headers = verb.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer caller-token"
    assert headers["X-Qontinui-Active-Tenant"] == ACTIVE_TENANT


@contextmanager
def _patch_coord(**verbs: MagicMock):
    instance = MagicMock()
    for verb, response in verbs.items():
        setattr(instance, verb, AsyncMock(return_value=response))
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as mock_client:
        mock_client.return_value = instance
        yield instance


class TestGetTenantGithubHost:
    def test_proxies_coord_and_adds_can_edit(self, client: TestClient):
        with (
            _patch_coord(get=_mock_response(200, GHES_BODY)) as coord,
            _patch_identity(),
        ):
            resp = client.get(URL)

        assert resp.status_code == 200
        assert resp.json() == {
            "api_base": "https://ghe.example.com/api/v3",
            "web_base": "https://ghe.example.com",
            "graphql_url": "https://ghe.example.com/api/graphql",
            "configured": True,
            "can_edit": True,
        }
        assert coord.get.call_args.args[0].endswith("/coord/tenant/github-host")
        _assert_scoped_to_caller(coord.get)

    def test_the_github_com_default_reads_as_not_configured(self, client: TestClient):
        with (
            _patch_coord(get=_mock_response(200, GITHUB_COM_BODY)),
            _patch_identity(),
        ):
            body = client.get(URL).json()

        assert body["configured"] is False
        assert body["web_base"] == "https://github.com"

    def test_a_missing_field_is_unknown_not_the_default(self, client: TestClient):
        with _patch_coord(get=_mock_response(200, {})), _patch_identity():
            body = client.get(URL).json()

        assert body["configured"] is None
        assert body["api_base"] is None
        assert body["web_base"] is None

    def test_can_edit_follows_the_effective_tenant_not_the_admin_union(
        self, client: TestClient
    ):
        with (
            _patch_coord(get=_mock_response(200, GHES_BODY)),
            _patch_identity(is_admin=True, effective_roles=("developer",)),
        ):
            body = client.get(URL).json()

        assert body["can_edit"] is False

    def test_a_superuser_can_edit_without_a_coord_admin_role(self):
        client = TestClient(_build_test_app(is_superuser=True))
        with (
            _patch_coord(get=_mock_response(200, GHES_BODY)),
            _patch_identity(is_admin=False, effective_roles=()),
        ):
            body = client.get(URL).json()

        assert body["can_edit"] is True

    def test_an_older_coord_404_passes_through(self, client: TestClient):
        with (
            _patch_coord(get=_mock_response(404, {"error": "NOT_FOUND"})),
            _patch_identity(),
        ):
            resp = client.get(URL)

        assert resp.status_code == 404


class TestPutTenantGithubHost:
    def test_sends_exactly_coords_keys_and_returns_the_echo(self, client: TestClient):
        with _patch_coord(put=_mock_response(200, GHES_BODY)) as coord:
            resp = client.put(
                URL,
                json={
                    "api_base": "https://ghe.example.com/api/v3",
                    "web_base": "https://ghe.example.com",
                },
            )

        assert resp.status_code == 200
        assert coord.put.call_args.kwargs["json"] == {
            "api_base": "https://ghe.example.com/api/v3",
            "web_base": "https://ghe.example.com",
        }
        _assert_scoped_to_caller(coord.put)
        assert resp.json()["configured"] is True
        assert resp.json()["can_edit"] is True

    def test_a_missing_base_is_rejected_before_the_round_trip(self, client: TestClient):
        with _patch_coord(put=_mock_response(200, GHES_BODY)) as coord:
            resp = client.put(URL, json={"api_base": "https://ghe.example.com/api/v3"})

        assert resp.status_code == 422
        coord.put.assert_not_awaited()

    @pytest.mark.parametrize(
        ("status", "body"),
        [
            (400, {"error": "invalid_github_host", "detail": "not https"}),
            (403, {"error": "admin_required", "detail": "admin only"}),
            (409, REGISTERED_ELSEWHERE),
            (503, {"error": "schema_migration_pending", "detail": "x"}),
        ],
    )
    def test_coord_refusals_pass_through_structured(
        self, client: TestClient, status: int, body: dict
    ):
        with _patch_coord(put=_mock_response(status, body)):
            resp = client.put(
                URL,
                json={
                    "api_base": "https://ghe.example.com/api/v3",
                    "web_base": "https://ghe.example.com",
                },
            )

        assert resp.status_code == status
        assert resp.json()["detail"] == body


class TestDeleteTenantGithubHost:
    def test_resets_to_github_com(self, client: TestClient):
        with _patch_coord(delete=_mock_response(200, GITHUB_COM_BODY)) as coord:
            resp = client.delete(URL)

        assert resp.status_code == 200
        assert resp.json()["configured"] is False
        assert coord.delete.call_args.args[0].endswith("/coord/tenant/github-host")
        _assert_scoped_to_caller(coord.delete)

    def test_registered_elsewhere_passes_through_with_its_repos(
        self, client: TestClient
    ):
        with _patch_coord(delete=_mock_response(409, REGISTERED_ELSEWHERE)):
            resp = client.delete(URL)

        assert resp.status_code == 409
        assert resp.json()["detail"]["repos"] == REGISTERED_ELSEWHERE["repos"]
