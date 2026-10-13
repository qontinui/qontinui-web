"""``devices_ws._route_device_message`` relays the runner's chat frames.

The router used to relay ``chat_response`` alone, so the runner's replies to
the chat requests the relay forwarded — ``chat_created`` (a refused spawn
included), ``chat_session_state``, ``chat_message_ack``, ``chat_output``, … —
fell through to ``devices_ws_unhandled_message`` and were dropped. A chat page
then never learned the run it had created.

Pinned here:

1. every chat frame the runner sends reaches the device's chat sockets,
   verbatim, so the run each one names reaches the client intact;
2. ``error`` is relayed to them only when the runner attributed it to a chat
   run — an uncorrelated one stays on the fall-through, and one correlated by
   ``request_id`` stays on the terminal channel;
3. a frame of any OTHER type is not chat's because it names a run: it stays on
   the arm its type selects, though the chat arm sits above them all;
4. a secondary that does not own the device's relay pointer cannot speak for
   the device on chat;
5. a relayed frame is published on THAT device's chat channel, and only a
   chat socket ``runner_chat_ws.py`` admitted for the device's owner is
   subscribed to it.

The frames are the runner's own wire shapes (qontinui-runner
``src-tauri/src/mcp/backend_relay.rs``: the ``handle_chat_*`` replies, and the
``ai-output`` broadcast ``handle_outbound`` rewraps as ``chat_response``).
``handle_outbound`` would rewrap a ``session-state`` broadcast as a
``chat_session_state`` too, but nothing on the runner produces that broadcast
(qontinui-runner c40d7ebd1, 2026-10-11), so no such shape is pinned here.
"""

from __future__ import annotations

import copy
import json
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import WebSocketDisconnect, status
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import BinaryExpression, BooleanClauseList
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import devices_ws, runner_chat_ws
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
    # The ``ai-output`` broadcast (``mcp/shared.rs`` ``AiOutputEvent``). A
    # relay chat session is spawned without a session context, so its own
    # output names no run; a workflow agent's output names its run.
    (
        "chat_response-relay-chat",
        {
            "type": "chat_response",
            "data": {
                "id": "ai-1760169600000-17",
                "timestamp": 1760169600000,
                "line": "The twin reports 3 open PRs.",
                "source": "claude",
                "actionId": None,
                "taskRunId": None,
                "sessionId": None,
                "sessionName": None,
                "phase": None,
                "phaseIteration": None,
            },
        },
    ),
    (
        "chat_response-workflow-agent",
        {
            "type": "chat_response",
            "data": {
                "id": "ai-1760169600001-18",
                "timestamp": 1760169600001,
                "line": "Running the verification phase.",
                "source": "claude",
                "actionId": None,
                "taskRunId": "run-7",
                "sessionId": "run-7-agentic-1",
                "sessionName": "Fix login",
                "phase": "agentic",
                "phaseIteration": 1,
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
@pytest.mark.parametrize(
    ("frame", "lands_on"),
    [
        (
            {
                "type": "terminal_output",
                "terminal_id": "t1",
                "data": "x",
                "task_run_id": "run-1",
            },
            "terminal",
        ),
        (
            {"type": "terminal_sessions", "terminals": [], "task_run_id": "run-1"},
            "terminal",
        ),
        (
            {"type": "devenv_enroll_ack", "ok": True, "task_run_id": "run-1"},
            "devenv_enroll_ack",
        ),
        ({"type": "runner_frame_nobody_routes", "task_run_id": "run-1"}, "unhandled"),
    ],
    ids=["terminal_output", "terminal-rpc-reply", "devenv_enroll_ack", "unknown-type"],
)
async def test_a_non_error_frame_naming_a_run_is_not_chats(
    frame: dict[str, Any], lands_on: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``error`` is the one type chat borrows from the shared vocabulary.

    A ``task_run_id`` on any other type does not make the frame chat's: it
    stays on the arm its type selects, even though the chat arm sits above
    every one of them.
    """
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)
    expected = copy.deepcopy(frame)
    manager = _Manager()

    await devices_ws._route_device_message(frame, "dev-1", "user-1", manager)

    manager.send_chat_response_to_mobiles.assert_not_called()
    if lands_on == "terminal":
        manager.send_terminal_response_to_mobiles.assert_awaited_once_with(
            "dev-1", expected
        )
    else:
        manager.send_terminal_response_to_mobiles.assert_not_called()
    if lands_on == "devenv_enroll_ack":
        assert "devices_ws_devenv_enroll_ack" in _events(fake_logger.info)
    if lands_on == "unhandled":
        assert "devices_ws_unhandled_message" in _events(fake_logger.debug)


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
# Scope, half 1: through the real manager and chat relay, a relayed frame is
# published on the chat channel of the device that sent it.
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
async def test_a_relayed_chat_frame_is_published_on_its_own_devices_chat_channel() -> (
    None
):
    redis = _Redis()
    manager = RunnerWebSocketManager(redis)  # type: ignore[arg-type]
    device = uuid4()
    frame = {"type": "chat_created", "id": "run-1", "state": "initializing"}

    await devices_ws._route_device_message(
        copy.deepcopy(frame), device, uuid4(), manager
    )

    assert [channel for channel, _ in redis.published] == [
        f"runner:chat_response:{device}"
    ]
    assert json.loads(redis.published[0][1]) == frame

    chat_socket = _ChatSocket()
    await manager._chat_relay._listen_for_responses(str(device), chat_socket, "own")  # type: ignore[arg-type]
    assert chat_socket.sent == [frame]


# ---------------------------------------------------------------------------
# Scope, half 2: who may subscribe to that channel. The channel is named by
# the device id alone, so a channel name keeps no one out; what keeps another
# user's socket off it is the ownership check ``runner_chat_ws.py`` makes
# before it subscribes a socket. Driven through the real endpoint.
# ---------------------------------------------------------------------------

_OWNER = uuid4()
_STRANGER = uuid4()
_CHAT_DEVICE = uuid4()


def _where_equalities(stmt: Any) -> dict[str, Any]:
    """A SELECT's ``column == value`` WHERE criteria, keyed by column.

    Any other criterion shape fails here, loudly, so a rewritten query cannot
    pass by matching nothing this helper understands.
    """
    where = stmt.whereclause
    clauses = list(where.clauses) if isinstance(where, BooleanClauseList) else [where]
    equalities: dict[str, Any] = {}
    for clause in clauses:
        assert isinstance(clause, BinaryExpression), clause
        assert clause.operator is operators.eq, clause
        equalities[clause.left.key] = clause.right.value
    return equalities


class _DeviceTable:
    """``AsyncSessionLocal`` over an in-memory ``devices`` table.

    It applies the endpoint's OWN query to its rows, so what is measured is
    the query the endpoint builds: drop a criterion from it and a row it must
    not see comes back.
    """

    def __init__(self, *rows: SimpleNamespace) -> None:
        self._rows = rows

    def __call__(self) -> _DeviceTable:
        return self

    async def __aenter__(self) -> _DeviceTable:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def execute(self, stmt: Any) -> MagicMock:
        wanted = _where_equalities(stmt)
        matches = [
            row
            for row in self._rows
            if all(getattr(row, key) == value for key, value in wanted.items())
        ]
        result = MagicMock()
        result.scalar_one_or_none.return_value = matches[0] if matches else None
        return result


class _ChatClient:
    """A chat client at the handshake; once admitted it hangs up at once."""

    def __init__(self) -> None:
        self.cookies: dict[str, str] = {}
        self.client_state = WebSocketState.CONNECTED
        self.application_state = WebSocketState.CONNECTED
        self.sent: list[dict[str, Any]] = []
        self.close_codes: list[int] = []

    async def accept(self) -> None:
        return None

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)

    async def receive_json(self) -> dict[str, Any]:
        raise WebSocketDisconnect(code=1000)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.close_codes.append(code)
        self.application_state = WebSocketState.DISCONNECTED


async def _open_chat_socket(
    monkeypatch: pytest.MonkeyPatch, caller: Any
) -> tuple[_ChatClient, MagicMock]:
    """Open ``/devices/{_CHAT_DEVICE}/chat`` as ``caller``; the device is
    ``_OWNER``'s."""
    manager = MagicMock()
    manager.is_connected = MagicMock(return_value=True)
    manager.connect_mobile_chat = AsyncMock()
    manager.disconnect_mobile_chat = AsyncMock()
    monkeypatch.setattr(
        runner_chat_ws,
        "get_current_user_from_ws",
        AsyncMock(return_value=SimpleNamespace(id=caller)),
    )
    monkeypatch.setattr(
        runner_chat_ws,
        "AsyncSessionLocal",
        _DeviceTable(SimpleNamespace(device_id=_CHAT_DEVICE, user_id=_OWNER)),
    )
    monkeypatch.setattr(runner_chat_ws, "get_redis", AsyncMock(return_value=None))
    monkeypatch.setattr(
        runner_chat_ws,
        "get_runner_websocket_manager",
        AsyncMock(return_value=manager),
    )
    client = _ChatClient()

    await runner_chat_ws.websocket_runner_chat_endpoint(
        client,  # type: ignore[arg-type]
        runner_id=_CHAT_DEVICE,
        token="a-valid-user-token",
    )
    return client, manager


@pytest.mark.asyncio
async def test_a_user_who_does_not_own_the_device_is_never_subscribed_to_its_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, manager = await _open_chat_socket(monkeypatch, caller=_STRANGER)

    manager.connect_mobile_chat.assert_not_called()
    assert client.sent == [
        {"type": "error", "message": "Runner not found or not owned by you"}
    ]
    assert client.close_codes[0] == status.WS_1008_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_the_devices_owner_is_subscribed_to_its_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Control: the same harness admits the owner, so the refusal above is
    the ownership check and not a harness that admits no one."""
    client, manager = await _open_chat_socket(monkeypatch, caller=_OWNER)

    manager.connect_mobile_chat.assert_awaited_once_with(_CHAT_DEVICE, client, _OWNER)
    assert client.sent[0]["type"] == "connected"
