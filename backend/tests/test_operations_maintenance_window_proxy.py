"""The machine / CI-host / maintenance-window proxies — wire bodies and refusals.

Plan ``2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place``
Phase 6. Nine routes under ``/api/v1/operations/fleet``, 1:1 with coord's
§D1-§D6 surface.

The properties under test are the ones a pass-through would otherwise be free
to break silently:

1. **Every write body is CLOSED and assembled here.** Coord's request structs
   are ``deny_unknown_fields``; a stray key is a 422 for the whole write, and
   ``opened_by`` in particular must never reach the wire — coord stamps the
   author from its authenticated operator.
2. **A window's expiry is mandatory and bounded** by the drain's own ceiling,
   and a window names a machine, a host, or both.
3. **Coord's typed refusals survive the hop STRUCTURED, with coord's status.**
   The page branches on ``last_matching_host`` (ask "pause anyway?") and
   ``ci_host_linked_elsewhere`` (unlink it there); a stringified detail would
   make both unreadable.
4. **Coord's success status is echoed** — ``201`` for a created window or
   link, ``200`` for an idempotent re-link.
5. **A failed read is never an empty one**: a 404 from a coord that predates
   the surface arrives as a 404, so the page renders UNKNOWN.

Same minimal-app + mocked-``httpx`` shape as
``test_operations_fleet_drain_proxy.py``; no live coord is needed.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations/fleet"
TEST_BEARER = "test-cognito-access-token"
DEVICE_ID = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd"
WINDOW_ID = "7d7d7d7d-0000-4000-8000-000000000001"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: `_tenant_headers` reads the bearer back
        # out of a ContextVar a sync dependency's worker thread would not set.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    # The admin gate itself is pinned in
    # `test_operations_coord_dashboard_proxy.py`; coord re-checks with
    # `require_tenant_admin` and an ownership floor on every id and host.
    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    resp.content = b"{}" if json_data is not None else b""
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _mock_client(MockClient, method: str, response) -> MagicMock:
    instance = MagicMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    if isinstance(response, Exception):
        setattr(instance, method, AsyncMock(side_effect=response))
    else:
        setattr(instance, method, AsyncMock(return_value=response))
    MockClient.return_value = instance
    return instance


def _future(hours: int = 4) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


def _window(**overrides) -> dict:
    body = {
        "id": WINDOW_ID,
        "machine_device_id": DEVICE_ID,
        "ci_host": "merytshost",
        "state": "open",
        "until": _future(),
        "reason": "kernel update",
        "opened_by": "jan@example.com",
        "opened_at": datetime.now(UTC).isoformat(),
        "closed_by": None,
        "closed_at": None,
        "ci_paused_at": datetime.now(UTC).isoformat(),
        "pool_health": None,
        "levers": {
            "agent_work": {"held": True, "state": "held", "detail": None},
            "ci": {
                "held": True,
                "state": "held",
                "detail": None,
                "labels": [
                    {
                        "label": "qontinui",
                        "repo": "qontinui/qontinui-web",
                        "outcome": "removed",
                        "detail": None,
                    }
                ],
            },
        },
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Machines and the CI-host join
# ---------------------------------------------------------------------------


class TestMachinesRead:
    def test_proxies_coords_machines_route_untouched(self, client: TestClient):
        body = {
            "machines": [
                {
                    "device_id": DEVICE_ID,
                    "hostname": "merytshost",
                    "state": "healthy",
                    "ci_hosts": ["merytshost"],
                    "open_window": _window(),
                    "a_field_coord_adds_later": 1,
                }
            ],
            "unlinked_ci_hosts": [{"ci_host": "msi-wsl", "open_window": None}],
        }
        with _patch_httpx() as MockClient:
            instance = _mock_client(MockClient, "get", _mock_response(200, body))
            resp = client.get(f"{API_PREFIX}/machines")

        assert resp.status_code == 200
        assert instance.get.call_args[0][0].endswith("/coord/fleet/machines")
        # No response_model: a field coord grows reaches the console.
        assert resp.json() == body
        headers = instance.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_a_404_from_an_older_coord_arrives_as_a_404(self, client: TestClient):
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "get", _mock_response(404, None, text="nf"))
            resp = client.get(f"{API_PREFIX}/machines")
        assert resp.status_code == 404

    def test_an_unreachable_coord_is_a_502_not_an_empty_fleet(self, client: TestClient):
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "get", httpx.ConnectError("refused"))
            resp = client.get(f"{API_PREFIX}/machines")
        assert resp.status_code == 502

    def test_reads_one_machines_hosts(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(
                MockClient,
                "get",
                _mock_response(200, {"device_id": DEVICE_ID, "ci_hosts": []}),
            )
            resp = client.get(f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts")
        assert resp.status_code == 200
        assert instance.get.call_args[0][0].endswith(
            f"/coord/fleet/machines/{DEVICE_ID}/ci-hosts"
        )


class TestCiHostLink:
    def test_sends_exactly_the_host_and_echoes_coords_201(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(
                MockClient,
                "post",
                _mock_response(
                    201, {"device_id": DEVICE_ID, "ci_hosts": ["merytshost"]}
                ),
            )
            resp = client.post(
                f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts",
                json={"ci_host": "  merytshost "},
            )
        assert resp.status_code == 201
        assert instance.post.call_args[0][0].endswith(
            f"/coord/fleet/machines/{DEVICE_ID}/ci-hosts"
        )
        assert instance.post.call_args.kwargs["json"] == {"ci_host": "merytshost"}

    def test_an_idempotent_relink_stays_a_200(self, client: TestClient):
        with _patch_httpx() as MockClient:
            _mock_client(
                MockClient,
                "post",
                _mock_response(
                    200, {"device_id": DEVICE_ID, "ci_hosts": ["merytshost"]}
                ),
            )
            resp = client.post(
                f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts",
                json={"ci_host": "merytshost"},
            )
        assert resp.status_code == 200

    @pytest.mark.parametrize(
        "host",
        ["", "   ", "two words", "gh-runner-merytshost@qontinui/qontinui-web"],
    )
    def test_refuses_a_host_that_is_not_a_bare_runner_name(
        self, client: TestClient, host: str
    ):
        resp = client.post(
            f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts", json={"ci_host": host}
        )
        assert resp.status_code == 422

    def test_refuses_an_extra_key(self, client: TestClient):
        resp = client.post(
            f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts",
            json={"ci_host": "merytshost", "created_by": "someone"},
        )
        assert resp.status_code == 422

    def test_passes_linked_elsewhere_through_structured(self, client: TestClient):
        refusal = {
            "error": "ci_host_linked_elsewhere",
            "message": "merytshost is linked to device 1111…",
        }
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "post", _mock_response(409, refusal))
            resp = client.post(
                f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts",
                json={"ci_host": "merytshost"},
            )
        assert resp.status_code == 409
        assert resp.json()["detail"] == refusal

    def test_unlink_percent_encodes_the_host_onto_coords_path(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(
                MockClient,
                "delete",
                _mock_response(200, {"device_id": DEVICE_ID, "ci_hosts": []}),
            )
            resp = client.delete(
                f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts/msi-wsl.local"
            )
        assert resp.status_code == 200
        assert instance.delete.call_args[0][0].endswith(
            f"/coord/fleet/machines/{DEVICE_ID}/ci-hosts/msi-wsl.local"
        )
        assert resp.json() == {"device_id": DEVICE_ID, "ci_hosts": []}

    def test_unlink_refuses_the_synthetic_hostname(self, client: TestClient):
        resp = client.delete(
            f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts/gh-runner-x@qontinui"
        )
        assert resp.status_code == 422

    def test_unlink_passes_a_typed_refusal_through_structured(self, client: TestClient):
        refusal = {"error": "device_not_in_tenant", "message": "not yours"}
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "delete", _mock_response(403, refusal))
            resp = client.delete(f"{API_PREFIX}/machines/{DEVICE_ID}/ci-hosts/h1")
        assert resp.status_code == 403
        assert resp.json()["detail"] == refusal

    def test_a_device_id_that_is_not_a_uuid_is_refused(self, client: TestClient):
        resp = client.post(
            f"{API_PREFIX}/machines/spaceship/ci-hosts", json={"ci_host": "h"}
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Maintenance windows
# ---------------------------------------------------------------------------


def _open_body(**overrides) -> dict:
    body = {
        "machine_device_id": DEVICE_ID,
        "levers": ["agent_work", "ci"],
        "until": _future(),
        "reason": "kernel update",
    }
    body.update(overrides)
    return body


class TestWindowOpen:
    def _post(self, client: TestClient, payload: dict, response=None):
        with _patch_httpx() as MockClient:
            instance = _mock_client(
                MockClient, "post", response or _mock_response(201, _window())
            )
            resp = client.post(f"{API_PREFIX}/maintenance-window", json=payload)
            return resp, instance

    def test_sends_exactly_coords_fields_and_echoes_201(self, client: TestClient):
        resp, instance = self._post(client, _open_body())
        assert resp.status_code == 201
        assert instance.post.call_args[0][0].endswith("/coord/fleet/maintenance-window")
        sent = instance.post.call_args.kwargs["json"]
        assert set(sent) == {
            "machine_device_id",
            "ci_host",
            "levers",
            "until",
            "reason",
            "accept_ci_queueing",
        }
        assert sent["machine_device_id"] == DEVICE_ID
        assert sent["ci_host"] is None
        assert sent["levers"] == ["agent_work", "ci"]
        # Never implied: the override is only ever a deliberate second request.
        assert sent["accept_ci_queueing"] is False
        assert resp.json()["levers"]["ci"]["labels"][0]["outcome"] == "removed"

    def test_forwards_the_last_host_override_when_asked(self, client: TestClient):
        _, instance = self._post(client, _open_body(accept_ci_queueing=True))
        assert instance.post.call_args.kwargs["json"]["accept_ci_queueing"] is True

    def test_a_host_only_window_is_valid(self, client: TestClient):
        resp, instance = self._post(
            client, _open_body(machine_device_id=None, ci_host="msi-wsl", levers=["ci"])
        )
        assert resp.status_code == 201
        sent = instance.post.call_args.kwargs["json"]
        assert sent["machine_device_id"] is None
        assert sent["ci_host"] == "msi-wsl"

    def test_a_window_must_name_a_machine_or_a_host(self, client: TestClient):
        resp = client.post(
            f"{API_PREFIX}/maintenance-window",
            json=_open_body(machine_device_id=None),
        )
        assert resp.status_code == 422

    @pytest.mark.parametrize("levers", [[], ["builds"]])
    def test_refuses_an_empty_or_unknown_lever_set(
        self, client: TestClient, levers: list
    ):
        resp = client.post(
            f"{API_PREFIX}/maintenance-window", json=_open_body(levers=levers)
        )
        assert resp.status_code == 422

    def test_deduplicates_levers(self, client: TestClient):
        _, instance = self._post(client, _open_body(levers=["ci", "ci"]))
        assert instance.post.call_args.kwargs["json"]["levers"] == ["ci"]

    def test_requires_an_expiry(self, client: TestClient):
        body = _open_body()
        del body["until"]
        resp = client.post(f"{API_PREFIX}/maintenance-window", json=body)
        assert resp.status_code == 422

    @pytest.mark.parametrize("delta", [timedelta(minutes=-1), timedelta(days=90)])
    def test_bounds_the_expiry_like_a_drain(self, client: TestClient, delta):
        resp = client.post(
            f"{API_PREFIX}/maintenance-window",
            json=_open_body(until=(datetime.now(UTC) + delta).isoformat()),
        )
        assert resp.status_code == 422

    def test_rejects_a_blank_reason(self, client: TestClient):
        resp = client.post(
            f"{API_PREFIX}/maintenance-window", json=_open_body(reason="   ")
        )
        assert resp.status_code == 422

    def test_never_forwards_a_client_asserted_author(self, client: TestClient):
        resp = client.post(
            f"{API_PREFIX}/maintenance-window",
            json=_open_body(opened_by="someone-else@example.com"),
        )
        assert resp.status_code == 422

    def test_passes_last_matching_host_through_structured(self, client: TestClient):
        # The page reads the code and the message to ask "pause anyway?" —
        # a stringified detail would leave it nothing to branch on.
        refusal = {
            "error": "last_matching_host",
            "message": "merytshost is the last host that runs [self-hosted, qontinui]",
            "pool_key": "self-hosted,qontinui",
        }
        resp, _ = self._post(client, _open_body(), _mock_response(409, refusal))
        assert resp.status_code == 409
        assert resp.json()["detail"] == refusal

    def test_passes_window_already_open_through_structured(self, client: TestClient):
        refusal = {"error": "window_already_open", "message": "one is open"}
        resp, _ = self._post(client, _open_body(), _mock_response(409, refusal))
        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "window_already_open"


class TestWindowList:
    def test_forwards_only_the_filters_set(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(
                MockClient, "get", _mock_response(200, {"windows": [_window()]})
            )
            resp = client.get(
                f"{API_PREFIX}/maintenance-window",
                params={"machine": DEVICE_ID},
            )
        assert resp.status_code == 200
        assert instance.get.call_args[0][0].endswith("/coord/fleet/maintenance-window")
        assert instance.get.call_args.kwargs["params"] == {
            "include_closed": "false",
            "limit": 20,
            "machine": DEVICE_ID,
        }

    def test_forwards_host_and_history_filters(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(
                MockClient, "get", _mock_response(200, {"windows": []})
            )
            client.get(
                f"{API_PREFIX}/maintenance-window",
                params={"ci_host": "msi-wsl", "include_closed": "true", "limit": 5},
            )
        assert instance.get.call_args.kwargs["params"] == {
            "include_closed": "true",
            "limit": 5,
            "ci_host": "msi-wsl",
        }

    def test_refuses_a_synthetic_host_filter(self, client: TestClient):
        resp = client.get(
            f"{API_PREFIX}/maintenance-window", params={"ci_host": "gh-runner-a@b/c"}
        )
        assert resp.status_code == 422


class TestWindowLever:
    def test_sends_lever_and_held_only_when_no_override_given(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(MockClient, "patch", _mock_response(200, _window()))
            resp = client.patch(
                f"{API_PREFIX}/maintenance-window/{WINDOW_ID}",
                json={"lever": "agent_work", "held": False},
            )
        assert resp.status_code == 200
        assert instance.patch.call_args[0][0].endswith(
            f"/coord/fleet/maintenance-window/{WINDOW_ID}"
        )
        assert instance.patch.call_args.kwargs["json"] == {
            "lever": "agent_work",
            "held": False,
        }

    def test_forwards_an_explicit_override(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = _mock_client(MockClient, "patch", _mock_response(200, _window()))
            client.patch(
                f"{API_PREFIX}/maintenance-window/{WINDOW_ID}",
                json={"lever": "ci", "held": True, "accept_ci_queueing": True},
            )
        assert instance.patch.call_args.kwargs["json"] == {
            "lever": "ci",
            "held": True,
            "accept_ci_queueing": True,
        }

    def test_passes_a_typed_refusal_through_structured(self, client: TestClient):
        refusal = {"error": "last_matching_host", "message": "last host"}
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "patch", _mock_response(409, refusal))
            resp = client.patch(
                f"{API_PREFIX}/maintenance-window/{WINDOW_ID}",
                json={"lever": "ci", "held": True},
            )
        assert resp.status_code == 409
        assert resp.json()["detail"] == refusal

    def test_refuses_an_unknown_lever(self, client: TestClient):
        resp = client.patch(
            f"{API_PREFIX}/maintenance-window/{WINDOW_ID}",
            json={"lever": "builds", "held": True},
        )
        assert resp.status_code == 422

    def test_refuses_a_window_id_that_is_not_a_uuid(self, client: TestClient):
        resp = client.patch(
            f"{API_PREFIX}/maintenance-window/latest",
            json={"lever": "ci", "held": True},
        )
        assert resp.status_code == 422


class TestWindowClose:
    def test_sends_the_reason_only(self, client: TestClient):
        closed = _window(state="closed")
        with _patch_httpx() as MockClient:
            instance = _mock_client(MockClient, "post", _mock_response(200, closed))
            resp = client.post(
                f"{API_PREFIX}/maintenance-window/{WINDOW_ID}/close",
                json={"reason": "  kernel updated  "},
            )
        assert resp.status_code == 200
        assert instance.post.call_args[0][0].endswith(
            f"/coord/fleet/maintenance-window/{WINDOW_ID}/close"
        )
        assert instance.post.call_args.kwargs["json"] == {"reason": "kernel updated"}
        assert resp.json()["state"] == "closed"

    def test_requires_a_reason(self, client: TestClient):
        resp = client.post(
            f"{API_PREFIX}/maintenance-window/{WINDOW_ID}/close", json={}
        )
        assert resp.status_code == 422


class TestWindowReadiness:
    def test_proxies_the_verdict_untouched(self, client: TestClient):
        verdict = {
            "window_id": WINDOW_ID,
            "verdict": "unknown",
            "reasons": ["the agent plane is not served yet"],
            "computed_at": datetime.now(UTC).isoformat(),
            "levers_held": {"agent_work": True, "ci": True},
            "planes": {
                "agent": {"verdict": "unknown", "sample_age_secs": None},
                "github_ci": {"verdict": "safe", "registrations": []},
                "ci_node": {"verdict": "safe", "active_dispatches": 0},
            },
        }
        with _patch_httpx() as MockClient:
            instance = _mock_client(MockClient, "get", _mock_response(200, verdict))
            resp = client.get(f"{API_PREFIX}/maintenance-window/{WINDOW_ID}/readiness")
        assert resp.status_code == 200
        assert instance.get.call_args[0][0].endswith(
            f"/coord/fleet/maintenance-window/{WINDOW_ID}/readiness"
        )
        assert resp.json() == verdict

    def test_a_timeout_is_a_504_not_a_verdict(self, client: TestClient):
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "get", httpx.ReadTimeout("slow"))
            resp = client.get(f"{API_PREFIX}/maintenance-window/{WINDOW_ID}/readiness")
        assert resp.status_code == 504


# ---------------------------------------------------------------------------
# The error body the browser actually receives
# ---------------------------------------------------------------------------


@pytest.fixture()
def enveloped_client() -> TestClient:
    """The app WITH the production HTTPException handler registered.

    Every other test here runs against a bare ``FastAPI()`` and so sees
    FastAPI's ``{"detail": …}``. Production registers
    ``app.middleware.error_handler.http_exception_handler``, which rewrites
    the body into the ``{"error", "message", "timestamp", "path", …}``
    envelope — and the page reads THAT. A test of the wire the page parses
    has to go through it.
    """
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import http_exception_handler

    app = _build_test_app()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    return TestClient(app)


SCHEMA_PENDING = {
    "error": "schema_pending",
    "message": "coord.maintenance_windows does not exist yet",
}


class TestReadErrorsReachTheBrowserStructured:
    @pytest.mark.parametrize(
        "path",
        [
            "/machines",
            f"/machines/{DEVICE_ID}/ci-hosts",
            "/maintenance-window",
            f"/maintenance-window/{WINDOW_ID}/readiness",
        ],
    )
    def test_schema_pending_keeps_coords_code_at_the_top_level(
        self, enveloped_client: TestClient, path: str
    ):
        # The defect this pins: a text detail turned coord's 503 into
        # {"error": "SERVICE_UNAVAILABLE", "message": "{\"error\": …}"}, so the
        # page could never see `schema_pending`.
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "get", _mock_response(503, SCHEMA_PENDING))
            resp = enveloped_client.get(f"{API_PREFIX}{path}")
        assert resp.status_code == 503
        body = resp.json()
        assert body["error"] == "schema_pending"
        assert body["message"] == SCHEMA_PENDING["message"]

    def test_a_non_json_coord_error_still_arrives_as_text(
        self, enveloped_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            resp_mock = _mock_response(502, None, text="<html>bad gateway</html>")
            resp_mock.json.side_effect = ValueError("not json")
            _mock_client(MockClient, "get", resp_mock)
            resp = enveloped_client.get(f"{API_PREFIX}/machines")
        assert resp.status_code == 502
        assert resp.json()["message"] == "<html>bad gateway</html>"

    def test_other_get_routes_keep_their_text_detail(
        self, enveloped_client: TestClient
    ):
        # Opt-in: the CI-runner mirror read (not a maintenance route) keeps
        # the text detail its consumers parse today.
        with _patch_httpx() as MockClient:
            _mock_client(MockClient, "get", _mock_response(503, SCHEMA_PENDING))
            resp = enveloped_client.get(f"{API_PREFIX}/ci-runners")
        assert resp.status_code == 503
        body = resp.json()
        assert body["error"] == "SERVICE_UNAVAILABLE"
        assert "schema_pending" in body["message"]
