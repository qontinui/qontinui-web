"""Tests for the secrets-broker device door (`/api/v1/operations/secrets-broker/device`).

Phase 3 of ``2026-10-20-secrets-broker-agents-act-on-secrets-never-see-them``.
The device stored here AUTHORIZES broker reports into coord, so what this file
pins is mostly what must NOT happen silently:

1. **An absent ``secrets_broker_device_id`` key is UNKNOWN** (``reported:
   false``), not "no broker designated"; an explicit ``null`` is "none".
2. **A device is written only once coord PROVES it is bound to the tenant**:
   unknown device, a binding set without the tenant, and an UNHYDRATED binding
   set (``tenant_ids: null``) are each refused before any PUT reaches coord.
3. **The write touches the device and nothing else**: it goes to coord's
   device-only route ``PUT /coord/fleet-policy/secrets-broker-device`` with
   exactly ``{"device_id": <uuid | null>}``. No level, master flag or change
   note is read, carried or sent, so no system-band decision is copied onto
   the tenant row and there is no read-then-overwrite race. A coord without
   the route (404/405) is a 502 ``coord_secrets_broker_device_route_missing``,
   never "written".
4. **The body is closed**: an extra key is a 422, and ``device_id`` is required
   so an empty body cannot clear the designation.
5. **Coord's typed refusal passes through as structured detail**, and a failed
   read-back is UNKNOWN rather than "applied".

Mirrors ``test_operations_tenant_transcript_sync_proxy.py``: a minimal FastAPI
app plus a mocked ``httpx.AsyncClient``, so no live coord is needed.
"""

from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

API_PREFIX = "/api/v1/operations"
PATH = f"{API_PREFIX}/secrets-broker/device"

HOME_TENANT = uuid4()
TARGET_TENANT = uuid4()
OTHER_TENANT = uuid4()
BROKER_DEVICE = uuid4()


def _policy(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "domain": "secrets_broker",
        "effective_level": "on",
        "master_enabled": True,
        "resolved_scope": "tenant",
        "secrets_broker_device_id": str(BROKER_DEVICE),
        "controls": {},
    }
    body.update(overrides)
    return body


def _device_state(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "device_id": str(BROKER_DEVICE),
        "hostname": "spaceship",
        "tenant_id": str(TARGET_TENANT),
        "tenant_ids": [str(TARGET_TENANT)],
    }
    body.update(overrides)
    return body


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: HOME_TENANT
    test_app.dependency_overrides[require_coord_tenant_admin_target] = (
        lambda: TARGET_TENANT
    )
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data: Any = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    resp.content = b"{}" if json_data is not None else b""
    return resp


@contextmanager
def _patch_identity(effective_roles: tuple[str, ...] = ("admin",)):
    with (
        patch_ops("get_coord_identity", AsyncMock(return_value=MagicMock())),
        patch_ops(
            "_effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


@contextmanager
def _coord(
    *,
    policies: list[MagicMock] | None = None,
    device: MagicMock | None = None,
    put: MagicMock | None = None,
):
    """Route the mocked client's GETs by URL; policy GETs answer in order."""
    policy_answers = list(policies or [_mock_response(200, _policy())])
    instance = MagicMock()

    async def get(url: str, **_: Any) -> MagicMock:
        if "/coord/devices/" in url:
            assert device is not None, f"unexpected device read {url}"
            return device
        assert url.endswith("/coord/fleet-policy"), url
        return policy_answers.pop(0) if len(policy_answers) > 1 else policy_answers[0]

    instance.get = AsyncMock(side_effect=get)
    instance.put = AsyncMock(
        return_value=put
        or _mock_response(200, {"ok": True, "versioned": True, "version": 3})
    )
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        MockClient.return_value = instance
        yield instance


class TestGetBrokerDevice:
    def test_reads_the_secrets_broker_domain(self, client):
        with _coord() as coord, _patch_identity():
            body = client.get(PATH).json()

        kwargs = coord.get.call_args.kwargs
        assert kwargs["params"] == {"domain": "secrets_broker"}
        assert body == {
            "device_id": str(BROKER_DEVICE),
            "reported": True,
            "effective_level": "on",
            "master_enabled": True,
            "resolved_scope": "tenant",
            "can_edit": True,
        }

    def test_an_explicit_null_is_none_designated(self, client):
        answer = _mock_response(200, _policy(secrets_broker_device_id=None))
        with _coord(policies=[answer]), _patch_identity():
            body = client.get(PATH).json()

        assert body["device_id"] is None
        assert body["reported"] is True

    def test_a_coord_that_omits_the_key_reads_unknown(self, client):
        payload = _policy()
        del payload["secrets_broker_device_id"]
        with _coord(policies=[_mock_response(200, payload)]), _patch_identity():
            body = client.get(PATH).json()

        assert body["device_id"] is None
        assert body["reported"] is False

    def test_an_unparseable_device_reads_unknown(self, client):
        answer = _mock_response(200, _policy(secrets_broker_device_id="spaceship"))
        with _coord(policies=[answer]), _patch_identity():
            body = client.get(PATH).json()

        assert body["device_id"] is None
        assert body["reported"] is False

    def test_can_edit_follows_effective_tenant_roles(self, client):
        with _coord(), _patch_identity(effective_roles=("developer",)):
            body = client.get(PATH).json()

        assert body["can_edit"] is False


class TestPutBrokerDevice:
    def test_writes_only_the_device_to_coords_device_route(self, client):
        device = _mock_response(200, _device_state())
        with _coord(device=device) as coord, _patch_identity():
            resp = client.put(PATH, json={"device_id": str(BROKER_DEVICE)})

        assert resp.status_code == 200
        coord.put.assert_called_once()
        args, kwargs = coord.put.call_args
        assert args[0].endswith("/coord/fleet-policy/secrets-broker-device")
        assert kwargs["json"] == {"device_id": str(BROKER_DEVICE)}
        body = resp.json()
        assert body["ok"] is True
        assert body["written_device_id"] == str(BROKER_DEVICE)
        assert body["versioned"] is True
        assert body["version"] == 3
        assert body["effective"]["device_id"] == str(BROKER_DEVICE)
        assert body["readback_error"] is None

    def test_no_level_is_read_before_the_write(self, client):
        """No read-then-overwrite: the only fleet-policy GET is the read-back."""
        device = _mock_response(200, _device_state())
        with _coord(device=device) as coord, _patch_identity():
            client.put(PATH, json={"device_id": str(BROKER_DEVICE)})

        policy_reads = [
            c for c in coord.get.call_args_list if c.args[0].endswith("/fleet-policy")
        ]
        assert len(policy_reads) == 1
        sent = coord.put.call_args.kwargs["json"]
        for key in ("level", "master_enabled", "scope_band", "domain", "change_note"):
            assert key not in sent

    @pytest.mark.parametrize("status_code", [404, 405])
    def test_a_coord_without_the_route_is_an_error_not_written(
        self, client, status_code
    ):
        device = _mock_response(200, _device_state())
        missing = _mock_response(status_code, {"error": "NOT_FOUND"})
        with _coord(device=device, put=missing) as coord, _patch_identity():
            resp = client.put(PATH, json={"device_id": str(BROKER_DEVICE)})

        assert resp.status_code == 502
        assert (
            resp.json()["detail"]["code"] == "coord_secrets_broker_device_route_missing"
        )
        policy_reads = [
            c for c in coord.get.call_args_list if c.args[0].endswith("/fleet-policy")
        ]
        assert policy_reads == []

    def test_clearing_skips_the_binding_proof_and_sends_null(self, client):
        cleared = _mock_response(200, _policy(secrets_broker_device_id=None))
        with _coord(policies=[cleared]) as coord, _patch_identity():
            resp = client.put(PATH, json={"device_id": None})

        assert resp.status_code == 200
        assert coord.put.call_args.kwargs["json"] == {"device_id": None}
        urls = [c.args[0] for c in coord.get.call_args_list]
        assert not any("/coord/devices/" in u for u in urls)
        assert resp.json()["effective"]["device_id"] is None

    @pytest.mark.parametrize(
        ("device", "status_code", "code"),
        [
            (_mock_response(404, {"error": "no device"}), 422, "device_not_found"),
            (
                _mock_response(200, _device_state(tenant_ids=[str(OTHER_TENANT)])),
                422,
                "device_not_in_tenant",
            ),
            (
                _mock_response(200, _device_state(tenant_ids=[])),
                422,
                "device_not_in_tenant",
            ),
            (
                _mock_response(200, _device_state(tenant_ids=None)),
                503,
                "device_binding_unknown",
            ),
            (
                _mock_response(200, _device_state(device_id=str(uuid4()))),
                502,
                "coord_device_state_malformed",
            ),
        ],
    )
    def test_an_unproven_binding_writes_nothing(
        self, client, device, status_code, code
    ):
        with _coord(device=device) as coord, _patch_identity():
            resp = client.put(PATH, json={"device_id": str(BROKER_DEVICE)})

        assert resp.status_code == status_code
        assert resp.json()["detail"]["code"] == code
        coord.put.assert_not_called()

    def test_the_body_is_closed(self, client):
        with _coord() as coord, _patch_identity():
            extra = client.put(PATH, json={"device_id": None, "change_note": "x"})
            empty = client.put(PATH, json={})
            not_uuid = client.put(PATH, json={"device_id": "spaceship"})

        assert extra.status_code == 422
        assert empty.status_code == 422
        assert not_uuid.status_code == 422
        coord.put.assert_not_called()

    def test_coords_typed_refusal_passes_through_structured(self, client):
        refusal = _mock_response(503, {"error": "column_not_present"})
        device = _mock_response(200, _device_state())
        with _coord(device=device, put=refusal), _patch_identity():
            resp = client.put(PATH, json={"device_id": str(BROKER_DEVICE)})

        assert resp.status_code == 503
        assert resp.json()["detail"] == {"error": "column_not_present"}

    def test_a_failed_readback_is_unknown_not_applied(self, client):
        after = _mock_response(500, {"error": "boom"})
        device = _mock_response(200, _device_state())
        with _coord(policies=[after], device=device), _patch_identity():
            resp = client.put(PATH, json={"device_id": str(BROKER_DEVICE)})

        assert resp.status_code == 200
        body = resp.json()
        assert body["effective"] is None
        assert body["readback_error"] == "read-back failed: coord returned 500"
