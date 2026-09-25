"""Regression tests for the dropped ``terminal_unsubscribe`` leak.

Root cause: ``RunnerWebSocketManager.disconnect_mobile_terminal`` published the
``terminal_unsubscribe`` through ``CommandRelayService.send_command_to_runner``
with the default ``require_local_connection=True``. That gate is
``WebSocketConnectionRegistry.is_runner_connected`` — an **in-process** dict
lookup. When the viewer disconnected while the runner socket was held by a
*different* backend replica (or was momentarily deregistered locally), the
frame was silently dropped.

That is not a benign miss. The runner's ``terminal_subscriber_count`` is a
process-lifetime ``AtomicUsize`` it never resets, and terminal-output
forwarding is latched on ``count > 0`` — so a dropped unsubscribe leaves the
device-wide terminal firehose on for the rest of the runner's process life.

The fix publishes the unsubscribe with ``require_local_connection=False`` so
Redis pub/sub on ``runner:commands:{rid}`` carries it to whichever replica
holds the socket. These tests assert, in both directions:

- the unsubscribe IS published when the runner socket is not local;
- behaviour is unchanged when the socket IS local (still exactly one publish,
  same channel, same payload);
- the *subscribe* path is untouched — still gated locally, by decision;
- one unsubscribe per PUBLISHED subscribe: a viewer whose subscribe was
  skipped never sends an unsubscribe, because the runner's counter is shared
  and an unmatched decrement would take a PEER viewer's output down.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from starlette.websockets import WebSocketState

from app.services.runner_websocket_manager import RunnerWebSocketManager

pytestmark = pytest.mark.asyncio


def _make_manager() -> tuple[RunnerWebSocketManager, MagicMock]:
    """Build a manager over a mocked Redis, with no runner registered."""
    redis = MagicMock()
    redis.publish = AsyncMock(return_value=1)
    redis.set = AsyncMock(return_value=True)
    redis.sadd = AsyncMock(return_value=1)
    redis.expire = AsyncMock(return_value=True)
    redis.delete = AsyncMock(return_value=1)
    redis.exists = AsyncMock(return_value=1)

    pubsub = MagicMock()
    pubsub.subscribe = AsyncMock()
    pubsub.unsubscribe = AsyncMock()
    pubsub.close = AsyncMock()

    async def _listen():  # pragma: no cover - the mobile listener idles here
        if False:
            yield {}

    pubsub.listen = MagicMock(side_effect=_listen)
    redis.pubsub = MagicMock(return_value=pubsub)

    return RunnerWebSocketManager(redis), redis


def _live_runner_ws() -> MagicMock:
    """A registered runner socket whose handler is still alive.

    The send-path gate (``WebSocketConnectionRegistry.can_send_to_runner``)
    reads ``client_state`` / ``application_state``, and a bare ``MagicMock``
    auto-creates both as non-``CONNECTED`` values — i.e. it reads as a
    registration that outlived its socket. A "local" socket in these tests
    is a LIVE one, so say so.
    """
    ws = MagicMock()
    ws.send_json = AsyncMock()
    ws.client_state = WebSocketState.CONNECTED
    ws.application_state = WebSocketState.CONNECTED
    return ws


def _mobile_ws() -> MagicMock:
    ws = MagicMock()
    ws.send_json = AsyncMock()
    return ws


def _register_runner(manager: RunnerWebSocketManager, runner_id: str) -> None:
    manager.registry.register_runner(runner_id, _live_runner_ws())
    assert manager.registry.is_runner_connected(runner_id) is True


def _published(redis: MagicMock) -> list[tuple[str, dict[str, Any]]]:
    """Decode every ``redis.publish`` call into ``(channel, payload)``."""
    out: list[tuple[str, dict[str, Any]]] = []
    for call in redis.publish.await_args_list:
        channel, raw = call.args[0], call.args[1]
        out.append((channel, json.loads(raw)))
    return out


async def test_unsubscribe_is_published_when_runner_socket_is_not_local() -> None:
    """The load-bearing case: no local socket, unsubscribe must still go out.

    This is the leak. With the old in-process gate the registry lookup misses
    and ``send_command_to_runner`` returns ``False`` without publishing, so the
    replica that *does* hold the socket never forwards the frame and the
    runner's subscriber count never comes back down.
    """
    manager, redis = _make_manager()
    runner_id = str(uuid4())
    ws = _mobile_ws()

    # The viewer subscribed while the runner WAS local, so the runner's
    # counter went up on this viewer's behalf...
    _register_runner(manager, runner_id)
    assert await manager.connect_mobile_terminal(runner_id, ws, uuid4()) is True
    redis.publish.reset_mock()

    # ...and by the time it leaves, the runner socket is no longer registered
    # in this process (it reconnected to another replica, or was momentarily
    # deregistered here).
    manager.registry.unregister_runner(runner_id)
    assert manager.registry.is_runner_connected(runner_id) is False

    await manager.disconnect_mobile_terminal(runner_id, ws)

    published = _published(redis)
    assert published == [
        (
            f"runner:commands:{runner_id}",
            {"type": "terminal_unsubscribe", "runner_id": runner_id},
        )
    ]


async def test_unsubscribe_unchanged_when_runner_socket_is_local() -> None:
    """The no-regression direction: a local socket behaves exactly as before.

    Same channel, same payload, exactly one publish — widening the gate must
    not double-send or reroute the frame for the already-working case.
    """
    manager, redis = _make_manager()
    runner_id = str(uuid4())
    _register_runner(manager, runner_id)

    ws = _mobile_ws()
    assert await manager.connect_mobile_terminal(runner_id, ws, uuid4()) is True
    await manager.disconnect_mobile_terminal(runner_id, ws)

    published = _published(redis)
    assert published == [
        (
            f"runner:commands:{runner_id}",
            {"type": "terminal_subscribe", "runner_id": runner_id},
        ),
        (
            f"runner:commands:{runner_id}",
            {"type": "terminal_unsubscribe", "runner_id": runner_id},
        ),
    ]

    # A second disconnect of the same socket is a no-op: the one published
    # subscribe has already been matched.
    await manager.disconnect_mobile_terminal(runner_id, ws)
    assert len(_published(redis)) == 2


async def test_subscribe_still_gated_on_local_connection() -> None:
    """The subscribe path is deliberately NOT widened — pin that decision.

    Flipping this gate too would drop the accurate "runner is not connected"
    warning while the keystroke path (``send_terminal_to_runner``) stays
    locally gated, turning an honest warning into a per-keystroke error.
    """
    manager, redis = _make_manager()
    runner_id = str(uuid4())
    ws = _mobile_ws()

    connected = await manager.connect_mobile_terminal(runner_id, ws, uuid4())

    assert connected is False
    assert _published(redis) == []

    # The load-bearing half of one-in/one-out: this viewer never incremented
    # the runner's counter, so its disconnect must NOT publish an unsubscribe
    # — cross-replica, that frame would reach the runner and decrement a
    # count some OTHER viewer (on the replica holding the socket) is relying
    # on, switching that viewer's output off.
    await manager.disconnect_mobile_terminal(runner_id, ws)
    assert _published(redis) == []


async def test_unsubscribe_is_per_socket_not_per_runner() -> None:
    """Two viewers on one runner: each disconnect matches its own subscribe.

    The record is keyed by the viewer's socket, so a viewer whose subscribe
    was skipped leaving does not spend the subscribe a peer viewer published.
    """
    manager, redis = _make_manager()
    runner_id = str(uuid4())

    # Viewer A connects while the runner is elsewhere: no subscribe.
    ws_a = _mobile_ws()
    assert await manager.connect_mobile_terminal(runner_id, ws_a, uuid4()) is False
    assert _published(redis) == []

    # The runner lands here; viewer B connects and subscribes.
    _register_runner(manager, runner_id)
    ws_b = _mobile_ws()
    assert await manager.connect_mobile_terminal(runner_id, ws_b, uuid4()) is True
    assert [p[1]["type"] for p in _published(redis)] == ["terminal_subscribe"]

    # A leaves: nothing goes out, B's subscription stands.
    await manager.disconnect_mobile_terminal(runner_id, ws_a)
    assert [p[1]["type"] for p in _published(redis)] == ["terminal_subscribe"]

    # B leaves: exactly its own unsubscribe.
    await manager.disconnect_mobile_terminal(runner_id, ws_b)
    assert [p[1]["type"] for p in _published(redis)] == [
        "terminal_subscribe",
        "terminal_unsubscribe",
    ]


async def test_subscribe_published_when_runner_socket_is_local() -> None:
    """...and still fires normally when the socket IS local."""
    manager, redis = _make_manager()
    runner_id = str(uuid4())
    _register_runner(manager, runner_id)

    ws = _mobile_ws()
    connected = await manager.connect_mobile_terminal(runner_id, ws, uuid4())

    assert connected is True
    assert _published(redis) == [
        (
            f"runner:commands:{runner_id}",
            {"type": "terminal_subscribe", "runner_id": runner_id},
        )
    ]

    await manager.disconnect_mobile_terminal(runner_id, ws)
