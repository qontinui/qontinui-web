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
        """Check if a runner is connected in this process (memory check)."""
        return runner_id in self._runner_websockets

    def get_connected_runner_ids(self) -> list[str]:
        """Get list of connected runner IDs in this process."""
        return list(self._runner_websockets.keys())
