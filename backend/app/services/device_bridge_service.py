"""
Device Bridge Service — manages ephemeral mobile device connection state in Redis.

Tracks which devices are connected, active relay tunnels, and provides
pub/sub channel names for the runner↔device relay.
"""

import json
import uuid
from datetime import UTC, datetime

import structlog
from redis import asyncio as aioredis

logger = structlog.get_logger(__name__)

# Redis TTL for device/tunnel registrations (1 hour, refreshed on heartbeat)
_DEVICE_TTL_SECONDS = 3600
_TUNNEL_TTL_SECONDS = 3600


class DeviceBridgeService:
    """Manages device bridge connections and relay state in Redis."""

    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client

    # ------------------------------------------------------------------
    # Key helpers
    # ------------------------------------------------------------------

    def _device_key(self, user_id: str, device_id: str) -> str:
        return f"device_bridge:{user_id}:{device_id}"

    def _tunnel_key(self, user_id: str, device_id: str) -> str:
        return f"device_bridge_tunnel:{user_id}:{device_id}"

    def device_channel(self, user_id: str, device_id: str) -> str:
        """Redis pub/sub channel for runner→device messages."""
        return f"device_bridge:to_device:{user_id}:{device_id}"

    def runner_channel(self, user_id: str, device_id: str) -> str:
        """Redis pub/sub channel for device→runner messages."""
        return f"device_bridge:to_runner:{user_id}:{device_id}"

    # ------------------------------------------------------------------
    # Device registration
    # ------------------------------------------------------------------

    async def register_device(self, user_id: str, device_id: str, info: dict) -> str:
        """
        Register a device connection in Redis.

        Args:
            user_id: Authenticated user ID (string).
            device_id: Unique identifier for the device (from device_register message).
            info: Dict with keys: display_name, platform, app_id, ui_bridge_version, ws_id.

        Returns:
            session_id (UUID string) assigned to this connection.
        """
        session_id = str(uuid.uuid4())
        record = {
            "session_id": session_id,
            "connected_at": datetime.now(UTC).isoformat(),
            "device_id": device_id,
            "display_name": info.get("display_name", ""),
            "platform": info.get("platform", ""),
            "app_id": info.get("app_id", ""),
            "ui_bridge_version": info.get("ui_bridge_version", ""),
            "ws_id": info.get("ws_id", ""),
        }
        key = self._device_key(user_id, device_id)
        await self.redis.set(key, json.dumps(record), ex=_DEVICE_TTL_SECONDS)
        logger.info(
            "device_bridge_registered",
            user_id=user_id,
            device_id=device_id,
            session_id=session_id,
            platform=record["platform"],
        )
        return session_id

    async def unregister_device(self, user_id: str, device_id: str) -> None:
        """Remove device registration from Redis."""
        key = self._device_key(user_id, device_id)
        await self.redis.delete(key)
        logger.info(
            "device_bridge_unregistered",
            user_id=user_id,
            device_id=device_id,
        )

    async def get_device(self, user_id: str, device_id: str) -> dict | None:
        """
        Fetch device info from Redis.

        Returns:
            Dict with device info, or None if not connected.
        """
        key = self._device_key(user_id, device_id)
        raw = await self.redis.get(key)
        if raw is None:
            return None
        try:
            result: dict[str, object] = json.loads(raw)
            return result
        except json.JSONDecodeError as e:
            logger.error(
                "device_bridge_parse_error",
                user_id=user_id,
                device_id=device_id,
                error=str(e),
            )
            return None

    async def list_devices(self, user_id: str) -> list[dict]:
        """
        List all connected devices for a user by scanning Redis keys.

        Returns:
            List of device info dicts.
        """
        pattern = f"device_bridge:{user_id}:*"
        devices: list[dict] = []

        # Use SCAN to avoid blocking with KEYS on large datasets
        cursor = 0
        while True:
            cursor, keys = await self.redis.scan(cursor, match=pattern, count=100)
            for key in keys:
                # Skip tunnel keys (different prefix shape guard)
                if ":tunnel:" in key or key.startswith("device_bridge_tunnel:"):
                    continue
                raw = await self.redis.get(key)
                if raw:
                    try:
                        devices.append(json.loads(raw))
                    except json.JSONDecodeError:
                        pass
            if cursor == 0:
                break

        return devices

    # ------------------------------------------------------------------
    # Tunnel registration
    # ------------------------------------------------------------------

    async def register_tunnel(
        self, user_id: str, device_id: str, tunnel_id: str
    ) -> None:
        """Register a runner tunnel connection to a device."""
        key = self._tunnel_key(user_id, device_id)
        await self.redis.set(key, tunnel_id, ex=_TUNNEL_TTL_SECONDS)
        logger.info(
            "device_bridge_tunnel_registered",
            user_id=user_id,
            device_id=device_id,
            tunnel_id=tunnel_id,
        )

    async def unregister_tunnel(self, user_id: str, device_id: str) -> None:
        """Remove tunnel registration from Redis."""
        key = self._tunnel_key(user_id, device_id)
        await self.redis.delete(key)
        logger.info(
            "device_bridge_tunnel_unregistered",
            user_id=user_id,
            device_id=device_id,
        )

    # ------------------------------------------------------------------
    # Relay helpers
    # ------------------------------------------------------------------

    async def relay_to_device(
        self, user_id: str, device_id: str, message: dict
    ) -> None:
        """Publish a message to the device-bound pub/sub channel."""
        channel = self.device_channel(user_id, device_id)
        await self.redis.publish(channel, json.dumps(message))

    async def relay_to_runner(
        self, user_id: str, device_id: str, message: dict
    ) -> None:
        """Publish a message to the runner-bound pub/sub channel."""
        channel = self.runner_channel(user_id, device_id)
        await self.redis.publish(channel, json.dumps(message))
