"""
Runner State Repository for Redis persistence.

Manages runner connection state in Redis for persistence across server restarts.
"""

import json
from typing import Any

import structlog
from redis import asyncio as aioredis

logger = structlog.get_logger(__name__)

# Redis key TTL in seconds (5 minutes)
REDIS_CONNECTION_TTL = 300


class RunnerStateRepository:
    """
    Redis persistence for runner connection state.

    Stores connection metadata in Redis for persistence across server restarts.
    Uses TTL-based auto-cleanup for crash scenarios.

    Redis keys:
    - runner:connection:{connection_id}:active - Indicates active connection
    - runner:connection:{connection_id}:metadata - Connection metadata (JSON)
    """

    def __init__(self, redis_client: aioredis.Redis):
        self._redis = redis_client

    async def save_connection_state(
        self,
        connection_id: int,
        user_id: str,
        connected_at: str,
        runner_name: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        """
        Save connection state to Redis.

        Args:
            connection_id: Database connection record ID
            user_id: Owner user ID (as string)
            connected_at: ISO format timestamp
            runner_name: Optional runner name
            ip_address: Optional IP address
        """
        active_key = f"runner:connection:{connection_id}:active"
        metadata_key = f"runner:connection:{connection_id}:metadata"

        # Set active flag with TTL
        await self._redis.set(active_key, "1", ex=REDIS_CONNECTION_TTL)

        # Store metadata with TTL
        metadata = {
            "user_id": user_id,
            "connected_at": connected_at,
            "runner_name": runner_name,
            "ip_address": ip_address,
        }
        await self._redis.set(
            metadata_key, json.dumps(metadata), ex=REDIS_CONNECTION_TTL
        )

        logger.debug(
            "connection_state_saved",
            connection_id=connection_id,
            user_id=user_id,
        )

    async def delete_connection_state(self, connection_id: int) -> None:
        """Remove connection state from Redis."""
        active_key = f"runner:connection:{connection_id}:active"
        metadata_key = f"runner:connection:{connection_id}:metadata"
        await self._redis.delete(active_key)
        await self._redis.delete(metadata_key)
        logger.debug("connection_state_deleted", connection_id=connection_id)

    async def get_connection_metadata(
        self, connection_id: int
    ) -> dict[str, Any] | None:
        """Get connection metadata from Redis."""
        metadata_key = f"runner:connection:{connection_id}:metadata"
        try:
            metadata_json = await self._redis.get(metadata_key)
            if metadata_json:
                result: dict[str, Any] = json.loads(metadata_json)
                return result
            return None
        except Exception as e:
            logger.error(
                "get_metadata_failed", connection_id=connection_id, error=str(e)
            )
            return None

    async def update_metadata(
        self, connection_id: int, updates: dict[str, Any]
    ) -> bool:
        """Update specific fields in connection metadata."""
        metadata = await self.get_connection_metadata(connection_id)
        if not metadata:
            return False

        metadata.update(updates)
        metadata_key = f"runner:connection:{connection_id}:metadata"
        await self._redis.set(
            metadata_key, json.dumps(metadata), ex=REDIS_CONNECTION_TTL
        )
        return True

    async def is_connected_redis(self, connection_id: int) -> bool:
        """
        Check if a runner is connected across all processes (Redis check).

        Queries Redis state to determine if any process has an active connection.
        """
        active_key = f"runner:connection:{connection_id}:active"
        exists = await self._redis.exists(active_key)
        return bool(exists > 0)

    async def get_all_connected_ids(self) -> list[int]:
        """
        Get all connected runner connection IDs across all processes.

        Scans Redis for all active connections across the cluster.
        """
        try:
            keys = await self._redis.keys("runner:connection:*:active")
            connection_ids = []
            for key in keys:
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

    async def refresh_ttl(self, connection_id: int) -> bool:
        """
        Refresh the TTL on connection keys (called on heartbeat).

        Returns:
            True if refresh successful, False if connection not found
        """
        active_key = f"runner:connection:{connection_id}:active"
        metadata_key = f"runner:connection:{connection_id}:metadata"

        try:
            active_updated = await self._redis.expire(active_key, REDIS_CONNECTION_TTL)
            metadata_updated = await self._redis.expire(
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
