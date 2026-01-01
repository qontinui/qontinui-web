"""
Runner Event Publisher for status broadcasting.

Publishes runner status events via Redis pub/sub for real-time notifications.
"""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from redis import asyncio as aioredis

logger = structlog.get_logger(__name__)


class RunnerEventPublisher:
    """
    Broadcasts runner status events to interested parties.

    Uses Redis pub/sub to broadcast status updates that can be received
    by multiple frontend clients across different server instances.

    Channel format: runner:status:updates:{user_id}
    """

    def __init__(self, redis_client: aioredis.Redis):
        self._redis = redis_client

    async def publish_runner_connected(
        self,
        user_id: UUID,
        connection_id: int,
        runner_name: str | None,
        connected_at: datetime,
        ip_address: str | None = None,
        project_id: UUID | None = None,
    ) -> None:
        """
        Publish a runner connected event.

        Args:
            user_id: Owner user ID
            connection_id: Database connection record ID
            runner_name: Runner name
            connected_at: Connection timestamp
            ip_address: Optional IP address
            project_id: Optional project ID
        """
        connection_data = {
            "id": connection_id,
            "runner_name": runner_name or "Desktop Runner",
            "connected_at": connected_at.isoformat(),
            "disconnected_at": None,
            "duration_seconds": None,
            "ip_address": ip_address,
            "project_id": str(project_id) if project_id else None,
            "ws_connected": True,
        }

        await self._publish_status_update(
            user_id=user_id,
            message={
                "type": "runner_connected",
                "connection": connection_data,
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

    async def publish_runner_disconnected(
        self,
        user_id: UUID,
        connection_id: int,
    ) -> None:
        """
        Publish a runner disconnected event.

        Args:
            user_id: Owner user ID
            connection_id: Database connection record ID
        """
        await self._publish_status_update(
            user_id=user_id,
            message={
                "type": "runner_disconnected",
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat(),
            },
        )

    async def publish_runner_name_updated(
        self,
        user_id: UUID,
        connection_id: int,
        runner_name: str,
    ) -> None:
        """
        Publish a runner name update event.

        Called when the runner sends its runner_info message after connection,
        which contains the custom runner name.

        Args:
            user_id: User ID to send the update to
            connection_id: Database connection record ID
            runner_name: The updated runner name
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
            result = await self._redis.publish(channel, json.dumps(message))
            logger.info(
                "runner_status_update_published",
                user_id=str(user_id),
                message_type=message.get("type"),
                channel=channel,
                subscribers=result,
            )
        except Exception as e:
            logger.error(
                "runner_status_update_publish_failed",
                user_id=str(user_id),
                error=str(e),
            )
