"""The ``/operations/topics*`` proxies over coord's topic operator reads.

Plan ``2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator``
Phase 8 (pages). Two routes under ``/api/v1/operations``:

  - ``GET /topics``       → coord ``GET /coord/topics``
  - ``GET /topics/{id}``  → coord ``GET /coord/topics/{id}``

Mirrors ``test_operations_subprojects_proxy.py``'s read tests: coord's body
arrives unchanged (a field this proxy never heard of included), only the
filters that were set are forwarded, a pending migration reaches the browser
as an object, a typed id cannot re-aim the path, and an unresolved tenant is
refused before coord is called.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
_FIXTURE_TENANT_ID = UUID("11111111-2222-3333-4444-555555555555")
TOPIC_ID = "7a1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
SUBPROJECT_ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
TENANT_HEADER = "X-Qontinui-Tenant-Id"


def _build_test_app(*, resolves_tenant: bool = True) -> FastAPI:
    """The operations router with the tenant dependency overridden."""
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = False
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
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=True))


@pytest.fixture()
def unresolved_client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=False))


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    resp.content = (resp.text or "").encode()
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(mock_client_cls: MagicMock, instance: AsyncMock) -> None:
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    mock_client_cls.return_value = instance


def _assert_bearer_forwarded_without_tenant_header(call: Any) -> None:
    headers = call.kwargs.get("headers")
    assert headers is not None
    assert TENANT_HEADER not in headers


LIST_BODY: dict[str, Any] = {
    "as_of": "2026-11-20T12:00:00Z",
    "tables_ready": True,
    "unassigned_subprojects": None,
    "topics": [
        {
            "id": TOPIC_ID,
            "slug": "subproject-topics",
            "title": "Subproject topics",
            "summary": None,
            "status": "active",
            "parent_topic_id": None,
            "headline": "stalled",
            "top_reason": "qontinui-coord#4298 waits on a closed author",
            "subprojects_total": 3,
            "subprojects_working": None,
            "unknown_members": 1,
            "last_activity_at": "2026-11-20T11:00:00Z",
            "last_rollup_as_of": None,
            # A field this proxy has never heard of: it must still arrive.
            "a_field_coord_adds_later": {"nested": [1, 2]},
        }
    ],
}

DETAIL_BODY: dict[str, Any] = {
    "as_of": "2026-11-20T12:00:00Z",
    "topic": {
        **LIST_BODY["topics"][0],
        "next_steps": "Land the coord doors, then the pages.",
        "intent_ref": None,
        "aliases": ["topics"],
        "created_by": "agent",
        "merged_into": None,
    },
    "members": [
        {
            "subproject_id": SUBPROJECT_ID,
            "subproject_title": None,
            "weight": 0.82,
            "state": "confirmed",
            "decided_by": "agent",
            "decided_by_session": None,
            "basis": [
                {"signal": "plan_family", "ref": "2026-11-16-x", "score": 0.9},
                {"signal": "semantic", "ref": "could_not_read", "score": None},
            ],
            "headline": None,
        }
    ],
    "children": [],
    "history": [],
}


class TestGetTopics:
    def test_returns_coord_body_unchanged(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics")

        assert resp.status_code == 200
        assert resp.json() == LIST_BODY
        call = instance.get.call_args
        assert call.args[0].endswith("/coord/topics")
        # Nothing was asked for, so nothing is invented: coord's default decides.
        assert call.kwargs.get("params") is None
        _assert_bearer_forwarded_without_tenant_header(call)

    def test_forwards_exactly_the_filters_that_were_set(
        self, client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/topics", params={"status": "active", "limit": 50}
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {
            "status": "active",
            "limit": 50,
        }

    def test_a_limit_outside_the_bound_is_refused_before_coord(
        self, client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics", params={"limit": 0})

        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_a_pending_migration_reaches_the_browser_as_an_object(
        self, client: TestClient
    ) -> None:
        """The page says "topics not available yet (migration pending)" on
        exactly this answer, so its code must arrive as data."""
        coord_body = {"error": "schema_migration_pending"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=503, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics")

        assert resp.status_code == 503
        assert resp.json() == {"detail": coord_body}

    def test_reads_under_the_subprojects_budget(self, client: TestClient) -> None:
        from app.api.v1.endpoints.operations import _COORD_SUBPROJECTS_TIMEOUT

        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            client.get(f"{API_PREFIX}/topics")

        assert mock_client_cls.call_args.kwargs["timeout"] == (
            _COORD_SUBPROJECTS_TIMEOUT
        )

    def test_unresolved_tenant_is_forbidden(
        self, unresolved_client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = unresolved_client.get(f"{API_PREFIX}/topics")

        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"
        instance.get.assert_not_called()

    def test_coord_unreachable_returns_502(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics")

        assert resp.status_code == 502


class TestGetTopic:
    def test_returns_coord_body_unchanged(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=DETAIL_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics/{TOPIC_ID}")

        assert resp.status_code == 200
        assert resp.json() == DETAIL_BODY
        call = instance.get.call_args
        assert call.args[0].endswith(f"/coord/topics/{TOPIC_ID}")
        _assert_bearer_forwarded_without_tenant_header(call)

    def test_reads_under_the_subprojects_budget(self, client: TestClient) -> None:
        from app.api.v1.endpoints.operations import _COORD_SUBPROJECTS_TIMEOUT

        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=DETAIL_BODY)
            _configure_mock_client(mock_client_cls, instance)
            client.get(f"{API_PREFIX}/topics/{TOPIC_ID}")

        assert mock_client_cls.call_args.kwargs["timeout"] == (
            _COORD_SUBPROJECTS_TIMEOUT
        )

    def test_coord_404_passes_through(self, client: TestClient) -> None:
        coord_body = {"error": "topic_not_found"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=404, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics/{TOPIC_ID}")

        assert resp.status_code == 404
        assert resp.json() == {"detail": coord_body}

    def test_a_pending_migration_reaches_the_browser_as_an_object(
        self, client: TestClient
    ) -> None:
        coord_body = {"error": "schema_migration_pending"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=503, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics/{TOPIC_ID}")

        assert resp.status_code == 503
        assert resp.json() == {"detail": coord_body}

    @pytest.mark.parametrize("bad_id", ["not-a-uuid", "..", "%2E%2E"])
    def test_an_id_that_is_not_a_uuid_never_reaches_coord(
        self, client: TestClient, bad_id: str
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/topics/{bad_id}")

        assert resp.status_code in (404, 422)
        instance.get.assert_not_called()

    def test_unresolved_tenant_is_forbidden(
        self, unresolved_client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = unresolved_client.get(f"{API_PREFIX}/topics/{TOPIC_ID}")

        assert resp.status_code == 403
        instance.get.assert_not_called()


def test_the_pending_migration_envelope_splices_coords_keys_to_the_top_level() -> None:
    """With the app's real HTTP-exception handler, ``error`` lands at the TOP
    level of the envelope — where the page's refusal reader looks first."""
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import http_exception_handler

    app = _build_test_app(resolves_tenant=True)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    with _patch_httpx() as mock_client_cls:
        instance = AsyncMock()
        instance.get.return_value = _mock_response(
            status_code=503, json_data={"error": "schema_migration_pending"}
        )
        _configure_mock_client(mock_client_cls, instance)
        resp = TestClient(app).get(f"{API_PREFIX}/topics")

    assert resp.status_code == 503
    assert resp.json()["error"] == "schema_migration_pending"
