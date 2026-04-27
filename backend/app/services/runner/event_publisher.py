"""
Runner Event Publisher for status broadcasting.

Publishes runner status events via Redis pub/sub for real-time notifications.
"""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
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
        runner_id: str,
        runner_name: str | None,
        connected_at: datetime,
        ip_address: str | None = None,
        project_id: UUID | None = None,
        runner_port: int | None = None,
    ) -> None:
        """
        Publish a runner connected event.

        Args:
            user_id: Owner user ID
            runner_id: Database connection record ID
            runner_name: Runner name
            connected_at: Connection timestamp
            ip_address: Optional IP address
            project_id: Optional project ID
            runner_port: Optional HTTP API port the runner is listening on
        """
        connection_data = {
            "id": runner_id,
            "runner_name": runner_name or "Desktop Runner",
            "connected_at": connected_at.isoformat(),
            "disconnected_at": None,
            "duration_seconds": None,
            "ip_address": ip_address,
            "project_id": str(project_id) if project_id else None,
            "runner_port": runner_port,
            "ws_connected": True,
        }

        await self._publish_status_update(
            user_id=user_id,
            message={
                "type": "runner_connected",
                "connection": connection_data,
                "timestamp": utc_now().isoformat(),
            },
        )

    async def publish_runner_disconnected(
        self,
        user_id: UUID,
        runner_id: str,
    ) -> None:
        """
        Publish a runner disconnected event.

        Args:
            user_id: Owner user ID
            runner_id: Database connection record ID
        """
        await self._publish_status_update(
            user_id=user_id,
            message={
                "type": "runner_disconnected",
                "runner_id": runner_id,
                "timestamp": utc_now().isoformat(),
            },
        )

    async def publish_runner_name_updated(
        self,
        user_id: UUID,
        runner_id: str,
        runner_name: str,
    ) -> None:
        """
        Publish a runner name update event.

        Called when the runner sends its runner_info message after connection,
        which contains the custom runner name.

        Args:
            user_id: User ID to send the update to
            runner_id: Database connection record ID
            runner_name: The updated runner name
        """
        logger.info(
            "runner_name_update_publishing",
            runner_id=runner_id,
            runner_name=runner_name,
            user_id=str(user_id),
        )
        try:
            await self._publish_status_update(
                user_id=user_id,
                message={
                    "type": "runner_name_updated",
                    "runner_id": runner_id,
                    "runner_name": runner_name,
                    "timestamp": utc_now().isoformat(),
                },
            )
            logger.info(
                "runner_name_update_published",
                runner_id=runner_id,
                runner_name=runner_name,
                user_id=str(user_id),
            )
        except Exception as e:
            logger.error(
                "runner_name_update_publish_error",
                runner_id=runner_id,
                error=str(e),
                error_type=type(e).__name__,
            )

    async def publish_runner_port_updated(
        self,
        user_id: UUID,
        runner_id: str,
        runner_port: int,
    ) -> None:
        """
        Publish a runner port update event.

        Called when the runner sends its runner_info message after connection,
        which contains the HTTP API port.

        Args:
            user_id: User ID to send the update to
            runner_id: Database connection record ID
            runner_port: The HTTP API port the runner is listening on
        """
        logger.info(
            "runner_port_update_publishing",
            runner_id=runner_id,
            runner_port=runner_port,
            user_id=str(user_id),
        )
        try:
            await self._publish_status_update(
                user_id=user_id,
                message={
                    "type": "runner_port_updated",
                    "runner_id": runner_id,
                    "runner_port": runner_port,
                    "timestamp": utc_now().isoformat(),
                },
            )
            logger.info(
                "runner_port_update_published",
                runner_id=runner_id,
                runner_port=runner_port,
                user_id=str(user_id),
            )
        except Exception as e:
            logger.error(
                "runner_port_update_publish_error",
                runner_id=runner_id,
                error=str(e),
                error_type=type(e).__name__,
            )

    async def publish_runner_woke(
        self,
        user_id: UUID,
        runner_id: str,
        intent_id: str | None,
        task_id: str | None,
        reason: str | None,
    ) -> None:
        """Publish a ``runner.woke`` event after a wake-intent is fulfilled.

        The qontinui-web frontend listens for this event over the
        per-user Redis pub/sub channel to transition the wake-modal out
        of its "waking" state and dispatch the queued task. The event
        name is the canonical contract between the backend and the
        Phase F-runner deep-link handler.
        """
        await self._publish_status_update(
            user_id=user_id,
            message={
                "type": "runner.woke",
                "runner_id": runner_id,
                "intent_id": intent_id,
                "task_id": task_id,
                "reason": reason,
                "timestamp": utc_now().isoformat(),
            },
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
