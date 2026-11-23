"""Tests for the Dev Ops Capacity panel's proxies (plan
``2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`` Phase 11).

Three properties, each easy to lose silently:

1. ``GET /fleet/capacity`` reaches coord's OPERATOR door
   (``/coord/fleet/capacity/operator``) — the ``/coord/fleet/capacity`` twin is
   a device/agent ``require_jwt`` door that refuses this proxy's Cognito
   bearer — and passes coord's body through verbatim, UNKNOWNs included.
2. The dial read never resolves an unread dial to ``enforce``: every way coord
   can fail to hand one over is ``dial: None`` with a named reason (plan D9).
3. The dial write sends ONLY the two dial fields inside ``controls``, so
   coord's field-by-field merge leaves every other control on the
   ``fleet_resources`` row untouched, and coord's typed vocabulary refusal
   reaches the browser structured.
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

DIAL = {
    "mode": "enforce",
    "mode_source": "default",
    "off_consumers": [],
    "ignored_off_consumers": [],
    "permitted_consumers": ["agent_placement", "merge_train"],
    "consumers": ["agent_placement", "merge_train"],
}

COORD_CONTROLS_GET = {
    "domain": "fleet_resources",
    "effective_level": "controls",
    "master_enabled": True,
    "resolved_scope": "tenant",
    "controls_available": True,
    "controls": {"max_concurrent_agents": 4},
    "capacity_controls_available": True,
    "capacity_model_available": True,
    "capacity_model": DIAL,
}


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    resolved = uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
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
    resp.content = b"{}"
    resp.headers = {"content-type": "application/json"}
    return resp


@contextmanager
def _patched_httpx(instance: MagicMock):
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as cls:
        cls.return_value = instance
        yield


@contextmanager
def _patch_identity(effective_roles=("admin",)):
    with (
        patch_ops("get_coord_identity", AsyncMock(return_value=MagicMock())),
        patch_ops(
            "_effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


class TestGetFleetCapacity:
    def test_reads_coords_operator_door_and_passes_unknowns_through(
        self, client: TestClient
    ):
        body = {
            "state": "known",
            "devices": [
                {
                    "device_id": "d-1",
                    "free_cpu_cores": {"state": "unknown", "reason": "no sample"},
                }
            ],
        }
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, body))
        with _patched_httpx(instance):
            resp = client.get(f"{API_PREFIX}/fleet/capacity")
        assert resp.status_code == 200
        assert resp.json() == body
        url = instance.get.call_args.args[0]
        assert url.endswith("/coord/fleet/capacity/operator")

    def test_forwards_a_device_filter_and_coords_refusal_status(
        self, client: TestClient
    ):
        device = uuid4()
        refusal = {"error": "device_not_in_plan"}
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(404, refusal))
        with _patched_httpx(instance):
            resp = client.get(f"{API_PREFIX}/fleet/capacity?device_id={device}")
        assert resp.status_code == 404
        assert resp.json() == refusal
        assert instance.get.call_args.kwargs["params"] == {"device_id": str(device)}


class TestGetCapacityModel:
    def test_projects_the_resolved_dial(self, client: TestClient):
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_CONTROLS_GET))
        with _patched_httpx(instance), _patch_identity():
            resp = client.get(f"{API_PREFIX}/fleet/capacity-model")
        assert resp.status_code == 200
        body = resp.json()
        assert body["dial"] == DIAL
        assert body["unknown_reason"] is None
        assert body["can_edit"] is True
        assert instance.get.call_args.kwargs["params"] == {"domain": "fleet_resources"}

    @pytest.mark.parametrize(
        ("overrides", "reason_fragment"),
        [
            ({"controls_available": False}, "cannot read the fleet-resource controls"),
            ({"capacity_controls_available": False}, "did not project"),
            ({"capacity_model": None}, "could not resolve the dial"),
            ({"capacity_model": {"mode": "enforce"}}, "did not parse"),
        ],
    )
    def test_an_unread_dial_is_unknown_never_enforce(
        self, client: TestClient, overrides, reason_fragment
    ):
        payload = dict(COORD_CONTROLS_GET, **overrides)
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, payload))
        with _patched_httpx(instance), _patch_identity():
            resp = client.get(f"{API_PREFIX}/fleet/capacity-model")
        body = resp.json()
        assert body["dial"] is None
        assert reason_fragment in body["unknown_reason"]

    def test_a_coord_without_the_dial_is_unknown(self, client: TestClient):
        payload = {
            k: v for k, v in COORD_CONTROLS_GET.items() if not k.startswith("capacity_")
        }
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, payload))
        with _patched_httpx(instance), _patch_identity():
            body = client.get(f"{API_PREFIX}/fleet/capacity-model").json()
        assert body["dial"] is None
        assert "serves no capacity-model dial" in body["unknown_reason"]

    def test_can_edit_follows_the_effective_tenant_roles(self, client: TestClient):
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_CONTROLS_GET))
        with _patched_httpx(instance), _patch_identity(effective_roles=("developer",)):
            body = client.get(f"{API_PREFIX}/fleet/capacity-model").json()
        assert body["can_edit"] is False


class TestPutCapacityModel:
    def test_sends_only_the_dial_fields_and_reads_back(self, client: TestClient):
        instance = MagicMock()
        instance.put = AsyncMock(
            return_value=_mock_response(
                200, {"ok": True, "versioned": True, "version": 5}
            )
        )
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_CONTROLS_GET))
        with _patched_httpx(instance):
            resp = client.put(
                f"{API_PREFIX}/fleet/capacity-model",
                json={"mode": "off", "off_consumers": ["merge_train"]},
            )
        assert resp.status_code == 200
        sent = instance.put.call_args.kwargs["json"]
        assert sent["domain"] == "fleet_resources"
        assert sent["scope_band"] == "tenant"
        assert sent["level"] == "controls"
        # ONLY the two dial fields: coord merges per field, so an absent
        # control keeps its stored value.
        assert sent["controls"] == {
            "capacity_model_mode": "off",
            "capacity_model_off_consumers": ["merge_train"],
        }
        body = resp.json()
        assert body["version"] == 5
        assert body["effective"]["dial"] == DIAL
        assert body["readback_error"] is None

    def test_a_failed_read_back_is_unknown_not_the_written_value(
        self, client: TestClient
    ):
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        instance.get = AsyncMock(return_value=_mock_response(503, {"error": "x"}))
        with _patched_httpx(instance):
            body = client.put(
                f"{API_PREFIX}/fleet/capacity-model",
                json={"mode": "enforce", "off_consumers": []},
            ).json()
        assert body["effective"] is None
        assert "503" in body["readback_error"]

    def test_coords_typed_refusal_reaches_the_browser_structured(
        self, client: TestClient
    ):
        refusal = {
            "error": "unknown_capacity_model_consumer",
            "field": "capacity_model_off_consumers",
            "got": "nope",
        }
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(400, refusal))
        with _patched_httpx(instance):
            resp = client.put(
                f"{API_PREFIX}/fleet/capacity-model",
                json={"mode": "enforce", "off_consumers": ["nope"]},
            )
        assert resp.status_code == 400
        assert "unknown_capacity_model_consumer" in resp.text

    def test_refuses_an_unknown_key_and_an_unknown_mode_locally(
        self, client: TestClient
    ):
        for body in (
            {"mode": "enforce", "off_consumers": [], "updated_by": "x"},
            {"mode": "ENFORCE", "off_consumers": []},
        ):
            resp = client.put(f"{API_PREFIX}/fleet/capacity-model", json=body)
            assert resp.status_code == 422, body
