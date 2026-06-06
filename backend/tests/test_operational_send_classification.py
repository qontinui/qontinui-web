"""Classification tests for POST-HANDSHAKE *operational* WebSocket sends.

Companion to ``test_safe_send.py`` (handshake-reject helpers). These pin the
follow-up standardisation: operational send sites import the shared
``BENIGN_SEND_EXCEPTIONS`` tuple from ``app.websockets.safe_send`` to recognise
benign close-races (client gone → ``WebSocketDisconnect(1006)``; send/close after
our own close frame → ``RuntimeError``) WITHOUT routing through the swallowing
``safe_send_json`` — each site keeps its own CONSEQUENCE (break / cleanup /
continue), and a real bug (e.g. a serialization ``TypeError`` on an OPEN socket)
still reaches an error-level log or propagates so Sentry sees it.

Four cases, per the plan:

1. Loop-body site (``runner_status_ws`` representative): client gone mid-send →
   the loop exits via the benign arm and pubsub cleanup fires, NO error-level log.
2. Benign ``RuntimeError`` ("close already sent") on an operational send → benign
   arm (break, no error-level log), NOT error-level.
3. Serialization ``TypeError`` on an OPEN socket → error-level log (Sentry-
   visible), NOT swallowed into the benign arm.
4. Relay no-leak (Finding A): a relay ``_listen_for_*`` loop whose send raises
   WebSocketDisconnect / RuntimeError must break AND still run
   ``pubsub.unsubscribe`` + ``pubsub.close`` (no orphaned pubsub connection).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS

_CLOSE_ALREADY_SENT = RuntimeError(
    'Cannot call "send" once a close message has been sent.'
)


# --- The shared tuple itself ---------------------------------------------


def test_benign_tuple_is_disconnect_and_runtimeerror() -> None:
    """The exported tuple must be exactly the documented benign pair."""
    assert BENIGN_SEND_EXCEPTIONS == (WebSocketDisconnect, RuntimeError)


# --- Async doubles --------------------------------------------------------


class _FakePubSub:
    """Minimal async pubsub double for the listen loops.

    ``listen()`` yields the given frames; ``subscribe``/``unsubscribe``/``close``
    are AsyncMocks so the no-leak assertions can check them.
    """

    def __init__(self, messages: list[dict]) -> None:
        self._messages = messages
        self.subscribe = AsyncMock()
        self.unsubscribe = AsyncMock()
        self.close = AsyncMock()

    async def listen(self):  # noqa: ANN201 - async generator
        for msg in self._messages:
            yield msg


def _redis_with_pubsub(pubsub: _FakePubSub) -> MagicMock:
    redis = MagicMock()
    redis.pubsub = MagicMock(return_value=pubsub)
    return redis


# --- Cases 1-3: loop-body site (runner_status_ws representative) ----------
#
# Drive the REAL endpoint body. The handshake (settings/auth/initial-state) is
# patched out so the test isolates the per-message classification arm. The loop
# gates on ``client_state`` (left CONNECTED so the send is attempted), classifies
# via BENIGN_SEND_EXCEPTIONS, and logs ``runner_status_ws_send_failed`` at ERROR
# only for the non-benign arm.


def _status_ws(send_exc: Exception | None) -> MagicMock:
    ws = MagicMock()
    ws.client_state = WebSocketState.CONNECTED
    ws.application_state = WebSocketState.CONNECTED
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    ws.query_params = {"token": "fake-token"}
    # First send_json is the initial-state snapshot (must succeed); the second
    # is the per-message forward under test (raises send_exc).
    ws.send_json = AsyncMock(side_effect=[None, send_exc])
    return ws


async def _drive_status_ws(monkeypatch, send_exc: Exception | None):
    """Run ``websocket_runner_status`` once against an in-memory pubsub.

    Returns ``(ws, pubsub, error_events)``.
    """
    from app.api.v1.endpoints import runner_status_ws as mod

    user = MagicMock()
    user.id = "11111111-1111-1111-1111-111111111111"

    monkeypatch.setattr(mod.settings, "REDIS_ENABLED", True, raising=False)
    monkeypatch.setattr(mod, "get_current_user_from_ws", AsyncMock(return_value=user))

    # Initial-state DB read: patch ``AsyncSessionLocal`` (imported inside the fn
    # from app.db.session) + the crud call.
    import app.db.session as db_session

    @asynccontextmanager
    async def _fake_session():
        yield MagicMock()

    monkeypatch.setattr(db_session, "AsyncSessionLocal", _fake_session)
    monkeypatch.setattr(mod.runner_crud, "list_runners", AsyncMock(return_value=[]))

    pubsub = _FakePubSub([{"type": "message", "data": '{"hello": "world"}'}])
    redis = _redis_with_pubsub(pubsub)

    ws = _status_ws(send_exc)

    error_events: list[str] = []
    monkeypatch.setattr(
        mod.logger, "error", lambda event, **kw: error_events.append(event)
    )

    await mod.websocket_runner_status(ws, redis=redis)
    return ws, pubsub, error_events


@pytest.mark.asyncio
async def test_status_ws_client_gone_breaks_without_error_log(monkeypatch) -> None:
    """Case 1: client gone mid-send → benign arm breaks the loop, no ERROR log."""
    ws, pubsub, error_events = await _drive_status_ws(
        monkeypatch, WebSocketDisconnect(code=1006)
    )

    # initial_state send + the forward attempt = 2 awaited sends.
    assert ws.send_json.await_count == 2
    # Benign arm → pubsub cleaned up, no per-message ERROR-level log.
    pubsub.unsubscribe.assert_awaited()
    pubsub.close.assert_awaited()
    assert "runner_status_ws_send_failed" not in error_events
    assert "runner_status_ws_error" not in error_events


@pytest.mark.asyncio
async def test_status_ws_benign_runtimeerror_breaks_without_error_log(
    monkeypatch,
) -> None:
    """Case 2: 'close already sent' RuntimeError → benign arm, no ERROR log."""
    ws, pubsub, error_events = await _drive_status_ws(monkeypatch, _CLOSE_ALREADY_SENT)

    assert ws.send_json.await_count == 2
    assert "runner_status_ws_send_failed" not in error_events
    assert "runner_status_ws_error" not in error_events
    pubsub.close.assert_awaited()


@pytest.mark.asyncio
async def test_status_ws_serialization_typeerror_logs_error(monkeypatch) -> None:
    """Case 3: TypeError on an OPEN socket → ERROR-level log (Sentry-visible).

    A real serialization bug must NOT be swallowed into the benign arm; it lands
    in ``except Exception`` which logs ``runner_status_ws_send_failed`` at error.
    """
    ws, pubsub, error_events = await _drive_status_ws(
        monkeypatch, TypeError("Object of type set is not JSON serializable")
    )

    assert "runner_status_ws_send_failed" in error_events
    pubsub.close.assert_awaited()


# --- Case 4: relay no-leak (Finding A) ------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "send_exc",
    [
        WebSocketDisconnect(code=1006),
        _CLOSE_ALREADY_SENT,
    ],
)
async def test_command_relay_command_loop_no_leak_on_benign(
    send_exc: Exception,
) -> None:
    """A benign send-raise in ``_listen_for_commands`` breaks AND frees pubsub."""
    from app.services.runner.command_relay import CommandRelayService

    pubsub = _FakePubSub([{"type": "message", "data": '{"type": "x"}'}])
    redis = _redis_with_pubsub(pubsub)
    registry = MagicMock()

    svc = CommandRelayService(redis, registry)

    runner_ws = MagicMock()
    runner_ws.send_json = AsyncMock(side_effect=send_exc)

    await svc._listen_for_commands("runner-1", runner_ws)

    runner_ws.send_json.assert_awaited_once()
    # finally: must have returned the pubsub connection — no orphan.
    pubsub.unsubscribe.assert_awaited_once()
    pubsub.close.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "send_exc",
    [
        WebSocketDisconnect(code=1006),
        _CLOSE_ALREADY_SENT,
    ],
)
async def test_command_relay_response_loop_no_leak_on_benign(
    send_exc: Exception,
) -> None:
    """A benign send-raise in ``_listen_for_responses`` breaks AND frees pubsub.

    This loop previously had ONLY ``except Exception: break`` — the two-arm split
    must still break for the benign case and still run the ``finally`` cleanup.
    """
    from app.services.runner.command_relay import CommandRelayService

    pubsub = _FakePubSub([{"type": "message", "data": '{"type": "resp"}'}])
    redis = _redis_with_pubsub(pubsub)
    registry = MagicMock()

    svc = CommandRelayService(redis, registry)

    frontend_ws = MagicMock()
    frontend_ws.send_json = AsyncMock(side_effect=send_exc)

    await svc._listen_for_responses("runner-1", frontend_ws, "key-1")

    frontend_ws.send_json.assert_awaited_once()
    pubsub.unsubscribe.assert_awaited_once()
    pubsub.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_command_relay_response_loop_real_bug_logs_error_then_drains(
    monkeypatch,
) -> None:
    """A real bug (TypeError) in ``_listen_for_responses`` logs ERROR + continues.

    The error arm does NOT break early (not swallowed into the benign arm); with
    a single message the loop then drains and the ``finally`` frees the pubsub.
    """
    from app.services.runner import command_relay as crmod
    from app.services.runner.command_relay import CommandRelayService

    pubsub = _FakePubSub([{"type": "message", "data": '{"type": "resp"}'}])
    redis = _redis_with_pubsub(pubsub)
    registry = MagicMock()

    svc = CommandRelayService(redis, registry)

    frontend_ws = MagicMock()
    frontend_ws.send_json = AsyncMock(side_effect=TypeError("not serializable"))

    error_events: list[str] = []
    monkeypatch.setattr(
        crmod.logger, "error", lambda event, **kw: error_events.append(event)
    )

    await svc._listen_for_responses("runner-1", frontend_ws, "key-1")

    assert "response_forward_failed" in error_events
    pubsub.close.assert_awaited_once()
