"""Service for broadcasting sync events to connected WebSocket clients."""

import asyncio
from collections import defaultdict
from typing import Any
from uuid import UUID

import structlog
from fastapi import WebSocket

logger = structlog.get_logger(__name__)


class SyncBroadcastService:
    """
    Manages WebSocket connections and broadcasts sync events.

    Each project can have multiple connected clients. When a sync event occurs
    (lock acquired, lock released, version updated), it's broadcast to all
    clients connected to that project.
    """

    def __init__(self) -> None:
        # Map of project_id -> set of connected websockets
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        # Lock for thread-safe access to connections
        self._lock = asyncio.Lock()

    async def connect(self, project_id: str | UUID, websocket: WebSocket) -> None:
        """Register a WebSocket connection for a project."""
        project_key = str(project_id)
        async with self._lock:
            self._connections[project_key].add(websocket)
        logger.info(
            "websocket_connected",
            project_id=project_key,
            connection_count=len(self._connections[project_key]),
        )

    async def disconnect(self, project_id: str | UUID, websocket: WebSocket) -> None:
        """Unregister a WebSocket connection."""
        project_key = str(project_id)
        async with self._lock:
            self._connections[project_key].discard(websocket)
            if not self._connections[project_key]:
                del self._connections[project_key]
        logger.info("websocket_disconnected", project_id=project_key)

    async def broadcast(
        self,
        project_id: str | UUID,
        event: dict[str, Any],
        exclude: WebSocket | None = None,
    ) -> None:
        """
        Broadcast an event to all clients connected to a project.

        Args:
            project_id: Project to broadcast to
            event: Event data to send
            exclude: Optional websocket to exclude from broadcast
        """
        project_key = str(project_id)
        async with self._lock:
            connections = self._connections.get(project_key, set()).copy()

        if not connections:
            logger.debug("no_connections_for_broadcast", project_id=project_key)
            return

        disconnected = []
        for websocket in connections:
            if websocket == exclude:
                continue
            try:
                await websocket.send_json(event)
            except Exception as e:
                logger.warning(
                    "websocket_send_failed",
                    project_id=project_key,
                    error=str(e),
                )
                disconnected.append(websocket)

        # Clean up disconnected websockets
        if disconnected:
            async with self._lock:
                for ws in disconnected:
                    self._connections[project_key].discard(ws)

        logger.debug(
            "broadcast_sent",
            project_id=project_key,
            event_type=event.get("type"),
            recipient_count=len(connections)
            - len(disconnected)
            - (1 if exclude else 0),
        )

    async def broadcast_lock_acquired(
        self,
        project_id: str | UUID,
        lock_id: str,
        operation: str,
        user_id: str,
    ) -> None:
        """Broadcast that a sync lock was acquired."""
        await self.broadcast(
            project_id,
            {
                "type": "LOCK_ACQUIRED",
                "lockId": lock_id,
                "operation": operation,
                "userId": user_id,
            },
        )

    async def broadcast_lock_released(
        self,
        project_id: str | UUID,
        lock_id: str,
        new_version: int,
    ) -> None:
        """Broadcast that a sync lock was released."""
        await self.broadcast(
            project_id,
            {
                "type": "LOCK_RELEASED",
                "lockId": lock_id,
                "newVersion": new_version,
            },
        )

    async def broadcast_version_updated(
        self,
        project_id: str | UUID,
        version: int,
        source: str,
    ) -> None:
        """Broadcast that the project version was updated."""
        await self.broadcast(
            project_id,
            {
                "type": "VERSION_UPDATED",
                "version": version,
                "source": source,
            },
        )

    def get_connection_count(self, project_id: str | UUID) -> int:
        """Get the number of active connections for a project."""
        return len(self._connections.get(str(project_id), set()))


# Global singleton instance
sync_broadcast = SyncBroadcastService()
