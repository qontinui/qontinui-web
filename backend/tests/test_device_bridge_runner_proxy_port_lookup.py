"""Regression test for the device-bridge runner-proxy port lookup.

History: the port-lookup in
:func:`app.api.v1.endpoints.device_bridge_ws.runner_proxy` was a raw-SQL
read of ``coord.devices`` (originally mis-pointed at the renamed
``runners`` table, which spammed ``runner_proxy_port_lookup_failed`` and
silently returned the wrong port).

Phase 3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md`` moved
that read off coord's Postgres schema onto coord's HTTP boundary
(``GET /coord/devices/routing/active`` via
:func:`app.services.coord_device.get_active_routing_port`). This test pins
the post-migration shape:

* the handler no longer contains any ``coord.devices`` SQL string, and
* it sources the port from the coord routing client (with a default-9876
  fallback when the client returns ``None``).
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints import device_bridge_ws

USER_ID = "22222222-2222-2222-2222-222222222222"


class _FakeURL:
    def __init__(self, query: str) -> None:
        self.query = query


class _FakeRequest:
    def __init__(self, *, headers: dict[str, str] | None = None) -> None:
        self.method = "GET"
        self.headers = headers or {}
        self.cookies: dict[str, str] = {}
        self.url = _FakeURL("")

    async def body(self) -> bytes:
        return b""


def test_runner_proxy_no_longer_reads_coord_devices_sql() -> None:
    """The runner-proxy handler must not contain ``coord.devices`` SQL.

    The read is now coord HTTP. We pin the *absence* of the raw-SQL read
    (a source-level boundary check mirroring the schema-boundary guard)
    and the *presence* of the coord routing-client call.
    """
    source = inspect.getsource(device_bridge_ws.runner_proxy)

    # No raw-SQL execution machinery remains in the handler body. We check
    # the execution seams (`text(`, `AsyncSessionLocal`, `.execute(`) rather
    # than the literal `FROM coord.devices` token, since the explanatory
    # comment legitimately quotes the former SQL for history.
    assert "AsyncSessionLocal" not in source, (
        "runner_proxy still opens a DB session for the port lookup; the read "
        "moved onto coord's GET /coord/devices/routing/active."
    )
    assert "text(" not in source, (
        "runner_proxy still builds raw SQL for the port lookup."
    )
    assert "FROM runners" not in source
    assert "get_active_routing_port" in source, (
        "runner_proxy must source the port from the coord routing client."
    )


@pytest.mark.asyncio
async def test_runner_proxy_uses_coord_routing_port(monkeypatch):
    """The co-located path uses the port the coord routing client returns."""
    captured: dict[str, object] = {}

    async def _fake_active_port(*, bearer, user_id):
        captured["bearer"] = bearer
        captured["user_id"] = user_id
        return 9880

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    # Stub the urllib path so we observe only the resolved target port.
    opened: dict[str, str] = {}

    class _FakeResp:
        status = 200

        def read(self) -> bytes:
            return b"ok"

        def getheaders(self):
            return []

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def _fake_urlopen(req, timeout=0):
        opened["url"] = req.full_url
        return _FakeResp()

    monkeypatch.setattr(
        device_bridge_ws.urllib.request, "urlopen", _fake_urlopen, raising=True
    )

    request = _FakeRequest(headers={"Authorization": "Bearer tok-abc"})
    resp = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )

    assert resp.status_code == 200
    # The coord-resolved port (9880) is the proxy target.
    assert "127.0.0.1:9880/health" in opened["url"]
    # The caller's bearer + user id were forwarded to the coord client.
    assert captured["bearer"] == "tok-abc"
    assert captured["user_id"] == USER_ID


@pytest.mark.asyncio
async def test_runner_proxy_falls_back_to_default_port_on_none(monkeypatch):
    """When coord reports no active runner (None), the default 9876 is used."""

    async def _fake_active_port(*, bearer, user_id):
        return None

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    opened: dict[str, str] = {}

    class _FakeResp:
        status = 200

        def read(self) -> bytes:
            return b"ok"

        def getheaders(self):
            return []

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def _fake_urlopen(req, timeout=0):
        opened["url"] = req.full_url
        return _FakeResp()

    monkeypatch.setattr(
        device_bridge_ws.urllib.request, "urlopen", _fake_urlopen, raising=True
    )

    request = _FakeRequest()
    resp = await device_bridge_ws.runner_proxy(
        request, "health", user=SimpleNamespace(id=USER_ID)
    )

    assert resp.status_code == 200
    assert "127.0.0.1:9876/health" in opened["url"]
