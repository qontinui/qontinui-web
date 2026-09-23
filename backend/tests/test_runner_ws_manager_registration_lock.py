"""``RunnerWebSocketManager`` serialises a socket's teardown against a newer registration.

The registry is keyed on ``runner_id`` (the device) ALONE, and both
``register`` and ``unregister`` span several awaits (Redis state, the pubsub
listener). An older socket's teardown that decided "still mine" and then
awaited could therefore interleave with a newer socket's registration and tear
the newer one down. ``unregister_if_current`` makes the compare and the whole
teardown one step under a per-runner lock; these tests drive the interleave
against the real manager with its Redis-facing collaborators stubbed.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.runner_websocket_manager import RunnerWebSocketManager

pytestmark = pytest.mark.asyncio


def _manager() -> RunnerWebSocketManager:
    mgr = RunnerWebSocketManager(MagicMock())
    mgr._state_repo = MagicMock()
    mgr._state_repo.save_connection_state = AsyncMock()
    mgr._state_repo.delete_connection_state = AsyncMock()
    mgr._state_repo.get_connection_metadata = AsyncMock(return_value=None)
    mgr._save_user_runner_mapping = AsyncMock()  # type: ignore[method-assign]
    mgr._remove_user_runner_mapping = AsyncMock()  # type: ignore[method-assign]
    mgr._start_inbound_listener = AsyncMock()  # type: ignore[method-assign]
    mgr._stop_inbound_listener = AsyncMock()  # type: ignore[method-assign]
    mgr._chat_relay = MagicMock(notify_mobiles=AsyncMock())
    mgr._terminal_relay = MagicMock(notify_mobiles=AsyncMock())
    mgr._relay = MagicMock(notify_frontends=AsyncMock())
    return mgr


async def test_newer_registration_during_an_old_teardown_survives() -> None:
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    old, new = object(), object()
    await mgr.register(runner_id=rid, websocket=old, user_id=user)  # type: ignore[arg-type]

    # Suspend the OLD teardown inside its first Redis await.
    gate = asyncio.Event()
    entered = asyncio.Event()

    async def _slow_delete(_rid: Any) -> None:
        entered.set()
        await gate.wait()

    mgr._state_repo.delete_connection_state = AsyncMock(side_effect=_slow_delete)

    teardown = asyncio.create_task(mgr.unregister_if_current(rid, old, user))  # type: ignore[arg-type]
    await asyncio.wait_for(entered.wait(), timeout=2)
    newer = asyncio.create_task(
        mgr.register(runner_id=rid, websocket=new, user_id=user)  # type: ignore[arg-type]
    )
    await asyncio.sleep(0.05)
    assert not newer.done(), "the newer registration must wait for the teardown"

    mgr._state_repo.delete_connection_state = AsyncMock()
    gate.set()
    assert await asyncio.wait_for(teardown, timeout=2) is True
    await asyncio.wait_for(newer, timeout=2)

    assert mgr.get_websocket(rid) is new, (
        "the older socket's teardown destroyed the newer socket's registration"
    )


async def test_teardown_after_a_newer_registration_is_a_no_op() -> None:
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    old, new = object(), object()
    await mgr.register(runner_id=rid, websocket=old, user_id=user)  # type: ignore[arg-type]
    await mgr.register(runner_id=rid, websocket=new, user_id=user)  # type: ignore[arg-type]
    mgr._stop_inbound_listener.reset_mock()  # type: ignore[attr-defined]

    assert await mgr.unregister_if_current(rid, old, user) is False  # type: ignore[arg-type]

    assert mgr.get_websocket(rid) is new
    mgr._stop_inbound_listener.assert_not_awaited()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Takeover (H-A) — a real listener over an in-memory pubsub
# ---------------------------------------------------------------------------


class _FakePubSub:
    def __init__(self, bus: _FakeBus) -> None:
        self._bus = bus
        self.channels: list[str] = []
        self.queue: asyncio.Queue[Any] = asyncio.Queue()
        self.closed = False

    async def subscribe(self, *channels: str) -> None:
        self.channels = list(channels)
        self._bus.subs.append(self)

    async def listen(self) -> Any:
        while True:
            item = await self.queue.get()
            yield item

    async def unsubscribe(self) -> None:
        if self in self._bus.subs:
            self._bus.subs.remove(self)

    async def close(self) -> None:
        self.closed = True
        await self.unsubscribe()


class _FakeBus:
    """Just enough of redis pubsub for the manager's inbound listener."""

    def __init__(self) -> None:
        self.subs: list[_FakePubSub] = []

    def pubsub(self) -> _FakePubSub:
        return _FakePubSub(self)

    def publish(self, channel: str, frame: dict[str, Any]) -> None:
        import json

        for sub in list(self.subs):
            if channel in sub.channels:
                sub.queue.put_nowait({"type": "message", "data": json.dumps(frame)})


class _Sock:
    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []

    async def send_json(self, frame: dict[str, Any]) -> None:
        self.received.append(frame)


def _manager_on(bus: _FakeBus) -> RunnerWebSocketManager:
    mgr = _manager()
    mgr._redis = bus  # type: ignore[assignment]
    del mgr._start_inbound_listener  # use the real listener
    del mgr._stop_inbound_listener
    return mgr


async def test_a_takeover_stops_the_previous_sockets_listener() -> None:
    bus = _FakeBus()
    mgr = _manager_on(bus)
    rid, user = uuid4(), uuid4()
    secondary, primary = _Sock(), _Sock()
    await mgr.register(runner_id=rid, websocket=secondary, user_id=user)  # type: ignore[arg-type]
    old_pubsub = bus.subs[0]

    await mgr.register(runner_id=rid, websocket=primary, user_id=user)  # type: ignore[arg-type]

    bus.publish(mgr._relay.runner_channel(str(rid)), {"type": "http_request", "n": 1})
    await asyncio.sleep(0.05)
    assert primary.received == [{"type": "http_request", "n": 1}]
    assert secondary.received == [], (
        "the replaced socket's listener still forwarded a relayed command — "
        "both runners would execute it"
    )
    assert old_pubsub.closed, "the replaced listener's pubsub leaked"
    assert len(bus.subs) == 1
    await mgr.unregister(rid, user)


# ---------------------------------------------------------------------------
# register_if_unowned (M-A)
# ---------------------------------------------------------------------------


async def _yes() -> bool:
    return True


async def _no() -> bool:
    return False


async def test_register_if_unowned_refuses_when_another_socket_holds_it() -> None:
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    primary, secondary = object(), object()
    await mgr.register(runner_id=rid, websocket=primary, user_id=user)  # type: ignore[arg-type]
    ok = await mgr.register_if_unowned(rid, secondary, user, _yes)  # type: ignore[arg-type]
    assert ok is False
    assert mgr.get_websocket(rid) is primary


async def test_register_if_unowned_refuses_when_the_claim_moved() -> None:
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    secondary = object()
    assert await mgr.register_if_unowned(rid, secondary, user, _no) is False  # type: ignore[arg-type]
    assert mgr.get_websocket(rid) is None


async def test_a_primary_registering_during_a_secondary_claim_wins() -> None:
    """The interleave: DB pointer moves to the primary while the secondary is
    between its claim and its registration; the primary must end up owning
    the manager too."""
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    primary, secondary = object(), object()
    pointer = {"owner": "secondary"}
    checking = asyncio.Event()
    release = asyncio.Event()

    async def _entitled() -> bool:
        checking.set()
        await release.wait()
        return pointer["owner"] == "secondary"

    claim = asyncio.create_task(
        mgr.register_if_unowned(rid, secondary, user, _entitled)  # type: ignore[arg-type]
    )
    await asyncio.wait_for(checking.wait(), timeout=2)
    pointer["owner"] = "primary"  # the primary's DB write
    prim = asyncio.create_task(
        mgr.register(runner_id=rid, websocket=primary, user_id=user)  # type: ignore[arg-type]
    )
    await asyncio.sleep(0.05)
    release.set()
    assert await asyncio.wait_for(claim, timeout=2) is False
    await asyncio.wait_for(prim, timeout=2)
    assert mgr.get_websocket(rid) is primary


async def test_frontend_notifications_run_outside_the_registration_lock() -> None:
    """L-B: a slow browser must not hold the device's registration lock."""
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    sock = object()
    await mgr.register(runner_id=rid, websocket=sock, user_id=user)  # type: ignore[arg-type]
    seen: dict[str, bool] = {}

    async def _notify(runner_id: str, message: dict[str, Any]) -> None:
        seen["locked"] = mgr._registration_lock(runner_id).locked()

    mgr._relay = MagicMock(notify_frontends=AsyncMock(side_effect=_notify))
    assert await mgr.unregister_if_current(rid, sock, user) is True  # type: ignore[arg-type]
    assert seen == {"locked": False}


# ---------------------------------------------------------------------------
# Round-3 lows
# ---------------------------------------------------------------------------


async def test_no_late_disconnect_notice_after_a_reconnect() -> None:
    """L1: a socket registering while notices go out suppresses the rest."""
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    old, new = object(), object()
    await mgr.register(runner_id=rid, websocket=old, user_id=user)  # type: ignore[arg-type]

    async def _first_notice_then_reconnect(runner_id: str, message: Any) -> None:
        # The runner reconnects while the first notice is in flight.
        mgr._registry.register_runner(runner_id, new)  # type: ignore[arg-type]

    mgr._chat_relay = MagicMock(
        notify_mobiles=AsyncMock(side_effect=_first_notice_then_reconnect)
    )
    mgr._terminal_relay = MagicMock(notify_mobiles=AsyncMock())
    mgr._relay = MagicMock(notify_frontends=AsyncMock())

    assert await mgr.unregister_if_current(rid, old, user) is True  # type: ignore[arg-type]

    mgr._terminal_relay.notify_mobiles.assert_not_awaited()
    mgr._relay.notify_frontends.assert_not_awaited()


async def test_no_disconnect_notice_when_already_replaced_before_notifying() -> None:
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    old, new = object(), object()
    await mgr.register(runner_id=rid, websocket=old, user_id=user)  # type: ignore[arg-type]
    real_unlocked = mgr._unregister_unlocked

    async def _then_reconnect(r: str, u: Any = None) -> None:
        await real_unlocked(r, u)
        mgr._registry.register_runner(r, new)  # type: ignore[arg-type]

    mgr._unregister_unlocked = _then_reconnect  # type: ignore[method-assign]
    assert await mgr.unregister_if_current(rid, old, user) is True  # type: ignore[arg-type]
    mgr._chat_relay.notify_mobiles.assert_not_awaited()  # type: ignore[attr-defined]
    mgr._relay.notify_frontends.assert_not_awaited()  # type: ignore[attr-defined]


async def test_in_process_teardown_survives_a_redis_timeout() -> None:
    """L3: the registry entry, listener and send lock go even if Redis hangs."""
    mgr = _manager()
    rid, user = uuid4(), uuid4()
    sock = object()
    await mgr.register(runner_id=rid, websocket=sock, user_id=user)  # type: ignore[arg-type]
    mgr._state_repo.delete_connection_state = AsyncMock(side_effect=TimeoutError())

    assert await mgr.unregister_if_current(rid, sock, user) is True  # type: ignore[arg-type]

    assert mgr.get_websocket(rid) is None
    mgr._stop_inbound_listener.assert_awaited()  # type: ignore[attr-defined]
    assert str(rid) not in mgr._ws_send_locks
