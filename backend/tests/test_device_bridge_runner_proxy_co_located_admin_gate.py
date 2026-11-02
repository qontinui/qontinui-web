"""The co-located arm of ``/device-bridge/runner-proxy`` is for platform admins.

``runner_proxy`` has two arms. With ``X-Qontinui-Device-Id`` it relays to a
runner the caller OWNS, over that runner's own WebSocket, and the runner relays
only a closed list of routes (qontinui-runner ``relay_path_policy.rs``).
WITHOUT the header it forwards the request to ``http://127.0.0.1:<port>/<path>``
— whichever runner listens on the backend's own host — with ``Origin`` and
Fetch Metadata stripped, so the runner's origin guard classes the call
NonBrowser and admits it to every route. Nothing ties that runner to the
caller: the port lookup names the caller's most recent runner wherever it runs,
and falls back to 9876.

So before the gate any signed-in user could drive a co-located runner,
including ``PATCH /apps/{app_id}`` and ``POST /apps``, which write the shared
``project.apps`` build and start commands the auto-fresh engine executes on
fleet machines. That went around the platform-admin gate ``fleet_targets.py``
puts on the same write (coord finding
``b27adf71-4de5-49bc-ad89-7a8acd372035``). The exposure depends on topology:
only a backend that shares a host with a runner (the demo box, a dev box) has
anything listening on that loopback, and production's hosts run no runner.

The handler is called directly, as in the rest of the
``test_device_bridge_runner_proxy_*`` family, with the two things the
co-located hop touches replaced by recorders: coord's port lookup and the
``httpx.AsyncClient`` the hop is sent through. A refusal must come before
EITHER is touched.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers

from app.api.v1.endpoints import device_bridge_ws
from app.models.user import User

USER_ID = "44444444-4444-4444-4444-444444444444"
DEVICE_ID = "55555555-5555-5555-5555-555555555555"

#: A signed-in, active user who is not a platform admin (``current_active_user``
#: has already refused an inactive one before the handler runs). The handler
#: reads only ``id`` and ``is_superuser`` from it.
MEMBER = cast(User, SimpleNamespace(id=USER_ID, is_superuser=False))
ADMIN = cast(User, SimpleNamespace(id=USER_ID, is_superuser=True))


class _FakeURL:
    def __init__(self, query: str = "") -> None:
        self.query = query


class _FakeRequest:
    """Starlette-Request stand-in for the handler (real ``Headers``)."""

    def __init__(
        self,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        body: bytes = b"",
        request_id: str | None = None,
    ) -> None:
        self.method = method
        self.headers = Headers(headers=headers or {})
        self.cookies: dict[str, str] = {}
        self.url = _FakeURL()
        self._body = body
        self.state = SimpleNamespace()
        if request_id is not None:
            self.state.request_id = request_id

    async def body(self) -> bytes:
        return self._body


def _request(**kwargs: Any) -> Request:
    """A :class:`_FakeRequest`, typed as the ``Request`` the handler takes."""
    return cast(Request, _FakeRequest(**kwargs))


class _Hop:
    """What the co-located hop touched: port lookups and requests sent."""

    def __init__(self) -> None:
        self.port_lookups: list[str] = []
        self.sent: list[tuple[str, str]] = []


def _install_hop(monkeypatch: pytest.MonkeyPatch) -> _Hop:
    hop = _Hop()

    async def _fake_active_port(*, bearer, user_id):
        hop.port_lookups.append(user_id)
        return 9876

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    class _RecordingAsyncClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kw):
            hop.sent.append((method, url))
            return httpx.Response(200, json={"runner": "answered"})

    monkeypatch.setattr(
        device_bridge_ws.httpx, "AsyncClient", _RecordingAsyncClient, raising=True
    )
    return hop


class _RecordingLogger:
    """Capture structlog-style calls (structlog does not reach ``caplog``)."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    def __getattr__(self, level):
        def _call(event, **kw):
            self.calls.append((level, event, kw))

        return _call

    def kw_for(self, event: str) -> tuple[str, dict]:
        for level, ev, kw in self.calls:
            if ev == event:
                return level, kw
        raise AssertionError(f"no {event!r} log line; saw {self.calls}")


def _body(response: Any) -> dict[str, Any]:
    body: dict[str, Any] = json.loads(bytes(response.body).decode())
    return body


# The runner routes that write or read ``project.apps`` (qontinui-runner
# ``spec_api/apps.rs``), plus one unrelated route: the arm is refused for EVERY
# route, not only the app registry.
REFUSED = [
    ("PATCH", "apps/acme-app"),  # rewrite an app's build/start commands
    ("POST", "apps"),  # register an app, commands included
    ("DELETE", "apps/acme-app"),
    ("GET", "apps"),  # the whole registry, commands included
    ("GET", "health"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "path"), REFUSED)
async def test_a_user_who_is_not_a_platform_admin_is_refused_before_the_hop(
    monkeypatch: pytest.MonkeyPatch, method: str, path: str
) -> None:
    hop = _install_hop(monkeypatch)
    rec = _RecordingLogger()
    monkeypatch.setattr(device_bridge_ws, "logger", rec, raising=True)

    response = await device_bridge_ws.runner_proxy(
        _request(method=method, request_id="req-co-located"), path, user=MEMBER
    )

    # One comparison, so a gate that let the call through reports the status
    # it answered AND what it touched on the way.
    assert (response.status_code, hop.port_lookups, hop.sent) == (403, [], [])
    body = _body(response)
    assert body["request_id"] == "req-co-located"
    # The typed refusal: what went wrong, and what to send instead.
    assert body["refusal"]["code"] == "permission_denied"
    assert body["refusal"]["discriminator"] == "co_located_proxy_admin_only"
    assert body["refusal"]["next_action"] == {
        "kind": "fix_request",
        "target": "X-Qontinui-Device-Id",
    }
    assert "platform administrators" in body["detail"]
    assert "X-Qontinui-Device-Id" in body["detail"]
    # Visible server-side, joinable by request id.
    level, logged = rec.kw_for("runner_proxy_co_located_refused")
    assert level == "warning"
    assert logged == {
        "user_id": USER_ID,
        "path": path,
        "method": method,
        "request_id": "req-co-located",
    }


@pytest.mark.asyncio
async def test_a_platform_admin_is_forwarded_to_the_co_located_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The control for the refusal above: the same call, by an admin."""
    hop = _install_hop(monkeypatch)

    response = await device_bridge_ws.runner_proxy(
        _request(method="PATCH", body=b'{"build_command": "make"}'),
        "apps/acme-app",
        user=ADMIN,
    )

    assert response.status_code == 200
    assert hop.port_lookups == [USER_ID]
    assert hop.sent == [("PATCH", "http://127.0.0.1:9876/apps/acme-app")]


@pytest.mark.asyncio
async def test_the_relay_arm_stays_open_to_a_user_who_is_not_an_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The header selects the relay, which the gate must not touch.

    The relay reaches only a runner this caller owns, and only the routes that
    runner relays, so it is the door every web and mobile caller uses.
    """
    hop = _install_hop(monkeypatch)
    relayed: list[tuple[str, str, str]] = []

    async def _fake_relay(request, path, user_id, device_id_hdr):
        relayed.append((path, user_id, device_id_hdr))
        return JSONResponse({"relayed": True})

    monkeypatch.setattr(device_bridge_ws, "_runner_proxy_relay", _fake_relay)

    response = await device_bridge_ws.runner_proxy(
        _request(headers={"X-Qontinui-Device-Id": DEVICE_ID}),
        "health",
        user=MEMBER,
    )

    assert response.status_code == 200
    assert relayed == [("health", USER_ID, DEVICE_ID)]
    assert (hop.port_lookups, hop.sent) == ([], [])
