"""Tests for the spawn-launch-settings proxy.

Plan ``2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type``
Phase 5. ``/api/v1/spawn-launch-settings`` proxies coord's
``/coord/spawn-launch-settings``. What this file pins:

1. The GET renders coord's rows and vocabularies, with ``can_edit`` from the
   effective-tenant rule.
2. **An unreadable read is never "inherit"**: a coord failure passes through,
   an empty 404 (route not deployed) is the deploy-order 502, and a 200 whose
   rows carry an unknown model/effort or no ``settings`` key is a 502.
3. The PUT body is closed: both keys required, each nullable, ``null`` is sent
   as ``null`` (inherit is a write), and a value outside the vocabulary is a
   local 422 that never reaches coord.
4. The PUT answers with coord's row (the read-back), and a row it cannot read
   is a 502 saying the change may have been applied.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/spawn-launch-settings"

ROW_STORED = {
    "spawn_type": "post_merge",
    "description": "Post-merge follow-up continuations",
    "model": "sonnet",
    "effort": None,
    "source": "stored",
    "updated_by": "operator@example.com",
    "updated_at": "2026-11-15T10:00:00Z",
}
ROW_DEFAULT = {
    "spawn_type": "vet_plan",
    "description": "Plan vetting continuations",
    "model": None,
    "effort": None,
    "source": "default",
    "updated_by": None,
    "updated_at": None,
}
COORD_GET = {
    "settings": [ROW_STORED, ROW_DEFAULT],
    "model_families": ["fable", "opus", "sonnet", "haiku"],
    "effort_levels": ["low", "medium", "high", "xhigh", "max"],
}


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.spawn_launch_settings import router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    resolved = uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
    test_app.include_router(router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text if text is not None else str(json_data)
    resp.content = b"x" if text != "" else b""
    if text == "":
        resp.json.side_effect = ValueError("empty")
    return resp


@contextmanager
def _patch_identity(effective_roles=("admin",)):
    identity = MagicMock()
    identity.is_admin = "admin" not in effective_roles
    with (
        patch(
            "app.api.v1.endpoints.spawn_launch_settings.get_coord_identity",
            AsyncMock(return_value=identity),
        ),
        patch(
            "app.api.v1.endpoints.spawn_launch_settings._effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


@contextmanager
def _coord(get=None, put=None):
    instance = MagicMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    if get is not None:
        instance.get = get
    if put is not None:
        instance.put = put
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as mock_client:
        mock_client.return_value = instance
        yield instance


class TestGet:
    def test_rows_and_vocabularies_round_trip(self, client: TestClient):
        with (
            _coord(get=AsyncMock(return_value=_mock_response(200, COORD_GET))) as c,
            _patch_identity(),
        ):
            resp = client.get(API_PREFIX)
        assert resp.status_code == 200
        body = resp.json()
        assert body["settings"] == [ROW_STORED, ROW_DEFAULT]
        assert body["model_families"] == ["fable", "opus", "sonnet", "haiku"]
        assert body["effort_levels"] == ["low", "medium", "high", "xhigh", "max"]
        assert body["can_edit"] is True
        assert c.get.call_args.args[0].endswith("/coord/spawn-launch-settings")

    def test_can_edit_false_for_non_admin(self, client: TestClient):
        with (
            _coord(get=AsyncMock(return_value=_mock_response(200, COORD_GET))),
            _patch_identity(effective_roles=("developer",)),
        ):
            resp = client.get(API_PREFIX)
        assert resp.status_code == 200
        assert resp.json()["can_edit"] is False

    def test_coord_failure_passes_through(self, client: TestClient):
        with (
            _coord(
                get=AsyncMock(
                    return_value=_mock_response(503, {"error": "table_absent"})
                )
            ),
            _patch_identity(),
        ):
            resp = client.get(API_PREFIX)
        assert resp.status_code == 503

    def test_route_absent_is_deploy_order_502(self, client: TestClient):
        with (
            _coord(get=AsyncMock(return_value=_mock_response(404, None, text=""))),
            _patch_identity(),
        ):
            resp = client.get(API_PREFIX)
        assert resp.status_code == 502
        assert resp.json()["detail"].startswith("coord does not serve ")

    @pytest.mark.parametrize(
        "payload",
        [
            {"model_families": [], "effort_levels": []},
            {**COORD_GET, "settings": [{**ROW_STORED, "model": "gpt-5"}]},
            {**COORD_GET, "settings": [{**ROW_STORED, "effort": "extreme"}]},
            {**COORD_GET, "settings": [{**ROW_STORED, "source": "guessed"}]},
            {
                **COORD_GET,
                "settings": [
                    {k: v for k, v in ROW_STORED.items() if k != "description"}
                ],
            },
            ["not", "an", "object"],
        ],
    )
    def test_unreadable_200_is_502_never_inherit(self, client: TestClient, payload):
        with (
            _coord(get=AsyncMock(return_value=_mock_response(200, payload))),
            _patch_identity(),
        ):
            resp = client.get(API_PREFIX)
        assert resp.status_code == 502
        assert "unknown" in resp.json()["detail"]


NO_SUCH_ROUTE = {
    "error": "no_such_route",
    "message": "coord serves no such route",
    "did_you_mean": [],
}


class TestRouteAbsentFallback:
    def test_get_no_such_route_body_is_deploy_order_502(self, client: TestClient):
        with (
            _coord(get=AsyncMock(return_value=_mock_response(404, NO_SUCH_ROUTE))),
            _patch_identity(),
        ):
            resp = client.get(API_PREFIX)
        assert resp.status_code == 502
        assert resp.json()["detail"].startswith("coord does not serve ")

    def test_put_no_such_route_body_is_deploy_order_502(self, client: TestClient):
        put = AsyncMock(return_value=_mock_response(404, NO_SUCH_ROUTE))
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/post_merge", json={"model": None, "effort": None}
            )
        assert resp.status_code == 502
        assert resp.json()["detail"].startswith("coord does not serve ")

    def test_application_404_passes_through(self, client: TestClient):
        put = AsyncMock(
            return_value=_mock_response(404, {"error": "unknown_spawn_type"})
        )
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/post_merge", json={"model": None, "effort": None}
            )
        assert resp.status_code == 404


def test_production_body_carries_the_sentence_the_frontend_reads():
    """Under the production handler the deploy-order sentence is the top-level
    ``message`` (``writeOutcome.ts`` ``proxyDetailOf`` falls back to it), with a
    typed refusal beside it."""
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import http_exception_handler

    app = _build_test_app()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    put = AsyncMock(return_value=_mock_response(404, NO_SUCH_ROUTE))
    with _coord(put=put):
        resp = TestClient(app).put(
            f"{API_PREFIX}/post_merge", json={"model": None, "effort": None}
        )
    assert resp.status_code == 502
    body = resp.json()
    assert body["message"].startswith("coord does not serve ")
    assert "refusal" in body


class TestPut:
    def test_writes_full_pair_and_returns_coord_row(self, client: TestClient):
        put = AsyncMock(return_value=_mock_response(200, ROW_STORED))
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/post_merge", json={"model": "sonnet", "effort": None}
            )
        assert resp.status_code == 200
        assert resp.json() == ROW_STORED
        assert put.call_args.args[0].endswith("/coord/spawn-launch-settings/post_merge")
        assert put.call_args.kwargs["json"] == {"model": "sonnet", "effort": None}

    def test_inherit_sends_explicit_nulls(self, client: TestClient):
        put = AsyncMock(
            return_value=_mock_response(
                200, {**ROW_STORED, "model": None, "effort": None}
            )
        )
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/post_merge", json={"model": None, "effort": None}
            )
        assert resp.status_code == 200
        assert put.call_args.kwargs["json"] == {"model": None, "effort": None}

    @pytest.mark.parametrize(
        "body",
        [
            {"model": "gpt-5", "effort": None},
            {"model": None, "effort": "extreme"},
            {"model": "sonnet"},  # effort omitted: the pair is required
            {"effort": "high"},  # model omitted
            {"model": None, "effort": None, "ultracode": True},
        ],
    )
    def test_closed_body_refused_locally(self, client: TestClient, body):
        put = AsyncMock()
        with _coord(put=put):
            resp = client.put(f"{API_PREFIX}/post_merge", json=body)
        assert resp.status_code == 422
        put.assert_not_called()

    def test_malformed_spawn_type_refused_locally(self, client: TestClient):
        put = AsyncMock()
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/Post-Merge", json={"model": None, "effort": None}
            )
        assert resp.status_code == 422
        put.assert_not_called()

    def test_coord_refusal_passes_through_structured(self, client: TestClient):
        refusal = {"error": "unknown_spawn_type", "settable": ["post_merge"]}
        put = AsyncMock(return_value=_mock_response(422, refusal))
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/steward", json={"model": "opus", "effort": "high"}
            )
        assert resp.status_code == 422

    def test_route_absent_is_deploy_order_502(self, client: TestClient):
        put = AsyncMock(return_value=_mock_response(404, None, text=""))
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/post_merge", json={"model": None, "effort": None}
            )
        assert resp.status_code == 502
        assert resp.json()["detail"].startswith("coord does not serve ")

    @pytest.mark.parametrize(
        "answer",
        [
            {**ROW_STORED, "model": "gpt-5"},
            {**ROW_STORED, "spawn_type": "vet_plan"},
            {"ok": True},
        ],
    )
    def test_unreadable_write_answer_is_502_maybe_applied(
        self, client: TestClient, answer
    ):
        put = AsyncMock(return_value=_mock_response(200, answer))
        with _coord(put=put):
            resp = client.put(
                f"{API_PREFIX}/post_merge", json={"model": "sonnet", "effort": None}
            )
        assert resp.status_code == 502
        assert "may have been applied" in resp.json()["detail"]
