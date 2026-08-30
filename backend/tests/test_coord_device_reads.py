"""Phase 3 — web→coord device-read boundary tests.

Covers the new ``app.services.coord_device`` HTTP client + the migrated
``devices.py`` read endpoints (list / get / dispatch) that now source their
data over coord's HTTP API instead of reading ``coord.devices`` directly.
All coord GETs are mocked at the httpx layer; no live coord / DB is needed.

Plan: ``2026-05-30-web-coord-schema-boundary-decoupling.md`` Phase 3.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from qontinui_schemas.common import utc_now

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
async def test_coord_503_maps_502_upstream_error(monkeypatch):
    """W-C: a coord 5xx must NOT pass through as a 503.

    503 out of the device-bridge relay means exactly one thing —
    ``coord.devices.ws_session_id IS NULL``. Letting coord's own 503 through
    verbatim made a coord outage indistinguishable from a disconnected
    runner, both to the mobile client and in the logs.
    """
    from fastapi import HTTPException

    _patch_httpx(
        monkeypatch, lambda url, hdr: httpx.Response(503, text="coord is on fire")
    )
    with pytest.raises(HTTPException) as exc:
        await coord_device.get_device_routing(DEVICE_ID, bearer="tok", user_id=USER_ID)
    assert exc.value.status_code == 502
    assert exc.value.detail == "upstream_error"


@pytest.mark.asyncio
async def test_coord_500_maps_502_upstream_error(monkeypatch):
    from fastapi import HTTPException

    _patch_httpx(monkeypatch, lambda url, hdr: httpx.Response(500, text="PG: boom"))
    with pytest.raises(HTTPException) as exc:
        await coord_device.get_owned_device(_FakeRequest(), DEVICE_ID, USER_ID)
    assert exc.value.status_code == 502
    assert exc.value.detail == "upstream_error"


@pytest.mark.asyncio
async def test_coord_4xx_still_passes_through_verbatim(monkeypatch):
    """The 5xx translation must not swallow coord's 4xx signals."""
    from fastapi import HTTPException

    _patch_httpx(monkeypatch, lambda url, hdr: httpx.Response(400, text="bad header"))
    with pytest.raises(HTTPException) as exc:
        await coord_device.get_owned_device(_FakeRequest(), DEVICE_ID, USER_ID)
    assert exc.value.status_code == 400
    assert exc.value.detail == "bad header"


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


# ---- heartbeat staleness gate ----------------------------------------------
#
# The stored ``derived_status`` column is write-once-per-event; nothing decays
# it when a device dies without a clean disconnect. A liveness claim
# (healthy/degraded/starting) must be backed by a fresh heartbeat — observed
# live 2026-06-06: a device with a 6-day-stale heartbeat and wsConnected:false
# still reported derivedStatus:"healthy".


def _fresh_iso() -> str:
    return (utc_now() - timedelta(seconds=10)).isoformat()


def test_derive_status_from_row_stale_healthy_reports_offline():
    # default _coord_row heartbeat is a fixed past date — always stale.
    wire = devices_ep._device_row_to_wire(_coord_row(derived_status="healthy"))
    assert wire.derivedStatus.value == "offline"


@pytest.mark.parametrize("claim", ["degraded", "starting"])
def test_derive_status_from_row_stale_liveness_claims_report_offline(claim):
    wire = devices_ep._device_row_to_wire(_coord_row(derived_status=claim))
    assert wire.derivedStatus.value == "offline"


# ---- relay-unroutable gate -------------------------------------------------
#
# A fresh heartbeat beside a NULL ``ws_session_id`` is self-contradictory:
# every heartbeat arrives over the device WebSocket, so a 30s-old heartbeat
# proves a socket was live — while ``_runner_proxy_relay`` gates the mobile
# cloud relay on ``ws_session_id IS NOT NULL`` and 503s "runner not connected".
# Reporting that row ``healthy`` hid a ~2h prod relay outage from operators on
# 2026-08-27 (``derivedStatus: healthy`` served beside ``wsConnected: false``),
# so the contradiction now reports ``degraded``.


def test_derive_status_from_row_fresh_healthy_without_ws_is_relay_unroutable():
    """The contradiction must not be reported as ``healthy``.

    This used to assert ``healthy`` — that assertion WAS the blind spot.
    """
    wire = devices_ep._device_row_to_wire(
        _coord_row(derived_status="healthy", last_heartbeat=_fresh_iso())
    )
    assert wire.wsConnected is False
    assert wire.derivedStatus.value == "degraded"


def test_derive_status_from_row_fresh_healthy_with_ws_stays_healthy():
    """The gate must not demote a device that IS routable."""
    wire = devices_ep._device_row_to_wire(
        _coord_row(
            derived_status="healthy", last_heartbeat=_fresh_iso(), ws_session_id=42
        )
    )
    assert wire.wsConnected is True
    assert wire.derivedStatus.value == "healthy"


@pytest.mark.parametrize("claim", ["degraded", "starting"])
def test_derive_status_from_row_only_healthy_is_demoted(claim):
    """``degraded`` already reads honestly and ``starting`` legitimately has no
    WS pointer yet — demoting either would erase information, not add it."""
    wire = devices_ep._device_row_to_wire(
        _coord_row(derived_status=claim, last_heartbeat=_fresh_iso())
    )
    assert wire.derivedStatus.value == claim


def test_derive_status_from_row_ws_presence_beats_stale_heartbeat():
    # A live WS session is definitive; the connection-cleanup sweep owns
    # clearing stale sessions — the staleness gate must not second-guess it.
    wire = devices_ep._device_row_to_wire(
        _coord_row(derived_status="healthy", ws_session_id=7)
    )
    assert wire.derivedStatus.value == "healthy"


def test_derive_status_from_row_missing_heartbeat_is_stale():
    wire = devices_ep._device_row_to_wire(
        _coord_row(derived_status="healthy", last_heartbeat=None)
    )
    assert wire.derivedStatus.value == "offline"


def test_derive_status_from_row_unparseable_heartbeat_fails_open():
    # Format drift must NOT flip the whole fleet offline. An unparseable
    # timestamp is treated as fresh, so this row lands in the
    # relay-unroutable gate above (fresh claim, no ws_session_id) and reports
    # ``degraded`` — still emphatically not ``offline``, which is what
    # "fails open" is protecting against.
    wire = devices_ep._device_row_to_wire(
        _coord_row(derived_status="healthy", last_heartbeat="not-a-date")
    )
    assert wire.derivedStatus.value != "offline"
    assert wire.derivedStatus.value == "degraded"


def test_derive_status_from_row_stale_errored_stays_errored():
    # ``errored`` is sticky diagnostic state, not a liveness claim.
    wire = devices_ep._device_row_to_wire(_coord_row(derived_status="errored"))
    assert wire.derivedStatus.value == "errored"


def test_derive_status_orm_twin_staleness_gate():
    stale = SimpleNamespace(
        ws_session_id=None,
        ui_error=None,
        derived_status="healthy",
        last_heartbeat=utc_now() - timedelta(days=6),
    )
    assert devices_ep._derive_status(stale).value == "offline"

    # Fresh, but with no WS presence pointer — the relay-unroutable
    # contradiction, so ``degraded`` rather than ``offline`` (it is NOT stale)
    # and rather than ``healthy`` (it is NOT reachable by the cloud relay).
    fresh = SimpleNamespace(
        ws_session_id=None,
        ui_error=None,
        derived_status="healthy",
        last_heartbeat=utc_now() - timedelta(seconds=10),
    )
    assert devices_ep._derive_status(fresh).value == "degraded"

    # Naive datetimes (no tzinfo) are interpreted as UTC, not rejected — the
    # point of this case is that it clears the STALENESS gate.
    naive_fresh = SimpleNamespace(
        ws_session_id=None,
        ui_error=None,
        derived_status="healthy",
        last_heartbeat=(utc_now() - timedelta(seconds=10)).replace(tzinfo=None),
    )
    assert devices_ep._derive_status(naive_fresh).value == "degraded"

    # ...and the same row WITH a live WS session is still healthy, which is
    # what proves the naive timestamp was accepted rather than rejected.
    naive_fresh_ws = SimpleNamespace(
        ws_session_id=1234,
        ui_error=None,
        derived_status="healthy",
        last_heartbeat=(utc_now() - timedelta(seconds=10)).replace(tzinfo=None),
    )
    assert devices_ep._derive_status(naive_fresh_ws).value == "healthy"


def test_derive_status_orm_twin_relay_unroutable_matches_row_twin():
    """The ORM and dict twins must not disagree about one device.

    ``GET /api/v1/devices`` can be served from either, so an operator
    comparing the two views of the same device would otherwise see one call it
    healthy and the other call it degraded.
    """
    fresh_iso = _fresh_iso()
    orm = SimpleNamespace(
        ws_session_id=None,
        ui_error=None,
        derived_status="healthy",
        last_heartbeat=datetime.fromisoformat(fresh_iso),
    )
    row_status = devices_ep._derive_status_from_row(
        {
            "ws_session_id": None,
            "ui_error": None,
            "derived_status": "healthy",
            "last_heartbeat": fresh_iso,
        }
    )
    assert devices_ep._derive_status(orm) == row_status == "degraded"


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
