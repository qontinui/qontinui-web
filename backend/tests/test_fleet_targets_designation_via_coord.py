"""Test-host designation writes go through coord's binding-checked routes.

Plan ``2026-09-30-test-host-designation-put-stamps-a-tenant-the-device-is-not-
bound-to``, Phase 1.

The web PUT used to write ``coord.test_targets`` itself, stamping whatever
tenant ``get_tenant_id`` returned with no ``coord.tenant_devices`` binding
check. The runner's ``by-device`` poll serves only rows whose tenant is one of
the device's bindings, so a designation stamped into an unbound project
silently vanished from the device's runner. These tests pin the one-writer
shape through the real router:

* the PUT / DELETE reach coord with the caller's bearer AND the
  ``X-Qontinui-Active-Tenant`` selection (``get_tenant_id`` is NOT overridden:
  its capture side effect is part of what is tested);
* coord's unbound refusal (``404 {"error": "device not found"}``, reached only
  after web's own ownership check passed) becomes a 409 naming the project;
* coord's ``200 {"deleted": false}`` is never reported as a removal on its own;
* web still refuses an unowned device or an unregistered app BEFORE any coord
  call — coord checks neither;
* web writes nothing to the session on any path.

Only ``get_coord_identity`` and ``httpx.AsyncClient`` are patched.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"
_HOME = UUID("11111111-1111-1111-1111-111111111111")
_SELECTED = UUID("22222222-2222-2222-2222-222222222222")
_OTHER = UUID("33333333-3333-3333-3333-333333333333")
_USER = UUID("44444444-4444-4444-4444-444444444444")
_STRANGER = UUID("55555555-5555-5555-5555-555555555555")
_DEVICE = UUID("66666666-6666-6666-6666-666666666666")
_APP = "qontinui-web"
_URL = f"/api/v1/fleet/test-targets/{_DEVICE}/{_APP}"
_NOW = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


def _identity(effective: UUID):
    """coord's ``/me`` answer: ``home_tenant_id`` is the POST-override tenant."""
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=UUID("99999999-9999-9999-9999-999999999999"),
        home_tenant_id=effective,
        email="operator@example.com",
        roles=("developer",),
        tenants=(
            CoordTenant(
                tenant_id=_HOME, slug="home", roles=("developer",), display_name="Home"
            ),
            CoordTenant(
                tenant_id=_SELECTED,
                slug="selected",
                roles=("developer",),
                display_name="Selected Project",
            ),
            CoordTenant(tenant_id=_OTHER, slug="other-proj", roles=("developer",)),
        ),
        is_admin=False,
    )


def _device(owner: UUID = _USER) -> SimpleNamespace:
    return SimpleNamespace(
        device_id=_DEVICE,
        user_id=owner,
        name="build-box",
        hostname="build-box.local",
        derived_status="online",
    )


def _row(tenant_id: UUID, auto_fresh: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        device_id=_DEVICE,
        app_id=_APP,
        tenant_id=tenant_id,
        auto_fresh=auto_fresh,
        created_at=_NOW,
        updated_at=_NOW,
    )


class _FakeSession:
    """Async session answering ``get`` by model; records every write attempt."""

    def __init__(
        self,
        *,
        device: SimpleNamespace | None,
        app_registered: bool = True,
        target: SimpleNamespace | None = None,
    ) -> None:
        self.device = device
        self.app_registered = app_registered
        self.target = target
        self.writes: list[str] = []

    async def get(self, model: Any, _pk: Any, **_kw: Any) -> Any:
        from app.models.app_deploy_state import AppDeployState
        from app.models.app_registry import App
        from app.models.device import Device
        from app.models.test_target import TestTarget

        if model is Device:
            return self.device
        if model is App:
            return SimpleNamespace(app_id=_APP) if self.app_registered else None
        if model is TestTarget:
            return self.target
        if model is AppDeployState:
            return None
        raise AssertionError(f"unexpected get({model!r})")

    def add(self, _obj: Any) -> None:
        self.writes.append("add")

    async def delete(self, _obj: Any) -> None:
        self.writes.append("delete")

    async def commit(self) -> None:
        self.writes.append("commit")

    async def refresh(self, _obj: Any) -> None:
        self.writes.append("refresh")


def _client(session: _FakeSession) -> TestClient:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.fleet_targets import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/fleet")
    app.dependency_overrides[get_async_db] = lambda: session
    app.dependency_overrides[get_current_active_user_async] = lambda: MagicMock(
        id=_USER
    )
    return TestClient(app)


def _coord_response(status: int, body: Any) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    if body is None:
        resp.json.side_effect = ValueError("no body")
        resp.text = ""
        resp.content = b""
    else:
        import json

        resp.json.return_value = body
        resp.text = json.dumps(body)
        resp.content = resp.text.encode()
    return resp


def _call(
    session: _FakeSession,
    method: str,
    *,
    effective: UUID,
    coord_status: int = 200,
    coord_body: Any = None,
    headers: dict[str, str] | None = None,
    json: Any = None,
) -> tuple[httpx.Response, AsyncMock, MagicMock]:
    """Drive one request; return (response, mocked httpx instance, ctor mock)."""
    from app.api.v1.endpoints import fleet_targets, operations

    instance = AsyncMock()
    instance.post.return_value = _coord_response(coord_status, coord_body)
    instance.delete.return_value = _coord_response(coord_status, coord_body)
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    identity = AsyncMock(return_value=_identity(effective))

    with (
        patch.object(operations, "get_coord_identity", new=identity),
        patch.object(fleet_targets, "get_coord_identity", new=identity),
        patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as ctor,
    ):
        ctor.return_value = instance
        response = _client(session).request(
            method,
            _URL,
            headers={"Authorization": "Bearer cognito-token", **(headers or {})},
            json=json,
        )
    return response, instance, ctor


# ---------------------------------------------------------------------------
# PUT
# ---------------------------------------------------------------------------


def test_put_bound_device_goes_through_coord_with_the_selection_forwarded():
    session = _FakeSession(device=_device(), target=_row(_SELECTED))
    response, instance, _ = _call(
        session,
        "PUT",
        effective=_SELECTED,
        coord_body={"device_id": str(_DEVICE), "app_id": _APP, "auto_fresh": True},
        headers={ACTIVE_TENANT_HEADER: str(_SELECTED)},
        json={"auto_fresh": True},
    )

    assert response.status_code == 200, response.text
    url = instance.post.call_args.args[0]
    assert url.endswith("/coord/trees/test-targets/upsert")
    assert instance.post.call_args.kwargs["json"] == {
        "device_id": str(_DEVICE),
        "app_id": _APP,
        "auto_fresh": True,
    }
    forwarded = instance.post.call_args.kwargs["headers"]
    assert forwarded[ACTIVE_TENANT_HEADER] == str(_SELECTED)
    assert forwarded["Authorization"] == "Bearer cognito-token"
    body = response.json()
    assert body["device_name"] == "build-box"
    assert body["auto_fresh"] is True
    # coord is the only writer: web touched nothing.
    assert session.writes == []


def test_put_unbound_device_is_a_409_naming_the_project_and_writes_nothing():
    session = _FakeSession(device=_device())
    response, instance, _ = _call(
        session,
        "PUT",
        effective=_SELECTED,
        coord_status=404,
        coord_body={"error": "device not found"},
        headers={ACTIVE_TENANT_HEADER: str(_SELECTED)},
        json={"auto_fresh": False},
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["error"] == "device_not_bound_to_project"
    assert detail["tenant_id"] == str(_SELECTED)
    assert '"Selected Project"' in detail["message"]
    assert "Bind the device" in detail["message"]
    assert instance.post.await_count == 1
    assert session.writes == []


def test_put_unbound_names_the_tenant_coord_used_not_the_raw_header():
    """A non-member selection degrades to home coord-side (never 403s), so the
    409 must name the tenant ``get_tenant_id`` returned, not the header."""
    session = _FakeSession(device=_device())
    response, _, _ = _call(
        session,
        "PUT",
        effective=_HOME,
        coord_status=404,
        coord_body={"error": "device not found"},
        headers={ACTIVE_TENANT_HEADER: "not-a-tenant-i-belong-to"},
        json={"auto_fresh": False},
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["tenant_id"] == str(_HOME)
    assert '"Home"' in detail["message"]


def test_put_other_coord_404_is_not_mistaken_for_unbound():
    """A 404 without coord's unbound body (e.g. a coord build without the
    route) is passed through, not relabelled as a binding problem."""
    session = _FakeSession(device=_device())
    response, _, _ = _call(
        session,
        "PUT",
        effective=_SELECTED,
        coord_status=404,
        coord_body=None,
        json={"auto_fresh": False},
    )

    assert response.status_code == 404, response.text
    assert session.writes == []


def test_put_coord_refusal_gets_a_readable_message():
    session = _FakeSession(device=_device())
    response, _, _ = _call(
        session,
        "PUT",
        effective=_SELECTED,
        coord_status=400,
        coord_body={"error": "app_id must be a slug"},
        json={"auto_fresh": False},
    )

    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert detail["error"] == "coord_refused"
    assert "app_id must be a slug" in detail["message"]


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
def test_unowned_device_is_refused_before_coord_is_called(method: str):
    session = _FakeSession(device=_device(owner=_STRANGER))
    response, _, ctor = _call(
        session,
        method,
        effective=_SELECTED,
        json={"auto_fresh": True} if method == "PUT" else None,
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"]["code"] == "device_not_found"
    ctor.assert_not_called()
    assert session.writes == []


def test_put_unregistered_app_is_refused_before_coord_is_called():
    session = _FakeSession(device=_device(), app_registered=False)
    response, _, ctor = _call(
        session, "PUT", effective=_SELECTED, json={"auto_fresh": True}
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"]["code"] == "app_not_found"
    ctor.assert_not_called()


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


def test_delete_goes_through_coord_with_the_selection_forwarded():
    session = _FakeSession(device=_device(), target=_row(_SELECTED))
    response, instance, _ = _call(
        session,
        "DELETE",
        effective=_SELECTED,
        coord_body={"deleted": True},
        headers={ACTIVE_TENANT_HEADER: str(_SELECTED)},
    )

    assert response.status_code == 204, response.text
    url = instance.delete.call_args.args[0]
    assert url.endswith(f"/coord/trees/test-targets/{_DEVICE}/{_APP}")
    forwarded = instance.delete.call_args.kwargs["headers"]
    assert forwarded[ACTIVE_TENANT_HEADER] == str(_SELECTED)
    assert forwarded["Authorization"] == "Bearer cognito-token"
    assert session.writes == []


def test_delete_not_deleted_while_row_lives_in_another_project_is_a_409():
    """coord's DELETE is tenant-scoped: ``deleted: false`` for a row stamped in
    another tenant removed NOTHING. Reporting 204 would leave the runner
    serving a designation the operator believes is gone."""
    session = _FakeSession(device=_device(), target=_row(_OTHER))
    response, _, _ = _call(
        session,
        "DELETE",
        effective=_SELECTED,
        coord_body={"deleted": False},
        headers={ACTIVE_TENANT_HEADER: str(_SELECTED)},
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["error"] == "designation_in_other_project"
    assert detail["row_tenant_id"] == str(_OTHER)
    assert '"other-proj"' in detail["message"]
    assert '"Selected Project"' in detail["message"]
    assert session.writes == []


def test_delete_not_deleted_while_row_still_in_selected_project_is_a_409():
    session = _FakeSession(device=_device(), target=_row(_SELECTED))
    response, _, _ = _call(
        session, "DELETE", effective=_SELECTED, coord_body={"deleted": False}
    )

    assert response.status_code == 409, response.text
    assert "removed nothing" in response.json()["detail"]["message"]


def test_delete_not_deleted_and_verifiably_absent_is_a_204():
    """Nothing to remove, and the read confirms it: the state the operator
    asked for holds, so the old idempotent 204 stands."""
    session = _FakeSession(device=_device(), target=None)
    response, _, _ = _call(
        session, "DELETE", effective=_SELECTED, coord_body={"deleted": False}
    )

    assert response.status_code == 204, response.text


def test_unbound_refusal_wire_shape_under_the_real_error_envelope():
    """The dashboard reads ``message`` off the production envelope
    (``http_exception_handler`` splices a dict detail carrying ``error`` into
    the top level). Pin that the 409 arrives there as readable prose."""
    from fastapi.exceptions import HTTPException as FastAPIHTTPException

    from app.api.v1.endpoints import fleet_targets, operations
    from app.middleware.error_handler import http_exception_handler

    session = _FakeSession(device=_device())
    instance = AsyncMock()
    instance.post.return_value = _coord_response(404, {"error": "device not found"})
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    identity = AsyncMock(return_value=_identity(_SELECTED))

    client = _client(session)
    client.app.add_exception_handler(FastAPIHTTPException, http_exception_handler)  # type: ignore[attr-defined]
    with (
        patch.object(operations, "get_coord_identity", new=identity),
        patch.object(fleet_targets, "get_coord_identity", new=identity),
        patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as ctor,
    ):
        ctor.return_value = instance
        response = client.put(
            _URL,
            headers={"Authorization": "Bearer cognito-token"},
            json={"auto_fresh": False},
        )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error"] == "device_not_bound_to_project"
    assert body["message"].startswith("Device 'build-box' is not bound to project")
