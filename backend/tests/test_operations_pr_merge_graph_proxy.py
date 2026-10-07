"""Proxy tests for ``GET /operations/pr-merge/graph``.

The graph route proxies coord's ``/pr-merge/graph`` with
``structured_errors=True``: coord scopes the read by the caller's credential
tenant and answers ``404 {"error": "repo_not_in_caller_tenant", ...}`` for a
repo that tenant does not own. That refusal must reach the browser as a JSON
object, not as an escaped string inside ``detail``.

The flag is opt-in, so a sibling ``_proxy_coord_get`` route that did not opt
in still passes coord's body through as ``resp.text``; one test pins that.

Mirrors ``test_operations_pr_checks_proxy.py``: a minimal FastAPI app with a
mocked ``httpx.AsyncClient``, no live coord. Error responses are real
``httpx.Response`` objects so ``_coord_error_detail``'s ``resp.json()`` runs
for real.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

API_PREFIX = "/api/v1/operations"

_REFUSAL = {
    "error": "repo_not_in_caller_tenant",
    "caller_tenant_id": "11111111-1111-1111-1111-111111111111",
    "repo": "other-org/other-repo",
}


def _build_test_app(*, with_envelope: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: uuid4()
    test_app.include_router(operations_router, prefix=API_PREFIX)
    if with_envelope:
        from app.middleware.error_handler import http_exception_handler

        test_app.add_exception_handler(
            StarletteHTTPException,
            http_exception_handler,  # type: ignore[arg-type]
        )
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _mock_get(MockClient, response: httpx.Response) -> AsyncMock:
    instance = AsyncMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    instance.get.return_value = response
    MockClient.return_value = instance
    return instance


class TestGetPrMergeGraph:
    def test_success_passes_coord_body_through(self, client: TestClient):
        body = {
            "nodes": [
                {
                    "repo": "qontinui/qontinui-web",
                    "pr_number": 7,
                    "tenant_id": None,
                    "outer_state": "open",
                    "topo_merge_ready": False,
                    "block_reason_code": "none",
                    "merge_state_status": "CLEAN",
                }
            ],
            "edges": [],
            "topo_order": [],
            "cycle_detected": False,
            "cycle_members": [],
        }
        with _patch_httpx() as MockClient:
            instance = _mock_get(MockClient, httpx.Response(200, json=body))
            resp = client.get(
                f"{API_PREFIX}/pr-merge/graph",
                params={"repo": "qontinui/qontinui-web", "pr": 7},
            )
        assert resp.status_code == 200
        assert resp.json() == body
        assert instance.get.call_args.args[0].endswith("/pr-merge/graph")
        assert instance.get.call_args.kwargs["params"] == {
            "repo": "qontinui/qontinui-web",
            "pr": 7,
        }

    def test_structured_refusal_stays_an_object(self, client: TestClient):
        with _patch_httpx() as MockClient:
            _mock_get(MockClient, httpx.Response(404, json=_REFUSAL))
            resp = client.get(
                f"{API_PREFIX}/pr-merge/graph",
                params={"repo": "other-org/other-repo", "pr": 1},
            )
        assert resp.status_code == 404
        assert resp.json()["detail"] == _REFUSAL

    def test_structured_refusal_under_production_envelope(self):
        """With the production handler registered, the dict detail is spliced
        to the top level, so ``error`` is coord's code, not ``not_found``."""
        client = TestClient(_build_test_app(with_envelope=True))
        with _patch_httpx() as MockClient:
            _mock_get(MockClient, httpx.Response(404, json=_REFUSAL))
            resp = client.get(
                f"{API_PREFIX}/pr-merge/graph",
                params={"repo": "other-org/other-repo", "pr": 1},
            )
        assert resp.status_code == 404
        payload = resp.json()
        assert payload["error"] == "repo_not_in_caller_tenant"
        assert payload["repo"] == "other-org/other-repo"

    def test_non_json_error_body_falls_back_to_text(self, client: TestClient):
        with _patch_httpx() as MockClient:
            _mock_get(MockClient, httpx.Response(502, text="<html>bad gateway</html>"))
            resp = client.get(
                f"{API_PREFIX}/pr-merge/graph",
                params={"repo": "a/b", "pr": 1},
            )
        assert resp.status_code == 502
        assert resp.json()["detail"] == "<html>bad gateway</html>"

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_get(MockClient, httpx.Response(200, json={}))
            instance.get.side_effect = httpx.ConnectError("refused")
            resp = client.get(
                f"{API_PREFIX}/pr-merge/graph",
                params={"repo": "a/b", "pr": 1},
            )
        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"


def test_routes_that_did_not_opt_in_keep_text_detail(client: TestClient):
    """``structured_errors`` defaults to False: a sibling ``_proxy_coord_get``
    route still forwards a JSON error body as its raw text."""
    with _patch_httpx() as MockClient:
        _mock_get(MockClient, httpx.Response(404, json=_REFUSAL))
        resp = client.get(f"{API_PREFIX}/pr-merge/prs/owner/repo/1/checks")
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "repo_not_in_caller_tenant" in detail
