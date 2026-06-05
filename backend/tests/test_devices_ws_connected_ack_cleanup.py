"""Regression test: a failed ``connected`` ack must still run ``_cleanup``.

Pins the Finding-1 fix. On the success path the handshake ``connected`` ack is
a raw ``websocket.send_json`` (NOT the tolerant ``safe_send`` helper — a failed
handshake ack is a real error worth surfacing). The bug: that ack used to sit AFTER
registration committed (``manager.register`` ran, holding three relay pubsub
connections; ``connection_pk`` / ``ws_session_id`` written) but BEFORE the
main-loop ``try`` whose ``finally: _cleanup`` is the ONLY teardown path. A
runner/probe that disconnected in that window made the send raise
``WebSocketDisconnect`` / ``RuntimeError``, which escaped the handler
("Exception in ASGI application") so ``_cleanup`` never ran — leaking the
manager registration + its pooled Redis connections (pool-exhaustion class, see
PR #431) and leaving ``ws_session_id`` set for a false ``wsConnected: true``.

The fix moves the ack (and the ``devices_ws_connected`` log) to be the first
statements INSIDE that ``try``, so ``finally: _cleanup`` owns it. These tests
drive the full endpoint with all externals (JWKS / Redis / DB / manager)
stubbed and assert that, when the ack raises, ``_cleanup`` still runs (manager
``unregister`` called) and no exception escapes the handler.
"""

from __future__ import annotations

import contextlib
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.api.v1.endpoints import devices_ws

_DEVICE_ID = uuid4()
_USER_ID = uuid4()
_CONNECTION_PK = 4242


class _FakeWebSocket:
    """Minimal WebSocket stub driving the unified endpoint to the ack.

    ``send_json`` raises ``ack_exc`` on its FIRST call (the ``connected``
    ack) and is a no-op afterwards; ``receive_json`` yields the
    ``runner_info`` handshake then blocks-then-disconnects so the loop is
    never reached on the success path under test.
    """

    def __init__(self, ack_exc: Exception | None) -> None:
        self._ack_exc = ack_exc
        self.application_state = WebSocketState.CONNECTED
        self.client = MagicMock(host="127.0.0.1")
        self.headers = {"authorization": "Bearer fake-device-jwt"}
        self.query_params: dict[str, str] = {}
        self.accept = AsyncMock()
        self.close = AsyncMock()
        self.send_json_calls: list[dict[str, Any]] = []
        self._receive_returned_info = False

    async def send_json(self, payload: dict[str, Any]) -> None:
        first = not self.send_json_calls
        self.send_json_calls.append(payload)
        if first and self._ack_exc is not None:
            raise self._ack_exc

    async def receive_json(self) -> dict[str, Any]:
        if not self._receive_returned_info:
            self._receive_returned_info = True
            return {"type": "runner_info", "name": "probe", "port": 9876}
        # If we ever get here (ack didn't raise), simulate the client going
        # away so the loop exits cleanly via WebSocketDisconnect.
        raise WebSocketDisconnect(code=1006)


@contextlib.asynccontextmanager
async def _fake_db_session() -> Any:
    """Yield a stub DB session whose commits are no-ops."""
    db = MagicMock()
    db.commit = AsyncMock()
    yield db


def _patch_endpoint_externals(manager: MagicMock) -> list[Any]:
    """Patch every external the endpoint touches before the main loop."""
    jwks = AsyncMock()
    jwks.verify_token = AsyncMock(
        return_value={
            "device_id": str(_DEVICE_ID),
            "user_id": str(_USER_ID),
            "sub": f"device:{_DEVICE_ID}",
        }
    )

    device_row = MagicMock()
    device_row.device_id = _DEVICE_ID
    device_row.ws_session_id = _CONNECTION_PK
    connection_record = MagicMock()
    connection_record.id = _CONNECTION_PK
    connection_record.connected_at = "2026-06-05T00:00:00+00:00"

    device_crud = MagicMock()
    device_crud.register_device = AsyncMock(return_value=device_row)
    device_crud.get_device = AsyncMock(return_value=device_row)

    device_connection_crud = MagicMock()
    device_connection_crud.create_connection_record = AsyncMock(
        return_value=connection_record
    )
    device_connection_crud.close_connection_record = AsyncMock()

    return [
        patch.object(devices_ws.coord_jwks_client, "verify_token", jwks.verify_token),
        patch.object(devices_ws, "get_redis", AsyncMock(return_value=MagicMock())),
        patch.object(
            devices_ws,
            "get_runner_websocket_manager",
            AsyncMock(return_value=manager),
        ),
        patch.object(devices_ws, "device_crud", device_crud),
        patch.object(devices_ws, "device_connection_crud", device_connection_crud),
        patch.object(devices_ws, "AsyncSessionLocal", _fake_db_session),
    ]


def _make_manager() -> MagicMock:
    manager = MagicMock()
    manager.register = AsyncMock()
    manager.publish_runner_connected = AsyncMock()
    manager.publish_runner_disconnected = AsyncMock()
    manager.unregister = AsyncMock()
    return manager


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ack_exc",
    [
        WebSocketDisconnect(code=1006),
        RuntimeError('Cannot call "send" once a close message has been sent.'),
    ],
)
async def test_connected_ack_failure_still_runs_cleanup(ack_exc: Exception) -> None:
    """A runner that disconnects during the ``connected`` ack must not leak.

    The send raises (WebSocketDisconnect → disconnect arm; RuntimeError →
    generic arm); either way the ack lives inside the main-loop ``try`` so
    ``finally: _cleanup`` runs and unregisters the manager registration that
    would otherwise leak its pooled Redis connections.
    """
    manager = _make_manager()
    ws = _FakeWebSocket(ack_exc=ack_exc)

    with contextlib.ExitStack() as stack:
        for p in _patch_endpoint_externals(manager):
            stack.enter_context(p)
        # Must NOT raise — pre-fix this escaped as "Exception in ASGI application".
        await devices_ws.websocket_device_unified_endpoint(ws)

    # Registration committed, so cleanup must reclaim it.
    manager.register.assert_awaited_once()
    manager.unregister.assert_awaited_once_with(_DEVICE_ID, _USER_ID)
    manager.publish_runner_disconnected.assert_awaited_once_with(_DEVICE_ID, _USER_ID)
    # The ack was the only send attempted before teardown.
    assert ws.send_json_calls[0]["type"] == "connected"


@pytest.mark.asyncio
async def test_connected_ack_success_path_runs_loop_then_cleanup() -> None:
    """Sanity: when the ack succeeds the loop runs and cleanup still fires.

    Guards against a regression where moving the ack into the ``try`` somehow
    skipped the normal send or double-sent it.
    """
    manager = _make_manager()
    ws = _FakeWebSocket(ack_exc=None)

    with contextlib.ExitStack() as stack:
        for p in _patch_endpoint_externals(manager):
            stack.enter_context(p)
        await devices_ws.websocket_device_unified_endpoint(ws)

    assert ws.send_json_calls[0]["type"] == "connected"
    manager.unregister.assert_awaited_once_with(_DEVICE_ID, _USER_ID)
