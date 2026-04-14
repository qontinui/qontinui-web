"""
Multi-channel notification delivery.

Provides utilities for delivering notifications via:
- WebSocket (real-time)
- Slack (webhooks)
- Generic webhooks
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
import structlog
from app.integrations.slack import slack_integration
from app.schemas.test_notifications import (CoverageAlertNotification,
                                            DeficiencyNotification,
                                            TestRunNotification)
from app.services.websocket_manager import connection_manager

logger = structlog.get_logger(__name__)


class ChannelDeliveryService:
    """Service for delivering notifications via multiple channels."""

    def __init__(self, webhook_timeout: float = 10.0):
        """Initialize channel delivery service."""
        self.webhook_timeout = webhook_timeout

    async def send_websocket_notification(
        self, project_id: UUID, event_type: str, data: dict[str, Any]
    ) -> bool:
        """
        Send notification via WebSocket.

        Args:
            project_id: ID of project
            event_type: Type of event
            data: Notification data

        Returns:
            True if sent successfully
        """
        try:
            notification_data = {"type": event_type, "data": data}
            await connection_manager.broadcast_to_project(project_id, notification_data)

            logger.debug(
                "websocket_notification_sent",
                project_id=str(project_id),
                event_type=event_type,
            )
            return True

        except Exception as e:
            logger.error("websocket_notification_failed", error=str(e))
            return False

    async def send_test_run_slack(
        self, notification: TestRunNotification, slack_config: dict[str, Any]
    ) -> bool:
        """
        Send test run notification via Slack.

        Args:
            notification: Test run notification data
            slack_config: Slack configuration

        Returns:
            True if sent successfully
        """
        webhook_url = slack_config.get("slack_webhook_url")
        if not webhook_url:
            return False

        channel = slack_config.get("slack_channel")
        return await slack_integration.send_test_result_message(
            webhook_url, notification, channel
        )

    async def send_deficiency_slack(
        self, notification: DeficiencyNotification, slack_config: dict[str, Any]
    ) -> bool:
        """
        Send deficiency notification via Slack.

        Args:
            notification: Deficiency notification data
            slack_config: Slack configuration

        Returns:
            True if sent successfully
        """
        webhook_url = slack_config.get("slack_webhook_url")
        if not webhook_url:
            return False

        channel = slack_config.get("slack_channel")
        return await slack_integration.send_deficiency_message(
            webhook_url, notification, channel
        )

    async def send_coverage_slack(
        self, notification: CoverageAlertNotification, slack_config: dict[str, Any]
    ) -> bool:
        """
        Send coverage alert via Slack.

        Args:
            notification: Coverage alert notification data
            slack_config: Slack configuration

        Returns:
            True if sent successfully
        """
        webhook_url = slack_config.get("slack_webhook_url")
        if not webhook_url:
            return False

        channel = slack_config.get("slack_channel")
        return await slack_integration.send_coverage_alert_message(
            webhook_url, notification, channel
        )

    async def send_webhook(
        self, event_type: str, data: dict[str, Any], webhook_config: dict[str, Any]
    ) -> bool:
        """
        Send notification via generic webhook.

        Args:
            event_type: Type of event
            data: Notification data
            webhook_config: Webhook configuration

        Returns:
            True if sent successfully
        """
        try:
            webhook_url = webhook_config.get("webhook_url")
            if not webhook_url:
                return False

            headers = webhook_config.get("webhook_headers", {})
            headers["Content-Type"] = "application/json"

            payload = {
                "event": event_type,
                "data": data,
                "timestamp": datetime.now(UTC).isoformat(),
            }

            async with httpx.AsyncClient(timeout=self.webhook_timeout) as client:
                response = await client.post(webhook_url, json=payload, headers=headers)
                response.raise_for_status()

            logger.info("webhook_notification_sent", event_type=event_type)
            return True

        except Exception as e:
            logger.error("webhook_notification_failed", error=str(e))
            return False


# Global instance
channel_delivery_service = ChannelDeliveryService()
