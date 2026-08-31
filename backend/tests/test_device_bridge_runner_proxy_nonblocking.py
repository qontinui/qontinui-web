"""Regression tests for the device-bridge runner-proxy remediation.

Three invariants, all from
``plans/2026-08-27-mobile-cloud-relay-unreachable-remediation.md``:

* **W1** — the co-located (legacy, no ``X-Qontinui-Device-Id``) arm of
  :func:`app.api.v1.endpoints.device_bridge_ws.runner_proxy` must not block
  the event loop. It used ``urllib.request.urlopen(req, timeout=30)`` inside
  an ``async def``, so one slow runner stalled *every* request served by that
  worker for up to 30s — the leading suspect for the 34s ``/health`` that
  made the coord JWKS fetch look like the fault.
* **W3** — ``_runner_proxy_relay`` has exactly ONE 503 emitter: the
  ``ws_session_id IS NULL`` branch. The ``except RunnerNotConnectedError``
  arm that used to sit beside it could never fire (the dispatch passes
  ``require_local_connection=False``, which is the flag the raise is gated
  on), so a reader debugging a relay 503 had two candidate causes for one
  real one.
* **D1** — ``/available-mobile-devices`` is the name that says which registry
  the route reads (phones, in Redis — *not* runners), with the historical
  ``/available-devices`` kept as an alias.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints import device_bridge_ws

USER_ID = "33333333-3333-3333-3333-333333333333"

# Sleep the fake runner performs per request. Small enough to keep the suite
# fast, large enough that a serialized (blocking) implementation is
# unambiguously separable from a concurrent one: serial is >= 2 * SLEEP_S.
SLEEP_S = 0.6


class _FakeURL:
    def __init__(self, query: str = "") -> None:
        self.query = query


class _FakeRequest:
    def __init__(self, *, headers: dict[str, str] | None = None) -> None:
        self.method = "GET"
        self.headers = headers or {}
        self.cookies: dict[str, str] = {}
        self.url = _FakeURL()

    async def body(self) -> bytes:
        return b""


# ---------------------------------------------------------------------------
# W1 — the co-located proxy hop must yield to the event loop
# ---------------------------------------------------------------------------


def test_runner_proxy_does_not_use_blocking_urlopen() -> None:
    """The handler must contain no synchronous urllib call.

    Source-level pin so the blocking call cannot be reintroduced quietly:
    the behavioural test below would still pass if someone wrapped
    ``urlopen`` in a thread, but reintroducing the bare call is the actual
    regression this guards.
    """
    source = inspect.getsource(device_bridge_ws.runner_proxy)
    # Strip comment lines: the handler legitimately explains in prose WHY the
    # old call is gone, and that explanation must not trip its own guard.
    code = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    )

    assert "urlopen" not in code, (
        "runner_proxy must not call urllib.request.urlopen — it is a "
        "synchronous call on the event loop and stalls every other request "
        "served by this worker for the duration of the timeout."
    )
    assert "httpx.AsyncClient" in code, (
        "runner_proxy's co-located hop must go through httpx.AsyncClient."
    )


@pytest.mark.asyncio
async def test_runner_proxy_concurrent_calls_do_not_serialize(monkeypatch):
    """Two concurrent proxy calls to a slow runner finish in ~T, not ~2T.

    This is the plan's stated verification for W1, scaled down from its 5s
    stub. With the old blocking ``urlopen`` the two calls run back to back;
    with ``httpx.AsyncClient`` they overlap.
    """

    async def _fake_active_port(*, bearer, user_id):
        return 9876

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    in_flight = 0
    max_in_flight = 0

    class _SlowResponse:
        status_code = 200
        content = b"ok"
        headers: dict[str, str] = {}

    class _SlowAsyncClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kw):
            nonlocal in_flight, max_in_flight
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
            try:
                await asyncio.sleep(SLEEP_S)
            finally:
                in_flight -= 1
            return _SlowResponse()

    monkeypatch.setattr(
        device_bridge_ws.httpx, "AsyncClient", _SlowAsyncClient, raising=True
    )

    user = SimpleNamespace(id=USER_ID)

    started = time.monotonic()
    responses = await asyncio.gather(
        device_bridge_ws.runner_proxy(_FakeRequest(), "status", user=user),
        device_bridge_ws.runner_proxy(_FakeRequest(), "status", user=user),
    )
    elapsed = time.monotonic() - started

    assert [r.status_code for r in responses] == [200, 200]
    # Both hops were open at the same moment — the direct statement of
    # "the handler yielded control".
    assert max_in_flight == 2, (
        f"the two proxy hops never overlapped (max_in_flight="
        f"{max_in_flight}); the handler is still serializing."
    )
    # And the wall clock agrees: ~T, not ~2T. The bound is generous so a
    # loaded CI box cannot flake it, while a serialized run (>= 2*SLEEP_S)
    # still fails.
    assert elapsed < SLEEP_S * 1.8, (
        f"two concurrent proxy calls took {elapsed:.2f}s for a "
        f"{SLEEP_S}s stub — expected ~{SLEEP_S}s, got a serialized ~2T."
    )


@pytest.mark.asyncio
async def test_runner_proxy_transport_failure_maps_to_502(monkeypatch):
    """A transport fault still maps to 502 with the port named.

    The old arm was ``except urllib.error.URLError``; the httpx equivalent is
    ``httpx.HTTPError``. Same status, same message.
    """

    async def _fake_active_port(*, bearer, user_id):
        return 9880

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    class _FailingAsyncClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kw):
            raise device_bridge_ws.httpx.ConnectError("connection refused")

    monkeypatch.setattr(
        device_bridge_ws.httpx, "AsyncClient", _FailingAsyncClient, raising=True
    )

    resp = await device_bridge_ws.runner_proxy(
        _FakeRequest(), "status", user=SimpleNamespace(id=USER_ID)
    )

    assert resp.status_code == 502
    assert b"9880" in resp.body


@pytest.mark.asyncio
async def test_runner_proxy_passes_runner_error_status_through(monkeypatch):
    """A non-2xx from the runner is relayed verbatim, not turned into a 502.

    ``urllib`` raised ``HTTPError`` for these and a dedicated arm re-emitted
    the status + body; httpx returns them as ordinary responses, so the
    pass-through must still hold.
    """

    async def _fake_active_port(*, bearer, user_id):
        return 9876

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    class _NotFoundResponse:
        status_code = 404
        content = b'{"detail":"nope"}'
        headers = {"content-type": "application/json"}

    class _NotFoundClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kw):
            return _NotFoundResponse()

    monkeypatch.setattr(
        device_bridge_ws.httpx, "AsyncClient", _NotFoundClient, raising=True
    )

    resp = await device_bridge_ws.runner_proxy(
        _FakeRequest(), "status", user=SimpleNamespace(id=USER_ID)
    )

    assert resp.status_code == 404
    assert resp.body == b'{"detail":"nope"}'


@pytest.mark.asyncio
async def test_runner_proxy_strips_content_encoding(monkeypatch):
    """``content-encoding`` never survives the co-located hop.

    httpx transparently decodes the body, so echoing the runner's
    ``content-encoding: gzip`` beside already-decoded bytes would hand the
    caller an undecodable response. ``urllib`` did not decode, so this guard
    is specific to the httpx migration.
    """

    async def _fake_active_port(*, bearer, user_id):
        return 9876

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_active_routing_port",
        _fake_active_port,
        raising=True,
    )

    class _GzipResponse:
        status_code = 200
        content = b"plain-decoded-body"
        headers = {
            "content-type": "text/plain",
            "content-encoding": "gzip",
            "transfer-encoding": "chunked",
        }

    class _GzipClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kw):
            return _GzipResponse()

    monkeypatch.setattr(
        device_bridge_ws.httpx, "AsyncClient", _GzipClient, raising=True
    )

    resp = await device_bridge_ws.runner_proxy(
        _FakeRequest(), "status", user=SimpleNamespace(id=USER_ID)
    )

    assert resp.status_code == 200
    assert "content-encoding" not in {k.lower() for k in resp.headers}
    assert "transfer-encoding" not in {k.lower() for k in resp.headers}
    assert resp.headers["content-type"] == "text/plain"


# ---------------------------------------------------------------------------
# W3 — exactly one 503 emitter on the relay path
# ---------------------------------------------------------------------------


def test_relay_has_exactly_one_503_emitter() -> None:
    """``_runner_proxy_relay`` emits 503 from one place only.

    The second emitter was ``except RunnerNotConnectedError``, which could
    not fire: ``dispatch_and_wait`` is called with
    ``require_local_connection=False`` and
    ``app/services/runner/command_relay.py`` raises that error only under
    ``if require_local_connection and ...``. Deleted rather than commented,
    so the ambiguity is gone rather than annotated.
    """
    source = inspect.getsource(device_bridge_ws._runner_proxy_relay)

    assert source.count("status_code=503") == 1, (
        "the relay path must have exactly one 503 emitter — the "
        "ws_session_id IS NULL branch."
    )
    assert "except RunnerNotConnectedError" not in source, (
        "the RunnerNotConnectedError arm is unreachable "
        "(require_local_connection=False) and must stay deleted."
    )
    assert "require_local_connection=False" in source


def test_relay_503_is_the_ws_session_id_branch() -> None:
    """The one 503 is guarded by the ``ws_session_id`` read, not anything else."""
    source = inspect.getsource(device_bridge_ws._runner_proxy_relay)
    lines = source.splitlines()

    emitters = [i for i, line in enumerate(lines) if "status_code=503" in line]
    assert len(emitters) == 1, (
        f"the relay must have exactly ONE 503 emitter; found {len(emitters)}"
    )
    idx = emitters[0]

    # Walk back to the GOVERNING conditional; it must be the ws_session_id read.
    #
    # Two earlier spellings of this check were both too weak. A fixed
    # line-distance lookback broke the moment the branch grew a body (the W-A
    # structured log + the W-B clock decoration). Replacing it with "the
    # nearest preceding ``if``" then broke on the first conditional *inside*
    # the branch (``if liveness.known:``, which decorates the body) — a line
    # that precedes the emitter without governing it.
    #
    # "Governs" is an indentation relation in Python, so test that directly:
    # the nearest preceding ``if``/``elif`` indented STRICTLY LESS than the
    # emitter. That is the branch the emitter actually sits inside, and it
    # stays correct however much the body grows or nests.
    emitter_indent = len(lines[idx]) - len(lines[idx].lstrip())
    guard = next(
        (
            lines[i]
            for i in range(idx - 1, -1, -1)
            if lines[i].strip().startswith(("if ", "elif "))
            and len(lines[i]) - len(lines[i].lstrip()) < emitter_indent
        ),
        None,
    )
    assert guard is not None and 'row.get("ws_session_id") is None' in guard, (
        "the relay's only 503 must be the ws_session_id IS NULL branch; "
        f"nearest governing conditional was:\n{guard}"
    )


@pytest.mark.asyncio
async def test_relay_returns_503_when_ws_session_id_is_null(monkeypatch):
    """A device row with a NULL ``ws_session_id`` yields the relay's 503."""

    async def _fake_routing(device_uuid, *, bearer, user_id):
        return {"device_id": str(device_uuid), "ws_session_id": None}

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_device_routing",
        _fake_routing,
        raising=True,
    )

    # The 503 branch decorates its body with ``last_seen_at`` from the
    # full-row coord read (W-B). Stub it so this test attempts no network.
    async def _fake_owned(request, device_id_, user_id):
        return {"device_id": str(device_id_), "last_seen_at": "2026-08-27T09:15:00Z"}

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_owned_device",
        _fake_owned,
        raising=True,
    )

    device_id = "c79a07d5-7e40-49b4-87fa-554c749f9644"
    resp = await device_bridge_ws._runner_proxy_relay(
        _FakeRequest(headers={"X-Qontinui-Device-Id": device_id}),
        "analytics/account-usage",
        USER_ID,
        device_id,
    )

    assert resp.status_code == 503
    assert b"runner not connected" in resp.body
    # W-B: additive diagnosis fields ride alongside the unchanged ``detail``.
    assert device_id.encode() in resp.body
    assert b"2026-08-27T09:15:00Z" in resp.body


@pytest.mark.asyncio
async def test_relay_returns_404_when_device_not_owned(monkeypatch):
    """An unknown / unowned device is a 404, distinct from the 503.

    Pinned alongside the 503 because the two are the pair a mobile client has
    to tell apart: 404 = wrong device id, 503 = right device, no cloud session.
    """

    async def _fake_routing(device_uuid, *, bearer, user_id):
        return None

    monkeypatch.setattr(
        device_bridge_ws.coord_device,
        "get_device_routing",
        _fake_routing,
        raising=True,
    )

    device_id = "c79a07d5-7e40-49b4-87fa-554c749f9644"
    resp = await device_bridge_ws._runner_proxy_relay(
        _FakeRequest(headers={"X-Qontinui-Device-Id": device_id}),
        "analytics/account-usage",
        USER_ID,
        device_id,
    )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# D1 — the route name says which registry it reads, old path kept as alias
# ---------------------------------------------------------------------------


def test_available_mobile_devices_route_and_alias_are_registered() -> None:
    """Both paths resolve to the same handler; the old one is deprecated."""
    paths = {
        route.path: route
        for route in device_bridge_ws.router.routes
        if getattr(route, "path", None)
        in ("/available-devices", "/available-mobile-devices")
    }

    assert "/available-mobile-devices" in paths, (
        "the phone list must be reachable under the name that says it lists "
        "phones, not runners."
    )
    assert "/available-devices" in paths, (
        "the historical path must remain as an alias — renaming without one "
        "breaks existing clients."
    )
    assert (
        paths["/available-devices"].endpoint
        is paths["/available-mobile-devices"].endpoint
    )
    assert paths["/available-devices"].deprecated is True


def test_module_docstring_names_both_mechanisms() -> None:
    """The module header must not assert this file is one system.

    It described only the phone bridge, never mentioning the runner-proxy
    relay, ``coord.devices.ws_session_id`` or ``devices_ws.py`` — which is
    how the two got conflated in the first place.
    """
    doc = device_bridge_ws.__doc__ or ""

    assert "ws_session_id" in doc
    assert "devices_ws.py" in doc
    assert "runner-proxy" in doc.lower()
    assert "Redis" in doc
