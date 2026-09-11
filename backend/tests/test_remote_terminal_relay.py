"""Tests for the device-authed remote-terminal origination door (D6, Phase 3b).

Plan ``2026-08-31-remote-session-tabs-in-runner-terminal``. What is pinned:

* a ``remote_terminal_attach`` whose grant is invalid / expired / minted for a
  different source device is refused with the typed code and NOTHING is
  forwarded to the target;
* a valid grant claims and registers the attachment (Redis, expiring with the
  grant) and forwards ``terminal_attach`` carrying the ``remote`` block under
  a request id the RELAY minted, never the source's own;
* a grant that NAMES a terminal binds nothing — no return route, no admitted
  input — until the target answers ``terminal_attached``;
* a grant is single use: a second presentation on the same or another socket
  is ``attach_grant_consumed``; two grants cannot hold one terminal
  (``attach_terminal_busy``); a released grant may be re-presented;
* the target's ``terminal_output`` for an attached terminal reaches the ONE
  attached source socket and no other, and stops once the grant expires;
  output for a terminal nobody attached is not handed to any device socket;
* RPC replies are correlated by the minted id AND the bound terminal, so two
  sources choosing equal request ids never cross-bind;
* a Redis failure is a typed ``attach_registry_unavailable`` on the socket,
  never an exception into the device loop;
* the terminal bind is ONE atomic round trip (a cancel mid-bind cannot leave
  a busy key with no TTL) and the release is compare-and-delete (dropping an
  expired attachment never deletes the key a newer grant has bound);
* an expired attachment the target never answered is reaped on the next frame
  either way, releasing the listener and the runner-side subscription;
* the listener task closes its own pubsub, unregisters itself AND evicts the
  attachments it routed for (``listener_lost``) when it dies;
* a target error naming a grant this socket does not hold is ignored — never
  re-keyed onto our grant through the terminal route;
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
from collections.abc import AsyncIterator, Callable
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
    """A pubsub whose ``listen()`` yields what the test pushes.

    ``push(frame)`` delivers one ``message`` to the listener; pushing an
    exception makes ``listen()`` raise it (the pubsub connection died).
    """

    def __init__(self) -> None:
        self.channels: list[str] = []
        self.closed = False
        self.close_count = 0
        self.queue: asyncio.Queue[Any] = asyncio.Queue()

    async def subscribe(self, *channels: str) -> None:
        self.channels.extend(channels)

    async def unsubscribe(self, *channels: str) -> None:
        self.channels = []

    async def close(self) -> None:
        self.closed = True
        self.close_count += 1

    def push(self, frame: dict[str, Any] | Exception) -> None:
        self.queue.put_nowait(frame)

    async def listen(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            item = await self.queue.get()
            if isinstance(item, Exception):
                raise item
            yield {"type": "message", "data": json.dumps(item).encode("utf-8")}


class _FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.strings: dict[str, str] = {}
        self.expiry: dict[str, int] = {}
        self.published: list[tuple[str, dict[str, Any]]] = []
        self.pubsubs: list[_FakePubSub] = []
        # Every command in arrival order, so a test can pin HOW MANY round
        # trips a path took, not only what the store held afterwards.
        self.commands: list[tuple[Any, ...]] = []

    async def set(
        self,
        key: str,
        value: str,
        *,
        nx: bool = False,
        exat: int | None = None,
    ) -> bool | None:
        self.commands.append(("set", key))
        if nx and (key in self.strings or key in self.hashes):
            return None
        self.strings[key] = value
        if exat is not None:
            self.expiry[key] = exat
        return True

    async def hset(self, key: str, mapping: dict[str, str]) -> int:
        self.commands.append(("hset", key))
        self.hashes.setdefault(key, {}).update(mapping)
        return len(mapping)

    async def hget(self, key: str, field: str) -> str | None:
        self.commands.append(("hget", key))
        return self.hashes.get(key, {}).get(field)

    async def expireat(self, key: str, when: int) -> bool:
        self.commands.append(("expireat", key))
        self.expiry[key] = when
        return True

    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> int:
        """The two module scripts, with their server-side semantics."""
        keys, args = keys_and_args[:numkeys], keys_and_args[numkeys:]
        self.commands.append(("eval", script, *keys, *args))
        (key,) = keys
        held = self.hashes.get(key, {}).get("grant_jti")
        if script == rtr.BIND_TERMINAL_SCRIPT:
            source, jti, exp = args
            if held is not None and held != jti:
                return 0
            self.hashes.setdefault(key, {}).update(
                {"source_device_id": source, "grant_jti": jti, "exp": exp}
            )
            self.expiry[key] = int(exp)
            return 1
        if script == rtr.RELEASE_TERMINAL_SCRIPT:
            (jti,) = args
            if held != jti:
                return 0
            self.hashes.pop(key, None)
            self.expiry.pop(key, None)
            return 1
        raise NotImplementedError(script)

    def evals(self, script: str) -> list[tuple[Any, ...]]:
        return [c for c in self.commands if c[0] == "eval" and c[1] == script]

    async def delete(self, *keys: str) -> int:
        self.commands.append(("delete", *keys))
        n = 0
        for key in keys:
            if self.hashes.pop(key, None) is not None:
                n += 1
            if self.strings.pop(key, None) is not None:
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

    def empty(self) -> bool:
        return not self.hashes and not self.strings


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
            manager,
            ws,
        )


def _forwarded_attach(manager: Any) -> dict[str, Any]:
    """The last ``terminal_attach`` frame the relay forwarded to the target."""
    frames = [
        c.args[1]
        for c in manager.send_terminal.await_args_list
        if c.args[1].get("type") == "terminal_attach"
    ]
    assert frames, manager.send_terminal.await_args_list
    return frames[-1]


async def _attached(
    relay: RemoteTerminalRelay,
    ws: _FakeWS,
    manager: Any,
    *,
    terminal_id: str = "t1",
    request_id: str = "req-attach-1",
    claims: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Attach with a valid grant and let the target confirm ``terminal_id``.

    The target answers under the request id the RELAY put on the wire, which
    is read back off the forwarded frame — never the source's own.
    """
    claims = _claims() if claims is None else claims
    await _attach(relay, ws, manager, claims, request_id=request_id)
    assert ws.of_type("error") == [], ws.sent
    minted = _forwarded_attach(manager)["request_id"]
    session = relay._sessions[id(ws)]
    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_attached",
            "request_id": minted,
            "terminal_id": terminal_id,
            "data": "cmluZw==",
            "start_offset": 0,
            "total_bytes_produced": 4,
        },
    )
    assert routed is True
    return claims


async def _send(
    relay: RemoteTerminalRelay, ws: _FakeWS, manager: Any, msg: dict[str, Any]
) -> None:
    await relay.handle_source_frame(msg, SOURCE_DEVICE, manager, ws)


async def _settle(done: Callable[[], bool] | None = None) -> None:
    """Spin the loop until ``done()`` (or a bounded number of hops)."""
    for _ in range(200):
        await asyncio.sleep(0)
        if done is not None and done():
            return


@pytest.fixture
def redis() -> _FakeRedis:
    return _FakeRedis()


@pytest.fixture
def relay(redis: _FakeRedis) -> RemoteTerminalRelay:
    return RemoteTerminalRelay(redis_client=redis)


# ---------------------------------------------------------------------------
# Grant verification refusals — nothing is forwarded
# ---------------------------------------------------------------------------


# Each case is a FACTORY, not a value. `_claims()` stamps `exp = now + 900`, and
# a value built here is built at COLLECTION time — so on a full run (this suite
# takes over an hour) every claim in this list is already expired by the time
# the case executes, and the expiry check, which runs first, answers
# `attach_grant_expired` for cases asserting a different code. That is exactly
# how `[verifier_result5-attach_grant_invalid]` failed on CI while passing
# locally. Building inside the test keeps each claim fresh.
@pytest.mark.parametrize(
    ("make_verifier_result", "expected_code"),
    [
        (
            lambda: CoordTokenInvalidError("token verification failed: bad signature"),
            "attach_grant_invalid",
        ),
        (lambda: CoordTokenExpiredError("token expired"), "attach_grant_expired"),
        (lambda: _claims(exp=int(time.time()) - 5), "attach_grant_expired"),
        (lambda: _claims(device_id=str(uuid4())), "attach_grant_wrong_source"),
        (lambda: _claims(sub_type="device"), "attach_grant_invalid"),
        (
            lambda: _claims(attach={"target_device_id": "not-a-uuid"}),
            "attach_grant_invalid",
        ),
    ],
)
async def test_attach_refused_with_typed_code_and_nothing_forwarded(
    relay: RemoteTerminalRelay,
    redis: _FakeRedis,
    make_verifier_result: Any,
    expected_code: str,
) -> None:
    ws = _FakeWS()
    manager = _manager()

    await _attach(relay, ws, manager, make_verifier_result())

    errors = ws.of_type("error")
    assert len(errors) == 1, ws.sent
    assert errors[0]["code"] == expected_code
    assert errors[0]["request_id"] == "req-attach-1"
    manager.send_terminal.assert_not_called()
    manager.relay.send_command_to_runner.assert_not_called()
    assert redis.empty()
    assert redis.pubsubs == []


async def test_attach_grant_missing_is_invalid(relay: RemoteTerminalRelay) -> None:
    ws = _FakeWS()
    manager = _manager()
    await _send(
        relay,
        ws,
        manager,
        {"type": "remote_terminal_attach", "request_id": "r", "cols": 1, "rows": 1},
    )
    assert ws.of_type("error")[0]["code"] == "attach_grant_invalid"
    manager.send_terminal.assert_not_called()


# ---------------------------------------------------------------------------
# Valid grant — claimed, registered and forwarded with the remote block
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
    # The id on the wire is the relay's, not the source's: the target's reply
    # channel is shared by every watcher of the target.
    assert isinstance(frame["request_id"], str)
    assert frame["request_id"] != "req-attach-1"
    assert len(frame["request_id"]) == 32
    assert (frame["cols"], frame["rows"]) == (120, 40)
    assert frame["remote"] == {
        "source_device_id": SOURCE_DEVICE,
        "grant_jti": claims["jti"],
        "session_id": TARGET_SESSION,
    }

    # Registry: the claim and the grant record exist and expire with the grant.
    claim = rtr.claim_key(claims["jti"])
    assert redis.strings[claim] == SOURCE_DEVICE
    assert redis.expiry[claim] == claims["exp"]
    key = rtr.grant_key(claims["jti"])
    assert redis.hashes[key]["source_device_id"] == SOURCE_DEVICE
    assert redis.hashes[key]["target_device_id"] == TARGET_DEVICE
    assert redis.hashes[key]["terminal_id"] == ""
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
    assert redis.empty()
    assert relay._sessions[id(ws)].grants == {}
    assert relay._sessions[id(ws)].listeners == {}


async def test_grant_naming_a_terminal_binds_nothing_until_terminal_attached(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """A grant's ``terminal_id`` claim is a hint to the target, not a binding.

    Before the target answers ``terminal_attached`` there is no return route
    for the named terminal and no ``remote_terminal_input`` is admitted —
    otherwise the source could drive a terminal the target never accepted.
    """
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
    session = relay._sessions[id(ws)]
    att = session.grants[claims["jti"]]

    # Forwarded as a hint...
    frame = _forwarded_attach(manager)
    assert frame["remote"]["terminal_id"] == "t-pinned"
    # ...but bound nowhere.
    assert att.requested_terminal_id == "t-pinned"
    assert att.terminal_id is None
    assert att.attached is False
    assert rtr.terminal_key(TARGET_DEVICE, "t-pinned") not in redis.hashes
    assert redis.hashes[rtr.grant_key(claims["jti"])]["terminal_id"] == ""

    # No return route yet.
    before = len(ws.sent)
    output = {"type": "terminal_output", "terminal_id": "t-pinned", "data": "aGk="}
    assert await relay.route_target_frame(session, TARGET_DEVICE, output) is False
    assert ws.sent[before:] == []

    # No input admitted yet.
    manager.send_terminal.reset_mock()
    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t-pinned",
            "data": "bHM=",
        },
    )
    assert ws.of_type("error")[-1]["code"] == "attach_not_registered"
    manager.send_terminal.assert_not_called()

    # The target's terminal_attached is what binds.
    assert (
        await relay.route_target_frame(
            session,
            TARGET_DEVICE,
            {
                "type": "terminal_attached",
                "request_id": frame["request_id"],
                "terminal_id": "t-pinned",
                "data": "",
            },
        )
        is True
    )
    assert att.terminal_id == "t-pinned"
    assert att.attached is True
    route = redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t-pinned")]
    assert route == {
        "source_device_id": SOURCE_DEVICE,
        "grant_jti": claims["jti"],
        "exp": str(claims["exp"]),
    }
    assert await relay.route_target_frame(session, TARGET_DEVICE, output) is True
    assert ws.of_type("remote_terminal_output")[-1]["data"] == "aGk="
    await relay.release_source(ws)


# ---------------------------------------------------------------------------
# The grant record is load-bearing: single use, one terminal per grant
# ---------------------------------------------------------------------------


async def test_second_presentation_on_same_socket_is_consumed(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)

    await _attach(relay, ws, manager, claims, request_id="req-attach-2")

    errors = ws.of_type("error")
    assert len(errors) == 1
    assert errors[0]["code"] == "attach_grant_consumed"
    assert errors[0]["request_id"] == "req-attach-2"
    assert errors[0]["grant_jti"] == claims["jti"]
    # The first attachment stands, and only one attach reached the target.
    assert list(relay._sessions[id(ws)].grants) == [claims["jti"]]
    assert manager.send_terminal.await_count == 1
    assert redis.strings[rtr.claim_key(claims["jti"])] == SOURCE_DEVICE
    await relay.release_source(ws)


async def test_second_socket_presenting_the_same_grant_is_consumed(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws_a = _FakeWS()
    ws_b = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws_a, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await _attach(relay, ws_b, manager, claims, request_id="req-b")

    assert ws_b.of_type("error") == [
        {
            "type": "error",
            "code": "attach_grant_consumed",
            "message": "grant is already held by a live attachment",
            "request_id": "req-b",
            "grant_jti": claims["jti"],
        }
    ]
    manager.send_terminal.assert_not_called()
    assert relay._sessions[id(ws_b)].grants == {}
    assert relay._sessions[id(ws_b)].listeners == {}
    # The first socket's route is intact.
    assert (
        redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t1")]["grant_jti"]
        == (claims["jti"])
    )
    session_a = relay._sessions[id(ws_a)]
    output = {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="}
    assert await relay.route_target_frame(session_a, TARGET_DEVICE, output) is True

    # Once the holder releases, the grant may be presented again (a fast
    # reconnect); a presentation that races the teardown reads consumed.
    await relay.release_source(ws_a)
    assert redis.empty()
    await _attach(relay, ws_b, manager, claims, request_id="req-b2")
    assert [e["request_id"] for e in ws_b.of_type("error")] == ["req-b"]
    assert claims["jti"] in relay._sessions[id(ws_b)].grants
    await relay.release_source(ws_b)


async def test_two_grants_cannot_hold_one_terminal(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws_a = _FakeWS()
    ws_b = _FakeWS()
    manager = _manager()
    claims_a = await _attached(relay, ws_a, manager, terminal_id="t1", request_id="ra")
    claims_b = _claims()
    await _attach(relay, ws_b, manager, claims_b, request_id="rb")
    minted_b = _forwarded_attach(manager)["request_id"]
    session_b = relay._sessions[id(ws_b)]
    manager.send_terminal.reset_mock()

    # The target binds B's grant to the terminal A already holds.
    routed = await relay.route_target_frame(
        session_b,
        TARGET_DEVICE,
        {"type": "terminal_attached", "request_id": minted_b, "terminal_id": "t1"},
    )

    assert routed is True
    assert ws_b.of_type("remote_terminal_attached") == []
    assert ws_b.of_type("error") == [
        {
            "type": "error",
            "code": "attach_terminal_busy",
            "message": "terminal is already held by another attachment",
            "request_id": "rb",
            "grant_jti": claims_b["jti"],
            "terminal_id": "t1",
        }
    ]
    # The target is told to unbind B, and B's attachment is gone...
    detach = manager.send_terminal.await_args.args[1]
    assert detach["type"] == "terminal_detach"
    assert detach["terminal_id"] == "t1"
    assert detach["remote"]["grant_jti"] == claims_b["jti"]
    assert session_b.grants == {}
    assert rtr.grant_key(claims_b["jti"]) not in redis.hashes
    # ...while A's route is exactly what it was.
    assert redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t1")] == {
        "source_device_id": SOURCE_DEVICE,
        "grant_jti": claims_a["jti"],
        "exp": str(claims_a["exp"]),
    }
    session_a = relay._sessions[id(ws_a)]
    output = {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="}
    assert await relay.route_target_frame(session_a, TARGET_DEVICE, output) is True
    await relay.release_source(ws_a)
    await relay.release_source(ws_b)


async def test_lazily_dropped_expired_attachment_does_not_release_the_new_holder(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """Dropping A after B has bound the same terminal must leave B's key alone.

    A's grant expires; its Redis keys expire with it, and B binds the now-free
    terminal. A is still in memory on its socket until something touches it —
    and that lazy drop deleted ``terminal_key(target, t1)`` unconditionally,
    which was B's freshly-bound key. The release is compare-and-delete.
    """
    ws_a = _FakeWS()
    ws_b = _FakeWS()
    manager = _manager()
    claims_a = await _attached(relay, ws_a, manager, terminal_id="t1", request_id="ra")
    session_a = relay._sessions[id(ws_a)]
    att_a = session_a.grants[claims_a["jti"]]
    key = rtr.terminal_key(TARGET_DEVICE, "t1")

    # A's grant runs out; Redis reaps A's keys (TTL) before anything on A's
    # socket notices.
    att_a.exp = int(time.time()) - 1
    await redis.delete(
        rtr.claim_key(claims_a["jti"]), rtr.grant_key(claims_a["jti"]), key
    )
    claims_b = await _attached(relay, ws_b, manager, terminal_id="t1", request_id="rb")
    assert redis.hashes[key]["grant_jti"] == claims_b["jti"]

    # Now A is touched and dropped.
    await relay.route_target_frame(
        session_a,
        TARGET_DEVICE,
        {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="},
    )

    assert session_a.grants == {}
    # B still holds the terminal — in Redis and on its socket.
    assert redis.hashes[key]["grant_jti"] == claims_b["jti"]
    assert redis.expiry[key] == claims_b["exp"]
    session_b = relay._sessions[id(ws_b)]
    output = {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="}
    assert await relay.route_target_frame(session_b, TARGET_DEVICE, output) is True
    await relay.release_source(ws_a)
    await relay.release_source(ws_b)


async def test_terminal_bind_is_one_atomic_round_trip(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """The bind runs inside the listener task, which teardown cancels.

    Four commands (HSETNX, HGET, HSET, EXPIREAT) could be cut between the
    claim and the TTL, leaving a busy terminal key that never expires. One
    server-side script cannot: the key is written with its TTL or not at all.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    key = rtr.terminal_key(TARGET_DEVICE, "t1")

    touches = [c for c in redis.commands if key in c]
    assert touches == [
        (
            "eval",
            rtr.BIND_TERMINAL_SCRIPT,
            key,
            SOURCE_DEVICE,
            claims["jti"],
            str(claims["exp"]),
        )
    ]
    assert redis.expiry[key] == claims["exp"]
    await relay.release_source(ws)
    # ...and the release is the compare-and-delete script, not a bare DEL.
    assert [c for c in redis.commands if key in c][1:] == [
        ("eval", rtr.RELEASE_TERMINAL_SCRIPT, key, claims["jti"])
    ]
    assert key not in redis.hashes and key not in redis.expiry


# ---------------------------------------------------------------------------
# Registry failure — a typed refusal on the socket, never an exception
# ---------------------------------------------------------------------------


class _BrokenRedis(_FakeRedis):
    def __init__(self, *, fail: str) -> None:
        super().__init__()
        self.fail = fail

    async def set(self, key: str, value: str, **kwargs: Any) -> bool | None:
        if self.fail == "set":
            raise ConnectionError("redis down")
        return await super().set(key, value, **kwargs)

    async def hset(self, key: str, mapping: dict[str, str]) -> int:
        if self.fail == "hset":
            raise ConnectionError("redis down")
        return await super().hset(key, mapping)

    def pubsub(self) -> _FakePubSub:
        if self.fail == "pubsub":
            raise ConnectionError("redis down")
        return super().pubsub()


@pytest.mark.parametrize("fail", ["set", "hset", "pubsub"])
async def test_registry_failure_is_a_typed_refusal_not_an_exception(
    fail: str,
) -> None:
    redis = _BrokenRedis(fail=fail)
    relay = RemoteTerminalRelay(redis_client=redis)
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()

    # Must not raise — an exception here ends the device socket's loop.
    await _attach(relay, ws, manager, claims)

    assert ws.of_type("error") == [
        {
            "type": "error",
            "code": "attach_registry_unavailable",
            "message": "attachment registry temporarily unavailable",
            "request_id": "req-attach-1",
            "grant_jti": claims["jti"],
        }
    ]
    manager.send_terminal.assert_not_called()
    session = relay._sessions[id(ws)]
    assert session.grants == {}
    assert session.pending_attach == {}
    assert session.listeners == {}
    # Nothing half-registered survives (the claim is rolled back when it
    # landed before the failure).
    assert redis.strings == {}


async def test_publish_target_frame_survives_a_dead_redis() -> None:
    relay = RemoteTerminalRelay(redis_client=None)
    with patch.object(rtr, "get_redis", AsyncMock(side_effect=ConnectionError("x"))):
        await relay.publish_target_frame(TARGET_DEVICE, {"type": "terminal_attached"})


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
    # The source gets ITS request id back, not the minted one.
    assert attached == [
        {
            "type": "remote_terminal_attached",
            "request_id": "req-attach-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "buffer": "cmluZw==",
            "start_offset": 0,
            "ring_start_offset": None,
            "total_bytes_produced": 4,
        }
    ]
    route = redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t1")]
    assert route["grant_jti"] == claims["jti"]
    assert route["source_device_id"] == SOURCE_DEVICE
    assert redis.expiry[rtr.terminal_key(TARGET_DEVICE, "t1")] == claims["exp"]
    assert redis.hashes[rtr.grant_key(claims["jti"])]["terminal_id"] == "t1"
    assert relay._sessions[id(ws)].pending_attach == {}
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


async def test_output_stops_once_the_grant_expires(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    att = session.grants[claims["jti"]]
    frame = {"type": "terminal_output", "terminal_id": "t1", "data": "aGk="}
    assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is True
    before = len(ws.sent)

    # The grant runs out while the terminal is still producing output.
    att.exp = int(time.time()) - 1

    assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is False
    # No more output — the one frame after expiry is the expiry notice itself.
    assert ws.sent[before:] == [
        {
            "type": "remote_terminal_error",
            "grant_jti": claims["jti"],
            "code": "attach_grant_expired",
            "message": "grant expired",
            "terminal_id": "t1",
        }
    ]
    # The dead attachment is reclaimed, not left routing until the socket dies.
    assert session.grants == {}
    assert redis.empty()
    assert session.listeners == {}
    await relay.release_source(ws)


async def test_expired_unanswered_attach_is_reaped_on_the_next_unrelated_frame(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """An attach the target never answers must not hold the listener forever.

    Nothing ever touches such an attachment (no output names its terminal, no
    input is admitted for it), so without a sweep it would keep the per-target
    pubsub listener and the runner's ``terminal_subscribe`` alive for the
    socket's whole lifetime — days.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    session = relay._sessions[id(ws)]
    att = session.grants[claims["jti"]]
    assert att.attached is False
    assert TARGET_DEVICE in session.listeners
    pubsub = redis.pubsubs[0]
    manager.send_terminal.reset_mock()
    manager.relay.send_command_to_runner.reset_mock()

    att.exp = int(time.time()) - 1
    # An unrelated source frame — a different (unknown) grant.
    await _send(
        relay,
        ws,
        manager,
        {"type": "remote_terminal_input", "grant_jti": "other", "data": "x"},
    )

    assert session.grants == {}
    assert session.pending_attach == {}
    assert session.listeners == {}
    assert redis.empty()
    assert pubsub.close_count == 1
    manager.relay.send_command_to_runner.assert_awaited_with(
        TARGET_DEVICE, {"type": "terminal_unsubscribe", "runner_id": TARGET_DEVICE}
    )
    # The target is told to unbind the grant; the source learns the attach it
    # is still waiting on is over, under the attach's own request id.
    detach = manager.send_terminal.await_args.args[1]
    assert detach["type"] == "terminal_detach"
    assert detach["remote"]["grant_jti"] == claims["jti"]
    assert ws.of_type("remote_terminal_error") == [
        {
            "type": "remote_terminal_error",
            "grant_jti": claims["jti"],
            "code": "attach_grant_expired",
            "message": "grant expired",
            "request_id": "req-attach-1",
        }
    ]
    # The frame itself is then refused on its own merits.
    assert [e["code"] for e in ws.of_type("error")] == ["attach_not_registered"]
    await relay.release_source(ws)


async def test_expired_attach_is_reaped_on_the_next_target_frame(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """The same sweep runs on the return path — a frame for another terminal."""
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    session = relay._sessions[id(ws)]
    session.grants[claims["jti"]].exp = int(time.time()) - 1

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {"type": "terminal_output", "terminal_id": "t-other", "data": "no"},
    )

    assert routed is False
    assert session.grants == {}
    assert session.listeners == {}
    assert redis.empty()
    assert [e["code"] for e in ws.of_type("remote_terminal_error")] == [
        "attach_grant_expired"
    ]
    await relay.release_source(ws)


async def test_frame_naming_the_expired_grant_is_refused_as_expired(
    relay: RemoteTerminalRelay,
) -> None:
    """The grant a frame NAMES is left to ``_authorize``: one typed refusal,
    correlated to the frame, rather than a sweep notice plus not_registered."""
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    session.grants[claims["jti"]].exp = int(time.time()) - 1

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_input",
            "request_id": "in-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "x",
        },
    )

    assert ws.of_type("remote_terminal_error") == []
    assert ws.of_type("error") == [
        {
            "type": "error",
            "code": "attach_grant_expired",
            "message": "grant expired",
            "request_id": "in-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
        }
    ]
    assert session.grants == {}
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
    assert redis.empty()
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
    minted = _forwarded_attach(manager)["request_id"]
    session = relay._sessions[id(ws)]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "error",
            "request_id": minted,
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
    assert redis.empty()


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
        # A MOBILE watcher's own request-correlated error for OUR terminal:
        # not remote-marked, so never handed to the source.
        {
            "type": "error",
            "request_id": "mobile-1",
            "terminal_id": "t1",
            "message": "x",
        },
        {"type": "error", "message": "generic"},
        {"type": "terminal_attached", "request_id": "not-mine", "terminal_id": "t9"},
        # The source's OWN attach request id, replayed by someone else on the
        # channel: it was never on the wire, so it correlates nothing.
        {
            "type": "terminal_attached",
            "request_id": "req-attach-1",
            "terminal_id": "t9",
        },
    ):
        assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is False
    assert ws.sent[before:] == []
    await relay.release_source(ws)


async def test_remote_marked_error_falls_back_to_the_terminal_route(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "error",
            "terminal_id": "t1",
            "remote": {"source_device_id": SOURCE_DEVICE},
            "code": "attach_terminal_mismatch",
            "message": "wrong terminal",
        },
    )

    assert routed is True
    assert ws.of_type("remote_terminal_error") == [
        {
            "type": "remote_terminal_error",
            "grant_jti": claims["jti"],
            "code": "attach_terminal_mismatch",
            "message": "wrong terminal",
            "terminal_id": "t1",
        }
    ]
    await relay.release_source(ws)


async def test_remote_marked_error_naming_a_foreign_grant_is_ignored(
    relay: RemoteTerminalRelay,
) -> None:
    """A jti hint that matches no grant here is another source's refusal.

    Falling back to the terminal route would deliver that refusal to us under
    OUR grant's jti. Only a frame carrying no jti at all may use the terminal.
    """
    ws = _FakeWS()
    manager = _manager()
    await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]

    for frame in (
        {
            "type": "error",
            "terminal_id": "t1",
            "remote": {"source_device_id": SOURCE_DEVICE, "grant_jti": "not-ours"},
            "code": "attach_terminal_mismatch",
            "message": "wrong terminal",
        },
        {
            "type": "error",
            "terminal_id": "t1",
            "grant_jti": "not-ours-either",
            "code": "attach_terminal_mismatch",
            "message": "wrong terminal",
        },
    ):
        assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is False

    assert ws.of_type("remote_terminal_error") == []
    await relay.release_source(ws)


# ---------------------------------------------------------------------------
# Post-attach frames — only for a registered, bound grant on this socket
# ---------------------------------------------------------------------------


async def test_input_for_unregistered_grant_is_refused(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_input",
            "grant_jti": str(uuid4()),
            "terminal_id": "t1",
            "data": "bHM=",
        },
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

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "bHM=",
        },
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

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "bHM=",
        },
    )
    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_resize",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "cols": 80,
            "rows": 24,
        },
    )
    # Wrong terminal for this grant: refused, not forwarded.
    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_input",
            "grant_jti": claims["jti"],
            "terminal_id": "t-other",
            "data": "bHM=",
        },
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


async def test_buffer_roundtrip_is_correlated_by_minted_request_id(
    relay: RemoteTerminalRelay,
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_buffer",
            "request_id": "buf-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "from_offset": 10,
        },
    )
    frame = manager.send_terminal.await_args.args[1]
    assert frame["type"] == "terminal_buffer"
    minted = frame["request_id"]
    assert isinstance(minted, str) and minted != "buf-1"
    assert (frame["terminal_id"], frame["from_offset"]) == ("t1", 10)
    assert frame["remote"]["grant_jti"] == claims["jti"]
    assert session.pending_buffer == {minted: ("buf-1", claims["jti"])}

    # The source's own id is not on the wire, so a reply under it is nobody's.
    assert (
        await relay.route_target_frame(
            session,
            TARGET_DEVICE,
            {"type": "terminal_buffer_response", "request_id": "buf-1", "data": "x"},
        )
        is False
    )
    # A reply under the minted id for a terminal this grant does not hold is
    # dropped, not handed over.
    assert (
        await relay.route_target_frame(
            session,
            TARGET_DEVICE,
            {
                "type": "terminal_buffer_response",
                "request_id": minted,
                "terminal_id": "t-other",
                "data": "x",
            },
        )
        is False
    )
    assert ws.of_type("remote_terminal_buffer") == []

    # Re-issue (the mismatch consumed the pending entry) and answer properly.
    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_buffer",
            "request_id": "buf-1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "from_offset": 10,
        },
    )
    minted = manager.send_terminal.await_args.args[1]["request_id"]
    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_buffer_response",
            "request_id": minted,
            "terminal_id": "t1",
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
            "ring_start_offset": None,
            "total_bytes_produced": 13,
        }
    ]
    assert session.pending_buffer == {}
    await relay.release_source(ws)


async def test_two_sources_with_equal_request_ids_do_not_cross_bind(
    relay: RemoteTerminalRelay,
) -> None:
    ws_a = _FakeWS()
    ws_b = _FakeWS()
    manager = _manager()
    claims_a = await _attached(relay, ws_a, manager, terminal_id="t1", request_id="r")
    claims_b = await _attached(relay, ws_b, manager, terminal_id="t2", request_id="r")
    session_a = relay._sessions[id(ws_a)]
    session_b = relay._sessions[id(ws_b)]
    manager.send_terminal.reset_mock()

    for ws, claims, terminal in ((ws_a, claims_a, "t1"), (ws_b, claims_b, "t2")):
        await _send(
            relay,
            ws,
            manager,
            {
                "type": "remote_terminal_buffer",
                "request_id": "buf-1",
                "grant_jti": claims["jti"],
                "terminal_id": terminal,
            },
        )
    minted_a = manager.send_terminal.await_args_list[0].args[1]["request_id"]
    minted_b = manager.send_terminal.await_args_list[1].args[1]["request_id"]
    assert minted_a != minted_b

    # The target answers A's request. Both listeners see it; only A delivers.
    reply = {
        "type": "terminal_buffer_response",
        "request_id": minted_a,
        "terminal_id": "t1",
        "data": "QQ==",
    }
    assert await relay.route_target_frame(session_a, TARGET_DEVICE, reply) is True
    assert await relay.route_target_frame(session_b, TARGET_DEVICE, reply) is False
    assert [f["request_id"] for f in ws_a.of_type("remote_terminal_buffer")] == [
        "buf-1"
    ]
    assert ws_a.of_type("remote_terminal_buffer")[0]["grant_jti"] == claims_a["jti"]
    assert ws_b.of_type("remote_terminal_buffer") == []
    assert session_b.pending_buffer == {minted_b: ("buf-1", claims_b["jti"])}
    await relay.release_source(ws_a)
    await relay.release_source(ws_b)


async def test_detach_forwards_and_drops(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_detach",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
        },
    )

    frame = manager.send_terminal.await_args.args[1]
    assert frame["type"] == "terminal_detach"
    assert frame["terminal_id"] == "t1"
    assert frame["remote"]["grant_jti"] == claims["jti"]
    assert session.grants == {}
    assert redis.empty()
    assert session.listeners == {}


async def test_detach_before_terminal_bound_releases_the_grant(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """A source may give up an attach the target never answered."""
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    session = relay._sessions[id(ws)]
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {"type": "remote_terminal_detach", "grant_jti": claims["jti"]},
    )

    assert ws.of_type("error") == []
    frame = manager.send_terminal.await_args.args[1]
    assert frame["type"] == "terminal_detach"
    assert frame["terminal_id"] is None
    assert frame["remote"]["grant_jti"] == claims["jti"]
    assert session.grants == {}
    assert session.pending_attach == {}
    assert redis.empty()
    assert session.listeners == {}
    # The grant is free again.
    await _attach(relay, ws, manager, claims, request_id="req-attach-2")
    assert ws.of_type("error") == []
    await relay.release_source(ws)


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
    assert redis.empty()
    assert id(ws) not in relay._sessions
    assert pubsub.closed is True
    assert pubsub.close_count == 1
    manager.relay.send_command_to_runner.assert_awaited_with(
        TARGET_DEVICE, {"type": "terminal_unsubscribe", "runner_id": TARGET_DEVICE}
    )
    # A stranger socket is a no-op.
    await relay.release_source(_FakeWS())


# ---------------------------------------------------------------------------
# Listener task — frames off the pubsub reach the source; a dying listener
# cleans up after itself
# ---------------------------------------------------------------------------


async def test_listener_routes_pubsub_frames_to_the_source(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    pubsub = redis.pubsubs[0]
    minted = _forwarded_attach(manager)["request_id"]

    pubsub.push(
        {"type": "terminal_attached", "request_id": minted, "terminal_id": "t1"}
    )
    pubsub.push({"type": "terminal_output", "terminal_id": "t1", "data": "aGk="})
    pubsub.push({"type": "terminal_output", "terminal_id": "t-other", "data": "no"})
    await _settle(lambda: len(ws.sent) >= 2)

    assert [f["type"] for f in ws.sent] == [
        "remote_terminal_attached",
        "remote_terminal_output",
    ]
    assert ws.sent[0]["request_id"] == "req-attach-1"
    assert ws.sent[1]["data"] == "aGk="
    assert (
        redis.hashes[rtr.terminal_key(TARGET_DEVICE, "t1")]["grant_jti"]
        == (claims["jti"])
    )
    await relay.release_source(ws)
    assert pubsub.close_count == 1


async def test_dying_listener_closes_its_pubsub_and_unregisters(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    pubsub = redis.pubsubs[0]
    (_, task) = session.listeners[TARGET_DEVICE]
    manager.send_terminal.reset_mock()
    manager.relay.send_command_to_runner.reset_mock()

    pubsub.push(ConnectionError("pubsub connection lost"))
    await _settle(task.done)

    assert task.done()
    assert task.exception() is None  # swallowed and logged, not re-raised
    assert pubsub.closed is True
    assert session.listeners == {}
    # The route is dead, so the attachment it carried does not linger: the
    # source is told, the target is told to unbind, the registry is released
    # and the runner-side subscribe this listener opened is matched.
    assert ws.of_type("remote_terminal_error") == [
        {
            "type": "remote_terminal_error",
            "grant_jti": claims["jti"],
            "code": "listener_lost",
            "message": "return route to the target was lost",
            "terminal_id": "t1",
        }
    ]
    assert session.grants == {}
    assert redis.empty()
    detach = manager.send_terminal.await_args.args[1]
    assert detach["type"] == "terminal_detach"
    assert detach["remote"]["grant_jti"] == claims["jti"]
    manager.relay.send_command_to_runner.assert_awaited_once_with(
        TARGET_DEVICE, {"type": "terminal_unsubscribe", "runner_id": TARGET_DEVICE}
    )
    # A later attach to the same target gets a fresh listener.
    await _attached(relay, ws, manager, terminal_id="t2", request_id="r2")
    assert TARGET_DEVICE in session.listeners
    assert len(redis.pubsubs) == 2
    await relay.release_source(ws)
    assert pubsub.close_count == 1
    assert redis.pubsubs[1].close_count == 1


async def test_listener_stopped_from_inside_itself_closes_once(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """``terminal_exit`` on the last attachment stops the listener routing it."""
    ws = _FakeWS()
    manager = _manager()
    await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    pubsub = redis.pubsubs[0]
    (_, task) = session.listeners[TARGET_DEVICE]

    pubsub.push({"type": "terminal_exit", "terminal_id": "t1", "exit_code": 0})
    await _settle(lambda: pubsub.close_count > 0 and not relay._background)

    assert ws.of_type("remote_terminal_exit")[0]["exit_code"] == 0
    assert task.done() and task.cancelled()
    assert session.listeners == {}
    assert pubsub.close_count == 1
    manager.relay.send_command_to_runner.assert_awaited_with(
        TARGET_DEVICE, {"type": "terminal_unsubscribe", "runner_id": TARGET_DEVICE}
    )
    await relay.release_source(ws)


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
    h.assert_awaited_once_with(msg, "dev-1", manager, ws)
    manager.send_terminal_response_to_mobiles.assert_not_called()


async def test_router_survives_a_relay_exception() -> None:
    """A defect in the relay must not end the SOURCE device's socket loop."""
    manager = _manager()
    ws = _FakeWS()
    msg = {"type": "remote_terminal_attach", "request_id": "r", "grant": "x"}
    with patch.object(
        devices_ws.remote_terminal_relay,
        "handle_source_frame",
        AsyncMock(side_effect=RuntimeError("boom")),
    ):
        await devices_ws._route_device_message(msg, "dev-1", "user-1", manager, 7, ws)
    with patch.object(
        devices_ws.remote_terminal_relay,
        "publish_target_frame",
        AsyncMock(side_effect=RuntimeError("boom")),
    ):
        await devices_ws._route_device_message(
            {"type": "terminal_attached", "request_id": "r"}, "dev-1", "user-1", manager
        )


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


# ---------------------------------------------------------------------------
# Phase 5 backpressure + reattach offset — the two translations the runner side
# documented as OWED by the relay and covered only defensively on its end.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flow_frame_is_admitted_and_retyped_to_terminal_flow(
    relay: RemoteTerminalRelay,
) -> None:
    """A source's `remote_terminal_flow` must REACH the target as `terminal_flow`.

    Fails on the unfixed relay for the reason that matters: the frame was not in
    `SOURCE_FRAME_TYPES` at all, so it was refused as an unknown source type and
    the target never learned to withhold output. Backpressure existed on the
    source's `EmissionGate` and stopped at the wire.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_flow",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "paused": True,
        },
    )

    assert manager.send_terminal.await_count == 1
    frame = manager.send_terminal.await_args_list[0].args[1]
    assert frame["type"] == "terminal_flow"
    assert frame["terminal_id"] == "t1"
    assert frame["paused"] is True
    # The target refuses a flow frame carrying no remote block
    # (`remote_block_required`), so the block is not optional here.
    assert frame["remote"]["grant_jti"] == claims["jti"]
    assert frame["remote"]["source_device_id"] == SOURCE_DEVICE


@pytest.mark.asyncio
async def test_flow_resume_is_forwarded_verbatim(relay: RemoteTerminalRelay) -> None:
    """`paused: false` must travel too — a resume that never lands is a pane
    silenced forever, which is strictly worse than no backpressure at all."""
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_flow",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "paused": False,
        },
    )

    frame = manager.send_terminal.await_args_list[0].args[1]
    assert frame["type"] == "terminal_flow"
    assert frame["paused"] is False


@pytest.mark.asyncio
async def test_flow_for_a_terminal_this_grant_does_not_hold_is_refused(
    relay: RemoteTerminalRelay,
) -> None:
    """Gated exactly like `terminal_input`. Without this, one attachment could
    pause a pane belonging to another."""
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_flow",
            "grant_jti": claims["jti"],
            "terminal_id": "t-other",
            "paused": True,
        },
    )

    assert manager.send_terminal.await_count == 0


@pytest.mark.asyncio
async def test_reattach_preserves_have_offset(relay: RemoteTerminalRelay) -> None:
    """`have_offset` must survive the `remote_terminal_attach` -> `terminal_attach`
    retype.

    Fails on the unfixed relay, which never named the field. The target reads its
    absence as "this source holds nothing", ships the whole ring tail, and the
    source then sees a gap where none existed and writes a DATA-LOSS marker into
    a pane that lost nothing.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    with _verify(claims):
        await relay.handle_source_frame(
            {
                "type": "remote_terminal_attach",
                "request_id": "req-reattach",
                "grant": "opaque.jwt.here",
                "cols": 120,
                "rows": 40,
                "have_offset": 4096,
            },
            SOURCE_DEVICE,
            manager,
            ws,
        )

    assert ws.of_type("error") == [], ws.sent
    frame = _forwarded_attach(manager)
    assert frame["have_offset"] == 4096


@pytest.mark.asyncio
async def test_first_attach_omits_have_offset_rather_than_sending_null(
    relay: RemoteTerminalRelay,
) -> None:
    """A FIRST attach genuinely has nothing, and must take the tail arm
    deliberately — by the field's absence, not by a null the target would have to
    special-case."""
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)

    assert ws.of_type("error") == [], ws.sent
    frame = _forwarded_attach(manager)
    assert "have_offset" not in frame


# ---------------------------------------------------------------------------
# Phase 5, the other half — what the relay must carry BACK once the flow frame
# and the reattach offset reach the target at all. Admitting the pause without
# routing the resume's resync loses exactly the output the pause withheld.
# ---------------------------------------------------------------------------


def _resync(claims: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """The ring the target volunteers after a flow RESUME that skipped frames.

    Shaped from the runner's own emitter (``handle_terminal_flow``,
    ``FlowTransition::Resumed { skipped: true }``): marked with the grant and
    a ``remote`` echo, and correlated by NOTHING — ``terminal_flow`` is
    fire-and-forget, so ``request_id`` echoes back null.
    """
    frame: dict[str, Any] = {
        "type": "terminal_buffer_response",
        "terminal_id": "t1",
        "grant_jti": claims["jti"],
        "remote": {"source_device_id": SOURCE_DEVICE, "grant_jti": claims["jti"]},
        "data": "cmVzeW5j",
        # The resync ships the WHOLE ring, so the emitter sets both offsets from
        # the same `get_scrollback_buffer()` value — unlike the attach reply,
        # which ships a bounded tail and so reports a `ring_start_offset` BELOW
        # its `start_offset`. Kept equal here because this fixture is the only
        # description of the wire shape in this repo, and a divergence in it
        # would be read as the contract.
        "start_offset": 100,
        "ring_start_offset": 100,
        "total_bytes_produced": 106,
        "request_id": None,
    }
    frame.update(overrides)
    return frame


@pytest.mark.asyncio
async def test_flow_resume_resync_reaches_the_source(
    relay: RemoteTerminalRelay,
) -> None:
    """The resume's ring must reach the source, correlated by GRANT not by id.

    Fails on the unfixed relay: ``terminal_buffer_response`` was
    correlate-or-drop against ``pending_buffer``, and this frame answers a
    ``terminal_flow`` the relay sent with no request id at all. So the bytes the
    target withheld while paused were discarded at the relay — the one failure
    backpressure exists to prevent, reachable only because #1294 admitted the
    flow frame that closes the target's gate in the first place.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    before = len(ws.sent)

    routed = await relay.route_target_frame(session, TARGET_DEVICE, _resync(claims))

    assert routed is True
    assert ws.sent[before:] == [
        {
            "type": "remote_terminal_buffer",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "data": "cmVzeW5j",
            "start_offset": 100,
            "ring_start_offset": 100,
            "total_bytes_produced": 106,
        }
    ]
    # No request_id, and that absence is the routing instruction: the source
    # splices an uncorrelated ring from its own offset, and resolves a
    # `history:` waiter only for one it asked for.
    assert "request_id" not in ws.sent[before]
    assert session.pending_buffer == {}
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_flow_resume_resync_naming_a_foreign_grant_is_ignored(
    relay: RemoteTerminalRelay,
) -> None:
    """Every source listening to this target sees every frame on its channel.

    A resync marked with a grant this socket does not hold is another source's
    withheld output; delivering it under OUR jti would splice a stranger's bytes
    into this pane. Same rule the remote-marked ``error`` route already applies.

    A REGRESSION GUARD, not evidence: on the unfixed relay both frames are
    refused for the trivial reason that correlate-or-drop refused EVERYTHING, so
    this passes either way and says nothing about the arm it names. Its siblings
    below — the cross-target and unbound-grant cases — DO fail without their
    fixes, and those are the ones that pin this arm's scoping.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    before = len(ws.sent)

    for frame in (
        _resync(claims, grant_jti="not-ours", remote={"grant_jti": "not-ours"}),
        # Marked with our grant but naming a terminal it does not hold: a target
        # defect, and splicing it would corrupt the pane that IS ours.
        _resync(claims, terminal_id="t-other"),
    ):
        assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is False

    assert ws.sent[before:] == []
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_unmarked_buffer_response_is_left_to_the_mobile_path(
    relay: RemoteTerminalRelay,
) -> None:
    """The mobile watchers share this channel and their replies carry no mark.

    The runner adds ``grant_jti`` / ``remote`` to a ``terminal_buffer_response``
    only for a remote request, so an unmarked one belongs to the operator-web
    path. It passed before this change and must keep passing: the point of the
    new arm is that it does not widen what the relay claims.
    """
    ws = _FakeWS()
    manager = _manager()
    await _attached(relay, ws, manager, terminal_id="t1")
    session = relay._sessions[id(ws)]
    before = len(ws.sent)

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_buffer_response",
            "terminal_id": "t1",
            "data": "bW9iaWxl",
            "request_id": "a-mobile-watchers-own-id",
        },
    )

    assert routed is False
    assert ws.sent[before:] == []
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_ring_start_offset_survives_the_attach_reply(
    relay: RemoteTerminalRelay,
) -> None:
    """``ring_start_offset`` is the source's ``history_start``.

    Fails on the unfixed relay, which copied a known field set and did not name
    this one. The attach reply ships only a bounded TAIL, and this says where the
    ring actually begins — so without it ``RemotePaneIo::history_range()``
    returns ``None`` for every pane and the operator can never fetch the earlier
    output the target still holds. Not a degraded lazy scrollback: an absent one,
    with nothing in either log to say so.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)
    session = relay._sessions[id(ws)]
    minted = _forwarded_attach(manager)["request_id"]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_attached",
            "request_id": minted,
            "terminal_id": "t1",
            "data": "dGFpbA==",
            "start_offset": 900,
            "ring_start_offset": 40,
            "total_bytes_produced": 904,
        },
    )

    assert routed is True
    attached = ws.of_type("remote_terminal_attached")[0]
    assert (attached["start_offset"], attached["ring_start_offset"]) == (900, 40)
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_history_request_forwards_both_ends_of_the_range(
    relay: RemoteTerminalRelay,
) -> None:
    """Lazy scrollback asks for a HALF-OPEN ``[from, to)`` and the target reads
    both ends.

    Fails on the unfixed relay, which forwarded only the lower bound — turning a
    request for the window above the attach seed into "everything from `from` to
    the end of the ring", which is the whole ring the tail arm existed to avoid
    shipping.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_buffer",
            "request_id": "history:1",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
            "from_offset": 40,
            "to_offset": 900,
        },
    )

    frame = manager.send_terminal.await_args.args[1]
    assert frame["type"] == "terminal_buffer"
    assert (frame["from_offset"], frame["to_offset"]) == (40, 900)
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_attach_buffer_request_omits_bounds_it_was_not_given(
    relay: RemoteTerminalRelay,
) -> None:
    """A whole-ring request must send neither bound rather than two nulls.

    The target branches on presence (``data.get("to_offset")``), and a null
    would be indistinguishable from an omission only by luck of that spelling.
    Passes either way — a guard on the new loop, not evidence for it.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = await _attached(relay, ws, manager, terminal_id="t1")
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_buffer",
            "request_id": "buf-whole",
            "grant_jti": claims["jti"],
            "terminal_id": "t1",
        },
    )

    frame = manager.send_terminal.await_args.args[1]
    assert "from_offset" not in frame
    assert "to_offset" not in frame
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_resync_on_another_targets_channel_is_not_routed_by_grant_alone(
    relay: RemoteTerminalRelay,
) -> None:
    """One socket, two targets, and the same terminal id on both.

    Terminal ids are per-DEVICE, so two machines both calling a pane `t1` is
    ordinary rather than unlikely. Resolving a marked frame by `grant_jti` alone
    therefore is not merely loose — it hands a frame that arrived on target B's
    channel to the attachment on target A, whose terminal check then PASSES
    because both are `t1`, and the source splices B's scrollback into A's pane.

    The terminal route always filtered on the channel (`by_terminal`); the grant
    route did not, and that asymmetry is what this pins.
    """
    ws = _FakeWS()
    manager = _manager()
    other_target = str(uuid4())
    claims_a = await _attached(relay, ws, manager, terminal_id="t1", request_id="ra")
    claims_b = _claims(
        attach={
            "target_device_id": other_target,
            "target_session_id": TARGET_SESSION,
            "terminal_id": None,
        }
    )
    await _attach(relay, ws, manager, claims_b, request_id="rb")
    session = relay._sessions[id(ws)]
    minted_b = _forwarded_attach(manager)["request_id"]
    assert (
        await relay.route_target_frame(
            session,
            other_target,
            {
                "type": "terminal_attached",
                "request_id": minted_b,
                "terminal_id": "t1",
                "data": "",
                "start_offset": 0,
                "total_bytes_produced": 0,
            },
        )
        is True
    )
    before = len(ws.sent)

    # B's channel, A's grant, a terminal id both of them hold.
    routed = await relay.route_target_frame(
        session, other_target, _resync(claims_a, data="Yi1zZWNyZXQ=")
    )

    assert routed is False
    assert ws.sent[before:] == []
    # The same rule on the error route, which shares the resolver.
    assert (
        await relay.route_target_frame(
            session,
            other_target,
            {
                "type": "error",
                "terminal_id": "t1",
                "grant_jti": claims_a["jti"],
                "code": "boom",
                "message": "b's refusal",
            },
        )
        is False
    )
    assert ws.sent[before:] == []
    await relay.release_source(ws)


@pytest.mark.asyncio
async def test_resync_for_a_grant_the_target_has_not_bound_is_refused(
    relay: RemoteTerminalRelay,
) -> None:
    """A registered-but-UNBOUND grant has `terminal_id is None`.

    So a marked frame naming that grant and no terminal cleared the guard on
    `None == None` and was forwarded with `terminal_id: None`. The correlated
    arm can never reach this — `pending_buffer` is written only after
    `_authorize(require_bound=True)` — so it is surface the unsolicited arm
    added, and the guard has to test boundness rather than equality.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = _claims()
    await _attach(relay, ws, manager, claims)  # no terminal_attached: unbound
    session = relay._sessions[id(ws)]
    assert session.grants[claims["jti"]].attached is False
    before = len(ws.sent)

    for frame in (
        {
            "type": "terminal_buffer_response",
            "grant_jti": claims["jti"],
            "remote": {"grant_jti": claims["jti"]},
            "data": "aGk=",
        },
        _resync(claims, terminal_id=None),
    ):
        assert await relay.route_target_frame(session, TARGET_DEVICE, frame) is False

    assert ws.sent[before:] == []
    await relay.release_source(ws)


# ---------------------------------------------------------------------------
# Remote CREATE (plan `2026-09-11-headless-runner-parity-from-a-headed-runner`)
#
# What is pinned here is the SEPARATION of the two capabilities. A create
# grant is addressed by DEVICE and carries no session, so it must travel a
# door that does not require one; and it buys exactly one spawn, so it must
# not be spendable on the frames an attach grant buys. Where the terminal
# LANDS is the target's decision and is pinned on the target
# (`mcp::remote_terminal::create_gate_tests` in qontinui-runner) — this relay
# deliberately carries the caller's preference through rather than deciding
# it here.
# ---------------------------------------------------------------------------


def _create_claims(**overrides: Any) -> dict[str, Any]:
    """A CREATE grant: a target DEVICE and, deliberately, no session at all."""
    claims: dict[str, Any] = {
        "sub": "create-grant:" + str(uuid4()),
        "sub_type": "create_grant",
        "device_id": SOURCE_DEVICE,
        "user_id": str(uuid4()),
        "tenant_id": str(uuid4()),
        "create": {"target_device_id": TARGET_DEVICE},
        "iat": int(time.time()),
        "exp": int(time.time()) + 900,
        "jti": str(uuid4()),
    }
    claims.update(overrides)
    return claims


async def _create(
    relay: RemoteTerminalRelay,
    ws: _FakeWS,
    manager: Any,
    claims: Any,
    *,
    request_id: str = "req-create-1",
    **frame: Any,
) -> None:
    with _verify(claims):
        await relay.handle_source_frame(
            {
                "type": "remote_terminal_create",
                "request_id": request_id,
                "grant": "opaque.jwt.here",
                **frame,
            },
            SOURCE_DEVICE,
            manager,
            ws,
        )


def _forwarded_create(manager: Any) -> dict[str, Any]:
    frames = [
        c.args[1]
        for c in manager.send_terminal.await_args_list
        if c.args[1].get("type") == "terminal_create"
    ]
    assert frames, manager.send_terminal.await_args_list
    return frames[-1]


# Factories, not values — see the note on the attach parametrisation above.
@pytest.mark.parametrize(
    ("make_verifier_result", "expected_code"),
    [
        (
            lambda: CoordTokenInvalidError("token verification failed: bad signature"),
            "create_grant_invalid",
        ),
        (lambda: CoordTokenExpiredError("token expired"), "create_grant_expired"),
        (lambda: _create_claims(exp=int(time.time()) - 5), "create_grant_expired"),
        (lambda: _create_claims(device_id=str(uuid4())), "create_grant_wrong_source"),
        (lambda: _create_claims(create={}), "create_grant_invalid"),
        (
            lambda: _create_claims(create={"target_device_id": "not-a-uuid"}),
            "create_grant_invalid",
        ),
    ],
)
async def test_create_refused_with_typed_code_and_nothing_forwarded(
    relay: RemoteTerminalRelay,
    redis: _FakeRedis,
    make_verifier_result: Any,
    expected_code: str,
) -> None:
    ws = _FakeWS()
    manager = _manager()

    await _create(relay, ws, manager, make_verifier_result())

    errors = ws.of_type("error")
    assert len(errors) == 1, ws.sent
    assert errors[0]["code"] == expected_code
    assert errors[0]["request_id"] == "req-create-1"
    manager.send_terminal.assert_not_called()
    assert redis.empty()


async def test_an_attach_grant_cannot_send_a_create_frame(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """A NON-create grant may not spawn a PTY, whatever door it knocks on.

    The attach grant here is entirely valid — right source device, unexpired,
    coord-signed. It is refused on its ``sub_type`` alone, because spawning is
    a capability it was never minted for.
    """
    ws = _FakeWS()
    manager = _manager()

    await _create(relay, ws, manager, _claims())

    errors = ws.of_type("error")
    assert len(errors) == 1, ws.sent
    assert errors[0]["code"] == "create_grant_invalid"
    assert "not a create grant" in errors[0]["message"]
    manager.send_terminal.assert_not_called()
    assert redis.empty()


async def test_valid_create_forwards_terminal_create_under_a_create_block(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _create_claims()

    await _create(
        relay,
        ws,
        manager,
        claims,
        cols=100,
        rows=30,
        title="headless",
        working_dir_key="workspace_root",
        working_dir="/somewhere/the/caller/likes",
        intent_repo="qontinui-runner",
    )

    assert ws.of_type("error") == [], ws.sent
    target, frame = manager.send_terminal.await_args.args
    assert target == TARGET_DEVICE
    assert frame["type"] == "terminal_create"
    # The id on the wire is the relay's, as for every other forwarded RPC.
    assert isinstance(frame["request_id"], str)
    assert frame["request_id"] != "req-create-1"
    # The block tells the target WHICH capability this is. Without the kind the
    # target reads it as an attach grant and refuses to spawn.
    assert frame["remote"] == {
        "source_device_id": SOURCE_DEVICE,
        "grant_jti": claims["jti"],
        "kind": "create",
    }
    # The caller's PREFERENCES ride through untouched — the target, which owns
    # the PTY, is the one that accepts or refuses them.
    assert frame["title"] == "headless"
    assert (frame["cols"], frame["rows"]) == (100, 30)
    assert frame["working_dir_key"] == "workspace_root"
    assert frame["working_dir"] == "/somewhere/the/caller/likes"
    assert frame["intent_repo"] == "qontinui-runner"

    # Registered like any other grant, and single use.
    record = await redis.hgetall(rtr.grant_key(claims["jti"]))
    assert record["kind"] == "create"
    # No session: the one the create is about does not exist yet.
    assert record["target_session_id"] == ""
    assert record["target_device_id"] == TARGET_DEVICE


async def test_an_attach_block_is_not_stamped_kind(
    relay: RemoteTerminalRelay,
) -> None:
    """The attach wire is unchanged: ``kind`` appears only for a create."""
    ws = _FakeWS()
    manager = _manager()
    await _attach(relay, ws, manager, _claims())
    assert "kind" not in _forwarded_attach(manager)["remote"]


async def test_a_create_grant_cannot_send_session_scoped_frames(
    relay: RemoteTerminalRelay,
) -> None:
    """The converse separation: a create grant holds no session and no PTY.

    Every frame below is one an ATTACH grant buys. Presented under the create
    grant's own jti — a grant this socket really does hold — each is refused as
    the wrong CAPABILITY rather than as an unknown grant, and none reaches the
    target.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = _create_claims()
    await _create(relay, ws, manager, claims)
    assert ws.of_type("error") == [], ws.sent
    manager.send_terminal.reset_mock()

    for msg in (
        {"type": "remote_terminal_input", "data": "eA=="},
        {"type": "remote_terminal_resize", "cols": 10, "rows": 10},
        {"type": "remote_terminal_buffer"},
        {"type": "remote_terminal_flow", "paused": True},
    ):
        ws.sent.clear()
        await _send(
            relay,
            ws,
            manager,
            {
                **msg,
                "request_id": "req-abuse",
                "grant_jti": claims["jti"],
                "terminal_id": "t1",
            },
        )
        errors = ws.of_type("error")
        assert len(errors) == 1, (msg["type"], ws.sent)
        assert errors[0]["code"] == "grant_wrong_kind", msg["type"]
        manager.send_terminal.assert_not_called()


async def test_terminal_created_routes_back_and_spends_the_grant(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _create_claims()
    await _create(relay, ws, manager, claims)
    minted = _forwarded_create(manager)["request_id"]
    session = relay._sessions[id(ws)]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_created",
            "request_id": minted,
            "terminal": {"id": "t-new", "title": "headless"},
        },
    )

    assert routed is True
    created = ws.of_type("remote_terminal_created")
    assert len(created) == 1, ws.sent
    assert created[0]["request_id"] == "req-create-1"
    assert created[0]["grant_jti"] == claims["jti"]
    assert created[0]["terminal_id"] == "t-new"
    # Spent: driving the new terminal needs an ATTACH grant, which coord mints
    # against the target's own attach preference.
    assert session.grants == {}
    assert redis.empty()


async def test_a_terminal_created_we_did_not_mint_is_not_ours(
    relay: RemoteTerminalRelay,
) -> None:
    """The mobile path creates terminals on this same channel."""
    ws = _FakeWS()
    manager = _manager()
    await _create(relay, ws, manager, _create_claims())
    session = relay._sessions[id(ws)]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "terminal_created",
            "request_id": "some-mobile-id",
            "terminal": {"id": "t-mobile"},
        },
    )
    assert routed is False
    assert ws.of_type("remote_terminal_created") == []


async def test_a_refused_create_reaches_the_source_and_drops_the_grant(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """The target's own refusal — e.g. a working dir it does not offer."""
    ws = _FakeWS()
    manager = _manager()
    claims = _create_claims()
    await _create(relay, ws, manager, claims)
    minted = _forwarded_create(manager)["request_id"]
    session = relay._sessions[id(ws)]

    routed = await relay.route_target_frame(
        session,
        TARGET_DEVICE,
        {
            "type": "error",
            "request_id": minted,
            "code": "remote_create_working_dir_not_allowed",
            "message": "not one this device offers",
            "remote": {"grant_jti": claims["jti"]},
        },
    )

    assert routed is True
    errors = ws.of_type("remote_terminal_error")
    assert len(errors) == 1, ws.sent
    assert errors[0]["code"] == "remote_create_working_dir_not_allowed"
    assert errors[0]["request_id"] == "req-create-1"
    assert session.grants == {}
    assert redis.empty()


async def test_a_create_grant_is_single_use(relay: RemoteTerminalRelay) -> None:
    ws = _FakeWS()
    manager = _manager()
    claims = _create_claims()
    await _create(relay, ws, manager, claims)
    assert ws.of_type("error") == [], ws.sent

    await _create(relay, ws, manager, claims, request_id="req-create-2")
    errors = ws.of_type("error")
    assert len(errors) == 1, ws.sent
    assert errors[0]["code"] == "attach_grant_consumed"


async def test_remote_terminal_create_is_a_source_frame() -> None:
    assert rtr.is_source_frame("remote_terminal_create") is True


async def test_create_target_device_id_reads_both_spellings() -> None:
    device = str(uuid4())
    assert (
        rtr.create_target_device_id({"create": {"target_device_id": device}}) == device
    )
    assert rtr.create_target_device_id({"target_device_id": device}) == device
    assert rtr.create_target_device_id({"create": {}}) is None
    assert rtr.create_target_device_id({}) is None


async def test_a_create_grant_may_still_be_detached(
    relay: RemoteTerminalRelay, redis: _FakeRedis
) -> None:
    """Giving up a registration is not a session operation.

    A source that no longer wants a create it presented must be able to
    release the Redis claim and the per-target listener it is holding —
    otherwise an abandoned create stays pinned until the grant expires.
    """
    ws = _FakeWS()
    manager = _manager()
    claims = _create_claims()
    await _create(relay, ws, manager, claims)
    assert ws.of_type("error") == [], ws.sent
    session = relay._sessions[id(ws)]
    manager.send_terminal.reset_mock()

    await _send(
        relay,
        ws,
        manager,
        {
            "type": "remote_terminal_detach",
            "request_id": "req-detach",
            "grant_jti": claims["jti"],
        },
    )

    assert ws.of_type("error") == [], ws.sent
    assert session.grants == {}
    assert redis.empty()
    # No `terminal_detach` is sent: the target bound no terminal under a create
    # grant, and admits no such frame under one.
    manager.send_terminal.assert_not_called()
