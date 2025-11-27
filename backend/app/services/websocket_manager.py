"""
WebSocket Manager with Redis Pub/Sub for Horizontal Scalability.

Manages WebSocket connections across multiple backend instances using Redis Pub/Sub.
Enables horizontal scaling by broadcasting events through Redis channels.
"""

import asyncio
import json
from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import WebSocket, WebSocketDisconnect
from redis import asyncio as aioredis

logger = structlog.get_logger(__name__)


class WebSocketManager:
    """
    Manages WebSocket connections with Redis Pub/Sub for horizontal scaling.

    Features:
    - Connection registry per session_id
    - Redis Pub/Sub for broadcasting across instances
    - Automatic connection cleanup
    - Session-specific channels: ws:session:{session_id}
    """

    def __init__(self, redis_client: aioredis.Redis):
        """
        Initialize WebSocket manager.

        Args:
            redis_client: Redis client for Pub/Sub
        """
        self.redis = redis_client
        # session_id -> set of WebSocket connections
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        # session_id -> asyncio.Task (listener task)
        self.listeners: dict[str, asyncio.Task] = {}
        # Track active listeners to prevent duplicates
        self._active_channels: set[str] = set()

        logger.info("websocket_manager_initialized")

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        """
        Add a WebSocket connection to the manager.

        Args:
            session_id: Automation session ID
            websocket: WebSocket connection to add
        """
        # Add connection to registry
        if session_id not in self.connections:
            self.connections[session_id] = set()

        self.connections[session_id].add(websocket)

        logger.info(
            "websocket_connected",
            session_id=session_id,
            total_connections=len(self.connections[session_id]),
        )

        # Start listener for this session if not already running
        if session_id not in self.listeners:
            listener_task = asyncio.create_task(self._listen_for_events(session_id))
            self.listeners[session_id] = listener_task
            logger.info(
                "redis_listener_started",
                session_id=session_id,
            )

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        """
        Remove a WebSocket connection from the manager.

        Args:
            session_id: Automation session ID
            websocket: WebSocket connection to remove
        """
        if session_id in self.connections:
            self.connections[session_id].discard(websocket)

            logger.info(
                "websocket_disconnected",
                session_id=session_id,
                remaining_connections=len(self.connections[session_id]),
            )

            # Cleanup if no more connections for this session
            if not self.connections[session_id]:
                del self.connections[session_id]

                # Cancel listener task
                if session_id in self.listeners:
                    listener_task = self.listeners[session_id]
                    listener_task.cancel()
                    try:
                        await listener_task
                    except asyncio.CancelledError:
                        pass
                    del self.listeners[session_id]

                    logger.info(
                        "redis_listener_stopped",
                        session_id=session_id,
                    )

    async def broadcast(self, session_id: str, message: dict[str, Any]) -> int:
        """
        Broadcast a message to all WebSocket clients for a session across all instances.

        Publishes the message to Redis channel, which will be received by all backend
        instances (including this one). Each instance forwards to its local connections.

        Args:
            session_id: Automation session ID
            message: Message dictionary to broadcast

        Returns:
            Number of local connections that will receive the message
        """
        channel = f"ws:session:{session_id}"

        try:
            # Add timestamp if not present
            if "timestamp" not in message:
                message["timestamp"] = datetime.utcnow().isoformat() + "Z"

            # Publish to Redis channel
            message_json = json.dumps(message)
            await self.redis.publish(channel, message_json)

            logger.debug(
                "message_published_to_redis",
                session_id=session_id,
                channel=channel,
                message_type=message.get("type"),
            )

            # Return count of local connections (will receive from listener)
            return len(self.connections.get(session_id, set()))

        except Exception as e:
            logger.error(
                "broadcast_failed",
                session_id=session_id,
                error=str(e),
                error_type=type(e).__name__,
            )
            return 0

    async def broadcast_notification(
        self, user_id: UUID, notification_data: dict[str, Any]
    ) -> int:
        """
        Broadcast a notification to a specific user across all instances.

        Compatibility method for notification_service.

        Args:
            user_id: User ID to send notification to
            notification_data: Notification data to broadcast

        Returns:
            Number of local connections that will receive the notification
        """
        # Use user_id as session_id for notifications
        session_id = str(user_id)
        return await self.broadcast(session_id, notification_data)

    async def _send_to_local_connections(
        self, session_id: str, message: dict[str, Any]
    ) -> int:
        """
        Send message to all local WebSocket connections for a session.

        Args:
            session_id: Automation session ID
            message: Message to send

        Returns:
            Number of connections that received the message
        """
        connections = self.connections.get(session_id, set())
        if not connections:
            return 0

        sent_count = 0
        failed_connections = []

        for websocket in connections:
            try:
                await websocket.send_json(message)
                sent_count += 1
            except WebSocketDisconnect:
                failed_connections.append(websocket)
                logger.warning(
                    "send_failed_disconnected",
                    session_id=session_id,
                )
            except Exception as e:
                failed_connections.append(websocket)
                logger.error(
                    "send_failed",
                    session_id=session_id,
                    error=str(e),
                    error_type=type(e).__name__,
                )

        # Cleanup failed connections
        for websocket in failed_connections:
            await self.disconnect(session_id, websocket)

        if sent_count > 0:
            logger.debug(
                "message_sent_to_local_connections",
                session_id=session_id,
                message_type=message.get("type"),
                recipients=sent_count,
            )

        return sent_count

    async def _listen_for_events(self, session_id: str) -> None:
        """
        Listen for Redis Pub/Sub events for a session and forward to local connections.

        This runs as a background task for each active session.

        Args:
            session_id: Automation session ID
        """
        channel = f"ws:session:{session_id}"

        # Mark channel as active
        self._active_channels.add(channel)

        pubsub = self.redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "subscribed_to_redis_channel",
                session_id=session_id,
                channel=channel,
            )

            # Listen for messages
            async for message in pubsub.listen():
                # Skip non-message types (subscribe confirmation, etc.)
                if message["type"] != "message":
                    continue

                try:
                    # Decode message
                    message_data = json.loads(message["data"])

                    # Forward to local connections
                    await self._send_to_local_connections(session_id, message_data)

                except json.JSONDecodeError as e:
                    logger.error(
                        "redis_message_decode_failed",
                        session_id=session_id,
                        error=str(e),
                    )
                except Exception as e:
                    logger.error(
                        "redis_message_processing_failed",
                        session_id=session_id,
                        error=str(e),
                        error_type=type(e).__name__,
                    )

        except asyncio.CancelledError:
            logger.info(
                "listener_cancelled",
                session_id=session_id,
            )
            raise
        except Exception as e:
            logger.error(
                "listener_error",
                session_id=session_id,
                error=str(e),
                error_type=type(e).__name__,
            )
        finally:
            # Cleanup
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
                self._active_channels.discard(channel)
                logger.info(
                    "unsubscribed_from_redis_channel",
                    session_id=session_id,
                    channel=channel,
                )
            except Exception as e:
                logger.error(
                    "pubsub_cleanup_failed",
                    session_id=session_id,
                    error=str(e),
                )

    def get_connection_count(self, session_id: str) -> int:
        """
        Get number of local WebSocket connections for a session.

        Args:
            session_id: Automation session ID

        Returns:
            Number of local connections
        """
        return len(self.connections.get(session_id, set()))

    def get_total_connections(self) -> int:
        """
        Get total number of local WebSocket connections across all sessions.

        Returns:
            Total number of local connections
        """
        return sum(len(conns) for conns in self.connections.values())

    def get_active_sessions(self) -> list[str]:
        """
        Get list of session IDs with active connections.

        Returns:
            List of session IDs
        """
        return list(self.connections.keys())

    async def shutdown(self) -> None:
        """
        Shutdown the WebSocket manager and cleanup all resources.
        """
        logger.info("websocket_manager_shutdown_started")

        # Cancel all listener tasks
        for session_id, task in list(self.listeners.items()):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # Close all WebSocket connections
        total_closed = 0
        for session_id, connections in list(self.connections.items()):
            for websocket in list(connections):
                try:
                    await websocket.close(code=1001, reason="Server shutdown")
                    total_closed += 1
                except Exception:
                    pass

        # Clear data structures
        self.connections.clear()
        self.listeners.clear()
        self._active_channels.clear()

        logger.info(
            "websocket_manager_shutdown_complete",
            connections_closed=total_closed,
        )


# Global WebSocket manager instance (initialized in main.py)
_websocket_manager: WebSocketManager | None = None


class WebSocketManagerProxy:
    """
    Proxy class for backward compatibility.

    Provides a module-level connection_manager that delegates to the global instance.
    """

    def __getattr__(self, name):
        if _websocket_manager is None:
            raise RuntimeError(
                "WebSocketManager not initialized. Call get_websocket_manager() first."
            )
        return getattr(_websocket_manager, name)


# Backward compatibility: export as connection_manager
# This will delegate to _websocket_manager once initialized
connection_manager = WebSocketManagerProxy()


async def get_websocket_manager(redis_client: aioredis.Redis) -> WebSocketManager:
    """
    Get or create the global WebSocket manager instance.

    Args:
        redis_client: Redis client for Pub/Sub

    Returns:
        WebSocketManager instance
    """
    global _websocket_manager

    if _websocket_manager is None:
        _websocket_manager = WebSocketManager(redis_client)
        logger.info("global_websocket_manager_created")

    return _websocket_manager


async def shutdown_websocket_manager() -> None:
    """
    Shutdown the global WebSocket manager.
    """
    global _websocket_manager

    if _websocket_manager is not None:
        await _websocket_manager.shutdown()
        _websocket_manager = None
