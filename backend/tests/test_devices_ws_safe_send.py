"""Unit tests for ``devices_ws._safe_send_json``.

Pins the fix for the handshake/auth failure paths that reply with a
``{"type": "error"}`` diagnostic and then ``_safe_close`` + ``return``. If the
client already closed the socket (disconnected mid-handshake — observed 25/25
in the bounded Redis-churn probe on the wrong-type-first-message path), the
raw ``websocket.send_json`` raised ``WebSocketDisconnect`` / ``RuntimeError`` /
Starlette ``ClientDisconnected`` *before* ``_safe_close`` ran, escaping the
handler as an unhandled "Exception in ASGI application". ``_safe_send_json``
mirrors ``_safe_close`` for the send side: the advisory reply is best-effort
and must never propagate.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import devices_ws


def _ws(state: WebSocketState, send_exc: Exception | None = None) -> MagicMock:
    """Build a websocket stub with a given application_state + send behavior."""
    ws = MagicMock()
    ws.application_state = state
    ws.send_json = AsyncMock(side_effect=send_exc)
    return ws


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "send_exc",
    [
        WebSocketDisconnect(code=1006),
        RuntimeError('Cannot call "send" once a close message has been sent.'),
        RuntimeError("Unexpected ASGI message after close"),
    ],
)
async def test_safe_send_json_swallows_disconnect_during_send(
    send_exc: Exception,
) -> None:
    """A send that races a client close must NOT propagate out of the helper."""
    ws = _ws(WebSocketState.CONNECTED, send_exc=send_exc)

    # Must not raise — this is the bug the fix closes.
    await devices_ws._safe_send_json(ws, {"type": "error", "message": "x"})

    ws.send_json.assert_awaited_once_with({"type": "error", "message": "x"})


@pytest.mark.asyncio
async def test_safe_send_json_skips_when_already_disconnected() -> None:
    """If the server already closed, don't even attempt the send."""
    ws = _ws(WebSocketState.DISCONNECTED)

    await devices_ws._safe_send_json(ws, {"type": "error", "message": "x"})

    ws.send_json.assert_not_awaited()


@pytest.mark.asyncio
async def test_safe_send_json_sends_on_open_socket() -> None:
    """Happy path: an open socket receives the advisory payload unchanged."""
    ws = _ws(WebSocketState.CONNECTED)
    payload = {
        "type": "error",
        "message": "First message must be of type 'runner_info'.",
    }

    await devices_ws._safe_send_json(ws, payload)

    ws.send_json.assert_awaited_once_with(payload)
