"""Unit tests for ``devices_ws._route_device_message`` terminal-response routing.

These tests pin the post-iter-4 fix that adds routing for the runner-emitted
terminal RPC reply types (``terminal_sessions``, ``terminal_created``,
``terminal_closed``, ``terminal_buffer_response``) plus correlated errors
(``error`` with a ``request_id``) so they reach the mobile via the terminal
response channel.

Before the fix, only ``terminal_response``, ``terminal_output``, and
``terminal_exit`` were routed; the request/response RPC replies fell through
to ``devices_ws_unhandled_message`` and were silently dropped, causing the
mobile ``RemoteTerminalClient.sendRequest`` to always time out.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.api.v1.endpoints import devices_ws


class _Manager:
    """Minimal stub for ``runner_websocket_manager`` used by the router."""

    def __init__(self) -> None:
        self.send_terminal_response_to_mobiles = AsyncMock()
        self.send_response_to_frontends = AsyncMock()
        self.send_chat_response_to_mobiles = AsyncMock()
        self.get_websocket = lambda _id: None
        self.refresh_ttl = AsyncMock()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "msg_type",
    [
        "terminal_sessions",
        "terminal_created",
        "terminal_closed",
        "terminal_buffer_response",
    ],
)
async def test_runner_terminal_rpc_replies_route_to_mobiles(msg_type: str) -> None:
    """Each runner→backend terminal RPC reply type must reach the mobile."""
    manager = _Manager()
    msg: dict[str, Any] = {
        "type": msg_type,
        "request_id": "abc-123",
    }
    await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)

    manager.send_terminal_response_to_mobiles.assert_awaited_once_with("dev-1", msg)


@pytest.mark.asyncio
async def test_correlated_error_routes_to_mobile() -> None:
    """``error`` with ``request_id`` is a correlated terminal-RPC failure.

    It must reach the mobile so the pending-request promise can reject
    without spinning until the 10s client-side timeout.
    """
    manager = _Manager()
    msg = {
        "type": "error",
        "message": "Unknown terminal_id",
        "request_id": "xyz-9",
    }
    await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)

    manager.send_terminal_response_to_mobiles.assert_awaited_once_with("dev-1", msg)


@pytest.mark.asyncio
async def test_uncorrelated_error_does_not_route_to_mobile() -> None:
    """Generic ``error`` without ``request_id`` is not a terminal reply and
    must NOT be routed to the mobile terminal channel (it would surface as a
    spurious terminal toast).
    """
    manager = _Manager()
    msg = {"type": "error", "message": "Generic error"}
    await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)

    manager.send_terminal_response_to_mobiles.assert_not_called()
