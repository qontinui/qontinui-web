"""Unit tests for ``app.websockets.safe_send`` — the shared tolerant WS helpers.

Covers the two corrections made when the helpers were extracted from
``devices_ws`` (Phase 2 of the WS handshake-reject cleanup):

1. The state pre-check gates on ``client_state``, not ``application_state``.
   The documented race is *client gone, server not yet closed*: ``client_state``
   flips to DISCONNECTED while ``application_state`` stays CONNECTED. #463's tests
   only ever stubbed ``application_state``, so they stayed green even though the
   old guard never fired for the real race — this module closes that gap.
2. The except tuple is narrowed to ``(WebSocketDisconnect, RuntimeError)`` so a
   real bug (e.g. a serialization ``TypeError`` on an OPEN socket) propagates to
   Sentry instead of being downgraded to a debug log.

Plus ``reject``: send-then-close, tolerant of a send-raise and a close-raise.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocketDisconnect, status
from starlette.websockets import WebSocketState

from app.websockets import safe_send


def _ws(
    *,
    client_state: WebSocketState = WebSocketState.CONNECTED,
    application_state: WebSocketState = WebSocketState.CONNECTED,
    send_exc: Exception | None = None,
    close_exc: Exception | None = None,
) -> MagicMock:
    ws = MagicMock()
    ws.client_state = client_state
    ws.application_state = application_state
    ws.send_json = AsyncMock(side_effect=send_exc)
    ws.close = AsyncMock(side_effect=close_exc)
    return ws


# ---- safe_send_json: the real-race state guard (the #463 gap) -------------


@pytest.mark.asyncio
async def test_safe_send_json_suppresses_on_real_race_state_pair() -> None:
    """client_state=DISCONNECTED + application_state=CONNECTED → skip the send.

    This is the documented race that #463's application_state-only guard missed.
    No raise, and no send attempt at all.
    """
    ws = _ws(
        client_state=WebSocketState.DISCONNECTED,
        application_state=WebSocketState.CONNECTED,
    )

    await safe_send.safe_send_json(ws, {"type": "error", "message": "x"})

    ws.send_json.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "send_exc",
    [
        WebSocketDisconnect(code=1006),
        RuntimeError('Cannot call "send" once a close message has been sent.'),
    ],
)
async def test_safe_send_json_swallows_narrow_excs(send_exc: Exception) -> None:
    """WebSocketDisconnect / RuntimeError on send must not propagate."""
    ws = _ws(send_exc=send_exc)

    await safe_send.safe_send_json(ws, {"type": "error", "message": "x"})

    ws.send_json.assert_awaited_once()


@pytest.mark.asyncio
async def test_safe_send_json_propagates_unexpected_exception() -> None:
    """A non-disconnect error on an OPEN socket must propagate (reach Sentry).

    The old bare ``except Exception`` silently downgraded these to a debug log.
    """
    ws = _ws(send_exc=TypeError("Object of type set is not JSON serializable"))

    with pytest.raises(TypeError):
        await safe_send.safe_send_json(ws, {"type": "error", "message": "x"})


# ---- safe_close ----------------------------------------------------------


@pytest.mark.asyncio
async def test_safe_close_skips_when_application_disconnected() -> None:
    """If we already sent our close frame, don't close again."""
    ws = _ws(application_state=WebSocketState.DISCONNECTED)

    await safe_send.safe_close(ws, status.WS_1008_POLICY_VIOLATION)

    ws.close.assert_not_awaited()


@pytest.mark.asyncio
async def test_safe_close_passes_code_through() -> None:
    ws = _ws()

    await safe_send.safe_close(ws, status.WS_1011_INTERNAL_ERROR)

    ws.close.assert_awaited_once_with(code=status.WS_1011_INTERNAL_ERROR, reason=None)


@pytest.mark.asyncio
async def test_safe_close_passes_reason_through() -> None:
    """The close-frame reason (CloseEvent.reason) is the on-wire disambiguator
    for sites that share a close code — it must reach websocket.close."""
    ws = _ws()

    await safe_send.safe_close(
        ws, status.WS_1008_POLICY_VIOLATION, reason="Missing authentication token"
    )

    ws.close.assert_awaited_once_with(
        code=status.WS_1008_POLICY_VIOLATION,
        reason="Missing authentication token",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "close_exc",
    [
        RuntimeError('Cannot call "send" once a close message has been sent.'),
        WebSocketDisconnect(code=1006),
    ],
)
async def test_safe_close_swallows_double_close_and_disconnect(
    close_exc: Exception,
) -> None:
    """close() raising RuntimeError or WebSocketDisconnect must not propagate."""
    ws = _ws(close_exc=close_exc)

    await safe_send.safe_close(ws, status.WS_1008_POLICY_VIOLATION)

    ws.close.assert_awaited_once()


# ---- reject --------------------------------------------------------------


@pytest.mark.asyncio
async def test_reject_sends_standard_payload_then_closes() -> None:
    ws = _ws()

    await safe_send.reject(ws, "nope", code=status.WS_1008_POLICY_VIOLATION)

    ws.send_json.assert_awaited_once_with({"type": "error", "message": "nope"})
    ws.close.assert_awaited_once_with(
        code=status.WS_1008_POLICY_VIOLATION, reason="nope"
    )


@pytest.mark.asyncio
async def test_reject_default_code_is_policy_violation() -> None:
    ws = _ws()

    await safe_send.reject(ws, "nope")

    ws.close.assert_awaited_once_with(
        code=status.WS_1008_POLICY_VIOLATION, reason="nope"
    )


@pytest.mark.asyncio
async def test_reject_still_closes_when_send_raises() -> None:
    """A send that races the client close must not stop the close from running."""
    ws = _ws(send_exc=WebSocketDisconnect(code=1006))

    await safe_send.reject(ws, "nope", code=status.WS_1011_INTERNAL_ERROR)

    ws.close.assert_awaited_once_with(code=status.WS_1011_INTERNAL_ERROR, reason="nope")


@pytest.mark.asyncio
async def test_reject_close_reason_defaults_to_message() -> None:
    """The close frame carries the same diagnostic as the advisory error frame —
    the error frame races the client's close and can be dropped, so the close
    reason is the reliably-observed half of the diagnostic."""
    ws = _ws()

    await safe_send.reject(ws, "Device token missing required claims.")

    ws.close.assert_awaited_once_with(
        code=status.WS_1008_POLICY_VIOLATION,
        reason="Device token missing required claims.",
    )


@pytest.mark.asyncio
async def test_reject_explicit_reason_overrides_message() -> None:
    ws = _ws()

    await safe_send.reject(ws, "long advisory message", reason="short reason")

    ws.send_json.assert_awaited_once_with(
        {"type": "error", "message": "long advisory message"}
    )
    ws.close.assert_awaited_once_with(
        code=status.WS_1008_POLICY_VIOLATION, reason="short reason"
    )


@pytest.mark.asyncio
async def test_reject_truncates_reason_to_close_frame_limit() -> None:
    """RFC 6455 caps the close-frame reason at 123 UTF-8 bytes; an over-long
    message must be truncated rather than rejected by the WS stack."""
    ws = _ws()
    long_message = "x" * 200

    await safe_send.reject(ws, long_message)

    sent_reason = ws.close.await_args.kwargs["reason"]
    assert len(sent_reason.encode("utf-8")) <= 123
    assert sent_reason.endswith("...")
    # The advisory error frame keeps the FULL message — only the close frame
    # is capped.
    ws.send_json.assert_awaited_once_with({"type": "error", "message": long_message})


@pytest.mark.asyncio
async def test_reject_tolerates_close_raise() -> None:
    """A close that races a prior close must not propagate out of reject."""
    ws = _ws(close_exc=RuntimeError("already closed"))

    # Must not raise.
    await safe_send.reject(ws, "nope")

    ws.close.assert_awaited_once()
