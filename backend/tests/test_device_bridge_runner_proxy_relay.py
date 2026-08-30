"""Tests for the remote-runner relay path of the device-bridge runner proxy.

Phase 1 of ``plans/2026-05-25-mobile-backend-remote-runner-relay.md`` adds a
relay mode to :func:`app.api.v1.endpoints.device_bridge_ws.runner_proxy`:
when the ``X-Qontinui-Device-Id`` header is present the request is relayed
HTTP-over-WebSocket through the runner's outbound ``/devices/ws`` connection
(via :meth:`CommandRelayService.dispatch_and_wait`) instead of the co-located
``127.0.0.1`` httpx path.

These tests mock the runner-websocket manager + its ``.relay`` so
``dispatch_and_wait`` returns a canned ``command_response``, and the device
lookup so ownership/connection state is controllable. They assert:

* the ``http_request`` envelope shape (top-level ``type``, method, path,
  query, base64 body) and that the ``authorization`` header is never
  forwarded;
* the response translation (status, decoded body, hop-by-hop header
  filtering);
* error mapping (504 on ``RunnerCommandTimeoutError``). NOTE: the relay's
  ONLY 503 is the ``ws_session_id IS NULL`` branch below. A former test here
  forced ``dispatch_and_wait`` to raise ``RunnerNotConnectedError`` and
  asserted a 503 — an outcome unreachable in production, because the dispatch
  passes ``require_local_connection=False`` and that is the flag the raise is
  gated on. Both the dead handler arm and that test are deleted (W3 of
  ``plans/2026-08-27-mobile-cloud-relay-unreachable-remediation.md``);
* the 413 oversize-body guard;
* the 404 when the device is not owned by the caller.
"""

from __future__ import annotations

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints import device_bridge_ws
from app.services.runner import RunnerCommandTimeoutError

DEVICE_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"


class _FakeURL:
    def __init__(self, query: str) -> None:
        self.query = query


class _FakeRequest:
    """Minimal Starlette-Request stand-in for the relay handler."""

    def __init__(
        self,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        query: str = "",
        body: bytes = b"",
    ) -> None:
        self.method = method
        self.headers = headers or {}
        self.cookies: dict[str, str] = {}
        self.url = _FakeURL(query)
        self._body = body

    async def body(self) -> bytes:
        return self._body


def _install_device_lookup(monkeypatch, row) -> None:
    """Patch the coord device-routing client so the relay lookup returns ``row``.

    Phase 3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md``: the
    relay's ownership/ws-session lookup moved off the direct ``coord.devices``
    SQL read onto coord's ``GET /coord/devices/:id/routing`` (the
    :func:`app.services.coord_device.get_device_routing` client). ``row`` is
    the JSON-dict shape coord returns (``{"device_id", "ws_session_id"}``) or
    ``None`` for an unowned device.
    """

    async def _fake_get_device_routing(device_id, *, bearer, user_id):
        return row

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_device_routing",
        _fake_get_device_routing,
        raising=True,
    )


def _install_manager(monkeypatch, *, dispatch) -> MagicMock:
    """Patch get_runner_websocket_manager + get_redis; return the relay mock.

    ``dispatch`` is the AsyncMock used for ``manager.relay.dispatch_and_wait``.
    """
    relay = MagicMock()
    relay.dispatch_and_wait = dispatch
    manager = SimpleNamespace(relay=relay)

    import app.services.runner_websocket_manager as mgr_mod

    monkeypatch.setattr(
        device_bridge_ws,
        "get_redis",
        AsyncMock(return_value=MagicMock()),
        raising=True,
    )
    monkeypatch.setattr(
        mgr_mod,
        "get_runner_websocket_manager",
        AsyncMock(return_value=manager),
        raising=True,
    )
    return relay


@pytest.mark.asyncio
async def test_relay_builds_http_request_envelope_and_translates_response(
    monkeypatch,
):
    """Happy path: envelope shape + response translation + header filtering."""
    _install_device_lookup(
        monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": 12345}
    )

    resp_body = b'{"ok":true}'
    dispatch = AsyncMock(
        return_value={
            "type": "command_response",
            "request_id": "ignored-by-caller",
            "status": 201,
            "headers": {
                "content-type": "application/json",
                # hop-by-hop headers must be stripped from the response
                "transfer-encoding": "chunked",
                "connection": "keep-alive",
                "content-length": "999",
            },
            "body_b64": base64.b64encode(resp_body).decode("ascii"),
        }
    )
    _install_manager(monkeypatch, dispatch=dispatch)

    req_body = b'{"q":"value"}'
    request = _FakeRequest(
        method="POST",
        headers={
            "X-Qontinui-Device-Id": DEVICE_ID,
            "content-type": "application/json",
            "authorization": "Bearer super-secret-user-token",
            "host": "demo.example",
            "content-length": str(len(req_body)),
        },
        query="foo=bar&baz=1",
        body=req_body,
    )

    response = await device_bridge_ws.runner_proxy(
        request, "ui-bridge/state", user=SimpleNamespace(id=USER_ID)
    )

    # (a) envelope shape passed to dispatch_and_wait
    assert dispatch.await_count == 1
    call = dispatch.await_args
    sent_device_id = call.args[0]
    envelope = call.args[1]
    assert sent_device_id == DEVICE_ID
    assert call.kwargs["require_local_connection"] is False
    assert "request_id" in call.kwargs and call.kwargs["request_id"]

    assert envelope["type"] == "http_request"  # top-level, NOT wrapped
    assert envelope["method"] == "POST"
    assert envelope["path"] == "ui-bridge/state"
    assert envelope["query"] == "foo=bar&baz=1"
    assert base64.b64decode(envelope["body_b64"]) == req_body
    # authorization must NEVER be forwarded to the runner
    assert "authorization" not in envelope["headers"]
    assert "host" not in envelope["headers"]
    assert "content-length" not in envelope["headers"]
    assert envelope["headers"]["content-type"] == "application/json"

    # (b) response translation
    assert response.status_code == 201
    assert response.body == resp_body
    # hop-by-hop response headers stripped
    hdr_keys = {k.lower() for k in response.headers.keys()}
    assert "transfer-encoding" not in hdr_keys
    assert "connection" not in hdr_keys
    assert response.headers["content-type"] == "application/json"


@pytest.mark.asyncio
async def test_relay_empty_body_envelope(monkeypatch):
    """A bodyless GET produces an empty body_b64 string."""
    _install_device_lookup(
        monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": 12345}
    )
    dispatch = AsyncMock(
        return_value={
            "type": "command_response",
            "status": 200,
            "headers": {},
            "body_b64": "",
        }
    )
    _install_manager(monkeypatch, dispatch=dispatch)

    request = _FakeRequest(
        headers={"X-Qontinui-Device-Id": DEVICE_ID},
    )
    response = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )

    envelope = dispatch.await_args.args[1]
    assert envelope["body_b64"] == ""
    assert envelope["query"] == ""
    assert response.status_code == 200
    assert response.body == b""


@pytest.mark.asyncio
async def test_relay_timeout_maps_504(monkeypatch):
    _install_device_lookup(
        monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": 12345}
    )
    dispatch = AsyncMock(
        side_effect=RunnerCommandTimeoutError(DEVICE_ID, "req-1", 30.0)
    )
    _install_manager(monkeypatch, dispatch=dispatch)

    request = _FakeRequest(headers={"X-Qontinui-Device-Id": DEVICE_ID})
    response = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )
    assert response.status_code == 504


@pytest.mark.asyncio
async def test_relay_oversize_request_body_maps_413(monkeypatch):
    _install_device_lookup(
        monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": 12345}
    )
    dispatch = AsyncMock()
    _install_manager(monkeypatch, dispatch=dispatch)

    big = b"x" * (device_bridge_ws.RELAY_MAX_BODY_BYTES + 1)
    request = _FakeRequest(
        method="POST",
        headers={"X-Qontinui-Device-Id": DEVICE_ID},
        body=big,
    )
    response = await device_bridge_ws.runner_proxy(
        request, "upload", user=SimpleNamespace(id=USER_ID)
    )
    assert response.status_code == 413
    # dispatch must NOT have been called — we reject before relaying
    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_relay_device_not_owned_maps_404(monkeypatch):
    # No row returned -> device not found / not owned by caller.
    _install_device_lookup(monkeypatch, None)
    dispatch = AsyncMock()
    _install_manager(monkeypatch, dispatch=dispatch)

    request = _FakeRequest(headers={"X-Qontinui-Device-Id": DEVICE_ID})
    response = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )
    assert response.status_code == 404
    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_relay_runner_not_connected_when_ws_session_null_maps_503(monkeypatch):
    # Row exists but ws_session_id IS NULL -> 503 before dispatch.
    _install_device_lookup(monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": None})
    # The 503 branch decorates its body with ``last_seen_at`` from a second
    # coord read; stub it so this test attempts no network.
    _install_owned_device(monkeypatch, {"device_id": DEVICE_ID, "last_seen_at": None})
    dispatch = AsyncMock()
    _install_manager(monkeypatch, dispatch=dispatch)

    request = _FakeRequest(headers={"X-Qontinui-Device-Id": DEVICE_ID})
    response = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )
    assert response.status_code == 503
    dispatch.assert_not_awaited()


def _install_owned_device(monkeypatch, row, *, raises: Exception | None = None) -> None:
    """Patch the full-row coord read the 503 branch uses for ``last_seen_at``."""

    async def _fake_get_owned_device(request, device_id, user_id):
        if raises is not None:
            raise raises
        return row

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_owned_device",
        _fake_get_owned_device,
        raising=True,
    )


def _body(response) -> dict:
    import json

    return json.loads(bytes(response.body).decode())


class _RecordingLogger:
    """Capture structlog-style calls without depending on the app's logging
    configuration (structlog is not wired to stdlib ``logging`` under pytest,
    so ``caplog`` would silently see nothing)."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    def _record(self, level):
        def _call(event, **kw):
            self.calls.append((level, event, kw))

        return _call

    def __getattr__(self, level):
        return self._record(level)

    def events(self) -> list[str]:
        return [event for _lvl, event, _kw in self.calls]

    def kw_for(self, event: str) -> dict:
        for _lvl, ev, kw in self.calls:
            if ev == event:
                return kw
        raise AssertionError(f"no {event!r} log line; saw {self.events()}")


@pytest.mark.asyncio
async def test_relay_not_connected_503_body_carries_device_id_and_last_seen(
    monkeypatch,
):
    """W-A + W-B: the not-connected 503 is observable and self-describing.

    W-A — a structured ``runner_proxy_relay_not_connected`` line naming the
    device. W-B — ``device_id`` + ``last_seen_at`` in the body so the client
    can render "last seen N min ago" instead of a bare failure string.
    ``detail`` is unchanged, so an older mobile build is unaffected.
    """
    _install_device_lookup(monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": None})
    _install_owned_device(
        monkeypatch,
        {"device_id": DEVICE_ID, "last_seen_at": "2026-08-27T09:15:00+00:00"},
    )
    _install_manager(monkeypatch, dispatch=AsyncMock())
    rec = _RecordingLogger()
    monkeypatch.setattr(device_bridge_ws, "logger", rec, raising=True)

    request = _FakeRequest(headers={"X-Qontinui-Device-Id": DEVICE_ID})
    response = await device_bridge_ws.runner_proxy(
        request, "usage", user=SimpleNamespace(id=USER_ID)
    )

    assert response.status_code == 503
    body = _body(response)
    # Additive only — the pre-existing key keeps its exact value.
    assert body["detail"] == "runner not connected"
    assert body["device_id"] == DEVICE_ID
    assert body["last_seen_at"] == "2026-08-27T09:15:00+00:00"
    assert isinstance(body["request_id"], str) and body["request_id"]

    # W-A: the branch is no longer silent, and the line carries the fields a
    # server-side debugger needs to find the device without the client.
    logged = rec.kw_for("runner_proxy_relay_not_connected")
    assert logged["device_id"] == DEVICE_ID
    assert logged["user_id"] == USER_ID
    assert logged["path"] == "usage"
    assert logged["last_seen_at"] == "2026-08-27T09:15:00+00:00"
    # The body's request_id is greppable in the log.
    assert logged["request_id"] == body["request_id"]


@pytest.mark.asyncio
async def test_relay_not_connected_503_survives_last_seen_lookup_failure(monkeypatch):
    """A coord fault while decorating the 503 must not change the status.

    The 503 is already the right answer; the timestamp is a nicety, so a
    failed full-row read yields ``last_seen_at: null``, never a 502/504.
    """
    from fastapi import HTTPException

    _install_device_lookup(monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": None})
    _install_owned_device(
        monkeypatch, None, raises=HTTPException(status_code=502, detail="down")
    )
    _install_manager(monkeypatch, dispatch=AsyncMock())

    request = _FakeRequest(headers={"X-Qontinui-Device-Id": DEVICE_ID})
    response = await device_bridge_ws.runner_proxy(
        request, "usage", user=SimpleNamespace(id=USER_ID)
    )

    assert response.status_code == 503
    body = _body(response)
    assert body["detail"] == "runner not connected"
    assert body["device_id"] == DEVICE_ID
    assert body["last_seen_at"] is None


@pytest.mark.asyncio
async def test_relay_malformed_device_id_maps_400(monkeypatch):
    dispatch = AsyncMock()
    _install_manager(monkeypatch, dispatch=dispatch)

    request = _FakeRequest(headers={"X-Qontinui-Device-Id": "not-a-uuid"})
    response = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )
    assert response.status_code == 400
    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_relay_timeout_header_clamped(monkeypatch):
    """X-Qontinui-Timeout-Ms is parsed + clamped and converted to seconds."""
    _install_device_lookup(
        monkeypatch, {"device_id": DEVICE_ID, "ws_session_id": 12345}
    )
    dispatch = AsyncMock(return_value={"status": 200, "headers": {}, "body_b64": ""})
    _install_manager(monkeypatch, dispatch=dispatch)

    # Above the 120000 ms cap -> clamps to 120.0 s.
    request = _FakeRequest(
        headers={
            "X-Qontinui-Device-Id": DEVICE_ID,
            "X-Qontinui-Timeout-Ms": "999999",
        }
    )
    await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )
    assert dispatch.await_args.kwargs["timeout_s"] == pytest.approx(120.0)
