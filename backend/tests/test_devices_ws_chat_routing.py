"""``devices_ws._route_device_message`` relays the runner's chat frames.

The router used to relay ``chat_response`` alone, so the runner's replies to
the chat requests the relay forwarded — ``chat_created`` (a refused spawn
included), ``chat_session_state``, ``chat_message_ack``, ``chat_output``, … —
fell through to ``devices_ws_unhandled_message`` and were dropped. A chat page
then never learned the run it had created and never saw its session go idle.

Pinned here:

1. every chat frame the runner sends reaches the device's chat sockets,
   verbatim, so the run each one names reaches the client intact;
2. ``error`` is relayed to them only when the runner attributed it to a chat
   run — an uncorrelated one stays on the fall-through, and one correlated by
   ``request_id`` stays on the terminal channel;
3. a secondary that does not own the device's relay pointer cannot speak for
   the device on chat;
4. a relayed frame reaches the chat sockets of THAT device and no other.

The frames are the runner's own wire shapes (qontinui-runner
``src-tauri/src/mcp/backend_relay.rs``: the ``handle_chat_*`` replies, and the
``ai-output`` / ``session-state`` broadcasts ``handle_outbound`` rewraps).
"""

from __future__ import annotations

import copy
import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints import devices_ws
from app.services.runner_websocket_manager import RunnerWebSocketManager


class _Manager:
    """Minimal stub for ``runner_websocket_manager`` used by the router."""

    def __init__(self, relay_socket: Any = None) -> None:
        self.send_terminal_response_to_mobiles = AsyncMock()
        self.send_response_to_frontends = AsyncMock()
        self.send_chat_response_to_mobiles = AsyncMock()
        self.get_websocket = lambda _id: relay_socket
        self.refresh_ttl = AsyncMock()


def _events(mock_logger_method: MagicMock) -> list[str]:
    """The event names a structlog mock was called with (first positional arg)."""
    return [c.args[0] for c in mock_logger_method.call_args_list if c.args]


_RUNNER_CHAT_FRAMES: list[tuple[str, dict[str, Any]]] = [
    (
        "chat_created-accepted",
        {
            "type": "chat_created",
            "id": "run-1",
            "task_name": "Digital Twin question",
            "state": "initializing",
        },
    ),
    (
        "chat_created-refused",
        {"type": "chat_created", "error": "spawn refused: the device is drained"},
    ),
    (
        "chat_session_state-reply",
        {
            "type": "chat_session_state",
            "task_run_id": "run-1",
            "state": "ready",
            "can_send": True,
            "can_interrupt": False,
            "session_id": "run-1",
            "user_interacted": True,
        },
    ),
    (
        "chat_session_state-broadcast",
        {
            "type": "chat_session_state",
            "data": {"taskRunId": "run-1", "sessionId": "run-1", "state": "ready"},
        },
    ),
    (
        "chat_message_ack-accepted",
        {
            "type": "chat_message_ack",
            "success": True,
            "queued": False,
            "task_run_id": "run-1",
            "state": "processing",
        },
    ),
    (
        "chat_message_ack-refused",
        {
            "type": "chat_message_ack",
            "success": False,
            "error": "No active session for task_run_id",
            "task_run_id": "run-1",
        },
    ),
    (
        "chat_running_tasks",
        {
            "type": "chat_running_tasks",
            "tasks": [
                {
                    "id": "run-1",
                    "task_name": "Digital Twin question",
                    "status": "running",
                    "created_at": "2026-10-11T08:00:00Z",
                }
            ],
        },
    ),
    (
        "chat_output",
        {
            "type": "chat_output",
            "task_run_id": "run-1",
            "output_log": "\n[USER_MESSAGE]\nhello\n[/USER_MESSAGE]\n",
        },
    ),
    (
        "chat_renamed",
        {"type": "chat_renamed", "task_run_id": "run-1", "new_name": "Twin Q&A"},
    ),
    (
        "chat_workflow_generated",
        {
            "type": "chat_workflow_generated",
            "task_run_id": "run-1",
            "success": False,
            "error": "No conversation history available",
        },
    ),
    (
        "chat_response-broadcast",
        {
            "type": "chat_response",
            "data": {
                "id": "out-1",
                "timestamp": 1760169600,
                "line": "The twin reports 3 open PRs.",
                "source": "claude",
                "taskRunId": "run-1",
                "sessionId": "run-1",
            },
        },
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "frame",
    [f for _, f in _RUNNER_CHAT_FRAMES],
    ids=[name for name, _ in _RUNNER_CHAT_FRAMES],
)
async def test_runner_chat_frames_reach_the_devices_chat_sockets(
    frame: dict[str, Any],
) -> None:
    """Each frame is relayed to the device's chat sockets once, unaltered."""
    expected = copy.deepcopy(frame)
    manager = _Manager()

    await devices_ws._route_device_message(frame, "dev-1", "user-1", manager)

    manager.send_chat_response_to_mobiles.assert_awaited_once_with("dev-1", expected)
    manager.send_response_to_frontends.assert_not_called()
    manager.send_terminal_response_to_mobiles.assert_not_called()


@pytest.mark.asyncio
async def test_an_error_about_a_chat_run_reaches_the_chat_sockets() -> None:
    """``handle_chat_interrupt`` names the run it could not interrupt."""
    frame = {
        "type": "error",
        "task_run_id": "run-1",
        "error": "No active session for task_run_id",
    }
    expected = copy.deepcopy(frame)
    manager = _Manager()

    await devices_ws._route_device_message(frame, "dev-1", "user-1", manager)

    manager.send_chat_response_to_mobiles.assert_awaited_once_with("dev-1", expected)
    manager.send_terminal_response_to_mobiles.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "frame",
    [
        # A chat handler's refusal of a request that named no run.
        {"type": "error", "error": "Missing task_run_id"},
        # The runner's refusal of a `remote` block on a non-remote type.
        {
            "type": "error",
            "code": "remote_type_not_admitted",
            "message": "`chat_create` may not carry a remote block",
        },
        # Run fields that name nothing.
        {"type": "error", "task_run_id": "", "error": "x"},
        {"type": "error", "task_run_id": None, "error": "x"},
        {"type": "error", "task_run_id": 42, "error": "x"},
    ],
    ids=["chat-no-run", "remote-refusal", "empty-run", "null-run", "non-string-run"],
)
async def test_an_error_naming_no_chat_run_stays_off_the_chat_sockets(
    frame: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Uncorrelated: nothing on it says which socket's request it answers."""
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)
    manager = _Manager()

    await devices_ws._route_device_message(frame, "dev-1", "user-1", manager)

    manager.send_chat_response_to_mobiles.assert_not_called()
    manager.send_terminal_response_to_mobiles.assert_not_called()
    assert "devices_ws_unhandled_message" in _events(fake_logger.debug)


@pytest.mark.asyncio
async def test_a_request_correlated_error_stays_on_the_terminal_channel() -> None:
    """A terminal-RPC failure is the terminal arm's, never chat's."""
    frame = {
        "type": "error",
        "message": "Terminal not found: term-1",
        "request_id": "req-1",
    }
    manager = _Manager()

    await devices_ws._route_device_message(frame, "dev-1", "user-1", manager)

    manager.send_terminal_response_to_mobiles.assert_awaited_once_with("dev-1", frame)
    manager.send_chat_response_to_mobiles.assert_not_called()


@pytest.mark.asyncio
async def test_a_request_id_outranks_a_run_id_on_an_error() -> None:
    """A caller is waiting on that ``request_id``; the frame goes to it, once,
    and is not ALSO handed to the chat sockets."""
    frame = {
        "type": "error",
        "message": "Failed to close terminal: gone",
        "request_id": "req-2",
        "task_run_id": "run-1",
    }
    manager = _Manager()

    await devices_ws._route_device_message(frame, "dev-1", "user-1", manager)

    manager.send_terminal_response_to_mobiles.assert_awaited_once_with("dev-1", frame)
    manager.send_chat_response_to_mobiles.assert_not_called()


@pytest.mark.asyncio
async def test_an_unknown_chat_type_still_hits_the_fallthrough(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Control: the set is closed, so the assertions above mean something."""
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)
    manager = _Manager()

    await devices_ws._route_device_message(
        {"type": "chat_created_typo", "id": "run-1"}, "dev-1", "user-1", manager
    )

    manager.send_chat_response_to_mobiles.assert_not_called()
    assert "devices_ws_unhandled_message" in _events(fake_logger.debug)


@pytest.mark.asyncio
async def test_a_secondary_without_the_relay_pointer_cannot_speak_on_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Its replies are not the device's, so they must not reach the device's
    chat sockets as if they were."""
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)
    secondary_socket, pointer_owner = object(), object()
    manager = _Manager(relay_socket=pointer_owner)

    await devices_ws._route_device_message(
        {"type": "chat_created", "id": "run-9", "state": "initializing"},
        "dev-1",
        "user-1",
        manager,
        7,
        secondary_socket,
        instance_role="secondary",
    )

    manager.send_chat_response_to_mobiles.assert_not_called()
    assert "devices_ws_secondary_frame_dropped" in _events(fake_logger.debug)


@pytest.mark.asyncio
async def test_a_secondary_holding_the_relay_pointer_is_relayed_like_a_primary() -> (
    None
):
    """A lone secondary that claimed the pointer IS the device's relay socket."""
    socket = object()
    manager = _Manager(relay_socket=socket)
    frame = {"type": "chat_session_state", "task_run_id": "run-1", "state": "ready"}

    await devices_ws._route_device_message(
        frame, "dev-1", "user-1", manager, 7, socket, instance_role="secondary"
    )

    manager.send_chat_response_to_mobiles.assert_awaited_once_with("dev-1", frame)


# ---------------------------------------------------------------------------
# Scope: through the real manager and chat relay, a relayed frame reaches the
# chat sockets of the device that sent it and no other device's.
# ---------------------------------------------------------------------------


class _PubSub:
    """One subscriber on :class:`_Redis`.

    ``listen`` delivers every message published on the subscribed channel and
    then ends — a replay rather than live fan-out, because what this test pins
    is WHICH channel a frame lands on, not when.
    """

    def __init__(self, redis: _Redis) -> None:
        self._redis = redis
        self._channel: str | None = None

    async def subscribe(self, channel: str) -> None:
        self._channel = channel

    async def unsubscribe(self, channel: str) -> None:
        self._channel = None

    async def close(self) -> None:
        return None

    async def listen(self) -> AsyncIterator[dict[str, Any]]:
        for channel, data in list(self._redis.published):
            if channel == self._channel:
                yield {"type": "message", "data": data}


class _Redis:
    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1

    def pubsub(self) -> _PubSub:
        return _PubSub(self)


class _ChatSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)


@pytest.mark.asyncio
async def test_a_relayed_chat_frame_reaches_only_its_own_devices_chat_sockets() -> None:
    redis = _Redis()
    manager = RunnerWebSocketManager(redis)  # type: ignore[arg-type]
    device, other_device = uuid4(), uuid4()
    frame = {"type": "chat_created", "id": "run-1", "state": "initializing"}

    await devices_ws._route_device_message(
        copy.deepcopy(frame), device, uuid4(), manager
    )

    assert [channel for channel, _ in redis.published] == [
        f"runner:chat_response:{device}"
    ]

    own_socket, other_socket = _ChatSocket(), _ChatSocket()
    relay = manager._chat_relay
    await relay._listen_for_responses(str(device), own_socket, "own")  # type: ignore[arg-type]
    await relay._listen_for_responses(str(other_device), other_socket, "other")  # type: ignore[arg-type]

    assert own_socket.sent == [frame]
    assert other_socket.sent == []
    assert json.loads(redis.published[0][1]) == frame
