"""Tests for the device-authed remote-terminal origination door (D6, Phase 3b).

Plan ``2026-08-31-remote-session-tabs-in-runner-terminal``. What is pinned:

* a ``remote_terminal_attach`` whose grant is invalid / expired / minted for a
  different source device is refused with the typed code and NOTHING is
  forwarded to the target;
* a valid grant registers the attachment (Redis, expiring with the grant) and
  forwards ``terminal_attach`` carrying the ``remote`` block;
* the target's ``terminal_output`` for an attached terminal reaches the ONE
  attached source socket and no other; output for a terminal nobody attached
  is not handed to any device socket;
* ``remote_terminal_input`` for an unregistered grant is refused;
* ``devices_ws`` routes the new family through the relay while the existing
  mobile-watcher path is untouched.

Redis and the JWKS verifier are stubbed the way the neighbouring
``devices_ws`` tests stub them: an in-memory fake for Redis, and
``patch.object(coord_jwks_client, "verify_token", AsyncMock(...))`` for the
verifier — the EdDSA path itself is covered by ``tests/services/test_coord_jwks``.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints import devices_ws
from app.services.coord_jwks import CoordTokenExpiredError, CoordTokenInvalidError
from app.services.runner import remote_terminal_relay as rtr
from app.services.runner.remote_terminal_relay import RemoteTerminalRelay

pytestmark = pytest.mark.asyncio

SOURCE_DEVICE = str(uuid4())
TARGET_DEVICE = str(uuid4())
TARGET_SESSION = str(uuid4())


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakePubSub:
    def __init__(self) -> None:
        self.channels: list[str] = []
        self.closed = False

    async def subscribe(self, *channels: str) -> None:
        self.channels.extend(channels)

    async def unsubscribe(self, *channels: str) -> None:
        self.channels = []

    async def close(self) -> None:
        self.closed = True

    async def listen(self) -> AsyncIterator[dict[str, Any]]:
        # Never yields; the relay's listener task parks here until cancelled.
        await asyncio.Event().wait()
        yield {}  # pragma: no cover - unreachable, keeps this an async generator


class _FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.expiry: dict[str, int] = {}
        self.published: list[tuple[str, dict[str, Any]]] = []
        self.pubsubs: list[_FakePubSub] = []

    async def hset(self, key: str, mapping: dict[str, str]) -> int:
        self.hashes.setdefault(key, {}).update(mapping)
        return len(mapping)

    async def expireat(self, key: str, when: int) -> bool:
        self.expiry[key] = when
        return True

    async def delete(self, *keys: str) -> int:
        n = 0
        for key in keys:
            if self.hashes.pop(key, None) is not None:
                n += 1
            self.expiry.pop(key, None)
        return n

    async def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, json.loads(message)))
        return 1

    def pubsub(self) -> _FakePubSub:
        ps = _FakePubSub()
        self.pubsubs.append(ps)
        return ps


class _FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)

    def of_type(self, frame_type: str) -> list[dict[str, Any]]:
        return [f for f in self.sent if f.get("type") == frame_type]


def _manager(*, target_connected: bool = True) -> Any:
    return SimpleNamespace(
        send_terminal=AsyncMock(return_value=target_connected),
        relay=SimpleNamespace(send_command_to_runner=AsyncMock(return_value=True)),
        send_terminal_response_to_mobiles=AsyncMock(),
        send_response_to_frontends=AsyncMock(),
        send_chat_response_to_mobiles=AsyncMock(),
        get_websocket=lambda _id: None,
        refresh_ttl=AsyncMock(),
    )


def _claims(**overrides: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "sub": "attach-grant:" + str(uuid4()),
        "sub_type": "attach_grant",
        "device_id": SOURCE_DEVICE,
        "user_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "attach": {
            "target_device_id": TARGET_DEVICE,
            "target_session_id": TARGET_SESSION,
            "terminal_id": None,
        },
        "iat": int(time.time()),
        "exp": int(time.time()) + 900,
        "jti": str(uuid4()),
    }
    claims.update(overrides)
    return claims


def _verify(result: Any) -> Any:
    """Patch the module's verifier: a dict is returned, an exception is raised."""
    if isinstance(result, BaseException):
        mock = AsyncMock(side_effect=result)
    else:
        mock = AsyncMock(return_value=result)
    return patch.object(rtr.coord_jwks_client, "verify_token", mock)


async def _attach(
    relay: RemoteTerminalRelay,
    ws: _FakeWS,
    manager: Any,
    claims: Any,
    *,
    request_id: str = "req-attach-1",
) -> None:
    with _verify(claims):
        await relay.handle_source_frame(
            {
                "type": "remote_terminal_attach",
                "request_id": request_id,
                "grant": "opaque.jwt.here",
                "cols": 120,
                "rows": 40,
            },
            SOURCE_DEVICE,
            "user-1",
            manager,
            ws,
        )


async def _attached(
    relay: RemoteTerminalRelay,
    ws: _FakeWS,
    manager: Any,
    *,
    terminal_id: str = "t1",
    request_id: str = "req-attach-1",
) -> dict[str, Any]:
    """Attach with a valid grant and let the target confirm ``terminal_id``."""
    claims = _claims()
    await _attach(relay, ws, manager, claims, request_id=request_id)
    session = relay._sessions[id(ws)]
    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_attached",
            "request_id": request_id,
            "terminal_id": terminal_id,
            "data": "cmluZw==",
            "start_offset": 0,
            "total_bytes_produced": 4,
        },
    )
    assert routed is True
    return claims


@pytest.fixture
def redis() -> _FakeRedis:
    return _FakeRedis()


@pytest.fixture
def relay(redis: _FakeRedis) -> RemoteTerminalRelay:
    return RemoteTerminalRelay(redis_client=redis)


# ---------------------------------------------------------------------------
# Grant verification refusals — nothing is forwarded
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("verifier_result", "expected_code"),
    [
        (
            CoordTokenInvalidError("token verification failed: bad signature"),
            "attach_grant_invalid",
        ),
        (CoordTokenExpiredError("token expired"), "attach_grant_expired"),
        (_claims(exp=int(time.time()) - 5), "attach_grant_expired"),
        (_claims(device_id=str(uuid4())), "attach_grant_wrong_source"),
        (_claims(sub_type="device"), "attach_grant_invalid"),
        (_claims(attach={"target_device_id": "not-a-uuid"}), "attach_grant_invalid"),
    ],
)
async def test_attach_refused_with_typed_code_and_nothing_forwarded(
    relay: RemoteTerminalRelay,
    redis: _FakeRedis,
    verifier_result: Any,
    expected_code: str,
) -> None:
    ws = _FakeWS()
    manager = _manager()

    await _attach(relay, ws, manager, verifier_result)

    errors = ws.of_type("error")
    assert len(errors) == 1, ws.sent
    assert errors[0]["code"] == expected_code
    assert errors[0]["request_id"] == "req-attach-1"
    manager.send_terminal.assert_not_called()
    manager.relay.send_command_to_runner.assert_not_called()
    assert redis.hashes == {}
    assert redis.pubsubs == []


async def test_attach_grant_missing_is_invalid(relay: RemoteTerminalRelay) -> None:
    ws = _FakeWS()
    manager = _manager()
    await relay.handle_source_frame(
        {"type": "remote_terminal_attach", "request_id": "r", "cols": 1, "rows": 1},
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )
    assert ws.of_type("error")[0]["code"] == "attach_grant_invalid"
    manager.send_terminal.assert_not_called()


# ---------------------------------------------------------------------------
# Valid grant — registered and forwarded with the remote block
# ---------------------------------------------------------------------------


async def test_valid_attach_registers_and_forwards_terminal_attach(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()

    await _attach(relay, ws, manager, claims)

    assert ws.of_type("error") == []
    manager.send_terminal.assert_awaited_once()
    target, frame = manager.send_terminal.await_args.args
    assert target == TARGET_DEVICE
    assert frame["type"] == "terminal_attach"
    assert frame["request_id"] == "req-attach-1"
    assert (frame["cols"], frame["rows"]) == (120, 40)
    assert frame["remote"] == {
        "source_device_id": SOURCE_DEVICE,
        "grant_jti": claims["jti"],
        "session_id": TARGET_SESSION,
    }

    # Registry: the grant record exists and expires with the grant.
    key = rtr.grant_key(claims["jti"])
    assert redis.hashes[key]["source_device_id"] == SOURCE_DEVICE
    assert redis.hashes[key]["target_device_id"] == TARGET_DEVICE
    assert redis.expiry[key] == claims["exp"]
    # No terminal is bound yet, so no per-terminal route row.
    assert not any(
        k.startswith(f"remote_attach:{TARGET_DEVICE}:") for k in redis.hashes
    )

    # Return route: one listener on the target's response channels, and the
    # runner asked to start forwarding output (same as the mobile path).
    assert len(redis.pubsubs) == 1
    assert set(redis.pubsubs[0].channels) == {
        f"runner:terminal_response:{TARGET_DEVICE}",
        f"runner:remote_terminal_response:{TARGET_DEVICE}",
    }
    manager.relay.send_command_to_runner.assert_awaited_once_with(
        TARGET_DEVICE, {"type": "terminal_subscribe", "runner_id": TARGET_DEVICE}
    )

    await relay.release_source(ws)


async def test_attach_to_disconnected_target_is_refused_and_unregistered(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager(target_connected=False)

    await _attach(relay, ws, manager, _claims())

    assert ws.of_type("error")[0]["code"] == "target_not_connected"
    assert redis.hashes == {}
    assert relay._sessions[id(ws)].grants == {}
    assert relay._sessions[id(ws)].listeners == {}


async def test_grant_naming_a_terminal_registers_the_route_immediately(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _claims(
        attach={
            "target_device_id": TARGET_DEVICE,
            "target_session_id": TARGET_SESSION,
            "terminal_id": "t-pinned",
        }
    )

    await _attach(relay, ws, manager, claims)

    route = redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t-pinned")]
    assert route == {
        "source_device_id": SOURCE_DEVICE,
        "grant_jti": claims["jti"],
        "exp": str(claims["exp"]),
    }
    frame = manager.send_terminal.await_args.args[1]
    assert frame["remote"]["terminal_id"] == "t-pinned"
    await relay.release_source(ws)


# ---------------------------------------------------------------------------
# Return route — per terminal, to the one attached source
# ---------------------------------------------------------------------------


async def test_terminal_attached_binds_terminal_and_answers_source(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()

    claims = await _attached(relay, ws, manager, terminal_id="t1")

    attached = ws.of_type("remote_terminal_attached")
    assert attached == [
        {
            "type": "remote_terminal_attached",
            "request_id": "req-attach-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "buffer": "cmluZw==",
            "start_offset": 0,
            "total_bytes_produced": 4,
        }
    ]
    route = redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t1")]
    assert route["grant_jti"] == claims["jti"]
    assert route["source_device_id"] == SOURCE_DEVICE
    assert redis.expiry[rtr.terminal_key(TARGET_DEVICE, "t1")] == claims["exp"]
    assert redis.hashes[rtr.grant_key(claims["jti"])]["terminal_id"] == "t1"
    await relay.release_source(ws)


async def test_output_routes_to_the_attached_source_only(
    relay: RemoteTerminalRelay,
) -> None:
    ws_a = _FakeWS()
    ws_b = _FakeWS()
    manager = _manager()
    claims_a = await _attached(relay, ws_a, manager, terminal_id="t1", request_id="ra")
    await _attached(relay, ws_b, manager, terminal_id="t2", request_id="rb")
    session_a = relay._sessions[id(ws_a)]
    session_b = relay._sessions[id(ws_b)]
    before_a, before_b = len(ws_a.sent), len(ws_b.sent)

    frame = {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="}
    # Every source listener on the target's channel sees every frame; only
    # the one holding t1 delivers it.
    assert await relay.route_target_frame(session_a, TARGET_DEVICE, frame) is True
    assert await relay.route_target_frame(session_b, TARGET_DEVICE, frame) is False

    assert ws_a.sent[before_a:] == [
        {
            "type": "remote_terminal_output",
            "grant_jti": claims_a["jti"],
            "terminal_id": "t1",
            "data": "aGk=",
        }
    ]
    assert ws_b.sent[before_b:] == []
    await relay.release_source(ws_a)
    await relay.release_source(ws_b)


async def test_output_for_unattached_terminal_reaches_no_device_socket(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()
    await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    before = len(ws.sent)

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {"type": "terminal_output", "terminal_id": "t-other", "data": "eA=="},
    )

    assert routed is False
    assert ws.sent[before:] == []
    await relay.release_source(ws)


async def test_terminal_exit_routes_then_drops_the_attachment(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]

    assert (
        await relay.route_target_frame(
            session,
            TARGET_DEVICE,
            {"type": "terminal_exit", "terminal_id": "t1", "exit_code": 3},
        )
        is True
    )

    assert ws.of_type("remote_terminal_exit") == [
        {
            "type": "remote_terminal_exit",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "exit_code": 3,
        }
    ]
    assert session.grants == {}
    assert rtr.grant_key(claims["jti"]) not in redis.hashes
    assert rtr.terminal_key(TARGET_DEVICE, "t1") not in redis.hashes
    # Last attachment to that target went away, so its listener did too.
    assert session.listeners == {}
    manager.relay.send_command_to_runner.assert_awaited_with(
        TARGET_DEVICE, {"type": "terminal_unsubscribe", "runner_id": TARGET_DEVICE}
    )
    await relay.release_source(ws)


async def test_target_error_for_pending_attach_reaches_source_and_drops_grant(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    session = relay._sessions[id(ws)]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "error",
            "request_id": "req-attach-1",
            "code": "attach_grant_unknown",
            "message": "no such grant",
        },
    )

    assert routed is True
    assert ws.of_type("remote_terminal_error") == [
        {
            "type": "remote_terminal_error",
            "grant_jti": claims["jti"],
            "code": "attach_grant_unknown",
            "message": "no such grant",
            "request_id": "req-attach-1",
        }
    ]
    assert session.grants == {}
    assert redis.hashes == {}


async def test_unrelated_target_frames_are_ignored(relay: RemoteTerminalRelay) -> None:
    ws = _FakeWS()
    manager = _manager()
    await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    before = len(ws.sent)

    for frame in (
        {"type": "terminal_sessions", "request_id": "someone-elses"},
        {"type": "terminal_buffer_response", "request_id": "not-mine", "data": "x"},
        {"type": "error", "request_id": "not-mine", "message": "nope"},
        {"type": "error", "message": "generic"},
        {"type": "terminal_attached", "request_id": "not-mine", "terminal_id": "t9"},
    ):
        assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is False
    assert ws.sent[before:] == []
    await relay.release_source(ws)


# ---------------------------------------------------------------------------
# Post-attach frames — only for a registered, bound grant on this socket
# ---------------------------------------------------------------------------


async def test_input_for_unregistered_grant_is_refused(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()

    await relay.handle_source_frame(
        {
            "type": "remote_terminal_input",
            "grant_jti": str(uuid4()),
            "terminal_id": "t1",
            "data": "bHM=",
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )

    errors = ws.of_type("error")
    assert len(errors) == 1
    assert errors[0]["code"] == "attach_not_registered"
    manager.send_terminal.assert_not_called()


async def test_input_before_terminal_bound_is_refused(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    manager.send_terminal.reset_mock()

    await relay.handle_source_frame(
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "bHM=",
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )

    assert ws.of_type("error")[0]["code"] == "attach_not_registered"
    manager.send_terminal.assert_not_called()
    await relay.release_source(ws)


async def test_input_after_attach_forwards_with_remote_block(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await relay.handle_source_frame(
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "bHM=",
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )
    await relay.handle_source_frame(
        {
            "type": "remote_terminal_resize",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "cols": 80,
            "rows": 24,
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )
    # Wrong terminal for this grant: refused, not forwarded.
    await relay.handle_source_frame(
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t-other",
            "data": "bHM=",
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )

    assert manager.send_terminal.await_count == 2
    remote = {"source_device_id": SOURCE_DEVICE, "grant_jti": claims["jti"]}
    input_frame = manager.send_terminal.await_args_list[0].args[1]
    assert input_frame["type"] == "terminal_input"
    assert input_frame["terminal_id"] == "t1"
    assert input_frame["data"] == "bHM="
    assert input_frame["remote"] == remote
    resize_frame = manager.send_terminal.await_args_list[1].args[1]
    assert resize_frame["type"] == "terminal_resize"
    assert (resize_frame["cols"], resize_frame["rows"]) == (80, 24)
    assert resize_frame["remote"] == remote
    assert ws.of_type("error")[-1]["code"] == "attach_not_registered"
    await relay.release_source(ws)


async def test_buffer_roundtrip_is_correlated_by_request_id(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    manager.send_terminal.reset_mock()

    await relay.handle_source_frame(
        {
            "type": "remote_terminal_buffer",
            "request_id": "buf-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "from_offset": 10,
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )
    frame = manager.send_terminal.await_args.args[1]
    assert frame["type"] == "terminal_buffer"
    assert (frame["request_id"], frame["from_offset"]) == ("buf-1", 10)
    assert frame["remote"]["grant_jti"] == claims["jti"]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_buffer_response",
            "request_id": "buf-1",
            "data": "YWJj",
            "start_offset": 10,
            "total_bytes_produced": 13,
        },
    )
    assert routed is True
    assert ws.of_type("remote_terminal_buffer") == [
        {
            "type": "remote_terminal_buffer",
            "request_id": "buf-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "YWJj",
            "start_offset": 10,
            "total_bytes_produced": 13,
        }
    ]
    await relay.release_source(ws)


async def test_detach_forwards_and_drops(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    manager.send_terminal.reset_mock()

    await relay.handle_source_frame(
        {
            "type": "remote_terminal_detach",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
        },
        SOURCE_DEVICE,
        "user-1",
        manager,
        ws,
    )

    frame = manager.send_terminal.await_args.args[1]
    assert frame["type"] == "terminal_detach"
    assert frame["terminal_id"] == "t1"
    assert frame["remote"]["grant_jti"] == claims["jti"]
    assert session.grants == {}
    assert redis.hashes == {}
    assert session.listeners == {}


async def test_release_source_detaches_and_reclaims_everything(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    pubsub = redis.pubsubs[0]
    manager.send_terminal.reset_mock()

    await relay.release_source(ws)

    detach = manager.send_terminal.await_args.args[1]
    assert detach["type"] == "terminal_detach"
    assert detach["remote"]["grant_jti"] == claims["jti"]
    assert redis.hashes == {}
    assert id(ws) not in relay._sessions
    assert pubsub.closed is True
    manager.relay.send_command_to_runner.assert_awaited_with(
        TARGET_DEVICE, {"type": "terminal_unsubscribe", "runner_id": TARGET_DEVICE}
    )
    # A stranger socket is a no-op.
    await relay.release_source(_FakeWS())


# ---------------------------------------------------------------------------
# devices_ws wiring — the new family goes through the relay, the old path is
# byte-for-byte what it was
# ---------------------------------------------------------------------------


async def test_router_hands_source_frames_to_the_relay() -> None:
    manager = _manager()
    ws = _FakeWS()
    msg = {"type": "remote_terminal_attach", "request_id": "r", "grant": "x"}
    with patch.object(
        devices_ws.remote_terminal_relay, "handle_source_frame", AsyncMock()
    ) as h:
        await devices_ws._route_device_message(msg, "dev-1", "user-1", manager, 7, ws)
    h.assert_awaited_once_with(msg, "dev-1", "user-1", manager, ws)
    manager.send_terminal_response_to_mobiles.assert_not_called()


async def test_router_publishes_terminal_attached_on_the_remote_only_channel() -> None:
    manager = _manager()
    msg = {
        "type": "terminal_attached",
        "request_id": "r",
        "terminal_id": "t1",
        "data": "",
    }
    with patch.object(
        devices_ws.remote_terminal_relay, "publish_target_frame", AsyncMock()
    ) as p:
        await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)
    p.assert_awaited_once_with("dev-1", msg)
    # Mobile watchers never see it — the mobile path is unchanged.
    manager.send_terminal_response_to_mobiles.assert_not_called()


async def test_router_leaves_terminal_output_on_the_mobile_path_only() -> None:
    """``terminal_output`` is NOT handed to any device socket by the router.

    The existing publish to ``runner:terminal_response:{device}`` is the only
    thing that happens; the source's own listener filters that channel by
    terminal id. A terminal nobody attached therefore reaches no device.
    """
    manager = _manager()
    msg = {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="}
    with (
        patch.object(
            devices_ws.remote_terminal_relay, "handle_source_frame", AsyncMock()
        ) as h,
        patch.object(
            devices_ws.remote_terminal_relay, "publish_target_frame", AsyncMock()
        ) as p,
    ):
        await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)
    manager.send_terminal_response_to_mobiles.assert_awaited_once_with("dev-1", msg)
    h.assert_not_called()
    p.assert_not_called()


async def test_router_remote_marked_error_without_request_id_goes_remote_only() -> None:
    manager = _manager()
    msg = {
        "type": "error",
        "code": "attach_grant_expired",
        "remote": {"grant_jti": "j"},
    }
    with patch.object(
        devices_ws.remote_terminal_relay, "publish_target_frame", AsyncMock()
    ) as p:
        await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)
    p.assert_awaited_once_with("dev-1", msg)
    manager.send_terminal_response_to_mobiles.assert_not_called()


async def test_publish_target_frame_uses_the_remote_only_channel(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    msg = {"type": "terminal_attached", "request_id": "r", "terminal_id": "t1"}
    await relay.publish_target_frame(TARGET_DEVICE, msg)
    assert redis.published == [
        (f"runner:remote_terminal_response:{TARGET_DEVICE}", msg)
    ]


async def test_remote_only_target_frame_predicate() -> None:
    assert rtr.is_remote_only_target_frame({"type": "terminal_attached"}) is True
    assert rtr.is_remote_only_target_frame({"type": "error", "grant_jti": "j"}) is True
    assert (
        rtr.is_remote_only_target_frame({"type": "error", "remote": {"grant_jti": "j"}})
        is True
    )
    # Request-correlated errors keep their existing route (mobile channel).
    assert (
        rtr.is_remote_only_target_frame(
            {"type": "error", "request_id": "r", "remote": {}}
        )
        is False
    )
    # A generic error stays dropped, exactly as before.
    assert rtr.is_remote_only_target_frame({"type": "error", "message": "x"}) is False
    assert rtr.is_remote_only_target_frame({"type": "terminal_output"}) is False
