"""
Runner Connection Manager for bidirectional frontend-runner communication.

This module provides a facade that orchestrates the runner connection services.
The actual functionality is delegated to focused, single-responsibility services.

Architecture:
- Runners connect to /ws/automation/runner and register with connection_id
- Frontend connects to /ws/runner/command/{connection_id} to send commands
- Commands are relayed via Redis pub/sub channels

Services:
- WebSocketConnectionRegistry: In-memory WebSocket reference management
- RunnerStateRepository: Redis persistence for connection state
- CommandRelayService: Command/response routing via Redis pub/sub
- RunnerEventPublisher: Status event broadcasting
"""

import asyncio
import json
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import WebSocket
from qontinui_schemas.common import utc_now
from redis import asyncio as aioredis

from app.services.runner.chat_relay import ChatRelayService
from app.services.runner.command_relay import CommandRelayService
from app.services.runner.connection_registry import WebSocketConnectionRegistry
from app.services.runner.event_publisher import RunnerEventPublisher
from app.services.runner.state_repository import RunnerStateRepository
from app.services.runner.terminal_relay import TerminalRelayService

logger = structlog.get_logger(__name__)

# Redis TTL for the user:{user_id}:connections reverse-lookup set entries.
# Matches the per-connection TTL used by RunnerStateRepository so a stale
# user-set entry expires roughly in lockstep with the connection it points to.
USER_CONNECTIONS_TTL_SECONDS = 300

# Wake-intent Redis key prefix and TTL. Used by Phase F.2 wake-from-web.
WAKE_INTENT_KEY_PREFIX = "wake_intent"
WAKE_INTENT_TTL_SECONDS = 60


class RunnerConnectionManager:
    """
    Facade that orchestrates runner connection services.

    This class provides backward-compatible API while delegating
    all functionality to focused, single-responsibility services.

    Architecture:
    - Runners connect to /ws/automation/runner and register with connection_id
    - Frontend connects to /ws/runner/command/{connection_id} to send commands
    - Commands are relayed via Redis pub/sub channels:
      - runner:commands:{connection_id} - Frontend -> Runner commands
      - runner:responses:{connection_id} - Runner -> Frontend responses

    State Management:
    - Connection state stored in Redis for persistence across restarts
    - WebSocket references kept in memory (cannot be serialized)
    - TTL-based auto-cleanup for crash scenarios (5 minutes, refreshed on heartbeat)
    """

    def __init__(self, redis_client: aioredis.Redis):
        # Initialize the focused services
        self._registry = WebSocketConnectionRegistry()
        self._state_repo = RunnerStateRepository(redis_client)
        self._relay = CommandRelayService(redis_client, self._registry)
        self._chat_relay = ChatRelayService(redis_client, self._registry)
        self._terminal_relay = TerminalRelayService(redis_client, self._registry)
        self._publisher = RunnerEventPublisher(redis_client)
        self._redis = redis_client
        # Per-connection locks to synchronize WebSocket sends across relay services
        self._ws_send_locks: dict[int, asyncio.Lock] = {}

        logger.info("runner_connection_manager_initialized_with_redis_state")

    # ========================================================================
    # Runner Registration
    # ========================================================================

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
        connected_at = connected_at or utc_now()

        # Store in memory registry
        self._registry.register_runner(connection_id, websocket)

        # Create per-connection lock for synchronized WebSocket sends
        self._ws_send_locks[connection_id] = asyncio.Lock()

        # Store in Redis for persistence
        await self._state_repo.save_connection_state(
            connection_id=connection_id,
            user_id=str(user_id),
            connected_at=connected_at.isoformat(),
            runner_name=runner_name,
            ip_address=ip_address,
        )

        # Persist a user -> connection_id reverse lookup so Phase F.2's
        # is_user_online() can find a live connection without scanning every
        # metadata key. Stored as a Redis set with a refreshed TTL.
        await self._save_user_connection_mapping(user_id, connection_id)

        # Build a thread-safe send callback for relay services
        send_lock = self._ws_send_locks[connection_id]

        async def locked_send(data: dict[str, Any]) -> None:
            async with send_lock:
                await websocket.send_json(data)

        # Start command listener
        await self._relay.start_runner_listener(
            connection_id, websocket, send_fn=locked_send
        )

        # Start chat listener
        await self._chat_relay.start_runner_listener(
            connection_id, websocket, send_fn=locked_send
        )

        # Start terminal listener
        await self._terminal_relay.start_runner_listener(
            connection_id, websocket, send_fn=locked_send
        )

        # Publish connected event
        await self._publisher.publish_runner_connected(
            user_id=user_id,
            connection_id=connection_id,
            runner_name=runner_name,
            connected_at=connected_at,
            ip_address=ip_address,
            project_id=project_id,
        )

        logger.info(
            "runner_registered",
            connection_id=connection_id,
            user_id=str(user_id),
            runner_name=runner_name,
            redis_state_stored=True,
        )

        # Phase F.2: if a wake intent is pending for this user, fulfill it now
        # and surface a runner.woke event so the frontend can transition out
        # of its "waking" state and dispatch the queued task.
        try:
            fulfilled = await self.fulfill_wake_intent(str(user_id), connection_id)
            if fulfilled is not None:
                task_id_value = fulfilled.get("task_id")
                await self._publisher.publish_runner_woke(
                    user_id=user_id,
                    connection_id=connection_id,
                    intent_id=fulfilled.get("intent_id"),
                    task_id=str(task_id_value) if task_id_value else None,
                    reason=fulfilled.get("reason"),
                )
                logger.info(
                    "wake_intent_fulfilled",
                    connection_id=connection_id,
                    user_id=str(user_id),
                    intent_id=fulfilled.get("intent_id"),
                )
        except Exception as e:
            # Wake-intent fulfillment must never block runner registration.
            logger.error(
                "wake_intent_fulfill_error",
                connection_id=connection_id,
                user_id=str(user_id),
                error=str(e),
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
        # Get user_id from Redis if not provided
        if user_id is None:
            metadata = await self._state_repo.get_connection_metadata(connection_id)
            if metadata:
                try:
                    user_id = UUID(metadata.get("user_id"))
                except Exception:
                    pass

        # Remove from Redis
        await self._state_repo.delete_connection_state(connection_id)

        # Remove the user -> connection reverse-lookup entry so a subsequent
        # is_user_online() check correctly returns "offline".
        if user_id is not None:
            await self._remove_user_connection_mapping(user_id, connection_id)

        # Remove from memory
        self._registry.unregister_runner(connection_id)

        # Stop listeners
        await self._relay.stop_runner_listener(connection_id)

        # Notify mobile clients before stopping the chat relay listener
        await self._chat_relay.notify_mobiles(
            connection_id,
            {
                "type": "runner_disconnected",
                "connection_id": connection_id,
                "timestamp": utc_now().isoformat(),
            },
        )

        await self._chat_relay.stop_runner_listener(connection_id)

        # Notify mobile terminal clients before stopping the terminal relay listener
        await self._terminal_relay.notify_mobiles(
            connection_id,
            {
                "type": "runner_disconnected",
                "connection_id": connection_id,
                "timestamp": utc_now().isoformat(),
            },
        )

        await self._terminal_relay.stop_runner_listener(connection_id)

        # Remove per-connection send lock
        self._ws_send_locks.pop(connection_id, None)

        # Notify connected frontends
        await self._relay.notify_frontends(
            connection_id,
            {"type": "runner_disconnected", "timestamp": utc_now().isoformat()},
        )

        # Publish disconnected event
        if user_id:
            await self._publisher.publish_runner_disconnected(user_id, connection_id)

        logger.info(
            "runner_unregistered", connection_id=connection_id, redis_state_removed=True
        )

    # ========================================================================
    # Frontend Connection
    # ========================================================================

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
        if not self._registry.is_runner_connected(connection_id):
            logger.warning(
                "frontend_connect_runner_not_found",
                connection_id=connection_id,
                user_id=str(user_id),
            )
            return False

        self._registry.register_frontend(connection_id, websocket)
        await self._relay.start_frontend_listener(connection_id, websocket)

        logger.info(
            "frontend_connected_to_runner",
            connection_id=connection_id,
            user_id=str(user_id),
            total_frontends=len(self._registry.get_frontend_websockets(connection_id)),
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
        self._registry.unregister_frontend(connection_id, websocket)
        await self._relay.stop_frontend_listener(connection_id, websocket)

        logger.info(
            "frontend_disconnected_from_runner",
            connection_id=connection_id,
        )

    # ========================================================================
    # Command/Response Relay
    # ========================================================================

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
        return await self._relay.send_command_to_runner(connection_id, command)

    async def send_response_to_frontends(
        self, connection_id: int, response: dict[str, Any]
    ) -> None:
        """
        Send a response from runner to all connected frontends.

        Args:
            connection_id: Runner connection ID
            response: Response message to send
        """
        await self._relay.send_response_to_frontends(connection_id, response)

    # ========================================================================
    # Mobile Chat Connection
    # ========================================================================

    async def connect_mobile_chat(
        self, connection_id: int, websocket: WebSocket, user_id: UUID
    ) -> bool:
        """
        Connect a mobile WebSocket for chat relay.

        Args:
            connection_id: Runner connection ID to connect to
            websocket: Mobile WebSocket connection
            user_id: Requesting user ID

        Returns:
            True if connection successful, False if runner not connected
        """
        if not self._registry.is_runner_connected(connection_id):
            logger.warning(
                "mobile_chat_connect_runner_not_found",
                connection_id=connection_id,
                user_id=str(user_id),
            )
            return False

        await self._chat_relay.start_mobile_listener(connection_id, websocket)

        logger.info(
            "mobile_chat_connected_to_runner",
            connection_id=connection_id,
            user_id=str(user_id),
        )
        return True

    async def disconnect_mobile_chat(
        self, connection_id: int, websocket: WebSocket
    ) -> None:
        """
        Disconnect a mobile chat WebSocket.

        Args:
            connection_id: Runner connection ID
            websocket: Mobile WebSocket connection
        """
        await self._chat_relay.stop_mobile_listener(connection_id, websocket)

        logger.info(
            "mobile_chat_disconnected_from_runner",
            connection_id=connection_id,
        )

    async def send_chat_to_runner(
        self, connection_id: int, message: dict[str, Any]
    ) -> bool:
        """
        Send chat message from mobile to runner.

        Args:
            connection_id: Runner connection ID
            message: Chat message to send

        Returns:
            True if sent successfully, False if runner not connected
        """
        return await self._chat_relay.send_chat_to_runner(connection_id, message)

    async def send_chat_response_to_mobiles(
        self, connection_id: int, response: dict[str, Any]
    ) -> None:
        """
        Send chat response from runner to all connected mobiles.

        Args:
            connection_id: Runner connection ID
            response: Chat response message to send
        """
        await self._chat_relay.send_response_to_mobiles(connection_id, response)

    # ========================================================================
    # Mobile Terminal Connection
    # ========================================================================

    async def connect_mobile_terminal(
        self, connection_id: int, websocket: WebSocket, user_id: UUID
    ) -> bool:
        """
        Connect a mobile WebSocket for terminal relay.

        Always starts the mobile listener so future events are delivered
        even if the runner is currently offline.

        Args:
            connection_id: Runner connection ID to connect to
            websocket: Mobile WebSocket connection
            user_id: Requesting user ID

        Returns:
            True if runner is currently connected, False otherwise
        """
        runner_connected = self._registry.is_runner_connected(connection_id)
        if not runner_connected:
            logger.warning(
                "mobile_terminal_connect_runner_not_found",
                connection_id=connection_id,
                user_id=str(user_id),
            )

        # Always start listener so mobile receives future events
        await self._terminal_relay.start_mobile_listener(connection_id, websocket)

        logger.info(
            "mobile_terminal_connected_to_runner",
            connection_id=connection_id,
            user_id=str(user_id),
            runner_connected=runner_connected,
        )
        return runner_connected

    async def disconnect_mobile_terminal(
        self, connection_id: int, websocket: WebSocket
    ) -> None:
        """
        Disconnect a mobile terminal WebSocket.

        Args:
            connection_id: Runner connection ID
            websocket: Mobile WebSocket connection
        """
        await self._terminal_relay.stop_mobile_listener(connection_id, websocket)

        logger.info(
            "mobile_terminal_disconnected_from_runner",
            connection_id=connection_id,
        )

    async def send_terminal_to_runner(
        self, connection_id: int, message: dict[str, Any]
    ) -> bool:
        """
        Send terminal message from mobile to runner.

        Args:
            connection_id: Runner connection ID
            message: Terminal message to send

        Returns:
            True if sent successfully, False if runner not connected
        """
        return await self._terminal_relay.send_terminal_to_runner(
            connection_id, message
        )

    async def send_terminal_response_to_mobiles(
        self, connection_id: int, response: dict[str, Any]
    ) -> None:
        """
        Send terminal response from runner to all connected mobiles.

        Args:
            connection_id: Runner connection ID
            response: Terminal response message to send
        """
        await self._terminal_relay.send_response_to_mobiles(connection_id, response)

    # ========================================================================
    # Status Publishing
    # ========================================================================

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
        await self._publisher.publish_runner_name_updated(
            user_id=user_id,
            connection_id=connection_id,
            runner_name=runner_name,
        )

    async def publish_runner_port_update(
        self, connection_id: int, runner_port: int, user_id: UUID
    ) -> None:
        """
        Publish a runner port update event to the frontend.

        Called when the runner sends its runner_info message after connection,
        which contains the HTTP API port.

        Args:
            connection_id: Database connection record ID
            runner_port: The HTTP API port the runner is listening on
            user_id: User ID to send the update to
        """
        await self._publisher.publish_runner_port_updated(
            user_id=user_id,
            connection_id=connection_id,
            runner_port=runner_port,
        )

    # ========================================================================
    # Connection State Queries
    # ========================================================================

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
        return self._registry.is_runner_connected(connection_id)

    async def is_runner_connected_redis(self, connection_id: int) -> bool:
        """
        Check if a runner is connected across all processes (Redis check).

        Queries Redis state to determine if any process has an active connection.

        Args:
            connection_id: Database connection record ID

        Returns:
            True if runner is connected in any process
        """
        return await self._state_repo.is_connected_redis(connection_id)

    def get_connected_runner_ids(self) -> list[int]:
        """
        Get list of connected runner connection IDs in this process.

        Returns connection IDs for runners connected to this process only.
        Use get_all_connected_runner_ids_redis() for cross-process list.

        Returns:
            List of connection IDs connected to this process
        """
        return self._registry.get_connected_runner_ids()

    async def get_all_connected_runner_ids_redis(self) -> list[int]:
        """
        Get all connected runner connection IDs across all processes.

        Scans Redis for all active connections across the cluster.

        Returns:
            List of all active connection IDs across all processes
        """
        return await self._state_repo.get_all_connected_ids()

    async def refresh_connection_ttl(self, connection_id: int) -> bool:
        """
        Refresh the TTL on connection keys (called on heartbeat).

        Args:
            connection_id: Database connection record ID

        Returns:
            True if refresh successful, False if connection not found
        """
        return await self._state_repo.refresh_ttl(connection_id)

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
        return await self._state_repo.get_connection_metadata(connection_id)

    # ========================================================================
    # User → Connection Reverse Lookup (Phase F.2)
    # ========================================================================

    @staticmethod
    def _user_connections_key(user_id: str | UUID) -> str:
        """Redis set key holding all live connection_ids for a given user."""
        return f"user:{user_id}:connections"

    async def _save_user_connection_mapping(
        self, user_id: UUID, connection_id: int
    ) -> None:
        """Add ``connection_id`` to the user's reverse-lookup set in Redis."""
        key = self._user_connections_key(user_id)
        try:
            await self._redis.sadd(key, str(connection_id))  # type: ignore[misc]
            await self._redis.expire(key, USER_CONNECTIONS_TTL_SECONDS)
        except Exception as e:
            logger.error(
                "user_connection_mapping_save_failed",
                connection_id=connection_id,
                user_id=str(user_id),
                error=str(e),
            )

    async def _remove_user_connection_mapping(
        self, user_id: UUID, connection_id: int
    ) -> None:
        """Remove ``connection_id`` from the user's reverse-lookup set."""
        key = self._user_connections_key(user_id)
        try:
            await self._redis.srem(key, str(connection_id))  # type: ignore[misc]
        except Exception as e:
            logger.error(
                "user_connection_mapping_remove_failed",
                connection_id=connection_id,
                user_id=str(user_id),
                error=str(e),
            )

    async def is_user_online(self, user_id: str | UUID) -> int | None:
        """
        Return one live ``connection_id`` for ``user_id`` if any is online.

        Looks up the per-user Redis set written by ``register_runner`` and
        validates each candidate via ``is_runner_connected_redis`` so dead
        entries (TTL-expired connections) are skipped. Returns the first
        live connection_id, or ``None`` if the user has no live runner.

        Args:
            user_id: Owner user ID (str or UUID).

        Returns:
            A live connection_id, or None if the user is not online.
        """
        key = self._user_connections_key(user_id)
        try:
            members = await self._redis.smembers(key)  # type: ignore[misc]
        except Exception as e:
            logger.error(
                "user_connections_lookup_failed",
                user_id=str(user_id),
                error=str(e),
            )
            return None

        if not members:
            return None

        for raw in members:
            value = raw.decode() if isinstance(raw, bytes) else raw
            try:
                conn_id = int(value)
            except (TypeError, ValueError):
                logger.warning(
                    "user_connection_invalid_member",
                    user_id=str(user_id),
                    value=value,
                )
                # Best-effort cleanup: drop garbage entries so future lookups
                # aren't slowed by them.
                try:
                    await self._redis.srem(key, value)  # type: ignore[misc]
                except Exception:
                    pass
                continue

            if await self.is_runner_connected_redis(conn_id):
                return conn_id

            # Stale entry — TTL expired on connection state but the set still
            # remembers it. Clean up so the next caller doesn't repeat the
            # work.
            try:
                await self._redis.srem(key, value)  # type: ignore[misc]
            except Exception:
                pass

        return None

    # ========================================================================
    # Wake Intents (Phase F.2)
    # ========================================================================

    @staticmethod
    def _wake_intent_pattern(user_id: str | UUID) -> str:
        return f"{WAKE_INTENT_KEY_PREFIX}:{user_id}:*"

    async def fulfill_wake_intent(
        self, user_id: str, connection_id: int
    ) -> dict[str, Any] | None:
        """
        Find and consume a pending wake intent for ``user_id``.

        Scans Redis for keys matching ``wake_intent:{user_id}:*``. If a
        non-expired intent exists, deletes it and returns the parsed
        payload. Designed to be called immediately after a runner
        registers so the frontend can be notified that its wake request
        was honoured.

        Args:
            user_id: Owner user ID (string form, matching how the wake
                endpoint stores it).
            connection_id: The connection that just came online (logged
                only — not stored back into the payload).

        Returns:
            The intent payload (dict including ``intent_id``) on success,
            or None if no pending intent was found.
        """
        pattern = self._wake_intent_pattern(user_id)
        try:
            keys: list[Any] = await self._redis.keys(pattern)
        except Exception as e:
            logger.error(
                "wake_intent_scan_failed",
                user_id=user_id,
                connection_id=connection_id,
                error=str(e),
            )
            return None

        for raw_key in keys:
            key = raw_key.decode() if isinstance(raw_key, bytes) else raw_key
            try:
                raw_value = await self._redis.get(key)
            except Exception as e:
                logger.error(
                    "wake_intent_get_failed",
                    user_id=user_id,
                    key=key,
                    error=str(e),
                )
                continue

            if raw_value is None:
                # TTL expired between keys() and get() — skip.
                continue

            try:
                payload: dict[str, Any] = json.loads(raw_value)
            except (TypeError, ValueError) as e:
                logger.warning(
                    "wake_intent_payload_invalid",
                    user_id=user_id,
                    key=key,
                    error=str(e),
                )
                # Drop the corrupt key so it doesn't keep tripping us.
                try:
                    await self._redis.delete(key)
                except Exception:
                    pass
                continue

            # Delete first so we never fulfill the same intent twice.
            try:
                await self._redis.delete(key)
            except Exception as e:
                logger.error(
                    "wake_intent_delete_failed",
                    user_id=user_id,
                    key=key,
                    error=str(e),
                )

            # Extract intent_id from the key tail if missing from payload.
            if "intent_id" not in payload:
                tail = key.split(":")[-1]
                payload["intent_id"] = tail

            return payload

        return None

    # ========================================================================
    # Force Disconnect
    # ========================================================================

    async def disconnect_runner(self, connection_id: int) -> bool:
        """
        Forcefully disconnect a runner WebSocket.

        Args:
            connection_id: Database connection record ID

        Returns:
            True if runner was connected and disconnect initiated, False otherwise
        """
        websocket = self._registry.get_runner_websocket(connection_id)
        if not websocket:
            return False

        try:
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
