"""Phase 3 — web→coord device-read boundary tests.

Covers the new ``app.services.coord_device`` HTTP client + the migrated
``devices.py`` read endpoints (list / get / dispatch) that now source their
data over coord's HTTP API instead of reading ``coord.devices`` directly.
All coord GETs are mocked at the httpx layer; no live coord / DB is needed.

Plan: ``2026-05-30-web-coord-schema-boundary-decoupling.md`` Phase 3.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.api.v1.endpoints import devices as devices_ep
from app.services import coord_device

USER_ID = "33333333-3333-3333-3333-333333333333"
DEVICE_ID = "44444444-4444-4444-4444-444444444444"


def _coord_row(**overrides: Any) -> dict[str, Any]:
    """A full-ish ``coord.devices`` JSON row (coord ``to_jsonb`` shape)."""
    row: dict[str, Any] = {
        "device_id": DEVICE_ID,
        "user_id": USER_ID,
        "name": "spaceship",
        "hostname": "spaceship.local",
        "port": 9876,
        "os": "windows",
        "os_version": "11",
        "capabilities": ["ui_bridge"],
        "derived_status": "offline",
        "ui_error": None,
        "recent_crash": None,
        "ws_session_id": None,
        "last_heartbeat": "2026-05-30T12:00:00+00:00",
        "created_at": "2026-05-29T08:00:00+00:00",
    }
    row.update(overrides)
    return row


class _FakeRequest:
    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.headers = headers or {}
        self.cookies: dict[str, str] = {}


def _patch_httpx(monkeypatch, handler) -> dict[str, Any]:
    """Patch ``httpx.AsyncClient.get`` with ``handler(url, headers)``.

    Returns a dict the handler populates with the last-seen url + headers so
    tests can assert the bearer + ``x-qontinui-user-id`` forwarding.
    """
    seen: dict[str, Any] = {}

    async def _get(self, url, params=None, headers=None):  # noqa: ANN001
        seen["url"] = url
        seen["headers"] = headers or {}
        return handler(url, headers or {})

    monkeypatch.setattr(httpx.AsyncClient, "get", _get, raising=True)
    return seen


# ---- coord_device service -------------------------------------------------


@pytest.mark.asyncio
async def test_get_active_routing_port_returns_port(monkeypatch):
    seen = _patch_httpx(
        monkeypatch,
        lambda url, hdr: httpx.Response(200, json={"port": 9881}),
    )
    port = await coord_device.get_active_routing_port(bearer="tok", user_id=USER_ID)
    assert port == 9881
    assert seen["url"].endswith("/coord/devices/routing/active")
    assert seen["headers"]["x-qontinui-user-id"] == USER_ID
    assert seen["headers"]["Authorization"] == "Bearer tok"


@pytest.mark.asyncio
async def test_get_active_routing_port_null_is_none(monkeypatch):
    _patch_httpx(monkeypatch, lambda url, hdr: httpx.Response(200, json={"port": None}))
    assert (
        await coord_device.get_active_routing_port(bearer=None, user_id=USER_ID) is None
    )


@pytest.mark.asyncio
async def test_get_device_routing_owned(monkeypatch):
    _patch_httpx(
        monkeypatch,
        lambda url, hdr: httpx.Response(
            200, json={"device_id": DEVICE_ID, "ws_session_id": 7}
        ),
    )
    row = await coord_device.get_device_routing(
        DEVICE_ID, bearer="tok", user_id=USER_ID
    )
    assert row == {"device_id": DEVICE_ID, "ws_session_id": 7}


@pytest.mark.asyncio
async def test_get_device_routing_404_is_none(monkeypatch):
    _patch_httpx(monkeypatch, lambda url, hdr: httpx.Response(404, text="nope"))
    row = await coord_device.get_device_routing(
        DEVICE_ID, bearer="tok", user_id=USER_ID
    )
    assert row is None


@pytest.mark.asyncio
async def test_get_owned_device_404_raises(monkeypatch):
    from fastapi import HTTPException

    _patch_httpx(monkeypatch, lambda url, hdr: httpx.Response(404, text="nope"))
    with pytest.raises(HTTPException) as exc:
        await coord_device.get_owned_device(_FakeRequest(), DEVICE_ID, USER_ID)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_connect_error_maps_502(monkeypatch):
    from fastapi import HTTPException

    async def _get(self, url, params=None, headers=None):  # noqa: ANN001
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx.AsyncClient, "get", _get, raising=True)
    with pytest.raises(HTTPException) as exc:
        await coord_device.get_active_routing_port(bearer="t", user_id=USER_ID)
    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_list_devices_for_user_unwraps_envelope(monkeypatch):
    _patch_httpx(
        monkeypatch,
        lambda url, hdr: httpx.Response(
            200, json={"devices": [_coord_row(), _coord_row()], "count": 2}
        ),
    )
    rows = await coord_device.list_devices_for_user(_FakeRequest(), USER_ID)
    assert len(rows) == 2


# ---- devices.py dict-mapper ----------------------------------------------


def test_device_row_to_wire_maps_fields():
    wire = devices_ep._device_row_to_wire(_coord_row())
    assert wire.id == DEVICE_ID
    assert wire.userId == USER_ID
    assert wire.name == "spaceship"
    assert wire.port == 9876
    assert wire.wsConnected is False
    assert wire.derivedStatus.value == "offline"
    assert wire.lastHeartbeat == "2026-05-30T12:00:00+00:00"
    assert wire.createdAt == "2026-05-29T08:00:00+00:00"


def test_derive_status_from_row_ws_session_wins():
    wire = devices_ep._device_row_to_wire(
        _coord_row(ws_session_id=99, derived_status="offline")
    )
    assert wire.derivedStatus.value == "healthy"
    assert wire.wsConnected is True


def test_derive_status_from_row_ui_error_errored():
    row = _coord_row(ui_error={"kind": "boom", "message": "x"})
    wire = devices_ep._device_row_to_wire(row)
    assert wire.derivedStatus.value == "errored"


# ---- migrated endpoints ---------------------------------------------------


@pytest.mark.asyncio
async def test_list_devices_endpoint_status_filter(monkeypatch):
    rows = [
        _coord_row(device_id="d-healthy", ws_session_id=1),
        _coord_row(device_id="d-offline"),
    ]

    async def _fake_list(request, user_id):
        return rows

    monkeypatch.setattr(coord_device, "list_devices_for_user", _fake_list)

    wire = await devices_ep.list_devices_endpoint(
        request=_FakeRequest(),
        current_user=SimpleNamespace(id=USER_ID),
        status_filter="healthy",
    )
    assert len(wire) == 1
    assert wire[0].id == "d-healthy"


@pytest.mark.asyncio
async def test_get_device_endpoint_maps_owned_row(monkeypatch):
    async def _fake_owned(request, device_id, user_id):
        assert str(device_id) == DEVICE_ID
        assert user_id == USER_ID
        return _coord_row()

    monkeypatch.setattr(coord_device, "get_owned_device", _fake_owned)

    wire = await devices_ep.get_device_endpoint(
        request=_FakeRequest(),
        current_user=SimpleNamespace(id=USER_ID),
        device_id=DEVICE_ID,
    )
    assert wire.id == DEVICE_ID
