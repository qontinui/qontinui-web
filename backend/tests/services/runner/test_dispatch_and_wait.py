"""Unit tests for ``CommandRelayService.dispatch_and_wait``.

The dispatcher is the request/reply primitive that Plan B Phases 2-7
build on. These tests use ``unittest.mock`` to stand in for Redis and
the WS connection registry, so they run without any external services.

Scenarios covered:
- happy path: publish, receive matching response, return it.
- runner-not-connected at dispatch time (raises ``RunnerNotConnectedError``).
- timeout (raises ``RunnerCommandTimeoutError``).
- mismatched ``request_id`` is ignored and the dispatcher keeps waiting.
- bytes payload from Redis is decoded.
- pubsub cleanup runs even when the dispatcher raises.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.runner.command_relay import (
    CommandRelayService,
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
)

pytestmark = pytest.mark.asyncio


class _FakePubSub:
    """Minimal stub for ``redis.asyncio.client.PubSub``.

    Records subscribe/unsubscribe/close calls and pops queued messages
    on ``get_message``. Returning ``None`` simulates a timeout tick;
    once the queue is empty subsequent ``get_message`` calls return
    ``None`` as well (so the dispatcher's own deadline drives termination).
    """

    def __init__(self, messages: list[dict[str, Any] | None]) -> None:
        self._messages = list(messages)
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def close(self) -> None:
        self.closed = True

    async def get_message(
        self,
        *,
        ignore_subscribe_messages: bool = False,  # noqa: ARG002 - parity with redis
        timeout: float = 1.0,  # noqa: ARG002 - parity with redis
    ) -> dict[str, Any] | None:
        if not self._messages:
            return None
        msg = self._messages.pop(0)
        return msg


def _make_relay(
    *,
    is_connected: bool,
    messages: list[dict[str, Any] | None] | None = None,
) -> tuple[CommandRelayService, _FakePubSub, AsyncMock]:
    """Build a CommandRelayService with mocked Redis + registry."""
    pubsub = _FakePubSub(messages or [])

    redis = MagicMock()
    redis.pubsub = MagicMock(return_value=pubsub)
    redis.publish = AsyncMock(return_value=1)

    registry = MagicMock()
    registry.is_runner_connected = MagicMock(return_value=is_connected)

    relay = CommandRelayService(redis_client=redis, registry=registry)
    return relay, pubsub, redis.publish


async def test_dispatch_and_wait_happy_path() -> None:
    """A matching response published to the channel is returned to the caller."""
    request_id = "11111111-1111-1111-1111-111111111111"
    runner_id = "22222222-2222-2222-2222-222222222222"
    response_payload = {
        "type": "command_response",
        "request_id": request_id,
        "states": [],
        "elements": [],
    }
    messages = [
        {
            "type": "message",
            "data": json.dumps(response_payload),
        }
    ]
    relay, pubsub, publish = _make_relay(is_connected=True, messages=messages)

    result = await relay.dispatch_and_wait(
        runner_id,
        {"command": "state_machine.discover_ui_bridge", "payload": {}},
        request_id=request_id,
        timeout_s=2.0,
    )

    assert result == response_payload
    # The dispatch should subscribe to the response channel BEFORE publishing.
    assert pubsub.subscribed == [f"runner:responses:{runner_id}"]
    # The published command should carry the request_id we passed in.
    publish.assert_awaited_once()
    channel_arg, payload_arg = publish.await_args.args
    assert channel_arg == f"runner:commands:{runner_id}"
    sent = json.loads(payload_arg)
    assert sent["request_id"] == request_id
    assert sent["command"] == "state_machine.discover_ui_bridge"
    # Cleanup ran.
    assert pubsub.unsubscribed == [f"runner:responses:{runner_id}"]
    assert pubsub.closed is True


async def test_dispatch_and_wait_runner_not_connected() -> None:
    """No connected runner -> ``RunnerNotConnectedError``, no publish, no subscribe."""
    relay, pubsub, publish = _make_relay(is_connected=False)

    with pytest.raises(RunnerNotConnectedError) as exc_info:
        await relay.dispatch_and_wait(
            "00000000-0000-0000-0000-000000000000",
            {"command": "x"},
            request_id="rid",
            timeout_s=1.0,
        )

    assert exc_info.value.runner_id == "00000000-0000-0000-0000-000000000000"
    # No subscribe, no publish, no cleanup needed.
    assert pubsub.subscribed == []
    assert pubsub.closed is False
    publish.assert_not_awaited()


async def test_dispatch_and_wait_timeout() -> None:
    """No matching response within timeout -> ``RunnerCommandTimeoutError``."""
    # No messages at all — pubsub will return None on every poll.
    relay, pubsub, _publish = _make_relay(is_connected=True, messages=[])

    with pytest.raises(RunnerCommandTimeoutError) as exc_info:
        await relay.dispatch_and_wait(
            "11111111-1111-1111-1111-111111111111",
            {"command": "x"},
            request_id="rid-timeout",
            # Sub-second deadline so the test runs fast; the dispatcher
            # caps each get_message wait at min(1.0, remaining).
            timeout_s=0.05,
        )

    assert exc_info.value.runner_id == "11111111-1111-1111-1111-111111111111"
    assert exc_info.value.request_id == "rid-timeout"
    assert exc_info.value.timeout_s == 0.05
    # Cleanup still ran.
    assert pubsub.closed is True


async def test_dispatch_and_wait_ignores_mismatched_request_id() -> None:
    """A response with a different ``request_id`` is skipped, matching one returned."""
    rid_ours = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    rid_other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    other_response = {
        "type": "command_response",
        "request_id": rid_other,
        "states": [],
    }
    our_response = {
        "type": "command_response",
        "request_id": rid_ours,
        "states": [{"id": "s1"}],
    }
    messages = [
        {"type": "message", "data": json.dumps(other_response)},
        {"type": "message", "data": json.dumps(our_response)},
    ]
    relay, _pubsub, _publish = _make_relay(is_connected=True, messages=messages)

    result = await relay.dispatch_and_wait(
        "22222222-2222-2222-2222-222222222222",
        {"command": "x"},
        request_id=rid_ours,
        timeout_s=2.0,
    )

    assert result == our_response


async def test_dispatch_and_wait_decodes_bytes_payload() -> None:
    """Messages whose ``data`` is bytes are decoded as UTF-8 before JSON parse."""
    request_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    response = {
        "type": "command_response",
        "request_id": request_id,
        "states": [],
    }
    messages = [
        {
            "type": "message",
            "data": json.dumps(response).encode("utf-8"),
        }
    ]
    relay, _pubsub, _publish = _make_relay(is_connected=True, messages=messages)

    result = await relay.dispatch_and_wait(
        "33333333-3333-3333-3333-333333333333",
        {"command": "x"},
        request_id=request_id,
        timeout_s=2.0,
    )

    assert result == response


async def test_dispatch_and_wait_skips_subscribe_messages_and_parse_errors() -> None:
    """Non-message-type frames and garbage payloads are skipped without erroring."""
    request_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    response = {
        "type": "command_response",
        "request_id": request_id,
        "ok": True,
    }
    messages = [
        # Subscribe-confirmation style frame: dispatcher should ignore.
        {"type": "subscribe", "data": "irrelevant"},
        # Garbage JSON.
        {"type": "message", "data": "{not json"},
        # Valid but not a dict.
        {"type": "message", "data": json.dumps([1, 2, 3])},
        # The real response.
        {"type": "message", "data": json.dumps(response)},
    ]
    relay, _pubsub, _publish = _make_relay(is_connected=True, messages=messages)

    result = await relay.dispatch_and_wait(
        "44444444-4444-4444-4444-444444444444",
        {"command": "x"},
        request_id=request_id,
        timeout_s=2.0,
    )

    assert result == response
