"""The runner-proxy never forwards the end user's browser provenance headers.

Plan ``2026-09-17-runner-loopback-api-accepts-any-origin`` (F4, Design step 4)
adds an origin guard to the runner's loopback API that classifies a request by
its ``Origin`` and ``Sec-Fetch-Site`` headers: absent both, it is a NonBrowser
caller and keeps full local trust; with a browser origin it is refused on every
route that origin's class is not allowlisted for.

Both arms of :func:`app.api.v1.endpoints.device_bridge_ws.runner_proxy` are
SERVER-mediated calls the web backend has already authorised — the co-located
``httpx`` hop to ``127.0.0.1:<port>`` and the ``http_request`` relay frame.
Before this change both copied the caller's headers through minus ``host``, so
the runner saw ``Origin: https://app.qontinui.io`` and would classify a proxied
mobile / digital-twin / co-pilot call as a Foreign browser request and refuse
it. The strip must be on web ``origin/main`` before the runner enforces.
"""

from __future__ import annotations

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.api.v1.endpoints import device_bridge_ws

DEVICE_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"

# Exactly what a browser adds that the runner's origin guard reads (``origin``,
# ``sec-fetch-site``) plus the rest of the Fetch Metadata family, which carries
# no meaning on a server-to-server hop.
BROWSER_HEADERS = {
    "Origin": "https://app.qontinui.io",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-User": "?1",
}
BROWSER_HEADER_NAMES = {k.lower() for k in BROWSER_HEADERS}


class _FakeURL:
    def __init__(self, query: str = "") -> None:
        self.query = query


class _FakeRequest:
    def __init__(self, *, headers: dict[str, str], body: bytes = b"") -> None:
        self.method = "POST" if body else "GET"
        self.headers = headers
        self.cookies: dict[str, str] = {}
        self.url = _FakeURL()
        self.state = SimpleNamespace()
        self._body = body

    async def body(self) -> bytes:
        return self._body


@pytest.mark.asyncio
async def test_local_proxy_hop_does_not_forward_browser_origin(monkeypatch):
    """Co-located arm: the httpx request to 127.0.0.1 carries no Origin."""

    async def _fake_active_port(*, bearer, user_id):
        return 9876

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    sent: list[tuple[str, str]] = []

    class _EchoResponse:
        status_code = 200
        content = b"{}"
        headers = httpx.Headers({"content-type": "application/json"})

    class _CapturingClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kw):
            sent.extend(
                (k.lower(), v)
                for k, v in httpx.Headers(kw.get("headers")).multi_items()
            )
            return _EchoResponse()

    monkeypatch.setattr(
        device_bridge_ws.httpx, "AsyncClient", _CapturingClient, raising=True
    )

    await device_bridge_ws.runner_proxy(
        _FakeRequest(
            headers={**BROWSER_HEADERS, "Content-Type": "application/json"},
            body=b"{}",
        ),
        "unified-workflows",
        user=SimpleNamespace(id=USER_ID),
    )

    names = {k for k, _ in sent}
    assert names, "the capturing client saw no request at all"
    leaked = names & BROWSER_HEADER_NAMES
    assert not leaked, f"browser provenance headers reached the runner: {leaked}"
    # The strip is targeted: an ordinary header still goes through.
    assert ("content-type", "application/json") in sent


@pytest.mark.asyncio
async def test_relay_frame_does_not_forward_browser_origin(monkeypatch):
    """Relay arm: the http_request envelope's headers carry no Origin."""

    async def _fake_get_device_routing(device_id, *, bearer, user_id):
        return {"device_id": DEVICE_ID, "ws_session_id": 12345}

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_device_routing",
        _fake_get_device_routing,
        raising=True,
    )

    dispatch = AsyncMock(
        return_value={
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body_b64": base64.b64encode(b"{}").decode("ascii"),
        }
    )
    relay = MagicMock()
    relay.dispatch_and_wait = dispatch

    import app.services.runner_websocket_manager as mgr_mod

    monkeypatch.setattr(
        device_bridge_ws, "get_redis", AsyncMock(return_value=MagicMock()), raising=True
    )
    monkeypatch.setattr(
        mgr_mod,
        "get_runner_websocket_manager",
        AsyncMock(return_value=SimpleNamespace(relay=relay)),
        raising=True,
    )

    await device_bridge_ws.runner_proxy(
        _FakeRequest(
            headers={
                **BROWSER_HEADERS,
                "X-Qontinui-Device-Id": DEVICE_ID,
                "content-type": "application/json",
            },
            body=b"{}",
        ),
        "ui-bridge/state",
        user=SimpleNamespace(id=USER_ID),
    )

    assert dispatch.await_count == 1
    envelope = dispatch.await_args.args[1]
    leaked = set(envelope["headers"]) & BROWSER_HEADER_NAMES
    assert not leaked, f"browser provenance headers crossed the relay: {leaked}"
    assert envelope["headers"]["content-type"] == "application/json"


def test_both_filters_share_the_browser_provenance_set():
    """Neither filter can drift from the other on what counts as browser context."""
    browser = device_bridge_ws._BROWSER_PROVENANCE_REQUEST_HEADERS
    assert {"origin", "sec-fetch-site"} <= browser
    assert browser <= device_bridge_ws._RELAY_EXCLUDED_REQUEST_HEADERS
    assert browser <= device_bridge_ws._LOCAL_PROXY_EXCLUDED_REQUEST_HEADERS
