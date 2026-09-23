"""
WebSocket Connection Registry for runner connections.

Manages in-memory WebSocket connection references.
WebSocket objects cannot be serialized, so they must be kept in memory.

The registry is keyed by ``runner_id`` — a string form of the canonical
``Runner`` row's UUID. Channels in Redis use the same string verbatim
(e.g. ``runner:commands:{runner_id}``).
"""

from collections import defaultdict

import structlog
from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = structlog.get_logger(__name__)


class WebSocketConnectionRegistry:
    """
    Manages in-memory WebSocket connection references.

    WebSocket objects cannot be serialized to Redis, so this registry
    maintains the in-memory mapping of runner IDs (UUID strings) to
    WebSocket instances.
    """

    def __init__(self):
        # runner_id -> WebSocket (runner connections)
        self._runner_websockets: dict[str, WebSocket] = {}
        # runner_id -> set of WebSocket (frontend connections)
        self._frontend_websockets: dict[str, set[WebSocket]] = defaultdict(set)

    def register_runner(self, runner_id: str, websocket: WebSocket) -> None:
        """Register a runner WebSocket connection."""
        self._runner_websockets[runner_id] = websocket
        logger.debug("runner_websocket_registered", runner_id=runner_id)

    def unregister_runner(self, runner_id: str) -> None:
        """Unregister a runner WebSocket connection."""
        if runner_id in self._runner_websockets:
            del self._runner_websockets[runner_id]
            logger.debug("runner_websocket_unregistered", runner_id=runner_id)

    def register_frontend(self, runner_id: str, websocket: WebSocket) -> None:
        """Register a frontend WebSocket for a runner connection."""
        self._frontend_websockets[runner_id].add(websocket)
        logger.debug(
            "frontend_websocket_registered",
            runner_id=runner_id,
            total_frontends=len(self._frontend_websockets[runner_id]),
        )

    def unregister_frontend(self, runner_id: str, websocket: WebSocket) -> None:
        """Unregister a frontend WebSocket from a runner connection."""
        if runner_id in self._frontend_websockets:
            self._frontend_websockets[runner_id].discard(websocket)
            if not self._frontend_websockets[runner_id]:
                del self._frontend_websockets[runner_id]
        logger.debug("frontend_websocket_unregistered", runner_id=runner_id)

    def get_runner_websocket(self, runner_id: str) -> WebSocket | None:
        """Get the WebSocket for a runner connection."""
        return self._runner_websockets.get(runner_id)

    def get_frontend_websockets(self, runner_id: str) -> set[WebSocket]:
        """Get all frontend WebSockets for a runner connection."""
        return self._frontend_websockets.get(runner_id, set())

    def is_runner_connected(self, runner_id: str) -> bool:
        """Check if a runner is REGISTERED in this process (memory check).

        Registration is not liveness — see :meth:`is_runner_socket_live`. A
        send path that must not report success into a dead socket asks that
        question instead.
        """
        return runner_id in self._runner_websockets

    def is_runner_socket_live(self, runner_id: str) -> bool:
        """Registered AND the socket can still carry a send.

        ``is_runner_connected`` answers REGISTRATION, and a registry entry
        routinely outlives the socket it names: the entry is keyed by
        ``runner_id`` alone, so the only thing that removes it is
        ``manager.unregister`` — and the device-WS teardown deliberately SKIPS
        that call whenever a newer connection has already claimed the key
        (``devices_ws._cleanup``'s ``devices_ws_skip_unregister_superseded``
        arm, which exists so an old handler cannot cancel the live
        connection's shared inbound listener). Under reconnect churn the
        result is a registered socket whose ASGI handler has exited, and every
        caller reading ``is_runner_connected`` as "I can send to it" reports a
        forward that will never be delivered.

        The discriminator is ``client_state``, not ``application_state``.
        Starlette's ``WebSocket.send`` (0.52+/1.x, ``send`` does not read
        ``client_state`` at all) leaves ``application_state`` at ``CONNECTED``
        for a client that vanished; the send then reaches the server and
        raises — ``WebSocketDisconnect(1006)`` from Starlette, or uvicorn's
        ``Unexpected ASGI message 'websocket.send', after sending
        'websocket.close'``. ``application_state`` is checked too because a
        socket we have already closed ourselves raises ``RuntimeError`` on the
        next send; a socket is sendable only when BOTH read ``CONNECTED``.
        This is the same ``client_state`` pre-check
        ``app.websockets.safe_send.safe_send_json`` applies, for the same
        reason.

        An object exposing neither attribute — a plain object or a
        ``SimpleNamespace`` — reads as live: this check narrows a real
        Starlette socket and never invents a refusal for a stub. A bare
        ``MagicMock`` is NOT such an object: it auto-creates both attributes
        as non-``CONNECTED`` values and so reads as DEAD; a mock socket that
        must pass this check sets both states to ``CONNECTED`` explicitly.
        """
        websocket = self._runner_websockets.get(runner_id)
        if websocket is None:
            return False
        for attr in ("client_state", "application_state"):
            state = getattr(websocket, attr, None)
            if state is not None and state != WebSocketState.CONNECTED:
                return False
        return True

    def can_send_to_runner(
        self, runner_id: str, *, path: str, message_type: object = None
    ) -> bool:
        """The send-path gate: :meth:`is_runner_socket_live`, refusals logged.

        Every relay that publishes onto a runner-direction channel and reports
        the publish as a receipt (``send_terminal``, ``send_chat``,
        ``send_command``, ``dispatch_and_wait``) asks THIS question, not
        ``is_runner_connected``. A ``True`` from the registration check for a
        socket that is gone is worse than a slow send — it is a FALSE RECEIPT:
        the caller reports "forwarded" (a ``command_sent`` frame, an HTTP 200
        ``status: forwarded``, a ``remote_terminal_attach_forwarded`` log line)
        and the refusal that exists for the dead-socket case never fires, so
        the far end waits out its own timeout in silence.

        The stale-entry case — registered but unsendable — is logged apart
        from "never registered here" because they want different fixes, and
        because a refusal the caller reports as "not connected" is otherwise
        indistinguishable from a device that is simply on another replica.
        ``path`` names the relay that asked so one log query answers "which
        send paths are hitting stale sockets"; ``message_type`` is whatever
        the caller had, admitted as an opaque log field.
        """
        if self.is_runner_socket_live(runner_id):
            return True
        if runner_id in self._runner_websockets:
            logger.warning(
                "runner_send_refused_stale_socket",
                runner_id=runner_id,
                path=path,
                message_type=message_type,
            )
        return False

    def get_connected_runner_ids(self) -> list[str]:
        """Get list of connected runner IDs in this process."""
        return list(self._runner_websockets.keys())
