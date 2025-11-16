"""
WebSocket connection manager for real-time collaboration.

Manages WebSocket connections, broadcasts messages to project members,
and handles connection lifecycle events.
"""

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

import structlog
from fastapi import WebSocket, WebSocketDisconnect

from app.models.user import User

logger = structlog.get_logger(__name__)


@dataclass
class WebSocketConnection:
    """Represents an active WebSocket connection."""

    websocket: WebSocket
    user: User
    project_id: str
    connected_at: datetime
    last_heartbeat: datetime
    cursor_position: Optional[Dict[str, Any]] = None
    active_locks: Set[str] = None  # Set of resource IDs this user has locked

    def __post_init__(self):
        """Initialize mutable default values."""
        if self.active_locks is None:
            self.active_locks = set()

    def is_stale(self, timeout_seconds: int = 60) -> bool:
        """Check if connection is stale (no heartbeat)."""
        return (datetime.utcnow() - self.last_heartbeat).total_seconds() > timeout_seconds

    def to_presence_dict(self) -> dict:
        """Convert connection to presence information."""
        return {
            "user_id": str(self.user.id),
            "username": self.user.username,
            "full_name": self.user.full_name,
            "avatar_url": self.user.avatar_url,
            "connected_at": self.connected_at.isoformat() + "Z",
            "cursor_position": self.cursor_position,
            "active_locks": list(self.active_locks),
        }


class ConnectionManager:
    """
    Manages WebSocket connections for real-time collaboration.

    Handles connection pooling, broadcasting, presence tracking,
    and automatic cleanup of stale connections.
    """

    def __init__(self):
        """Initialize connection manager."""
        # project_id -> list of WebSocketConnection
        self.active_connections: Dict[str, List[WebSocketConnection]] = defaultdict(list)

        # user_id -> set of project_ids (for quick lookup)
        self.user_projects: Dict[UUID, Set[str]] = defaultdict(set)

        # Rate limiting: user_id -> (message_count, window_start)
        self.rate_limits: Dict[UUID, tuple[int, datetime]] = {}

        # Cleanup task
        self._cleanup_task: Optional[asyncio.Task] = None

        logger.info("connection_manager_initialized")

    async def connect(
        self,
        project_id: str,
        websocket: WebSocket,
        user: User,
    ) -> WebSocketConnection:
        """
        Add a new WebSocket connection.

        Args:
            project_id: ID of the project
            websocket: WebSocket connection
            user: Authenticated user

        Returns:
            WebSocketConnection object
        """
        connection = WebSocketConnection(
            websocket=websocket,
            user=user,
            project_id=project_id,
            connected_at=datetime.utcnow(),
            last_heartbeat=datetime.utcnow(),
        )

        self.active_connections[project_id].append(connection)
        self.user_projects[user.id].add(project_id)

        logger.info(
            "websocket_connected",
            project_id=project_id,
            user_id=str(user.id),
            username=user.username,
            total_connections=len(self.active_connections[project_id]),
        )

        # Start cleanup task if not running
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

        # Notify others about new user
        await self.broadcast(
            project_id,
            {
                "type": "presence_update",
                "action": "joined",
                "user": connection.to_presence_dict(),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            exclude_user_id=user.id,
        )

        return connection

    async def disconnect(
        self,
        project_id: str,
        websocket: WebSocket,
        user_id: Optional[UUID] = None,
    ) -> Optional[WebSocketConnection]:
        """
        Remove a WebSocket connection.

        Args:
            project_id: ID of the project
            websocket: WebSocket connection to remove
            user_id: Optional user ID for logging

        Returns:
            Removed WebSocketConnection or None if not found
        """
        connections = self.active_connections.get(project_id, [])
        removed_connection = None

        for connection in connections[:]:  # Iterate over copy
            if connection.websocket == websocket:
                connections.remove(connection)
                removed_connection = connection

                # Update user_projects
                if connection.user.id in self.user_projects:
                    self.user_projects[connection.user.id].discard(project_id)
                    if not self.user_projects[connection.user.id]:
                        del self.user_projects[connection.user.id]

                logger.info(
                    "websocket_disconnected",
                    project_id=project_id,
                    user_id=str(connection.user.id),
                    username=connection.user.username,
                    remaining_connections=len(connections),
                    active_locks=list(connection.active_locks),
                )

                # Notify others about user leaving
                await self.broadcast(
                    project_id,
                    {
                        "type": "presence_update",
                        "action": "left",
                        "user_id": str(connection.user.id),
                        "username": connection.user.username,
                        "released_locks": list(connection.active_locks),
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    },
                    exclude_user_id=connection.user.id,
                )

                break

        # Clean up empty project connections
        if not connections and project_id in self.active_connections:
            del self.active_connections[project_id]

        return removed_connection

    async def broadcast(
        self,
        project_id: str,
        message: dict,
        exclude_user_id: Optional[UUID] = None,
    ) -> int:
        """
        Broadcast message to all connections in a project.

        Args:
            project_id: ID of the project
            message: Message to broadcast
            exclude_user_id: Optional user ID to exclude from broadcast

        Returns:
            Number of connections that received the message
        """
        connections = self.active_connections.get(project_id, [])
        sent_count = 0
        failed_connections = []

        for connection in connections:
            # Skip excluded user
            if exclude_user_id and connection.user.id == exclude_user_id:
                continue

            try:
                await connection.websocket.send_json(message)
                sent_count += 1
            except WebSocketDisconnect:
                failed_connections.append(connection)
                logger.warning(
                    "broadcast_failed_disconnected",
                    project_id=project_id,
                    user_id=str(connection.user.id),
                )
            except Exception as e:
                failed_connections.append(connection)
                logger.error(
                    "broadcast_failed",
                    project_id=project_id,
                    user_id=str(connection.user.id),
                    error=str(e),
                )

        # Clean up failed connections
        for connection in failed_connections:
            await self.disconnect(project_id, connection.websocket)

        if sent_count > 0:
            logger.debug(
                "message_broadcast",
                project_id=project_id,
                message_type=message.get("type"),
                recipients=sent_count,
                excluded=exclude_user_id is not None,
            )

        return sent_count

    async def send_personal(
        self,
        user_id: UUID,
        message: dict,
        project_id: Optional[str] = None,
    ) -> int:
        """
        Send message to a specific user.

        Args:
            user_id: ID of the user
            message: Message to send
            project_id: Optional project ID to limit scope

        Returns:
            Number of connections that received the message
        """
        sent_count = 0
        failed_connections = []

        # Get all projects for this user
        projects = [project_id] if project_id else list(self.user_projects.get(user_id, []))

        for pid in projects:
            connections = self.active_connections.get(pid, [])
            for connection in connections:
                if connection.user.id == user_id:
                    try:
                        await connection.websocket.send_json(message)
                        sent_count += 1
                    except WebSocketDisconnect:
                        failed_connections.append((pid, connection))
                        logger.warning(
                            "personal_send_failed_disconnected",
                            project_id=pid,
                            user_id=str(user_id),
                        )
                    except Exception as e:
                        failed_connections.append((pid, connection))
                        logger.error(
                            "personal_send_failed",
                            project_id=pid,
                            user_id=str(user_id),
                            error=str(e),
                        )

        # Clean up failed connections
        for pid, connection in failed_connections:
            await self.disconnect(pid, connection.websocket)

        if sent_count > 0:
            logger.debug(
                "personal_message_sent",
                user_id=str(user_id),
                message_type=message.get("type"),
                recipients=sent_count,
            )

        return sent_count

    def get_active_users(self, project_id: str) -> List[dict]:
        """
        Get list of active users in a project.

        Args:
            project_id: ID of the project

        Returns:
            List of user presence information
        """
        connections = self.active_connections.get(project_id, [])
        users = {}

        # Deduplicate users (one user might have multiple connections)
        for connection in connections:
            user_id = str(connection.user.id)
            if user_id not in users:
                users[user_id] = connection.to_presence_dict()

        return list(users.values())

    def get_connection_count(self, project_id: str) -> int:
        """Get number of active connections for a project."""
        return len(self.active_connections.get(project_id, []))

    def get_total_connections(self) -> int:
        """Get total number of active connections across all projects."""
        return sum(len(conns) for conns in self.active_connections.values())

    async def update_heartbeat(
        self,
        project_id: str,
        user_id: UUID,
    ) -> bool:
        """
        Update heartbeat timestamp for a connection.

        Args:
            project_id: ID of the project
            user_id: ID of the user

        Returns:
            True if connection was found and updated
        """
        connections = self.active_connections.get(project_id, [])
        for connection in connections:
            if connection.user.id == user_id:
                connection.last_heartbeat = datetime.utcnow()
                return True
        return False

    async def update_cursor(
        self,
        project_id: str,
        user_id: UUID,
        cursor_position: Optional[dict],
    ) -> bool:
        """
        Update cursor position for a connection.

        Args:
            project_id: ID of the project
            user_id: ID of the user
            cursor_position: Cursor position data

        Returns:
            True if connection was found and updated
        """
        connections = self.active_connections.get(project_id, [])
        for connection in connections:
            if connection.user.id == user_id:
                connection.cursor_position = cursor_position
                return True
        return False

    async def add_lock(
        self,
        project_id: str,
        user_id: UUID,
        resource_id: str,
    ) -> bool:
        """
        Add a lock to a user's active locks.

        Args:
            project_id: ID of the project
            user_id: ID of the user
            resource_id: ID of the locked resource

        Returns:
            True if connection was found and updated
        """
        connections = self.active_connections.get(project_id, [])
        for connection in connections:
            if connection.user.id == user_id:
                connection.active_locks.add(resource_id)
                return True
        return False

    async def remove_lock(
        self,
        project_id: str,
        user_id: UUID,
        resource_id: str,
    ) -> bool:
        """
        Remove a lock from a user's active locks.

        Args:
            project_id: ID of the project
            user_id: ID of the user
            resource_id: ID of the locked resource

        Returns:
            True if connection was found and updated
        """
        connections = self.active_connections.get(project_id, [])
        for connection in connections:
            if connection.user.id == user_id:
                connection.active_locks.discard(resource_id)
                return True
        return False

    def check_rate_limit(
        self,
        user_id: UUID,
        max_messages: int = 60,
        window_seconds: int = 60,
    ) -> tuple[bool, int]:
        """
        Check if user has exceeded rate limit.

        Args:
            user_id: ID of the user
            max_messages: Maximum messages per window
            window_seconds: Time window in seconds

        Returns:
            Tuple of (is_allowed, remaining_messages)
        """
        now = datetime.utcnow()

        if user_id not in self.rate_limits:
            self.rate_limits[user_id] = (1, now)
            return True, max_messages - 1

        count, window_start = self.rate_limits[user_id]

        # Check if window has expired
        if (now - window_start).total_seconds() > window_seconds:
            self.rate_limits[user_id] = (1, now)
            return True, max_messages - 1

        # Check if limit exceeded
        if count >= max_messages:
            return False, 0

        # Increment count
        self.rate_limits[user_id] = (count + 1, window_start)
        return True, max_messages - (count + 1)

    async def cleanup_inactive(
        self,
        timeout_seconds: int = 60,
    ) -> int:
        """
        Clean up stale connections.

        Args:
            timeout_seconds: Timeout in seconds

        Returns:
            Number of connections cleaned up
        """
        cleaned_count = 0
        projects_to_check = list(self.active_connections.keys())

        for project_id in projects_to_check:
            connections = self.active_connections.get(project_id, [])
            stale_connections = [conn for conn in connections if conn.is_stale(timeout_seconds)]

            for connection in stale_connections:
                try:
                    await connection.websocket.close(code=1000, reason="Connection timeout")
                except Exception:
                    pass  # Connection already closed

                await self.disconnect(project_id, connection.websocket)
                cleaned_count += 1

        if cleaned_count > 0:
            logger.info(
                "cleanup_stale_connections",
                cleaned_count=cleaned_count,
                timeout_seconds=timeout_seconds,
            )

        return cleaned_count

    async def _cleanup_loop(self):
        """Background task to periodically clean up stale connections."""
        logger.info("cleanup_loop_started")

        try:
            while True:
                await asyncio.sleep(30)  # Run every 30 seconds
                await self.cleanup_inactive(timeout_seconds=90)
        except asyncio.CancelledError:
            logger.info("cleanup_loop_cancelled")
        except Exception as e:
            logger.error("cleanup_loop_error", error=str(e))

    async def shutdown(self):
        """Shutdown connection manager and close all connections."""
        logger.info("connection_manager_shutdown_started")

        # Cancel cleanup task
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # Close all connections
        total_closed = 0
        for project_id in list(self.active_connections.keys()):
            connections = self.active_connections.get(project_id, [])
            for connection in connections[:]:
                try:
                    await connection.websocket.close(code=1001, reason="Server shutdown")
                except Exception:
                    pass
                total_closed += 1

        # Clear all data structures
        self.active_connections.clear()
        self.user_projects.clear()
        self.rate_limits.clear()

        logger.info("connection_manager_shutdown_complete", connections_closed=total_closed)


# Global connection manager instance
connection_manager = ConnectionManager()
