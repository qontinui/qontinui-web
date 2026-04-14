"""
Slack integration for sending rich test notifications.

Provides formatted messages with color coding, statistics,
and action buttons for viewing test results.
"""

from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from app.schemas.test_notifications import (
    CoverageAlertNotification,
    DeficiencyNotification,
    TestRunNotification,
)

logger = structlog.get_logger(__name__)


class SlackIntegration:
    """
    Slack integration for test notifications.

    Sends rich formatted messages to Slack via webhooks with
    color coding, statistics, and action buttons.
    """

    def __init__(self):
        """Initialize Slack integration."""
        self.timeout = 10.0  # seconds

    async def send_test_result_message(
        self,
        webhook_url: str,
        notification: TestRunNotification,
        channel: str | None = None,
    ) -> bool:
        """
        Send test run result message to Slack.

        Args:
            webhook_url: Slack webhook URL
            notification: Test run notification data
            channel: Optional channel override

        Returns:
            True if message sent successfully
        """
        try:
            # Determine color based on test result
            color = self._get_result_color(notification)

            # Build message payload
            payload = {
                "channel": channel,
                "attachments": [
                    {
                        "color": color,
                        "title": self._format_test_title(notification),
                        "text": self._format_test_summary(notification),
                        "fields": self._build_test_fields(notification),
                        "footer": "Qontinui Test Automation",
                        "footer_icon": "https://qontinui.io/favicon.ico",
                        "ts": int(notification.started_at.timestamp()),
                        "actions": self._build_action_buttons(notification),
                    }
                ],
            }

            # Remove channel if None
            if channel is None:
                del payload["channel"]

            # Send to Slack
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(webhook_url, json=payload)
                response.raise_for_status()

            logger.info(
                "slack_test_result_sent",
                test_run_id=str(notification.test_run_id),
                status=notification.status,
            )
            return True

        except Exception as e:
            logger.error(
                "slack_test_result_failed",
                error=str(e),
                test_run_id=str(notification.test_run_id),
            )
            return False

    async def send_deficiency_message(
        self,
        webhook_url: str,
        notification: DeficiencyNotification,
        channel: str | None = None,
    ) -> bool:
        """
        Send deficiency notification to Slack.

        Args:
            webhook_url: Slack webhook URL
            notification: Deficiency notification data
            channel: Optional channel override

        Returns:
            True if message sent successfully
        """
        try:
            # Determine color based on severity
            color = self._get_severity_color(notification.severity)

            # Build message payload
            payload = {
                "channel": channel,
                "attachments": [
                    {
                        "color": color,
                        "title": f"🚨 {notification.severity.upper()} Deficiency Detected",
                        "text": f"*{notification.title}*\n{notification.description[:200]}...",
                        "fields": self._build_deficiency_fields(notification),
                        "footer": "Qontinui Test Automation",
                        "footer_icon": "https://qontinui.io/favicon.ico",
                        "ts": int(notification.first_seen_at.timestamp()),
                        "actions": self._build_deficiency_action_buttons(notification),
                    }
                ],
            }

            # Remove channel if None
            if channel is None:
                del payload["channel"]

            # Send to Slack
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(webhook_url, json=payload)
                response.raise_for_status()

            logger.info(
                "slack_deficiency_sent",
                deficiency_id=str(notification.deficiency_id),
                severity=notification.severity,
            )
            return True

        except Exception as e:
            logger.error(
                "slack_deficiency_failed",
                error=str(e),
                deficiency_id=str(notification.deficiency_id),
            )
            return False

    async def send_coverage_alert_message(
        self,
        webhook_url: str,
        notification: CoverageAlertNotification,
        channel: str | None = None,
    ) -> bool:
        """
        Send coverage drop alert to Slack.

        Args:
            webhook_url: Slack webhook URL
            notification: Coverage alert notification data
            channel: Optional channel override

        Returns:
            True if message sent successfully
        """
        try:
            # Coverage drops are warnings (yellow)
            color = "warning"

            # Calculate drop amount
            drop_text = ""
            if notification.coverage_drop is not None:
                drop_text = f" (↓ {notification.coverage_drop:.2f}%)"

            # Build message payload
            payload = {
                "channel": channel,
                "attachments": [
                    {
                        "color": color,
                        "title": "⚠️ Test Coverage Drop Detected",
                        "text": f"Coverage fell below threshold of {notification.threshold}%{drop_text}",
                        "fields": self._build_coverage_fields(notification),
                        "footer": "Qontinui Test Automation",
                        "footer_icon": "https://qontinui.io/favicon.ico",
                        "ts": int(datetime.now(UTC).timestamp()),
                        "actions": self._build_coverage_action_buttons(notification),
                    }
                ],
            }

            # Remove channel if None
            if channel is None:
                del payload["channel"]

            # Send to Slack
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(webhook_url, json=payload)
                response.raise_for_status()

            logger.info(
                "slack_coverage_alert_sent",
                test_run_id=str(notification.test_run_id),
                current_coverage=float(notification.current_coverage),
            )
            return True

        except Exception as e:
            logger.error(
                "slack_coverage_alert_failed",
                error=str(e),
                test_run_id=str(notification.test_run_id),
            )
            return False

    # ========================================================================
    # Helper Methods
    # ========================================================================

    def _get_result_color(self, notification: TestRunNotification) -> str:
        """
        Get Slack color based on test result.

        Args:
            notification: Test run notification

        Returns:
            Slack color string (good, warning, danger)
        """
        if notification.status == "completed":
            # Green if all tests passed, yellow if some failed
            if notification.failed_transitions == 0:
                return "good"
            elif notification.failed_transitions < notification.total_transitions / 2:
                return "warning"
            else:
                return "danger"
        else:
            # Red for failed, timeout, cancelled
            return "danger"

    def _get_severity_color(self, severity: str) -> str:
        """
        Get Slack color based on deficiency severity.

        Args:
            severity: Deficiency severity

        Returns:
            Slack color string (good, warning, danger)
        """
        severity_colors = {
            "critical": "danger",
            "high": "danger",
            "medium": "warning",
            "low": "warning",
            "info": "good",
        }
        return severity_colors.get(severity.lower(), "warning")

    def _format_test_title(self, notification: TestRunNotification) -> str:
        """
        Format test run title.

        Args:
            notification: Test run notification

        Returns:
            Formatted title string
        """
        workflow = notification.workflow_id or "Unknown Workflow"
        status_emoji = "✅" if notification.status == "completed" else "❌"
        return f"{status_emoji} Test Run {notification.status.title()}: {workflow}"

    def _format_test_summary(self, notification: TestRunNotification) -> str:
        """
        Format test run summary text.

        Args:
            notification: Test run notification

        Returns:
            Formatted summary string
        """
        pass_rate = 0.0
        if notification.total_transitions > 0:
            pass_rate = (
                notification.successful_transitions / notification.total_transitions
            ) * 100

        summary = f"Pass Rate: {pass_rate:.1f}% ({notification.successful_transitions}/{notification.total_transitions} transitions)\n"
        summary += f"Coverage: {notification.coverage_percentage}%"

        if notification.deficiencies_found > 0:
            summary += f"\n🐛 Found {notification.deficiencies_found} deficiencies"
            if notification.critical_deficiencies > 0:
                summary += (
                    f" ({notification.critical_deficiencies} critical, "
                    f"{notification.high_deficiencies} high)"
                )

        return summary

    def _build_test_fields(
        self, notification: TestRunNotification
    ) -> list[dict[str, Any]]:
        """
        Build Slack fields for test run.

        Args:
            notification: Test run notification

        Returns:
            List of Slack field dictionaries
        """
        fields = [
            {
                "title": "Status",
                "value": notification.status.title(),
                "short": True,
            },
            {
                "title": "Coverage",
                "value": f"{notification.coverage_percentage}%",
                "short": True,
            },
            {
                "title": "Successful",
                "value": str(notification.successful_transitions),
                "short": True,
            },
            {
                "title": "Failed",
                "value": str(notification.failed_transitions),
                "short": True,
            },
        ]

        if notification.duration_seconds is not None:
            minutes, seconds = divmod(notification.duration_seconds, 60)
            fields.append(
                {
                    "title": "Duration",
                    "value": f"{int(minutes)}m {int(seconds)}s",
                    "short": True,
                }
            )

        if notification.unique_states_visited > 0:
            fields.append(
                {
                    "title": "States Visited",
                    "value": str(notification.unique_states_visited),
                    "short": True,
                }
            )

        return fields

    def _build_deficiency_fields(
        self, notification: DeficiencyNotification
    ) -> list[dict[str, Any]]:
        """
        Build Slack fields for deficiency.

        Args:
            notification: Deficiency notification

        Returns:
            List of Slack field dictionaries
        """
        fields: list[dict[str, Any]] = [
            {
                "title": "Severity",
                "value": notification.severity.upper(),
                "short": True,
            },
            {
                "title": "Type",
                "value": notification.deficiency_type.title(),
                "short": True,
            },
            {
                "title": "Reproducible",
                "value": "Yes" if notification.reproducible else "No",
                "short": True,
            },
        ]

        if notification.occurrence_count > 1:
            fields.append(
                {
                    "title": "Occurrences",
                    "value": str(notification.occurrence_count),
                    "short": True,
                }
            )

        if notification.reproduction_rate is not None:
            fields.append(
                {
                    "title": "Reproduction Rate",
                    "value": f"{notification.reproduction_rate}%",
                    "short": True,
                }
            )

        return fields

    def _build_coverage_fields(
        self, notification: CoverageAlertNotification
    ) -> list[dict[str, Any]]:
        """
        Build Slack fields for coverage alert.

        Args:
            notification: Coverage alert notification

        Returns:
            List of Slack field dictionaries
        """
        fields = [
            {
                "title": "Current Coverage",
                "value": f"{notification.current_coverage}%",
                "short": True,
            },
            {
                "title": "Threshold",
                "value": f"{notification.threshold}%",
                "short": True,
            },
        ]

        if notification.previous_coverage is not None:
            fields.append(
                {
                    "title": "Previous Coverage",
                    "value": f"{notification.previous_coverage}%",
                    "short": True,
                }
            )

        if notification.states_total > 0:
            fields.append(
                {
                    "title": "States Covered",
                    "value": f"{notification.states_covered}/{notification.states_total}",
                    "short": True,
                }
            )

        if notification.transitions_total > 0:
            fields.append(
                {
                    "title": "Transitions Covered",
                    "value": f"{notification.transitions_covered}/{notification.transitions_total}",
                    "short": True,
                }
            )

        return fields

    def _build_action_buttons(
        self, notification: TestRunNotification
    ) -> list[dict[str, Any]]:
        """
        Build action buttons for test run notification.

        Args:
            notification: Test run notification

        Returns:
            List of Slack action button dictionaries
        """
        actions = []

        if notification.dashboard_url:
            actions.append(
                {
                    "type": "button",
                    "text": "View Dashboard",
                    "url": notification.dashboard_url,
                    "style": "primary",
                }
            )

        if notification.report_url:
            actions.append(
                {
                    "type": "button",
                    "text": "View Report",
                    "url": notification.report_url,
                }
            )

        if notification.deficiencies_found > 0 and notification.dashboard_url:
            deficiencies_url = f"{notification.dashboard_url}/deficiencies"
            actions.append(
                {
                    "type": "button",
                    "text": "View Deficiencies",
                    "url": deficiencies_url,
                    "style": "danger" if notification.critical_deficiencies > 0 else "",
                }
            )

        return actions

    def _build_deficiency_action_buttons(
        self, notification: DeficiencyNotification
    ) -> list[dict[str, Any]]:
        """
        Build action buttons for deficiency notification.

        Args:
            notification: Deficiency notification

        Returns:
            List of Slack action button dictionaries
        """
        actions = []

        if notification.deficiency_url:
            actions.append(
                {
                    "type": "button",
                    "text": "View Details",
                    "url": notification.deficiency_url,
                    "style": "primary",
                }
            )

        if notification.test_run_url:
            actions.append(
                {
                    "type": "button",
                    "text": "View Test Run",
                    "url": notification.test_run_url,
                }
            )

        return actions

    def _build_coverage_action_buttons(
        self, notification: CoverageAlertNotification
    ) -> list[dict[str, Any]]:
        """
        Build action buttons for coverage alert notification.

        Args:
            notification: Coverage alert notification

        Returns:
            List of Slack action button dictionaries
        """
        actions = []

        if notification.dashboard_url:
            actions.append(
                {
                    "type": "button",
                    "text": "View Dashboard",
                    "url": notification.dashboard_url,
                    "style": "primary",
                }
            )

        if notification.report_url:
            actions.append(
                {
                    "type": "button",
                    "text": "View Report",
                    "url": notification.report_url,
                }
            )

        return actions


# Global instance
slack_integration = SlackIntegration()
