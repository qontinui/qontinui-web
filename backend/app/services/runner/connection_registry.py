"""
WebSocket Connection Registry for runner connections.

Manages in-memory WebSocket connection references.
WebSocket objects cannot be serialized, so they must be kept in memory.
"""

from collections import defaultdict

import structlog
from fastapi import WebSocket

logger = structlog.get_logger(__name__)


class WebSocketConnectionRegistry:
    """
    Manages in-memory WebSocket connection references.

    WebSocket objects cannot be serialized to Redis, so this registry
    maintains the in-memory mapping of connection IDs to WebSocket instances.
    """

    def __init__(self):
        # connection_id -> WebSocket (runner connections)
        self._runner_websockets: dict[int, WebSocket] = {}
        # connection_id -> set of WebSocket (frontend connections)
        self._frontend_websockets: dict[int, set[WebSocket]] = defaultdict(set)

    def register_runner(self, connection_id: int, websocket: WebSocket) -> None:
        """Register a runner WebSocket connection."""
        self._runner_websockets[connection_id] = websocket
        logger.debug("runner_websocket_registered", connection_id=connection_id)

    def unregister_runner(self, connection_id: int) -> None:
        """Unregister a runner WebSocket connection."""
        if connection_id in self._runner_websockets:
            del self._runner_websockets[connection_id]
            logger.debug("runner_websocket_unregistered", connection_id=connection_id)

    def register_frontend(self, connection_id: int, websocket: WebSocket) -> None:
        """Register a frontend WebSocket for a runner connection."""
        self._frontend_websockets[connection_id].add(websocket)
        logger.debug(
            "frontend_websocket_registered",
            connection_id=connection_id,
            total_frontends=len(self._frontend_websockets[connection_id]),
        )

    def unregister_frontend(self, connection_id: int, websocket: WebSocket) -> None:
        """Unregister a frontend WebSocket from a runner connection."""
        if connection_id in self._frontend_websockets:
            self._frontend_websockets[connection_id].discard(websocket)
            if not self._frontend_websockets[connection_id]:
                del self._frontend_websockets[connection_id]
        logger.debug("frontend_websocket_unregistered", connection_id=connection_id)

    def get_runner_websocket(self, connection_id: int) -> WebSocket | None:
        """Get the WebSocket for a runner connection."""
        return self._runner_websockets.get(connection_id)

    def get_frontend_websockets(self, connection_id: int) -> set[WebSocket]:
        """Get all frontend WebSockets for a runner connection."""
        return self._frontend_websockets.get(connection_id, set())

    def is_runner_connected(self, connection_id: int) -> bool:
        """Check if a runner is connected in this process (memory check)."""
        return connection_id in self._runner_websockets

    def get_connected_runner_ids(self) -> list[int]:
        """Get list of connected runner connection IDs in this process."""
        return list(self._runner_websockets.keys())
