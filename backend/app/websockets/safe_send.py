"""Tolerant handshake-time WebSocket send/close helpers.

WS endpoints reject a handshake (missing/invalid auth, wrong first message,
registration failure, ...) by sending a ``{"type": "error", ...}`` diagnostic
and then closing. Those two operations race a client that disconnected
mid-handshake: the ``send_json``/``close`` then raises *before* the handler
returns, escaping as an unhandled "Exception in ASGI application" (and, via the
Sentry ``LoggingIntegration`` ``event_level=ERROR`` in
``app/core/sentry_config.py``, an alert). The advisory error reply is
best-effort — the socket is being torn down regardless — so a send/close that
races the client's own close must be swallowed, not propagated.

These are *module-level* functions over a raw :class:`~starlette.websockets.WebSocket`,
called at handshake time before any handler object exists. They deliberately do
NOT live on ``BaseWebSocketHandler`` (``app/websockets/base.py``) — the reject
sites have no handler instance yet — though ``BaseWebSocketHandler._send_error``
delegates here so the codebase keeps a single tolerant-send implementation.

Scope discipline: this module covers ONLY handshake-rejection sends/closes.
Post-handshake *operational* sends are intentionally NOT this module's concern —
e.g. ``runner_websocket_manager.locked_send`` (relay-driven, retries / drops on
its own terms) and ``websocket_manager._send_to_local_connections`` (fan-out to
many sockets, tolerates per-socket failure independently). Those have their own
error handling and must not be routed through here.

Except-tuple rationale (verified against the pinned Starlette 1.2.1 in
``backend/poetry.lock`` — its ``WebSocket.send`` is the authority):

* On a client that is already gone the underlying ``self._send`` raises
  ``OSError``, which Starlette catches and re-raises as
  ``WebSocketDisconnect(code=1006)``.
* Calling ``send``/``close`` once the application has already sent its own close
  frame (``application_state == DISCONNECTED``) raises ``RuntimeError``.

Starlette 1.2.1 has NO ``ClientDisconnected`` exception, so we do not import or
catch it (that import would crash at module load). We catch exactly
``(WebSocketDisconnect, RuntimeError)`` and let everything else propagate — a
bare ``except Exception`` would silently downgrade a real bug (e.g. a
``TypeError`` from a non-serializable payload on an OPEN socket) to a debug log
invisible to Sentry.
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import WebSocket, WebSocketDisconnect, status
from starlette.websockets import WebSocketState

logger = structlog.get_logger(__name__)


async def safe_send_json(websocket: WebSocket, payload: dict[str, Any]) -> None:
    """Best-effort JSON send tolerating a client that disconnected mid-handshake.

    Suppresses :class:`WebSocketDisconnect` / :class:`RuntimeError` raised when
    the send races the client's close; any other exception (e.g. a serialization
    error on an open socket) propagates so it reaches Sentry.

    The state pre-check gates on ``client_state`` rather than
    ``application_state``: for the documented race the *client* vanishes
    (``client_state`` → ``DISCONNECTED``) while the server hasn't sent its own
    close yet (``application_state`` stays ``CONNECTED``), so an
    ``application_state`` guard would never fire. This matches how the loop-body
    sends in the sibling endpoints gate themselves (e.g. ``operations.py`` /
    ``runner_status_ws.py``).
    """
    if websocket.client_state != WebSocketState.CONNECTED:
        logger.debug("safe_send_json_skipped_disconnected")
        return
    try:
        await websocket.send_json(payload)
    except (WebSocketDisconnect, RuntimeError) as exc:
        # Client already gone (close frame received / disconnected
        # mid-handshake) or our close was already sent. The reply is advisory
        # and a close follows — benign.
        logger.debug("safe_send_json_suppressed", error=str(exc))


async def safe_close(websocket: WebSocket, code: int) -> None:
    """Close ``websocket`` at most once, tolerating an already-closed socket.

    Several handshake/registration failure paths close the socket and return; on
    some of those the socket is already closed — a prior handler closed it, the
    manager's ``register`` aborted it, or the client itself disconnected
    mid-handshake. ``WebSocket.close`` then raises ``RuntimeError`` (close frame
    already sent) or ``WebSocketDisconnect(code=1006)`` (``OSError`` on a
    client-gone socket, re-raised by Starlette). Both are benign here — the
    socket is being torn down regardless — so suppress both. The ``code`` is
    passed through unchanged so each call site keeps its intended close code.
    """
    if websocket.application_state == WebSocketState.DISCONNECTED:
        return
    try:
        await websocket.close(code=code)
    except (WebSocketDisconnect, RuntimeError) as exc:
        # Already closed / client gone — benign double-close.
        logger.debug("safe_close_suppressed", error=str(exc))


async def reject(
    websocket: WebSocket,
    message: str,
    code: int = status.WS_1008_POLICY_VIOLATION,
) -> None:
    """Reject a handshake: send a standard error frame, then close.

    Sends ``{"type": "error", "message": message}`` via :func:`safe_send_json`
    and then :func:`safe_close` with ``code`` — the exact wire shape +
    send-then-close sequence the handshake-reject sites use. Both steps are
    tolerant, so a client that vanished mid-handshake is handled cleanly and the
    caller can simply ``return`` afterwards.

    Sites whose error payload is NOT the standard ``{"type": "error",
    "message": ...}`` shape (e.g. those that use an ``"error"`` key, or carry
    extra fields) must call :func:`safe_send_json` + :func:`safe_close`
    directly to preserve their exact wire payload.
    """
    await safe_send_json(websocket, {"type": "error", "message": message})
    await safe_close(websocket, code)
