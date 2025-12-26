"""
Runner Connection Manager for bidirectional frontend-runner communication.

Manages WebSocket connections between frontend clients and desktop runners,
enabling the frontend to send commands to runners and receive responses.

Phase 2: Redis-backed state - Connection state persists across server restarts.
"""

import asyncio
import json
from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import WebSocket
from redis import asyncio as aioredis

logger = structlog.get_logger(__name__)

# Redis key TTL in seconds (5 minutes)
REDIS_CONNECTION_TTL = 300


class RunnerConnectionManager:
    """
    Manages bidirectional communication between frontend and runners.

    Architecture:
    - Runners connect to /ws/automation/runner and register with connection_id
    - Frontend connects to /ws/runner/command/{connection_id} to send commands
    - Commands are relayed via Redis pub/sub channels:
      - runner:commands:{connection_id} - Frontend -> Runner commands
      - runner:responses:{connection_id} - Runner -> Frontend responses

    State Management (Phase 2):
    - Connection state stored in Redis for persistence across restarts
    - Redis keys:
      - runner:connection:{connection_id}:active - Indicates active connection
      - runner:connection:{connection_id}:metadata - Connection metadata (JSON)
    - WebSocket references kept in memory (cannot be serialized)
    - TTL-based auto-cleanup for crash scenarios (5 minutes, refreshed on heartbeat)
    """

    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        # WebSocket references kept in memory (cannot serialize WebSockets)
        # connection_id -> WebSocket (runner connections)
        self._runner_websockets: dict[int, WebSocket] = {}
        # connection_id -> set of WebSocket (frontend connections)
        self._frontend_websockets: dict[int, set[WebSocket]] = defaultdict(set)
        # connection_id -> asyncio.Task (listener tasks)
        self.runner_listeners: dict[int, asyncio.Task] = {}
        self.frontend_listeners: dict[str, asyncio.Task] = {}

        logger.info("runner_connection_manager_initialized_with_redis_state")

    async def register_runner(
        self,
        connection_id: int,
        websocket: WebSocket,
        user_id: UUID,
        runner_name: str | None = None,
        ip_address: str | None = None,
        connected_at: datetime | None = None,
        project_id: UUID | None = None,
    ) -> None:
        """
        Register a runner WebSocket connection.

        Stores connection state in Redis for persistence across server restarts.

        Args:
            connection_id: Database connection record ID
            websocket: Runner's WebSocket connection
            user_id: Owner user ID
            runner_name: Optional runner name
            ip_address: Optional IP address
            connected_at: Connection timestamp
            project_id: Optional project ID
        """
        connected_at = connected_at or datetime.utcnow()

        # Store connection state in Redis
        active_key = f"runner:connection:{connection_id}:active"
        metadata_key = f"runner:connection:{connection_id}:metadata"

        # Set active flag with TTL
        await self.redis.set(active_key, "1", ex=REDIS_CONNECTION_TTL)

        # Store metadata with TTL
        metadata = {
            "user_id": str(user_id),
            "connected_at": connected_at.isoformat(),
            "runner_name": runner_name,
            "ip_address": ip_address,
        }
        await self.redis.set(
            metadata_key, json.dumps(metadata), ex=REDIS_CONNECTION_TTL
        )

        # Keep WebSocket reference in memory
        self._runner_websockets[connection_id] = websocket

        # Start listening for commands from frontend
        listener_task = asyncio.create_task(
            self._listen_for_commands(connection_id, websocket)
        )
        self.runner_listeners[connection_id] = listener_task

        # Publish runner connected event to Redis for real-time status updates
        # Include full connection object for frontend to add to list
        connection_data = {
            "id": connection_id,
            "runner_name": runner_name or "Desktop Runner",
            "connected_at": connected_at.isoformat(),
            "disconnected_at": None,
            "duration_seconds": None,
            "ip_address": ip_address,
            "project_id": str(project_id) if project_id else None,
            "ws_connected": True,  # Just connected, so definitely true
        }
        await self._publish_status_update(
            user_id=user_id,
            message={
                "type": "runner_connected",
                "connection": connection_data,
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

        logger.info(
            "runner_registered",
            connection_id=connection_id,
            user_id=str(user_id),
            runner_name=runner_name,
            redis_state_stored=True,
        )

    async def unregister_runner(
        self, connection_id: int, user_id: UUID | None = None
    ) -> None:
        """
        Unregister a runner WebSocket connection.

        Removes connection state from Redis.

        Args:
            connection_id: Database connection record ID
            user_id: Optional owner user ID for status updates
        """
        # Get metadata before deleting (for user_id if not provided)
        if user_id is None:
            metadata_key = f"runner:connection:{connection_id}:metadata"
            metadata_str = await self.redis.get(metadata_key)
            if metadata_str:
                try:
                    metadata = json.loads(metadata_str)
                    user_id = UUID(metadata.get("user_id"))
                except Exception:
                    pass

        # Remove from Redis
        active_key = f"runner:connection:{connection_id}:active"
        metadata_key = f"runner:connection:{connection_id}:metadata"
        await self.redis.delete(active_key)
        await self.redis.delete(metadata_key)

        # Remove from memory
        if connection_id in self._runner_websockets:
            del self._runner_websockets[connection_id]

        if connection_id in self.runner_listeners:
            self.runner_listeners[connection_id].cancel()
            del self.runner_listeners[connection_id]

        # Notify connected frontends that runner disconnected
        await self._notify_frontends(
            connection_id,
            {"type": "runner_disconnected", "timestamp": datetime.utcnow().isoformat()},
        )

        # Publish runner disconnected event to Redis for real-time status updates
        if user_id:
            await self._publish_status_update(
                user_id=user_id,
                message={
                    "type": "runner_disconnected",
                    "connection_id": connection_id,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )

        logger.info(
            "runner_unregistered", connection_id=connection_id, redis_state_removed=True
        )

    async def publish_runner_name_update(
        self, connection_id: int, runner_name: str, user_id: UUID
    ) -> None:
        """
        Publish a runner name update event to the frontend.

        Called when the runner sends its runner_info message after connection,
        which contains the custom runner name.

        Args:
            connection_id: Database connection record ID
            runner_name: The updated runner name
            user_id: User ID to send the update to
        """
        logger.info(
            "runner_name_update_publishing",
            connection_id=connection_id,
            runner_name=runner_name,
            user_id=str(user_id),
        )
        try:
            await self._publish_status_update(
                user_id=user_id,
                message={
                    "type": "runner_name_updated",
                    "connection_id": connection_id,
                    "runner_name": runner_name,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            )
            logger.info(
                "runner_name_update_published",
                connection_id=connection_id,
                runner_name=runner_name,
                user_id=str(user_id),
            )
        except Exception as e:
            logger.error(
                "runner_name_update_publish_error",
                connection_id=connection_id,
                error=str(e),
                error_type=type(e).__name__,
            )

    async def connect_frontend(
        self, connection_id: int, websocket: WebSocket, user_id: UUID
    ) -> bool:
        """
        Connect a frontend WebSocket to a runner.

        Args:
            connection_id: Runner connection ID to connect to
            websocket: Frontend WebSocket connection
            user_id: Requesting user ID

        Returns:
            True if connection successful, False if runner not connected
        """
        # Check if runner is connected (memory check is sufficient for local process)
        if connection_id not in self._runner_websockets:
            logger.warning(
                "frontend_connect_runner_not_found",
                connection_id=connection_id,
                user_id=str(user_id),
            )
            return False

        self._frontend_websockets[connection_id].add(websocket)

        # Start listening for responses from runner
        listener_key = f"{connection_id}:{id(websocket)}"
        listener_task = asyncio.create_task(
            self._listen_for_responses(connection_id, websocket, listener_key)
        )
        self.frontend_listeners[listener_key] = listener_task

        logger.info(
            "frontend_connected_to_runner",
            connection_id=connection_id,
            user_id=str(user_id),
            total_frontends=len(self._frontend_websockets[connection_id]),
        )
        return True

    async def disconnect_frontend(
        self, connection_id: int, websocket: WebSocket
    ) -> None:
        """
        Disconnect a frontend WebSocket from a runner.

        Args:
            connection_id: Runner connection ID
            websocket: Frontend WebSocket connection
        """
        if connection_id in self._frontend_websockets:
            self._frontend_websockets[connection_id].discard(websocket)
            if not self._frontend_websockets[connection_id]:
                del self._frontend_websockets[connection_id]

        listener_key = f"{connection_id}:{id(websocket)}"
        if listener_key in self.frontend_listeners:
            self.frontend_listeners[listener_key].cancel()
            del self.frontend_listeners[listener_key]

        logger.info(
            "frontend_disconnected_from_runner",
            connection_id=connection_id,
        )

    async def send_command_to_runner(
        self, connection_id: int, command: dict[str, Any]
    ) -> bool:
        """
        Send a command from frontend to runner.

        Args:
            connection_id: Runner connection ID
            command: Command message to send

        Returns:
            True if sent successfully, False if runner not connected
        """
        # Check if runner is connected in memory (local process)
        if connection_id not in self._runner_websockets:
            return False

        channel = f"runner:commands:{connection_id}"
        try:
            await self.redis.publish(channel, json.dumps(command))
            logger.debug(
                "command_sent_to_runner",
                connection_id=connection_id,
                command_type=command.get("type"),
            )
            return True
        except Exception as e:
            logger.error(
                "command_send_failed",
                connection_id=connection_id,
                error=str(e),
            )
            return False

    async def send_response_to_frontends(
        self, connection_id: int, response: dict[str, Any]
    ) -> None:
        """
        Send a response from runner to all connected frontends.

        Args:
            connection_id: Runner connection ID
            response: Response message to send
        """
        channel = f"runner:responses:{connection_id}"
        try:
            await self.redis.publish(channel, json.dumps(response))
            logger.debug(
                "response_published",
                connection_id=connection_id,
                response_type=response.get("type"),
            )
        except Exception as e:
            logger.error(
                "response_publish_failed",
                connection_id=connection_id,
                error=str(e),
            )

    async def _listen_for_commands(
        self, connection_id: int, runner_websocket: WebSocket
    ) -> None:
        """
        Listen for commands from frontend and forward to runner.

        Args:
            connection_id: Runner connection ID
            runner_websocket: Runner's WebSocket connection
        """
        channel = f"runner:commands:{connection_id}"
        pubsub = self.redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "runner_command_listener_started",
                connection_id=connection_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        command = json.loads(message["data"])
                        await runner_websocket.send_json(command)
                        logger.debug(
                            "command_forwarded_to_runner",
                            connection_id=connection_id,
                            command_type=command.get("type"),
                        )
                    except Exception as e:
                        logger.error(
                            "command_forward_failed",
                            connection_id=connection_id,
                            error=str(e),
                        )
                        break

        except asyncio.CancelledError:
            logger.info(
                "runner_command_listener_cancelled",
                connection_id=connection_id,
            )
        except Exception as e:
            logger.error(
                "runner_command_listener_error",
                connection_id=connection_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    async def _listen_for_responses(
        self, connection_id: int, frontend_websocket: WebSocket, listener_key: str
    ) -> None:
        """
        Listen for responses from runner and forward to frontend.

        Args:
            connection_id: Runner connection ID
            frontend_websocket: Frontend's WebSocket connection
            listener_key: Unique key for this listener
        """
        channel = f"runner:responses:{connection_id}"
        pubsub = self.redis.pubsub()

        try:
            await pubsub.subscribe(channel)
            logger.info(
                "frontend_response_listener_started",
                connection_id=connection_id,
                channel=channel,
            )

            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        response = json.loads(message["data"])
                        await frontend_websocket.send_json(response)
                        logger.debug(
                            "response_forwarded_to_frontend",
                            connection_id=connection_id,
                            response_type=response.get("type"),
                        )
                    except Exception as e:
                        logger.error(
                            "response_forward_failed",
                            connection_id=connection_id,
                            error=str(e),
                        )
                        break

        except asyncio.CancelledError:
            logger.info(
                "frontend_response_listener_cancelled",
                connection_id=connection_id,
            )
        except Exception as e:
            logger.error(
                "frontend_response_listener_error",
                connection_id=connection_id,
                error=str(e),
            )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    async def _notify_frontends(
        self, connection_id: int, message: dict[str, Any]
    ) -> None:
        """
        Notify all connected frontends with a message.

        Args:
            connection_id: Runner connection ID
            message: Message to send
        """
        if connection_id not in self._frontend_websockets:
            return

        failed = []
        for ws in self._frontend_websockets[connection_id]:
            try:
                await ws.send_json(message)
            except Exception:
                failed.append(ws)

        for ws in failed:
            self._frontend_websockets[connection_id].discard(ws)

    async def _publish_status_update(
        self, user_id: UUID, message: dict[str, Any]
    ) -> None:
        """
        Publish a status update to Redis for real-time notifications.

        Args:
            user_id: User ID to send the update to
            message: Status update message
        """
        channel = f"runner:status:updates:{user_id}"
        try:
            result = await self.redis.publish(channel, json.dumps(message))
            logger.info(
                "runner_status_update_published",
                user_id=str(user_id),
                message_type=message.get("type"),
                channel=channel,
                subscribers=result,  # Number of subscribers that received the message
            )
        except Exception as e:
            logger.error(
                "runner_status_update_publish_failed",
                user_id=str(user_id),
                error=str(e),
            )

    async def disconnect_runner(self, connection_id: int) -> bool:
        """
        Forcefully disconnect a runner WebSocket.

        Args:
            connection_id: Database connection record ID

        Returns:
            True if runner was connected and disconnect initiated, False otherwise
        """
        if connection_id not in self._runner_websockets:
            return False

        try:
            websocket = self._runner_websockets[connection_id]
            await websocket.close()
            logger.info("runner_force_disconnected", connection_id=connection_id)
            return True
        except Exception as e:
            logger.error(
                "runner_force_disconnect_failed",
                connection_id=connection_id,
                error=str(e),
            )
            return False

    def is_runner_connected(self, connection_id: int) -> bool:
        """
        Check if a runner is connected in this process (memory check).

        For local WebSocket connections in this process only.
        Use is_runner_connected_redis() for cross-process checks.

        Args:
            connection_id: Database connection record ID

        Returns:
            True if runner is connected in this process
        """
        return connection_id in self._runner_websockets

    async def is_runner_connected_redis(self, connection_id: int) -> bool:
        """
        Check if a runner is connected across all processes (Redis check).

        Queries Redis state to determine if any process has an active connection.

        Args:
            connection_id: Database connection record ID

        Returns:
            True if runner is connected in any process
        """
        active_key = f"runner:connection:{connection_id}:active"
        exists = await self.redis.exists(active_key)
        return bool(exists > 0)

    def get_connected_runner_ids(self) -> list[int]:
        """
        Get list of connected runner connection IDs in this process.

        Returns connection IDs for runners connected to this process only.
        Use get_all_connected_runner_ids_redis() for cross-process list.

        Returns:
            List of connection IDs connected to this process
        """
        return list(self._runner_websockets.keys())

    async def get_all_connected_runner_ids_redis(self) -> list[int]:
        """
        Get all connected runner connection IDs across all processes.

        Scans Redis for all active connections across the cluster.

        Returns:
            List of all active connection IDs across all processes
        """
        try:
            # Scan for all active connection keys
            keys = await self.redis.keys("runner:connection:*:active")
            connection_ids = []
            for key in keys:
                # Extract connection_id from key format: runner:connection:{id}:active
                key_str = key.decode() if isinstance(key, bytes) else key
                parts = key_str.split(":")
                if len(parts) == 4:
                    try:
                        connection_ids.append(int(parts[2]))
                    except ValueError:
                        logger.warning("invalid_redis_key_format", key=key_str)
            return connection_ids
        except Exception as e:
            logger.error("redis_scan_failed", error=str(e))
            return []

    async def refresh_connection_ttl(self, connection_id: int) -> bool:
        """
        Refresh the TTL on connection keys (called on heartbeat).

        Args:
            connection_id: Database connection record ID

        Returns:
            True if refresh successful, False if connection not found
        """
        active_key = f"runner:connection:{connection_id}:active"
        metadata_key = f"runner:connection:{connection_id}:metadata"

        try:
            # Refresh TTL on both keys
            active_updated = await self.redis.expire(active_key, REDIS_CONNECTION_TTL)
            metadata_updated = await self.redis.expire(
                metadata_key, REDIS_CONNECTION_TTL
            )

            if active_updated and metadata_updated:
                logger.debug("connection_ttl_refreshed", connection_id=connection_id)
                return True
            else:
                logger.warning(
                    "connection_ttl_refresh_failed", connection_id=connection_id
                )
                return False
        except Exception as e:
            logger.error(
                "connection_ttl_refresh_error",
                connection_id=connection_id,
                error=str(e),
            )
            return False

    async def get_connection_metadata(
        self, connection_id: int
    ) -> dict[str, Any] | None:
        """
        Get connection metadata from Redis.

        Args:
            connection_id: Database connection record ID

        Returns:
            Metadata dict or None if not found
        """
        metadata_key = f"runner:connection:{connection_id}:metadata"
        try:
            metadata_json = await self.redis.get(metadata_key)
            if metadata_json:
                result: dict[str, Any] = json.loads(metadata_json)
                return result
            return None
        except Exception as e:
            logger.error(
                "get_metadata_failed", connection_id=connection_id, error=str(e)
            )
            return None


# Singleton instance
_runner_connection_manager: RunnerConnectionManager | None = None


async def get_runner_connection_manager(
    redis_client: aioredis.Redis,
) -> RunnerConnectionManager:
    """
    Get the singleton RunnerConnectionManager instance.

    Args:
        redis_client: Redis client for pub/sub

    Returns:
        RunnerConnectionManager instance
    """
    global _runner_connection_manager
    if _runner_connection_manager is None:
        _runner_connection_manager = RunnerConnectionManager(redis_client)
    return _runner_connection_manager
