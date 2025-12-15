"""
Test notification service for managing test-related notifications.

Provides business logic for:
- Sending notifications when test runs complete
- Alerting on critical/high severity deficiencies
- Notifying when coverage drops below threshold
- Multi-channel delivery (WebSocket, email, Slack, webhooks)
"""

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.slack import slack_integration
from app.models.notification import NotificationType
from app.models.project import Project
from app.models.software_test_run import SoftwareTestRun
from app.models.test_deficiency import DeficiencySeverity, TestDeficiency
from app.models.test_notification_preferences import TestNotificationPreferences
from app.schemas.test_notifications import (
    CoverageAlertNotification,
    DeficiencyNotification,
    TestRunNotification,
)
from app.services.email.email_template_service import EmailTemplateService
from app.services.email.email_transport_service import EmailTransportService
from app.services.notification_service import notification_service
from app.services.websocket_manager import connection_manager

logger = structlog.get_logger(__name__)


class TestNotificationService:
    """Service for managing test-related notifications."""

    def __init__(self):
        """Initialize test notification service."""
        self.email_transport = EmailTransportService()
        self.email_templates = EmailTemplateService()
        self.webhook_timeout = 10.0  # seconds

    # ========================================================================
    # Notification Preferences
    # ========================================================================

    async def get_project_preferences(
        self, db: AsyncSession, project_id: UUID
    ) -> TestNotificationPreferences:
        """
        Get test notification preferences for a project.

        Creates default preferences if none exist.

        Args:
            db: Database session
            project_id: ID of project

        Returns:
            TestNotificationPreferences object
        """
        try:
            result = await db.execute(
                select(TestNotificationPreferences).filter(
                    TestNotificationPreferences.project_id == project_id
                )
            )
            preferences = result.scalar_one_or_none()

            if not preferences:
                # Create default preferences
                preferences = TestNotificationPreferences.create_default(project_id)
                db.add(preferences)
                await db.commit()
                await db.refresh(preferences)
                logger.info("test_preferences_created", project_id=str(project_id))

            return preferences

        except Exception as e:
            logger.error("get_test_preferences_failed", error=str(e))
            # Return default preferences without saving
            return TestNotificationPreferences.create_default(project_id)

    async def update_project_preferences(
        self,
        db: AsyncSession,
        project_id: UUID,
        preferences_data: dict[str, Any],
    ) -> TestNotificationPreferences:
        """
        Update test notification preferences for a project.

        Args:
            db: Database session
            project_id: ID of project
            preferences_data: Dictionary of preference updates

        Returns:
            Updated TestNotificationPreferences object
        """
        try:
            preferences = await self.get_project_preferences(db, project_id)

            # Update fields
            for key, value in preferences_data.items():
                if hasattr(preferences, key):
                    setattr(preferences, key, value)

            preferences.updated_at = datetime.utcnow()  # type: ignore[assignment]
            await db.commit()
            await db.refresh(preferences)

            logger.info("test_preferences_updated", project_id=str(project_id))
            return preferences

        except Exception as e:
            logger.error("update_test_preferences_failed", error=str(e))
            await db.rollback()
            raise

    # ========================================================================
    # Test Run Notifications
    # ========================================================================

    async def notify_test_run_completed(
        self,
        db: AsyncSession,
        test_run_id: UUID,
        project_id: UUID,
        frontend_url: str,
    ) -> bool:
        """
        Send notification when test run completes.

        Args:
            db: Database session
            test_run_id: ID of completed test run
            project_id: ID of project
            frontend_url: Frontend base URL for links

        Returns:
            True if at least one notification sent successfully
        """
        try:
            # Get test run
            result = await db.execute(
                select(SoftwareTestRun).filter(SoftwareTestRun.id == test_run_id)
            )
            test_run = result.scalar_one_or_none()

            if not test_run:
                logger.warning("test_run_not_found", test_run_id=str(test_run_id))
                return False

            # Get preferences
            preferences = await self.get_project_preferences(db, project_id)

            # Check if notification should be sent
            if not preferences.should_notify_test_run(test_run.status):
                logger.info(
                    "test_run_notification_skipped",
                    test_run_id=str(test_run_id),
                    status=test_run.status,
                    reason="user_preferences",
                )
                return False

            # Build notification data
            notification = await self._build_test_run_notification(
                db, test_run, frontend_url
            )

            # Send via enabled channels
            success = False

            # WebSocket (real-time dashboard update)
            if preferences.is_channel_enabled("websocket"):
                ws_success = await self._send_websocket_notification(
                    project_id, "test_run_completed", notification.model_dump()
                )
                success = success or ws_success

            # Email
            if preferences.is_channel_enabled("email"):
                email_success = await self._send_test_run_email(
                    db, test_run, notification, preferences.email_config
                )
                success = success or email_success

            # Slack
            if preferences.is_channel_enabled("slack"):
                slack_success = await self._send_test_run_slack(
                    notification, preferences.slack_config
                )
                success = success or slack_success

            # Generic webhook
            if preferences.is_channel_enabled("webhook"):
                webhook_success = await self._send_webhook(
                    "test_run_completed",
                    notification.model_dump(),
                    preferences.webhook_config,
                )
                success = success or webhook_success

            # Also create in-app notification for project team members
            await self._create_in_app_test_notification(
                db,
                project_id,
                NotificationType.PROJECT_UPDATE,
                f"Test run {test_run.status}",
                f"Test run for workflow '{test_run.workflow_id or 'Unknown'}' {test_run.status}",
                test_run_id=test_run_id,
            )

            logger.info(
                "test_run_notification_sent",
                test_run_id=str(test_run_id),
                status=test_run.status,
            )
            return success

        except Exception as e:
            logger.error(
                "test_run_notification_failed",
                error=str(e),
                test_run_id=str(test_run_id),
            )
            return False

    # ========================================================================
    # Deficiency Notifications
    # ========================================================================

    async def notify_critical_deficiency(
        self,
        db: AsyncSession,
        deficiency_id: UUID,
        project_id: UUID,
        frontend_url: str,
    ) -> bool:
        """
        Send immediate notification for critical/high severity deficiency.

        Args:
            db: Database session
            deficiency_id: ID of deficiency
            project_id: ID of project
            frontend_url: Frontend base URL for links

        Returns:
            True if at least one notification sent successfully
        """
        try:
            # Get deficiency
            result = await db.execute(
                select(TestDeficiency).filter(TestDeficiency.id == deficiency_id)
            )
            deficiency = result.scalar_one_or_none()

            if not deficiency:
                logger.warning("deficiency_not_found", deficiency_id=str(deficiency_id))
                return False

            # Get preferences
            preferences = await self.get_project_preferences(db, project_id)

            # Check if notification should be sent
            if not preferences.should_notify_deficiency(deficiency.severity):
                logger.info(
                    "deficiency_notification_skipped",
                    deficiency_id=str(deficiency_id),
                    severity=deficiency.severity,
                    reason="user_preferences",
                )
                return False

            # Build notification data
            notification = await self._build_deficiency_notification(
                db, deficiency, frontend_url
            )

            # Send via enabled channels
            success = False

            # WebSocket (immediate alert)
            if preferences.is_channel_enabled("websocket"):
                ws_success = await self._send_websocket_notification(
                    project_id, "deficiency_detected", notification.model_dump()
                )
                success = success or ws_success

            # Email
            if preferences.is_channel_enabled("email"):
                email_success = await self._send_deficiency_email(
                    db, deficiency, notification, preferences.email_config
                )
                success = success or email_success

            # Slack
            if preferences.is_channel_enabled("slack"):
                slack_success = await self._send_deficiency_slack(
                    notification, preferences.slack_config
                )
                success = success or slack_success

            # Generic webhook
            if preferences.is_channel_enabled("webhook"):
                webhook_success = await self._send_webhook(
                    "deficiency_detected",
                    notification.model_dump(),
                    preferences.webhook_config,
                )
                success = success or webhook_success

            # Create in-app notification
            await self._create_in_app_test_notification(
                db,
                project_id,
                NotificationType.PROJECT_UPDATE,
                f"{deficiency.severity.upper()} deficiency detected",
                f"{deficiency.title}",
                deficiency_id=deficiency_id,
            )

            logger.info(
                "deficiency_notification_sent",
                deficiency_id=str(deficiency_id),
                severity=deficiency.severity,
            )
            return success

        except Exception as e:
            logger.error(
                "deficiency_notification_failed",
                error=str(e),
                deficiency_id=str(deficiency_id),
            )
            return False

    # ========================================================================
    # Coverage Drop Notifications
    # ========================================================================

    async def notify_coverage_drop(
        self,
        db: AsyncSession,
        test_run_id: UUID,
        project_id: UUID,
        current_coverage: Decimal,
        previous_coverage: Decimal | None,
        frontend_url: str,
    ) -> bool:
        """
        Send notification when coverage drops below threshold.

        Args:
            db: Database session
            test_run_id: ID of test run
            project_id: ID of project
            current_coverage: Current coverage percentage
            previous_coverage: Previous coverage percentage
            frontend_url: Frontend base URL for links

        Returns:
            True if at least one notification sent successfully
        """
        try:
            # Get preferences
            preferences = await self.get_project_preferences(db, project_id)

            # Check if notification should be sent
            if not preferences.should_notify_coverage_drop(current_coverage):
                logger.info(
                    "coverage_drop_notification_skipped",
                    test_run_id=str(test_run_id),
                    current_coverage=float(current_coverage),
                    threshold=float(preferences.coverage_drop_threshold),
                    reason="above_threshold",
                )
                return False

            # Get test run for additional context
            result = await db.execute(
                select(SoftwareTestRun).filter(SoftwareTestRun.id == test_run_id)
            )
            test_run = result.scalar_one_or_none()

            # Build notification data
            notification = await self._build_coverage_alert_notification(
                test_run,
                project_id,
                current_coverage,
                previous_coverage,
                preferences.coverage_drop_threshold,
                frontend_url,
            )

            # Send via enabled channels
            success = False

            # WebSocket
            if preferences.is_channel_enabled("websocket"):
                ws_success = await self._send_websocket_notification(
                    project_id, "coverage_drop", notification.model_dump()
                )
                success = success or ws_success

            # Email
            if preferences.is_channel_enabled("email"):
                email_success = await self._send_coverage_email(
                    db, notification, preferences.email_config
                )
                success = success or email_success

            # Slack
            if preferences.is_channel_enabled("slack"):
                slack_success = await self._send_coverage_slack(
                    notification, preferences.slack_config
                )
                success = success or slack_success

            # Generic webhook
            if preferences.is_channel_enabled("webhook"):
                webhook_success = await self._send_webhook(
                    "coverage_drop",
                    notification.model_dump(),
                    preferences.webhook_config,
                )
                success = success or webhook_success

            # Create in-app notification
            await self._create_in_app_test_notification(
                db,
                project_id,
                NotificationType.PROJECT_UPDATE,
                "Test coverage dropped",
                f"Coverage fell to {current_coverage}% (threshold: {preferences.coverage_drop_threshold}%)",
                test_run_id=test_run_id,
            )

            logger.info(
                "coverage_drop_notification_sent",
                test_run_id=str(test_run_id),
                current_coverage=float(current_coverage),
            )
            return success

        except Exception as e:
            logger.error(
                "coverage_drop_notification_failed",
                error=str(e),
                test_run_id=str(test_run_id),
            )
            return False

    # ========================================================================
    # Notification Builders
    # ========================================================================

    async def _build_test_run_notification(
        self, db: AsyncSession, test_run: SoftwareTestRun, frontend_url: str
    ) -> TestRunNotification:
        """Build test run notification data."""
        # Count deficiencies by severity
        result = await db.execute(
            select(TestDeficiency).filter(TestDeficiency.test_run_id == test_run.id)
        )
        deficiencies = result.scalars().all()

        critical_count = sum(
            1 for d in deficiencies if d.severity == DeficiencySeverity.CRITICAL
        )
        high_count = sum(
            1 for d in deficiencies if d.severity == DeficiencySeverity.HIGH
        )

        # Calculate duration
        duration = None
        if test_run.completed_at and test_run.started_at:
            duration = int(
                (test_run.completed_at - test_run.started_at).total_seconds()
            )

        # Build URLs
        dashboard_url = (
            f"{frontend_url}/projects/{test_run.project_id}/testing/runs/{test_run.id}"
        )
        report_url = f"{dashboard_url}/report"

        return TestRunNotification(
            test_run_id=test_run.id,
            project_id=test_run.project_id,
            workflow_id=test_run.workflow_id,
            status=test_run.status,
            started_at=test_run.started_at,
            completed_at=test_run.completed_at,
            total_transitions=test_run.total_transitions,
            successful_transitions=test_run.successful_transitions,
            failed_transitions=test_run.failed_transitions,
            skipped_transitions=test_run.skipped_transitions,
            coverage_percentage=test_run.coverage_percentage,
            unique_states_visited=test_run.unique_states_visited,
            unique_paths_found=test_run.unique_paths_found,
            deficiencies_found=test_run.deficiencies_found,
            critical_deficiencies=critical_count,
            high_deficiencies=high_count,
            dashboard_url=dashboard_url,
            report_url=report_url,
            duration_seconds=duration,
            error_summary=test_run.error_summary,
        )

    async def _build_deficiency_notification(
        self, db: AsyncSession, deficiency: TestDeficiency, frontend_url: str
    ) -> DeficiencyNotification:
        """Build deficiency notification data."""
        # Get test run for project context
        result = await db.execute(
            select(SoftwareTestRun).filter(SoftwareTestRun.id == deficiency.test_run_id)
        )
        test_run = result.scalar_one_or_none()

        # Build URLs
        deficiency_url = (
            f"{frontend_url}/projects/{test_run.project_id}/testing/deficiencies/{deficiency.id}"
            if test_run
            else None
        )
        test_run_url = (
            f"{frontend_url}/projects/{test_run.project_id}/testing/runs/{test_run.id}"
            if test_run
            else None
        )

        return DeficiencyNotification(
            deficiency_id=deficiency.id,
            test_run_id=deficiency.test_run_id,
            project_id=test_run.project_id if test_run else UUID(int=0),
            severity=deficiency.severity,
            deficiency_type=deficiency.deficiency_type,
            title=deficiency.title,
            description=deficiency.description,
            screenshot_urls=deficiency.screenshot_urls,
            video_url=deficiency.video_url,
            reproducible=deficiency.reproducible,
            reproduction_rate=deficiency.reproduction_rate,
            environment_info=deficiency.environment_info,
            workflow_id=test_run.workflow_id if test_run else None,
            deficiency_url=deficiency_url,
            test_run_url=test_run_url,
            first_seen_at=deficiency.first_seen_at,
            occurrence_count=deficiency.occurrence_count,
        )

    async def _build_coverage_alert_notification(
        self,
        test_run: SoftwareTestRun | None,
        project_id: UUID,
        current_coverage: Decimal,
        previous_coverage: Decimal | None,
        threshold: Decimal,
        frontend_url: str,
    ) -> CoverageAlertNotification:
        """Build coverage alert notification data."""
        coverage_drop = None
        if previous_coverage is not None:
            coverage_drop = previous_coverage - current_coverage

        # Build URLs
        dashboard_url = (
            f"{frontend_url}/projects/{project_id}/testing/coverage"
            if test_run
            else None
        )
        report_url = (
            f"{frontend_url}/projects/{project_id}/testing/runs/{test_run.id}/coverage"
            if test_run
            else None
        )

        return CoverageAlertNotification(
            test_run_id=test_run.id if test_run else UUID(int=0),
            project_id=project_id,
            current_coverage=current_coverage,
            previous_coverage=previous_coverage,
            threshold=threshold,
            coverage_drop=coverage_drop,
            workflow_id=test_run.workflow_id if test_run else None,
            states_covered=test_run.unique_states_visited if test_run else 0,
            states_total=0,  # Would need separate query
            transitions_covered=test_run.successful_transitions if test_run else 0,
            transitions_total=test_run.total_transitions if test_run else 0,
            dashboard_url=dashboard_url,
            report_url=report_url,
        )

    # ========================================================================
    # Channel Delivery Methods
    # ========================================================================

    async def _send_websocket_notification(
        self, project_id: UUID, event_type: str, data: dict[str, Any]
    ) -> bool:
        """Send notification via WebSocket."""
        try:
            # Broadcast to all users with access to the project
            # Note: This would need project member lookup in real implementation
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

    async def _send_test_run_email(
        self,
        db: AsyncSession,
        test_run: SoftwareTestRun,
        notification: TestRunNotification,
        email_config: dict[str, Any],
    ) -> bool:
        """Send test run notification via email."""
        try:
            recipients = email_config.get("email_recipients", [])
            if not recipients:
                logger.debug("no_email_recipients", test_run_id=str(test_run.id))
                return False

            # Get project for context
            result = await db.execute(
                select(Project).filter(Project.id == test_run.project_id)
            )
            project = result.scalar_one_or_none()

            # Build email context
            context = {
                "project_name": project.name if project else "Unknown Project",
                "workflow_name": test_run.workflow_id or "Unknown Workflow",
                "status": test_run.status,
                "status_emoji": "✅" if test_run.status == "completed" else "❌",
                "coverage": f"{notification.coverage_percentage}%",
                "total_transitions": notification.total_transitions,
                "successful_transitions": notification.successful_transitions,
                "failed_transitions": notification.failed_transitions,
                "deficiencies_found": notification.deficiencies_found,
                "critical_deficiencies": notification.critical_deficiencies,
                "high_deficiencies": notification.high_deficiencies,
                "dashboard_url": notification.dashboard_url,
                "report_url": notification.report_url,
            }

            # Render template (would need to create email template)
            html_body = f"""
            <h2>Test Run {test_run.status.title()}</h2>
            <p>Workflow: {context['workflow_name']}</p>
            <p>Coverage: {context['coverage']}</p>
            <p>Transitions: {context['successful_transitions']}/{context['total_transitions']} successful</p>
            {f"<p>⚠️ Found {context['deficiencies_found']} deficiencies</p>" if context['deficiencies_found'] > 0 else ""}
            <p><a href="{context['dashboard_url']}">View Dashboard</a></p>
            """

            # Send to all recipients
            success = True
            for recipient in recipients:
                sent = await self.email_transport.send_email(
                    to_email=recipient,
                    subject=f"Test Run {test_run.status.title()}: {context['workflow_name']}",
                    text_body=f"Test run {test_run.status}",
                    html_body=html_body,
                )
                success = success and sent

            return success

        except Exception as e:
            logger.error("test_run_email_failed", error=str(e))
            return False

    async def _send_deficiency_email(
        self,
        db: AsyncSession,
        deficiency: TestDeficiency,
        notification: DeficiencyNotification,
        email_config: dict[str, Any],
    ) -> bool:
        """Send deficiency notification via email."""
        try:
            recipients = email_config.get("email_recipients", [])
            if not recipients:
                return False

            # Build HTML body
            html_body = f"""
            <h2>🚨 {deficiency.severity.upper()} Deficiency Detected</h2>
            <p><strong>{deficiency.title}</strong></p>
            <p>{deficiency.description}</p>
            <p>Type: {deficiency.deficiency_type}</p>
            <p>Reproducible: {'Yes' if deficiency.reproducible else 'No'}</p>
            {f'<p><a href="{notification.deficiency_url}">View Details</a></p>' if notification.deficiency_url else ''}
            """

            # Send to all recipients
            success = True
            for recipient in recipients:
                sent = await self.email_transport.send_email(
                    to_email=recipient,
                    subject=f"{deficiency.severity.upper()} Deficiency: {deficiency.title}",
                    text_body=deficiency.description,
                    html_body=html_body,
                )
                success = success and sent

            return success

        except Exception as e:
            logger.error("deficiency_email_failed", error=str(e))
            return False

    async def _send_coverage_email(
        self,
        db: AsyncSession,
        notification: CoverageAlertNotification,
        email_config: dict[str, Any],
    ) -> bool:
        """Send coverage drop alert via email."""
        try:
            recipients = email_config.get("email_recipients", [])
            if not recipients:
                return False

            drop_text = ""
            if notification.coverage_drop:
                drop_text = f" (↓ {notification.coverage_drop:.2f}%)"

            html_body = f"""
            <h2>⚠️ Test Coverage Drop Alert</h2>
            <p>Coverage fell to {notification.current_coverage}%{drop_text}</p>
            <p>Threshold: {notification.threshold}%</p>
            {f'<p><a href="{notification.dashboard_url}">View Dashboard</a></p>' if notification.dashboard_url else ''}
            """

            # Send to all recipients
            success = True
            for recipient in recipients:
                sent = await self.email_transport.send_email(
                    to_email=recipient,
                    subject=f"Coverage Drop Alert: {notification.current_coverage}%",
                    text_body=f"Coverage dropped to {notification.current_coverage}%",
                    html_body=html_body,
                )
                success = success and sent

            return success

        except Exception as e:
            logger.error("coverage_email_failed", error=str(e))
            return False

    async def _send_test_run_slack(
        self, notification: TestRunNotification, slack_config: dict[str, Any]
    ) -> bool:
        """Send test run notification via Slack."""
        webhook_url = slack_config.get("slack_webhook_url")
        if not webhook_url:
            return False

        channel = slack_config.get("slack_channel")
        return await slack_integration.send_test_result_message(
            webhook_url, notification, channel
        )

    async def _send_deficiency_slack(
        self, notification: DeficiencyNotification, slack_config: dict[str, Any]
    ) -> bool:
        """Send deficiency notification via Slack."""
        webhook_url = slack_config.get("slack_webhook_url")
        if not webhook_url:
            return False

        channel = slack_config.get("slack_channel")
        return await slack_integration.send_deficiency_message(
            webhook_url, notification, channel
        )

    async def _send_coverage_slack(
        self, notification: CoverageAlertNotification, slack_config: dict[str, Any]
    ) -> bool:
        """Send coverage alert via Slack."""
        webhook_url = slack_config.get("slack_webhook_url")
        if not webhook_url:
            return False

        channel = slack_config.get("slack_channel")
        return await slack_integration.send_coverage_alert_message(
            webhook_url, notification, channel
        )

    async def _send_webhook(
        self, event_type: str, data: dict[str, Any], webhook_config: dict[str, Any]
    ) -> bool:
        """Send notification via generic webhook."""
        try:
            webhook_url = webhook_config.get("webhook_url")
            if not webhook_url:
                return False

            headers = webhook_config.get("webhook_headers", {})
            headers["Content-Type"] = "application/json"

            payload = {
                "event": event_type,
                "data": data,
                "timestamp": datetime.utcnow().isoformat(),
            }

            async with httpx.AsyncClient(timeout=self.webhook_timeout) as client:
                response = await client.post(webhook_url, json=payload, headers=headers)
                response.raise_for_status()

            logger.info("webhook_notification_sent", event_type=event_type)
            return True

        except Exception as e:
            logger.error("webhook_notification_failed", error=str(e))
            return False

    async def _create_in_app_test_notification(
        self,
        db: AsyncSession,
        project_id: UUID,
        notification_type: NotificationType,
        title: str,
        message: str,
        test_run_id: UUID | None = None,
        deficiency_id: UUID | None = None,
    ) -> None:
        """
        Create in-app notification for project team members.

        Uses the existing notification service to create notifications
        for all project members.
        """
        try:
            # Get project to find team members
            result = await db.execute(select(Project).filter(Project.id == project_id))
            project = result.scalar_one_or_none()

            if not project:
                return

            # Build metadata
            metadata = {
                "project_id": str(project_id),
                "deep_link": f"/projects/{project_id}/testing",
            }

            if test_run_id:
                metadata["test_run_id"] = str(test_run_id)
                metadata["deep_link"] = (
                    f"/projects/{project_id}/testing/runs/{test_run_id}"
                )

            if deficiency_id:
                metadata["deficiency_id"] = str(deficiency_id)
                metadata["deep_link"] = (
                    f"/projects/{project_id}/testing/deficiencies/{deficiency_id}"
                )

            # Create notification for project owner
            await notification_service.create_notification(
                db=db,
                user_id=project.owner_id,
                notification_type=notification_type,
                title=title,
                message=message,
                project_id=project_id,
                resource_type="test_run" if test_run_id else "deficiency",
                resource_id=str(test_run_id or deficiency_id or ""),
                metadata=metadata,
                send_email=False,  # Already handled by test notification channels
            )

            # TODO: Also notify project members/collaborators when implemented

        except Exception as e:
            logger.error("in_app_test_notification_failed", error=str(e))


# Global instance
test_notification_service = TestNotificationService()
