"""Regression tests for the runner-WS pubsub-sharing fix.

Root cause (prod ``wsConnected`` flap): ``RunnerWebSocketManager.register``
used to open THREE dedicated Redis pubsub connections per runner — one each
for the command / chat / terminal runner-direction listeners. Under
runner-reconnect churn that 3x amplification exhausted the connection pool
(``ConnectionError: Too many connections``), aborting registration and closing
the socket, a self-reinforcing leak.

The fix collapses those three to ONE shared, multiplexed pubsub connection per
runner. These tests assert:

- ``register`` opens exactly ONE pubsub and subscribes it to all three
  runner-direction channels.
- ``unregister`` cancels the shared listener and closes that one pubsub.
- the inbound listener forwards a frame from ANY of the three channels to the
  runner WS (routing preserved).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.runner_websocket_manager import RunnerWebSocketManager

pytestmark = pytest.mark.asyncio


class _FakePubSub:
    """Stub for ``redis.asyncio.client.PubSub`` driven by an injected queue."""

    def __init__(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._queue = queue
        self.subscribed: list[str] = []
        self.unsubscribed_called = False
        self.closed = False

    async def subscribe(self, *channels: str) -> None:
        self.subscribed.extend(channels)

    async def unsubscribe(self, *channels: str) -> None:  # noqa: ARG002
        self.unsubscribed_called = True

    async def close(self) -> None:
        self.closed = True

    async def listen(self):
        # Yield queued messages, then block forever (until the task is
        # cancelled) — mirrors a live pubsub that idles between messages.
        while True:
            msg = await self._queue.get()
            yield msg


def _make_manager() -> tuple[RunnerWebSocketManager, list[_FakePubSub], MagicMock]:
    """Build a manager with a mocked Redis whose ``pubsub()`` is tracked."""
    created: list[_FakePubSub] = []
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def _make_pubsub() -> _FakePubSub:
        ps = _FakePubSub(queue)
        created.append(ps)
        return ps

    redis = MagicMock()
    redis.pubsub = MagicMock(side_effect=_make_pubsub)
    # State-repo + user-mapping writes used by register().
    redis.set = AsyncMock(return_value=True)
    redis.sadd = AsyncMock(return_value=1)
    redis.expire = AsyncMock(return_value=True)
    redis.delete = AsyncMock(return_value=1)
    redis.exists = AsyncMock(return_value=1)
    redis.publish = AsyncMock(return_value=1)
    redis.smembers = AsyncMock(return_value=set())
    redis.srem = AsyncMock(return_value=1)

    manager = RunnerWebSocketManager(redis)
    # Expose the shared inbound queue so a test can push a frame.
    manager._test_inbound_queue = queue  # type: ignore[attr-defined]
    return manager, created, redis


async def test_register_opens_single_pubsub_per_runner() -> None:
    """register() must open exactly ONE pubsub, subscribed to all 3 channels."""
    manager, created, _redis = _make_manager()
    runner_id = str(uuid4())
    ws = MagicMock()
    ws.send_json = AsyncMock()

    await manager.register(runner_id, ws, uuid4(), runner_name="r1")
    try:
        # The load-bearing assertion: 3 dedicated pubsubs -> 1 shared one.
        assert len(created) == 1
        ps = created[0]
        assert set(ps.subscribed) == {
            f"runner:commands:{runner_id}",
            f"runner:chat:{runner_id}",
            f"runner:terminal:{runner_id}",
        }
        assert runner_id in manager._inbound_listeners  # type: ignore[attr-defined]
    finally:
        await manager.unregister(runner_id)


async def test_unregister_cancels_and_closes_shared_pubsub() -> None:
    """unregister() cancels the listener and closes the single pubsub."""
    manager, created, _redis = _make_manager()
    runner_id = str(uuid4())
    ws = MagicMock()
    ws.send_json = AsyncMock()

    await manager.register(runner_id, ws, uuid4())
    assert len(created) == 1
    _pubsub, task = manager._inbound_listeners[runner_id]  # type: ignore[attr-defined]

    await manager.unregister(runner_id)
    # Listener entry gone immediately; the task is cancelled.
    assert runner_id not in manager._inbound_listeners  # type: ignore[attr-defined]
    # Await the cancelled task so its ``finally`` runs pubsub.close(). The
    # listener swallows CancelledError (logs + cleans up), so awaiting it
    # completes normally rather than re-raising.
    try:
        await task
    except asyncio.CancelledError:
        pass
    assert created[0].closed is True
    assert created[0].unsubscribed_called is True


@pytest.mark.parametrize("channel_kind", ["commands", "chat", "terminal"])
async def test_inbound_listener_forwards_any_channel(channel_kind: str) -> None:
    """A frame on any multiplexed channel is forwarded to the runner WS."""
    manager, created, _redis = _make_manager()
    runner_id = str(uuid4())
    ws = MagicMock()
    forwarded: asyncio.Future[dict[str, Any]] = (
        asyncio.get_running_loop().create_future()
    )

    async def _capture(data: dict[str, Any]) -> None:
        if not forwarded.done():
            forwarded.set_result(data)

    ws.send_json = AsyncMock(side_effect=_capture)

    await manager.register(runner_id, ws, uuid4())
    try:
        frame = {"type": channel_kind, "hello": "world"}
        await manager._test_inbound_queue.put(  # type: ignore[attr-defined]
            {"type": "message", "data": json.dumps(frame)}
        )
        result = await asyncio.wait_for(forwarded, timeout=2.0)
        assert result == frame
    finally:
        await manager.unregister(runner_id)


async def test_rollback_on_register_failure_closes_pubsub() -> None:
    """If a post-listener step fails, the shared pubsub is torn down (no leak)."""
    manager, created, redis = _make_manager()
    runner_id = str(uuid4())
    ws = MagicMock()
    ws.send_json = AsyncMock()

    # Make the user-mapping write fail AFTER save_connection_state but the
    # listener is started after both — so force the failure at listener start
    # by making pubsub.subscribe raise on the (single) shared pubsub.
    original_pubsub = redis.pubsub.side_effect

    def _boom_pubsub() -> _FakePubSub:
        ps = original_pubsub()
        ps.subscribe = AsyncMock(side_effect=RuntimeError("Too many connections"))
        return ps

    redis.pubsub = MagicMock(side_effect=_boom_pubsub)

    with pytest.raises(RuntimeError, match="Too many connections"):
        await manager.register(runner_id, ws, uuid4())

    # Nothing left registered after the all-or-nothing rollback.
    assert runner_id not in manager._inbound_listeners  # type: ignore[attr-defined]
    assert manager.is_connected(runner_id) is False
