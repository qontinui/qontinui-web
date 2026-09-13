"""The `/admin/coord/runners` proxies — session census, session control, and
the readiness fields riding the resource-sample read.

Plan ``2026-09-13-drained-runner-never-reaches-idle`` Phase 8. Three things
under ``/api/v1/operations``:

* ``GET  /sessions/fleet``                 — coord's per-device session census
* ``POST /sessions/{session_id}/control``  — finish-and-close / stop-at-boundary
* ``GET  /fleet/resource-samples``         — unchanged route; its rows now carry
  the device's restart-readiness verdict, which must pass through untouched

The properties pinned, each one a way this surface could fail silently:

1. **``/sessions/fleet`` is not swallowed by ``/sessions/{session_id}``.**
   FastAPI matches in declaration order; declared in the wrong place, the
   census read reaches the single-session route and 422s on a non-UUID id.
2. **The control body is CLOSED and assembled here.** No browser key reaches
   coord that the contract does not name — ``requested_by`` above all, which
   coord stamps from the authenticated operator.
3. **Coord's 202 and its typed refusals survive the hop.** ``session_not_found``
   and ``session_closed`` are different facts; a proxy that flattens them into
   one "failed", or wraps the 202 as a 200, loses exactly what the operator
   needs to decide the next step.
4. **A NULL readiness field stays NULL.** ``readiness_safe: null`` is "the
   runner could not decide"; a default here would render a verdict nobody
   reached.

Same minimal-app + mocked-``httpx`` shape as
``test_operations_fleet_drain_proxy.py``; no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
FLEET_SESSIONS_ROUTE = f"{API_PREFIX}/sessions/fleet"
RESOURCE_SAMPLES_ROUTE = f"{API_PREFIX}/fleet/resource-samples"

TEST_BEARER = "test-cognito-access-token"
DEVICE_ID = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd"
SESSION_ID = "8d0f5a2e-1c3b-4e5f-9a7b-6c5d4e3f2a1b"
CONTROL_ROUTE = f"{API_PREFIX}/sessions/{SESSION_ID}/control"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: FastAPI runs a SYNC dependency in a
        # worker thread whose ContextVar writes never reach the request task,
        # and `_tenant_headers` reads the bearer back out of that ContextVar.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    # The admin gate itself is pinned in
    # `test_operations_coord_dashboard_proxy.py`; that the control route
    # DEPENDS on it is pinned below.
    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


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


def _fleet_body() -> dict:
    return {
        "tenantId": str(TEST_TENANT_ID),
        "callerDeviceId": None,
        "sessions": [
            {
                "sessionId": SESSION_ID,
                "deviceId": DEVICE_ID,
                "isCallerDevice": False,
                "claudeCodeSessionId": "0f0e0d0c-0b0a-4908-8706-050403020100",
                "sessionStatus": "working",
                "state": "active",
                "startedAt": "2026-09-13T10:00:00Z",
                "spawnOrigin": "steward",
                "continuationGateId": None,
                "dispatchSource": None,
            }
        ],
        "count": 1,
        "limit": 500,
        "nextCursor": None,
        "sessionBridgeColumnPresent": True,
        "workAxisColumnsPresent": True,
        "deviceIdentityColumnsPresent": True,
    }


# ---------------------------------------------------------------------------
# GET /sessions/fleet
# ---------------------------------------------------------------------------


class TestFleetSessions:
    def test_reaches_coords_fleet_route_not_the_single_session_route(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, _fleet_body())
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(
                FLEET_SESSIONS_ROUTE, params={"device_id": DEVICE_ID}
            )

        assert resp.status_code == 200
        url = mock_instance.get.call_args.args[0]
        assert url.endswith("/coord/sessions/fleet")
        assert mock_instance.get.call_args.kwargs["params"] == {"device_id": DEVICE_ID}

    def test_body_passes_through_verbatim_in_coords_casing(
        self, auth_client: TestClient
    ):
        body = _fleet_body()
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(
                FLEET_SESSIONS_ROUTE, params={"device_id": DEVICE_ID}
            )

        assert resp.json() == body
        row = resp.json()["sessions"][0]
        # The D7 origin fields arrive camelCase, and a null gate stays null.
        assert row["spawnOrigin"] == "steward"
        assert row["continuationGateId"] is None

    def test_forwards_only_the_filters_that_were_set(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, _fleet_body())
            )
            _configure_mock_client(MockClient, mock_instance)
            auth_client.get(
                FLEET_SESSIONS_ROUTE,
                params={
                    "device_id": DEVICE_ID,
                    "limit": 500,
                    "include_closed": "false",
                    "cursor": "opaque-token",
                },
            )
            params = mock_instance.get.call_args.kwargs["params"]

        assert params == {
            "device_id": DEVICE_ID,
            "limit": 500,
            "include_closed": False,
            "cursor": "opaque-token",
        }

    def test_forwards_the_operator_bearer(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, _fleet_body())
            )
            _configure_mock_client(MockClient, mock_instance)
            auth_client.get(FLEET_SESSIONS_ROUTE)
            headers = mock_instance.get.call_args.kwargs["headers"]

        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_a_coord_failure_is_not_an_empty_census(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(500, None, text="db unavailable")
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(
                FLEET_SESSIONS_ROUTE, params={"device_id": DEVICE_ID}
            )

        assert resp.status_code == 500

    def test_coord_unreachable_is_a_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(FLEET_SESSIONS_ROUTE)

        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# POST /sessions/{session_id}/control
# ---------------------------------------------------------------------------


class TestSessionControl:
    def test_route_is_admin_gated(self):
        from app.api.v1.endpoints.operations import (
            require_coord_tenant_admin,
        )
        from app.api.v1.endpoints.operations import router as operations_router

        route = next(
            r
            for r in operations_router.routes
            if getattr(r, "path", None) == "/sessions/{session_id}/control"
            and "POST" in getattr(r, "methods", set())
        )
        calls = [d.call for d in route.dependant.dependencies]
        assert require_coord_tenant_admin in calls

    def test_forwards_a_closed_body_and_echoes_coords_202(
        self, auth_client: TestClient
    ):
        accepted = {
            "event_id": "1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f",
            "session_id": SESSION_ID,
            "device_id": DEVICE_ID,
            "action": "finish_and_close",
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(return_value=_mock_response(202, accepted))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                CONTROL_ROUTE,
                json={"action": "finish_and_close", "reason": "  rebuilding  "},
            )

        assert resp.status_code == 202
        assert resp.json() == accepted
        url = mock_instance.post.call_args.args[0]
        assert url.endswith(f"/coord/sessions/{SESSION_ID}/control")
        assert mock_instance.post.call_args.kwargs["json"] == {
            "action": "finish_and_close",
            "reason": "rebuilding",
        }

    def test_a_blank_reason_is_omitted_not_recorded(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(return_value=_mock_response(202, {}))
            _configure_mock_client(MockClient, mock_instance)
            auth_client.post(
                CONTROL_ROUTE, json={"action": "stop_at_boundary", "reason": "   "}
            )
            wire = mock_instance.post.call_args.kwargs["json"]

        assert wire == {"action": "stop_at_boundary"}

    @pytest.mark.parametrize(
        "body",
        [
            {"action": "kill"},
            {"action": "finish_and_close", "requested_by": "someone@example.com"},
            {},
        ],
        ids=["unknown-action", "client-asserted-author", "no-action"],
    )
    def test_off_contract_bodies_are_refused_before_coord_is_asked(
        self, auth_client: TestClient, body: dict
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(return_value=_mock_response(202, {}))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(CONTROL_ROUTE, json=body)

        assert resp.status_code == 422
        mock_instance.post.assert_not_called()

    def test_a_non_uuid_session_id_is_refused_locally(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(return_value=_mock_response(202, {}))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                f"{API_PREFIX}/sessions/not-a-uuid/control",
                json={"action": "finish_and_close"},
            )

        assert resp.status_code == 422
        mock_instance.post.assert_not_called()

    @pytest.mark.parametrize(
        ("status", "error"),
        [(404, "session_not_found"), (409, "session_closed"), (422, "unknown_action")],
    )
    def test_coords_typed_refusals_survive_the_hop(
        self, auth_client: TestClient, status: int, error: str
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(status, {"error": error})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(CONTROL_ROUTE, json={"action": "finish_and_close"})

        assert resp.status_code == status
        # `structured_errors=True`: the detail is coord's OBJECT, not a string
        # the browser would have to JSON-parse a second time.
        assert resp.json()["detail"] == {"error": error}

    def test_coord_unreachable_is_a_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(CONTROL_ROUTE, json={"action": "finish_and_close"})

        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /fleet/resource-samples — the readiness fields
# ---------------------------------------------------------------------------


class TestReadinessRidesTheResourceSample:
    def test_readiness_fields_pass_through_untouched_and_null_stays_null(
        self, auth_client: TestClient
    ):
        row = {
            "device_id": DEVICE_ID,
            "lane": "host",
            "sampled_at": "2026-09-13T10:00:00Z",
            "age_secs": 12.0,
            "readiness_safe": None,
            "readiness_reason": None,
            "readiness_blocking": None,
            "readiness_finished": 2,
            "wind_down_candidates": 0,
            "wind_down_exit_stuck": 0,
            "wind_down_sessions": [
                {
                    "claude_code_session_id": "0f0e0d0c-0b0a-4908-8706-050403020100",
                    "blocks_restart": True,
                    "idle_state": "idle",
                    "eligibility": "ineligible",
                    "close_eligible_at": None,
                    "exit_stuck": False,
                    "spawn_origin": "operator_terminal",
                }
            ],
            "wind_down_sessions_truncated": False,
            "readiness_age_secs": 12,
            "readiness_state": "fresh",
        }
        body = {"latest": [row], "count": 1, "history": [], "schema_pending": False}
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(
                RESOURCE_SAMPLES_ROUTE,
                params={"device_id": DEVICE_ID, "history": "false"},
            )
            params = mock_instance.get.call_args.kwargs["params"]

        assert resp.status_code == 200
        assert resp.json() == body
        served = resp.json()["latest"][0]
        assert served["readiness_safe"] is None
        assert served["readiness_blocking"] is None
        assert params == {"device_id": DEVICE_ID, "history": False}


class TestControlSuccessBodies:
    def test_a_non_json_2xx_is_an_empty_body_with_coords_status(
        self, auth_client: TestClient
    ):
        accepted = MagicMock(spec=httpx.Response)
        accepted.status_code = 202
        accepted.text = ""
        accepted.json.side_effect = ValueError("Expecting value")
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(return_value=accepted)
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(CONTROL_ROUTE, json={"action": "finish_and_close"})

        # Accepted is accepted: never a 500 because the body would not parse.
        assert resp.status_code == 202
        assert resp.json() == {}


# ---------------------------------------------------------------------------
# The control proxy through the app's REAL error envelope
# ---------------------------------------------------------------------------


def _build_enveloped_app() -> FastAPI:
    """The minimal test app plus the two handlers `app.main` registers.

    The other tests here run on a bare ``FastAPI()``, where a structured
    ``detail`` comes back nested as ``{"detail": {...}}``. Production splices
    it to the top level through ``http_exception_handler``, and answers its own
    validation through ``validation_exception_handler`` — the two shapes the
    browser actually parses. Registering the same functions ``app.main`` does
    pins those shapes without importing the whole application.
    """
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import (
        http_exception_handler,
        validation_exception_handler,
    )

    test_app = _build_test_app()
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    test_app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    return test_app


class TestControlThroughTheAppErrorEnvelope:
    @pytest.fixture()
    def enveloped_client(self) -> TestClient:
        return TestClient(_build_enveloped_app())

    @pytest.mark.parametrize(
        ("status", "error"),
        [(404, "session_not_found"), (409, "session_closed"), (422, "unknown_action")],
    )
    def test_coords_code_lands_at_the_top_level(
        self, enveloped_client: TestClient, status: int, error: str
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(status, {"error": error})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = enveloped_client.post(
                CONTROL_ROUTE, json={"action": "finish_and_close"}
            )

        assert resp.status_code == status
        body = resp.json()
        # The frontend's `describeControlError` reads `error` here first.
        assert body["error"] == error
        assert "detail" not in body
        assert "message" in body

    def test_the_webs_own_validation_is_a_distinct_422(
        self, enveloped_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(return_value=_mock_response(202, {}))
            _configure_mock_client(MockClient, mock_instance)
            resp = enveloped_client.post(
                CONTROL_ROUTE,
                json={"action": "finish_and_close", "reason": "x" * 2001},
            )

        assert resp.status_code == 422
        body = resp.json()
        # `VALIDATION_ERROR` + `details` is what tells the browser nothing
        # reached coord, as opposed to coord's own typed 422 above.
        assert body["error"] == "VALIDATION_ERROR"
        assert [d["field"] for d in body["details"]] == ["body.reason"]
        mock_instance.post.assert_not_called()
