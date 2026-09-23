"""The send-path liveness gate, on every path that reports a receipt.

qontinui-web#1429 found that ``is_runner_connected`` answers REGISTRATION and
that a registry entry outlives its socket whenever the device-WS teardown
takes the superseded path. It closed the false receipt on ONE of the relays
that publish onto a runner-direction channel and report the publish as
success — ``TerminalRelayService.send_terminal_to_runner``. The identical
shape lived in the two siblings and in the dispatcher: ``send_chat_to_runner``
is the bool behind the REST chat routes' HTTP 200 ``status: forwarded``,
``send_command_to_runner`` is the bool behind the frontend's ``command_sent``
frame, and ``dispatch_and_wait``'s local gate is what stands between a
millisecond 503 and a full ``timeout_s`` wait ending in a 504.

What is pinned here, over a REAL ``WebSocketConnectionRegistry`` holding a
socket whose ``client_state`` has gone DISCONNECTED:

* ``can_send_to_runner`` — the one gate every path calls — is False for the
  stale entry, False for an unregistered id, True for a live socket, and
  logs the stale case (only) with the ``path`` that asked;
* each of the four send paths refuses the stale entry and publishes NOTHING,
  and each still forwards over a live socket (the positive control, so the
  gate is shown to narrow rather than to refuse everything);
* ``dispatch_and_wait`` refuses BEFORE subscribing — a stale target must not
  cost the caller its timeout;
* ``require_local_connection=False`` skips the gate on both functions that
  carry it — a dead LOCAL entry says nothing about the replica that holds
  the socket.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import structlog
from starlette.websockets import WebSocketState

from app.services.runner.chat_relay import ChatRelayService
from app.services.runner.command_relay import (
    CommandRelayService,
    RunnerNotConnectedError,
)
from app.services.runner.connection_registry import WebSocketConnectionRegistry
from app.services.runner.terminal_relay import TerminalRelayService

pytestmark = pytest.mark.asyncio

RUNNER = "33333333-3333-3333-3333-333333333333"


def _socket(client: WebSocketState, application: WebSocketState) -> MagicMock:
    ws = MagicMock()
    ws.client_state = client
    ws.application_state = application
    return ws


def _dead_socket() -> MagicMock:
    """A registered socket whose handler has exited.

    ``client_state`` DISCONNECTED with ``application_state`` still CONNECTED is
    the shape Starlette leaves behind — its ``send`` never reads
    ``client_state`` — and the reason the gate reads the former.
    """
    return _socket(WebSocketState.DISCONNECTED, WebSocketState.CONNECTED)


def _live_socket() -> MagicMock:
    return _socket(WebSocketState.CONNECTED, WebSocketState.CONNECTED)


def _redis() -> MagicMock:
    redis = MagicMock()
    redis.publish = AsyncMock(return_value=1)
    pubsub = MagicMock()
    pubsub.subscribe = AsyncMock()
    pubsub.unsubscribe = AsyncMock()
    pubsub.close = AsyncMock()
    pubsub.get_message = AsyncMock(return_value=None)
    redis.pubsub = MagicMock(return_value=pubsub)
    return redis


def _registry_with(ws: MagicMock | None) -> WebSocketConnectionRegistry:
    registry = WebSocketConnectionRegistry()
    if ws is not None:
        registry.register_runner(RUNNER, ws)
    return registry


# ---------------------------------------------------------------------------
# The gate itself
# ---------------------------------------------------------------------------


async def test_gate_refuses_a_stale_registration_and_logs_it() -> None:
    registry = _registry_with(_dead_socket())
    # The premise the whole module rests on: the stale entry still LOOKS
    # connected to the registration check.
    assert registry.is_runner_connected(RUNNER) is True

    with structlog.testing.capture_logs() as logs:
        allowed = registry.can_send_to_runner(RUNNER, path="probe", message_type="x")

    assert allowed is False
    refusals = [e for e in logs if e["event"] == "runner_send_refused_stale_socket"]
    assert len(refusals) == 1
    assert refusals[0]["runner_id"] == RUNNER
    assert refusals[0]["path"] == "probe"
    assert refusals[0]["message_type"] == "x"
    assert refusals[0]["log_level"] == "warning"


async def test_gate_refuses_an_unregistered_runner_without_the_stale_log() -> None:
    """Never-registered-here is a different condition and must not be logged as stale."""
    registry = _registry_with(None)

    with structlog.testing.capture_logs() as logs:
        allowed = registry.can_send_to_runner(RUNNER, path="probe")

    assert allowed is False
    assert [e for e in logs if e["event"] == "runner_send_refused_stale_socket"] == []


async def test_gate_admits_a_live_socket() -> None:
    registry = _registry_with(_live_socket())

    with structlog.testing.capture_logs() as logs:
        allowed = registry.can_send_to_runner(RUNNER, path="probe")

    assert allowed is True
    assert logs == []


# ---------------------------------------------------------------------------
# Every send path that reports a receipt asks the gate
# ---------------------------------------------------------------------------


async def _send_chat(registry: Any, redis: Any) -> bool:
    return await ChatRelayService(redis, registry).send_chat_to_runner(
        RUNNER, {"type": "chat_message", "content": "hi"}
    )


async def _send_terminal(registry: Any, redis: Any) -> bool:
    return await TerminalRelayService(redis, registry).send_terminal_to_runner(
        RUNNER, {"type": "terminal_input", "data": "ls\n"}
    )


async def _send_command(registry: Any, redis: Any) -> bool:
    return await CommandRelayService(redis, registry).send_command_to_runner(
        RUNNER, {"type": "command", "command": "ping"}
    )


_SEND_PATHS = [
    pytest.param(_send_chat, "chat", "chat_message", id="chat"),
    pytest.param(_send_terminal, "terminal", "terminal_input", id="terminal"),
    pytest.param(_send_command, "command", "command", id="command"),
]
_SENDS = [pytest.param(p.values[0], id=p.id) for p in _SEND_PATHS]


@pytest.mark.parametrize(("send", "path", "message_type"), _SEND_PATHS)
async def test_send_path_refuses_a_stale_registration_and_publishes_nothing(
    send: Any, path: str, message_type: str
) -> None:
    registry = _registry_with(_dead_socket())
    redis = _redis()

    with structlog.testing.capture_logs() as logs:
        sent = await send(registry, redis)

    # Said plainly: the receipt is False, and nothing reached the channel a
    # listener would forward into the dead socket.
    assert sent is False
    redis.publish.assert_not_awaited()
    refusals = [e for e in logs if e["event"] == "runner_send_refused_stale_socket"]
    assert [(e["path"], e["message_type"]) for e in refusals] == [(path, message_type)]


@pytest.mark.parametrize("send", _SENDS)
async def test_send_path_still_forwards_over_a_live_socket(send: Any) -> None:
    """The positive control — the gate narrows, it does not refuse everything."""
    registry = _registry_with(_live_socket())
    redis = _redis()

    with structlog.testing.capture_logs() as logs:
        sent = await send(registry, redis)

    assert sent is True
    redis.publish.assert_awaited_once()
    channel = redis.publish.await_args.args[0]
    assert channel.endswith(f":{RUNNER}"), channel
    assert [e for e in logs if e["event"] == "runner_send_refused_stale_socket"] == []


async def test_dispatch_refuses_a_stale_registration_before_subscribing() -> None:
    """A stale target is a 503 at once, never a ``timeout_s`` wait ending in a 504."""
    registry = _registry_with(_dead_socket())
    redis = _redis()
    relay = CommandRelayService(redis, registry)

    with structlog.testing.capture_logs() as logs:
        with pytest.raises(RunnerNotConnectedError) as exc_info:
            await relay.dispatch_and_wait(
                RUNNER,
                {"command": "state_machine.discover_ui_bridge", "payload": {}},
                request_id="rid-stale",
                # Small on purpose: under the mutation this guards (gate back
                # to registration) the dispatcher would otherwise spin out the
                # whole timeout before the wrong exception surfaced. The
                # "no wait" property is proven by the pre-subscribe refusal
                # below, not by this number.
                timeout_s=0.05,
            )

    assert exc_info.value.runner_id == RUNNER
    # Refused at the gate: no subscribe, no publish, nothing to clean up.
    redis.pubsub.assert_not_called()
    redis.publish.assert_not_awaited()
    refusals = [e for e in logs if e["event"] == "runner_send_refused_stale_socket"]
    assert [(e["path"], e["message_type"]) for e in refusals] == [
        ("dispatch", "state_machine.discover_ui_bridge")
    ]


# ``require_local_connection=False`` is the cross-replica arm and is untouched on
# BOTH functions that carry it. The stale-entry refusal is an in-process fact; a
# caller that already confirmed connectivity via Redis is asking this replica
# to publish, not to vouch for its own socket, so the gate must not run at all.
# ``device_bridge_ws`` relies on the dispatch arm for horizontal scaling and
# ``disconnect_mobile_terminal`` (#1432) on the send arm.


async def test_send_command_skips_the_gate_when_told_the_socket_is_elsewhere() -> None:
    registry = _registry_with(_dead_socket())
    redis = _redis()
    relay = CommandRelayService(redis, registry)

    with structlog.testing.capture_logs() as logs:
        sent = await relay.send_command_to_runner(
            RUNNER, {"type": "dispatch"}, require_local_connection=False
        )

    assert sent is True
    redis.publish.assert_awaited_once()
    assert [e for e in logs if e["event"] == "runner_send_refused_stale_socket"] == []


async def test_dispatch_skips_the_gate_when_told_the_socket_is_elsewhere() -> None:
    registry = _registry_with(_dead_socket())
    redis = _redis()
    pubsub = redis.pubsub.return_value
    pubsub.get_message = AsyncMock(
        return_value={
            "type": "message",
            "data": json.dumps({"type": "command_response", "request_id": "rid-x"}),
        }
    )
    relay = CommandRelayService(redis, registry)

    with structlog.testing.capture_logs() as logs:
        result = await relay.dispatch_and_wait(
            RUNNER,
            {"command": "probe"},
            request_id="rid-x",
            timeout_s=1.0,
            require_local_connection=False,
        )

    # Subscribed, published, answered — the dead LOCAL entry never consulted.
    assert result["request_id"] == "rid-x"
    pubsub.subscribe.assert_awaited_once_with(f"runner:responses:{RUNNER}")
    redis.publish.assert_awaited_once()
    assert [e for e in logs if e["event"] == "runner_send_refused_stale_socket"] == []
